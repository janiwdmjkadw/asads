import { useEffect, useRef } from 'react';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import { isFeedPausedForNavigation, isFeedScrollActive, onFeedResume } from './feedNavigationPause';
import { createLaneStreamGate, laneStreamVisible, type LaneStreamGate } from './laneStreamGate';
import { createDiscoverFeedStore, useDiscoverFeedArrayOf } from './discoverFeedStore';
import { FeedStreamConsumer } from './deltaWire';
import { livePairToCoin, limitDiscoverRows, type LiveNewPair } from './useLiveNewPairs';
import type { MockCoin } from './mockCoins';

interface LiveNewPairsResponse {
  items?: LiveNewPair[];
}

const ALMOST_GRADUATED_SESSION_CACHE_KEY = 'discover:almost-graduated:last-pairs:session:v1';
const ALMOST_GRADUATED_LOCAL_CACHE_KEY = 'discover:almost-graduated:last-pairs:local:v1';
const ALMOST_GRADUATED_CACHE_TTL_MS = 10 * 60_000;
const CACHE_FLUSH_DELAY_MS = 2_000;

// OPEN-but-silent watchdog (mirrors useLiveNewPairs / the trade-page
// stream's staleness check): server keepalive comments keep a dead stream
// OPEN forever and `onerror` never fires for it, so 60s without a parsed
// frame means the stream is genuinely dead — close it, poll once, reconnect.
const STREAM_SILENT_STALE_MS = 60_000;
const STREAM_SILENT_CHECK_MS = 10_000;

/**
 * Dedicated feed store for the "Almost Graduated" row.
 *
 * Kept SEPARATE from the singleton new-pairs `discoverFeedStore` on
 * purpose: this row is sourced from a different endpoint (top
 * non-graduated tokens by bonding progress, ANY age) whose payload
 * includes coins that never appear in the recency-capped new-pairs feed.
 * Sharing the singleton would be wrong in both directions — the
 * new-pairs firehose's `ingest()` drops every key absent from its latest
 * frame (it would evict these coins), and ingesting these coins into it
 * would pollute the New Pairs / Graduated rows. A second store isolates
 * them cleanly; the `DiscoverCoinStoreContext` provider in `DiscoverPage`
 * points the Almost Graduated cards at this store.
 */
export const almostGraduatedFeedStore = createDiscoverFeedStore({ orderFlushMs: 500 });

/**
 * Client boot seed: populate the dedicated row from the last-good render
 * cache as soon as this module loads. This removes the refresh-time mock
 * flash: the row paints with real previously-seen cards while the live SSE
 * opens and sends its authoritative first frame.
 */
if (typeof window !== 'undefined') {
  const cached = readCachedAlmostGraduatedCoins();
  if (cached && cached.length > 0) almostGraduatedFeedStore.replace(cached);
}

/**
 * Drives the dedicated Almost Graduated live feed. Mounted once by
 * `DiscoverPage`. SSE-primary: a single `EventSource` that reconnects on
 * error and, on each frame, diff-merges the full top-N (≤50)
 * real-SOL-ranked, any-age non-graduated listing into
 * `almostGraduatedFeedStore` (with a trailing-throttled browser render-cache
 * write off the hot path). A one-shot GET poll of `/api/discover/almost-
 * graduated` runs once on mount (instant first data if the socket is slow to
 * open) and again whenever the socket drops, so a dropped/lagged stream
 * recovers rows instead of waiting for the next reconnect. The poll is a
 * recovery fallback only — while connected the server pushes every update.
 *
 * Visibility gate (see laneStreamGate.ts): this stream exclusively paints
 * the Almost Graduated row — no alert path (graduation bell, alpha chime,
 * tracked-wallet toasts) and no trade-page consumer reads its store — so
 * when the row is genuinely invisible (`paneHidden`, or the tab itself
 * hidden) the socket closes after a grace window. The store keeps its last
 * rows, so the hidden pane still paints instantly on reveal; the reveal
 * reconnect is immediate and its full frame re-bases the row sub-second.
 */
export function useAlmostGraduatedIngestion(paneHidden = false): void {
  // Bfcache restore bumps the generation, re-running the connect effect
  // (a `pageshow persisted` restore closes the EventSource silently).
  const streamGeneration = useStreamGeneration();
  // Pane visibility reaches the connect effect through refs — re-running the
  // effect on every route toggle would tear down the consumer + socket,
  // exactly the thrash the gate's grace window exists to prevent.
  const paneHiddenRef = useRef(paneHidden);
  const gateRef = useRef<LaneStreamGate | null>(null);
  useEffect(() => {
    paneHiddenRef.current = paneHidden;
    gateRef.current?.update(
      laneStreamVisible(paneHidden, document.visibilityState === 'hidden'),
    );
  }, [paneHidden]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isIngestionApiConfigured()) return;
    // `wire=delta`: full frame on connect, then changed-cards-only deltas
    // (~10-50x less wire than the legacy full-frame-per-tick stream).
    const streamUrl = ingestionApiUrl('/api/discover/almost-graduated/stream?wire=delta');
    if (!streamUrl) return;

    // Defensive effect seed: module-load seed covers normal refreshes, but
    // this handles rare mount ordering / storage availability edge cases.
    if (almostGraduatedFeedStore.getSnapshot().length === 0) {
      const cached = readCachedAlmostGraduatedCoins();
      if (cached && cached.length > 0) almostGraduatedFeedStore.replace(cached);
    }

    let cancelled = false;
    // True while the visibility gate holds the stream closed (row invisible
    // past the grace window). Blocks connect + the reconnect ladder; the
    // gate's open edge clears it and reconnects immediately.
    let gated = false;
    let stream: EventSource | null = null;
    // Wall-clock of the last PARSED frame — the silent-stream watchdog's
    // input (keepalive comments don't parse, so they don't feed it).
    let lastFrameAtMs = Date.now();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cacheFlushHandle: ReturnType<typeof setTimeout> | null = null;

    const flushCache = () => {
      cacheFlushHandle = null;
      writeCachedAlmostGraduatedCoins(almostGraduatedFeedStore.getSnapshot());
    };
    const scheduleCacheFlush = () => {
      if (cacheFlushHandle !== null) return;
      cacheFlushHandle = setTimeout(flushCache, CACHE_FLUSH_DELAY_MS);
    };

    // Frame consumer (see deltaWire.ts): converts only new/changed cards,
    // reuses render-card references for the rest, coalesces same-macrotask
    // bursts to one apply, and stashes in patched-base form while paused.
    let baseRecoveryInFlight = false;

    const applyListing = (next: MockCoin[]) => {
      if (cancelled) return;
      baseRecoveryInFlight = false;
      // This stream is authoritative for the row: if the backend ever has
      // zero non-graduated bonding-progress candidates, clear stale cards
      // instead of preserving the prior frame (unlike new-pairs heartbeats).
      almostGraduatedFeedStore.replace(next);
      if (next.length > 0) scheduleCacheFlush();
    };

    const consumer = new FeedStreamConsumer({
      convert: livePairToCoin,
      apply: applyListing,
      isPaused: isFeedPausedForNavigation,
      // Mid-scroll frames are stashed raw and replayed on resume (see
      // deltaWire.ts) — parse/convert/patch were the 33-50ms scroll slips.
      isScrolling: isFeedScrollActive,
      // Authoritative stream: an empty full frame intentionally clears.
      emptyFullFrames: 'apply',
      // Phase-0 instrumentation tag (no-op unless `listen:feed-perf` is on).
      perfColumn: 'almost-graduated',
      onBaseLost: () => {
        if (baseRecoveryInFlight) return;
        baseRecoveryInFlight = true;
        fallbackPoll();
      },
    });

    // Navigation/modal pause (see feedNavigationPause.ts): frames keep
    // patching the base while paused; the resume flush materializes the
    // latest state once, so the row is instantly current.
    const cancelResume = onFeedResume(() => {
      if (!cancelled) consumer.flushIfDirty();
    });

    // Recovery poll: one-shot GET used on mount and after the socket drops.
    // Only seeds a NON-EMPTY listing so a transient empty/failed poll never
    // clears the last-good cards (unlike the authoritative SSE frame, which
    // may intentionally clear); on outright failure, re-seed from cache.
    function fallbackPoll(): void {
      const url = ingestionApiUrl('/api/discover/almost-graduated');
      if (!url) return;
      // Late-body guard (mirrors useLiveNewPairs): a newer SSE full base
      // landing while this GET is in flight makes the REST result stale —
      // applying it would roll the row back and strand the next delta.
      const baseAtStart = consumer.baseVersion();
      void fetch(url, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: LiveNewPairsResponse | null) => {
          if (cancelled || !data || consumer.baseVersion() !== baseAtStart) return;
          if ((data.items?.length ?? 0) > 0) consumer.seedFull(data.items ?? []);
        })
        .catch(() => {
          if (cancelled) return;
          const cached = readCachedAlmostGraduatedCoins();
          if (cached && cached.length > 0) almostGraduatedFeedStore.replace(cached);
        });
    }

    // Reconnect ≠ polling: this only re-opens the live stream after the
    // socket drops; while connected, the server pushes every update.
    // Exponential backoff (1s → 12s) with the REST fallback only fired on
    // the FIRST error of an outage — a persistent failure previously
    // re-fetched + reconnected every second from every open page, which
    // compounds exactly when the network is already struggling. Jittered
    // (50–100% of nominal): a server restart drops every open page at once,
    // and an unjittered ladder reconnects them in synchronized waves.
    // Mirrors useLiveNewPairs.
    let reconnectAttempts = 0;
    const scheduleReconnect = () => {
      if (cancelled || gated || reconnectTimer) return;
      const nominal = Math.min(1_000 * 2 ** Math.min(reconnectAttempts, 4), 12_000);
      const delay = nominal * (0.5 + Math.random() * 0.5);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled || gated) return;
      stream?.close();
      const next = new EventSource(streamUrl);
      stream = next;
      // Seed the silent-stream watchdog at connect time so a socket that
      // never delivers its first frame is caught too.
      lastFrameAtMs = Date.now();
      // Backoff resets only on a PARSED frame, not on transport `open` —
      // see useLiveNewPairs (an accept-then-die server otherwise pins the
      // ladder at the 1s floor for the whole outage).
      const frameArrived = () => {
        if (stream === next) {
          reconnectAttempts = 0;
          lastFrameAtMs = Date.now();
        }
      };
      next.addEventListener('new-pairs', (event) => {
        if (consumer.consumeFull((event as MessageEvent).data)) frameArrived();
      });
      next.addEventListener('new-pairs-delta', (event) => {
        if (consumer.consumeDelta((event as MessageEvent).data)) frameArrived();
      });
      next.onmessage = (event) => {
        if (consumer.consumeFull(event.data)) frameArrived();
      };
      next.onerror = () => {
        next.close();
        if (stream === next) stream = null;
        if (reconnectAttempts === 0) fallbackPoll();
        scheduleReconnect();
      };
    };

    fallbackPoll();
    connect();

    // Visibility gate: closes the socket after the grace window when the row
    // is invisible (hidden pane or hidden tab) and reconnects the instant it
    // is visible again. The store is never touched on close — the last rows
    // keep painting until the reconnect's full frame re-bases them.
    const gate = createLaneStreamGate({
      onGateClose: () => {
        gated = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        stream?.close();
        stream = null;
      },
      onGateOpen: () => {
        gated = false;
        // Fresh ladder for the reveal reconnect: a pre-hide outage's backoff
        // must not delay the visible board's heal.
        reconnectAttempts = 0;
        connect();
      },
    });
    gateRef.current = gate;
    const onVisibilityChange = () => {
      gate.update(
        laneStreamVisible(paneHiddenRef.current, document.visibilityState === 'hidden'),
      );
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Initial verdict: a visible mount is a no-op (the gate starts open,
    // matching the connect above); a mount while hidden arms the teardown.
    onVisibilityChange();

    // Silent-stream watchdog: close the dead-but-OPEN socket, recover the
    // row with one poll, and hand off to the reconnect ladder (a null
    // stream means the ladder already owns recovery — don't double-fire).
    const silentTimer = setInterval(() => {
      if (cancelled || stream === null) return;
      if (Date.now() - lastFrameAtMs <= STREAM_SILENT_STALE_MS) return;
      stream.close();
      stream = null;
      fallbackPoll();
      scheduleReconnect();
    }, STREAM_SILENT_CHECK_MS);

    return () => {
      cancelled = true;
      cancelResume();
      consumer.dispose();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      gate.dispose();
      if (gateRef.current === gate) gateRef.current = null;
      clearInterval(silentTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (cacheFlushHandle !== null) {
        clearTimeout(cacheFlushHandle);
        flushCache();
      }
      stream?.close();
      stream = null;
    };
  }, [streamGeneration]);
}

/** Ordered Almost Graduated feed (real SOL reserve desc, any age). Stable
 *  reference between frames that change nothing. `dormant` (hidden
 *  persistent pane) makes the subscription a no-op without losing the
 *  current snapshot — see useDiscoverFeedArrayDormant. */
export function useAlmostGraduatedFeed(dormant = false): MockCoin[] {
  return useDiscoverFeedArrayOf(almostGraduatedFeedStore, dormant);
}

function readCachedAlmostGraduatedCoins(): MockCoin[] | null {
  if (typeof window === 'undefined') return null;
  const cached = readCachedAlmostGraduatedCoinsFromStorage(
    () => window.localStorage,
    ALMOST_GRADUATED_LOCAL_CACHE_KEY,
  );
  if (cached) return cached;
  return readCachedAlmostGraduatedCoinsFromStorage(
    () => window.sessionStorage,
    ALMOST_GRADUATED_SESSION_CACHE_KEY,
  );
}

function writeCachedAlmostGraduatedCoins(coins: readonly MockCoin[]): void {
  if (typeof window === 'undefined' || coins.length === 0) return;
  // Cap at the render limit — the cache only boot-seeds the visible row
  // (mirrors the new-pairs cache write).
  const payload = JSON.stringify({
    savedAtMs: Date.now(),
    coins: limitDiscoverRows(coins),
  });
  try {
    window.localStorage.setItem(ALMOST_GRADUATED_LOCAL_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
  try {
    window.sessionStorage.setItem(ALMOST_GRADUATED_SESSION_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
}

function readCachedAlmostGraduatedCoinsFromStorage(
  storageFactory: () => Storage,
  key: string,
): MockCoin[] | null {
  try {
    const storage = storageFactory();
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAtMs?: unknown; coins?: unknown };
    if (
      typeof parsed.savedAtMs !== 'number'
      || Date.now() - parsed.savedAtMs > ALMOST_GRADUATED_CACHE_TTL_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    if (!Array.isArray(parsed.coins)) return null;
    const coins = parsed.coins.filter(isCachedCoin);
    return coins.length > 0 ? coins : null;
  } catch {
    return null;
  }
}

function isCachedCoin(value: unknown): value is MockCoin {
  if (!value || typeof value !== 'object') return false;
  const coin = value as Partial<MockCoin>;
  return typeof coin.id === 'string'
    && typeof coin.ticker === 'string'
    && typeof coin.name === 'string'
    && typeof coin.handle === 'string'
    && typeof coin.imageUrl === 'string'
    && Array.isArray(coin.platforms)
    && typeof coin.ageLabel === 'string'
    && typeof coin.volume === 'string'
    && typeof coin.marketCap === 'string'
    && typeof coin.followers === 'string'
    && typeof coin.txns === 'number';
}

import { useEffect } from 'react';
import { compactAge, compactNumber, compactUsd, compactUsdWhole, normalizeMediaUrl } from '@/lib/format';
import { ingestionApiUrl, ingestionTokenImageUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import { rememberLiveTokenMint } from '@/components/listen/navigation';
import { metricCount, metricTime } from '@/lib/dev/hotPathMetrics';
import { bondingProgressBucket, bondingProgressFromReserves } from './bonding';
import { isFeedPausedForNavigation, isFeedScrollActive, onFeedResume } from './feedNavigationPause';
import { preloadCoinImages } from './imagePreload';
import { FeedStreamConsumer } from './deltaWire';
import { discoverFeedStore } from './discoverFeedStore';
import type { CoinKind, CoinLinks, CoinMode, FeeShareRecipient, MockCoin, Platform } from './mockCoins';

export interface LiveNewPair {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  ageMs: number;
  createdAtMs?: number | null;
  imageUrl: string | null;
  imageSourceUrl?: string | null;
  imageCdnUrl?: string | null;
  imageThumbUrl?: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  txns: number;
  buys: number;
  sells: number;
  volumeUsd: number;
  /** Trailing-24h volume in USD. Null/absent while the backend's 24h window
   *  awaits its cold seed (post-restart / re-stub) — fall back to the 5m
   *  `volumeUsd` rather than render a wrong-low number. */
  vol24hUsd?: number | null;
  /** Derived from canonical bonding-curve reserves, not volume. */
  marketCapUsd: number | null;
  vsr?: string | null;
  vtr?: string | null;
  realSolLamports?: string | null;
  realTokenBaseUnits?: string | null;
  totalSupplyBaseUnits?: string | null;
  lastTradeAtMs?: number | null;
  graduated?: boolean;
  graduatedAtMs?: number | null;
  /** Rich-decoded dev buy amount, in lamports, when available. */
  devBuyLamports?: number | null;
  /** Mutex pump.fun launch-mode flags (at most one is true at a
   *  time; enforced by the smart contract). Surfaced as a single
   *  tinted icon in MetaRow's mode slot. */
  isMayhem?: boolean;
  isCashback?: boolean;
  agentMode?: boolean;
  isCharity?: boolean;
  /** Pair quote mint (base58); absent = SOL pair, USDC mint = USDC pair. */
  quoteMint?: string;
  /** Holder-metrics row (% of total supply, 0-100). Absent until the
   *  engine hydrates the mint (live CREATE or the analytics store backfill). */
  devHoldingsPct?: number | null;
  /** Slot-0 buyers' current holdings (creator excluded). */
  sniperHoldingsPct?: number | null;
  /** Slot +1/+2 buyers' current holdings. */
  bundlerHoldingsPct?: number | null;
  /** Never-bought holders (transferred-in supply), refreshed out-of-band. */
  insiderHoldingsPct?: number | null;
  /** People currently watching this token's trade page (presence overlay).
   *  Absent/null = unknown or zero — never rendered as "0 watching". */
  viewers?: number | null;
  /** Creator fee-sharing config (pfee program). Absent = no sharing
   *  config observed. `feeShareLocked` true = shares permanently set
   *  (one-time update policy) — the card renders the pie badge. */
  feeShareRecipients?: FeeShareRecipient[] | null;
  feeShareLocked?: boolean | null;
  feeShareAuthority?: string | null;
}

interface LiveNewPairsResponse {
  items?: LiveNewPair[];
}

/** Visible rows per Discover lane. The feed frames deliberately carry a
 *  3x-deeper candidate POOL (an internal routine /
 *  `almost_graduated_limit` = 150 server-side, mirrored by the the edge REST
 *  fallbacks' `?limit=`): row filters (min/max mcap, age, launchpads) run
 *  over the full pool BEFORE this cap so a tight filter still fills all 50
 *  slots, and a card that leaves a row is backfilled by a spare instead of
 *  leaving a hole. Render stays at 50 — depth is data, not DOM. */
export const DISCOVER_ROW_RENDER_LIMIT = 50;
// v2/v4: cached rows must carry `quoteMint` (USDC pairs) — older cached
// payloads without it would quick-buy a USDC pair in SOL (typed reject).
// v3/v5: `volume` display string switched from the 5m window to trailing-24h
// — older cached rows would render the stale 5m figure under the new column.
const DISCOVER_SESSION_CACHE_KEY = 'discover:last-live-pairs:v3';
const DISCOVER_LOCAL_CACHE_KEY = 'discover:last-live-pairs:v5';
const DISCOVER_BROWSER_CACHE_TTL_MS = 10 * 60_000;
const METADATA_PENDING_LABEL = 'metadata pending';
const MISSING_TOKEN_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2296%22 height=%2296%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2214%22 fill=%22%2311161f%22/%3E%3Ccircle cx=%2248%22 cy=%2248%22 r=%2223%22 fill=%22none%22 stroke=%22%2338e1ff%22 stroke-opacity=%22.45%22 stroke-width=%222%22/%3E%3Cpath d=%22M48 27v42M27 48h42%22 stroke=%22%2338e1ff%22 stroke-opacity=%22.55%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';

const CACHE_FLUSH_DELAY_MS = 2_000;

// OPEN-but-silent watchdog (mirrors the trade-page stream's staleness
// check): server keepalive comments keep a dead stream OPEN forever, and
// `onerror` never fires for it. Full frames tick ~250ms server-side and
// even ignored-empty frames count as parsed, so 60s of frame silence means
// the stream is genuinely dead — close it, poll once, and reconnect.
const STREAM_SILENT_STALE_MS = 60_000;
const STREAM_SILENT_CHECK_MS = 10_000;

/**
 * Drives the Discover live feed: opens the SSE stream (with poll
 * fallback + reconnect) and diff-merges every snapshot into
 * `discoverFeedStore`. Mounted once by `DiscoverFeedProvider`; returns
 * nothing. Consumers read the feed via `useDiscoverFeed()` (ordered
 * array) or `useDiscoverCoin()` (per-coin), which subscribe to the
 * store at the granularity they need.
 *
 * Two deliberate perf properties vs. the old `useState` feed:
 *   - the store reuses object references for unchanged coins, so only
 *     the cards whose data changed re-render; and
 *   - the localStorage/sessionStorage render cache is flushed off the
 *     hot path on a trailing throttle, never synchronously per message.
 */
export function useDiscoverFeedIngestion(fallback: MockCoin[]): void {
  // Bfcache restore bumps the generation, re-running the connect effect:
  // a `pageshow persisted` restore leaves the EventSource closed but no
  // effect re-runs on its own, so the feed would silently freeze.
  const streamGeneration = useStreamGeneration();
  useEffect(() => {
    // Seed in the effect (client-only, AFTER hydration) so the server's
    // empty feed and the client's first render agree -- seeding during
    // render would read localStorage and mismatch the server HTML
    // (hydration error). Guarded on an empty store so a remount never
    // clobbers already-streaming live data.
    if (discoverFeedStore.getSnapshot().length === 0) {
      const seed = isIngestionApiConfigured() ? readCachedDiscoverCoins() : fallback;
      if (seed && seed.length > 0) discoverFeedStore.ingest(seed);
    }
    if (!isIngestionApiConfigured()) {
      discoverFeedStore.ingest(fallback);
      return;
    }
    let cancelled = false;
    let stream: EventSource | null = null;
    // Wall-clock of the last PARSED frame — the silent-stream watchdog's
    // input (keepalive comments don't parse, so they don't feed it).
    let lastFrameAtMs = Date.now();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cacheFlushHandle: ReturnType<typeof setTimeout> | null = null;
    let pendingHintRows: MockCoin[] | null = null;
    let cancelHintBookkeeping: (() => void) | null = null;

    // Trailing-throttle the render cache write: at most one
    // JSON.stringify + storage write per CACHE_FLUSH_DELAY_MS, off the
    // SSE hot path. Pure display cache, so freshness is unaffected.
    const flushCache = () => {
      cacheFlushHandle = null;
      writeCachedDiscoverCoins(discoverFeedStore.getSnapshot());
    };
    const scheduleCacheFlush = () => {
      if (cacheFlushHandle !== null) return;
      cacheFlushHandle = setTimeout(flushCache, CACHE_FLUSH_DELAY_MS);
    };

    // Token-hint / recent-mint bookkeeping is an OPTIONAL side effect of the
    // feed -- it never gates rendering. Run it off the frame path on idle and
    // coalesce bursts to the latest snapshot (newer rows supersede older ones
    // for the same mints), so a fast stream can't pile up per-frame loops in
    // front of the next paint. Clicked-token handoff stays synchronous in
    // navigateToToken, so deferring this does not slow Discover -> Trade.
    const runHintBookkeeping = () => {
      cancelHintBookkeeping = null;
      const rows = pendingHintRows;
      pendingHintRows = null;
      if (!rows || cancelled) return;
      for (const coin of rows) {
        if (!coin.id) continue;
        const hasResolvedIdentity = coin.name !== METADATA_PENDING_LABEL;
        rememberLiveTokenMint(coin.id, {
          name: hasResolvedIdentity ? coin.name : null,
          symbol: hasResolvedIdentity ? coin.ticker.replace(/^\$/, '') : null,
          imageUrl: coin.imageUrl === MISSING_TOKEN_IMAGE ? null : coin.imageUrl,
          imageFallbackUrl: coin.imageFallbackUrl ?? null,
          twitterUrl: coin.links?.twitter ?? null,
          telegramUrl: coin.links?.telegram ?? null,
          websiteUrl: coin.links?.website ?? null,
          // Pair identity must ride every hint write: hint merging keys
          // identity change on quoteMint too, and a feed write without it
          // would otherwise clobber the click-time hint's USDC marker.
          quoteMint: coin.quoteMint ?? null,
        });
      }
    };
    const scheduleHintBookkeeping = (rows: MockCoin[]) => {
      pendingHintRows = rows;
      if (cancelHintBookkeeping) return; // already scheduled; latest rows win
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(runHintBookkeeping, { timeout: 1_000 });
        cancelHintBookkeeping = () => window.cancelIdleCallback(id);
      } else {
        const id = setTimeout(runHintBookkeeping, 0);
        cancelHintBookkeeping = () => clearTimeout(id);
      }
    };

    // Frame consumer (see deltaWire.ts): converts only new/changed cards,
    // reuses render-card references for the rest, coalesces same-macrotask
    // bursts to one apply, and stashes in patched-base form while paused.
    let baseRecoveryInFlight = false;

    const applyListing = (next: MockCoin[]) => {
      if (cancelled || next.length === 0) return;
      baseRecoveryInFlight = false;
      // RENDER PATH FIRST: push the new snapshot into the store before any
      // bookkeeping so New Pairs paints as soon as the frame arrives.
      const startedAt = performance.now();
      discoverFeedStore.ingest(next);
      scheduleCacheFlush();
      metricCount('frames');
      metricCount('items', next.length);
      metricTime('applyMs', performance.now() - startedAt);
      // Start image fetch+decode for newly seen mints NOW (set-guarded, so
      // repeat frames cost a few lookups) — the artwork races the card mount
      // instead of starting after it.
      preloadCoinImages(next);
      // Optional side effects, deferred off the frame path.
      scheduleHintBookkeeping(next);
    };

    const consumer = new FeedStreamConsumer({
      convert: livePairToCoin,
      apply: applyListing,
      isPaused: isFeedPausedForNavigation,
      // Mid-scroll frames are stashed raw and replayed on resume (see
      // deltaWire.ts) — parse/convert/patch were the 33-50ms scroll slips.
      isScrolling: isFeedScrollActive,
      // Empty full frames are heartbeats here — never blank the hot board.
      emptyFullFrames: 'ignore',
      // Phase-0 instrumentation tag (no-op unless `listen:feed-perf` is on).
      perfColumn: 'new-pairs',
      onBaseLost: () => {
        // Lost/never-had the full-frame base: one recovery poll re-seeds;
        // further unappliable deltas are dropped until it lands (the
        // periodic full anchor is the backstop).
        if (baseRecoveryInFlight) return;
        baseRecoveryInFlight = true;
        fallbackPoll();
      },
    });

    // Navigation/modal pause: frames keep patching the base (cheap, O(changed))
    // while paused; the resume flush materializes the latest state once, so
    // "return to discover is instant and live" holds at stash-free cost.
    const cancelResume = onFeedResume(() => {
      if (!cancelled) consumer.flushIfDirty();
    });

    function fallbackPoll(): void {
      const url = ingestionApiUrl('/api/discover/new-pairs');
      if (!url) {
        if (!cancelled) discoverFeedStore.ingest(fallback);
        return;
      }
      // A recovery GET races the reconnected stream's full frame: if a
      // newer SSE base lands while the body is in flight, the late REST
      // result is stale — applying it would roll the board back and
      // strand the next delta (onBaseLost -> yet another poll).
      const baseAtStart = consumer.baseVersion();
      void fetch(url, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: LiveNewPairsResponse | null) => {
          if (!cancelled && data && consumer.baseVersion() === baseAtStart) {
            consumer.seedFull(data.items ?? []);
          }
        })
        .catch(() => {
          if (cancelled) return;
          // Last-resort cache seed ONLY while no live base was ever
          // established this session: the browser cache can be up to 10
          // minutes old (previous session), and ingesting it over a board
          // already rendered from a real SSE/REST base would roll prices,
          // membership, and graduation flags back until the reconnect's
          // full frame lands. With a base present, keeping the current
          // rows is strictly fresher than the cache.
          if (consumer.hasBase()) return;
          const cached = readCachedDiscoverCoins();
          if (cached) discoverFeedStore.ingest(cached);
        });
    }

    // Exponential backoff (1s → 12s) with the REST fallback only fired on
    // the FIRST error of an outage — a persistent failure previously
    // re-fetched + reconnected every second from every open page, which
    // compounds exactly when the network is already struggling. Jittered
    // (50–100% of nominal): a server restart drops every open page at once,
    // and an unjittered ladder reconnects them in synchronized waves.
    let reconnectAttempts = 0;
    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const nominal = Math.min(1_000 * 2 ** Math.min(reconnectAttempts, 4), 12_000);
      const delay = nominal * (0.5 + Math.random() * 0.5);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      stream?.close();
      // `wire=delta`: full frame on connect, then changed-cards-only deltas
      // (~10-50x less wire than the legacy full-frame-per-tick stream).
      const streamUrl = ingestionApiUrl('/api/discover/new-pairs/stream?wire=delta');
      if (!streamUrl) return;
      const next = new EventSource(streamUrl);
      stream = next;
      // Seed the silent-stream watchdog at connect time so a socket that
      // never delivers its first frame is caught too.
      lastFrameAtMs = Date.now();
      // Backoff resets only on a PARSED frame, not on transport `open`: a
      // server that accepts the socket and then dies (LB up, backend down)
      // used to reset the ladder every attempt and reconnect at the 1s
      // floor for the whole outage.
      const frameArrived = () => {
        if (stream === next) {
          reconnectAttempts = 0;
          lastFrameAtMs = Date.now();
        }
      };
      next.addEventListener('new-pairs', (event) => {
        if (consumer.consumeFull(event.data)) frameArrived();
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

    const newPairsUrl = ingestionApiUrl('/api/discover/new-pairs');
    if (!newPairsUrl) {
      discoverFeedStore.ingest(fallback);
      return;
    }
    void fetch(newPairsUrl, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: LiveNewPairsResponse | null) => {
        // First-paint hedge vs. the SSE connect-time full frame: whichever
        // lands first seeds the base. A REST body resolving AFTER the stream
        // already seeded is stale — applying it would roll the board back
        // and strand the next delta (onBaseLost -> extra recovery poll).
        if (!cancelled && data && !consumer.hasBase()) consumer.seedFull(data.items ?? []);
      })
      .catch(() => undefined);
    connect();

    // Silent-stream watchdog: close the dead-but-OPEN socket, recover the
    // board with one poll, and hand off to the reconnect ladder (a null
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
      clearInterval(silentTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (cacheFlushHandle !== null) clearTimeout(cacheFlushHandle);
      cancelHintBookkeeping?.();
      stream?.close();
      stream = null;
    };
  }, [fallback, streamGeneration]);
}

export function applyFreshDiscoverRows(current: MockCoin[], next: MockCoin[]): MockCoin[] {
  if (next.length === 0) return current;
  // A successful backend envelope is the authority for Discover rows. In
  // particular, do not preserve client-side graduated rows that disappeared
  // from the backend; otherwise a bad graduation can survive DB/cache cleanup.
  return next;
}

export function limitDiscoverRows<T>(rows: readonly T[], limit = DISCOVER_ROW_RENDER_LIMIT): T[] {
  return rows.slice(0, limit);
}

export function compareAlmostGraduatedCoins(a: MockCoin, b: MockCoin): number {
  return (b.realSol ?? Number.NEGATIVE_INFINITY) - (a.realSol ?? Number.NEGATIVE_INFINITY)
    || (b.marketCapUsd ?? Number.NEGATIVE_INFINITY) - (a.marketCapUsd ?? Number.NEGATIVE_INFINITY)
    || (b.lastTradeAtMs ?? 0) - (a.lastTradeAtMs ?? 0)
    || (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)
    || (a.id ?? a.ticker).localeCompare(b.id ?? b.ticker);
}

export function livePairToCoin(pair: LiveNewPair): MockCoin {
  /* [REDACTED FOR EXPORT] The 0-9.9 score blend is proprietary and is replaced here with a
     fixed mid-range placeholder. Layout, the score pill and its colour
     thresholds are unaffected -- only the number itself is not real. */
  const score = clampScore(5);
  const links = linksFor(pair);
  const symbol = pair.symbol.trim();
  const name = pair.name.trim();
  const thumbImageUrl = normalizeMediaUrl(pair.imageThumbUrl ?? null);
  const cdnImageUrl = normalizeMediaUrl(pair.imageCdnUrl ?? null);
  const sourceImageUrl = normalizeMediaUrl(pair.imageSourceUrl ?? pair.imageUrl);
  const proxyImageUrl = ingestionTokenImageUrl(pair.mint);
  /* Display priority: thumb -> cdn -> SOURCE -> placeholder. Measured live:
     for fresh thumb-less mints the raw source (typically ipfs.io) serves in
     16-30ms because the gateway edge is pre-warmed by the whole ecosystem
     within seconds of launch, while our proxy adds 60-100ms of hops — a
     proxy-first experiment regressed exactly the racing case and was
     reverted. The proxy stays as the on-error fallback (handles dead
     gateways/CORS-blocked hosts). When the frame carries NO image url at
     all (metadata still pending), the proxy cannot have a mirror either —
     requesting it just spams a guaranteed 404 into the console and the
     network log for every fresh mint, so those cards go straight to the
     placeholder and upgrade when a later frame delivers real urls. */
  const hasKnownImage =
    thumbImageUrl !== null || cdnImageUrl !== null || sourceImageUrl !== null;
  const displayImageUrl =
    thumbImageUrl ?? cdnImageUrl ?? sourceImageUrl ?? fallbackImage();
  const fallbackImageUrl = hasKnownImage
    ? displayImageUrl !== proxyImageUrl
      ? proxyImageUrl ?? sourceImageUrl ?? null
      : sourceImageUrl
    : null;
  const realSol = realSolFromLamports(pair.realSolLamports);
  const graduated = pair.graduated === true;
  /* A graduated coin is by definition 100% to graduation. Live data
     shows graduated tokens keep their last non-zero curve reserves
     (graduation is detected via CompleteEvent/AMM, not a reserve drain),
     so pin the progress to 100 instead of deriving a misleading partial
     value from those frozen reserves. `bondingProgressBucket(100)`
     floors to the full 8 octants. */
  const bondingProgressPct = graduated
    ? 100
    : bondingProgressFromReserves(pair.realTokenBaseUnits);

  return {
    id: pair.mint,
    creator: pair.creator,
    ticker: symbol ? `$${symbol}` : shortMint(pair.mint),
    name: name || METADATA_PENDING_LABEL,
    handle: links.twitter ? twitterHandle(links.twitter) : shortMint(pair.creator || pair.mint),
    imageUrl: displayImageUrl,
    imageFallbackUrl:
      fallbackImageUrl && fallbackImageUrl !== displayImageUrl ? fallbackImageUrl : null,
    /* The card thumbnail (`imageUrl`) prefers the small `imageThumbUrl`
       for fast list rendering. The hover-zoom preview instead prefers
       the larger CDN/source renditions so a ~192px enlargement is not
       an upscaled thumbnail. Falls back to the thumbnail (via the
       component) when no larger rendition exists. */
    imagePreviewUrl: cdnImageUrl ?? sourceImageUrl ?? null,
    platforms: platforms(pair),
    ageLabel: ageLabel(pair.ageMs),
    ageMs: pair.ageMs,
    createdAtMs: pair.createdAtMs ?? null,
    points: Number(score.toFixed(1)),
    views: compactNumber(Math.max(1, pair.txns * 120)),
    // Display the trailing-24h volume; fall back to the 5m window while the
    // backend's 24h seed is pending (seconds after a restart) or for sources
    // that don't carry it (search hits, pre-migration cold rows).
    /* Whole dollars only ("$83K", "$2K" — "V should never have
       decimals"): the V stat shares one line with TX in the card's
       right column — decimal digits were what forced the column wide
       enough to steal text space from the left. */
    volume: compactUsdWhole(pair.vol24hUsd ?? pair.volumeUsd, '$0'),
    volumeUsd: Number.isFinite(pair.volumeUsd) ? pair.volumeUsd : null,
    volume24hUsd:
      typeof pair.vol24hUsd === 'number' && Number.isFinite(pair.vol24hUsd)
        ? pair.vol24hUsd
        : null,
    marketCap: compactUsd(pair.marketCapUsd, 'new'),
    marketCapUsd: pair.marketCapUsd,
    vsr: pair.vsr ?? null,
    vtr: pair.vtr ?? null,
    realSolLamports: pair.realSolLamports ?? null,
    realTokenBaseUnits: pair.realTokenBaseUnits ?? null,
    totalSupplyBaseUnits: pair.totalSupplyBaseUnits ?? null,
    realSol,
    bondingProgressPct,
    bondingProgressBucket: bondingProgressBucket(bondingProgressPct),
    graduated,
    graduatedAtMs: pair.graduatedAtMs ?? null,
    lastTradeAtMs: pair.lastTradeAtMs ?? null,
    quoteMint: pair.quoteMint ?? null,
    devHoldingsPct: pair.devHoldingsPct ?? null,
    sniperHoldingsPct: pair.sniperHoldingsPct ?? null,
    bundlerHoldingsPct: pair.bundlerHoldingsPct ?? null,
    insiderHoldingsPct: pair.insiderHoldingsPct ?? null,
    viewers: pair.viewers ?? null,
    score: Number(score.toFixed(1)),
    followers: compactNumber(Math.max(1, pair.txns * 18)),
    txns: pair.txns,
    // Real wire counts (row filters range over these; unlike holderCount
    // below they are not synthesized).
    buyTxns: pair.buys,
    sellTxns: pair.sells,
    devBuySol: devBuySol(pair.devBuyLamports),
    holderCount: Math.max(1, pair.buys - pair.sells),
    hasWebsite: Boolean(links.website),
    hasLink: Boolean(links.twitter || links.telegram || links.website),
    hasAgent: Boolean(pair.agentMode),
    feeShareRecipients: pair.feeShareRecipients ?? null,
    feeShareLocked: pair.feeShareLocked ?? null,
    feeShareAuthority: pair.feeShareAuthority ?? null,
    links,
    mode: modeFor(pair),
    /* `kinds` is deprecated (see MockCoin docs) but kept populated
       so older cached payloads and any downstream filter still
       matches during the transition. New rendering reads `mode`. */
    kinds: kindsFor(pair),
  };
}

function readCachedDiscoverCoins(): MockCoin[] | null {
  if (typeof window === 'undefined') return null;
  const cached = readCachedDiscoverCoinsFromStorage(() => window.localStorage, DISCOVER_LOCAL_CACHE_KEY);
  if (cached) return cached;
  return readCachedDiscoverCoinsFromStorage(() => window.sessionStorage, DISCOVER_SESSION_CACHE_KEY);
}

function writeCachedDiscoverCoins(coins: MockCoin[]): void {
  if (typeof window === 'undefined' || coins.length === 0) return;
  // Cap PER BUCKET at the render limit: the cache exists only to boot-seed
  // the visible board, and stringifying the FULL snapshot twice (local +
  // session) every flush was a measurable main-thread block on weak
  // devices. Per-bucket matters: the feed frame is graduated-FIRST and its
  // graduated prefix (up to 2x the 150 pool depth) is far longer than 50,
  // so a head slice of the raw frame cached only graduated rows and the
  // New Pairs lane booted EMPTY until the first live frame.
  const graduated: MockCoin[] = [];
  const active: MockCoin[] = [];
  for (const coin of coins) {
    (coin.graduated ? graduated : active).push(coin);
  }
  const payload = JSON.stringify({
    savedAtMs: Date.now(),
    coins: [...limitDiscoverRows(graduated), ...limitDiscoverRows(active)],
  });
  try {
    window.localStorage.setItem(DISCOVER_LOCAL_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
  try {
    window.sessionStorage.setItem(DISCOVER_SESSION_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
}

function readCachedDiscoverCoinsFromStorage(storageFactory: () => Storage, key: string): MockCoin[] | null {
  try {
    const storage = storageFactory();
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAtMs?: unknown; coins?: unknown };
    if (typeof parsed.savedAtMs !== 'number' || Date.now() - parsed.savedAtMs > DISCOVER_BROWSER_CACHE_TTL_MS) {
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
  return typeof coin.ticker === 'string'
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

function devBuySol(lamports: number | null | undefined): number | null {
  if (typeof lamports !== 'number' || !Number.isFinite(lamports) || lamports <= 0) return null;
  return lamports / 1_000_000_000;
}

function realSolFromLamports(lamports: string | null | undefined): number | null {
  if (!lamports) return null;
  try {
    const raw = BigInt(lamports);
    if (raw < 0n) return null;
    return Number(raw) / 1_000_000_000;
  } catch {
    return null;
  }
}

/* bondingProgressFromReserves / bondingProgressBucket moved to
   `./bonding` so the token search results derive the exact same
   graduation frame (one source of truth). Re-imported above. */

/**
 * Pick the active mutex mode for the card. The contract enforces
 * mutex so in practice at most one flag is true; the priority order
 * below is defensive — if a payload ever carries more than one, we
 * surface the rarer/more-notable mode (mayhem > charity > agent >
 * cashback). Returns `undefined` when no mode flag is set.
 */
function modeFor(pair: LiveNewPair): CoinMode | undefined {
  if (pair.isMayhem) return 'mayhem';
  if (pair.isCharity) return 'charity';
  if (pair.agentMode) return 'agent';
  if (pair.isCashback) return 'cashback';
  return undefined;
}

function kindsFor(pair: LiveNewPair): CoinKind[] {
  const out: CoinKind[] = [];
  if (pair.isMayhem) out.push('mayhem');
  if (pair.agentMode) out.push('agent');
  if (pair.isCashback) out.push('cashback');
  if (pair.isCharity) out.push('charity');
  if (isGithubLink(pair.website)) out.push('github');
  return out;
}

function isGithubLink(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith('github.com');
  } catch {
    return /github\.com/i.test(url);
  }
}

function platforms(pair: LiveNewPair): Platform[] {
  const out: Platform[] = [];
  if (pair.twitter) out.push('x');
  if (pair.website) out.push('yt');
  if (pair.telegram) out.push('cb');
  return out.length > 0 ? out : ['x'];
}

function linksFor(pair: LiveNewPair): CoinLinks {
  return {
    twitter: normalizeSocialUrl(pair.twitter, 'twitter'),
    telegram: normalizeSocialUrl(pair.telegram, 'telegram'),
    website: normalizeExternalUrl(pair.website),
  };
}

function normalizeSocialUrl(raw: string | null, kind: 'twitter' | 'telegram'): string | null {
  const url = normalizeExternalUrl(raw);
  if (url) return url;
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const handle = trimmed
    .replace(/^@/, '')
    .replace(/^twitter\.com\//i, '')
    .replace(/^x\.com\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^telegram\.me\//i, '')
    .split(/[/?#]/, 1)[0]
    ?.trim();
  if (!handle || !/^[A-Za-z0-9_]{1,64}$/.test(handle)) return null;
  return kind === 'twitter' ? `https://x.com/${handle}` : `https://t.me/${handle}`;
}

function normalizeExternalUrl(raw: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function twitterHandle(url: string): string {
  const match = /(?:x\.com|twitter\.com)\/([^/?#]+)/i.exec(url);
  return match?.[1] ? `@${match[1]}` : '@unknown';
}

function shortMint(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function fallbackImage(): string {
  return MISSING_TOKEN_IMAGE;
}

function ageLabel(ms: number): string {
  // Shared single-unit ladder (s/m/h/d/w/y) — same formatter the header
  // bars and token search use, so age labels never disagree per surface.
  return compactAge(ms);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(9.9, value));
}

// Client boot seed: populate the feed store from the render cache the
// moment this module loads -- before any component paints. This makes
// the feed instantly available so consumers (notably the Trade page,
// which reads it to pick the chart's snapshot mode) get the correct
// value on their first render instead of an empty-then-populated flip.
//
// SSR stays correct: this is window-guarded, so the server never seeds,
// and `getServerSnapshot` remains a stable empty array -- the hydration
// render matches the server, and the seeded rows surface in the
// useSyncExternalStore layout-phase reconciliation (before any data
// fetch effect runs), so the Trade page's snapshot query fires once with
// the right key and the chart never flickers to mock candles.
if (typeof window !== 'undefined') {
  const bootCachedCoins = readCachedDiscoverCoins();
  if (bootCachedCoins && bootCachedCoins.length > 0) {
    discoverFeedStore.ingest(bootCachedCoins);
  }
}

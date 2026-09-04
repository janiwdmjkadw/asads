import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import { useViewersStore } from '@/lib/state/viewers-store';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import {
  mergeLiveTrades,
  mergeSnapshotCandleBuckets,
  pruneSnapshotCandleBuckets,
  LIVE_OVERLAY_KEEP_BUCKETS,
} from './liveOverlay';
import { applyHoldersTopDelta } from './holdersTopDelta';
import { mergeLiteSnapshot } from './useTokenSnapshot';
import { normalizeTokenSnapshot, normalizeTokenTrade } from './wire';
import type {
  CandleResolution,
  HolderTopDelta,
  SelectedTokenHeartbeatEvent,
  SelectedTokenHolderVersionEvent,
  SelectedTokenStreamEventName,
  SelectedTokenTradeEvent,
  SnapshotCandle,
  TokenCandlesResponse,
  TokenSnapshot,
  TokenTrade,
} from './types';

const LIVE_TRADE_LIMIT = 250;
// Server heartbeats every 15s; the stale threshold must leave real
// scheduling/network margin (equal values caused false reconnects every
// ~15s on jitter, each costing a bootstrap + broad refetch burst).
const HEARTBEAT_STALE_MS = 40_000;
const STALE_CHECK_MS = 2_500;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;
// Two watermark-forced reconnects inside this window mean ring replay did
// not heal the delivery gap — escalate by dropping the resume cursor so the
// next connection bootstraps fresh (which re-baselines the seq) instead of
// resume-looping forever.
const WATERMARK_RESYNC_WINDOW_MS = 90_000;
// Null-cursor escalation for the watermark check: `delivered === null` makes
// the seq comparison a no-op, and after `resync_required` nulls the cursor
// nothing repopulates it against a server that keeps heartbeating without
// redelivering. Once a socket has proven it sends id-bearing frames, this
// many consecutive seq-bearing heartbeats with a still-null cursor force a
// reconnect (the bootstrap re-baselines the cursor). Sockets that never sent
// an id do NOT escalate — the cache-fallback stream sends no ids (its
// heartbeats also carry no seq), and looping reconnects against it would
// heal nothing.
const NULL_CURSOR_HEARTBEAT_LIMIT = 3;
// Coalesce the holders/top-traders refetch triggered by live trades: a burst of trades
// from other users schedules at most one refetch per window (the backend panel is Redis-
// cached + single-flighted, so this never stampedes the data provider). Gives near-real-time holder /
// leaderboard updates "as others transact" without the panels waiting on their own 10s poll.
const PANEL_REFRESH_DEBOUNCE_MS = 2_500;
// Floor between trade-driven panel refreshes. On a busy mint the 2.5s window
// re-armed continuously, quadrupling every viewer's holders/top-traders
// request rate over the panels' own 10s poll (request volume scaled with
// viewers × trade rate). The first trade after a quiet spell still refreshes
// within the debounce window; sustained tapes coast at the poll cadence.
const PANEL_REFRESH_MIN_INTERVAL_MS = 10_000;
/// Cadence of the session candle reconcile (orphaned provisional buckets are
/// replaced by the server's authoritative series; see `reconcileTimer`).
const CANDLE_RECONCILE_INTERVAL_MS = 30_000;
// Backstop for the per-frame live-trade flush: rAF is suspended in hidden /
// background windows, so a timer races it (whichever fires first flushes and
// cancels the other). ~3 frames keeps the tape visually instant.
const TRADE_FLUSH_FALLBACK_MS = 50;
// `snapshot_lite` freshness window for `liteViaStream`: the server emits at
// least every ~10s for a quiet leased mint (2s coalesced when hot), so 25s
// of silence means the server isn't emitting them (old build / lease drop)
// and the lite REST poll must resume.
const LITE_VIA_STREAM_FRESH_MS = 25_000;
// Margin on the liteViaStream expiry tick so the timeout fires just past the
// freshness boundary (a timer landing a hair early would observe the flag
// still true and schedule nothing further).
const LITE_EXPIRY_TICK_EPSILON_MS = 250;
const CANDLE_RESOLUTIONS: readonly CandleResolution[] = ['1s', '1m', '5m', '15m', '1h'];

// The live SSE snapshot carries fresh market data (reserves / price / volume) but the
// RAW hot identity: a freshly-created or idle-evicted coin has metadata=null /
// metadataReady=false (and can momentarily report graduated=false) in hot state even
// though the REST `/token` response already reconciled those from the DB. Take the live
// market fields from the stream, but never let identity / metadata / graduation regress
// — otherwise the "metadata pending" badge (and full-history hydration) flips back off
// after a good load.
function preferIdentityValue(prev: string, next: string, mint: string): string {
  const nextTrimmed = next?.trim() ?? '';
  if (nextTrimmed && nextTrimmed !== mint) return next;
  return prev || next;
}

/** Exported for the lite-poll merge (useTokenSnapshot) and tests. */
export function mergeStreamSnapshot(
  prev: TokenSnapshot | undefined,
  next: TokenSnapshot,
): TokenSnapshot {
  if (!prev || prev.mint !== next.mint) return next;
  return {
    ...next,
    name: preferIdentityValue(prev.name, next.name, next.mint),
    symbol: preferIdentityValue(prev.symbol, next.symbol, next.mint),
    uri: next.uri?.trim() ? next.uri : prev.uri,
    metadata: next.metadata ?? prev.metadata,
    metadataReady: next.metadataReady || prev.metadataReady,
    // One-way stub latch: the REST body reconciles a hot stub against cold
    // storage (idle-evicted / restart-recreated coins come back as
    // live/backfilled), but stream frames carry the RAW hot kind — a frame
    // must never flip a resolved snapshot back to 'stub' or the "warming
    // up" badge reappears on a fully loaded page. live↔backfilled still
    // follows the newest frame.
    stateKind: next.stateKind === 'stub' && prev.stateKind !== 'stub'
      ? prev.stateKind
      : next.stateKind,
    // The CREATE signature is immutable per mint; hot state loses it on
    // eviction (isStubSnapshot reads '' as "no CREATE landed").
    signature: next.signature || prev.signature,
    graduated: next.graduated || prev.graduated,
    graduatedAtMs: next.graduatedAtMs ?? prev.graduatedAtMs,
    // Per-token constant; carry it across frames defensively so one
    // frame omitting it can't flip a USDC pair back to SOL semantics.
    quoteMint: next.quoteMint ?? prev.quoteMint,
    // A frame with a missing/zero SOL price (ingestion restart, transient Pyth
    // gap) must not poison every USD conversion downstream — candle adapters
    // multiply by `solUsd`, so a zero here repriced the whole live chart to
    // zero for a frame. Carry the last good value instead.
    solUsd: Number.isFinite(next.solUsd) && next.solUsd > 0 ? next.solUsd : prev.solUsd,
  };
}

interface UseSelectedTokenStreamResult {
  liveTrades: TokenTrade[];
  liveCandles: SnapshotCandle[];
  connected: boolean;
  syncing: boolean;
  /** Latest holder-truth version from the stream's `holder_version`
   *  events; null until the server emits one for this mint. Drives
   *  version-keyed panel fetching (no blind interval polling). */
  holderVersion: number | null;
  resyncCount: number;
  /**
   * TRUE while connected AND `snapshot_lite` frames arrived within the last
   * 25s — the stream is carrying the lite scalars, so the 5s lite REST poll
   * can stop (repair-only). FALSE against old servers (no snapshot_lite
   * emits), restoring the interval poll automatically.
   */
  liteViaStream: boolean;
}

export function useSelectedTokenStream(
  mint: string | null | undefined,
  hydrateIdentity: boolean,
  /**
   * Buffer-don't-apply mode for the hidden persistent trade pane: the
   * EventSource STAYS CONNECTED (no reconnect cost on reveal) and the
   * staleness watchdog keeps being fed, but events are not applied to
   * react-query caches or the live overlay while muted. Unmuting
   * invalidates the snapshot + candle queries once, healing anything
   * skipped — the revealed chart is current within one fetch (~50-100ms)
   * with no reconnect blip.
   */
  muted = false,
): UseSelectedTokenStreamResult {
  const queryClient = useQueryClient();
  const [liveTrades, setLiveTrades] = useState<TokenTrade[]>([]);
  const [liveCandles, setLiveCandles] = useState<SnapshotCandle[]>([]);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resyncCount, setResyncCount] = useState(0);
  // Holder-truth version from the stream (stream-v2): panels stop blind
  // interval polling and fetch a version-keyed body only when this bumps.
  // null = server not emitting (old build / stream down) -> hooks fall
  // back to slow polling.
  const [holderVersion, setHolderVersion] = useState<number | null>(null);
  // Wall-clock of the last applied-or-seen `snapshot_lite` frame. State (not
  // a ref) so the arrival itself re-renders consumers and `liteViaStream`
  // recomputes; frames tick at most every ~2s, so this is cheap.
  const [lastLiteEventAt, setLastLiteEventAt] = useState<number | null>(null);
  // Newest applied lite `snapshotTakenAtMs`: replay-ring resumes redeliver
  // old frames, and a stale lite merge must never regress newer state.
  const lastLiteTakenAtRef = useRef<number | null>(null);
  // Last id-bearing SSE cursor ("{epoch}-{seq}"), mirrored to the server
  // as ?resume= on reconnect (EventSource cannot send the Last-Event-ID
  // header on a manually created connection).
  const lastEventIdRef = useRef<string | null>(null);
  const sawHolderVersionRef = useRef(false);
  const [stateMint, setStateMint] = useState<string | null>(mint ?? null);
  const lastMessageRef = useRef<number | null>(null);
  // `hydrateIdentity` only selects which snapshot query key the SSE snapshot event writes
  // to — it must NOT be in the effect's dependency array, or its one-shot flip (when a cold
  // mint's identity resolves: !isKnownMint true→false) would tear down the EventSource,
  // clear the live trade/candle overlay to empty, and reconnect (a visible blip). Reading
  // it from a ref keeps the effect keyed on mint only while still writing to the current
  // key. It stays aligned with `useTokenSnapshot` (both derive from the same `isKnownMint`).
  const hydrateIdentityRef = useRef(hydrateIdentity);
  hydrateIdentityRef.current = hydrateIdentity;
  // Same ref pattern as hydrateIdentity: `muted` must not key the connect
  // effect (tearing down the socket is exactly what muting avoids).
  const mutedRef = useRef(muted);
  // COMMITTED renders only drive the ref (unconditional effect, runs every
  // commit). The old render-phase latch (`if (muted) mutedRef.current =
  // true`) also ran on renders React discarded (App Router navigations are
  // interruptible transitions, and this page re-renders 1-2×/s on stream
  // ticks), latching the ref muted against committed muted=false — every
  // handler then dropped frames forever while `connected` stayed true:
  // frozen tape/chart under a live-looking header until a full refresh.
  // Ordering constraint: this effect is declared BEFORE the heal effect
  // below, so on the unmute commit the ref flip and the heal's overlay
  // clear run back-to-back in the same synchronous effect phase —
  // no queued SSE task can observe unmuted + stale-overlay together. The
  // one-commit window where a frame still applies right at hide time is
  // acceptable (it is just a cache write the reveal heal would redo anyway).
  useEffect(() => {
    mutedRef.current = muted;
  });
  // Bumped once per bfcache restore (`pageshow` with `persisted`): the
  // frozen EventSource is typically CLOSED on restore, so the effect must
  // re-run to reconnect. See lib/state/stream-generation.ts.
  const streamGeneration = useStreamGeneration();

  // Unmute heal: one snapshot + candles refetch covers everything skipped
  // while the hidden pane buffered. Runs outside the connect effect so the
  // socket survives the flip.
  const prevMutedRef = useRef(muted);
  useEffect(() => {
    const wasMuted = prevMutedRef.current;
    prevMutedRef.current = muted;
    // mutedRef itself is synced by the commit-driven effect above, which is
    // declared first and therefore already ran for this commit.
    if (!wasMuted || muted || !mint) return;
    // Drop the candle overlay before the heal refetch: the bucket that was
    // forming at mute time is stale, the chart's merge lets the overlay win
    // on equal bucket keys, and the append-only renderer settles bars
    // write-once — so a stale overlay bucket would settle permanently at its
    // partial value. The refetched canonical series owns every settled
    // bucket; the next 'candles' event (~400ms) resumes the live tip.
    // liveTrades stays: trades are immutable and dedup-merged.
    setLiveCandles([]);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.token.snapshot(mint, false),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.token.snapshot(mint, true),
    });
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'token'
        && query.queryKey[1] === 'candles'
        && query.queryKey[2] === mint,
    });
    // The refetched canonical series may CORRECT bars at/below the settled
    // watermark (everything buffered-and-dropped while hidden), and the
    // append-only renderer settles bars write-once — bump the resync epoch
    // so it rebuilds instead of refusing the repair. This also covers
    // `resync_required` frames, which return early while muted.
    setResyncCount((count) => count + 1);
    // The snapshot tail alone can't repair the tape for graduated/backfilled
    // tokens (TradePage prefers history-trades over it) — without this the
    // interval hidden behind the mute never appears in the trades table.
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'token'
        && query.queryKey[1] === 'history-trades'
        && query.queryKey[2] === mint,
    });
    // holder_version events are DROPPED while muted (only the cursor is
    // recorded), so the latched version here is stale — and a latched
    // version also disables the panels' fallback poll. Reset to null so the
    // heal refetch below runs unversioned and polling resumes until the next
    // live holder_version bump re-latches (same recovery contract as
    // resync_required).
    setHolderVersion(null);
    // The holders/traders/wallet-classes polls pause while the pane is hidden
    // (refetchInterval: false), and a restarted interval waits a full period
    // before its first tick — invalidate here so the revealed panels refresh
    // within one RTT instead of up to 10-30s later.
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'token'
        && (query.queryKey[1] === 'top-holders'
          || query.queryKey[1] === 'top-traders'
          || query.queryKey[1] === 'wallet-classes')
        && query.queryKey[2] === mint,
    });
  }, [muted, mint, queryClient]);

  // `liteViaStream` expiry: freshness is compared at render time, but a
  // heartbeat-only quiet stream produces no renders, so nothing would ever
  // observe the window lapse — the lite poll stayed demoted forever. Arm a
  // timer to the exact expiry that nulls the latch, forcing the render that
  // flips the poll back on. Each fresh frame re-arms it; frames are ≥2s
  // apart, so timer churn is negligible. handleSnapshotLite's dedupe rides
  // `lastLiteTakenAtRef`, so nulling the latch never re-applies old frames.
  useEffect(() => {
    if (lastLiteEventAt == null) return;
    const remainingMs = Math.max(0, LITE_VIA_STREAM_FRESH_MS - (Date.now() - lastLiteEventAt));
    const timer = window.setTimeout(() => setLastLiteEventAt(null), remainingMs);
    return () => window.clearTimeout(timer);
  }, [lastLiteEventAt]);

  useEffect(() => {
    setStateMint(mint ?? null);
    setLiveTrades([]);
    setLiveCandles([]);
    setHolderVersion(null);
    setLastLiteEventAt(null);
    lastLiteTakenAtRef.current = null;
    lastEventIdRef.current = null;
    sawHolderVersionRef.current = false;
    setConnected(false);
    setSyncing(false);
    setResyncCount(0);
    lastMessageRef.current = null;

    if (!mint || !isIngestionApiConfigured()) return;
    const streamUrl = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/stream`);
    if (!streamUrl) return;

    let closed = false;
    let eventSource: EventSource | null = null;
    let retryHandle: number | null = null;
    let retryDelayMs = RETRY_BASE_MS;
    // Gap repair: set on any disconnect (socket error, stale-watchdog or
    // visibility force-reconnect). The ONE invalidation burst per outage
    // fires on the NEXT successful `open` — invalidating at outage start
    // too (the old behavior) doubled the refetch herd against a server
    // that is usually the thing that's down, while the 5s snapshot poll,
    // the panels' 15s fallback and the 30s candle reconcile already bound
    // staleness for the outage window itself.
    let hadDisconnect = false;
    // Last watermark-forced reconnect (see handleHeartbeat) — a repeat
    // inside WATERMARK_RESYNC_WINDOW_MS escalates resume -> bootstrap.
    let lastWatermarkReconnectMs = 0;
    // Per-socket watermark-escalation state (reset on every connect()):
    // whether THIS socket delivered an id-bearing frame, and how many
    // consecutive seq-bearing heartbeats arrived with a null cursor.
    let sawIdFrameOnSocket = false;
    let nullCursorHeartbeats = 0;

    // Ref-only: every SSE frame (trade/snapshot/heartbeat/metadata) lands
    // here ~1-2×/sec, and a state timestamp would re-render the whole
    // TradePage per frame for a value nothing renders. The staleness
    // watchdog below reads the ref; `setSyncing(false)` bails out when
    // already false.
    const markMessage = () => {
      lastMessageRef.current = Date.now();
      setSyncing(false);
    };

    const invalidateSnapshot = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.token.snapshot(mint, false) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.token.snapshot(mint, true) });
    };

    const invalidateMint = () => {
      void queryClient.invalidateQueries({
        predicate: (query) => isMintTokenQuery(query.queryKey, mint),
      });
    };

    // Session reconcile: SSE candle patches are provisional and upsert-only.
    // If the server re-buckets a trade at finalization (rare now that
    // provisional candles are slot-time bucketed, but possible on estimate
    // misses), the session's orphaned bucket has no removal path and renders
    // as a phantom twin until a refetch replaces the series. Periodically
    // re-fetch the candle queries so the server's merged view (which retires
    // provisional buckets correctly) is authoritative for the whole session.
    const reconcileTimer = window.setInterval(() => {
      if (closed || mutedRef.current) return;
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'token'
          && query.queryKey[1] === 'candles'
          && query.queryKey[2] === mint,
      });
    }, CANDLE_RECONCILE_INTERVAL_MS);

    let panelRefreshTimer: number | null = null;
    let lastPanelRefreshAtMs = 0;
    const schedulePanelRefresh = () => {
      // holder_version events are the panels' authoritative trigger once
      // the server emits them (trades change holders -> ledger flush ->
      // version bump); the trade-driven invalidation only backstops
      // servers/mints that never emit versions.
      if (sawHolderVersionRef.current) return;
      if (panelRefreshTimer != null) return;
      // Leading-edge throttle with a coalescing window: the first trade
      // after a quiet spell refreshes within PANEL_REFRESH_DEBOUNCE_MS; a
      // sustained tape re-fires no faster than PANEL_REFRESH_MIN_INTERVAL_MS
      // (the panels' own poll cadence) instead of every 2.5s forever.
      const waitMs = Math.max(
        PANEL_REFRESH_DEBOUNCE_MS,
        lastPanelRefreshAtMs + PANEL_REFRESH_MIN_INTERVAL_MS - Date.now(),
      );
      panelRefreshTimer = window.setTimeout(() => {
        panelRefreshTimer = null;
        lastPanelRefreshAtMs = Date.now();
        void queryClient.invalidateQueries({
          predicate: (query) => isMintPanelQuery(query.queryKey, mint),
        });
      }, waitMs);
    };

    // Per-frame trade coalescing: each SSE message is its own macrotask, so a
    // per-message setLiveTrades re-rendered the whole TradePage per trade
    // during hot-launch bursts (tens/sec). Trades buffer here and flush as ONE
    // mergeLiveTrades batch per frame — same dedupe/sort/cap, ≤1 frame late.
    // A timeout races the rAF (rAF is suspended in background windows); each
    // flush cancels the other so exactly one fires per scheduled batch.
    let pendingTrades: TokenTrade[] = [];
    let tradeFlushFrame: number | null = null;
    let tradeFlushTimer: number | null = null;

    const cancelTradeFlush = () => {
      if (tradeFlushFrame !== null) {
        window.cancelAnimationFrame(tradeFlushFrame);
        tradeFlushFrame = null;
      }
      if (tradeFlushTimer !== null) {
        window.clearTimeout(tradeFlushTimer);
        tradeFlushTimer = null;
      }
    };

    const flushPendingTrades = () => {
      cancelTradeFlush();
      if (pendingTrades.length === 0) return;
      const batch = pendingTrades;
      pendingTrades = [];
      setLiveTrades((current) => mergeLiveTrades(
        current,
        // 1-trade batches (the common case) take mergeLiveTrades' single-trade
        // fast path, which is reserved for this caller's sorted base.
        batch.length === 1 ? batch[0]! : batch,
        LIVE_TRADE_LIMIT,
      ));
    };

    const scheduleTradeFlush = () => {
      if (tradeFlushFrame !== null || tradeFlushTimer !== null) return;
      tradeFlushFrame = window.requestAnimationFrame(() => {
        tradeFlushFrame = null;
        flushPendingTrades();
      });
      tradeFlushTimer = window.setTimeout(() => {
        tradeFlushTimer = null;
        flushPendingTrades();
      }, TRADE_FLUSH_FALLBACK_MS);
    };

    const clearLiveOverlay = () => {
      // A pending flush would resurrect pre-clear trades after a resync
      // emptied the overlay — drop the buffer with the state.
      pendingTrades = [];
      cancelTradeFlush();
      setStateMint(mint ?? null);
      setLiveTrades([]);
      setLiveCandles([]);
    };

    // Cursor discipline (all id-bearing handlers below): the delivered
    // cursor is only recorded AFTER the frame parses and matches this mint.
    // A malformed/foreign frame the client cannot apply must not certify
    // its SSE id as delivered — that would satisfy the heartbeat watermark
    // check and suppress the replay/bootstrap that heals the missed data.
    // Muted panes still record unconditionally: they certify-and-drop by
    // design, and the unmute heal refetches everything skipped.
    const handleSnapshot = (event: Event) => {
      markMessage();
      if (mutedRef.current) {
        recordCursor(event); // hidden pane: feed the watchdog, apply nothing
        return;
      }
      const snapshot = readSnapshotEvent((event as MessageEvent<string>).data);
      if (!snapshot || snapshot.mint !== mint) return;
      recordCursor(event);
      queryClient.setQueryData<TokenSnapshot>(
        queryKeys.token.snapshot(mint, hydrateIdentityRef.current),
        // Prev-side freshness guard (mirrors handleSnapshotLite): the SSE
        // bootstrap snapshot can be a warm-Redis body up to ~15 min old
        // (legitimate under congestion) and must not roll back a fresher
        // REST result. Frames without the field keep applying (old servers).
        (prev) => (typeof snapshot.snapshotTakenAtMs === 'number'
          && prev
          && prev.mint === snapshot.mint
          && prev.snapshotTakenAtMs > snapshot.snapshotTakenAtMs
          ? prev
          : mergeStreamSnapshot(prev, snapshot)),
      );
    };

    // Lite scalar snapshot over the stream (same body as the `?lite=1` REST
    // poll: series keys present but empty). While these arrive the hook
    // reports `liteViaStream` and the 5s lite poll goes repair-only. The
    // merge re-injects the cached series (mergeLiteSnapshot) and skips
    // frames at-or-behind the newest applied `snapshotTakenAtMs` — replay-
    // ring resumes redeliver old frames, which must never regress state.
    const handleSnapshotLite = (event: Event) => {
      markMessage();
      if (mutedRef.current) {
        recordCursor(event); // hidden pane: no lite poll to demote
        return;
      }
      const lite = readSnapshotEvent((event as MessageEvent<string>).data);
      if (!lite || lite.mint !== mint) return;
      recordCursor(event);
      // Any valid frame for this mint proves the server emits them — hold
      // the poll-demotion latch even when the merge below dedupes.
      setLastLiteEventAt(Date.now());
      const takenAt = lite.snapshotTakenAtMs;
      if (typeof takenAt !== 'number') return;
      const lastApplied = lastLiteTakenAtRef.current;
      if (lastApplied != null && takenAt <= lastApplied) return;
      lastLiteTakenAtRef.current = takenAt;
      queryClient.setQueryData<TokenSnapshot>(
        queryKeys.token.snapshot(mint, hydrateIdentityRef.current),
        // The prev-side check covers what the ref can't: a fresh full
        // bootstrap/refetch in the cache followed by a ring-replayed older
        // lite frame must not roll the scalars back.
        (prev) => (prev && prev.mint === lite.mint && prev.snapshotTakenAtMs <= takenAt
          ? mergeLiteSnapshot(prev, lite)
          : prev),
      );
    };

    // CANONICAL-ONLY candle rendering (the "born final" invariant): chart
    // buckets come exclusively from post-finalize 'candles' events, which
    // carry true block-time bucketing — a rendered candle can never change
    // value, never shift to a different second, and no bucket can later be
    // inserted between rendered ones. The canonical feed reaches the client
    // every ~400ms (per finalized slot), so the tip still ticks live.
    //
    // Trade events feed ONLY the tape/header. A client-synthesized per-trade
    // provisional tip was tried (provisionalTip.ts, Jul 9) and REVERTED: its
    // guessed buckets ahead of the canonical watermark rendered as
    // finished-looking bars, and canonical's arrival 0.5-4s later re-formed
    // them — the "candles repaint at finalize" regression, i.e. the
    // wet-paint zone the product decision explicitly rejected. A candle that
    // looks final IS final; only the single newest bar is mutable.
    const handleTrade = (event: Event) => {
      markMessage();
      if (mutedRef.current) {
        recordCursor(event);
        return;
      }
      const payload = readTradeEvent((event as MessageEvent<string>).data);
      if (!payload || payload.mint !== mint) return;
      recordCursor(event);
      setStateMint(mint);
      pendingTrades.push(payload.trade);
      scheduleTradeFlush();
      // A trade by anyone changes balances / the leaderboard, so refresh the holders +
      // top-traders panels promptly (debounced) instead of waiting for their 10s poll.
      schedulePanelRefresh();
      if (typeof payload.graduatedAtMs === 'number') invalidateSnapshot();
    };

    // Post-finalize canonical refresh: the ONLY live source of chart buckets.
    // The server pushes the canonical (block-time) live edge as each slot
    // finalizes (~400ms cadence), so the tip ticks live while every bucket
    // behind the canonical watermark is immutable.
    const handleCandles = (event: Event) => {
      markMessage();
      // Hidden pane: feed the watchdog, apply nothing. The unmute heal
      // clears the overlay and refetches the candle queries, so everything
      // skipped here is healed on reveal.
      if (mutedRef.current) {
        recordCursor(event);
        return;
      }
      const payload = readCandlesEvent((event as MessageEvent<string>).data);
      if (!payload || payload.mint !== mint) return;
      recordCursor(event);
      if (payload.candles.length === 0) return;
      setLiveCandles((current) =>
        pruneSnapshotCandleBuckets(mergeSnapshotCandleBuckets(current, payload.candles)));
      patchCandleQueries(queryClient, mint, payload.candles);
    };

    const handleInvalidateSnapshot = (event: Event) => {
      markMessage();
      // metadata/enrichment/graduation frames are sequenced (id-bearing):
      // record applied ones, or the delivered cursor lags the server's
      // watermark and the heartbeat check below reads phantom loss.
      if (mutedRef.current) {
        recordCursor(event); // unmute invalidates the snapshot anyway
        return;
      }
      const payload = unwrapPayload(parseJson((event as MessageEvent<string>).data));
      if (!isRecord(payload)) return; // malformed: replay must redeliver
      const payloadMint = typeof payload.mint === 'string' ? payload.mint : null;
      if (payloadMint && payloadMint !== mint) return;
      recordCursor(event);
      invalidateSnapshot();
    };

    const handleHeartbeat = (event: Event) => {
      markMessage();
      const heartbeat = readHeartbeatEvent((event as MessageEvent<string>).data);
      if (heartbeat?.mint && heartbeat.mint !== mint) return;
      // Viewers rider: passive 15s heal for the presence chip. External
      // leaf store — no TradePage re-render, applied even while muted so
      // the chip is current the instant the pane is revealed.
      if (typeof heartbeat?.viewers === 'number') {
        useViewersStore.getState().setCount(mint, heartbeat.viewers);
      }
      // Enforce the data watermark: the server writes frames up to `seq`
      // BEFORE this heartbeat on the same ordered stream, so a delivered
      // cursor still behind it means those frames were lost client-side —
      // transport-healthy but data-frozen, invisible to the wall-time
      // staleness watchdog. Reconnect with the resume cursor (ring replay
      // fills the gap); if that provably didn't heal (a second violation
      // inside the window), drop the cursor so the next attempt takes the
      // snapshot bootstrap, which re-baselines the seq.
      if (typeof heartbeat?.seq !== 'number') return;
      const delivered = streamCursorSeq(lastEventIdRef.current);
      if (delivered === null) {
        // Null cursor = the seq comparison below can never fire. That is
        // normal before the (id-bearing) bootstrap lands — but a socket
        // that already delivered ids and STILL has no cursor lost it to
        // `resync_required` with nothing redelivered since. Bounded
        // escalation: reconnect after N consecutive seq-bearing heartbeats
        // (never-id sockets skip this, so no reconnect loop against the
        // cache-fallback stream — see NULL_CURSOR_HEARTBEAT_LIMIT).
        if (!sawIdFrameOnSocket) return;
        nullCursorHeartbeats += 1;
        if (nullCursorHeartbeats < NULL_CURSOR_HEARTBEAT_LIMIT) return;
        forceReconnect();
        return;
      }
      nullCursorHeartbeats = 0;
      if (heartbeat.seq <= delivered) return;
      const nowMs = Date.now();
      if (nowMs - lastWatermarkReconnectMs < WATERMARK_RESYNC_WINDOW_MS) {
        lastEventIdRef.current = null;
      }
      lastWatermarkReconnectMs = nowMs;
      forceReconnect();
    };

    const recordCursor = (event: Event) => {
      const id = (event as MessageEvent<string>).lastEventId;
      if (id) {
        lastEventIdRef.current = id;
        sawIdFrameOnSocket = true;
      }
    };

    const handleHolderVersion = (event: Event) => {
      markMessage();
      if (mutedRef.current) {
        recordCursor(event);
        return;
      }
      const payload = readHolderVersionEvent((event as MessageEvent<string>).data);
      if (!payload) return;
      if (typeof payload.mint === 'string' && payload.mint !== mint) return;
      recordCursor(event);
      if (typeof payload.holderVersion === 'number') {
        // Top-page delta (stream-v2): when the cached page-1 holders body
        // sits on the delta's base version, apply the balance delta in
        // place — the version-keyed `?v=` refetch then skips (see
        // useTopHolders). Applied or not, the version latch below always
        // fires: the top-traders tab and the fallback refetch path ride it.
        if (payload.topDelta && typeof payload.totalHolders === 'number') {
          applyHoldersTopDelta(
            queryClient,
            mint,
            payload.holderVersion,
            payload.totalHolders,
            payload.topDelta,
          );
        }
        sawHolderVersionRef.current = true;
        setHolderVersion(payload.holderVersion);
      }
    };

    const handleViewers = (event: Event) => {
      markMessage();
      recordCursor(event);
      const payload = unwrapPayload(parseJson((event as MessageEvent<string>).data));
      if (!isRecord(payload) || typeof payload.viewers !== 'number') return;
      // External leaf store (activity-count pattern): a count change
      // re-renders only the chips subscribed to this mint, never the page.
      // Deliberately NOT muted-gated — cheap, and a hidden pane's chip is
      // current the moment it is revealed.
      useViewersStore.getState().setCount(mint, payload.viewers);
    };

    const handleResyncRequired = (event: Event) => {
      markMessage();
      if (mutedRef.current) return;
      const payloadMint = eventMint((event as MessageEvent<string>).data);
      if (payloadMint && payloadMint !== mint) return;
      clearLiveOverlay();
      // The replay chain is broken: drop the cursor (resume would lie)
      // and the latched holder version (the fallback poll AND the
      // trade-driven panel backstop must resume until fresh versions
      // prove the stream is delivering again).
      lastEventIdRef.current = null;
      setHolderVersion(null);
      sawHolderVersionRef.current = false;
      setSyncing(true);
      setResyncCount((count) => count + 1);
      invalidateMint();
    };

    // Manual reconnect with exponential backoff (1s → 8s, reset on open),
    // mirroring TradeActivityProvider. The browser's EventSource auto-retry
    // can give up permanently (CLOSED) — e.g. a failed reconnect during a
    // deploy or a bfcache restore — which used to freeze live trades and
    // candles until a full remount.
    const connect = () => {
      if (closed) return;
      // Fresh socket, fresh escalation state: the bootstrap must re-prove
      // id-bearing delivery before the null-cursor escalation can arm.
      sawIdFrameOnSocket = false;
      nullCursorHeartbeats = 0;
      const cursor = lastEventIdRef.current;
      const url = cursor
        ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}resume=${encodeURIComponent(cursor)}`
        : streamUrl;
      const es = new EventSource(url);
      eventSource = es;
      es.addEventListener('open', () => {
        if (closed) return;
        retryDelayMs = RETRY_BASE_MS;
        // Seed the watchdog: the stale check treats a null timestamp as
        // healthy, so an open-but-silent socket (accepted, then never a
        // frame) would otherwise never trip it.
        lastMessageRef.current = Date.now();
        setConnected(true);
        setSyncing(false);
        // The stream is healthy again: re-fetch everything the outage may
        // have swallowed (latest candle pages, trades, snapshot). This is
        // the splice that repairs the missed middle window.
        if (hadDisconnect) {
          hadDisconnect = false;
          // Drop the candle overlays before the repair refetch, mirroring the
          // unmute heal above: the bucket that was forming at outage time is
          // stale, the chart's merge lets the overlay win on equal bucket
          // keys, and the append-only renderer settles bars write-once — so a
          // pre-outage overlay bucket would permanently override its
          // refetched canonical value. liveTrades stays: trades are immutable
          // and dedup-merged. The next 'candles' event resumes the live tip.
          setLiveCandles([]);
          // The refetched series may CORRECT bars at/below the settled
          // watermark (the outage window), and the append-only renderer
          // settles bars write-once — bump the resync epoch so it rebuilds
          // instead of refusing the repair.
          setResyncCount((count) => count + 1);
          invalidateMint();
        }
      });
      es.addEventListener('snapshot', handleSnapshot);
      es.addEventListener('snapshot_lite', handleSnapshotLite);
      es.addEventListener('trade', handleTrade);
      es.addEventListener('candles', handleCandles);
      es.addEventListener('metadata_update', handleInvalidateSnapshot);
      es.addEventListener('enrichment_update', handleInvalidateSnapshot);
      es.addEventListener('graduation', handleInvalidateSnapshot);
      es.addEventListener('heartbeat', handleHeartbeat);
      es.addEventListener('holder_version', handleHolderVersion);
      es.addEventListener('viewers', handleViewers);
      es.addEventListener('resync_required', handleResyncRequired);
      es.onerror = () => {
        if (closed) return;
        hadDisconnect = true;
        // Disconnected: un-latch the holder version so the panels'
        // safety poll resumes until the reconnected stream emits a
        // fresh version (a latched version with a dead stream froze
        // panels until the next holder change). The replacement socket
        // must also re-prove holder_version flow before the trade-driven
        // panel backstop is short-circuited again.
        setHolderVersion(null);
        sawHolderVersionRef.current = false;
        setConnected(false);
        setSyncing(true);
        // No invalidation here: at outage start the server is usually the
        // thing that's down, so this burst mostly failed — and at fleet
        // scale a deploy turned it into 2× the refetch herd. The single
        // repair burst rides the next successful open (hadDisconnect).
        try { es.close(); } catch { /* ignore */ }
        if (eventSource === es) eventSource = null;
        if (retryHandle === null) {
          retryHandle = window.setTimeout(() => {
            retryHandle = null;
            connect();
          }, Math.round(retryDelayMs * (0.5 + Math.random() * 0.5)));
          retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
        }
      };
    };
    connect();

    const forceReconnect = () => {
      if (closed) return;
      // A forced teardown is a disconnect: whatever the dead socket missed
      // must be re-fetched once the replacement opens. Reflect it in state
      // immediately — `connected` gates the lite-poll demotion, so leaving
      // it true would keep the polls demoted against a closed socket until
      // the replacement stream opens (or never, if it can't).
      hadDisconnect = true;
      // Same un-latch as es.onerror: the socket being killed may have
      // stopped emitting holder_version (that can be exactly why the stale
      // watchdog fired), so drop the latched version AND the
      // sawHolderVersion short-circuit — the fast poll cadence and the
      // trade-driven panel backstop resume until the replacement socket
      // proves holder_version flow again.
      setHolderVersion(null);
      sawHolderVersionRef.current = false;
      setConnected(false);
      setSyncing(true);
      try { eventSource?.close(); } catch { /* ignore */ }
      eventSource = null;
      if (retryHandle !== null) {
        window.clearTimeout(retryHandle);
        retryHandle = null;
      }
      retryDelayMs = RETRY_BASE_MS;
      connect();
    };

    // Background tabs throttle timers, so the stale watchdog below may not
    // run while hidden — a laptop waking or a tab un-hiding could sit on a
    // dead/stale socket for seconds before the next interval tick. Heal
    // immediately on visibility restore instead.
    const onVisibilityChange = () => {
      if (closed || document.visibilityState !== 'visible') return;
      const lastMessage = lastMessageRef.current;
      if (lastMessage != null && Date.now() - lastMessage > HEARTBEAT_STALE_MS) {
        // Re-arm the heartbeat window so the watchdog doesn't double-fire.
        lastMessageRef.current = Date.now();
        forceReconnect();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const staleTimer = window.setInterval(() => {
      const lastMessage = lastMessageRef.current;
      if (lastMessage == null || Date.now() - lastMessage <= HEARTBEAT_STALE_MS) {
        return;
      }
      setConnected(false);
      setSyncing(true);
      // Force a reconnect instead of latching stale forever: a silently
      // dead socket (no error event, no frames) never recovers on its
      // own. Re-arm the heartbeat window so a still-dead stream re-forces
      // at the 15s cadence rather than on every 2.5s tick.
      lastMessageRef.current = Date.now();
      forceReconnect();
    }, STALE_CHECK_MS);

    return () => {
      closed = true;
      pendingTrades = [];
      cancelTradeFlush();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(staleTimer);
      window.clearInterval(reconcileTimer);
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      if (panelRefreshTimer != null) window.clearTimeout(panelRefreshTimer);
      eventSource?.close();
    };
    // `hydrateIdentity` is intentionally read from a ref (see `hydrateIdentityRef`), not a
    // dependency: its flip must not reconnect the stream or clear the live overlay.
    // `streamGeneration` bumps once per bfcache restore so the connect re-runs.
  }, [mint, queryClient, streamGeneration]);

  // Expiry tick for `liteViaStream`: the flag is computed at render time, so
  // if snapshot_lite frames STOP while the stream stays connected and nothing
  // else re-renders, expiry would never be observed and the lite poll stayed
  // demoted forever. One timeout, re-armed by each frame's setLastLiteEventAt
  // (the effect re-keys on the new timestamp, clearing the old timer), fires
  // just past the 25s boundary and bumps a render so the flag re-evaluates.
  // No behavior change while frames keep arriving; cleared on unmount / mint
  // change (lastLiteEventAt resets to null) / disconnect.
  const [, setLiteExpiryTick] = useState(0);
  useEffect(() => {
    if (lastLiteEventAt == null || !connected) return undefined;
    const remainingMs = LITE_VIA_STREAM_FRESH_MS
      - (Date.now() - lastLiteEventAt)
      + LITE_EXPIRY_TICK_EPSILON_MS;
    if (remainingMs <= 0) return undefined;
    const handle = window.setTimeout(() => {
      setLiteExpiryTick((tick) => tick + 1);
    }, remainingMs);
    return () => window.clearTimeout(handle);
  }, [lastLiteEventAt, connected]);

  const currentMint = mint ?? null;
  const stateMatchesMint = stateMint === currentMint;

  return {
    liveTrades: stateMatchesMint ? liveTrades : [],
    liveCandles: stateMatchesMint ? liveCandles : [],
    connected: stateMatchesMint && connected,
    syncing: stateMatchesMint && syncing,
    resyncCount: stateMatchesMint ? resyncCount : 0,
    holderVersion: stateMatchesMint ? holderVersion : null,
    // Recomputed on every render; each snapshot_lite arrival re-renders via
    // setLastLiteEventAt, and expiry is observed on the next render (any
    // other stream/poll update) — worst case the poll resumes one render
    // late, never a correctness issue (the poll is redundancy, not truth).
    liteViaStream: stateMatchesMint
      && connected
      && lastLiteEventAt != null
      && Date.now() - lastLiteEventAt < LITE_VIA_STREAM_FRESH_MS,
  };
}

const PATCH_RESOLUTION_SECONDS: Record<CandleResolution, number> = {
  '1s': 1,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
};

function patchCandleQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  mint: string,
  candles: readonly SnapshotCandle[],
): void {
  for (const resolution of CANDLE_RESOLUTIONS) {
    const nextCandles = candles.filter((candle) => candle.resolution === resolution);
    if (nextCandles.length === 0) continue;
    queryClient.setQueryData<TokenCandlesResponse>(
      queryKeys.token.candles(mint, resolution, null),
      (current) => {
        if (!current || current.mint !== mint || current.resolution !== resolution) return current;
        // Live patches own only the recent edge. SSE candles are provisional
        // (arrival-time bucketing); patching a long-closed bucket overwrites
        // its settled canonical value in the cache until the next refetch —
        // session-only chart divergence. Closed history is the server's.
        const newestExisting = current.candles.length > 0
          ? current.candles[current.candles.length - 1]!.bucketStartSec
          : Number.NEGATIVE_INFINITY;
        const newestIncoming = Math.max(
          ...nextCandles.map((candle) => candle.bucketStartSec),
        );
        const horizonSec = Math.max(newestExisting, newestIncoming)
          - (LIVE_OVERLAY_KEEP_BUCKETS - 1) * PATCH_RESOLUTION_SECONDS[resolution];
        const freshCandles = nextCandles.filter(
          (candle) => candle.bucketStartSec >= horizonSec,
        );
        if (freshCandles.length === 0) return current;
        return {
          ...current,
          candles: mergeFreshCandleTail(current.candles, freshCandles, horizonSec),
        };
      },
    );
  }
}

/**
 * Merge live-edge candles into a cached page without re-keying + re-sorting
 * the whole (up to 1500-candle) array per ~400ms 'candles' event. `base` is
 * ascending + deduped (server pages and prior merges both guarantee it) and
 * every fresh candle has `bucketStartSec >= horizonSec`, so buckets below the
 * horizon are disjoint from the merge: reuse that prefix untouched and run
 * the full merge only on the O(keepBuckets) tail slice. Output is identical
 * to `mergeSnapshotCandleBuckets(base, freshCandles)`, including sparse-tail
 * insertions between existing entries. Exported for tests.
 */
export function mergeFreshCandleTail(
  base: readonly SnapshotCandle[],
  freshCandles: readonly SnapshotCandle[],
  horizonSec: number,
): SnapshotCandle[] {
  // Buckets are unique and >= horizonSec spans at most keepBuckets of them,
  // so this backward walk is O(keepBuckets).
  let splitIdx = base.length;
  while (splitIdx > 0 && base[splitIdx - 1]!.bucketStartSec >= horizonSec) splitIdx -= 1;
  return [
    ...base.slice(0, splitIdx),
    ...mergeSnapshotCandleBuckets(base.slice(splitIdx), freshCandles),
  ];
}

function isMintTokenQuery(queryKey: readonly unknown[], mint: string): boolean {
  const root = queryKey[0];
  const scope = queryKey[1];
  const queryMint = queryKey[2];
  return root === 'token'
    && queryMint === mint
    && (
      scope === 'snapshot'
      || scope === 'history-trades'
      || scope === 'candles'
      || scope === 'top-holders'
      || scope === 'top-traders'
    );
}

/// Holders + top-traders panels for `mint` (any page) — the queries refreshed on live
/// trades so the leaderboard / holder list tracks on-chain activity in near-real-time.
function isMintPanelQuery(queryKey: readonly unknown[], mint: string): boolean {
  const root = queryKey[0];
  const scope = queryKey[1];
  const queryMint = queryKey[2];
  return root === 'token'
    && queryMint === mint
    && (scope === 'top-holders' || scope === 'top-traders');
}

function readTradeEvent(rawData: string): SelectedTokenTradeEvent | null {
  const payload = unwrapPayload(parseJson(rawData));
  if (!isRecord(payload)) return null;
  const mint = payload.mint;
  const trade = normalizeTokenTrade(payload.trade);
  const candles = payload.candles;
  if (typeof mint !== 'string' || !trade || !Array.isArray(candles)) return null;
  const parsedCandles = candles.filter(isSnapshotCandle);
  return {
    mint,
    trade,
    candles: parsedCandles,
    graduatedAtMs: optionalNumberOrNull(payload.graduatedAtMs),
  };
}

function readSnapshotEvent(rawData: string): TokenSnapshot | null {
  const payload = unwrapPayload(parseJson(rawData));
  return isTokenSnapshot(payload) ? normalizeTokenSnapshot(payload) : null;
}

interface SelectedTokenCandlesEvent {
  mint: string;
  candles: SnapshotCandle[];
}

/** Post-finalize canonical candle refresh ('candles' SSE event). */
function readCandlesEvent(rawData: string): SelectedTokenCandlesEvent | null {
  const payload = unwrapPayload(parseJson(rawData));
  if (!isRecord(payload)) return null;
  const mint = payload.mint;
  const candles = payload.candles;
  if (typeof mint !== 'string' || !Array.isArray(candles)) return null;
  return { mint, candles: candles.filter(isSnapshotCandle) };
}

function readHeartbeatEvent(rawData: string): SelectedTokenHeartbeatEvent | null {
  const payload = unwrapPayload(parseJson(rawData));
  if (!isRecord(payload)) return null;
  return {
    mint: typeof payload.mint === 'string' ? payload.mint : undefined,
    tsMs: typeof payload.tsMs === 'number' ? payload.tsMs : undefined,
    serverTimeMs: typeof payload.serverTimeMs === 'number' ? payload.serverTimeMs : undefined,
    nowMs: typeof payload.nowMs === 'number' ? payload.nowMs : undefined,
    seq: typeof payload.seq === 'number' ? payload.seq : undefined,
  };
}

function readHolderVersionEvent(rawData: string): SelectedTokenHolderVersionEvent | null {
  const payload = unwrapPayload(parseJson(rawData));
  if (!isRecord(payload)) return null;
  return {
    mint: typeof payload.mint === 'string' ? payload.mint : undefined,
    holderVersion: typeof payload.holderVersion === 'number' ? payload.holderVersion : undefined,
    totalHolders: typeof payload.totalHolders === 'number' ? payload.totalHolders : undefined,
    topDelta: readHolderTopDelta(payload.topDelta),
  };
}

/** Optional top-100 balance delta riding `holder_version` (stream-v2).
 *  Undefined (never a partial value) on any shape violation — a malformed
 *  delta must fall back to the `?v=` refetch, never half-apply. */
function readHolderTopDelta(value: unknown): HolderTopDelta | undefined {
  if (!isRecord(value)) return undefined;
  const { baseVersion, upserts, removes } = value;
  if (typeof baseVersion !== 'number' || !Array.isArray(upserts) || !Array.isArray(removes)) {
    return undefined;
  }
  const rows: HolderTopDelta['upserts'] = [];
  for (const row of upserts) {
    if (
      !isRecord(row)
      || typeof row.owner !== 'string'
      || typeof row.amountBaseUnits !== 'string'
      || typeof row.tokenAccountCount !== 'number'
    ) {
      return undefined;
    }
    rows.push({
      owner: row.owner,
      amountBaseUnits: row.amountBaseUnits,
      tokenAccountCount: row.tokenAccountCount,
    });
  }
  const owners: string[] = [];
  for (const owner of removes) {
    if (typeof owner !== 'string') return undefined;
    owners.push(owner);
  }
  return { baseVersion, upserts: rows, removes: owners };
}

/**
 * Sequence half of a stream cursor ("{epoch}-{seq}"). Null for missing or
 * malformed cursors (never treat garbage as a delivered position). Exported
 * for tests.
 */
export function streamCursorSeq(cursor: string | null): number | null {
  if (!cursor) return null;
  const dash = cursor.indexOf('-');
  if (dash <= 0) return null;
  const raw = cursor.slice(dash + 1);
  if (!raw) return null; // Number('') is 0 — never a delivered position
  const seq = Number(raw);
  return Number.isFinite(seq) && seq >= 0 ? seq : null;
}

function eventMint(rawData: string): string | null {
  const payload = unwrapPayload(parseJson(rawData));
  return isRecord(payload) && typeof payload.mint === 'string' ? payload.mint : null;
}

function parseJson(rawData: string): unknown {
  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    return null;
  }
}

function unwrapPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const event = value.event;
  if (isStreamEventName(event) && 'payload' in value) return value.payload;
  if ('data' in value && isRecord(value.data)) return value.data;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStreamEventName(value: unknown): value is SelectedTokenStreamEventName {
  return typeof value === 'string'
    && (
      value === 'snapshot'
      || value === 'snapshot_lite'
      || value === 'trade'
      || value === 'metadata_update'
      || value === 'enrichment_update'
      || value === 'graduation'
      || value === 'heartbeat'
      || value === 'resync_required'
      || value === 'viewers'
    );
}

function isCandleResolution(value: unknown): value is CandleResolution {
  return typeof value === 'string' && CANDLE_RESOLUTIONS.includes(value as CandleResolution);
}

function isSnapshotCandle(value: unknown): value is SnapshotCandle {
  if (!isRecord(value)) return false;
  return isCandleResolution(value.resolution)
    && typeof value.bucketStartSec === 'number'
    && typeof value.open_num === 'string'
    && typeof value.open_den === 'string'
    && typeof value.high_num === 'string'
    && typeof value.high_den === 'string'
    && typeof value.low_num === 'string'
    && typeof value.low_den === 'string'
    && typeof value.close_num === 'string'
    && typeof value.close_den === 'string'
    && typeof value.volBuyLamports === 'string'
    && typeof value.volSellLamports === 'string'
    && typeof value.trades === 'number';
}

function isTokenSnapshot(value: unknown): value is TokenSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.mint === 'string'
    && typeof value.stateKind === 'string'
    && isRecord(value.candles)
    && Array.isArray(value.recentTrades)
    && typeof value.totalSupplyBaseUnits === 'string'
    && typeof value.solUsd === 'number'
    && typeof value.tradeCount === 'number';
}

function optionalNumberOrNull(value: unknown): number | null | undefined {
  if (typeof value === 'number') return value;
  if (value === null) return null;
  return undefined;
}

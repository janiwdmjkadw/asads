import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { releaseResponseBody } from '@/lib/api/http';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import type { BackfillStatus, TokenSnapshot } from './types';
import { fetchTokenSnapshotResponse } from './tokenSnapshotFetch';
import { mergeStreamSnapshot } from './useSelectedTokenStream';
import { normalizeTokenSnapshot } from './wire';

// While a mint is being continuously polled (5s snapshot cadence), backfill
// requests after the first enqueue downgrade to GET status probes; a re-POST
// only happens after this long without ANY backfill request for the mint.
const BACKFILL_STATUS_PROBE_WINDOW_MS = 15_000;

// Liveness floor for the trades tape while the stream LOOKS healthy: the
// full snapshot poll normally hands the interval to the lite poll, but the
// lite merge deliberately preserves the cached recentTrades and the
// history-trades query has no interval — so a stream that stalls silently
// (connected and heartbeating, not delivering) would leave the tape with
// ZERO independent refresh. A slow full-body reconcile bounds that
// staleness without meaningfully re-adding the load the handoff removed.
const STREAM_HEALTHY_RECONCILE_MS = 45_000;

interface Options {
  backfillMode?: 'auto' | 'disabled';
  autoBackfillDelayMs?: number;
  hydrateIdentity?: boolean;
  /**
   * TRUE while the mint's SSE stream is connected and watermark-fresh.
   * The full-body interval poll is ~95% redundant then (the stream owns
   * trades/candles), so it stops and a lite poll (scalar header stats
   * only, `?lite=1`) takes over at the same cadence. The full query still
   * refetches on mount and on every invalidation (reconnect splice,
   * unmute heal, metadata/graduation events), so first paint and repair
   * paths keep the full body. FALSE restores today's full 5s poll.
   */
  streamHealthy?: boolean;
  /**
   * TRUE while `snapshot_lite` frames are riding the mint's SSE stream
   * (see useSelectedTokenStream.liteViaStream): the lite REST poll below
   * stops ticking entirely — the stream owns the scalars too, and the
   * imperative invalidations (reconnect splice, unmute heal) remain the
   * repair path. FALSE (old servers) keeps the 5s lite poll unchanged.
   */
  liteViaStream?: boolean;
}

interface SnapshotResult {
  snapshot: TokenSnapshot | null;
  loading: boolean;
  error: string | null;
  backfillStatus: BackfillStatus | null;
}

export function useTokenSnapshot(
  mint: string | null,
  intervalMs = 1_000,
  options: Options = {},
): SnapshotResult {
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const firstNotFoundAt = useRef<number | null>(null);
  const lastBackfillRequest = useRef<{ mint: string; at: number } | null>(null);
  const backfillDisabled = options.backfillMode === 'disabled';
  const autoBackfillDelayMs = options.autoBackfillDelayMs ?? 750;
  const hydrateIdentity = options.hydrateIdentity === true;
  const streamHealthy = options.streamHealthy === true;
  const liteViaStream = options.liteViaStream === true;
  const apiConfigured = isIngestionApiConfigured();
  const queryClient = useQueryClient();

  useEffect(() => {
    firstNotFoundAt.current = null;
    setBackfillStatus(null);
  }, [mint, backfillDisabled, hydrateIdentity]);

  const query = useQuery({
    queryKey: queryKeys.token.snapshot(mint, hydrateIdentity),
    enabled: mint != null && apiConfigured,
    // <=0 disables polling (hidden persistent trade pane) without
    // disabling the query itself — cached data keeps rendering. A healthy
    // stream hands the interval to the lite poll below but keeps the slow
    // reconcile cadence as the tape's liveness floor (this query still
    // refetches on mount and invalidations, always full-bodied).
    refetchInterval: intervalMs > 0
      ? (streamHealthy ? STREAM_HEALTHY_RECONCILE_MS : intervalMs)
      : false,
    refetchOnWindowFocus: false,
    retry: false,
    // Keep the last snapshot visible across query-key changes (e.g. the
    // hydrateIdentity flip on a cold load, or token-to-token navigation)
    // so the chart never blanks to mock candles mid-load -- it shows the
    // previous real candles until the next ones arrive.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      if (!mint) return null;
      const response = await fetchTokenSnapshotResponse(mint, hydrateIdentity, signal);
      // Error paths must release the unread body (see releaseResponseBody) —
      // this query polls every second, so pinned bodies compound fast.
      if (!response.ok) releaseResponseBody(response);
      if (response.status === 404) {
        const status = await handleMissingMint({
          mint,
          signal,
          backfillDisabled,
          autoBackfillDelayMs,
          firstNotFoundAt,
          lastBackfillRequest,
        });
        if (!signal.aborted) setBackfillStatus(status);
        if (backfillDisabled || status == null) return null;
        throw new Error(status.status === 'failed' ? 'backfill_failed' : 'backfilling');
      }
      if (!response.ok) throw new Error(`http_${response.status}`);
      const snapshot = normalizeTokenSnapshot(await response.json() as TokenSnapshot);
      firstNotFoundAt.current = null;
      // Fire the backfill enqueue/status calls without awaiting — they only
      // feed the status badge, and awaiting them held the snapshot (and the
      // chart's first candles) hostage for an extra RTT. The abort signal is
      // tied to this query, so a stale/unmounted query never writes state.
      if (!backfillDisabled && snapshot.stateKind === 'stub') {
        void requestBackfill({ mint, signal, lastBackfillRequest }).then((status) => {
          if (!signal.aborted) setBackfillStatus(status);
        });
      } else if (backfillDisabled || snapshot.stateKind !== 'backfilled') {
        setBackfillStatus(null);
      } else {
        void fetchBackfillStatus(mint, signal).then((status) => {
          if (!signal.aborted) setBackfillStatus(status);
        });
      }
      return snapshot;
    },
  });

  // Lite poll: while the stream is healthy, tick the interval with the slim
  // `?lite=1` body (scalar header stats, ~few KB vs the full ~hundreds-KB
  // snapshot) and fold it into the cached full snapshot. Trades/candles keep
  // flowing over SSE; the merged cache never loses its heavy series.
  const litePolling = mint != null && apiConfigured && intervalMs > 0 && streamHealthy;
  useQuery({
    queryKey: queryKeys.token.snapshotLite(mint),
    enabled: litePolling,
    // Stage 5: while snapshot_lite frames ride the stream itself the
    // interval stops (repair-only — invalidation paths refetch the full
    // body); against old servers liteViaStream stays false and the 5s
    // lite poll keeps ticking exactly as before.
    refetchInterval: litePolling && !liteViaStream ? intervalMs : false,
    refetchOnWindowFocus: false,
    retry: false,
    // The merge target (the full snapshot cache) is the real output; this
    // query's own data is disposable.
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!mint) return null;
      const response = await fetchTokenSnapshotResponse(mint, false, signal, true);
      if (!response.ok) {
        releaseResponseBody(response);
        throw new Error(`http_${response.status}`);
      }
      const lite = normalizeTokenSnapshot(await response.json() as TokenSnapshot);
      queryClient.setQueryData<TokenSnapshot>(
        queryKeys.token.snapshot(mint, hydrateIdentity),
        // Freshness guard (mirrors the SSE snapshot_lite merge): a slow
        // lite body resolving after a newer full/stream write must not
        // roll the cached scalars back.
        (prev) => (prev && prev.mint === lite.mint
          && prev.snapshotTakenAtMs <= lite.snapshotTakenAtMs
          ? mergeLiteSnapshot(prev, lite)
          : prev),
      );
      return lite.snapshotTakenAtMs ?? null;
    },
  });

  if (mint == null || !apiConfigured) {
    return { snapshot: null, loading: false, error: null, backfillStatus: null };
  }

  const error = query.error ? toShortReason(query.error) : backfillStatusError(backfillStatus);
  const loading = query.isLoading || (query.data == null && (error == null || error === 'backfilling'));

  return {
    snapshot: query.data ?? null,
    loading,
    error,
    backfillStatus,
  };
}

/**
 * Fold a lite poll body (scalars only — the server strips candles /
 * recentTrades / tradeHistory) into the cached full snapshot: the heavy
 * series stay from the cached body, scalars take the lite values, with the
 * same identity/graduation/solUsd regression guards as the SSE snapshot
 * merge. Exported for tests.
 */
export function mergeLiteSnapshot(prev: TokenSnapshot, lite: TokenSnapshot): TokenSnapshot {
  return mergeStreamSnapshot(prev, {
    ...lite,
    candles: prev.candles,
    recentTrades: prev.recentTrades,
    tradeHistory: prev.tradeHistory,
  });
}

async function handleMissingMint({
  mint,
  signal,
  backfillDisabled,
  autoBackfillDelayMs,
  firstNotFoundAt,
  lastBackfillRequest,
}: {
  mint: string;
  signal: AbortSignal;
  backfillDisabled: boolean;
  autoBackfillDelayMs: number;
  firstNotFoundAt: MutableRefObject<number | null>;
  lastBackfillRequest: MutableRefObject<{ mint: string; at: number } | null>;
}): Promise<BackfillStatus | null> {
  if (backfillDisabled) return null;
  const now = Date.now();
  firstNotFoundAt.current ??= now;
  const elapsed = now - firstNotFoundAt.current;
  if (elapsed < autoBackfillDelayMs) {
    // The snapshot poll ticks at 5s: returning null here and waiting for
    // the next tick would push the first enqueue (and the first possible
    // render) out by a whole poll period. Sleep out the remaining delay
    // inside this queryFn instead so the enqueue fires ~autoBackfillDelayMs
    // after the first 404 regardless of poll cadence.
    await new Promise((resolve) => setTimeout(resolve, autoBackfillDelayMs - elapsed));
    if (signal.aborted) return null;
  }
  return requestBackfill({ mint, signal, lastBackfillRequest });
}

async function requestBackfill({
  mint,
  signal,
  lastBackfillRequest,
}: {
  mint: string;
  signal: AbortSignal;
  lastBackfillRequest: MutableRefObject<{ mint: string; at: number } | null>;
}): Promise<BackfillStatus | null> {
  const now = Date.now();
  const recent = lastBackfillRequest.current;
  // Downgrade to a GET status probe while this mint is being polled
  // continuously (every request refreshes the marker, so any cadence below
  // the window keeps probing). Only a genuinely fresh 404 episode — no
  // request in the last window (user left and came back) — re-POSTs the
  // enqueue. The window must sit ABOVE the 5s snapshot poll cadence or
  // every poll re-enqueues instead of probing.
  const useStatusProbe = recent?.mint === mint && now - recent.at < BACKFILL_STATUS_PROBE_WINDOW_MS;
  // Mark before the request resolves: callers no longer await this, so the
  // next poll must already see the marker or it would double-enqueue.
  lastBackfillRequest.current = { mint, at: now };
  return useStatusProbe
    ? await fetchBackfillStatus(mint, signal)
    : await enqueueBackfill(mint, signal);
}

async function enqueueBackfill(
  mint: string,
  signal: AbortSignal,
): Promise<BackfillStatus | null> {
  try {
    const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/backfill`);
    if (!url) return null;
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      releaseResponseBody(response);
      return null;
    }
    return await response.json() as BackfillStatus;
  } catch {
    return null;
  }
}

async function fetchBackfillStatus(
  mint: string,
  signal: AbortSignal,
): Promise<BackfillStatus | null> {
  try {
    const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/backfill`);
    if (!url) return null;
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      releaseResponseBody(response);
      return null;
    }
    const status = await response.json() as BackfillStatus;
    return status.status === 'idle' ? null : status;
  } catch {
    return null;
  }
}

function backfillStatusError(status: BackfillStatus | null): string | null {
  if (!status) return null;
  if (status.status === 'failed') return 'backfill_failed';
  if (status.status === 'queued' || status.status === 'metadata' || status.status === 'transactions') {
    return 'backfilling';
  }
  return null;
}

function toShortReason(err: Error): string {
  const msg = err.message.slice(0, 64);
  return msg || 'error';
}

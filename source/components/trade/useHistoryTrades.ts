import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchIngestionJson, ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';
import type { TokenTrade } from './types';

// ── trades-load trace ──────────────────────────────────────────────────────
// One-shot, per-mint timing of the transactions table's historical backfill:
// hook enabled → fetch dispatched → response in cache → rows rendered.
// Mirrors the chart-load beacon (`useCandleHistory`) and reuses its telemetry
// endpoint with a `kind: "trades"` discriminator, so real-user table-ready
// times land in the same server log. Steady-state renders only touch refs.
interface TradesLoadTrace {
  key: string;
  t0: number;
  fetchStartAt: number | null;
  dataAt: number | null;
  reported: boolean;
}

function traceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function reportTradesLoad(trace: TradesLoadTrace, mint: string, rows: number): void {
  if (typeof window === 'undefined') return;
  const doneAt = traceNow();
  const since = (from: number | null, to: number | null): number | null =>
    from == null || to == null ? null : Math.round(to - from);
  // Fire-and-forget: sendBeacon never blocks rendering; a string body keeps it
  // a "simple" request (no preflight). Best-effort by design.
  try {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number };
    };
    const url = ingestionApiUrl('/api/telemetry/chart-load');
    if (url && typeof nav.sendBeacon === 'function') {
      nav.sendBeacon(
        url,
        JSON.stringify({
          kind: 'trades',
          mint,
          // Hook enabled → fetch dispatched (query scheduling latency).
          hydrateWaitMs: since(trace.t0, trace.fetchStartAt),
          // Network: fetch dispatched → response parsed into the query cache.
          // Null when the prewarm/query cache already had the page (no fetch).
          fetchMs: since(trace.fetchStartAt, trace.dataAt),
          // Client: response in cache → rows actually rendered in the table.
          renderMs: since(trace.dataAt, doneAt),
          totalMs: since(trace.t0, doneAt),
          fromCache: trace.fetchStartAt == null,
          bars: rows,
          conn: nav.connection?.effectiveType ?? null,
        }),
      );
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

// The trades table only renders for graduated / backfilled coins — the live
// new-pairs path uses the snapshot tail and never calls this hook — and those
// coins' full history can be far older than any rolling window. Request ALL
// history (`sinceMs=0`) so an idle/older graduated coin shows its COMPLETE table
// (and a correct `total` for pagination), not just a recent slice. `0` is a
// constant, so every viewer AND the server-side warmer share ONE cold key: a
// single the analytics store scan, with the rest served from Redis + single-flight.
const ALL_HISTORY_SINCE_MS = 0;
const DEFAULT_PAGE_SIZE = 100;

interface HistoryTradesResponse {
  trades?: TokenTrade[];
  nextCursor?: number | null;
  total?: number;
}

export function useHistoryTrades(
  mint: string | undefined,
  refreshKey: string | null,
  pageSize = DEFAULT_PAGE_SIZE,
  options: { enabled?: boolean } = {},
): {
  trades: TokenTrade[];
  loading: boolean;
  error: string | null;
  total: number | null;
  pageIndex: number;
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextPage: () => void;
  prevPage: () => void;
} {
  const [pageIndex, setPageIndex] = useState(0);
  // Render-phase reset: a mint/pageSize change must page back to 0 in the
  // SAME render — the old post-commit effect reset left one render where the
  // new mint was queried at the previous page index (a wasted fetch).
  const pageResetKey = `${mint ?? ''}:${pageSize}`;
  const pageResetKeyRef = useRef(pageResetKey);
  if (pageResetKeyRef.current !== pageResetKey) {
    pageResetKeyRef.current = pageResetKey;
    if (pageIndex !== 0) setPageIndex(0);
  }
  const enabled = options.enabled !== false && Boolean(mint && refreshKey) && isIngestionApiConfigured();
  const cursor = pageIndex * pageSize;
  const sinceMs = ALL_HISTORY_SINCE_MS;
  // One trace per mint, armed the first render the query is enabled.
  const traceRef = useRef<TradesLoadTrace | null>(null);
  if (enabled && mint && traceRef.current?.key !== mint) {
    traceRef.current = {
      key: mint,
      t0: traceNow(),
      fetchStartAt: null,
      dataAt: null,
      reported: false,
    };
  }
  const query = useQuery({
    queryKey: queryKeys.token.historyTrades(mint ?? null, pageSize, pageIndex, refreshKey),
    enabled,
    refetchOnWindowFocus: false,
    // Keep the previously-loaded page visible across a `refreshKey` change (e.g. a backfill
    // status transition) instead of resetting to `[]` + a loading spinner. Combined with
    // the de-volatilized key in `TradePage`, the full 7-day table never blanks to the
    // snapshot tail while a refresh is in flight — it's stale-while-revalidate.
    // Scoped to the mint (query-key index 2): a token-to-token nav must never
    // paint the previous mint's rows under the new mint.
    placeholderData: keepPreviousDataForMint(mint ?? null, 2),
    queryFn: ({ signal }) => {
      const trace = traceRef.current;
      if (trace && trace.key === mint && cursor === 0 && trace.fetchStartAt == null) {
        trace.fetchStartAt = traceNow();
      }
      return fetchIngestionJson<HistoryTradesResponse>(
        `/api/token/${encodeURIComponent(mint ?? '')}/trades?sinceMs=${sinceMs}&limit=${pageSize}&cursor=${cursor}`,
        { signal },
      );
    },
  });

  const trades = query.data?.trades ?? [];
  const total = query.data?.total ?? null;
  {
    const trace = traceRef.current;
    if (trace && !trace.reported && trace.key === mint && query.data && trace.dataAt == null) {
      trace.dataAt = traceNow();
    }
  }
  const hasFirstPageData = Boolean(query.data) && pageIndex === 0;
  const rowsRendered = trades.length;
  // Post-commit: the first page's rows are now actually rendered — report once.
  useEffect(() => {
    const trace = traceRef.current;
    if (!trace || trace.reported || trace.key !== mint || !hasFirstPageData) return;
    trace.reported = true;
    reportTradesLoad(trace, mint ?? '', rowsRendered);
  }, [mint, hasFirstPageData, rowsRendered]);
  useEffect(() => {
    if (total == null || pageIndex === 0) return;
    const lastPageIndex = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (pageIndex > lastPageIndex) {
      setPageIndex(lastPageIndex);
    }
  }, [pageIndex, pageSize, total]);
  const hasPrev = pageIndex > 0;
  const hasNext = total == null ? trades.length >= pageSize : (pageIndex + 1) * pageSize < total;
  const nextPage = useCallback(() => {
    setPageIndex((current) => current + 1);
  }, []);
  const prevPage = useCallback(() => {
    setPageIndex((current) => Math.max(0, current - 1));
  }, []);

  return {
    trades: enabled ? trades : [],
    loading: enabled && query.isLoading,
    error: enabled && query.error ? toShortReason(query.error) : null,
    total: enabled ? total : null,
    pageIndex,
    pageSize,
    hasNext: enabled && hasNext,
    hasPrev,
    nextPage,
    prevPage,
  };
}

function toShortReason(err: Error): string {
  return err.message.slice(0, 64) || 'error';
}

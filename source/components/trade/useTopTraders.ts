import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchIngestionJson, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';
import type { TokenTopTrader, TokenTopTradersResponse } from './types';

const TRADER_LIMIT = 100;

export function useTopTraders(
  mint: string | undefined,
  page = 1,
  /** FALSE while the persistent trade pane is hidden — pauses the poll
   *  without dropping cached rows (they render instantly on reveal). */
  active = true,
  /** Holder-truth version from the token stream (stream-v2). Non-null =
   *  version-driven fetching: no interval polling at all; a bump refetches
   *  one immutable version-keyed body. Null = stream not emitting (old
   *  server / disconnected) -> slow 15s fallback poll. */
  streamVersion: number | null = null,
): {
  traders: TokenTopTrader[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number | null;
  totalPages: number | null;
} {
  const requestedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const enabled = Boolean(mint) && isIngestionApiConfigured();
  // Latest stream version, readable from the stable queryFn without
  // being part of the query key (versions replace bodies in place).
  const versionRef = useRef<number | null>(streamVersion);
  versionRef.current = streamVersion;
  const query = useQuery({
    queryKey: queryKeys.token.topTraders(mint ?? null, requestedPage),
    enabled,
    // The backend serves watched mints' remaining balances from the live
    // holder ledger (~250ms fresh) behind a 3s response cache, so the
    // client poll IS the visible latency — 5s keeps transferred-out
    // whales demoting in seconds. A hidden pane pauses the poll
    // entirely; `enabled` stays true so the cached leaderboard keeps
    // rendering.
    // Version-driven: the stream's holder_version bump is the PRIMARY
    // recurring trigger; without stream versions, degrade to a 15s poll.
    // Even with a latched version, keep a SLOW safety poll: net-neutral
    // trade bursts change PnL without changing balances (no version
    // fires), and a bump inside the server's 3s aggregate-cache window can
    // latch a stale build. The 60s heal bounds both.
    refetchInterval: active ? (streamVersion === null ? 15_000 : 60_000) : false,
    refetchOnWindowFocus: false,
    // Keep the current leaderboard visible during trade-triggered/background refetches. A
    // slow panel rebuild should update in place when it succeeds, never blank/drop rows.
    // Scoped to the mint (query-key index 2): a token-to-token nav must never
    // paint the previous mint's leaderboard under the new mint.
    placeholderData: keepPreviousDataForMint(mint ?? null, 2),
    // Hard client timeout so a slow/hung cold aggregate can never pin the
    // panel on "loading…" forever — it errors, then the next poll retries.
    queryFn: ({ signal }) => fetchIngestionJson<TokenTopTradersResponse>(
      `/api/token/${encodeURIComponent(mint ?? '')}/top-traders?limit=${TRADER_LIMIT}&page=${requestedPage}${versionRef.current !== null ? `&v=${versionRef.current}` : ''}`,
      { signal, timeoutMs: 15_000 },
    ),
  });

  const queryClient = useQueryClient();
  const refetch = query.refetch;
  // Version bumps already refetched are skipped (a page flip or a reconnect
  // re-delivering the same version must not double-fetch); keyed by mint so
  // a token-to-token nav can never skip a new mint's first bump.
  const lastRefetchedRef = useRef<{ mint: string | undefined; version: number } | null>(null);
  useEffect(() => {
    if (!active || !enabled || streamVersion === null) return;
    const last = lastRefetchedRef.current;
    if (last && last.mint === mint && last.version === streamVersion) return;
    lastRefetchedRef.current = { mint, version: streamVersion };
    // A version bump arriving while the initial version-less fetch is in
    // flight must START the versioned request, never join the stale one.
    // refetch({ cancelRefetch: true }) alone still JOINS a fetch in its
    // initial pending state (observed on TanStack v5.100.9), so cancel the
    // in-flight fetch explicitly first — the queryFn reads versionRef, so
    // the re-issued request always carries the current ?v=.
    const queryKey = queryKeys.token.topTraders(mint ?? null, requestedPage);
    void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
      if (versionRef.current !== streamVersion) return; // superseded by a newer bump
      void refetch({ cancelRefetch: true });
    });
  }, [streamVersion, active, enabled, refetch, queryClient, mint, requestedPage]);

  // Tab re-activation heal: `refetchInterval`'s timer restarts from zero on
  // the false→true flip (react-query never fires immediately on it) and the
  // version effect above only reacts when the version MOVED while hidden —
  // so opening the tab after browsing the coin could show rows up to a full
  // poll period old (15s/60s). Refetch right away when reactivated with
  // data older than 5s (the backend's aggregate-cache window).
  const wasActiveRef = useRef(active);
  const dataUpdatedAt = query.dataUpdatedAt;
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active || wasActive || !enabled) return;
    if (Date.now() - dataUpdatedAt < 5_000) return;
    void refetch();
  }, [active, enabled, refetch, dataUpdatedAt]);

  const total = query.data?.total;
  const totalPages = query.data?.totalPages;
  // Stable identity per fetch result — a fresh `.slice()` every render would
  // defeat the React.memo on the consuming panels.
  const traders = useMemo(
    () => (query.data?.traders ?? []).slice(0, TRADER_LIMIT),
    [query.data],
  );

  return {
    traders,
    loading: enabled && query.isLoading,
    error: query.error ? toShortReason(query.error) : null,
    page: requestedPage,
    pageSize: TRADER_LIMIT,
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
    totalPages: typeof totalPages === 'number' && Number.isFinite(totalPages) ? totalPages : null,
  };
}

function toShortReason(err: Error): string {
  return err.message.slice(0, 64) || 'error';
}

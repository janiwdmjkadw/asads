import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchIngestionJson, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';
import { holdersSyncKey, type HoldersSyncState } from './holdersTopDelta';
import type { TokenHolder, TokenHoldersResponse } from './types';

const HOLDER_LIMIT = 100;

/**
 * Version to latch into the mint's sync record after a REST fetch: the
 * server's top-level `version` echo (the build it ACTUALLY served — newer
 * servers send it, and a `?v=N` request can legally be answered with an
 * older version-less cached body under the build limiter) wins over the
 * REQUESTED `?v=`; absent echo (old servers) keeps the pre-echo behavior
 * of trusting the request. Exported for tests.
 */
export function latchedHolderVersion(
  bodyVersion: number | undefined,
  requestedVersion: number | null,
): number | null {
  return typeof bodyVersion === 'number' && Number.isFinite(bodyVersion)
    ? bodyVersion
    : requestedVersion;
}

export function useTopHolders(
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
  holders: TokenHolder[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number | null;
  totalPages: number | null;
} {
  const requestedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const enabled = Boolean(mint) && isIngestionApiConfigured();
  const queryClient = useQueryClient();
  // Latest stream version, readable from the stable queryFn without
  // being part of the query key (versions replace bodies in place).
  const versionRef = useRef<number | null>(streamVersion);
  versionRef.current = streamVersion;
  const query = useQuery({
    queryKey: queryKeys.token.topHolders(mint ?? null, requestedPage),
    enabled,
    // The backend serves watched mints from the live holder ledger
    // (~250ms fresh) behind a 3s response cache, so the client poll IS
    // the visible latency — 5s keeps transfers/close-outs appearing in
    // seconds while repeated views still collapse onto the cached
    // result. A hidden pane pauses the poll entirely; `enabled` stays
    // true so the cached rows keep rendering.
    // Version-driven: the stream's holder_version bump is the PRIMARY
    // recurring trigger; without stream versions, degrade to a 15s poll.
    // Even with a latched version, keep a SLOW safety poll: a version can
    // go quiet while panel data still drifts (net-neutral trade bursts
    // change PnL without changing balances, so no version fires; and a
    // version bump landing inside the server's 3s aggregate-cache window
    // can latch a stale build). The 60s heal bounds both without
    // meaningfully adding load.
    refetchInterval: active ? (streamVersion === null ? 15_000 : 60_000) : false,
    refetchOnWindowFocus: false,
    // Keep the current rows visible during trade-triggered/background refetches. A slow
    // panel rebuild should update in place when it succeeds, never blank/drop rows mid-view.
    // Scoped to the mint (query-key index 2): a token-to-token nav must never
    // paint the previous mint's holders under the new mint.
    placeholderData: keepPreviousDataForMint(mint ?? null, 2),
    // Hard client timeout so a slow/hung cold aggregate can never pin the
    // panel on "loading…" forever — it errors, then the next poll retries
    // (by which point the backend aggregate is usually cached/warm).
    queryFn: async ({ signal }) => {
      const version = versionRef.current;
      const body = await fetchIngestionJson<TokenHoldersResponse & { version?: number }>(
        `/api/token/${encodeURIComponent(mint ?? '')}/holders?limit=${HOLDER_LIMIT}&page=${requestedPage}${version !== null ? `&v=${version}` : ''}`,
        { signal, timeoutMs: 15_000 },
      );
      // Record what truth the cache now reflects, for the stream's in-place
      // top-delta (holdersTopDelta.ts): balances are at the version the
      // server ACTUALLY served (its `version` echo when present; the
      // requested `?v=` on old servers; null for an unversioned fetch — a
      // delta can never apply on top of that), and enrichment is fresh as
      // of now. Page 1 only — deltas maintain only the top page, so deeper
      // pages must never claim its version.
      if (mint && requestedPage === 1) {
        queryClient.setQueryData<HoldersSyncState>(holdersSyncKey(mint), {
          appliedVersion: latchedHolderVersion(body.version, version),
          enrichedAtMs: Date.now(),
        });
      }
      return body;
    },
  });

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
    // Delta-applied skip (holdersTopDelta.ts): the stream's top-delta
    // already made page-1 balances exact at (or past) this version, and the
    // last REST fetch is recent enough that the enrichment refresh isn't
    // due — the `?v=` refetch would download a body the cache already
    // equals. Page 1 only: deeper pages never receive deltas. The 60s
    // safety poll above still heals enrichment drift regardless.
    if (mint && requestedPage === 1) {
      const sync = queryClient.getQueryData<HoldersSyncState>(holdersSyncKey(mint));
      if (
        sync?.appliedVersion != null
        && sync.appliedVersion >= streamVersion
        && sync.enrichedAtMs != null
        && Date.now() - sync.enrichedAtMs < 15_000
      ) {
        return;
      }
    }
    // A version bump arriving while the initial version-less fetch is in
    // flight must START the versioned request, never join the stale one.
    // refetch({ cancelRefetch: true }) alone still JOINS a fetch in its
    // initial pending state (observed on TanStack v5.100.9), so cancel the
    // in-flight fetch explicitly first — the queryFn reads versionRef, so
    // the re-issued request always carries the current ?v=.
    const queryKey = queryKeys.token.topHolders(mint ?? null, requestedPage);
    void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
      if (versionRef.current !== streamVersion) return; // superseded by a newer bump
      void refetch({ cancelRefetch: true });
    });
  }, [streamVersion, active, enabled, refetch, queryClient, mint, requestedPage]);

  // Tab re-activation heal (mirrors useTopTraders): the interval timer
  // restarts from zero on the false→true flip and the version effect above
  // only reacts when the version MOVED while hidden — refetch right away
  // when reactivated with data older than 5s (the backend's aggregate-cache
  // window). Matters for holder pages 2+ (page 1 has an always-active
  // instance on the page).
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
  const holders = useMemo(
    () => (query.data?.holders ?? []).slice(0, HOLDER_LIMIT),
    [query.data],
  );

  return {
    holders,
    loading: enabled && query.isLoading,
    error: query.error ? toShortReason(query.error) : null,
    page: requestedPage,
    pageSize: HOLDER_LIMIT,
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
    totalPages: typeof totalPages === 'number' && Number.isFinite(totalPages) ? totalPages : null,
  };
}

function toShortReason(err: Error): string {
  return err.message.slice(0, 64) || 'error';
}

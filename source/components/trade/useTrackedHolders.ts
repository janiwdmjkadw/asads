import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchIngestionJson, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import type { TokenHolder, TokenHoldersResponse } from './types';

// TRACKED filter (Holders tab): the holders endpoint serves rank-ordered
// 100-row pages, so "only my tracked wallets" must look across EVERY page —
// a tracked wallet at rank 250 lives on page 3 and would silently vanish if
// only the visible page were filtered. Page 1 rides the always-on
// top-holders query (version-driven, delta-maintained); this hook fans out
// over pages 2..N only while the tracked view is actually on screen,
// sharing the pager's query keys so manual paging and the fan-out fill one
// cache, then folds the pages into a deduped rank-ordered tracked-only list.

const HOLDER_LIMIT = 100;
// The server clamps holder pagination to 50 pages of 100 (PANEL_MAX_PAGE) —
// a tracked wallet below rank 5000 is not addressable on any path.
const MAX_SCAN_PAGES = 50;

const TRACKED_HOLDERS_KEY = 'trade.holders.tracked';

export function readTrackedHoldersPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TRACKED_HOLDERS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeTrackedHoldersPref(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACKED_HOLDERS_KEY, on ? 'true' : 'false');
  } catch {
    // Non-persistent browser contexts still keep the React state.
  }
}

/** Pure fold: rank-ordered pages -> deduped tracked-only rows. Holder churn
 *  between page fetches can repeat an owner across a page boundary; keep the
 *  first (best-ranked) occurrence — the row list keys on owner, so a
 *  duplicate would collide in React reconciliation. */
export function combineTrackedHolders(
  pages: ReadonlyArray<readonly TokenHolder[]>,
  addressSet: ReadonlySet<string>,
): TokenHolder[] {
  const seen = new Set<string>();
  const out: TokenHolder[] = [];
  for (const page of pages) {
    for (const holder of page) {
      if (!addressSet.has(holder.owner) || seen.has(holder.owner)) continue;
      seen.add(holder.owner);
      out.push(holder);
    }
  }
  return out;
}

export interface TrackedHoldersResult {
  holders: TokenHolder[];
  loading: boolean;
  error: string | null;
}

const EMPTY_PAGE: TokenHolder[] = [];

// Module-level (stable identity) so react-query memoizes the combined
// result on query-state changes only — an inline arrow would re-run every
// render and hand back a fresh `pages` array, defeating the identity
// stability TradesTable's memo depends on.
function combineDeepResults(
  results: ReadonlyArray<{
    data: TokenHoldersResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  }>,
): { pages: TokenHolder[][]; loading: boolean; error: Error | null } {
  return {
    pages: results.map((result) => result.data?.holders ?? EMPTY_PAGE),
    loading: results.some((result) => result.isLoading),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

export function useTrackedHolders(
  mint: string | undefined,
  /** FALSE while the tracked view isn't visible — no deep-page fetches;
   *  cached rows still render instantly on re-entry. */
  active: boolean,
  /** The always-on page-1 query result (useTopHolders page 1). */
  page1: {
    holders: TokenHolder[];
    loading: boolean;
    error: string | null;
    totalPages: number | null;
  },
  addressSet: ReadonlySet<string>,
): TrackedHoldersResult {
  const enabled = active && Boolean(mint) && addressSet.size > 0 && isIngestionApiConfigured();
  // totalPages comes from the page-1 response; until it lands there is
  // nothing to fan out over (and on a mint switch it resets via the
  // mint-scoped placeholder, so a stale count can't leak across tokens).
  const pageCount = Math.min(page1.totalPages ?? 1, MAX_SCAN_PAGES);
  const deepPageNumbers = useMemo(() => {
    const pages: number[] = [];
    for (let page = 2; page <= pageCount; page += 1) pages.push(page);
    return pages;
  }, [pageCount]);
  const deep = useQueries({
    queries: deepPageNumbers.map((page) => ({
      queryKey: queryKeys.token.topHolders(mint ?? null, page),
      enabled,
      // Deep pages have no stream-version trigger (top-deltas maintain page
      // 1 only) — a slow poll keeps the scan honest while it's visible.
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        fetchIngestionJson<TokenHoldersResponse>(
          `/api/token/${encodeURIComponent(mint ?? '')}/holders?limit=${HOLDER_LIMIT}&page=${page}`,
          { signal, timeoutMs: 15_000 },
        ),
    })),
    combine: combineDeepResults,
  });
  const holders = useMemo(
    () => combineTrackedHolders([page1.holders, ...deep.pages], addressSet),
    [page1.holders, deep.pages, addressSet],
  );
  return {
    holders,
    // Partial results render as they land; the flag covers any page still
    // on its first fetch (page 1 included).
    loading: page1.loading || (enabled && deep.loading),
    error: page1.error ?? (deep.error ? toShortReason(deep.error) : null),
  };
}

function toShortReason(err: Error): string {
  return err.message.slice(0, 64) || 'error';
}

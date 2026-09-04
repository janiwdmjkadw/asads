import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import type { HolderTopDelta, TokenHolder, TokenHoldersResponse } from './types';

// Client half of the `holder_version` top-delta (stream-v2): the SSE event
// optionally carries a top-100 balance delta against the previously emitted
// version. When the cached page-1 holders body is known to be exactly on
// that base version, the delta is applied in place — balances become exact
// without paying the `?v=` refetch (the largest remaining REST family under
// storm). Enrichment columns are untouched: they stay on the REST cadence
// (see the skip window in useTopHolders).

/** Rows the delta maintains — the REST top page size (page 1 only). */
const TOP_PAGE_LIMIT = 100;
/** Server-side clamp on /holders `totalPages`, mirrored so the envelope a
 *  delta writes agrees with what the next REST fetch would say. */
const MAX_HOLDER_PAGES = 50;

/** Delta-sync state for a mint's page-1 holders cache. */
export interface HoldersSyncState {
  /** Holder version the cached page-1 BALANCES reflect (from a `?v=` fetch
   *  or an applied delta); null after an unversioned fetch — a delta can
   *  never apply on top of unversioned truth. */
  appliedVersion: number | null;
  /** Wall clock of the last REST fetch — the enrichment columns' age (the
   *  delta never refreshes them). */
  enrichedAtMs: number | null;
}

/** React Query data key holding `HoldersSyncState` (setQueryData-only —
 *  no fetcher ever runs under it). */
export function holdersSyncKey(mint: string) {
  return ['token', 'top-holders-sync', mint] as const;
}

/**
 * Apply a `holder_version` top-delta onto the cached page-1 holders body.
 * Returns false (cache untouched) unless the cached page provably sits on
 * the delta's base version — the caller then falls back to the `?v=`
 * refetch, today's behavior.
 */
export function applyHoldersTopDelta(
  queryClient: QueryClient,
  mint: string,
  holderVersion: number,
  totalHolders: number,
  delta: HolderTopDelta,
): boolean {
  const syncKey = holdersSyncKey(mint);
  const sync = queryClient.getQueryData<HoldersSyncState>(syncKey);
  if (sync?.appliedVersion == null || sync.appliedVersion !== delta.baseVersion) return false;
  const pageKey = queryKeys.token.topHolders(mint, 1);
  const page = queryClient.getQueryData<TokenHoldersResponse>(pageKey);
  if (!page) return false;

  const removed = new Set(delta.removes);
  const byOwner = new Map<string, TokenHolder>();
  for (const holder of page.holders) {
    if (!removed.has(holder.owner)) byOwner.set(holder.owner, holder);
  }
  const totalSupply = Number(page.totalSupplyBaseUnits);
  for (const upsert of delta.upserts) {
    // supplyPct from the cached envelope's supply (deliberately not wired
    // on the delta), guarding the zero/garbage-supply divide.
    const supplyPct = Number.isFinite(totalSupply) && totalSupply > 0
      ? (Number(upsert.amountBaseUnits) * 100) / totalSupply
      : 0;
    const existing = byOwner.get(upsert.owner);
    byOwner.set(upsert.owner, existing
      ? {
        // Existing row: balance-truth columns only — enrichment stays
        // whatever the last REST fetch said.
        ...existing,
        amountBaseUnits: upsert.amountBaseUnits,
        supplyPct,
        tokenAccountCount: upsert.tokenAccountCount,
      }
      : {
        // Entrant: REST parity with a stats-less owner (what the server
        // sends when it has a balance but no trade/enrichment rows).
        rank: 0, // re-ranked below
        owner: upsert.owner,
        amountBaseUnits: upsert.amountBaseUnits,
        supplyPct,
        tokenAccountCount: upsert.tokenAccountCount,
        solBalanceLamports: null,
        lastActiveAtMs: null,
        boughtTokenBaseUnits: '0',
        boughtSolLamports: '0',
        avgBuyMarketCapUsd: null,
        soldTokenBaseUnits: '0',
        soldSolLamports: '0',
        avgSellMarketCapUsd: null,
        unrealizedPnlSol: null,
        heldSinceMs: null,
        fundingSource: null,
      });
  }

  // Rank is derived, never wired: amount desc (BigInt — the amounts are
  // u128 strings, Number would tie distinct whales), owner asc tiebreak.
  const holders = [...byOwner.values()]
    .sort((a, b) => {
      const amountA = amountBigInt(a.amountBaseUnits);
      const amountB = amountBigInt(b.amountBaseUnits);
      if (amountA !== amountB) return amountA > amountB ? -1 : 1;
      return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
    })
    .slice(0, TOP_PAGE_LIMIT)
    .map((holder, index) => ({ ...holder, rank: index + 1 }));

  queryClient.setQueryData<TokenHoldersResponse>(pageKey, {
    ...page,
    total: totalHolders,
    totalPages: totalHolders === 0
      ? 0
      : Math.min(Math.ceil(totalHolders / page.limit), MAX_HOLDER_PAGES),
    holders,
  });
  // Balances are exact at `holderVersion` now; the enrichment age is
  // unchanged (the delta never carries those columns).
  queryClient.setQueryData<HoldersSyncState>(syncKey, {
    appliedVersion: holderVersion,
    enrichedAtMs: sync.enrichedAtMs,
  });
  return true;
}

/** Wire values are server-stringified u128s; a malformed one must sort
 *  last, never throw mid-apply. */
function amountBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

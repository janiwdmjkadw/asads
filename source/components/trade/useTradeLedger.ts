'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTradeLedger, type TradeLedgerResult } from '@/lib/api/trade-ledger';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import {
  clearLedgerRetryTimers,
  isReflected,
  mergeLedgerWithPending,
  readCachedLedger,
  registerLedgerRetryTimers,
  sumPendingLedgerFills,
  writeCachedLedger,
} from './ledgerOptimistic';

export interface TradeLedgerView {
  readonly boughtLamports: bigint;
  readonly soldLamports: bigint;
  readonly netTokens: bigint;
}

/**
 * Lifetime cash-flow ledger for `mint`, blended across the selected wallet
 * set (durable across a full sell). Backed by `GET /api/v1/trade/ledger`.
 * Freshness is event-driven: any order event this tab initiates invalidates
 * the query so BOUGHT/SOLD reflect a new fill promptly (no polling); the
 * caller ticks HOLDING/PNL with the live price between refetches.
 *
 * Fill-commit race cover: the server persists fills asynchronously, so the
 * event-driven refetch can land BEFORE the DB commit and briefly serve a
 * stale strip. The SSE fill's exact delta is parked in the trade-activity
 * store (`pendingLedgerFills`) and overlaid here until the server ledger
 * reflects it — the server's post-commit `fill_committed` event triggers
 * the reconciling refetch, with bounded +1.5s/+4s fallback retries when
 * that event never arrives. Display-only: sizing never reads this hook.
 */
export function useTradeLedger(mint: string | null): TradeLedgerView | null {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const walletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  const lastOrderEvent = useTradeActivityStore((s) => s.lastOrderEvent);
  const pendingLedgerFills = useTradeActivityStore((s) => s.pendingLedgerFills);
  const clearPendingLedgerFills = useTradeActivityStore((s) => s.clearPendingLedgerFills);
  const queryClient = useQueryClient();

  // Sorted + deduped so an equal-but-new selection array doesn't re-key.
  const ids = useMemo(
    () => [...new Set(walletAccountIds)].sort(),
    [walletAccountIds],
  );
  const sig = ids.join(',');
  const enabled =
    isLoaded &&
    isSignedIn === true &&
    typeof mint === 'string' &&
    mint.length > 0 &&
    ids.length > 0;

  const viewKey = `${sig}|${mint ?? ''}`;

  const query = useQuery<TradeLedgerResult>({
    queryKey: ['api', 'v1', 'trade', 'ledger', sig, mint],
    queryFn: async ({ signal }) => {
      const result = await fetchTradeLedger(
        { walletAccountIds: ids, mint: mint as string },
        { signal, authToken: await getToken() },
      );
      // Session cache feeds `placeholderData` below so a remount paints
      // the last known strip instantly instead of zeros.
      if (result.kind === 'ok') writeCachedLedger(viewKey, result.ledger);
      return result;
    },
    enabled,
    staleTime: 1_500,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: () => {
      const cached = readCachedLedger(viewKey);
      return cached !== null
        ? ({ kind: 'ok', ledger: cached } satisfies TradeLedgerResult)
        : undefined;
    },
  });

  useEffect(() => {
    if (!enabled || lastOrderEvent === null) return;
    void queryClient.invalidateQueries({
      queryKey: ['api', 'v1', 'trade', 'ledger', sig, mint],
    });
  }, [lastOrderEvent, enabled, sig, mint, queryClient]);

  const data = query.data;
  const serverView = data && data.kind === 'ok' ? data.ledger : null;
  const isPlaceholder = query.isPlaceholderData;

  // Pending fill deltas relevant to THIS wallet set + mint (TTL-bounded).
  const pending = useMemo(
    () => sumPendingLedgerFills(pendingLedgerFills, ids, mint ?? '', Date.now()),
    [pendingLedgerFills, ids, mint],
  );
  const hasPending = pending.keys.length > 0;

  // Baseline: the last REAL server view seen before the first pending fill
  // for this (wallet set, mint). Frozen while fills are pending so a
  // refetch that reflects only some of them can't double-count; nulled on
  // any key change so a wallet switch never inherits another set's view.
  const baselineRef = useRef<{ key: string; view: TradeLedgerView } | null>(null);
  if (baselineRef.current !== null && baselineRef.current.key !== viewKey) {
    baselineRef.current = null;
  }
  useEffect(() => {
    if (!hasPending && serverView !== null && !isPlaceholder) {
      baselineRef.current = { key: viewKey, view: serverView };
    }
  }, [viewKey, serverView, hasPending, isPlaceholder]);

  // Bounded fallback: while fills are pending, retry the refetch at +1.5s
  // and +4s from each fill's arrival in case the server's `fill_committed`
  // event never lands. The module-level dedupe map keeps the TradePanel
  // and InstantTradeBox hook instances from double-scheduling. Declared
  // BEFORE the reconcile effect so a same-commit reconcile cancels the
  // timers this effect just registered.
  useEffect(() => {
    if (!enabled || !hasPending) return;
    const fire = () => {
      void queryClient.invalidateQueries({
        queryKey: ['api', 'v1', 'trade', 'ledger', sig, mint],
      });
    };
    for (const fillKey of pending.keys) {
      const fill = pendingLedgerFills.get(fillKey);
      if (fill !== undefined) registerLedgerRetryTimers(fillKey, fill.receivedAtMs, fire);
    }
  }, [enabled, hasPending, pending, pendingLedgerFills, sig, mint, queryClient]);

  // Reconcile: once a REAL fetch reflects the pending deltas, drop them
  // (and their fallback timers) so the server view leads again.
  useEffect(() => {
    if (!hasPending || isPlaceholder) return;
    const baseline = baselineRef.current?.key === viewKey ? baselineRef.current.view : null;
    if (isReflected(serverView, baseline, pending)) {
      clearLedgerRetryTimers(pending.keys);
      clearPendingLedgerFills(pending.keys);
    }
  }, [hasPending, isPlaceholder, serverView, pending, viewKey, clearPendingLedgerFills]);

  const baseline = baselineRef.current?.key === viewKey ? baselineRef.current.view : null;
  return mergeLedgerWithPending(serverView, baseline, pending);
}

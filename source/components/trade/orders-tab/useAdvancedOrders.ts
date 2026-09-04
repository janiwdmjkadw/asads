'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdvancedOrders,
  type AdvancedOrderChain,
  type AdvancedOrderView,
} from '@/lib/api/advanced-orders';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import { isOpenAdvancedStatus, sortAdvancedOrders } from './format';

/**
 * Orders-tab data source: ALL of the user's advanced (DCA/limit) orders,
 * sorted current-page-mint first, open before terminal, newest first.
 *
 * Freshness model (mirrors the holders/top-traders per-tab gating in
 * TradePage): one fetch on mount gives the tab badge its count, the 5s
 * poll runs ONLY while the Orders tab is the selected table tab, and any
 * SSE event attributed to an `adv-` order (accepted/filled/partial/
 * fill_committed/failed) triggers an immediate refetch via the
 * trade-activity store's `advancedActivityVersion` — so progress bars
 * move the moment an automated suborder fills.
 */

/** Same key family as the provider's invalidation groups. */
/* No session on this build — the token resolves to nothing and the
   fetch takes its own unauthenticated path. */
const ALWAYS_UNAUTHENTICATED = async (): Promise<string | null> => null;

export const ADVANCED_ORDERS_QUERY_KEY = ['api', 'v1', 'trade', 'advanced-orders'] as const;

const ORDERS_POLL_MS = 5_000;

export interface AdvancedOrdersTabState {
  /** Sorted for display (page mint first, terminal last). */
  readonly orders: ReadonlyArray<AdvancedOrderView>;
  /** Open (active + paused) orders — the tab badge count. */
  readonly openCount: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reauth: boolean;
  readonly refetch: () => void;
  /**
   * Merge a server-returned order row (PATCH/cancel response) into the
   * cached list immediately — the optimistic half of "apply, then
   * refetch converges".
   */
  readonly applyServerOrder: (order: AdvancedOrderView) => void;
}

type FetchResult =
  | { kind: 'ok'; orders: ReadonlyArray<AdvancedOrderView> }
  | { kind: 'reauth' };

const EMPTY_ORDERS: AdvancedOrderView[] = [];

export function useAdvancedOrders(
  pageMint: string | null,
  active: boolean,
  options: { readonly chain?: AdvancedOrderChain; readonly enabled?: boolean } = {},
): AdvancedOrdersTabState {
  const getToken = ALWAYS_UNAUTHENTICATED;
  const queryClient = useQueryClient();
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);

  const chain = options.chain ?? 'solana';
  const enabled = options.enabled ?? true;
  const queryKey = useMemo(() => [...ADVANCED_ORDERS_QUERY_KEY, chain] as const, [chain]);
  const query = useQuery<FetchResult>({
    queryKey,
    enabled: isSignedIn === true && enabled,
    refetchInterval: active ? ORDERS_POLL_MS : false,
    refetchOnWindowFocus: false,
    staleTime: 3_000,
    queryFn: async ({ signal }) => {
      const result = await listAdvancedOrders(
        { chain },
        { authToken: await getToken(), signal },
      );
      if (result.kind === 'ok') return { kind: 'ok', orders: result.orders };
      if (result.kind === 'reauth') return { kind: 'reauth' };
      throw new Error(
        result.kind === 'error' ? result.message || result.errorCode : result.reason,
      );
    },
  });

  // SSE-driven refresh: refetch as soon as any adv- suborder event lands,
  // instead of waiting out the 5s poll. Ref-guarded so the mount render
  // (version already > 0 from earlier fills) doesn't double-fetch.
  const advancedActivityVersion = useTradeActivityStore((s) => s.advancedActivityVersion);
  const lastVersionRef = useRef(advancedActivityVersion);
  useEffect(() => {
    if (advancedActivityVersion === lastVersionRef.current) return;
    lastVersionRef.current = advancedActivityVersion;
    void queryClient.invalidateQueries({ queryKey: ADVANCED_ORDERS_QUERY_KEY });
  }, [advancedActivityVersion, queryClient]);

  const rawOrders = query.data?.kind === 'ok' ? query.data.orders : null;
  const orders = useMemo(
    () => (rawOrders ? sortAdvancedOrders(rawOrders, pageMint) : EMPTY_ORDERS),
    [rawOrders, pageMint],
  );
  const openCount = useMemo(
    () => orders.reduce((n, o) => (isOpenAdvancedStatus(o.status) ? n + 1 : n), 0),
    [orders],
  );

  const { refetch: queryRefetch } = query;
  const refetch = useCallback(() => {
    void queryRefetch();
  }, [queryRefetch]);

  // Tab re-activation heal (mirrors useTopHolders/useTopTraders): the 5s
  // interval timer restarts from zero on the false→true flip and
  // react-query never fires eagerly on it — reopening the Orders tab
  // after browsing elsewhere would render the stale list (cancelled/
  // filled orders still showing open) until the next tick. Refetch right
  // away when reactivated with data older than one poll period.
  const wasActiveRef = useRef(active);
  const dataUpdatedAt = query.dataUpdatedAt;
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active || wasActive || isSignedIn !== true || !enabled) return;
    if (Date.now() - dataUpdatedAt < ORDERS_POLL_MS) return;
    void queryRefetch();
  }, [active, enabled, isSignedIn, queryRefetch, dataUpdatedAt]);

  const applyServerOrder = useCallback(
    (order: AdvancedOrderView) => {
      queryClient.setQueryData<FetchResult>(queryKey, (prev) => {
        if (!prev || prev.kind !== 'ok') return prev;
        const exists = prev.orders.some((o) => o.id === order.id);
        return {
          kind: 'ok',
          orders: exists
            ? prev.orders.map((o) => (o.id === order.id ? order : o))
            : [order, ...prev.orders],
        };
      });
    },
    [queryClient, queryKey],
  );

  const loading = isSignedIn === true && enabled && query.isPending;
  const error = query.error ? ((query.error as Error).message ?? 'failed') : null;
  const reauth = query.data?.kind === 'reauth';

  // Identity-stable result object — TradesTable is memoized and TradePage
  // re-renders ~1-2×/sec on stream ticks.
  return useMemo(
    () => ({ orders, openCount, loading, error, reauth, refetch, applyServerOrder }),
    [orders, openCount, loading, error, reauth, refetch, applyServerOrder],
  );
}

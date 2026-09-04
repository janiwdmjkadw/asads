'use client';

/**
 * Data hooks for the conditionals surface.
 *
 * They wrap the shared typed port and NOTHING else: no re-derivation of
 * server state, no second source of truth. Every port call returns a
 * discriminated result, so these hooks resolve to a result too — the
 * error arm is data, not a thrown exception, and each caller renders it
 * with `errorGuidance`.
 *
 * The queries are scoped to their own key space so nothing here can
 * invalidate or re-render the chart/feed/trading queries (04-frontend.md
 * invariant 4).
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { acquireNotificationsStream } from '@/lib/state/notifications-stream';
import {
  fetchConditional,
  fetchConditionalState,
  fetchProposal,
  listConditionals,
  type ConditionalDetail,
  type ConditionalListResponse,
  type ConditionalStateResponse,
  type ProposalDetail,
  type TradeControlResult,
} from '@/lib/conditionals';

/** Own key space — never collides with the live trading/chart queries. */
export const CONDITIONALS_QUERY_KEY = ['trade-control', 'conditionals'] as const;

/**
 * Lifecycle polling — now a BACKSTOP, not the delivery path.
 *
 * `useConditionalEventPush` below invalidates these queries the moment the
 * notification stream reports an event on the plan being watched, so a
 * firing, a fill or a pause lands in well under a second instead of on the
 * next tick. The interval only has to cover the three cases push cannot:
 *
 *   1. a plan the user has MUTED (mode 'off' mints no row, so nothing is
 *      pushed — and "don't tell me" must not mean "and freeze the page");
 *   2. the stream being down;
 *   3. sub-states the lifecycle journal deliberately does not carry
 *      (`trade_executions` dispatched/accepted, which the Transactions tab
 *      shows), because they are bookkeeping rather than news.
 *
 * That is why the live cadence relaxes rather than disappearing: 2 s → 5 s
 * costs an idle watcher nothing perceptible while cutting standing load 2.5x,
 * and the push path makes the watched case FASTER than it has ever been.
 */
const LIST_REFETCH_MS = 30_000;
const STATE_REFETCH_MS = 15_000;
const STATE_REFETCH_LIVE_MS = 5_000;
const LIVE_STATES = new Set(['armed', 'paused', 'expiry_pending', 'cancel_requested']);

export function useConditionalsList(options: { enabled?: boolean; limit?: number } = {}):
  UseQueryResult<TradeControlResult<ConditionalListResponse>> {
  const { enabled = true, limit } = options;
  return useQuery({
    queryKey: [...CONDITIONALS_QUERY_KEY, 'list', limit ?? null],
    queryFn: ({ signal }) => listConditionals(limit === undefined ? {} : { limit }, { signal }),
    enabled,
    refetchInterval: LIST_REFETCH_MS,
    staleTime: 2_000,
  });
}

export function useConditionalDetail(
  conditionalId: string | null,
): UseQueryResult<TradeControlResult<ConditionalDetail>> {
  return useQuery({
    queryKey: [...CONDITIONALS_QUERY_KEY, 'detail', conditionalId],
    queryFn: ({ signal }) => fetchConditional(conditionalId ?? '', { signal }),
    enabled: conditionalId !== null,
    staleTime: 10_000,
  });
}

/**
 * THE PROPOSAL BEHIND THE PLAN — what the detail's card is drawn from.
 *
 * The conditional detail serves the server's RENDERED `view` but not
 * `canonical_payload`, and the card draws the stored IR: only the envelope
 * carries the condition tree, and a card without it degrades to prose. The
 * proposal route serves it, and `ConditionalDetail.proposal_id` names the
 * revision that is currently authorized — so this is one extra read of a
 * row that is IMMUTABLE by construction (an edit mints a new proposal),
 * which is why it never polls and caches for an hour.
 */
export function useConditionalProposal(
  proposalId: string | null,
): UseQueryResult<TradeControlResult<ProposalDetail>> {
  return useQuery({
    queryKey: [...CONDITIONALS_QUERY_KEY, 'proposal', proposalId],
    queryFn: ({ signal }) => fetchProposal(proposalId ?? '', { signal }),
    enabled: proposalId !== null,
    staleTime: 3_600_000,
  });
}

/**
 * Lifecycle + DAG detail. Polls while a conditional is open because the
 * timeline is the surface users watch a firing land on; `detail` may
 * degrade on any tick without affecting the lifecycle half.
 */
export function useConditionalState(
  conditionalId: string | null,
): UseQueryResult<TradeControlResult<ConditionalStateResponse>> {
  return useQuery({
    queryKey: [...CONDITIONALS_QUERY_KEY, 'state', conditionalId],
    queryFn: ({ signal }) => fetchConditionalState(conditionalId ?? '', { signal }),
    enabled: conditionalId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      const state = data !== undefined && data.ok ? (data.value.effective_state ?? data.value.state) : null;
      return state !== null && LIVE_STATES.has(state) ? STATE_REFETCH_LIVE_MS : STATE_REFETCH_MS;
    },
    staleTime: 1_000,
  });
}

/**
 * PUSH → INVALIDATE. Subscribe to the shared notification stream and refresh
 * this plan's lifecycle the instant one of its events lands.
 *
 * Scoped to ONE conditional on purpose: the stream carries everything the
 * signed-in user is told about, and a frame for another plan must not
 * re-fetch this page's `/state` (a user with forty live plans would
 * otherwise refetch on every one of them).
 *
 * The stream is shared and ref-counted, so mounting this costs no extra
 * socket — it joins the connection the bell already holds.
 */
export function useConditionalEventPush(conditionalId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (conditionalId === null) return;
    let timer: number | null = null;
    // Coalesce: a settle writes several rows in the same beat, and each one
    // must not cost its own round trip.
    const refreshSoon = (): void => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({
          queryKey: [...CONDITIONALS_QUERY_KEY, 'state', conditionalId],
        });
        void queryClient.invalidateQueries({
          queryKey: [...CONDITIONALS_QUERY_KEY, 'detail', conditionalId],
        });
      }, 150);
    };
    const release = acquireNotificationsStream({
      onNotification: (frame) => {
        if (frame.metadata['conditional_id'] === conditionalId) refreshSoon();
      },
      // A reconnect may have missed events entirely — catch up once.
      onConnect: refreshSoon,
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      release();
    };
  }, [conditionalId, queryClient]);
}

/**
 * The list's twin: any event on ANY of the user's plans refreshes the ledger.
 * Cheap because the ledger is one page of rows, and it is what makes a fill
 * show up on `/conditionals` without waiting out the interval.
 */
export function useConditionalsListPush(enabled = true): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const refreshSoon = (): void => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: [...CONDITIONALS_QUERY_KEY, 'list'] });
      }, 250);
    };
    const release = acquireNotificationsStream({
      onNotification: (frame) => {
        if (typeof frame.metadata['conditional_id'] === 'string') refreshSoon();
      },
      onConnect: refreshSoon,
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      release();
    };
  }, [enabled, queryClient]);
}

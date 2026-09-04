'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import { stampConfirmCommit } from '@/lib/telemetry/tradeTiming';

// useLayoutEffect warns during SSR; this component only measures in the
// browser, so the server fallback is inert.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * E2E trade-latency probe: captures the "React state committed" +
 * "confirmation painted" stamps of the waterfall.
 *
 * Subscribes to the trade-activity store's `lastOrderEvent` — the exact
 * state write `applyOrderEvent` performs for every SSE lifecycle event.
 * Zustand notifies all subscribers synchronously and React 18 batches
 * them into ONE commit, so this layout effect runs in the same commit
 * that re-renders the confirmation UIs (TradeActivityToasts, trade-page
 * status readers). `stampConfirmCommit` then stamps `commitAtMs` for
 * every order awaiting confirmation and schedules the paint stamp
 * (rAF → setTimeout(0) — see tradeTiming.ts for why not
 * PerformanceObserver paint entries).
 *
 * Renders nothing; costs one no-op effect per order event.
 */
export function TradeTimingPaintProbe() {
  const lastOrderEvent = useTradeActivityStore((s) => s.lastOrderEvent);
  useIsomorphicLayoutEffect(() => {
    if (lastOrderEvent !== null) stampConfirmCommit();
  }, [lastOrderEvent]);
  return null;
}

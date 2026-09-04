'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokenCardKey } from './tokenIdentityCache';
import type { CardItem } from './layout/cardVariants';

/**
 * Hover-to-pause for a live card row.
 *
 * EXTRACTED FROM `DiscoverPage.tsx`, unchanged, so the EVM lanes can hold the
 * same behaviour instead of a second implementation of it. The freeze
 * semantics below are subtle in three separate ways (membership frozen but
 * data live, departures still honoured, search snapping through the freeze) —
 * a re-implementation that got any one of them wrong would look right and
 * behave differently, which is exactly the drift this file exists to prevent.
 *
 * WHY IT MATTERS ON A TRADING SURFACE. A live board reorders and removes cards
 * on every frame. Without this, a card the user is reaching for moves out from
 * under the cursor between the mousedown and the click, and the click lands on
 * whatever slid into its place — on a page whose cards carry a quick-buy
 * control. The PAUSED badge is not decoration either: a frozen row that does
 * not SAY it is frozen reads as a dead feed.
 */

/**
 * The key a paused row identifies a card by.
 *
 * Alpha renders one card PER CALL, so sibling cards of the same mint must not
 * collide here — a mint-only key made `mergePausedRows` swap one call's data
 * into the other call's card while the row was hover-paused. Mirrors the
 * lane's `getKey`.
 */
export function coinKey(coin: CardItem): string {
  const callId = (coin as { callId?: string }).callId;
  const base = tokenCardKey(coin);
  return callId ? `${base}:${callId}` : base;
}

/**
 * Pause merge shared by every row: while a row is paused (pointer over it) the
 * visible set's ORDER is frozen — no card the user can see moves — but each
 * visible coin's data is refreshed in place from `latest`, and a coin that no
 * longer belongs to the row (`stillBelongs` false, e.g. a New-Pairs coin that
 * just graduated) is dropped. Coins absent from `latest` are kept (stale) so
 * cards never vanish under the pointer.
 *
 * Departures are backfilled AT THE TAIL from `latest` so the row keeps its
 * length: appending below the frozen cards moves nothing under the cursor,
 * while the old drop-without-replace left a visible hole for as long as the
 * pointer stayed on the row (owner report, 2026-08-12: a Ripening coin
 * graduating out of the row left its slot empty).
 */
export function mergePausedRows<T extends CardItem>(
  visible: T[],
  latest: T[],
  stillBelongs: (coin: T) => boolean,
): T[] {
  const latestByKey = new Map(latest.map((coin) => [coinKey(coin), coin]));
  const next: T[] = [];
  for (const coin of visible) {
    const updated = latestByKey.get(coinKey(coin)) ?? coin;
    if (stillBelongs(updated)) next.push(updated);
  }
  if (next.length < visible.length) {
    const kept = new Set(next.map(coinKey));
    for (const coin of latest) {
      if (next.length >= visible.length) break;
      const key = coinKey(coin);
      if (kept.has(key) || !stillBelongs(coin)) continue;
      kept.add(key);
      next.push(coin);
    }
  }
  return next;
}

/**
 * Hover-to-pause for a Discover row. Returns the visible (possibly frozen)
 * list plus pointer handlers and a `paused` flag for the header badge.
 * While not paused the row mirrors `live` exactly; on pointer-enter it
 * freezes, refreshing data in place (see `mergePausedRows`); on
 * pointer-leave it snaps back to the latest live list.
 */
export function usePausableRow<T extends CardItem>(
  live: T[],
  stillBelongs: (coin: T) => boolean,
  /** Changing this snaps the row to the latest live list even while
   *  hover-frozen — the section search query goes here, because a mouse
   *  user typing in the header necessarily has the pointer inside the
   *  section, and a frozen row would make search look inert. The freeze
   *  still applies to feed churn between keystrokes. */
  snapKey = '',
): {
  visible: T[];
  paused: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
} {
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const latestRef = useRef(live);
  const [visible, setVisible] = useState(live);

  useEffect(() => {
    latestRef.current = live;
    if (!pausedRef.current) {
      setVisible(live);
    } else {
      setVisible((current) => mergePausedRows(current, live, stillBelongs));
    }
  }, [live, stillBelongs]);

  // Declared after the merge effect so the snap always reads the
  // already-updated latest list; on mount it re-sets the same reference
  // and React bails out of the render.
  useEffect(() => {
    setVisible(latestRef.current);
  }, [snapKey]);

  const onPointerEnter = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const onPointerLeave = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    setVisible(latestRef.current);
  }, []);

  return { visible, paused, onPointerEnter, onPointerLeave };
}

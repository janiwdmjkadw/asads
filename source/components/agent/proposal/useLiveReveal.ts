'use client';

/**
 * The live reveal, wired: mark while streaming, claim once on commit,
 * anchor the card's top before the browser paints it.
 *
 * The card REMOUNTS at commit — the streaming turn and the committed turn
 * are different subtrees (`chat-store` nulls the stream and appends the
 * turn) — so "the turn just committed" cannot be read as a prop change on
 * one instance. It is read instead from the mark the streaming instance
 * left behind, which is the same fact from the other side.
 *
 * The claim is a lazy `useState` initializer over a PURE lookup, so it is
 * synchronous with the mounting render and StrictMode can run it twice
 * without spending anything. Spending the mark is the mount effect's job.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConversationScroll } from '../conversationScroll';
import {
  anchorScrollTop,
  clearLiveReveal,
  isLiveReveal,
  markStreamingReveal,
  revealScroll,
} from './reveal';

/** SSR has no layout to measure and no scroll box to move. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface LiveReveal {
  /** Put this on the element that wraps the card. */
  readonly ref: React.RefObject<HTMLDivElement | null>;
  /** True for the one mount that IS the reveal. */
  readonly live: boolean;
}

export function useLiveReveal(proposalId: string | null, streaming: boolean): LiveReveal {
  const ref = useRef<HTMLDivElement | null>(null);
  const scroll = useConversationScroll();
  const [live] = useState(() => proposalId !== null && !streaming && isLiveReveal(proposalId));

  useEffect(() => {
    if (proposalId === null) return;
    if (streaming) markStreamingReveal(proposalId);
    else clearLiveReveal(proposalId);
  }, [proposalId, streaming]);

  /**
   * WHETHER THE ANCHOR HAS ALREADY HAPPENED, across effect runs.
   *
   * The decision reads "is the thread pinned to the bottom", and the
   * anchor's own first act is to UNPIN it — so the decision is not
   * repeatable, and an effect that runs twice would take it once and
   * then decline forever. StrictMode runs every mount effect twice
   * (run, clean up, run again), which is exactly that shape.
   */
  const anchored = useRef(false);

  /*
   * BEFORE PAINT, not after: the anchor has to be the first thing the
   * reader sees, or the reveal is a jump. Measuring here is safe — the
   * card's height is already reserved by the skeleton it replaces, so the
   * box it will occupy is the box it occupies now.
   */
  useBrowserLayoutEffect(() => {
    if (!live || scroll === null) return;
    const card = ref.current;
    const box = scroll.scrollElement();
    if (card === null || box === null) return;
    const cardTop = (): number =>
      card.getBoundingClientRect().top - box.getBoundingClientRect().top;

    if (!anchored.current) {
      /*
       * ONE MEASUREMENT. The three numbers below describe the same
       * instant and are only meaningful together (see
       * `RevealMeasure.scrollTop`); nothing that can move the scroll box
       * may run between them.
       */
      const decision = revealScroll({
        stuckToBottom: scroll.isAtBottom(),
        cardTop: cardTop(),
        scrollTop: box.scrollTop,
      });
      if (decision.kind === 'none') return;
      anchored.current = true;
      /*
       * Release BEFORE the write, and write an ABSOLUTE position after
       * it. The card's mount is a resize, and the scroll library has an
       * animation queued behind every resize; it re-reads "am I at the
       * bottom" on each of its frames, so letting go here retires the
       * one in flight as well as every later one. Writing a position the
       * release cannot have invalidated is what makes the order safe.
       */
      scroll.release();
      box.scrollTop = decision.scrollTop;
    }

    /*
     * AND ASSERT IT AGAIN ON THE NEXT FRAME. The commit's layout is not
     * the frame's layout: effects that run after this one still move the
     * content above the card, and anchored here alone it lands some tens
     * of px below the edge it was aimed at. The correction is one
     * absolute write inside the reveal's own fade, so it is not a second
     * scroll anyone can see — and the fade is exactly why the anchor is
     * not simply DEFERRED to this frame, since with motion reduced there
     * would be no fade to hide a first paint at the bottom.
     */
    const frame = requestAnimationFrame(() => {
      const target = anchorScrollTop(cardTop(), box.scrollTop);
      if (Math.abs(target - box.scrollTop) > 1) box.scrollTop = target;
    });
    return () => cancelAnimationFrame(frame);
  }, [live, scroll]);

  return { ref, live };
}

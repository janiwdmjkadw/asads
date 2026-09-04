/**
 * THE LIVE REVEAL — where the eye lands when a proposal card arrives.
 *
 * While a turn streams, the thread is pinned to the bottom and the card's
 * place is held by a skeleton of its measured height. When the turn
 * commits, the card mounts into that reserved space — still pinned to the
 * bottom, so a card taller than the chat window greets the reader with its
 * FOOTER: the Approve button and a countdown, with the plan it authorizes
 * somewhere off the top of the screen.
 *
 * A card is a thing you read from the top. So on a live reveal — and only
 * on one — the thread anchors the card's TOP at the top of the viewport
 * and lets go of the bottom, and the reader scrolls down through it.
 *
 * Two decisions live here, both pure, because both are worth pinning:
 *
 *  1. WHICH REVEALS ARE LIVE. Only a card whose own skeleton was on
 *     screen during THIS session's streaming turn. A history render, a
 *     reload, a second mount of the same card: none of those are a
 *     reveal, and yanking the viewport on any of them would be a bug
 *     rather than a courtesy. The marks are module state, so a page load
 *     starts with none and nothing can be revealed twice.
 *  2. WHETHER TO MOVE AT ALL. A card that already fits in view needs no
 *     help, and a reader who scrolled away during the turn has already
 *     said where they want to look.
 */

/** Comfortable air between the viewport's top edge and the card's. */
export const REVEAL_OFFSET_PX = 12;

/** Proposal ids whose skeleton was rendered by a streaming turn. */
const streamedThisSession = new Set<string>();

/** Called while a turn is still streaming: this card is about to land. */
export function markStreamingReveal(proposalId: string): void {
  streamedThisSession.add(proposalId);
}

/** PURE read — safe to call during render, and never twice-effective. */
export function isLiveReveal(proposalId: string): boolean {
  return streamedThisSession.has(proposalId);
}

/** Spend the mark. The reveal is a one-time event, not a property. */
export function clearLiveReveal(proposalId: string): void {
  streamedThisSession.delete(proposalId);
}

/** Tests only — module state outlives a single case otherwise. */
export function forgetLiveReveals(): void {
  streamedThisSession.clear();
}

export interface RevealMeasure {
  /** Is the conversation still pinned to the bottom? */
  readonly stuckToBottom: boolean;
  /** The card's top edge, relative to the scroll viewport's top edge. */
  readonly cardTop: number;
  /**
   * The scroll position `cardTop` was measured against. READ IN THE SAME
   * BREATH as the rects — the answer is `scrollTop + cardTop`, and if the
   * two come from different instants the sum is not a position at all.
   * That is not hypothetical: the reveal's first build read `scrollTop`
   * after releasing the bottom lock, and the release let the scroll
   * library's own bookkeeping run in between, which put the card ~31px
   * below where it was asked to sit.
   */
  readonly scrollTop: number;
}

export type RevealScroll =
  | { readonly kind: 'none' }
  /** The ABSOLUTE position to scroll to — never a delta, so a scroll that
   *  moves before the write lands cannot compound with it. */
  | { readonly kind: 'anchor'; readonly scrollTop: number };

/**
 * The scroll position that puts the card's top `offsetPx` below the
 * viewport's — clamped, because the top of the thread is as far up as
 * any scroll box goes and a card near it simply sits where it sits.
 */
export function anchorScrollTop(
  cardTop: number,
  scrollTop: number,
  offsetPx: number = REVEAL_OFFSET_PX,
): number {
  return Math.max(0, scrollTop + cardTop - offsetPx);
}

/**
 * Bottom-pinned, the card's bottom is at the viewport's bottom — so
 * "does it fit" and "is its top on screen" are the SAME question, and
 * `cardTop` answers it without needing the card's height or the
 * viewport's. Above zero, the whole card is visible and nothing moves.
 */
export function revealScroll(
  measure: RevealMeasure,
  offsetPx: number = REVEAL_OFFSET_PX,
): RevealScroll {
  if (!measure.stuckToBottom) return { kind: 'none' };
  if (measure.cardTop >= 0) return { kind: 'none' };
  return { kind: 'anchor', scrollTop: anchorScrollTop(measure.cardTop, measure.scrollTop, offsetPx) };
}

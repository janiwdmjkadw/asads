'use client';

import { createContext, useContext } from 'react';

/**
 * Card hover-machinery arming.
 *
 * Every Discover card carries hover-only Radix primitives — shadcn
 * Tooltips on the meta/metric glyphs, the tweet / wallet-funding /
 * fee-share HoverCards, the token-image preview. Their render cost is
 * paid on EVERY feed-driven card re-render (4 ticks/s), yet the
 * machinery does nothing until a pointer actually reaches the card:
 * profiled at ~1.5s of a 15s scroll window on a 4x-throttled CPU
 * (radix slot/context/tooltip/hover-card were the top non-react-dom
 * frames — see the scroll-jank harness).
 *
 * "Armed" means the card has seen real hover/focus intent, so the
 * wrappers may mount. Until then the same trigger DOM renders bare —
 * pixel-identical, aria-labels intact — and a card update re-renders
 * only the cheap tree. Arming is one-way: cards never disarm.
 *
 * The default is TRUE so every consumer outside an arming scope
 * (Trade header preview, search results, SSR tests) keeps today's
 * always-mounted behavior.
 */
const CardArmedContext = createContext(true);

/** Provider for the card root; value is the card's armed state. */
export const CardArmedProvider = CardArmedContext.Provider;

/** Whether hover-only primitives (tooltips/hover-cards) may mount. */
export function useCardArmed(): boolean {
  return useContext(CardArmedContext);
}

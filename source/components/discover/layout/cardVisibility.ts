'use client';

import { createContext, useContext } from 'react';

/**
 * Per-card viewport visibility, provided by each `CardLane` slot and consumed
 * by `CoinCard` to pause its feed subscription while off-screen (so off-screen
 * cards stay mounted -- no pop-in / state loss -- but stop re-rendering on
 * every feed tick).
 *
 * Defaults to `true` so a card with no surrounding lane (e.g. SSR, the first
 * client render before the IntersectionObserver reports, or any one-off use)
 * is always live and never accidentally frozen.
 */
export const CardVisibilityContext = createContext<boolean>(true);

export function useCardVisibility(): boolean {
  return useContext(CardVisibilityContext);
}

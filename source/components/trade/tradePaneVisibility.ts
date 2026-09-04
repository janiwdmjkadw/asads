'use client';

import { createContext, useContext } from 'react';

/**
 * True while the persistent Trade pane is hidden (user is on another
 * route). TradePage goes DORMANT on it: the snapshot poll, prewarm
 * heartbeat, and balance/inflight polls stop, and the selected-token SSE
 * buffers events without applying them — so the hidden pane costs ~nothing
 * yet the reveal applies the buffered tail and is current in the same
 * frame. Mirror of discoverPaneVisibility; default false so any
 * standalone mount stays fully live.
 */
export const TradePaneHiddenContext = createContext(false);

export function useTradePaneHidden(): boolean {
  return useContext(TradePaneHiddenContext);
}

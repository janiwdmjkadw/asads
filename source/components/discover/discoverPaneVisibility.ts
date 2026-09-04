'use client';

import { createContext, useContext } from 'react';

/**
 * True while the persistent Discover pane is hidden (user is on another
 * route). DiscoverPage goes DORMANT on it: order-channel subscriptions
 * become no-ops so the invisible page never re-renders (measured +11pp
 * renderer CPU on the trade page without this), while the feed store keeps
 * ingesting — the reveal re-subscribes and reads the fresh snapshot in the
 * same render. Default false so any standalone mount stays live.
 *
 * Lives in its own module (not PersistentDiscoverPane.tsx) to avoid an
 * import cycle: the pane imports DiscoverPage, which consumes this context.
 */
export const DiscoverPaneHiddenContext = createContext(false);

export function useDiscoverPaneHidden(): boolean {
  return useContext(DiscoverPaneHiddenContext);
}

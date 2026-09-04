'use client';

import type { ReactNode } from 'react';
import { fixtureNewPairs } from './fixtureNewPairs';
import type { MockCoin } from './mockCoins';
import { useDiscoverFeedArray, useDiscoverFeedArrayDormant } from './discoverFeedStore';
import { useDiscoverFeedIngestion } from './useLiveNewPairs';

/**
 * Mounts the single Discover feed ingestion driver. The feed itself
 * lives in `discoverFeedStore` (a module singleton), so consumers read
 * it directly via `useDiscoverFeed()` / `useDiscoverCoin()` rather than
 * through React context -- that is what lets each card subscribe at
 * per-coin granularity instead of receiving the whole array as a prop.
 */
export function DiscoverFeedProvider({ children }: { children: ReactNode }) {
  useDiscoverFeedIngestion(fixtureNewPairs);
  return <>{children}</>;
}

/** Ordered live feed. Stable reference between ticks that change nothing. */
export function useDiscoverFeed(): MockCoin[] {
  return useDiscoverFeedArray();
}

/** Ordered live feed with the hidden-pane dormant mode (see
 *  useDiscoverFeedArrayDormant): no re-renders while dormant, instantly
 *  current on reveal. */
export function useDiscoverFeedDormant(dormant: boolean): MockCoin[] {
  return useDiscoverFeedArrayDormant(dormant);
}

'use client';

import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { usePositionsStream, type PositionItem } from './usePositionsStream';

/** Re-exported for back-compat: `PositionsBar` / `useSellAllPosition` key off this. */
export type { PositionItem };

/**
 * Live open positions aggregated across ALL selected wallets. Backed by
 * the shared server-joined positions SSE (`usePositionsStream`) — balances
 * ⋈ cost basis ⋈ live price blended per coin server-side and pushed in
 * real time, so a buy/sell on any selected wallet reflects instantly and
 * PnL ticks with price. No polling.
 */
export function usePositionStrip(): {
  items: ReadonlyArray<PositionItem>;
  isLoading: boolean;
} {
  // Seeded auth: the SSE authenticates via cookie anyway, so open it as
  // soon as the server-seeded mirror says "signed in" instead of waiting
  // ~1-3s for clerk.browser.js on a cold boot.
  const { isLoaded, isSignedIn } = useSeededAuth();
  const walletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  const enabled = isLoaded && isSignedIn === true;
  return usePositionsStream(walletAccountIds, enabled);
}

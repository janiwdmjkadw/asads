'use client';

import { useMemo } from 'react';
import { useMe } from '@/lib/api/me';
import { flashWalletFromEntry, type FlashWallet } from './flash-state';

/**
 * Every Solana wallet Flash can apply to — now ONE source.
 *
 * This hook used to stitch `/me.wallets` together with a second read of
 * the agent-wallet status route, because the api filtered the agent
 * wallet out of `/me`. It no longer does: the agent wallet arrives in
 * `me.wallets` as a real entry with `purpose: 'agent'`, ordered last.
 * Keeping the second source would have appended a DUPLICATE agent
 * wallet to this list, so it is gone — along with the request it cost
 * on every page.
 */
export function useFlashWallets(): ReadonlyArray<FlashWallet> {
  const { data: me } = useMe();

  return useMemo<ReadonlyArray<FlashWallet>>(() => {
    if (!me || me.reauth_required) return [];
    return me.wallets.map((entry) =>
      flashWalletFromEntry(entry, { isAgent: entry.purpose === 'agent' }),
    );
  }, [me]);
}

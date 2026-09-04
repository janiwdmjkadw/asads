'use client';

import { WalletSetupModal } from './WalletSetupModal';
import { useWalletSetupStore } from '@/lib/state/wallet-setup-store';
import { useMe } from '@/lib/api/me';

/**
 * Singleton host for the global "needs setup" → nonce-setup flow. Any
 * badge anywhere calls `openWalletSetup(walletAccountId)`; this host
 * resolves the wallet FRESH from /me on every render (so the post-setup
 * /me refetch flips `trade_ready`, the modal auto-closes, and every
 * badge across the app updates in the same tick) and renders the exact
 * modal Portfolio → Wallets uses. Mounted once in TerminalShell beside
 * the wallet-profile modal.
 */
export function WalletSetupModalHost() {
  const walletAccountId = useWalletSetupStore((s) => s.walletAccountId);
  const close = useWalletSetupStore((s) => s.close);
  const { data: me } = useMe();
  // MeResponse is a union with the reauth shape — only the loaded,
  // non-reauth variant carries wallets.
  const wallets = me && 'wallets' in me ? me.wallets : [];
  const wallet =
    walletAccountId !== null
      ? wallets.find((w) => w.wallet_account_id === walletAccountId) ?? null
      : null;
  return <WalletSetupModal wallet={wallet} onClose={close} />;
}

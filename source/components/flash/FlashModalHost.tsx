'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useFlashStore } from '@/lib/state/flash-store';
import { FlashModal } from './FlashModal';
import { useFlashWallets } from './useFlashWallets';
import type { FlashWallet } from './flash-state';

// The deposit surface is the top nav's own Deposit/Withdraw dialog. Lazy
// for the same reason it is lazy there: the chunk should load on the
// first "Deposit SOL" click, not with the shell.
const WalletBalanceModal = dynamic(
  () => import('@/components/wallet/WalletBalanceModal').then((m) => m.WalletBalanceModal),
  { ssr: false },
);

/**
 * Singleton host for Flash. Any trigger anywhere calls
 * `openFlash(walletAccountId)`; this host resolves the wallet FRESH on
 * every render — from `/me` for user wallets, from the agent-wallet
 * status for the agent's — so the lane count the card renders is the
 * same one the bell and the portfolio bolt read. Mounted once in
 * `TerminalShell` beside the wallet-setup host.
 *
 * "Deposit SOL" hands off rather than nesting: Flash closes, and the
 * existing Deposit/Withdraw dialog opens on THIS wallet (the nav's copy
 * of it is pinned to the primary wallet, which is not necessarily the
 * one short of rent).
 */
export function FlashModalHost(): React.ReactElement {
  const walletAccountId = useFlashStore((s) => s.walletAccountId);
  const close = useFlashStore((s) => s.close);
  const wallets = useFlashWallets();
  const [depositWallet, setDepositWallet] = useState<FlashWallet | null>(null);

  const wallet =
    walletAccountId !== null
      ? (wallets.find((w) => w.walletAccountId === walletAccountId) ?? null)
      : null;

  return (
    <>
      <FlashModal
        wallet={wallet}
        onClose={close}
        onDeposit={(target) => {
          close();
          setDepositWallet(target);
        }}
      />
      {depositWallet !== null ? (
        <WalletBalanceModal
          open
          onOpenChange={(next) => {
            if (!next) setDepositWallet(null);
          }}
          pubkey={depositWallet.pubkey}
          walletAccountId={depositWallet.walletAccountId}
          initialTab="deposit"
        />
      ) : null}
    </>
  );
}

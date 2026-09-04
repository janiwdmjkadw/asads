'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { create } from 'zustand';
import { AGENT_WALLET_SETUP_HREF } from '@/components/portfolio/agentWallet';
import type { MeWalletEntry } from '@/lib/api/me';

// Global wallet-setup modal state. ANY "needs setup" badge (wallet
// selectors, multi-wallet picker, portfolio rows…) calls
// `openWalletSetup(walletAccountId)`; the single host mounted in
// TerminalShell renders the SAME nonce-setup modal Portfolio → Wallets
// uses. Sync comes free: the host resolves the wallet fresh from /me
// each render, and setup completion refetches /me — every surface's
// badge flips together. Mirrors wallet-profile-store.

interface WalletSetupState {
  walletAccountId: string | null;
  open: (walletAccountId: string) => void;
  close: () => void;
}

export const useWalletSetupStore = create<WalletSetupState>((set) => ({
  walletAccountId: null,
  open: (walletAccountId) => set({ walletAccountId }),
  close: () => set({ walletAccountId: null }),
}));

export function openWalletSetup(walletAccountId: string | null | undefined): void {
  const trimmed = walletAccountId?.trim();
  if (!trimmed) return;
  useWalletSetupStore.getState().open(trimmed);
}

/**
 * Slice "Agent wallet as a first-class wallet": the "needs setup"
 * affordance now has TWO destinations, because the agent wallet is
 * selectable in the same pickers as user wallets but its readiness is
 * fixed somewhere else entirely.
 *
 * A user wallet opens the global nonce-setup modal above. The agent
 * wallet routes to its own ceremony — grant/revoke plus an
 * agent-scoped nonce pool — which that modal cannot provision, so
 * pointing it there would show the user a flow that can never make the
 * wallet ready.
 */
export function useOpenSetupForWallet(): (wallet: MeWalletEntry) => void {
  const router = useRouter();
  return useCallback(
    (wallet: MeWalletEntry) => {
      if (wallet.purpose === 'agent') {
        router.push(AGENT_WALLET_SETUP_HREF);
        return;
      }
      openWalletSetup(wallet.wallet_account_id);
    },
    [router],
  );
}

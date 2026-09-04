'use client';

import { create } from 'zustand';

// Global Flash modal state. Every trigger — the portfolio wallet row's
// bolt, the agent-wallet surface, the bell's derived entries, the wallet
// panel's offer — calls `openFlash(walletAccountId)`; the single host
// mounted in TerminalShell resolves that id fresh from `/me` (or the
// agent-wallet status) and renders the modal. Mirrors
// `wallet-setup-store`, for the same reason: one host means the surfaces
// can never disagree about a wallet's lane state.

interface FlashState {
  walletAccountId: string | null;
  open: (walletAccountId: string) => void;
  close: () => void;
}

export const useFlashStore = create<FlashState>((set) => ({
  walletAccountId: null,
  open: (walletAccountId) => set({ walletAccountId }),
  close: () => set({ walletAccountId: null }),
}));

export function openFlash(walletAccountId: string | null | undefined): void {
  const trimmed = walletAccountId?.trim();
  if (!trimmed) return;
  useFlashStore.getState().open(trimmed);
}

'use client';

import { create } from 'zustand';

// Global wallet-profile modal state. ANY address surface (trades table,
// holders, top traders, activity feeds, tracker lists, caller chips…)
// calls `openWalletProfile(address)`; the single modal instance mounted
// in TerminalShell reacts. Module-level opener so deep leaf components
// need no prop drilling and no hook.

interface WalletProfileState {
  address: string | null;
  open: (address: string) => void;
  close: () => void;
}

export const useWalletProfileStore = create<WalletProfileState>((set) => ({
  address: null,
  open: (address) => set({ address }),
  close: () => set({ address: null }),
}));

export function openWalletProfile(address: string | null | undefined): void {
  const trimmed = address?.trim();
  if (!trimmed) return;
  useWalletProfileStore.getState().open(trimmed);
}

'use client';

import { create } from 'zustand';

// Global token-search opener. Any surface (ticker action popovers on
// Discover cards, future hotkeys…) calls `openTokenSearch(query)`; the
// TokenSearchTrigger mounted in TerminalTopNav reacts by opening the
// search modal pre-filled with that query. Module-level opener so deep
// leaf components need no prop drilling — same pattern as
// wallet-profile-store.

interface TokenSearchState {
  /** Pending prefill query; null = no externally-requested open. */
  query: string | null;
  open: (query: string) => void;
  clear: () => void;
}

export const useTokenSearchStore = create<TokenSearchState>((set) => ({
  query: null,
  open: (query) => set({ query }),
  clear: () => set({ query: null }),
}));

export function openTokenSearch(query: string | null | undefined): void {
  const trimmed = query?.trim();
  if (!trimmed) return;
  useTokenSearchStore.getState().open(trimmed);
}

import { create } from 'zustand';

interface TerminalState {
  selectedMint: string | null;
  instantTradeOpen: boolean;
  setSelectedMint: (mint: string | null) => void;
  setInstantTradeOpen: (open: boolean) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  selectedMint: null,
  instantTradeOpen: false,
  setSelectedMint: (mint) => set({ selectedMint: mint }),
  setInstantTradeOpen: (open) => set({ instantTradeOpen: open }),
}));

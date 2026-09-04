'use client';

import { create } from 'zustand';

// Live tracked-wallet activity count, published by the wallet activity
// feed and read by the footer dock toggle (the button lives in the app
// footer, outside the feed's data tree). Display-only.

interface ActivityCountStore {
  count: number;
  setCount: (count: number) => void;
}

export const useActivityCountStore = create<ActivityCountStore>((set) => ({
  count: 0,
  setCount: (count) => set((s) => (s.count === count ? s : { count })),
}));

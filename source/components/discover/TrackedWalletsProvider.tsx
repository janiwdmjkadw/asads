'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTrackedWallets, type UseTrackedWalletsResult } from './trackedWallets';

const TrackedWalletsContext = createContext<UseTrackedWalletsResult | null>(null);

export function TrackedWalletsProvider({ children }: { children: ReactNode }) {
  const trackedWallets = useTrackedWallets();

  return (
    <TrackedWalletsContext.Provider value={trackedWallets}>
      {children}
    </TrackedWalletsContext.Provider>
  );
}

export function useTrackedWalletsContext(): UseTrackedWalletsResult {
  const value = useContext(TrackedWalletsContext);
  if (!value) {
    throw new Error('useTrackedWalletsContext must be used inside TrackedWalletsProvider');
  }
  return value;
}

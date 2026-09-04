'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// T5: lift the `WalletPanel` open/close state out of `WalletStatePill`
// so the trade-intake error path (e.g. `not_provisioned_complete`) can
// imperatively open the same modal. Both the pill and the trade panel
// call `openWalletPanel()` / `closeWalletPanel()`; the panel itself
// lives in one place inside the layout.

interface WalletPanelContextValue {
  open: boolean;
  openWalletPanel(): void;
  closeWalletPanel(): void;
}

const WalletPanelContext = createContext<WalletPanelContextValue | null>(null);

export function WalletPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openWalletPanel = useCallback(() => setOpen(true), []);
  const closeWalletPanel = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, openWalletPanel, closeWalletPanel }),
    [open, openWalletPanel, closeWalletPanel],
  );
  return (
    <WalletPanelContext.Provider value={value}>{children}</WalletPanelContext.Provider>
  );
}

/**
 * Returns the lifted state. Returns a no-op fallback if no provider is
 * mounted (so legacy `WalletStatePill` keeps working in tests / pages
 * that haven't been wired yet).
 */
export function useWalletPanel(): WalletPanelContextValue {
  const ctx = useContext(WalletPanelContext);
  if (ctx) return ctx;
  return {
    open: false,
    openWalletPanel: () => undefined,
    closeWalletPanel: () => undefined,
  };
}

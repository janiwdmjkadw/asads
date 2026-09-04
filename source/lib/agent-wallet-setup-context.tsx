'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Controls the agent-wallet setup modal's open state. Lifted into a
 * context (mirroring `onboarding-context`) so the navbar chip — and any
 * later entry point, e.g. the Portfolio deep link — opens the same
 * single mounted modal.
 *
 * There is no auto-open gate here on purpose: the agent wallet is a
 * nudge, not a wall, so nothing opens this modal except an explicit
 * user action.
 */
interface AgentWalletSetupContextValue {
  open: boolean;
  openAgentWalletSetup(): void;
  closeAgentWalletSetup(): void;
}

const AgentWalletSetupContext = createContext<AgentWalletSetupContextValue | null>(null);

export function AgentWalletSetupProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openAgentWalletSetup = useCallback(() => setOpen(true), []);
  const closeAgentWalletSetup = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, openAgentWalletSetup, closeAgentWalletSetup }),
    [open, openAgentWalletSetup, closeAgentWalletSetup],
  );
  return (
    <AgentWalletSetupContext.Provider value={value}>{children}</AgentWalletSetupContext.Provider>
  );
}

/**
 * Returns the setup modal's open state. Falls back to a no-op when no
 * provider is mounted so isolated component tests keep working.
 */
export function useAgentWalletSetup(): AgentWalletSetupContextValue {
  const ctx = useContext(AgentWalletSetupContext);
  if (ctx) return ctx;
  return {
    open: false,
    openAgentWalletSetup: () => undefined,
    closeAgentWalletSetup: () => undefined,
  };
}

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
 * Controls the first-run onboarding modal's open state. Lifted into a
 * context (mirroring `wallet-panel-context`) so any surface — the
 * navbar "Finish Wallet Setup" button, the auto-open gate, or a future
 * trade-intake path — can imperatively open the same modal.
 */
interface OnboardingContextValue {
  open: boolean;
  openOnboarding(): void;
  closeOnboarding(): void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openOnboarding = useCallback(() => setOpen(true), []);
  const closeOnboarding = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, openOnboarding, closeOnboarding }),
    [open, openOnboarding, closeOnboarding],
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

/**
 * Returns the onboarding open state. Falls back to a no-op when no
 * provider is mounted so isolated component tests keep working.
 */
export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (ctx) return ctx;
  return {
    open: false,
    openOnboarding: () => undefined,
    closeOnboarding: () => undefined,
  };
}

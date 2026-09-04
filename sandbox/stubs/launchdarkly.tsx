'use client';

/**
 * Stand-in for `launchdarkly-react-client-sdk`. Aliased in next.config.mjs.
 *
 * Flags are read from `sandbox/flags.ts` so the EVM lanes and other flagged
 * surfaces can be switched on for design work. Note that `useEvmEnabled`
 * fails closed by design, so the EVM board only appears when the flag here is
 * explicitly `true`.
 */
import { SANDBOX_FLAGS } from '../flags';

export function useFlags<T = Record<string, unknown>>(): T {
  return SANDBOX_FLAGS as T;
}

export function useLDClient() {
  return null;
}

export function withLDProvider() {
  return <P extends object>(Component: React.ComponentType<P>) => Component;
}

export function asyncWithLDProvider() {
  return async () => ({ children }: { children: React.ReactNode }) => <>{children}</>;
}

export function LDProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

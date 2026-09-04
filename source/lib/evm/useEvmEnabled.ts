'use client';

/**
 * The single gate for every EVM surface in the terminal, backed by the
 * LaunchDarkly boolean flag `evm-client-surface` evaluated for the signed-in
 * Clerk user (components/flags/LaunchDarklyProvider.tsx does the identify).
 *
 * FAILS CLOSED, and that is the whole point. `true` is returned ONLY when LD
 * has affirmatively evaluated the flag to `true` for this user. Every other
 * state reads as `false`:
 *
 * - LD still initializing (flag set is `{}` until the client is ready)
 * - LD unreachable, CSP-blocked, or blocked by an ad blocker (LD blocklists
 *   commonly match `launchdarkly.com`) — the flag set stays `{}`
 * - `ldClientId` unset, so no provider is mounted at all — `useFlags()` then
 *   reads the SDK's default context, which is also `{}`
 * - flag archived or missing from the environment — key absent
 * - any non-boolean value — the `=== true` comparison rejects it
 *
 * Getting that backwards would ship EVM to every user on any LD hiccup, so
 * the default lives here rather than at each call site.
 */

import { useFlags } from 'launchdarkly-react-client-sdk';

/** Verbatim dashboard key — the provider disables LD's camel-casing. */
const EVM_CLIENT_SURFACE_FLAG = 'evm-client-surface';

type EvmFlags = { 'evm-client-surface'?: boolean };

export function useEvmEnabled(): boolean {
  const flags = useFlags<EvmFlags>();
  return flags[EVM_CLIENT_SURFACE_FLAG] === true;
}

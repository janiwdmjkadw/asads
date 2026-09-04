'use client';

/**
 * The single gate for the Conditionals surface in the terminal (top-nav tab +
 * the `/conditionals` route), backed by the LaunchDarkly boolean flag
 * `conditionals-surface` evaluated for the signed-in Clerk user
 * (components/flags/LaunchDarklyProvider.tsx does the identify).
 *
 * FAILS CLOSED, exactly like `lib/evm/useEvmEnabled.ts`. `true` is returned
 * ONLY when LD has affirmatively evaluated the flag to `true` for this user.
 * Every other state reads as `false`:
 *
 * - LD still initializing (flag set is `{}` until the client is ready)
 * - LD unreachable, CSP-blocked, or blocked by an ad blocker (LD blocklists
 *   commonly match `launchdarkly.com`) — the flag set stays `{}`
 * - `ldClientId` unset, so no provider is mounted at all — `useFlags()` then
 *   reads the SDK's default context, which is also `{}`
 * - flag archived or missing from the environment — key absent
 * - any non-boolean value — the `=== true` comparison rejects it
 *
 * Getting that backwards would ship Conditionals to every user on any LD
 * hiccup, so the default lives here rather than at each call site.
 */

import { useFlags } from 'launchdarkly-react-client-sdk';

/** Verbatim dashboard key — the provider disables LD's camel-casing. */
const CONDITIONALS_SURFACE_FLAG = 'conditionals-surface';

type ConditionalsFlags = { 'conditionals-surface'?: boolean };

export function useConditionalsEnabled(): boolean {
  const flags = useFlags<ConditionalsFlags>();
  return flags[CONDITIONALS_SURFACE_FLAG] === true;
}

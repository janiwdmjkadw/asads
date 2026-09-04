'use client';

/**
 * The single gate for the full-screen `/welcome` onboarding, backed by the
 * LaunchDarkly boolean flag `onboarding-fullscreen` evaluated for the
 * signed-in Clerk user (components/flags/LaunchDarklyProvider.tsx does the
 * identify). Mirrors `lib/evm/useEvmEnabled.ts` — one hook per flag.
 *
 * FAILS CLOSED. `true` is returned ONLY when LD has affirmatively evaluated
 * the flag to `true` for this user; every other state reads `false` and the
 * user keeps today's classic onboarding modal:
 *
 * - LD still initializing (flag set is `{}` until the client is ready)
 * - LD unreachable, CSP-blocked, or blocked by an ad blocker
 * - `ldClientId` unset, so no provider is mounted at all
 * - flag archived or missing from the environment — key absent
 * - any non-boolean value — the `=== true` comparison rejects it
 *
 * Closed here means the CLASSIC modal, which is the safe direction: every
 * user still gets a working onboarding, just not the new one.
 */

import { useFlags } from 'launchdarkly-react-client-sdk';

/** Verbatim dashboard key — the provider disables LD's camel-casing. */
const ONBOARDING_FULLSCREEN_FLAG = 'onboarding-fullscreen';

type OnboardingFlags = { 'onboarding-fullscreen'?: boolean };

export function useFullscreenOnboarding(): boolean {
  const flags = useFlags<OnboardingFlags>();
  return flags[ONBOARDING_FULLSCREEN_FLAG] === true;
}

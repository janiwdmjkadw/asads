'use client';

/**
 * The single gate for the v2 tracked-wallet notification (the one-line
 * blotter row that replaces the prose card), backed by the LaunchDarkly
 * boolean flag `wallet-notification-v2` evaluated for the signed-in Clerk
 * user (components/flags/LaunchDarklyProvider.tsx does the identify).
 *
 * FAILS CLOSED, exactly like `lib/conditionals/useConditionalsEnabled.ts`.
 * `true` is returned ONLY when LD has affirmatively evaluated the flag to
 * `true` for this user. Every other state reads as `false`, which renders
 * the legacy design production ships today:
 *
 * - LD still initializing (flag set is `{}` until the client is ready)
 * - LD unreachable, CSP-blocked, or blocked by an ad blocker (LD blocklists
 *   commonly match `launchdarkly.com`) — the flag set stays `{}`
 * - `ldClientId` unset, so no provider is mounted at all — `useFlags()` then
 *   reads the SDK's default context, which is also `{}`
 * - flag archived or missing from the environment — key absent
 * - any non-boolean value — the `=== true` comparison rejects it
 *
 * Getting that backwards would ship the redesign to every user on any LD
 * hiccup, so the default lives here rather than at each call site.
 */

import { useFlags } from 'launchdarkly-react-client-sdk';

/** Verbatim dashboard key — the provider disables LD's camel-casing. */
const WALLET_NOTIFICATION_V2_FLAG = 'wallet-notification-v2';

type WalletNotificationFlags = { 'wallet-notification-v2'?: boolean };

export function useWalletNotificationV2Enabled(): boolean {
  const flags = useFlags<WalletNotificationFlags>();
  return flags[WALLET_NOTIFICATION_V2_FLAG] === true;
}

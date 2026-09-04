'use client';

/**
 * The single gate for the v2 trade-execution toast (the narrow lifecycle
 * row — spinner-to-check glyph plus one state word — that replaces the
 * amount/signature card), backed by the LaunchDarkly boolean flag
 * `trade-toast-v2` evaluated for the signed-in Clerk user
 * (components/flags/LaunchDarklyProvider.tsx does the identify).
 *
 * FAILS CLOSED, exactly like `lib/notifications/useWalletNotificationV2.ts`.
 * `true` is returned ONLY when LD has affirmatively evaluated the flag to
 * `true` for this user. Every other state reads as `false`, which renders
 * the legacy card production ships today:
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
const TRADE_TOAST_V2_FLAG = 'trade-toast-v2';

type TradeToastFlags = { 'trade-toast-v2'?: boolean };

export function useTradeToastV2Enabled(): boolean {
  const flags = useFlags<TradeToastFlags>();
  return flags[TRADE_TOAST_V2_FLAG] === true;
}

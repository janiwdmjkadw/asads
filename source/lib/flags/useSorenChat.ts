'use client';

/**
 * The single gate for the Soren chat skin — the redesigned floating agent
 * window (chrome, composer, turn model), backed by the LaunchDarkly boolean
 * flag `soren-chat-surface` evaluated for the signed-in Clerk user
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
 * Getting that backwards would ship the redesign to every user on any LD
 * hiccup, so the default lives here rather than at each call site.
 */

import { useFlags } from 'launchdarkly-react-client-sdk';

/** Verbatim dashboard key — the provider disables LD's camel-casing. */
const SOREN_CHAT_SURFACE_FLAG = 'soren-chat-surface';

type SorenChatFlags = { 'soren-chat-surface'?: boolean };

export function useSorenChat(): boolean {
  const flags = useFlags<SorenChatFlags>();
  return flags[SOREN_CHAT_SURFACE_FLAG] === true;
}

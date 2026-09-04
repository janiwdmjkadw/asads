/**
 * LaunchDarkly flags, for the sandbox. Flip a value, save, and the dev server
 * hot reloads the surface behind it. Every one of these hooks fails closed in
 * the real app, so a flagged surface appears only when it is `true` here.
 *
 * Keys are the verbatim dashboard keys — the real provider has camel casing
 * disabled, so a renamed key silently reads as undefined, which reads as off.
 */
export const SANDBOX_FLAGS: Record<string, unknown> = {
  /** The BSC / Robinhood lane set, the chain switch and the EVM trade page.
      Off by default, matching a fresh production user — and because the mock
      API has no EVM positions to answer with, which leaves a standing
      "positions stale" strip under the nav on every page while it is on. */
  'evm-client-surface': false,
  /** The conditionals tab and its detail route. */
  'conditionals-surface': true,
  /** Soren, the agent chat surface. */
  'soren-chat-surface': true,
  /** Full screen `/welcome` onboarding instead of the classic modal. */
  'onboarding-fullscreen': true,
  /** Second generation trade toasts. */
  'trade-toast-v2': true,
  /** Second generation wallet notifications. */
  'wallet-notification-v2': true,
};

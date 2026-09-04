import type { WalletSetupStatus } from '@/lib/auth/onboarding-status';

/** The full-screen onboarding route. */
export const WELCOME_PATH = '/welcome';

/**
 * What the first-run gate should do for this user.
 *
 * - `wait`   — undecidable yet (no `/me`, or the wallet is still
 *              provisioning). Re-evaluate on the next tick; do NOT record
 *              a decision.
 * - `skip`   — terminal: set up already, or onboarding was dismissed.
 * - `modal`  — open the classic onboarding modal (flag off).
 * - `welcome`— navigate to the full-screen flow (flag on).
 *
 * Pure so the gate's ordering can be asserted without a browser.
 */
export type AutoOpenDecision = 'wait' | 'skip' | 'modal' | 'welcome';

export function decideOnboardingAutoOpen(input: {
  readonly status: WalletSetupStatus;
  readonly seen: boolean;
  /** `onboarding-fullscreen` — fails closed to the classic modal. */
  readonly fullscreen: boolean;
}): AutoOpenDecision {
  const { status, seen, fullscreen } = input;
  if (status.loading) return 'wait';
  if (status.tradingReady || seen) return 'skip';
  if (!status.provisioned) return 'wait';
  return fullscreen ? 'welcome' : 'modal';
}

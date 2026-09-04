import { markOnboardingSeen } from '@/lib/auth/onboarding-status';

/** Where both exits from onboarding land. */
export const WELCOME_EXIT_PATH = '/discover';

export const RECOVERY_STEP = 0;
export const DEPOSIT_STEP = 1;
export type WelcomeStep = typeof RECOVERY_STEP | typeof DEPOSIT_STEP;

/**
 * Step 1 is mandatory: Continue unlocks once the key was revealed in this
 * session or was already backed up in a previous one. Same rule the
 * classic modal applies — it just controls a full-screen footer here.
 */
export function canContinueFromRecovery(input: {
  readonly keyRevealed: boolean;
  readonly recoveryDone: boolean;
}): boolean {
  return input.keyRevealed || input.recoveryDone;
}

/**
 * Leave onboarding — "Skip for now" and the final Continue are the same
 * exit: record the per-user dismissal so the auto-open gate stops firing,
 * then hand off to the router.
 */
export function leaveOnboarding(
  userId: string | null | undefined,
  navigate: (path: string) => void,
): void {
  markOnboardingSeen(userId);
  navigate(WELCOME_EXIT_PATH);
}

/**
 * Best-effort clipboard write for the COPY button. Returns whether the
 * write landed so the caller can show its copied state only when it did;
 * a browser that refuses (permission, insecure context) leaves the
 * address selectable, which is the fallback by design.
 */
export async function copyAddress(
  address: string | null,
  clipboard: { writeText: (text: string) => Promise<void> } | undefined,
): Promise<boolean> {
  if (!address || !clipboard) return false;
  try {
    await clipboard.writeText(address);
    return true;
  } catch {
    return false;
  }
}

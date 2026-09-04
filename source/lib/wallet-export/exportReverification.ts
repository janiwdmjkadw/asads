import type { BeginExportResult, BeginExportSuccess } from '@/lib/api/wallet-export';

/**
 * Step-up on the recovery-key export path.
 *
 * The api/ gates `export/begin` on Clerk's `fva` claim (minutes since a
 * factor was actually verified, threshold 5), so a user who idles during
 * onboarding gets `step_up_required`. Re-minting a JWT does NOT reset
 * `fva` — only verifying a factor does. This maps the api's step-up code
 * into the shape Clerk's `useReverification` recognises, so the hook opens
 * the factor dialog and repeats the exact original call once the user
 * succeeds. No challenge or token value is copied into the hint.
 *
 * Same protocol as `lib/evm/withdrawalReverification.ts`, which does this
 * for EVM withdrawals.
 */
export interface ExportReverificationHint {
  readonly clerk_error: {
    readonly type: 'forbidden';
    readonly reason: 'reverification-error';
    readonly metadata: {
      readonly reverification: {
        readonly level: 'first_factor';
        readonly afterMinutes: 5;
      };
    };
  };
}

const HINT: ExportReverificationHint = {
  clerk_error: {
    type: 'forbidden',
    reason: 'reverification-error',
    metadata: {
      reverification: {
        level: 'first_factor',
        afterMinutes: 5,
      },
    },
  },
};

export function toExportReverification(
  result: BeginExportResult,
): BeginExportResult | ExportReverificationHint {
  return result.kind === 'error' && result.errorCode === 'step_up_required' ? HINT : result;
}

export function isExportReverificationHint(
  result: BeginExportResult | ExportReverificationHint,
): result is ExportReverificationHint {
  return 'clerk_error' in result;
}

/**
 * Shown when the user closes the factor dialog, or verification fails.
 * Not a fault and not an error code — nothing was revealed, and clicking
 * again is the whole recovery.
 */
export const EXPORT_VERIFICATION_CANCELLED_MESSAGE =
  'Verification was cancelled or failed, so your recovery key was not revealed. Click Reveal my key to try again.';

/**
 * Shown when the api still demands step-up after a completed
 * verification — rare, and a "try once more", not a dead end.
 */
export const EXPORT_VERIFICATION_INCOMPLETE_MESSAGE =
  'We could not confirm it was you, so your recovery key was not revealed. Click Reveal my key to try again.';

/**
 * Clerk mounts its reverification modal on `document.body`, OUTSIDE the
 * onboarding dialog's Radix tree. A Radix dialog with `modal` set puts
 * `pointer-events: none` on the body and `aria-hidden` on everything
 * outside its own content, and traps focus — measured here, that leaves
 * Clerk's prompt VISIBLE but unclickable, unfocusable and untypeable, so
 * the step-up could never be completed from onboarding.
 *
 * The dialog therefore releases its modality for exactly the window the
 * prompt is up. Clerk renders its own full-screen backdrop, so nothing
 * behind is reachable meanwhile; the onboarding dialog's own overlay
 * (which Radix only renders in modal mode) returns as soon as the prompt
 * closes. Broadcast as a window event to keep this dependency one-way —
 * the export component never learns it is inside a dialog.
 */
export const EXPORT_REVERIFICATION_EVENT = 'wallet-export:reverification-active';

export function setExportReverificationActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(EXPORT_REVERIFICATION_EVENT, { detail: { active } }),
  );
}

export function readExportReverificationActive(event: Event): boolean {
  return (event as CustomEvent<{ active?: unknown }>).detail?.active === true;
}

/**
 * What the reveal click produced. `plain` marks a message that already
 * reads as a sentence and must be shown WITHOUT an `Error: <code>`
 * prefix — a step-up is a "try again", not a fault.
 */
export type RevealOutcome =
  | { readonly kind: 'bundle'; readonly bundle: BeginExportSuccess }
  | {
      readonly kind: 'error';
      readonly errorCode: string;
      readonly message: string;
      readonly plain: boolean;
    };

/**
 * Resolves one reveal attempt into what the UI should do.
 *
 * `dispatch` is the Clerk-reverification-wrapped export call: it opens
 * the factor dialog and repeats itself once on `step_up_required`, so by
 * the time it settles the user has already been given their one prompt.
 * Its three settlements map to the three outcomes here — a throw is a
 * cancelled/failed verification, a returned hint is a step-up that
 * survived the retry, and anything else is a real export result.
 */
export async function resolveExportOutcome(
  dispatch: () => Promise<BeginExportResult | ExportReverificationHint>,
): Promise<RevealOutcome> {
  let result: BeginExportResult | ExportReverificationHint;
  try {
    result = await dispatch();
  } catch {
    return {
      kind: 'error',
      errorCode: 'reverification_failed',
      message: EXPORT_VERIFICATION_CANCELLED_MESSAGE,
      plain: true,
    };
  }
  if (isExportReverificationHint(result)) {
    return {
      kind: 'error',
      errorCode: 'step_up_required',
      message: EXPORT_VERIFICATION_INCOMPLETE_MESSAGE,
      plain: true,
    };
  }
  if (result.kind === 'ok') return { kind: 'bundle', bundle: result };
  if (result.kind === 'reauth') {
    return {
      kind: 'error',
      errorCode: 'reauth_required',
      message: 'Session expired. Sign in again to continue.',
      plain: false,
    };
  }
  if (result.kind === 'rate_limited') {
    return {
      kind: 'error',
      errorCode: 'export_rate_limited',
      message: `Rate limited. Retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`,
      plain: false,
    };
  }
  if (result.kind === 'network_error') {
    return {
      kind: 'error',
      errorCode: 'network_error',
      message: result.reason,
      plain: false,
    };
  }
  return { kind: 'error', errorCode: result.errorCode, message: result.message, plain: false };
}

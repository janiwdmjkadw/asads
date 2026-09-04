/**
 * The controls row's model, and the sentences it says.
 *
 * Affordance visibility comes from the port's `isCancellable` /
 * `isResumable` — the same predicates that mirror what the server will
 * actually accept — never from a local reading of the state string. An
 * unrecognised state therefore offers NO actions, which is the safe
 * degradation: this build cannot know whether a new server state is
 * cancellable.
 *
 * There is deliberately no "pause" action: the user-facing api exposes
 * cancel and resume only (`POST /api/trade/conditionals/:id/cancel` and
 * `/resume`). Pausing is server-initiated (budget exhaustion, withdrawal
 * auto-pause), so the surface renders the paused state and offers the
 * resume that reverses it.
 *
 * ONE pause reason overrides that resume, and it is not a local reading
 * of the state string: `exit_failed` is terminal at the SERVER, which
 * answers resume with a 409 `exit_failed_terminal`. Suppressing the
 * control there is still "mirror what the server will accept" — the
 * predicate simply lives in the pause block rather than the state.
 */

import type {
  ConditionalMutationResult,
  ConditionalPause,
  ConditionalState,
  TradeControlError,
  TradeControlResult,
} from '@/lib/conditionals';
import { isCancellable, isResumable } from '@/lib/conditionals';
import { pauseFunded, shortfallText } from './detail-model';
import { errorGuidance, type Guidance } from './guidance';
import type { ConditionalLineage } from './lineage';

// ───────────────────────── the locked copy ─────────────────────────

/**
 * THE SENTENCES ARE THE DESIGN (design-29 §Controls, locked). They live
 * here as constants rather than in the JSX because they are the thing the
 * tests assert and the thing an editor changes; a phrase that only exists
 * inside a component gets re-typed the next time someone touches markup.
 */
export const CANCEL_ENTRY = 'Cancel this plan';
/** Step two, in place of the entry — the question, then the two answers. */
export const CANCEL_ASK = 'Cancel this order? It can still fire until confirmed.';
export const CANCEL_KEEP = 'Keep watching';
export const CANCEL_CONFIRM = 'Cancel order';
/** After. Not a toast: the row itself says what is now true. */
export const CANCEL_DONE = 'It will not fire again. Nothing was spent.';

export const EDIT_ENTRY = 'Edit in chat';
export const EDIT_LINE =
  'The agent writes the change as a new plan and you approve it, the same way you ' +
  'approved this one. This one keeps watching until you do.';

export const RESUME_ENTRY = 'Resume';
export const FUND_ENTRY = 'Add funds';

/** Which of the two things a paused plan's primary control can be. */
export type ResumeAffordance = 'none' | 'resume' | 'fund';

export interface FundLine {
  readonly lead: string;
  /** The SOL figure, when the wire served a shortfall. */
  readonly amount: string | null;
  readonly trail: string;
}

export interface ControlsModel {
  readonly canCancel: boolean;
  /**
   * `resume` ONLY when the wallet provably covers what the plan needs.
   * Offering Resume against an empty wallet is a button that fails — the
   * server refuses the arm check — so an unfunded pause offers funding
   * instead, and a pause we cannot price offers Resume and lets the server
   * be the authority on whether it takes.
   */
  readonly resume: ResumeAffordance;
  /** The sentence under an `Add funds` primary. `null` otherwise. */
  readonly fundLine: FundLine | null;
  readonly canEdit: boolean;
  /** The server's own refusal, in words. Empty when editing is offered. */
  readonly editReason: string;
}

export function detailControls(input: {
  readonly state: ConditionalState;
  readonly pause?: ConditionalPause | null | undefined;
  readonly lineage: ConditionalLineage;
}): ControlsModel {
  const funded = pauseFunded(input.pause);
  // `exit_failed` is TERMINAL. The server answers resume with a 409
  // `exit_failed_terminal`, so both ways out of a pause are lies here:
  // Resume is refused, and Add funds implies money is what is missing
  // when the exit leg simply gave up. The row falls back to the pause
  // sentence (`pauseReason`) plus Cancel, which is the only move that
  // still does anything.
  const exitFailed = input.pause?.reason === 'exit_failed';
  const resume: ResumeAffordance =
    !isResumable(input.state) || exitFailed
      ? 'none'
      : funded === false
        ? 'fund'
        : 'resume';
  const shortfall = shortfallText(input.pause);
  return {
    canCancel: isCancellable(input.state),
    resume,
    fundLine:
      resume !== 'fund'
        ? null
        : shortfall === null
          ? { lead: 'Add what it is short of and this starts watching again on its own', amount: null, trail: '' }
          : { lead: 'Send', amount: shortfall, trail: 'and this starts watching again on its own' },
    canEdit: input.lineage.modifiable,
    editReason: input.lineage.modifiable ? '' : input.lineage.modifiableReason,
  };
}

export type MutationFeedback =
  | {
      readonly kind: 'done';
      /** WHICH control landed. The row says a different thing for each. */
      readonly action: 'cancel' | 'resume';
      readonly state: ConditionalState;
      readonly message: string;
      /**
       * The server answered `repeat: true`: the CAS matched no row
       * because the conditional was ALREADY in the requested state.
       * That is a 200 and an idempotent success, NOT a failure.
       */
      readonly repeat: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly action: 'cancel' | 'resume';
      readonly guidance: Guidance;
      readonly error: TradeControlError;
    };

/**
 * Interpret a cancel/resume result. Both arms of the port's `Result` are
 * handled; nothing here throws.
 */
export function mutationFeedback(
  action: 'cancel' | 'resume',
  result: TradeControlResult<ConditionalMutationResult>,
): MutationFeedback {
  if (!result.ok) {
    return { kind: 'failed', action, guidance: errorGuidance(result.error), error: result.error };
  }
  const repeat = result.value.repeat === true;
  const message =
    action === 'cancel'
      ? repeat
        ? 'Already cancelled, nothing further to do.'
        : 'Cancelled. This authorization will not fire again.'
      : repeat
        ? 'Already armed, nothing further to do.'
        : 'Resumed. This authorization is armed again.';
  return { kind: 'done', action, state: result.value.state, message, repeat };
}

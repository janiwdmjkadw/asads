/**
 * Pure classification of the two network outcomes the card cares about:
 * loading the canonical proposal, and posting a decision.
 *
 * The port never throws and never rejects — every call answers
 * `{ok:true,value} | {ok:false,error}` — so this module is a total
 * function over that union. Every refusal lands in a NAMED phase with
 * an explicit affordance; nothing falls through to a spinner
 * (04-frontend.md invariant 5: silent hangs are bugs).
 */

import { isApiError } from '@/lib/conditionals';
import type {
  DecisionResult,
  ProposalDecision,
  ProposalDetail,
  ReauthRequiredError,
  TradeControlError,
  TradeControlResult,
} from '@/lib/conditionals';

// ───────────────────────── loading ─────────────────────────

/**
 * The whole trade-control surface 404s unless `EXEC_TRADE_CONTROL_ENABLED`
 * is on and a `tc_api_rt` DSN is configured, in which case the route is
 * not registered at all and the 404 body is NOT a trade-control error
 * body. That is a different user-facing story from "this proposal id
 * does not exist", and the two are distinguished here.
 */
export type ProposalLoadPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: ProposalDetail }
  | { readonly kind: 'not_found' }
  /** Trade control is not enabled on this deployment. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean };

export function classifyLoad(result: TradeControlResult<ProposalDetail>): ProposalLoadPhase {
  if (result.ok) return { kind: 'ready', detail: result.value };
  const { error } = result;
  if (isApiError(error)) {
    if (error.body.error_code === 'proposal_not_found') return { kind: 'not_found' };
    if (error.status === 404) return { kind: 'unavailable' };
    return { kind: 'error', message: error.body.message, retryable: false };
  }
  // A 404 whose body was not JSON is the un-registered route: Next or
  // the proxy answered, not the trade-control plugin.
  if (error.status === 404) return { kind: 'unavailable' };
  return { kind: 'error', message: error.message, retryable: error.reason !== 'aborted' };
}

// ───────────────────────── deciding ─────────────────────────

/** The `refresh` block the 409 body names, ready to drive a button. */
export interface ReauthAffordance {
  readonly reason: string;
  readonly walletAccountId: string;
  readonly method: string;
  readonly path: string;
  readonly body: { readonly wallet_account_id: string };
  readonly authorizationExpiresAtMs: number | null;
  readonly requiredUntilMs: number | null;
  readonly shortfallMs: number | null;
}

export type DecisionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting'; readonly decision: ProposalDecision }
  /**
   * The server committed the decision. `repeat` marks the idempotent
   * replay of an ALREADY-committed decision (a double-click) — a 200
   * and a success, never an error.
   */
  | {
      readonly kind: 'settled';
      readonly decision: ProposalDecision;
      readonly result: DecisionResult;
      readonly repeat: boolean;
    }
  /**
   * 403 `step_up_stale` (NOT `step_up_required`). The proposal is
   * untouched and still pending: re-verify, then post the same decision
   * again.
   */
  | {
      readonly kind: 'step_up';
      readonly decision: ProposalDecision;
      readonly exposureLamports: number | null;
      readonly message: string;
    }
  /** 409 `reauth_required`. Proposal stays pending; refresh, then retry. */
  | {
      readonly kind: 'reauth';
      readonly decision: ProposalDecision;
      readonly affordance: ReauthAffordance;
      readonly message: string;
    }
  /**
   * Any other refusal. `refetch` means the server record moved under us
   * (already decided, expired, superseded) and the card must re-read
   * server truth rather than argue with it.
   */
  | {
      readonly kind: 'refused';
      readonly decision: ProposalDecision;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly refetch: boolean;
    };

function errorMessage(error: TradeControlError): string {
  return error.kind === 'api' ? error.body.message : error.message;
}

function readNumberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read the `refresh` block off a `reauth_required` body. The server
 * names the exact call to make; the UI must not hardcode it. A body
 * missing the block still yields an affordance pointing at the
 * documented path, so the user is never dead-ended.
 */
export function reauthAffordance(body: Record<string, unknown>): ReauthAffordance | null {
  const walletFromBody = body['wallet_account_id'];
  const refresh = body['refresh'];
  const refreshRecord =
    typeof refresh === 'object' && refresh !== null ? (refresh as Record<string, unknown>) : null;
  const refreshBody = refreshRecord?.['body'];
  const refreshBodyRecord =
    typeof refreshBody === 'object' && refreshBody !== null ? (refreshBody as Record<string, unknown>) : null;
  const walletAccountId =
    typeof walletFromBody === 'string' && walletFromBody !== ''
      ? walletFromBody
      : typeof refreshBodyRecord?.['wallet_account_id'] === 'string'
        ? (refreshBodyRecord['wallet_account_id'] as string)
        : null;
  if (walletAccountId === null) return null;
  const method = typeof refreshRecord?.['method'] === 'string' ? (refreshRecord['method'] as string) : 'POST';
  const path =
    typeof refreshRecord?.['path'] === 'string' && refreshRecord['path'] !== ''
      ? (refreshRecord['path'] as string)
      : '/api/v1/wallet/auth/refresh';
  const reason = typeof body['reason'] === 'string' ? (body['reason'] as string) : 'reauth_required';
  return {
    reason,
    walletAccountId,
    method,
    path,
    body: { wallet_account_id: walletAccountId },
    authorizationExpiresAtMs: readNumberField(body, 'authorization_expires_at_ms'),
    requiredUntilMs: readNumberField(body, 'required_until_ms'),
    shortfallMs: readNumberField(body, 'shortfall_ms'),
  };
}

/** Human line for a `reauth_required` reason, unknown reasons included. */
export function reauthReasonText(reason: string): string {
  switch (reason) {
    case 'no_active_authorization':
      return 'This agent wallet has no active trading authorization.';
    case 'authorization_revoked':
      return 'The trading authorization for this agent wallet was revoked.';
    case 'authorization_expires_too_soon':
      return 'The trading authorization expires before this authorization would finish.';
    default:
      return 'The agent wallet needs its trading authorization refreshed.';
  }
}

/** Refusals that mean the SERVER record moved — re-read it. */
const REFETCH_CODES = new Set([
  'decision_conflict',
  'proposal_expired',
  'stale_revision',
  'proposal_not_found',
]);

/**
 * Classify a decision response.
 *
 * NOTE the two things that are NOT errors: `repeat: true` on a 200 (the
 * idempotent replay of the same decision), and every phase below that
 * leaves the proposal PENDING — those are retry affordances, not
 * failures.
 */
export function classifyDecision(
  decision: ProposalDecision,
  result: TradeControlResult<DecisionResult>,
): DecisionPhase {
  if (result.ok) {
    return {
      kind: 'settled',
      decision,
      result: result.value,
      repeat: result.value.repeat === true,
    };
  }
  const { error } = result;

  if (isApiError(error)) {
    const { body } = error;
    // 403, and the proposal is STILL PENDING: re-verify, then retry.
    if (body.error_code === 'step_up_stale') {
      return {
        kind: 'step_up',
        decision,
        exposureLamports: readNumberField(body, 'exposure_lamports'),
        message: body.message,
      };
    }
    // 409, machine-actionable: the body names the refresh call.
    if (body.error_code === 'reauth_required') {
      const affordance = reauthAffordance(body as unknown as ReauthRequiredError & Record<string, unknown>);
      if (affordance !== null) {
        return { kind: 'reauth', decision, affordance, message: body.message };
      }
    }
    const code = String(body.error_code);
    return {
      kind: 'refused',
      decision,
      code,
      message: body.message,
      retryable: false,
      refetch: REFETCH_CODES.has(code),
    };
  }

  return {
    kind: 'refused',
    decision,
    code: `network_${error.reason}`,
    message: errorMessage(error),
    retryable: error.reason !== 'aborted',
    refetch: false,
  };
}

/**
 * Tolerant parsing for the trade-control port.
 *
 * 04-frontend.md invariant 3: additive server changes must never break a
 * deployed client. Nothing in this module throws. Unknown enum members,
 * unknown notice kinds, unknown timeline transitions and missing
 * optional blocks all degrade to a renderable neutral value.
 *
 * These helpers do NOT re-derive server state. They classify what the
 * server said so the UI can branch, and they say so explicitly when the
 * server said something this build does not recognise.
 */

import type {
  AgentWalletReadiness,
  AgentWalletState,
  AuthorizationNoticeKind,
  ConditionalState,
  ConditionalTransition,
  DurableAuthorizationState,
  ExecutionState,
  FiringState,
  LegState,
  TradeControlErrorBody,
  TradeControlErrorCode,
} from './types';

/** Every `conditionals.state` value this build knows (migration 0072). */
export const KNOWN_CONDITIONAL_STATES = [
  'draft',
  'pending_auth',
  'armed',
  'paused',
  'cancel_requested',
  'cancelled',
  'completed',
  'expired',
  'expiry_pending',
  'budget_paused',
] as const;

export const KNOWN_LEG_STATES = [
  'pending',
  'armed',
  'paused',
  'fired',
  'completed',
  'expired',
  'cancelled',
] as const;

export const KNOWN_FIRING_STATES = [
  'claimed',
  'dispatched',
  'guardrail_rejected',
  'filled',
  'failed',
  'unknown',
  'expired',
] as const;

export const KNOWN_EXECUTION_STATES = [
  'pending',
  'dispatched',
  'accepted',
  'unknown',
  'filled',
  'failed',
  'rejected',
] as const;

export const KNOWN_AGENT_WALLET_STATES = [
  'user_created',
  'turnkey_suborg_pending',
  'wallet_pending',
  'policy_pending',
  'wallet_ready_needs_nonce_setup',
  'nonces_pending',
  'wallet_ready_needs_backup',
  'wallet_ready_needs_passkey_root',
  'ready_to_trade',
  'blocked',
] as const;

export const KNOWN_NOTICE_KINDS = [
  'universe_choice',
  'post_expiry_protective_legs',
  'cancel_with_bound_position',
  'edit_in_flight_claims',
  'withdrawal_auto_pause',
  'non_default_knob',
  'clamped_knob',
] as const;

/**
 * The transitions this build renders with a bespoke label. The column is
 * plain `text` and the journal is insert-only, so this is DOCUMENTATION,
 * not a closed set — always keep a fallback branch.
 */
export const KNOWN_CONDITIONAL_TRANSITIONS = [
  'armed',
  'paused',
  'resumed',
  'cancelled',
  'completed',
  'expired',
  'edited',
  'budget_paused',
  'fired',
  'firing_claimed',
  'firing_settled',
  'partial_abandoned',
] as const;

function isMember(members: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && members.includes(value);
}

export function isKnownConditionalState(value: ConditionalState): boolean {
  return isMember(KNOWN_CONDITIONAL_STATES, value);
}

export function isKnownLegState(value: LegState): boolean {
  return isMember(KNOWN_LEG_STATES, value);
}

export function isKnownFiringState(value: FiringState): boolean {
  return isMember(KNOWN_FIRING_STATES, value);
}

export function isKnownExecutionState(value: ExecutionState): boolean {
  return isMember(KNOWN_EXECUTION_STATES, value);
}

export function isKnownAgentWalletState(value: AgentWalletState): boolean {
  return isMember(KNOWN_AGENT_WALLET_STATES, value);
}

export function isKnownNoticeKind(value: AuthorizationNoticeKind): boolean {
  return isMember(KNOWN_NOTICE_KINDS, value);
}

export function isKnownConditionalTransition(value: ConditionalTransition): boolean {
  return isMember(KNOWN_CONDITIONAL_TRANSITIONS, value);
}

/**
 * Product rollup of the server's conditional state. An unrecognised
 * state becomes `'unknown'` — the UI shows the raw state string and no
 * action affordances, rather than guessing that a new state is safe to
 * cancel or resume.
 */
export function durableAuthorizationState(state: ConditionalState): DurableAuthorizationState {
  switch (state) {
    case 'armed':
      return 'active';
    case 'paused':
    case 'budget_paused':
      return 'paused';
    case 'cancelled':
    case 'cancel_requested':
      return 'revoked';
    case 'completed':
    case 'expired':
    case 'expiry_pending':
      return 'finished';
    case 'draft':
    case 'pending_auth':
      return 'pending';
    default:
      return 'unknown';
  }
}

/** Cancel is offered only for states the server can actually cancel. */
export function isCancellable(state: ConditionalState): boolean {
  return state === 'armed' || state === 'paused' || state === 'budget_paused';
}

/**
 * Resume is offered only for a paused conditional. `armed` is excluded
 * on purpose: the server answers `{repeat: true}` there, which is
 * correct but not worth surfacing as an action.
 */
export function isResumable(state: ConditionalState): boolean {
  return state === 'paused' || state === 'budget_paused';
}

/**
 * Classify the agent-wallet readiness the SERVER reported. Readiness is
 * never inferred: `readyToTrade` is true only for the literal
 * `ready_to_trade`, whose sole production writer is the backend.
 */
export function agentWalletReadiness(state: AgentWalletState): AgentWalletReadiness {
  const known = isKnownAgentWalletState(state);
  return {
    state,
    readyToTrade: state === 'ready_to_trade',
    provisioning:
      known &&
      state !== 'ready_to_trade' &&
      state !== 'blocked',
    blocked: state === 'blocked',
    unknown: !known,
  };
}

/**
 * Read an error body out of an arbitrary JSON value. Anything that is
 * not a recognisable `{error_code, message}` object becomes a
 * `malformed_error_body` record — the caller still gets a typed error
 * instead of a thrown string.
 */
export function parseErrorBody(value: unknown): TradeControlErrorBody {
  if (typeof value !== 'object' || value === null) {
    return { error_code: 'malformed_error_body', message: 'the server sent a non-object error body' };
  }
  const record = value as Record<string, unknown>;
  const code = record['error_code'];
  const message = record['message'];
  if (typeof code !== 'string' || code === '') {
    return {
      ...record,
      error_code: 'malformed_error_body',
      message: typeof message === 'string' ? message : 'the server sent an error body with no error_code',
    };
  }
  return {
    ...record,
    error_code: code as TradeControlErrorCode,
    // An unknown code must still render SOMETHING; fall back to the code.
    message: typeof message === 'string' && message !== '' ? message : code,
  };
}

/**
 * Presentation helpers: numbers to text, server codes to sentences.
 *
 * These functions decide how state READS, never what the state IS. In
 * particular nothing here touches `ready_to_trade` — the readiness card
 * renders the server's boolean and uses {@link blockerLabel} only to
 * explain it.
 *
 * Every mapping has an explicit fallback that shows the raw server value
 * instead of hiding it, so a code this build has never seen still tells
 * the user something true.
 */

import type {
  AgentWalletDelegation,
  DelegationState,
  EnumValue,
  FundingState,
  ReadinessBlocker,
} from './types';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Decimal-string lamports to a SOL string. Returns `null` for a missing
 * or unparseable value so callers render "unknown" rather than "0".
 */
export function lamportsToSol(lamports: string | null): string | null {
  if (lamports === null || !/^-?\d+$/.test(lamports)) return null;
  let value: bigint;
  try {
    value = BigInt(lamports);
  } catch {
    return null;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  const text = frac.length === 0 ? `${whole}` : `${whole}.${frac}`;
  return negative ? `-${text}` : text;
}

/** `lamportsToSol` with the unit and an explicit unknown. */
export function solText(lamports: string | null): string {
  const sol = lamportsToSol(lamports);
  return sol === null ? 'unknown' : `${sol} SOL`;
}

const FUNDING_COPY: Readonly<Record<FundingState, string>> = {
  unknown: 'Balance unavailable — the balance service did not answer. This is a reporting gap, not a statement that the wallet is empty.',
  unfunded: 'Not funded yet. Send SOL to the funding address below to continue.',
  insufficient: 'Funded, but below what provisioning still needs. Send the shortfall to the funding address below.',
  funded: 'Funded — the balance covers what provisioning still needs.',
};

export function fundingCopy(state: EnumValue<FundingState>): string {
  if (state.known === null) {
    return `Unrecognised funding state "${state.raw || 'missing'}" — treated as not funded. Update the terminal, or send SOL to the funding address below.`;
  }
  return FUNDING_COPY[state.known];
}

const BLOCKER_LABEL: Readonly<Record<ReadinessBlocker, string>> = {
  agent_wallet_missing: 'No agent wallet exists yet.',
  user_blocked: 'This account is not permitted to trade.',
  not_provisioned_complete: 'Account provisioning has not finished.',
  wallet_account_disabled: 'The agent wallet account is not active.',
  wallet_disabled: 'The agent wallet is disabled.',
  wallet_archived: 'The agent wallet is archived.',
  no_active_authorization: 'There is no active trading authorization for this wallet.',
  policy_version_disabled: 'The trading policy version in force has been disabled.',
  authorization_revoked: 'The trading authorization was revoked.',
  authorization_expired: 'The trading authorization has expired.',
  nonce_pool_incomplete: 'The nonce pool is not fully provisioned.',
};

export function blockerLabel(blocker: EnumValue<ReadinessBlocker>): string {
  if (blocker.known === null) {
    return `Blocked by "${blocker.raw || 'an unnamed condition'}" — this terminal does not recognise that reason.`;
  }
  return BLOCKER_LABEL[blocker.known];
}

/**
 * How the delegation reads to its owner.
 *
 * `paused` covers two materially different situations and the user's
 * next step differs between them, so they are separated here:
 *
 *  - NEVER GRANTED (`granted_at` null, `revoked_at` null) — nothing has
 *    happened yet. The user can authorize it themselves from the card.
 *  - GRANTED BUT NOT IN FORCE (`granted_at` set, `revoked_at` null) —
 *    the grant exists; something about the wallet is holding it back.
 *    Granting again would change nothing, so the card does not offer it.
 *
 * `revoked` likewise splits on whether OUR delegation carries the
 * revocation or the underlying authorization does.
 */
export type DelegationPresentation =
  | 'active'
  | 'never_granted'
  | 'granted_not_in_force'
  | 'revoked'
  | 'authorization_revoked'
  | 'unrecognised';

export function delegationPresentation(
  delegation: AgentWalletDelegation,
): DelegationPresentation {
  const state: DelegationState | null = delegation.state.known;
  if (state === null) return 'unrecognised';
  if (state === 'active') return 'active';
  if (state === 'revoked') {
    return delegation.revokedAt === null ? 'authorization_revoked' : 'revoked';
  }
  return delegation.grantedAt === null ? 'never_granted' : 'granted_not_in_force';
}

export const DELEGATION_HEADLINE: Readonly<Record<DelegationPresentation, string>> = {
  active: 'Active',
  never_granted: 'Paused — never granted',
  granted_not_in_force: 'Paused — granted, not in force',
  revoked: 'Revoked',
  authorization_revoked: 'Revoked — no active authorization',
  unrecognised: 'Unrecognised',
};

export const DELEGATION_DETAIL: Readonly<Record<DelegationPresentation, string>> = {
  active:
    'The agent can trade this wallet with no browser tab open and no periodic sign-in. Revoke below to end that at any time.',
  never_granted:
    'Durable authorization has never been granted for this wallet, so the agent can only trade while you are signed in. Authorize it below to let it keep working when you are not.',
  granted_not_in_force:
    'A durable authorization exists but is not in force right now. Clear the readiness blockers above and it resumes on its own; nothing has been revoked, and re-authorizing would change nothing.',
  revoked:
    'Durable authorization was revoked, so the agent cannot trade this wallet while you are signed out. You can authorize it again below whenever you want to.',
  authorization_revoked:
    'The underlying trading authorization is revoked or gone, so there is nothing for a durable delegation to attach to. That has to be restored before hands-off trading can be authorized again — contact support.',
  unrecognised:
    'This terminal does not recognise the delegation state the server reported, so it is treated as NOT in force. Update the terminal before relying on it.',
};

/** ISO timestamp to a compact absolute label; `null` stays "—". */
export function timestampText(iso: string | null): string {
  if (iso === null) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

/**
 * Degraded-state guidance for the conditionals surface.
 *
 * 04-frontend.md invariant 5: degraded states are EXPLICIT, and a
 * silent hang is a bug. Everything here answers "what do I do now?",
 * not just "what went wrong".
 *
 * Readiness is never inferred in the browser: the caller passes the
 * `AgentWalletReadiness` the port derived from the SERVER's
 * `/api/v1/me` `provisioning.state`, and this module only chooses words
 * for it.
 */

import type { AgentWalletReadiness, TradeControlError } from '@/lib/conditionals';
import { isApiError } from '@/lib/conditionals';

export type GuidanceSeverity = 'info' | 'warn' | 'blocked';

/**
 * The action a guidance notice asks for. Callers wire the handlers they
 * have; a notice whose handler is absent still renders its instruction
 * as text, never as a dead button.
 */
export type GuidanceActionKind =
  | 'open_wallet_setup'
  | 'refresh_authorization'
  | 'retry'
  | 'contact_support'
  | 'none';

export interface Guidance {
  readonly kind: string;
  readonly severity: GuidanceSeverity;
  readonly title: string;
  /** What happened, in the user's terms. */
  readonly detail: string;
  /** What to do about it. Never empty. */
  readonly nextStep: string;
  readonly action: GuidanceActionKind;
  readonly actionLabel: string;
}

/**
 * Wallet readiness gate. Returns `null` when the server says the wallet
 * is ready to trade — the only state that is allowed to mean "ready".
 */
export function walletGuidance(readiness: AgentWalletReadiness): Guidance | null {
  if (readiness.readyToTrade) return null;
  if (readiness.blocked) {
    return {
      kind: 'wallet_blocked',
      severity: 'blocked',
      title: 'Trading wallet blocked',
      detail: 'The server has blocked this account’s trading wallet, so no conditional can arm or fire.',
      nextStep: 'Existing conditionals stay visible and can still be cancelled. Contact support to unblock the wallet.',
      action: 'contact_support',
      actionLabel: 'Contact support',
    };
  }
  if (readiness.unknown) {
    return {
      kind: 'wallet_unknown',
      severity: 'warn',
      title: 'Wallet status unrecognised',
      detail: `The server reported wallet state “${readiness.state}”, which this version of the terminal does not recognise.`,
      nextStep: 'Reload the page to pick up the current build. Your conditionals are unaffected and remain listed below.',
      action: 'retry',
      actionLabel: 'Reload',
    };
  }
  return {
    kind: 'wallet_not_ready',
    severity: 'warn',
    title: 'Trading wallet not ready',
    detail: `Wallet setup is still at “${readiness.state}”. Conditionals cannot arm or fire until the wallet is ready to trade.`,
    nextStep: 'Finish wallet setup, it takes a moment and picks up automatically when the server completes provisioning.',
    action: 'open_wallet_setup',
    actionLabel: 'Finish wallet setup',
  };
}

/**
 * The 409 `reauth_required` family, plus the durable "revoked" reading of
 * it. The proposal/conditional is NOT lost: the server keeps it pending
 * and the same decision succeeds once the authorization is refreshed.
 */
export function authorizationGuidance(reason: string, walletLabel?: string): Guidance {
  const wallet = walletLabel === undefined || walletLabel === '' ? 'this wallet' : walletLabel;
  if (reason === 'authorization_revoked') {
    return {
      kind: 'authorization_revoked',
      severity: 'blocked',
      title: 'Trading authorization revoked',
      detail: `The trading authorization for ${wallet} was revoked, so the server will not arm or fire this conditional.`,
      nextStep: `Re-authorize ${wallet}, then approve the conditional again, nothing was lost, it is still waiting on your decision.`,
      action: 'refresh_authorization',
      actionLabel: 'Re-authorize wallet',
    };
  }
  if (reason === 'authorization_expires_too_soon') {
    return {
      kind: 'authorization_expires_too_soon',
      severity: 'warn',
      title: 'Authorization expires too soon',
      detail: `The trading authorization for ${wallet} runs out before this conditional does.`,
      nextStep: `Refresh the authorization for ${wallet} and approve again; the conditional stays pending until you do.`,
      action: 'refresh_authorization',
      actionLabel: 'Refresh authorization',
    };
  }
  if (reason === 'no_active_authorization') {
    return {
      kind: 'no_active_authorization',
      severity: 'blocked',
      title: 'No trading authorization',
      detail: `${wallet} has no usable trading authorization.`,
      nextStep: `Authorize ${wallet} for trading, then approve the conditional again.`,
      action: 'refresh_authorization',
      actionLabel: 'Authorize wallet',
    };
  }
  return {
    kind: 'reauth_required',
    severity: 'warn',
    title: 'Trading authorization needs attention',
    detail: `The server refused with “${reason}”.`,
    nextStep: `Refresh the authorization for ${wallet} and try again.`,
    action: 'refresh_authorization',
    actionLabel: 'Refresh authorization',
  };
}

/**
 * Turn any port error into something actionable.
 *
 * A 404 across the whole surface is the deployment-level case: the
 * trade-control routes are unregistered unless the server has
 * `EXEC_TRADE_CONTROL_ENABLED` and a trade-control DSN. That is not a
 * user error and must not render as one.
 */
export function errorGuidance(error: TradeControlError): Guidance {
  if (error.kind === 'network') {
    if (error.reason === 'aborted') {
      return {
        kind: 'aborted',
        severity: 'info',
        title: 'Request cancelled',
        detail: 'The request was cancelled before the server answered.',
        nextStep: 'Try again.',
        action: 'retry',
        actionLabel: 'Retry',
      };
    }
    return {
      kind: 'unreachable',
      severity: 'warn',
      title: 'Conditionals are unreachable',
      detail: 'The terminal could not read the trade-control service.',
      nextStep: 'Retry in a moment. Your authorizations are unaffected, this is a read failure, not a change to them.',
      action: 'retry',
      actionLabel: 'Retry',
    };
  }

  const code = error.body.error_code;
  if (error.status === 404 && code !== 'conditional_not_found') {
    return {
      kind: 'surface_unavailable',
      severity: 'info',
      title: 'Conditionals are not enabled here',
      detail: 'This environment does not serve the trade-control surface.',
      nextStep: 'Nothing to do, conditional orders are unavailable on this deployment.',
      action: 'none',
      actionLabel: '',
    };
  }
  if (code === 'conditional_not_found') {
    return {
      kind: 'not_found',
      severity: 'info',
      title: 'Conditional not found',
      detail: 'No conditional with that id belongs to this account.',
      nextStep: 'Pick another conditional from the list.',
      action: 'none',
      actionLabel: '',
    };
  }
  if (code === 'reauth_required') {
    const reason = error.body['reason'];
    return authorizationGuidance(typeof reason === 'string' ? reason : 'reauth_required');
  }
  if (code === 'exit_failed_terminal') {
    // 0189: the one pause resume REFUSES. The server's `message` is
    // written to be shown as it stands, so it is passed through
    // untouched — this branch exists only so the answer is not dressed as
    // the retryable failure the fallthrough would make of it.
    return {
      kind: 'exit_failed_terminal',
      severity: 'warn',
      title: 'This plan has ended',
      detail: error.body.message,
      nextStep: 'Cancel this plan, resuming it will keep being refused.',
      action: 'none',
      actionLabel: '',
    };
  }
  if (code === 'not_resumable' || code === 'conditional_not_editable') {
    const state = error.body['state'];
    return {
      kind: code,
      severity: 'info',
      title: code === 'not_resumable' ? 'Cannot resume' : 'Cannot modify',
      detail:
        typeof state === 'string'
          ? `The server reports this conditional is “${state}”.`
          : error.body.message,
      nextStep: 'Reload the conditional to see its current state, it changed since this page loaded.',
      action: 'retry',
      actionLabel: 'Reload',
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      kind: 'signed_out',
      severity: 'warn',
      title: 'Session needs refreshing',
      detail: 'The server did not accept this session.',
      nextStep: 'Sign in again, then reopen this page.',
      action: 'retry',
      actionLabel: 'Retry',
    };
  }
  // Unknown error codes must still render their message (invariant 3).
  return {
    kind: String(code),
    severity: 'warn',
    title: 'The server refused',
    detail: error.body.message,
    nextStep: 'Retry; if it keeps failing, nothing was changed by this attempt.',
    action: 'retry',
    actionLabel: 'Retry',
  };
}

/** Convenience for callers holding a raw error: is this the whole-surface 404? */
export function isSurfaceDisabled(error: TradeControlError): boolean {
  return (
    isApiError(error) && error.status === 404 && error.body.error_code !== 'conditional_not_found'
  );
}

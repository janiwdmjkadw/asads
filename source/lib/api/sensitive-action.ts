'use client';

import { fetchAuthenticatedApi } from './trading';

/** Mirrors `SensitiveAction` in `api/src/auth/sensitive-action.ts`. */
export type SensitiveAction =
  | 'wallet_export'
  | 'wallet_withdraw'
  | 'agent_wallet_delegation_grant';

export type SensitiveActionChallengeResult =
  | { kind: 'ok'; challengeId: string; challengeToken: string }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'step_up_required' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export async function requestSensitiveActionChallenge(
  input: {
    action: SensitiveAction;
    walletAccountId?: string | null;
  },
  options: { authToken?: string | null; signal?: AbortSignal } = {},
): Promise<SensitiveActionChallengeResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallet/security/sensitive-action-challenge',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: input.action,
          ...(input.walletAccountId ? { wallet_account_id: input.walletAccountId } : {}),
        }),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    const reason =
      typeof json['reason'] === 'string'
        ? (json['reason'] as 'no_session' | 'session_expired' | 'session_invalid')
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (res.status === 403 && json['error_code'] === 'step_up_required') {
    return { kind: 'step_up_required' };
  }
  if (res.ok && json['reauth_required'] === false) {
    const challengeId = json['challenge_id'];
    const challengeToken = json['challenge_token'];
    if (typeof challengeId === 'string' && typeof challengeToken === 'string') {
      return { kind: 'ok', challengeId, challengeToken };
    }
    return {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    };
  }
  const errorCode = typeof json['error_code'] === 'string' ? json['error_code'] : 'unknown';
  const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
  return { kind: 'error', status: res.status, errorCode, message };
}

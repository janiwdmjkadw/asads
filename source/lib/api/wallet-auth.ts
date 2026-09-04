'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Auth TTL refresh" client. Calls
 *   POST /api/v1/wallet/auth/refresh
 * to slide `authorization_expires_at` to `now() + TURNKEY_DA_KEY_TTL_S`.
 *
 * This is NOT a Clerk session refresh. A user whose Clerk session has
 * expired must re-login through Clerk; this client surfaces `reauth`
 * unchanged from the api/ shape.
 */

export interface RefreshAuthorizationSuccess {
  kind: 'ok';
  authorizationId: string;
  expiresAt: string;
  refreshedFrom: string;
  ttlSeconds: number;
}

export type RefreshAuthorizationResult =
  | RefreshAuthorizationSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export async function refreshAuthorization(
  signal?: AbortSignal,
  authToken?: string | null,
  walletAccountId?: string | null,
): Promise<RefreshAuthorizationResult> {
  const body =
    typeof walletAccountId === 'string' && walletAccountId.length > 0
      ? { wallet_account_id: walletAccountId }
      : {};
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallet/auth/refresh',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken, signal },
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
  if (res.ok && json['reauth_required'] === false) {
    const authz = json['trading_authorization'];
    if (
      authz &&
      typeof authz === 'object' &&
      typeof (authz as { authorization_id?: unknown }).authorization_id === 'string' &&
      typeof (authz as { expires_at?: unknown }).expires_at === 'string' &&
      typeof (authz as { refreshed_from?: unknown }).refreshed_from === 'string' &&
      typeof (authz as { ttl_s?: unknown }).ttl_s === 'number'
    ) {
      const a = authz as {
        authorization_id: string;
        expires_at: string;
        refreshed_from: string;
        ttl_s: number;
      };
      return {
        kind: 'ok',
        authorizationId: a.authorization_id,
        expiresAt: a.expires_at,
        refreshedFrom: a.refreshed_from,
        ttlSeconds: a.ttl_s,
      };
    }
    return {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    };
  }
  const errorCode =
    typeof json['error_code'] === 'string' ? (json['error_code'] as string) : 'unknown';
  const message =
    typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
  return { kind: 'error', status: res.status, errorCode, message };
}

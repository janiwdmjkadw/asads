'use client';

import { fetchAuthenticatedApi } from './trading';
import { requestSensitiveActionChallenge } from './sensitive-action';

/**
 * Slice T4'-C `POST /api/v1/wallet/export/begin` client.
 *
 * The api/ verifies the Clerk session, rate-limits, resolves the user's
 * Turnkey context, forwards the request to trading/'s
 * `/internal/wallet/export` via the HMAC envelope, and returns the
 * encrypted export bundle for the iframe to decrypt.
 *
 * The bundle is opaque to us: api/ never decrypts it and the terminal
 * forwards it directly to the `export.turnkey.com` iframe via
 * `IframeStamper.injectKeyExportBundle`. Plaintext is rendered ONLY
 * inside the iframe origin's DOM.
 */
export interface BeginExportSuccess {
  kind: 'ok';
  exportBundleHex: string;
  turnkeyActivityId: string;
  turnkeySuborgId: string;
  walletPubkey: string;
}

export type BeginExportResult =
  | BeginExportSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export interface BeginExportInput {
  targetPublicKey: string;
  /**
   * Slice "Per-wallet export / recovery": Aurora UUID of the
   * wallet to export. Required. The request targets the new
   * wallet-scoped route `POST /api/v1/wallets/:walletAccountId/export/begin`.
   * The api/ continues to expose the back-compat
   * `POST /api/v1/wallet/export/begin` for the primary wallet,
   * but the Terminal always sends a specific wallet identity.
   */
  walletAccountId: string;
  /**
   * Marks this export as a background bundle prefetch (warming the
   * reveal click), NOT a user-initiated reveal. The api/ skips the
   * `backup_confirmed_at` stamp for prefetch exports so the mandatory
   * recovery-key reveal gate cannot be satisfied by a fetch the user
   * never acted on. The explicit reveal stamps via
   * `POST /api/v1/wallet/backup/confirm` instead.
   */
  prefetch?: boolean;
}

export interface BeginExportOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

export async function beginExport(
  input: BeginExportInput,
  options: BeginExportOptions = {},
): Promise<BeginExportResult> {
  // The wallet_account_id matches the UUID regex enforced by the
  // api/ route's params schema; we defensively validate again on
  // the client so a typo doesn't hit the server with an unhelpful
  // error.
  const walletAccountId = input.walletAccountId;
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    walletAccountId,
  )) {
    return {
      kind: 'error',
      status: 400,
      errorCode: 'wallet_account_id_invalid',
      message: 'walletAccountId is not a valid UUID',
    };
  }
  let res: Response;
  try {
    const challenge = await requestSensitiveActionChallenge(
      {
        action: 'wallet_export',
        walletAccountId,
      },
      { authToken: options.authToken, signal: options.signal },
    );
    if (challenge.kind !== 'ok') {
      if (challenge.kind === 'reauth') return challenge;
      if (challenge.kind === 'network_error') return challenge;
      return {
        kind: 'error',
        status: challenge.kind === 'step_up_required' ? 403 : challenge.status,
        errorCode:
          challenge.kind === 'step_up_required' ? 'step_up_required' : challenge.errorCode,
        message:
          challenge.kind === 'step_up_required'
            ? 'Recent authentication is required before wallet export.'
            : challenge.message,
      };
    }
    res = await fetchAuthenticatedApi(
      `/api/v1/wallets/${encodeURIComponent(walletAccountId)}/export/begin`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target_public_key: input.targetPublicKey,
          step_up_challenge_id: challenge.challengeId,
          step_up_challenge_token: challenge.challengeToken,
          ...(input.prefetch === true ? { prefetch: true } : {}),
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
  if (res.status === 429) {
    const retryAfterMs =
      typeof json['retry_after_ms'] === 'number' ? (json['retry_after_ms'] as number) : 0;
    return { kind: 'rate_limited', retryAfterMs };
  }
  if (res.ok && json['reauth_required'] === false) {
    const bundle = json['export_bundle_hex'];
    const activityId = json['turnkey_activity_id'];
    const suborg = json['turnkey_suborg_id'];
    const pubkey = json['wallet_pubkey'];
    if (
      typeof bundle === 'string' &&
      typeof activityId === 'string' &&
      typeof suborg === 'string' &&
      typeof pubkey === 'string'
    ) {
      return {
        kind: 'ok',
        exportBundleHex: bundle,
        turnkeyActivityId: activityId,
        turnkeySuborgId: suborg,
        walletPubkey: pubkey,
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

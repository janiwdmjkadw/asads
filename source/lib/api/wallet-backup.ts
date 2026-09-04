'use client';

import type { ProvisioningState } from './me';
import { fetchAuthenticatedApi } from './trading';

/**
 * Slice T4'-A backup-before-deposit confirmation result.
 *
 * The new `kind: 'ok'` shape mirrors the existing passkey-cutover
 * `completePasskey` result so call sites can swap with minimal churn.
 * `already_ready` distinguishes a benign re-click from the first
 * confirmation; the UI uses it only to suppress a redundant toast.
 */
export interface WalletAddress {
  pubkey: string;
  status: string;
}

export type ConfirmBackupResult =
  | { kind: 'reauth' }
  | {
      kind: 'ok';
      state: ProvisioningState;
      already_ready: boolean;
      wallet: WalletAddress | null;
    }
  | { kind: 'error'; errorCode: string; message: string };

export type BackupSource = 'export_iframe' | 'checkbox_fallback';

export async function confirmBackup(
  options: {
    source?: BackupSource;
    signal?: AbortSignal;
    authToken?: string | null;
    /**
     * Per-wallet anchor target. Required for PREFETCHED-bundle reveals:
     * the prefetch export deliberately skips the per-wallet
     * `backup_confirmed_at` stamp (the user hadn't seen the key), so
     * the explicit reveal confirm carries the wallet id and the api/
     * stamps it here instead.
     */
    walletAccountId?: string | null;
  } = {},
): Promise<ConfirmBackupResult> {
  const source: BackupSource = options.source ?? 'checkbox_fallback';
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallet/backup/confirm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
          ...(options.walletAccountId ? { wallet_account_id: options.walletAccountId } : {}),
        }),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'error',
      errorCode: 'network_error',
      message: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    return { kind: 'reauth' };
  }
  if (res.ok && json['reauth_required'] === false) {
    const provisioning = json['provisioning'];
    const wallet = json['wallet'];
    const alreadyReady = json['already_ready'];
    if (
      provisioning &&
      typeof provisioning === 'object' &&
      typeof (provisioning as { state?: unknown }).state === 'string'
    ) {
      let parsedWallet: WalletAddress | null = null;
      if (
        wallet &&
        typeof wallet === 'object' &&
        typeof (wallet as { pubkey?: unknown }).pubkey === 'string' &&
        typeof (wallet as { status?: unknown }).status === 'string'
      ) {
        parsedWallet = {
          pubkey: (wallet as { pubkey: string }).pubkey,
          status: (wallet as { status: string }).status,
        };
      }
      return {
        kind: 'ok',
        state: (provisioning as { state: ProvisioningState }).state,
        already_ready: alreadyReady === true,
        wallet: parsedWallet,
      };
    }
    return {
      kind: 'error',
      errorCode: 'shape_mismatch',
      message: 'unexpected response',
    };
  }
  const errorCode =
    typeof json['error_code'] === 'string' ? (json['error_code'] as string) : 'unknown';
  const message =
    typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
  return { kind: 'error', errorCode, message };
}

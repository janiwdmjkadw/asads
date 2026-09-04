'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Portfolio page wallets tab": fetch client for the bulk
 * SOL-balance endpoint. Returns one row per wallet the authenticated
 * user owns, in `listWalletAccountsForUser` order (primary first,
 * then display_order, then created_at).
 *
 * `lamports` is a decimal string (matches the per-wallet endpoint
 * `/api/v1/trade/wallet-balance`).
 */

export interface WalletBalance {
  readonly wallet_account_id: string;
  readonly wallet_pubkey: string;
  readonly lamports: string;
  /** Wallet's USDC ATA balance in micro-USDC (6dp), decimal string.
   *  "0" when the ATA does not exist (or for pre-USDC api builds). */
  readonly usdc_micro: string;
}

export type WalletBalancesResult =
  | { kind: 'ok'; balances: ReadonlyArray<WalletBalance> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export interface ListBalancesOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseBalance(raw: unknown): WalletBalance | null {
  if (!isObject(raw)) return null;
  const id = raw['wallet_account_id'];
  const pubkey = raw['wallet_pubkey'];
  const lamports = raw['lamports'];
  if (
    typeof id !== 'string' ||
    typeof pubkey !== 'string' ||
    typeof lamports !== 'string'
  ) {
    return null;
  }
  // Tolerate a missing field during a rolling deploy (old api build).
  const usdcMicro = raw['usdc_micro'];
  return {
    wallet_account_id: id,
    wallet_pubkey: pubkey,
    lamports,
    usdc_micro: typeof usdcMicro === 'string' ? usdcMicro : '0',
  };
}

export async function listWalletBalances(
  options: ListBalancesOptions = {},
): Promise<WalletBalancesResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets/balances',
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    const r = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      r === 'no_session' || r === 'session_expired' || r === 'session_invalid'
        ? r
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (res.ok && json['reauth_required'] === false) {
    const balancesRaw = json['balances'];
    if (!Array.isArray(balancesRaw)) {
      return {
        kind: 'error',
        status: res.status,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
      };
    }
    const balances: WalletBalance[] = [];
    for (const b of balancesRaw) {
      const parsed = parseBalance(b);
      if (parsed) balances.push(parsed);
    }
    return { kind: 'ok', balances: Object.freeze(balances) };
  }
  const errorCode = typeof json['error_code'] === 'string' ? (json['error_code'] as string) : 'unknown';
  const message = typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
  return { kind: 'error', status: res.status, errorCode, message };
}

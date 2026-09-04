'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Portfolio Spot tab": typed client for the global tx history
 * endpoint.
 */

export type SpotTxType =
  | 'swap'
  | 'buy'
  | 'sell'
  | 'send'
  | 'receive'
  | 'internal'
  | 'other';

export interface SpotTxTokenDelta {
  readonly mint: string;
  readonly amount_ui: number;
}

export interface SpotTxEntry {
  readonly signature: string;
  readonly wallet_account_id: string;
  readonly wallet_pubkey: string;
  readonly timestamp_ms: number;
  readonly slot: number;
  readonly type: SpotTxType;
  readonly description: string;
  readonly source: string;
  readonly success: boolean;
  readonly sol_delta_lamports: number;
  readonly token_deltas: ReadonlyArray<SpotTxTokenDelta>;
  readonly counterparty: string | null;
  readonly internal: boolean;
}

export interface SpotTxSuccess {
  readonly kind: 'ok';
  readonly transactions: ReadonlyArray<SpotTxEntry>;
  readonly nextBefore: string | null;
  readonly degradedReasons: ReadonlyArray<string>;
}

export type SpotTxResult =
  | SpotTxSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asType(v: unknown): SpotTxType {
  if (
    v === 'swap' ||
    v === 'buy' ||
    v === 'sell' ||
    v === 'send' ||
    v === 'receive' ||
    v === 'internal' ||
    v === 'other'
  ) {
    return v;
  }
  return 'other';
}

function parseEntry(raw: unknown): SpotTxEntry | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw['signature'] !== 'string' ||
    typeof raw['wallet_account_id'] !== 'string' ||
    typeof raw['wallet_pubkey'] !== 'string'
  ) {
    return null;
  }
  const deltasRaw = raw['token_deltas'];
  const deltas: SpotTxTokenDelta[] = [];
  if (Array.isArray(deltasRaw)) {
    for (const d of deltasRaw) {
      if (
        isObject(d) &&
        typeof d['mint'] === 'string' &&
        typeof d['amount_ui'] === 'number' &&
        Number.isFinite(d['amount_ui'])
      ) {
        deltas.push({ mint: d['mint'], amount_ui: d['amount_ui'] });
      }
    }
  }
  return {
    signature: raw['signature'],
    wallet_account_id: raw['wallet_account_id'],
    wallet_pubkey: raw['wallet_pubkey'],
    timestamp_ms:
      typeof raw['timestamp_ms'] === 'number' ? raw['timestamp_ms'] : 0,
    slot: typeof raw['slot'] === 'number' ? raw['slot'] : 0,
    type: asType(raw['type']),
    description: typeof raw['description'] === 'string' ? raw['description'] : '',
    source: typeof raw['source'] === 'string' ? raw['source'] : '',
    success: raw['success'] === true,
    sol_delta_lamports:
      typeof raw['sol_delta_lamports'] === 'number' ? raw['sol_delta_lamports'] : 0,
    token_deltas: deltas,
    counterparty:
      typeof raw['counterparty'] === 'string' ? raw['counterparty'] : null,
    internal: raw['internal'] === true,
  };
}

export function parseSpotTxResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): SpotTxResult {
  if (json['reauth_required'] === true) {
    const r = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      r === 'no_session' || r === 'session_expired' || r === 'session_invalid'
        ? r
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (typeof json['error_code'] === 'string') {
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: json['error_code'],
      message: typeof json['message'] === 'string' ? json['message'] : 'request failed',
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: 'shape_mismatch', reason: `http_${httpStatus}` };
  }
  const txsRaw = json['transactions'];
  if (!Array.isArray(txsRaw)) {
    return { kind: 'shape_mismatch', reason: 'transactions_not_array' };
  }
  const transactions: SpotTxEntry[] = [];
  for (const t of txsRaw) {
    const parsed = parseEntry(t);
    if (parsed) transactions.push(parsed);
  }
  const degraded: string[] = Array.isArray(json['degraded_reasons'])
    ? (json['degraded_reasons'] as unknown[]).filter(
        (d): d is string => typeof d === 'string',
      )
    : [];
  return {
    kind: 'ok',
    transactions,
    nextBefore:
      typeof json['next_before'] === 'string' ? json['next_before'] : null,
    degradedReasons: degraded,
  };
}

export interface FetchSpotTxInput {
  readonly limit?: number;
  readonly before?: string | null;
  readonly includeFailed?: boolean;
  readonly walletAccountId?: string | null;
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function fetchSpotTransactions(
  input: FetchSpotTxInput = {},
  options: { signal?: AbortSignal; authToken?: string | null } = {},
): Promise<SpotTxResult> {
  const params = new URLSearchParams();
  if (
    typeof input.limit === 'number' &&
    Number.isFinite(input.limit) &&
    input.limit >= 1
  ) {
    params.set('limit', String(Math.floor(input.limit)));
  }
  if (typeof input.before === 'string' && input.before.length > 0) {
    params.set('before', input.before);
  }
  if (input.includeFailed === true) params.set('include_failed', 'true');
  if (
    typeof input.walletAccountId === 'string' &&
    UUID_REGEX.test(input.walletAccountId)
  ) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  const qs = params.toString();
  const url = qs.length > 0
    ? `/api/v1/portfolio/spot/transactions?${qs}`
    : '/api/v1/portfolio/spot/transactions';
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      url,
      { method: 'GET' },
      {
        authToken: options.authToken,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseSpotTxResponse(json, res.status);
}

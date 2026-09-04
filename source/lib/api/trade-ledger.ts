'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * `GET /api/v1/trade/ledger` client.
 *
 * Lifetime cash-flow ledger for one mint, blended across the selected
 * wallet set, aggregated from `trading.fills` server-side. Powers the
 * trade-page BOUGHT / SOLD / HOLDING / PNL strip, which must persist
 * after a full sell (the fills ledger is durable, unlike the open
 * position). Result is a tagged union — never throws.
 */

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface TradeLedger {
  /** All-in SOL ever spent buying (swap + fee + tip + rent), lamports. */
  readonly boughtLamports: bigint;
  /** All-in SOL ever received selling (net of that tx's friction), lamports. */
  readonly soldLamports: bigint;
  /** Current fill-tracked holding (base units; net of buys - sells). */
  readonly netTokens: bigint;
}

export type TradeLedgerResult =
  | { kind: 'ok'; ledger: TradeLedger }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

export interface FetchTradeLedgerInput {
  readonly walletAccountIds: ReadonlyArray<string>;
  readonly mint: string;
}

export interface FetchTradeLedgerOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUrl(input: FetchTradeLedgerInput): string {
  const params = new URLSearchParams();
  for (const id of input.walletAccountIds) {
    if (UUID_REGEX.test(id)) params.append('wallet_account_id', id);
  }
  params.set('mint', input.mint);
  return `/api/v1/trade/ledger?${params.toString()}`;
}

function safeBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Pure parser. Exported for unit tests. */
export function parseTradeLedgerResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): TradeLedgerResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
        ? raw
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
    return { kind: 'error', status: httpStatus, errorCode: errorCodeRaw, message };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const bought = safeBigInt(json['bought_lamports']);
    const sold = safeBigInt(json['sold_lamports']);
    const net = safeBigInt(json['net_tokens']);
    if (bought === null || sold === null || net === null) {
      return { kind: 'shape_mismatch', reason: 'non_numeric_ledger_fields' };
    }
    return {
      kind: 'ok',
      ledger: { boughtLamports: bought, soldLamports: sold, netTokens: net },
    };
  }
  return { kind: 'shape_mismatch', reason: 'unexpected_response_shape' };
}

export async function fetchTradeLedger(
  input: FetchTradeLedgerInput,
  options: FetchTradeLedgerOptions = {},
): Promise<TradeLedgerResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      buildUrl(input),
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isObject(json)) return { kind: 'shape_mismatch', reason: 'non_object_response' };
  return parseTradeLedgerResponse(json, res.status);
}

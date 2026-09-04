'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Per-wallet positions / fills + wallet management UI":
 * `GET /api/v1/trade/fills` client. Returns the user's confirmed
 * fills scoped to the selected wallet. Optional `mint` narrows to
 * one mint (used by the per-mint recent-fills view in TradePanel).
 *
 * Tagged-union result; never throws.
 */

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface TradeFillEntry {
  readonly fill_id: string;
  readonly order_id: string;
  readonly client_order_id: string;
  readonly signature: string;
  readonly slot: number;
  readonly side: 'buy' | 'sell';
  readonly mint: string;
  readonly sol_delta_lamports: string;
  readonly token_delta_base_units: string;
  readonly fee_lamports: string;
  readonly tip_lamports: string;
  readonly venue: string;
  readonly confirmed_at_ms: number;
  readonly order_state: string;
  readonly created_at: string;
}

export interface TradeFillsSuccess {
  readonly kind: 'ok';
  readonly walletAccountId: string | null;
  readonly fills: ReadonlyArray<TradeFillEntry>;
}

export type TradeFillsResult =
  | TradeFillsSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

export interface FetchTradeFillsInput {
  readonly walletAccountId?: string | null;
  readonly limit?: number;
  readonly mint?: string | null;
}

export interface FetchTradeFillsOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildTradeFillsUrl(input: FetchTradeFillsInput): string {
  const params = new URLSearchParams();
  if (
    typeof input.walletAccountId === 'string' &&
    UUID_REGEX.test(input.walletAccountId)
  ) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  if (
    typeof input.limit === 'number' &&
    Number.isFinite(input.limit) &&
    input.limit >= 1
  ) {
    params.set('limit', String(Math.floor(input.limit)));
  }
  if (
    typeof input.mint === 'string' &&
    input.mint.length > 0 &&
    input.mint.length <= 64
  ) {
    params.set('mint', input.mint);
  }
  const qs = params.toString();
  return qs.length > 0 ? `/api/v1/trade/fills?${qs}` : '/api/v1/trade/fills';
}

function parseFill(raw: unknown): TradeFillEntry | null {
  if (!isObject(raw)) return null;
  const fillId = raw['fill_id'];
  const orderId = raw['order_id'];
  const clientOrderId = raw['client_order_id'];
  const signature = raw['signature'];
  const slot = raw['slot'];
  const side = raw['side'];
  const mint = raw['mint'];
  const solDelta = raw['sol_delta_lamports'];
  const tokenDelta = raw['token_delta_base_units'];
  const fee = raw['fee_lamports'];
  const tip = raw['tip_lamports'];
  const venue = raw['venue'];
  const confirmedAtMs = raw['confirmed_at_ms'];
  const orderState = raw['order_state'];
  const createdAt = raw['created_at'];
  if (
    typeof fillId !== 'string' ||
    typeof orderId !== 'string' ||
    typeof clientOrderId !== 'string' ||
    typeof signature !== 'string' ||
    typeof slot !== 'number' ||
    (side !== 'buy' && side !== 'sell') ||
    typeof mint !== 'string' ||
    typeof solDelta !== 'string' ||
    typeof tokenDelta !== 'string' ||
    typeof fee !== 'string' ||
    typeof tip !== 'string' ||
    typeof venue !== 'string' ||
    typeof confirmedAtMs !== 'number' ||
    typeof orderState !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  return {
    fill_id: fillId,
    order_id: orderId,
    client_order_id: clientOrderId,
    signature,
    slot: Math.max(0, Math.floor(slot)),
    side,
    mint,
    sol_delta_lamports: solDelta,
    token_delta_base_units: tokenDelta,
    fee_lamports: fee,
    tip_lamports: tip,
    venue,
    confirmed_at_ms: Math.max(0, Math.floor(confirmedAtMs)),
    order_state: orderState,
    created_at: createdAt,
  };
}

export function parseTradeFillsResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): TradeFillsResult {
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
    const walletAccountIdRaw = json['wallet_account_id'];
    const walletAccountId =
      typeof walletAccountIdRaw === 'string'
        ? walletAccountIdRaw
        : walletAccountIdRaw === null
          ? null
          : null;
    const fillsRaw = json['fills'];
    if (!Array.isArray(fillsRaw)) {
      return { kind: 'shape_mismatch', reason: 'fills_not_array' };
    }
    const fills: TradeFillEntry[] = [];
    for (const entry of fillsRaw) {
      const parsed = parseFill(entry);
      if (parsed !== null) fills.push(parsed);
    }
    return { kind: 'ok', walletAccountId, fills };
  }
  return { kind: 'shape_mismatch', reason: 'unexpected_response_shape' };
}

export async function fetchTradeFills(
  input: FetchTradeFillsInput = {},
  options: FetchTradeFillsOptions = {},
): Promise<TradeFillsResult> {
  const url = buildTradeFillsUrl(input);
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      url,
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseTradeFillsResponse(json, res.status);
}

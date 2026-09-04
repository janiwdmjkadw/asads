'use client';

import { fetchAuthenticatedApi } from '@/lib/api/trading';

/**
 * `GET /api/v1/evm/trade/fills` — the user's OWN confirmed EVM fills.
 *
 * READ THE SCOPE BEFORE USING THIS. It is Clerk-gated and wallet-scoped: it
 * answers "what did I trade", not "what has traded". It is therefore NOT the
 * public trade tape — that exists separately: `the ingestion service` registers
 * `GET /evm/trades` (the backend source) with a warm handler and a cold tier,
 * and the sibling module `tradeApi.ts` documents fetching it
 * (`evmTradesUrl`). Use that for the public tape; use this for the signed-in
 * user's own fill history.
 *
 * What it DOES close is the other half: a user's own EVM trade history had no
 * surface whatsoever, so a fill that confirmed while the tab was closed left
 * no trace anywhere in the terminal. This is the EVM counterpart of
 * `lib/api/trade-fills.ts` and mirrors its tagged-union posture.
 *
 * UNITS, verified against `api/src/db/queries/evm-trade-reads.ts`:
 * - `native_delta_wei` is SIGNED wei — negative on a buy (native left the
 *   wallet), positive on a sell.
 * - `token_delta_base_units` is SIGNED base units, the opposite sign.
 * - `block_number` and `confirmed_at_ms` are STRINGS, not numbers. Both exceed
 *   nothing today, but the api chose strings and parsing them as numbers here
 *   would be inventing a contract.
 * - **No decimals field.** The token deltas are unscaled base units and this
 *   route serves no scale for them, so a consumer either has decimals from
 *   elsewhere or renders base units and says so.
 */

/* See `searchApi.ts`: the `0x` prefix's case is display vocabulary. */
const EVM_ADDRESS_RE = /^0[xX][0-9a-fA-F]{40}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,512}$/;
const SIGNED_DECIMAL = /^-?\d+$/;
const UNSIGNED_DECIMAL = /^\d+$/;

export interface EvmFillEntry {
  readonly fillId: string;
  readonly orderId: string;
  readonly clientOrderId: string | null;
  readonly chain: string;
  readonly txHash: string;
  /** Decimal string — the api serves it as a string, and so does this. */
  readonly blockNumber: string;
  readonly side: 'buy' | 'sell';
  /** Lowercase 0x. */
  readonly token: string;
  /** SIGNED wei. Negative on a buy. */
  readonly nativeDeltaWei: string;
  /** SIGNED token base units. Positive on a buy. */
  readonly tokenDeltaBaseUnits: string;
  readonly gasFeeWei: string;
  readonly priorityFeeWei: string;
  readonly platformFeeWei: string;
  /** `null` when no fee leg was observed — NOT a zero-fee claim. */
  readonly platformFeeRecipient: string | null;
  readonly venue: string;
  /** Unix ms as a number, parsed from the api's string. `null` if unparseable. */
  readonly confirmedAtMs: number | null;
}

export interface EvmFillsSuccess {
  readonly kind: 'ok';
  readonly chain: string;
  readonly walletAccountIds: ReadonlyArray<string>;
  readonly fills: ReadonlyArray<EvmFillEntry>;
  readonly nextCursor: string | null;
}

export type EvmFillsResult =
  | EvmFillsSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

export interface FetchEvmFillsInput {
  readonly chain: string;
  /** Narrow to one token. 42-char 0x — the api 400s anything else. */
  readonly token?: string | null;
  readonly side?: 'buy' | 'sell' | null;
  /** 1..200; the api clamps and defaults to 50. */
  readonly limit?: number;
  readonly walletAccountId?: string | null;
  /** Opaque server continuation from the previous page on this exact scope. */
  readonly cursor?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decimalOrNull(raw: unknown, signed: boolean): string | null {
  if (typeof raw !== 'string') return null;
  return (signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL).test(raw) ? raw : null;
}

/**
 * Build the query.
 *
 * Every optional parameter is DROPPED when malformed rather than sent: the
 * request schema is `additionalProperties: false` with tight formats, so a
 * `token=0xzz` is a 400 for the whole request — losing the user's entire fill
 * history because one filter was mistyped. Omitting a bad filter degrades to
 * "unfiltered", which is visibly wrong rather than invisibly empty.
 */
export function buildEvmFillsUrl(input: FetchEvmFillsInput): string {
  const params = new URLSearchParams({ chain: input.chain });
  if (typeof input.token === 'string' && EVM_ADDRESS_RE.test(input.token)) {
    params.set('token', input.token.toLowerCase());
  }
  if (input.side === 'buy' || input.side === 'sell') params.set('side', input.side);
  if (
    typeof input.limit === 'number'
    && Number.isInteger(input.limit)
    && input.limit >= 1
    && input.limit <= 200
  ) {
    params.set('limit', String(input.limit));
  }
  if (typeof input.walletAccountId === 'string' && UUID_RE.test(input.walletAccountId)) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  if (typeof input.cursor === 'string' && CURSOR_RE.test(input.cursor)) {
    params.set('cursor', input.cursor);
  }
  return `/api/v1/evm/trade/fills?${params.toString()}`;
}

function parseFill(raw: unknown): EvmFillEntry | null {
  if (!isObject(raw)) return null;
  const side = raw['side'];
  const token = raw['token'];
  const fillId = raw['fill_id'];
  const orderId = raw['order_id'];
  const txHash = raw['tx_hash'];
  const chain = raw['chain'];
  const venue = raw['venue'];
  const blockNumber = decimalOrNull(raw['block_number'], false);
  const nativeDelta = decimalOrNull(raw['native_delta_wei'], true);
  const tokenDelta = decimalOrNull(raw['token_delta_base_units'], true);
  const gasFee = decimalOrNull(raw['gas_fee_wei'], true);
  const priorityFee = decimalOrNull(raw['priority_fee_wei'], true);
  const platformFee = decimalOrNull(raw['platform_fee_wei'], true);
  if (
    (side !== 'buy' && side !== 'sell')
    || typeof token !== 'string'
    || !EVM_ADDRESS_RE.test(token)
    || typeof fillId !== 'string'
    || typeof orderId !== 'string'
    || typeof txHash !== 'string'
    || typeof chain !== 'string'
    || typeof venue !== 'string'
    || blockNumber === null
    || nativeDelta === null
    || tokenDelta === null
    || gasFee === null
    || priorityFee === null
    || platformFee === null
  ) {
    // A fill we cannot account for is DROPPED, not rendered with zeros — the
    // same rule the live tape applies to a malformed trade frame.
    return null;
  }
  const confirmedRaw = raw['confirmed_at_ms'];
  const confirmed =
    typeof confirmedRaw === 'string' && UNSIGNED_DECIMAL.test(confirmedRaw)
      ? Number(confirmedRaw)
      : null;
  const clientOrderId = raw['client_order_id'];
  const recipient = raw['platform_fee_recipient'];
  return {
    fillId,
    orderId,
    clientOrderId: typeof clientOrderId === 'string' ? clientOrderId : null,
    chain,
    txHash,
    blockNumber,
    side,
    token: token.toLowerCase(),
    nativeDeltaWei: nativeDelta,
    tokenDeltaBaseUnits: tokenDelta,
    gasFeeWei: gasFee,
    priorityFeeWei: priorityFee,
    platformFeeWei: platformFee,
    venue,
    platformFeeRecipient:
      typeof recipient === 'string' && EVM_ADDRESS_RE.test(recipient)
        ? recipient.toLowerCase()
        : null,
    // A timestamp beyond what a double represents exactly would be a wrong
    // time rendered confidently; `null` (unknown) is the honest fallback.
    confirmedAtMs:
      confirmed !== null && Number.isSafeInteger(confirmed) && confirmed > 0
        ? confirmed
        : null,
  };
}

/** Pure parser. Exported so the branch table is exercised without `fetch`. */
export function parseEvmFillsResponse(
  json: Record<string, unknown>,
  httpStatus: number,
  expected?: Pick<FetchEvmFillsInput, 'chain' | 'walletAccountId'>,
): EvmFillsResult {
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
    const chain = json['chain'];
    if (chain !== 'bsc' && chain !== 'robinhood_chain') {
      return { kind: 'shape_mismatch', reason: 'chain_missing' };
    }
    if (expected !== undefined && chain !== expected.chain) {
      return { kind: 'shape_mismatch', reason: 'chain_mismatch' };
    }
    const fillsRaw = json['fills'];
    if (!Array.isArray(fillsRaw)) {
      return { kind: 'shape_mismatch', reason: 'fills_not_array' };
    }
    const fills: EvmFillEntry[] = [];
    for (const entry of fillsRaw) {
      if (isObject(entry) && typeof entry['chain'] === 'string' && entry['chain'] !== chain) {
        return { kind: 'shape_mismatch', reason: 'fill_chain_mismatch' };
      }
      const parsed = parseFill(entry);
      if (parsed !== null) fills.push(parsed);
    }
    const idsRaw = json['wallet_account_ids'];
    if (!Array.isArray(idsRaw)) {
      return { kind: 'shape_mismatch', reason: 'wallet_account_ids_not_array' };
    }
    const walletAccountIds: string[] = [];
    const seenWalletIds = new Set<string>();
    for (const id of idsRaw) {
      if (typeof id !== 'string' || !UUID_RE.test(id) || seenWalletIds.has(id)) {
        return { kind: 'shape_mismatch', reason: 'wallet_account_ids_invalid' };
      }
      seenWalletIds.add(id);
      walletAccountIds.push(id);
    }
    const expectedWallet = expected?.walletAccountId;
    if (
      typeof expectedWallet === 'string' &&
      UUID_RE.test(expectedWallet) &&
      (walletAccountIds.length !== 1 || walletAccountIds[0] !== expectedWallet)
    ) {
      return { kind: 'shape_mismatch', reason: 'wallet_account_mismatch' };
    }
    const rawCursor = json['next_cursor'];
    if (!(rawCursor === null || (typeof rawCursor === 'string' && CURSOR_RE.test(rawCursor)))) {
      return { kind: 'shape_mismatch', reason: 'next_cursor_invalid' };
    }
    return { kind: 'ok', chain, walletAccountIds, fills, nextCursor: rawCursor };
  }
  return { kind: 'shape_mismatch', reason: 'unexpected_response_shape' };
}

export async function fetchEvmFills(
  input: FetchEvmFillsInput,
  options: { signal?: AbortSignal; authToken?: string | null } = {},
): Promise<EvmFillsResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      buildEvmFillsUrl(input),
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseEvmFillsResponse(json, res.status, input);
}

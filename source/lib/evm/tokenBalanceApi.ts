'use client';

export interface EvmTokenBalanceRow {
  readonly walletAccountId: string;
  readonly walletPubkey: string;
  readonly balanceBaseUnits: string | null;
  readonly decimals: number | null;
  readonly status: 'ok' | 'unconfigured' | 'unavailable';
}

export type EvmTokenBalanceResult =
  | { kind: 'ok'; wallets: readonly EvmTokenBalanceRow[] }
  | { kind: 'reauth' }
  | { kind: 'error'; reason: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WALLET_ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_UINT = /^(0|[1-9][0-9]{0,77})$/;
const U256_MAX = (1n << 256n) - 1n;

function isCanonicalU256(value: unknown): value is string {
  return typeof value === 'string'
    && CANONICAL_UINT.test(value)
    && BigInt(value) <= U256_MAX;
}

function isTokenDecimals(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number'
      && Number.isInteger(value)
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= 36);
}

export function parseEvmTokenBalanceResponse(
  raw: unknown,
  expected: {
    readonly chain: string;
    readonly token: string;
    readonly walletAccountId?: string;
  },
): EvmTokenBalanceResult {
  const body = object(raw);
  if (body === null) return { kind: 'error', reason: 'shape_mismatch' };
  if (body['reauth_required'] === true) return { kind: 'reauth' };
  if (body['reauth_required'] !== false || !Array.isArray(body['wallets'])) {
    return { kind: 'error', reason: 'shape_mismatch' };
  }
  if (
    body['chain'] !== expected.chain
    || typeof body['token'] !== 'string'
    || body['token'].toLowerCase() !== expected.token.toLowerCase()
  ) {
    return { kind: 'error', reason: 'subject_mismatch' };
  }
  const wallets: EvmTokenBalanceRow[] = [];
  const accountIds = new Set<string>();
  const pubkeys = new Set<string>();
  for (const rawRow of body['wallets']) {
    const row = object(rawRow);
    if (row === null) return { kind: 'error', reason: 'shape_mismatch' };
    const status = row['status'];
    const balance = row['balance_base_units'];
    const decimals = row['decimals'];
    const walletAccountId = row['wallet_account_id'];
    const walletPubkey = row['wallet_pubkey'];
    if (
      typeof walletAccountId !== 'string' || walletAccountId.length === 0 ||
      typeof walletPubkey !== 'string' || !EVM_ADDRESS.test(walletPubkey) ||
      (status !== 'ok' && status !== 'unconfigured' && status !== 'unavailable') ||
      !isTokenDecimals(decimals)
    ) return { kind: 'error', reason: 'shape_mismatch' };
    let balanceBaseUnits: string | null = null;
    if (status === 'ok') {
      if (!isCanonicalU256(balance)) return { kind: 'error', reason: 'shape_mismatch' };
      balanceBaseUnits = balance;
    } else if (balance !== null) return { kind: 'error', reason: 'shape_mismatch' };
    const canonicalPubkey = walletPubkey.toLowerCase();
    if (accountIds.has(walletAccountId) || pubkeys.has(canonicalPubkey)) {
      return { kind: 'error', reason: 'shape_mismatch' };
    }
    accountIds.add(walletAccountId);
    pubkeys.add(canonicalPubkey);
    wallets.push({
      walletAccountId,
      walletPubkey: canonicalPubkey,
      balanceBaseUnits,
      decimals,
      status,
    });
  }
  if (
    expected.walletAccountId !== undefined
    && (
      wallets.length !== 1
      || wallets[0]?.walletAccountId !== expected.walletAccountId
    )
  ) return { kind: 'error', reason: 'wallet_subject_mismatch' };
  return { kind: 'ok', wallets };
}

export async function fetchEvmTokenBalance(
  chain: string,
  token: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    walletAccountId?: string;
  } = {},
): Promise<EvmTokenBalanceResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  try {
    const query = new URLSearchParams({ chain, token });
    if (options.walletAccountId !== undefined) {
      if (!WALLET_ACCOUNT_ID.test(options.walletAccountId)) {
        return { kind: 'error', reason: 'invalid_wallet_account_id' };
      }
      query.set('wallet_account_id', options.walletAccountId);
    }
    const response = await doFetch(`/api/v1/evm/trade/token-balance?${query}`, {
      credentials: 'include',
      signal: options.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return { kind: 'error', reason: `http_${response.status}` };
    return parseEvmTokenBalanceResponse(body, {
      chain,
      token,
      walletAccountId: options.walletAccountId,
    });
  } catch (error) {
    if (options.signal?.aborted) return { kind: 'error', reason: 'aborted' };
    return { kind: 'error', reason: (error as Error).message || 'network_error' };
  }
}

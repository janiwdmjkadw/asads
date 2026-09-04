'use client';

import { fetchAuthenticatedApi } from '@/lib/api/trading';
import { mintFreshOrderToken } from '@/lib/api/orders';
import { getClerkSession } from '@/lib/state/clerk-session-store';

export const EVM_BATCH_TIMEOUT_MS = 60_000;
export const EVM_BATCH_STATUS_TIMEOUT_MS = 15_000;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_U128 = /^[1-9][0-9]{0,38}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const U128_MAX = (1n << 128n) - 1n;

export type EvmBatchChain = 'bsc' | 'robinhood_chain';

interface CommonInput {
  readonly chain: EvmBatchChain;
  readonly clientParentId: string;
  readonly walletAccountIds: readonly string[];
  readonly token: string;
  readonly maxSlippageBps: number;
  readonly clientTsMs?: number;
}

export interface EvmBatchBuyInput extends CommonInput {
  readonly side: 'buy';
  /** Total spend across every selected wallet, in the exact quote asset's base units. */
  readonly totalBaseUnits: string;
  /** Null means the chain-native asset; otherwise the exact lowercase ERC-20. */
  readonly quoteAssetAddress: string | null;
}

export interface EvmBatchSellInput extends CommonInput {
  readonly side: 'sell';
  /** Exact per-wallet token base units. Mutually exclusive with percentage sizing. */
  readonly sellTokensInByWallet?: Readonly<Record<string, string>>;
  readonly sellPercentBps?: number;
  /** Required for every selected wallet when percentage sizing is used. */
  readonly sellTokenBalanceHints?: Readonly<Record<string, string>>;
}

export type EvmBatchOrderInput = EvmBatchBuyInput | EvmBatchSellInput;

export interface EvmBatchBuyWire {
  readonly chain: EvmBatchChain;
  readonly client_parent_id: string;
  readonly wallet_account_ids: string[];
  readonly split_mode: 'equal';
  readonly side: 'buy';
  readonly mint: string;
  readonly native_in_wei?: string;
  readonly quote_in?: string;
  readonly quote_asset?: string;
  readonly max_slippage_bps: number;
  readonly client_ts?: number;
}

export interface EvmBatchSellWire {
  readonly chain: EvmBatchChain;
  readonly client_parent_id: string;
  readonly wallet_account_ids: string[];
  readonly split_mode: 'equal';
  readonly side: 'sell';
  readonly mint: string;
  readonly sell_tokens_in?: Record<string, string>;
  readonly sell_percent_bps?: number;
  readonly sell_token_balance_hints?: Record<string, string>;
  readonly max_slippage_bps: number;
  readonly client_ts?: number;
}

export type EvmBatchOrderWire = EvmBatchBuyWire | EvmBatchSellWire;

export type EvmBatchBuildResult =
  | { readonly kind: 'ok'; readonly body: EvmBatchOrderWire }
  | { readonly kind: 'invalid'; readonly reason: string };

function hasExactPositiveMap(
  value: Readonly<Record<string, string>> | undefined,
  walletIds: readonly string[],
): value is Readonly<Record<string, string>> {
  if (value === undefined) return false;
  const keys = Object.keys(value);
  return keys.length === walletIds.length
    && keys.every((key) => walletIds.includes(key))
    && walletIds.every((walletId) => isPositiveU128(value[walletId]));
}

function isPositiveU128(value: unknown): value is string {
  return typeof value === 'string' && POSITIVE_U128.test(value) && BigInt(value) <= U128_MAX;
}

export function buildEvmBatchOrderBody(input: EvmBatchOrderInput): EvmBatchBuildResult {
  if (input.chain !== 'bsc' && input.chain !== 'robinhood_chain') {
    return { kind: 'invalid', reason: 'chain must be bsc or robinhood_chain' };
  }
  if (!ADDRESS.test(input.token)) return { kind: 'invalid', reason: 'token must be an EVM address' };
  if (input.clientParentId.length === 0 || input.clientParentId.length > 128) {
    return { kind: 'invalid', reason: 'client_parent_id must be 1..128 characters' };
  }
  if (input.walletAccountIds.length < 2 || input.walletAccountIds.length > 128) {
    return { kind: 'invalid', reason: 'EVM batch requires 2..128 wallets' };
  }
  const uniqueWallets = new Set(input.walletAccountIds);
  if (
    uniqueWallets.size !== input.walletAccountIds.length
    || input.walletAccountIds.some((id) => !UUID.test(id))
  ) {
    return { kind: 'invalid', reason: 'wallet_account_ids must be unique UUIDs' };
  }
  if (
    !Number.isSafeInteger(input.maxSlippageBps)
    || input.maxSlippageBps < 1
    || input.maxSlippageBps > 10_000
  ) {
    return { kind: 'invalid', reason: 'max_slippage_bps must be in 1..10000' };
  }
  if (
    input.clientTsMs !== undefined
    && (!Number.isSafeInteger(input.clientTsMs) || input.clientTsMs < 0)
  ) {
    return { kind: 'invalid', reason: 'client_ts must be a nonnegative safe integer' };
  }

  const common = {
    chain: input.chain,
    client_parent_id: input.clientParentId,
    wallet_account_ids: [...input.walletAccountIds],
    split_mode: 'equal' as const,
    mint: input.token.toLowerCase(),
    max_slippage_bps: input.maxSlippageBps,
    ...(input.clientTsMs === undefined ? {} : { client_ts: input.clientTsMs }),
  };
  if (input.side === 'buy') {
    if (!isPositiveU128(input.totalBaseUnits)) {
      return { kind: 'invalid', reason: 'EVM batch buy amount must be a positive u128 string' };
    }
    if (BigInt(input.totalBaseUnits) < BigInt(input.walletAccountIds.length)) {
      return { kind: 'invalid', reason: 'EVM batch buy amount is too small for a nonzero equal split' };
    }
    if (input.quoteAssetAddress !== null && !ADDRESS.test(input.quoteAssetAddress)) {
      return { kind: 'invalid', reason: 'quote_asset must be an EVM address' };
    }
    return {
      kind: 'ok',
      body: {
        ...common,
        side: 'buy',
        ...(input.quoteAssetAddress === null
          ? { native_in_wei: input.totalBaseUnits }
          : {
              quote_in: input.totalBaseUnits,
              quote_asset: input.quoteAssetAddress.toLowerCase(),
            }),
      },
    };
  }

  const hasTokens = input.sellTokensInByWallet !== undefined;
  const hasPercent = input.sellPercentBps !== undefined;
  if (hasTokens === hasPercent) {
    return { kind: 'invalid', reason: 'set exactly one EVM batch sell sizing mode' };
  }
  if (hasTokens) {
    if (!hasExactPositiveMap(input.sellTokensInByWallet, input.walletAccountIds)) {
      return { kind: 'invalid', reason: 'sell token amounts must bind every selected wallet exactly' };
    }
    return {
      kind: 'ok',
      body: {
        ...common,
        side: 'sell',
        sell_tokens_in: Object.fromEntries(
          input.walletAccountIds.map((id) => [id, input.sellTokensInByWallet![id]!]),
        ),
      },
    };
  }
  if (
    !Number.isSafeInteger(input.sellPercentBps)
    || input.sellPercentBps! < 1
    || input.sellPercentBps! > 10_000
  ) {
    return { kind: 'invalid', reason: 'sell_percent_bps must be in 1..10000' };
  }
  if (!hasExactPositiveMap(input.sellTokenBalanceHints, input.walletAccountIds)) {
    return { kind: 'invalid', reason: 'percentage sell balance hints must bind every selected wallet exactly' };
  }
  if (input.walletAccountIds.some((id) => (
    (BigInt(input.sellTokenBalanceHints![id]!) * BigInt(input.sellPercentBps!)) / 10_000n
  ) === 0n)) {
    return { kind: 'invalid', reason: 'percentage sell produces a zero-sized wallet child' };
  }
  return {
    kind: 'ok',
    body: {
      ...common,
      side: 'sell',
      sell_percent_bps: input.sellPercentBps,
      sell_token_balance_hints: Object.fromEntries(
        input.walletAccountIds.map((id) => [id, input.sellTokenBalanceHints![id]!]),
      ),
    },
  };
}

export type EvmBatchChildState =
  | 'pending'
  | 'dispatched'
  | 'filled'
  | 'indeterminate'
  | 'failed'
  | 'idempotency_conflict'
  | 'gate_rejected';

export interface EvmBatchOrderChild {
  readonly walletAccountId: string;
  readonly clientOrderId: string;
  readonly childIndex: number;
  readonly chain: EvmBatchChain;
  readonly state: EvmBatchChildState;
  readonly amountAsset: string;
  readonly amountBaseUnits: string;
  readonly amountNativeWei: string | null;
  readonly txHash: string | null;
  readonly blockNumber: number | null;
  readonly platformFeeWei: string | null;
  readonly platformFeeAsset: string | null;
  readonly platformFeeBaseUnits: string | null;
  readonly settlementAsset: string | null;
  readonly settlementAmountBaseUnits: string | null;
  readonly errorCode: string | null;
  readonly errorKind: string | null;
}

export type EvmBatchParentStatus =
  | 'reserved'
  | 'running'
  | 'filled'
  | 'partial_failed'
  | 'failed'
  | 'cancelled';

export interface EvmBatchOrderParent {
  readonly id: string;
  readonly clientParentId: string;
  readonly chain: EvmBatchChain;
  readonly status: EvmBatchParentStatus;
  readonly walletCount: number;
  readonly side: 'buy' | 'sell';
  readonly token: string;
  readonly totalSpendAsset: string;
  readonly totalSpendBaseUnits: string;
  readonly sellPercentBps: number | null;
  readonly totalTokensIn: string | null;
  readonly maxSlippageBps: number;
  readonly errorCode: string | null;
}

export type EvmBatchOrderResult =
  | {
      readonly kind: 'ok' | 'partial_failed' | 'failed' | 'cancelled';
      readonly parent: EvmBatchOrderParent;
      readonly children: readonly EvmBatchOrderChild[];
    }
  | { readonly kind: 'reauth'; readonly reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { readonly kind: 'in_flight'; readonly parentId: string }
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly errorCode: string;
      readonly message: string;
    }
  | { readonly kind: 'unknown_outcome'; readonly reason: string }
  | { readonly kind: 'invalid_input'; readonly reason: string }
  | { readonly kind: 'shape_mismatch'; readonly reason: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || value === undefined
    ? null
    : typeof value === 'string'
      ? value
      : undefined;
}

function optionalUint(value: unknown): string | null | undefined {
  const parsed = nullableString(value);
  return parsed === undefined || parsed === null || UINT.test(parsed) ? parsed : undefined;
}

function isEvmAsset(value: string | null): boolean {
  return value === null || value === 'native' || ADDRESS.test(value);
}

function expectedSpendAsset(input: EvmBatchOrderInput): string {
  if (input.side === 'sell') return input.token.toLowerCase();
  return input.quoteAssetAddress?.toLowerCase() ?? 'native';
}

function expectedChildAmounts(input: EvmBatchOrderInput): Readonly<Record<string, string>> | null {
  if (input.side === 'sell' && input.sellTokensInByWallet !== undefined) {
    return input.sellTokensInByWallet;
  }
  if (input.side === 'sell') {
    if (input.sellTokenBalanceHints === undefined || input.sellPercentBps === undefined) return null;
    return Object.fromEntries(input.walletAccountIds.map((id) => {
      const balance = BigInt(input.sellTokenBalanceHints![id]!);
      return [id, ((balance * BigInt(input.sellPercentBps!)) / 10_000n).toString()];
    }));
  }
  const count = BigInt(input.walletAccountIds.length);
  const total = BigInt(input.totalBaseUnits);
  const base = total / count;
  const remainder = total % count;
  return Object.fromEntries(input.walletAccountIds.map((id, index) => [
    id,
    (base + (BigInt(index) < remainder ? 1n : 0n)).toString(),
  ]));
}

function parseChild(
  raw: unknown,
  input: EvmBatchOrderInput,
  expectedAmounts: Readonly<Record<string, string>>,
): EvmBatchOrderChild | null {
  const row = object(raw);
  if (row === null) return null;
  const walletAccountId = row['wallet_account_id'];
  const childIndex = row['child_index'];
  const expectedIndex = typeof walletAccountId === 'string'
    ? input.walletAccountIds.indexOf(walletAccountId)
    : -1;
  const state = row['state'];
  const allowedState = state === 'pending' || state === 'dispatched' || state === 'filled'
    || state === 'indeterminate'
    || state === 'failed' || state === 'idempotency_conflict' || state === 'gate_rejected';
  const amountAsset = row['amount_asset'];
  const amountBaseUnits = row['amount_base_units'];
  const clientOrderId = row['client_order_id'];
  if (
    expectedIndex < 0
    || childIndex !== expectedIndex
    || !allowedState
    || row['chain'] !== input.chain
    || typeof clientOrderId !== 'string'
    || clientOrderId.length === 0
    || amountAsset !== expectedSpendAsset(input)
    || amountBaseUnits !== expectedAmounts[walletAccountId as string]
    || row['amount_lamports'] !== null
    || row['amount_usdc_micro'] !== null
  ) return null;
  const amountNativeWei = optionalUint(row['amount_native_wei']);
  const platformFeeWei = optionalUint(row['platform_fee_wei']);
  const platformFeeAsset = nullableString(row['platform_fee_asset']);
  const platformFeeBaseUnits = optionalUint(row['platform_fee_base_units']);
  const settlementAsset = nullableString(row['settlement_asset']);
  const settlementAmount = optionalUint(row['settlement_amount_base_units']);
  const txHashRaw = nullableString(row['tx_hash']);
  const errorCode = nullableString(row['error_code']);
  const errorKind = nullableString(row['error_kind']);
  const orderSeq = nullableString(row['order_seq']);
  const signature = nullableString(row['signature']);
  const turnkeyActivityId = nullableString(row['turnkey_activity_id']);
  const tsMs = row['ts_ms'];
  const blockNumberRaw = row['block_number'];
  if (
    amountNativeWei === undefined
    || platformFeeWei === undefined
    || platformFeeAsset === undefined
    || platformFeeBaseUnits === undefined
    || settlementAsset === undefined
    || settlementAmount === undefined
    || txHashRaw === undefined
    || errorCode === undefined
    || errorKind === undefined
    || orderSeq === undefined
    || signature === undefined
    || turnkeyActivityId === undefined
    || !(
      tsMs === null
      || tsMs === undefined
      || (typeof tsMs === 'number' && Number.isSafeInteger(tsMs) && tsMs >= 0)
    )
    || (txHashRaw !== null && !HASH.test(txHashRaw))
    || !(
      blockNumberRaw === null
      || blockNumberRaw === undefined
      || (typeof blockNumberRaw === 'number' && Number.isSafeInteger(blockNumberRaw) && blockNumberRaw >= 0)
    )
    || ((platformFeeAsset === null) !== (platformFeeBaseUnits === null))
    || ((settlementAsset === null) !== (settlementAmount === null))
    || !isEvmAsset(platformFeeAsset)
    || !isEvmAsset(settlementAsset)
  ) return null;
  if (
    input.side === 'buy'
    && input.quoteAssetAddress === null
    && amountNativeWei !== amountBaseUnits
  ) return null;
  if ((input.side === 'sell' || input.quoteAssetAddress !== null) && amountNativeWei !== null) return null;
  return {
    walletAccountId: walletAccountId as string,
    clientOrderId,
    childIndex,
    chain: input.chain,
    state,
    amountAsset,
    amountBaseUnits,
    amountNativeWei,
    txHash: txHashRaw?.toLowerCase() ?? null,
    blockNumber: typeof blockNumberRaw === 'number' ? blockNumberRaw : null,
    platformFeeWei,
    platformFeeAsset: platformFeeAsset?.toLowerCase() ?? null,
    platformFeeBaseUnits,
    settlementAsset: settlementAsset?.toLowerCase() ?? null,
    settlementAmountBaseUnits: settlementAmount,
    errorCode,
    errorKind,
  };
}

export function parseEvmBatchOrderResponse(
  raw: unknown,
  status: number,
  input: EvmBatchOrderInput,
): EvmBatchOrderResult {
  const body = object(raw);
  if (body === null) return { kind: 'shape_mismatch', reason: 'response is not an object' };
  if (body['reauth_required'] === true) {
    const reason = body['reason'];
    return {
      kind: 'reauth',
      reason: reason === 'no_session' || reason === 'session_expired' || reason === 'session_invalid'
        ? reason
        : 'session_invalid',
    };
  }
  if (typeof body['error_code'] === 'string') {
    if (body['error_code'] === 'batch_in_flight' && typeof body['parent_id'] === 'string') {
      return { kind: 'in_flight', parentId: body['parent_id'] };
    }
    return {
      kind: 'refused',
      status,
      errorCode: body['error_code'],
      message: typeof body['message'] === 'string' ? body['message'] : 'Batch request was refused.',
    };
  }
  if (status < 200 || status >= 300 || body['reauth_required'] !== false) {
    return { kind: 'shape_mismatch', reason: 'unrecognised batch response envelope' };
  }
  const parent = object(body['parent']);
  const childrenRaw = body['children'];
  const expectedAmounts = expectedChildAmounts(input);
  if (parent === null || !Array.isArray(childrenRaw) || expectedAmounts === null) {
    return { kind: 'shape_mismatch', reason: 'batch parent or children missing' };
  }
  const parentStatus = parent['status'];
  const allowedParentStatus = parentStatus === 'reserved' || parentStatus === 'running'
    || parentStatus === 'filled' || parentStatus === 'partial_failed'
    || parentStatus === 'failed' || parentStatus === 'cancelled';
  const expectedAsset = expectedSpendAsset(input);
  const expectedTotal = Object.values(expectedAmounts)
    .reduce((sum, amount) => sum + BigInt(amount), 0n)
    .toString();
  const terminalAt = nullableString(parent['terminal_at']);
  const parentErrorCode = nullableString(parent['error_code']);
  if (
    typeof parent['id'] !== 'string'
    || parent['id'].length === 0
    || parent['client_parent_id'] !== input.clientParentId
    || parent['chain'] !== input.chain
    || !allowedParentStatus
    || parent['wallet_count'] !== input.walletAccountIds.length
    || parent['side'] !== input.side
    || typeof parent['mint'] !== 'string'
    || parent['mint'].toLowerCase() !== input.token.toLowerCase()
    || parent['split_mode'] !== 'equal'
    || parent['total_amount_lamports'] !== null
    || parent['total_amount_usdc_micro'] !== null
    || parent['total_spend_asset'] !== expectedAsset
    || parent['total_spend_base_units'] !== expectedTotal
    || parent['max_slippage_bps'] !== input.maxSlippageBps
    || parent['sell_percent_bps'] !== (input.side === 'sell' ? input.sellPercentBps ?? null : null)
    || parent['total_tokens_in'] !== (
      input.side === 'sell' && input.sellTokensInByWallet !== undefined ? expectedTotal : null
    )
    || parent['spend_currency'] !== (
      input.side === 'buy' && input.quoteAssetAddress !== null
        ? 'erc20'
        : input.chain === 'bsc' ? 'bnb' : 'eth'
    )
    || terminalAt === undefined
    || parentErrorCode === undefined
  ) return { kind: 'shape_mismatch', reason: 'batch parent subject mismatch' };

  const children: EvmBatchOrderChild[] = [];
  const seenWallets = new Set<string>();
  const seenOrders = new Set<string>();
  for (const rawChild of childrenRaw) {
    const child = parseChild(rawChild, input, expectedAmounts);
    if (
      child === null
      || seenWallets.has(child.walletAccountId)
      || seenOrders.has(child.clientOrderId)
    ) return { kind: 'shape_mismatch', reason: 'batch child subject mismatch' };
    seenWallets.add(child.walletAccountId);
    seenOrders.add(child.clientOrderId);
    children.push(child);
  }
  if (children.length !== input.walletAccountIds.length) {
    return { kind: 'shape_mismatch', reason: 'batch child count mismatch' };
  }
  children.sort((left, right) => left.childIndex - right.childIndex);
  const parsedParent: EvmBatchOrderParent = {
    id: parent['id'],
    clientParentId: input.clientParentId,
    chain: input.chain,
    status: parentStatus,
    walletCount: input.walletAccountIds.length,
    side: input.side,
    token: input.token.toLowerCase(),
    totalSpendAsset: expectedAsset,
    totalSpendBaseUnits: expectedTotal,
    sellPercentBps: input.side === 'sell' ? input.sellPercentBps ?? null : null,
    totalTokensIn: input.side === 'sell' && input.sellTokensInByWallet !== undefined
      ? expectedTotal
      : null,
    maxSlippageBps: input.maxSlippageBps,
    errorCode: parentErrorCode,
  };
  const kind = parentStatus === 'partial_failed'
    ? 'partial_failed'
    : parentStatus === 'failed'
      ? 'failed'
      : parentStatus === 'cancelled'
        ? 'cancelled'
        : 'ok';
  return { kind, parent: parsedParent, children };
}

export interface SubmitEvmBatchOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
  readonly postImpl?: (
    body: EvmBatchOrderWire,
    authToken: string | null | undefined,
    signal: AbortSignal,
  ) => Promise<Response>;
}

async function postOnce(
  body: EvmBatchOrderWire,
  input: EvmBatchOrderInput,
  options: SubmitEvmBatchOptions,
): Promise<EvmBatchOrderResult> {
  const timeout = AbortSignal.timeout(EVM_BATCH_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
  let response: Response;
  try {
    response = options.postImpl === undefined
      ? await fetchAuthenticatedApi(
          '/api/v1/trade/batch-orders',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
          { authToken: options.authToken, signal },
        )
      : await options.postImpl(body, options.authToken, signal);
  } catch (error) {
    return {
      kind: 'unknown_outcome',
      reason: error instanceof Error ? error.message : 'batch request did not complete',
    };
  }
  const raw = await response.json().catch(() => null);
  return parseEvmBatchOrderResponse(raw, response.status, input);
}

/** Submit once, with the only automatic retry being a pre-intake reauth. */
export async function submitEvmBatchOrder(
  input: EvmBatchOrderInput,
  options: SubmitEvmBatchOptions = {},
): Promise<EvmBatchOrderResult> {
  const built = buildEvmBatchOrderBody(input);
  if (built.kind === 'invalid') return { kind: 'invalid_input', reason: built.reason };
  const first = await postOnce(built.body, input, options);
  if (
    first.kind !== 'reauth'
    || typeof options.authToken !== 'string'
    || getClerkSession().isSignedIn !== true
  ) return first;
  const freshToken = await mintFreshOrderToken();
  if (freshToken === null) return first;
  return postOnce(built.body, input, { ...options, authToken: freshToken });
}

/** Stable material for holding one parent id against one exact batch intent. */
export function evmBatchOrderFingerprint(body: EvmBatchOrderWire): string {
  return JSON.stringify(body);
}

/** Byte-for-byte mirror of the gateway's normalized request fingerprint.
 * `client_parent_id` is intentionally absent there: it identifies the row,
 * while this digest proves the immutable order body held under that key. */
export async function evmBatchRequestFingerprintSha256(
  body: EvmBatchOrderWire,
): Promise<string> {
  const sellAmounts = body.wallet_account_ids.map((walletId) => [
    walletId,
    body.side === 'sell' ? body.sell_tokens_in?.[walletId] ?? null : null,
  ]);
  const balanceHints = body.wallet_account_ids.map((walletId) => [
    walletId,
    body.side === 'sell' ? body.sell_token_balance_hints?.[walletId] ?? null : null,
  ]);
  const material = JSON.stringify([
    body.chain,
    body.wallet_account_ids,
    body.side,
    body.mint,
    'equal',
    null,
    null,
    body.side === 'buy' ? body.native_in_wei ?? null : null,
    body.side === 'buy' ? body.quote_in ?? null : null,
    body.side === 'buy' ? body.quote_asset ?? null : null,
    null,
    body.side === 'sell' ? body.sell_percent_bps ?? null : null,
    sellAmounts,
    balanceHints,
    body.max_slippage_bps,
    null,
    null,
    null,
    null,
    null,
    body.client_ts ?? null,
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type EvmBatchOrderStatusResult =
  | {
      readonly kind: 'found';
      readonly requestFingerprintSha256: string;
      readonly outcome: 'ok' | 'partial_failed' | 'failed' | 'cancelled';
      readonly parent: EvmBatchOrderParent;
      readonly children: readonly EvmBatchOrderChild[];
      readonly serverReceivedAtMs: number;
    }
  | {
      readonly kind: 'missing';
      readonly chain: EvmBatchChain;
      readonly clientParentId: string;
      readonly serverReceivedAtMs: number;
    }
  | { readonly kind: 'reauth'; readonly reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly errorCode: string;
      readonly message: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'invalid_input'; readonly reason: string }
  | { readonly kind: 'shape_mismatch'; readonly reason: string };

export async function parseEvmBatchOrderStatusResponse(
  raw: unknown,
  status: number,
  input: EvmBatchOrderInput,
  expectedFingerprintSha256: string,
): Promise<EvmBatchOrderStatusResult> {
  const body = object(raw);
  if (body === null) return { kind: 'shape_mismatch', reason: 'status response is not an object' };
  if (body['reauth_required'] === true) {
    const reason = body['reason'];
    return {
      kind: 'reauth',
      reason: reason === 'no_session' || reason === 'session_expired' || reason === 'session_invalid'
        ? reason
        : 'session_invalid',
    };
  }
  if (typeof body['error_code'] === 'string') {
    return {
      kind: 'refused',
      status,
      errorCode: body['error_code'],
      message: typeof body['message'] === 'string'
        ? body['message']
        : 'Batch status is unavailable.',
    };
  }
  const serverReceivedAtMs = body['server_received_at_ms'];
  if (
    status !== 200
    || body['reauth_required'] !== false
    || !Number.isSafeInteger(serverReceivedAtMs)
    || (serverReceivedAtMs as number) < 0
  ) {
    return { kind: 'shape_mismatch', reason: 'unrecognised batch status envelope' };
  }
  if (body['found'] === false) {
    if (
      body['chain'] !== input.chain
      || body['client_parent_id'] !== input.clientParentId
    ) return { kind: 'shape_mismatch', reason: 'missing batch subject mismatch' };
    return {
      kind: 'missing',
      chain: input.chain,
      clientParentId: input.clientParentId,
      serverReceivedAtMs: serverReceivedAtMs as number,
    };
  }
  if (
    body['found'] !== true
    || typeof body['request_fingerprint_sha256'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(body['request_fingerprint_sha256'])
    || body['request_fingerprint_sha256'] !== expectedFingerprintSha256
  ) return { kind: 'shape_mismatch', reason: 'batch recovery fingerprint mismatch' };

  const parsed = parseEvmBatchOrderResponse(body, status, input);
  if (
    parsed.kind !== 'ok'
    && parsed.kind !== 'partial_failed'
    && parsed.kind !== 'failed'
    && parsed.kind !== 'cancelled'
  ) {
    return parsed.kind === 'shape_mismatch'
      ? parsed
      : { kind: 'shape_mismatch', reason: `unexpected batch status outcome ${parsed.kind}` };
  }
  return {
    kind: 'found',
    requestFingerprintSha256: body['request_fingerprint_sha256'],
    outcome: parsed.kind,
    parent: parsed.parent,
    children: parsed.children,
    serverReceivedAtMs: serverReceivedAtMs as number,
  };
}

export interface FetchEvmBatchStatusOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
  readonly getImpl?: (
    path: string,
    authToken: string | null | undefined,
    signal: AbortSignal,
  ) => Promise<Response>;
}

async function getStatusOnce(
  input: EvmBatchOrderInput,
  expectedFingerprintSha256: string,
  options: FetchEvmBatchStatusOptions,
): Promise<EvmBatchOrderStatusResult> {
  const timeout = AbortSignal.timeout(EVM_BATCH_STATUS_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
  const params = new URLSearchParams({
    chain: input.chain,
    client_parent_id: input.clientParentId,
  });
  const path = `/api/v1/trade/batch-orders?${params.toString()}`;
  let response: Response;
  try {
    response = options.getImpl === undefined
      ? await fetchAuthenticatedApi(path, { method: 'GET' }, { authToken: options.authToken, signal })
      : await options.getImpl(path, options.authToken, signal);
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : 'batch status request did not complete',
    };
  }
  const raw = await response.json().catch(() => null);
  return parseEvmBatchOrderStatusResponse(raw, response.status, input, expectedFingerprintSha256);
}

/** Read-only recovery. A missing row is observational only and never causes
 * a new POST or a new parent key. */
export async function fetchEvmBatchOrderStatus(
  input: EvmBatchOrderInput,
  options: FetchEvmBatchStatusOptions = {},
): Promise<EvmBatchOrderStatusResult> {
  const built = buildEvmBatchOrderBody(input);
  if (built.kind === 'invalid') return { kind: 'invalid_input', reason: built.reason };
  const fingerprint = await evmBatchRequestFingerprintSha256(built.body);
  const first = await getStatusOnce(input, fingerprint, options);
  if (
    first.kind !== 'reauth'
    || typeof options.authToken !== 'string'
    || getClerkSession().isSignedIn !== true
  ) return first;
  const freshToken = await mintFreshOrderToken();
  if (freshToken === null) return first;
  return getStatusOnce(input, fingerprint, { ...options, authToken: freshToken });
}

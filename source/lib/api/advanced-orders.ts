'use client';

import { fetchAuthenticatedApi } from './trading';
import { mintFreshOrderToken, shouldRetryReauth, type SubmitOrderOptions } from './orders';

/**
 * Client for the advanced-orders engine (DCA/recurring + limit):
 *
 *   POST   /api/v1/trade/advanced-orders          create
 *   GET    /api/v1/trade/advanced-orders?chain=&mint=&status=   list
 *   GET    /api/v1/trade/advanced-orders/:id      detail + executions
 *   PATCH  /api/v1/trade/advanced-orders/:id      pause / resume / edit
 *   POST   /api/v1/trade/advanced-orders/:id/cancel
 *
 * List reads are chain-qualified. Detail/action routes identify a row by its
 * UUID, so their successful response must echo the expected chain before it
 * can be accepted by a chain-specific UI.
 */

export type AdvancedOrderKind = 'recurring' | 'limit';
export type AdvancedOrderChain = 'solana' | 'bsc' | 'robinhood_chain';

export type AdvancedOrderStatus =
  | 'active'
  | 'paused_user'
  | 'paused_price'
  | 'paused_auth'
  | 'paused_funds'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AdvancedPriceBasis = 'price_usd' | 'market_cap_usd';
export type AdvancedTriggerCmp = 'lte' | 'gte';

interface CreateAdvancedOrderRequestBase {
  /** `advc-${crypto.randomUUID()}` — create idempotency key. */
  client_order_id: string;
  kind: AdvancedOrderKind;
  wallet_account_id: string;
  input_mint: string;
  output_mint: string;
  /** Integer base units of `input_mint` (lamports / micro / SPL base). */
  total_input_base_units: string;
  suborders_total: number;
  duration_seconds: number;
  slippage_bps: number;
  /**
   * Fee overrides captured from the user's ACTIVE preset (P1/P2/P3) at
   * creation time — the same values the Market tab ships per order —
   * stored on the advanced order and applied to every executed leg.
   * Integer lamports as bigint strings.
   */
  priority_lamports: string;
  bribe_lamports: string;
  price_basis?: AdvancedPriceBasis;
  /** Decimal strings — floats never touch USD wire fields. */
  price_floor_usd?: string;
  price_ceiling_usd?: string;
  trigger_cmp?: AdvancedTriggerCmp;
  trigger_value_usd?: string;
  expires_at_ms?: number;
}

export type CreateAdvancedOrderRequest = CreateAdvancedOrderRequestBase &
  (
    | { chain: 'solana'; quote_asset?: never }
    | {
        chain: 'bsc' | 'robinhood_chain';
        /** Exact venue settlement asset (`native` or a lowercase ERC-20 address). */
        quote_asset: string;
      }
  );

/** One `trading.advanced_orders` row as the api/ serves it. */
export interface AdvancedOrderView {
  readonly id: string;
  readonly client_order_id: string;
  readonly chain: AdvancedOrderChain;
  readonly kind: AdvancedOrderKind;
  readonly status: AdvancedOrderStatus;
  readonly status_detail: string | null;
  readonly wallet_account_id: string;
  readonly input_mint: string;
  readonly output_mint: string;
  readonly quote_asset: string | null;
  readonly gate_asset: string | null;
  readonly total_input_base_units: string;
  readonly suborders_total: number;
  readonly suborders_executed: number;
  readonly interval_seconds: number;
  readonly slippage_bps: number;
  readonly price_basis: AdvancedPriceBasis | null;
  readonly price_floor_usd: string | null;
  readonly price_ceiling_usd: string | null;
  readonly trigger_cmp: AdvancedTriggerCmp | null;
  readonly trigger_value_usd: string | null;
  readonly expires_at: string | null;
  readonly next_run_at: string | null;
  readonly input_spent_base_units: string;
  readonly output_received_base_units: string;
  /** Solana-only creation-time fee overrides; exact zero strings on EVM. */
  readonly priority_lamports: string;
  readonly bribe_lamports: string;
  readonly error_retry_count: number;
  readonly last_error_kind: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly terminal_at: string | null;
  /** Set while a recurring order is paused outside its price range. */
  readonly gated_since: string | null;
  /** The pump-token side of the pair that gating/triggers evaluate on. */
  readonly gate_mint: string | null;
  /** Catalog enrichment (list endpoint); null when the mint is unknown. */
  readonly input_token: AdvancedOrderTokenInfo | null;
  readonly output_token: AdvancedOrderTokenInfo | null;
}

export interface AdvancedOrderTokenInfo {
  readonly mint: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number;
}

export interface AdvancedOrderExecutionView {
  readonly advanced_order_id: string;
  readonly suborder_index: number;
  readonly status: 'running' | 'filled' | 'failed' | 'skipped' | 'reverted';
  readonly attempt: number;
  readonly leg1_client_order_id: string;
  readonly leg2_client_order_id: string | null;
  readonly leg3_client_order_id: string | null;
  readonly input_base_units: string | null;
  readonly output_base_units: string | null;
  readonly error_kind: string | null;
  readonly error_cause: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly chain: AdvancedOrderChain;
  readonly trigger_block_number: string | null;
  readonly trigger_block_hash: string | null;
  readonly base_order_id: string | null;
  readonly fill_signature: string | null;
  readonly settlement_asset: string | null;
}

function parseTokenInfo(raw: unknown): AdvancedOrderTokenInfo | null {
  if (
    !isObject(raw) ||
    typeof raw['mint'] !== 'string' ||
    !nullableString(raw['symbol']) ||
    !nullableString(raw['name']) ||
    !nonnegativeSafeInteger(raw['decimals']) ||
    raw['decimals'] > 36
  ) {
    return null;
  }
  return {
    mint: raw['mint'],
    symbol: raw['symbol'],
    name: raw['name'],
    decimals: raw['decimals'],
  };
}

export type AdvancedOrderCreateResult =
  | { kind: 'ok'; order: AdvancedOrderView }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export type AdvancedOrderListResult =
  | { kind: 'ok'; orders: ReadonlyArray<AdvancedOrderView> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export type AdvancedOrderActionResult = AdvancedOrderCreateResult;

export type AdvancedOrderDetailResult =
  | {
      kind: 'ok';
      order: AdvancedOrderView;
      executions: ReadonlyArray<AdvancedOrderExecutionView>;
    }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

/** Same bounded round trip as the market-order submit. */
const ADVANCED_SUBMIT_TIMEOUT_MS = 10_000;

function submitSignal(callerSignal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(ADVANCED_SUBMIT_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function nullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return nonnegativeSafeInteger(value) && value > 0;
}

function isUintString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 39 && /^(0|[1-9][0-9]*)$/.test(value);
}

function isFeeString(value: unknown): value is string {
  return isUintString(value) && value.length <= 11;
}

function isDecimalString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:0\.[0-9]{0,17}[1-9]|[1-9][0-9]{0,20}(?:\.[0-9]{0,17}[1-9])?)$/.test(value)
  );
}

function nullableDecimalString(value: unknown): value is string | null {
  return value === null || isDecimalString(value);
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function nullableIsoString(value: unknown): value is string | null {
  return value === null || isIsoString(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const EVM_TX_HASH = /^0x[0-9a-f]{64}$/;
const EVM_BLOCK_NUMBER = /^(0|[1-9][0-9]{0,19})$/;

function isAdvancedOrderChain(value: unknown): value is AdvancedOrderChain {
  return value === 'solana' || value === 'bsc' || value === 'robinhood_chain';
}

function isAdvancedOrderStatus(value: unknown): value is AdvancedOrderStatus {
  return (
    value === 'active' ||
    value === 'paused_user' ||
    value === 'paused_price' ||
    value === 'paused_auth' ||
    value === 'paused_funds' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'failed'
  );
}

function isNullableBasis(value: unknown): value is AdvancedPriceBasis | null {
  return value === null || value === 'price_usd' || value === 'market_cap_usd';
}

function isNullableCmp(value: unknown): value is AdvancedTriggerCmp | null {
  return value === null || value === 'lte' || value === 'gte';
}

function evmAssetsMatch(row: Record<string, unknown>): boolean {
  const quote = row['quote_asset'];
  const gate = row['gate_asset'];
  const input = row['input_mint'];
  const output = row['output_mint'];
  return (
    (quote === 'native' || EVM_ADDRESS.test(String(quote))) &&
    typeof gate === 'string' &&
    EVM_ADDRESS.test(gate) &&
    typeof input === 'string' &&
    typeof output === 'string' &&
    input !== output &&
    ((input === quote && output === gate) || (input === gate && output === quote)) &&
    row['gate_mint'] === gate &&
    row['input_token'] === null &&
    row['output_token'] === null &&
    row['priority_lamports'] === '0' &&
    row['bribe_lamports'] === '0'
  );
}

/** Strict row parse. A malformed money, chain, or identity field rejects the row. */
export function parseAdvancedOrderView(raw: unknown): AdvancedOrderView | null {
  if (!isObject(raw)) return null;
  const id = raw['id'];
  const clientOrderId = raw['client_order_id'];
  const chain = raw['chain'];
  const kind = raw['kind'];
  const status = raw['status'];
  const walletAccountId = raw['wallet_account_id'];
  const inputMint = raw['input_mint'];
  const outputMint = raw['output_mint'];
  const inputToken = raw['input_token'];
  const outputToken = raw['output_token'];
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    typeof clientOrderId !== 'string' ||
    clientOrderId.length === 0 ||
    !isAdvancedOrderChain(chain) ||
    (kind !== 'recurring' && kind !== 'limit') ||
    !isAdvancedOrderStatus(status) ||
    typeof walletAccountId !== 'string' ||
    !UUID.test(walletAccountId) ||
    typeof inputMint !== 'string' ||
    inputMint.length === 0 ||
    typeof outputMint !== 'string' ||
    outputMint.length === 0 ||
    !nullableString(raw['status_detail']) ||
    !isUintString(raw['total_input_base_units']) ||
    raw['total_input_base_units'] === '0' ||
    !positiveSafeInteger(raw['suborders_total']) ||
    raw['suborders_total'] > 10_000 ||
    !nonnegativeSafeInteger(raw['suborders_executed']) ||
    raw['suborders_executed'] > raw['suborders_total'] ||
    !positiveSafeInteger(raw['interval_seconds']) ||
    !positiveSafeInteger(raw['slippage_bps']) ||
    raw['slippage_bps'] > 10_000 ||
    !isNullableBasis(raw['price_basis']) ||
    !nullableDecimalString(raw['price_floor_usd']) ||
    !nullableDecimalString(raw['price_ceiling_usd']) ||
    !isNullableCmp(raw['trigger_cmp']) ||
    !nullableDecimalString(raw['trigger_value_usd']) ||
    !nullableIsoString(raw['expires_at']) ||
    !nullableIsoString(raw['next_run_at']) ||
    !isUintString(raw['input_spent_base_units']) ||
    !isUintString(raw['output_received_base_units']) ||
    !isFeeString(raw['priority_lamports']) ||
    !isFeeString(raw['bribe_lamports']) ||
    !nonnegativeSafeInteger(raw['error_retry_count']) ||
    !nullableString(raw['last_error_kind']) ||
    !isIsoString(raw['created_at']) ||
    !isIsoString(raw['updated_at']) ||
    !nullableIsoString(raw['terminal_at']) ||
    !nullableIsoString(raw['gated_since']) ||
    typeof raw['gate_mint'] !== 'string'
  ) {
    return null;
  }
  const parsedInputToken = inputToken === null ? null : parseTokenInfo(inputToken);
  const parsedOutputToken = outputToken === null ? null : parseTokenInfo(outputToken);
  if (
    chain === 'solana'
      ? raw['quote_asset'] !== null ||
        raw['gate_asset'] !== null ||
        parsedInputToken === null ||
        parsedOutputToken === null ||
        parsedInputToken.mint !== inputMint ||
        parsedOutputToken.mint !== outputMint
      : !evmAssetsMatch(raw)
  ) {
    return null;
  }
  return {
    id,
    client_order_id: clientOrderId,
    chain,
    kind,
    status,
    status_detail: raw['status_detail'],
    wallet_account_id: walletAccountId,
    input_mint: inputMint,
    output_mint: outputMint,
    quote_asset: raw['quote_asset'] as string | null,
    gate_asset: raw['gate_asset'] as string | null,
    total_input_base_units: raw['total_input_base_units'],
    suborders_total: raw['suborders_total'],
    suborders_executed: raw['suborders_executed'],
    interval_seconds: raw['interval_seconds'],
    slippage_bps: raw['slippage_bps'],
    price_basis: raw['price_basis'],
    price_floor_usd: raw['price_floor_usd'],
    price_ceiling_usd: raw['price_ceiling_usd'],
    trigger_cmp: raw['trigger_cmp'],
    trigger_value_usd: raw['trigger_value_usd'],
    expires_at: raw['expires_at'],
    next_run_at: raw['next_run_at'],
    input_spent_base_units: raw['input_spent_base_units'],
    output_received_base_units: raw['output_received_base_units'],
    priority_lamports: raw['priority_lamports'],
    bribe_lamports: raw['bribe_lamports'],
    error_retry_count: raw['error_retry_count'],
    last_error_kind: raw['last_error_kind'],
    created_at: raw['created_at'],
    updated_at: raw['updated_at'],
    terminal_at: raw['terminal_at'],
    gated_since: raw['gated_since'],
    gate_mint: raw['gate_mint'],
    input_token: parsedInputToken,
    output_token: parsedOutputToken,
  };
}

export function parseAdvancedOrderExecutionView(
  raw: unknown,
  expectedOrderId: string,
  expectedChain: AdvancedOrderChain,
  expectedSettlementAsset: string | null,
): AdvancedOrderExecutionView | null {
  if (!isObject(raw)) return null;
  const status = raw['status'];
  if (
    raw['advanced_order_id'] !== expectedOrderId ||
    !UUID.test(expectedOrderId) ||
    !nonnegativeSafeInteger(raw['suborder_index']) ||
    (status !== 'running' &&
      status !== 'filled' &&
      status !== 'failed' &&
      status !== 'skipped' &&
      status !== 'reverted') ||
    !positiveSafeInteger(raw['attempt']) ||
    typeof raw['leg1_client_order_id'] !== 'string' ||
    raw['leg1_client_order_id'].length === 0 ||
    !nullableString(raw['leg2_client_order_id']) ||
    !nullableString(raw['leg3_client_order_id']) ||
    !(raw['input_base_units'] === null || isUintString(raw['input_base_units'])) ||
    !(raw['output_base_units'] === null || isUintString(raw['output_base_units'])) ||
    !nullableString(raw['error_kind']) ||
    !nullableString(raw['error_cause']) ||
    !isIsoString(raw['started_at']) ||
    !nullableIsoString(raw['finished_at']) ||
    raw['chain'] !== expectedChain ||
    !(
      raw['trigger_block_number'] === null ||
      (typeof raw['trigger_block_number'] === 'string' &&
        EVM_BLOCK_NUMBER.test(raw['trigger_block_number']))
    ) ||
    !(
      raw['trigger_block_hash'] === null ||
      (typeof raw['trigger_block_hash'] === 'string' && EVM_TX_HASH.test(raw['trigger_block_hash']))
    ) ||
    !(
      raw['base_order_id'] === null ||
      (typeof raw['base_order_id'] === 'string' && UUID.test(raw['base_order_id']))
    ) ||
    !(
      raw['fill_signature'] === null ||
      (typeof raw['fill_signature'] === 'string' && EVM_TX_HASH.test(raw['fill_signature']))
    ) ||
    !(
      raw['settlement_asset'] === null ||
      (typeof raw['settlement_asset'] === 'string' &&
        (raw['settlement_asset'] === 'native' || EVM_ADDRESS.test(raw['settlement_asset'])))
    ) ||
    (expectedChain === 'solana'
      ? raw['settlement_asset'] !== null
      : raw['settlement_asset'] !== null && raw['settlement_asset'] !== expectedSettlementAsset)
  ) {
    return null;
  }
  return {
    advanced_order_id: expectedOrderId,
    suborder_index: raw['suborder_index'],
    status,
    attempt: raw['attempt'],
    leg1_client_order_id: raw['leg1_client_order_id'],
    leg2_client_order_id: raw['leg2_client_order_id'],
    leg3_client_order_id: raw['leg3_client_order_id'],
    input_base_units: raw['input_base_units'],
    output_base_units: raw['output_base_units'],
    error_kind: raw['error_kind'],
    error_cause: raw['error_cause'],
    started_at: raw['started_at'],
    finished_at: raw['finished_at'],
    chain: expectedChain,
    trigger_block_number: raw['trigger_block_number'],
    trigger_block_hash: raw['trigger_block_hash'],
    base_order_id: raw['base_order_id'],
    fill_signature: raw['fill_signature'],
    settlement_asset: raw['settlement_asset'],
  };
}

function parseReauthReason(v: unknown): 'no_session' | 'session_expired' | 'session_invalid' {
  return v === 'no_session' || v === 'session_expired' || v === 'session_invalid'
    ? v
    : 'session_invalid';
}

interface ExpectedOrderSubject {
  readonly chain: AdvancedOrderChain;
  readonly clientOrderId?: string;
  readonly kind?: AdvancedOrderKind;
  readonly walletAccountId?: string;
  readonly inputMint?: string;
  readonly outputMint?: string;
  readonly quoteAsset?: string | null;
  readonly totalInputBaseUnits?: string;
}

function orderMatchesSubject(order: AdvancedOrderView, expected: ExpectedOrderSubject): boolean {
  return (
    order.chain === expected.chain &&
    (expected.clientOrderId === undefined || order.client_order_id === expected.clientOrderId) &&
    (expected.kind === undefined || order.kind === expected.kind) &&
    (expected.walletAccountId === undefined ||
      order.wallet_account_id === expected.walletAccountId) &&
    (expected.inputMint === undefined || order.input_mint === expected.inputMint) &&
    (expected.outputMint === undefined || order.output_mint === expected.outputMint) &&
    (expected.quoteAsset === undefined || order.quote_asset === expected.quoteAsset) &&
    (expected.totalInputBaseUnits === undefined ||
      order.total_input_base_units === expected.totalInputBaseUnits)
  );
}

function parseSingleOrderResponse(
  json: Record<string, unknown>,
  httpStatus: number,
  expected: ExpectedOrderSubject,
): AdvancedOrderCreateResult {
  if (json['reauth_required'] === true) {
    return { kind: 'reauth', reason: parseReauthReason(json['reason']) };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    // The api serves the row under `advanced_order` on create/patch/cancel.
    const order =
      json['reauth_required'] === false
        ? parseAdvancedOrderView(json['advanced_order'] ?? json['order'])
        : null;
    if (order !== null && orderMatchesSubject(order, expected)) return { kind: 'ok', order };
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: order === null ? 'shape_mismatch' : 'subject_mismatch',
      message:
        order === null
          ? 'API returned an unexpected success shape'
          : 'API returned an order for a different request subject',
    };
  }
  return {
    kind: 'error',
    status: httpStatus,
    errorCode: asStr(json['error_code'], 'unknown'),
    message: asStr(json['message'], 'request failed'),
  };
}

async function postJson(
  path: string,
  body: unknown,
  options: SubmitOrderOptions,
): Promise<{ json: Record<string, unknown>; status: number } | { networkError: string }> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: submitSignal(options.signal) },
    );
  } catch (err) {
    return { networkError: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { json, status: res.status };
}

/**
 * Create a DCA/recurring or limit order. One-shot reauth retry mirrors
 * `submitOrder`: the api reauths strictly BEFORE intake and creation is
 * idempotent on `client_order_id`, so a re-POST of the identical body
 * can never double-create.
 */
export async function createAdvancedOrder(
  body: CreateAdvancedOrderRequest,
  options: SubmitOrderOptions = {},
): Promise<AdvancedOrderCreateResult> {
  const invalid = validateCreateRequest(body);
  if (invalid !== null) return invalid;
  let result = await createOnce(body, options);
  if (result.kind === 'reauth' && shouldRetryReauth(options)) {
    const freshToken = await mintFreshOrderToken();
    if (freshToken !== null) {
      result = await createOnce(body, { ...options, authToken: freshToken });
    }
  }
  return result;
}

/**
 * Map the client request onto the api's Ajv wire shape: USD fields remain
 * canonical decimal strings, `expires_at` is ISO, and `duration_seconds` is only
 * legal on recurring orders (the schema enforces `minimum: 1`).
 */
function toCreateWireBody(body: CreateAdvancedOrderRequest): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    chain: body.chain,
    client_order_id: body.client_order_id,
    kind: body.kind,
    wallet_account_id: body.wallet_account_id,
    input_mint: body.input_mint,
    output_mint: body.output_mint,
    total_input_base_units: body.total_input_base_units,
    suborders_total: body.suborders_total,
    slippage_bps: body.slippage_bps,
    priority_lamports: body.priority_lamports,
    bribe_lamports: body.bribe_lamports,
  };
  if (body.chain !== 'solana') wire['quote_asset'] = body.quote_asset;
  if (body.kind === 'recurring' && body.duration_seconds > 0) {
    wire['duration_seconds'] = body.duration_seconds;
  }
  if (body.price_basis !== undefined) wire['price_basis'] = body.price_basis;
  if (body.price_floor_usd !== undefined) wire['price_floor_usd'] = body.price_floor_usd;
  if (body.price_ceiling_usd !== undefined) wire['price_ceiling_usd'] = body.price_ceiling_usd;
  if (body.trigger_cmp !== undefined) wire['trigger_cmp'] = body.trigger_cmp;
  if (body.trigger_value_usd !== undefined) wire['trigger_value_usd'] = body.trigger_value_usd;
  if (body.expires_at_ms !== undefined && Number.isFinite(body.expires_at_ms)) {
    wire['expires_at'] = new Date(body.expires_at_ms).toISOString();
  }
  return wire;
}

/** Return a local fail-closed validation result before any authenticated request. */
function invalidCreate(message: string): AdvancedOrderCreateResult {
  return { kind: 'error', status: 400, errorCode: 'invalid_advanced_order', message };
}

function validateCreateRequest(body: CreateAdvancedOrderRequest): AdvancedOrderCreateResult | null {
  if (!UUID.test(body.wallet_account_id)) return invalidCreate('wallet_account_id is invalid');
  if (!isUintString(body.total_input_base_units) || body.total_input_base_units === '0') {
    return invalidCreate('total_input_base_units must be a positive integer string');
  }
  if (!isFeeString(body.priority_lamports) || !isFeeString(body.bribe_lamports)) {
    return invalidCreate('fee overrides must be integer strings');
  }
  for (const value of [body.price_floor_usd, body.price_ceiling_usd, body.trigger_value_usd]) {
    if (value !== undefined && !isDecimalString(value)) {
      return invalidCreate('USD values must be canonical positive decimal strings');
    }
  }
  if (body.expires_at_ms !== undefined && !Number.isFinite(body.expires_at_ms)) {
    return invalidCreate('expires_at_ms must be finite');
  }
  if (body.chain !== 'solana') {
    const quote = body.quote_asset;
    if (
      (quote !== 'native' && !EVM_ADDRESS.test(quote)) ||
      (body.input_mint !== 'native' && !EVM_ADDRESS.test(body.input_mint)) ||
      (body.output_mint !== 'native' && !EVM_ADDRESS.test(body.output_mint)) ||
      body.input_mint === body.output_mint ||
      (body.input_mint !== quote && body.output_mint !== quote)
    ) {
      return invalidCreate('EVM assets must form an exact lowercase quote/token pair');
    }
    if (body.priority_lamports !== '0' || body.bribe_lamports !== '0') {
      return invalidCreate('Solana fee overrides are not valid on EVM orders');
    }
  }
  return null;
}

async function createOnce(
  body: CreateAdvancedOrderRequest,
  options: SubmitOrderOptions,
): Promise<AdvancedOrderCreateResult> {
  const res = await postJson('/api/v1/trade/advanced-orders', toCreateWireBody(body), options);
  if ('networkError' in res) return { kind: 'network_error', reason: res.networkError };
  return parseSingleOrderResponse(res.json, res.status, {
    chain: body.chain,
    clientOrderId: body.client_order_id,
    kind: body.kind,
    walletAccountId: body.wallet_account_id,
    inputMint: body.input_mint,
    outputMint: body.output_mint,
    quoteAsset: body.chain === 'solana' ? null : body.quote_asset,
    totalInputBaseUnits: body.total_input_base_units,
  });
}

export interface ListAdvancedOrdersInput {
  readonly chain?: AdvancedOrderChain;
  readonly mint?: string;
  readonly status?: AdvancedOrderStatus;
  readonly limit?: number;
}

export async function listAdvancedOrders(
  input: ListAdvancedOrdersInput = {},
  options: SubmitOrderOptions = {},
): Promise<AdvancedOrderListResult> {
  const expectedChain = input.chain ?? 'solana';
  const params = new URLSearchParams();
  params.set('chain', expectedChain);
  if (input.mint !== undefined) params.set('mint', input.mint);
  if (input.status !== undefined) params.set('status', input.status);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const path = `/api/v1/trade/advanced-orders?${params.toString()}`;
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      path,
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
  if (json['reauth_required'] === true) {
    return { kind: 'reauth', reason: parseReauthReason(json['reason']) };
  }
  if (res.ok && json['reauth_required'] === false && Array.isArray(json['orders'])) {
    const orders: AdvancedOrderView[] = [];
    for (const raw of json['orders']) {
      const parsed = parseAdvancedOrderView(raw);
      if (parsed === null) {
        return {
          kind: 'error',
          status: res.status,
          errorCode: 'shape_mismatch',
          message: 'API returned an unexpected order row',
        };
      }
      if (parsed.chain !== expectedChain) {
        return {
          kind: 'error',
          status: res.status,
          errorCode: 'subject_mismatch',
          message: 'API returned an order for a different chain',
        };
      }
      orders.push(parsed);
    }
    return { kind: 'ok', orders };
  }
  if (res.ok) {
    return {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'API returned an unexpected list shape',
    };
  }
  return {
    kind: 'error',
    status: res.status,
    errorCode: asStr(json['error_code'], 'unknown'),
    message: asStr(json['message'], 'request failed'),
  };
}

export interface AdvancedOrderSubjectOptions extends SubmitOrderOptions {
  readonly expectedChain?: AdvancedOrderChain;
}

/** GET /:id. The row UUID is global; bind the response to its expected chain. */
export async function getAdvancedOrder(
  id: string,
  options: AdvancedOrderSubjectOptions = {},
): Promise<AdvancedOrderDetailResult> {
  const expectedChain = options.expectedChain ?? 'solana';
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      `/api/v1/trade/advanced-orders/${encodeURIComponent(id)}`,
      { method: 'GET' },
      {
        authToken: options.authToken,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  } catch (error) {
    return { kind: 'network_error', reason: (error as Error).message ?? 'network_error' };
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    return { kind: 'reauth', reason: parseReauthReason(json['reason']) };
  }
  if (response.ok && json['reauth_required'] === false) {
    const order = parseAdvancedOrderView(json['advanced_order']);
    if (order === null) {
      return {
        kind: 'error',
        status: response.status,
        errorCode: 'shape_mismatch',
        message: 'API returned an unexpected order detail',
      };
    }
    if (order.chain !== expectedChain) {
      return {
        kind: 'error',
        status: response.status,
        errorCode: 'subject_mismatch',
        message: 'API returned an order for a different chain',
      };
    }
    if (!Array.isArray(json['executions'])) {
      return {
        kind: 'error',
        status: response.status,
        errorCode: 'shape_mismatch',
        message: 'API returned an unexpected execution list',
      };
    }
    const executions: AdvancedOrderExecutionView[] = [];
    for (const raw of json['executions']) {
      const execution = parseAdvancedOrderExecutionView(
        raw,
        order.id,
        order.chain,
        order.quote_asset,
      );
      if (execution === null) {
        return {
          kind: 'error',
          status: response.status,
          errorCode: 'shape_mismatch',
          message: 'API returned an unexpected execution row',
        };
      }
      executions.push(execution);
    }
    return { kind: 'ok', order, executions };
  }
  if (response.ok) {
    return {
      kind: 'error',
      status: response.status,
      errorCode: 'shape_mismatch',
      message: 'API returned an unexpected detail shape',
    };
  }
  return {
    kind: 'error',
    status: response.status,
    errorCode: asStr(json['error_code'], 'unknown'),
    message: asStr(json['message'], 'request failed'),
  };
}

async function verifyAdvancedOrderSubject(
  id: string,
  options: AdvancedOrderSubjectOptions,
): Promise<Exclude<AdvancedOrderActionResult, { kind: 'ok' }> | null> {
  const detail = await getAdvancedOrder(id, options);
  return detail.kind === 'ok' ? null : detail;
}

export type PatchAdvancedOrderRequest =
  | { action: 'pause' }
  | { action: 'resume' }
  | {
      action: 'edit';
      suborders_total?: number;
      /** Seconds between suborders (the api edits the interval directly). */
      interval_seconds?: number;
      slippage_bps?: number;
      /** Integer lamports as bigint strings (per-suborder fee overrides). */
      priority_lamports?: string;
      bribe_lamports?: string;
      price_basis?: AdvancedPriceBasis | null;
      price_floor_usd?: string | null;
      price_ceiling_usd?: string | null;
      /** Limit orders only: retarget the trigger (USD decimal string). */
      trigger_cmp?: AdvancedTriggerCmp;
      trigger_value_usd?: string;
      /** Limit orders only: ms epoch, null clears the expiry. */
      expires_at_ms?: number | null;
    };

/** Edit fields ride the same USD-string / ISO-expiry wire shapes as create.
 *  Edits send NO action field — the api's PATCH contract is action
 *  (pause/resume) XOR edit fields, and an unexpected action value is an
 *  Ajv reject (the original 'internal error' edit bug). */
function toPatchWireBody(body: PatchAdvancedOrderRequest): Record<string, unknown> {
  if (body.action !== 'edit') return { action: body.action };
  const wire: Record<string, unknown> = {};
  if (body.suborders_total !== undefined) wire['suborders_total'] = body.suborders_total;
  if (body.interval_seconds !== undefined) wire['interval_seconds'] = body.interval_seconds;
  if (body.slippage_bps !== undefined) wire['slippage_bps'] = body.slippage_bps;
  if (body.priority_lamports !== undefined) wire['priority_lamports'] = body.priority_lamports;
  if (body.bribe_lamports !== undefined) wire['bribe_lamports'] = body.bribe_lamports;
  if (body.price_basis !== undefined) wire['price_basis'] = body.price_basis;
  if (body.price_floor_usd !== undefined) {
    wire['price_floor_usd'] = body.price_floor_usd;
  }
  if (body.price_ceiling_usd !== undefined) {
    wire['price_ceiling_usd'] = body.price_ceiling_usd;
  }
  if (body.trigger_cmp !== undefined) wire['trigger_cmp'] = body.trigger_cmp;
  if (body.trigger_value_usd !== undefined) wire['trigger_value_usd'] = body.trigger_value_usd;
  if (body.expires_at_ms !== undefined) {
    wire['expires_at'] =
      body.expires_at_ms === null || !Number.isFinite(body.expires_at_ms)
        ? null
        : new Date(body.expires_at_ms).toISOString();
  }
  return wire;
}

/** PATCH /:id — pause / resume / edit (wave-2 Orders table uses this). */
export async function patchAdvancedOrder(
  id: string,
  body: PatchAdvancedOrderRequest,
  options: AdvancedOrderSubjectOptions = {},
): Promise<AdvancedOrderActionResult> {
  const expectedChain = options.expectedChain ?? 'solana';
  if (body.action === 'edit') {
    for (const value of [body.price_floor_usd, body.price_ceiling_usd, body.trigger_value_usd]) {
      if (value !== undefined && value !== null && !isDecimalString(value)) {
        return {
          kind: 'error',
          status: 400,
          errorCode: 'invalid_advanced_order',
          message: 'USD values must be canonical positive decimal strings',
        };
      }
    }
  }
  if (
    expectedChain !== 'solana' &&
    body.action === 'edit' &&
    (body.priority_lamports !== undefined || body.bribe_lamports !== undefined)
  ) {
    return {
      kind: 'error',
      status: 400,
      errorCode: 'invalid_fee_override',
      message: 'Solana fee overrides are not valid on EVM orders.',
    };
  }
  const subjectFailure = await verifyAdvancedOrderSubject(id, options);
  if (subjectFailure !== null) return subjectFailure;
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      `/api/v1/trade/advanced-orders/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toPatchWireBody(body)),
      },
      { authToken: options.authToken, signal: submitSignal(options.signal) },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseSingleOrderResponse(json, res.status, { chain: expectedChain });
}

/** POST /:id/cancel (wave-2 Orders table uses this). */
export async function cancelAdvancedOrder(
  id: string,
  options: AdvancedOrderSubjectOptions = {},
): Promise<AdvancedOrderActionResult> {
  const subjectFailure = await verifyAdvancedOrderSubject(id, options);
  if (subjectFailure !== null) return subjectFailure;
  const res = await postJson(
    `/api/v1/trade/advanced-orders/${encodeURIComponent(id)}/cancel`,
    {},
    options,
  );
  if ('networkError' in res) return { kind: 'network_error', reason: res.networkError };
  return parseSingleOrderResponse(res.json, res.status, {
    chain: options.expectedChain ?? 'solana',
  });
}

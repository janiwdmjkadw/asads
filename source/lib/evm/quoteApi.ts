'use client';

/**
 * Served EVM quote client — `GET /api/v1/evm/trade/quote`.
 *
 * The engine's quote endpoint runs the SAME routing and pricing decision the
 * order path runs, so `min_amount_out` here is the floor an identical order
 * would bind. The panel's client-side estimate (`lib/evm/quote.ts`) stays as
 * instant feedback while this round trip is in flight; the served figure is
 * the display truth once it lands.
 *
 * WIRE RULES, the same ones the order client holds:
 * - `native_in_wei` / `tokens_in` / `expected_out` / `min_amount_out` are all
 *   decimal STRINGS of integer base units. No amount touches a JS number.
 * - Refusals are PRODUCT STATES, not errors to normalize. `refused` /
 *   `reason` are the engine's own strings, verbatim
 *   (`order.chainNotConfigured`, `residentQuote.notWarm`, `v3Quote.noPool`,
 *   `quote_not_native`, …) — they distinguish "will never quote" from "one
 *   refresh from warm", and the UI branches on them rather than flattening
 *   them into a generic error.
 * - A quote is required confirmation truth for the exact visible subject.
 *   Submission blocks when it is absent, stale, or belongs to another
 *   wallet/slippage/asset selection. The engine still re-quotes at execution;
 *   this client gate never replaces that verifier-side check.
 */

import { fetchAuthenticatedApi } from '@/lib/api/trading';
import type { EvmOrderSide } from '@/lib/evm/orderApi';

export type EvmServedQuoteResult =
  | {
      kind: 'quoted';
      quoteVersion: 1;
      chain: 'bsc' | 'robinhood_chain';
      token: string;
      side: EvmOrderSide;
      walletAccountId: string;
      slippageBps: number;
      /** Decimal string of out base units (token units on a buy, wei on a sell). */
      expectedOut: string;
      /** The engine's binding floor for an identical order at this slippage. */
      minAmountOut: string;
      /** The exact market and route family that answered. */
      venue: string;
      routeMode: string;
      /** The exact request size and assets whose units the quote uses. */
      amountIn: string;
      inputAsset: EvmServedQuoteAsset;
      outputAsset: EvmServedQuoteAsset;
      approval: EvmServedQuoteApproval;
      platformFeeAsset: EvmServedQuoteAsset;
      platformFeeBaseUnits: string;
      platformFeeWei: string;
      /** Canonical observation identity. Both are null or both are present. */
      quotedBlockNumber: string;
      quotedBlockHash: string;
      quotedAtMs: number;
      expiresAtMs: number;
    }
  | { kind: 'reauth' }
  /** 503 `evm_quote_refused` — the engine's typed non-answer, verbatim. */
  | { kind: 'refused'; refused: string; reason: string | null }
  /** 429 `evm_admission_limited`. */
  | { kind: 'limited' }
  /** 502 `gateway_unavailable`, or the transport never answered. */
  | { kind: 'unavailable'; detail: string }
  /** 400 — a client bug; the message names the drift. */
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; reason: string };

export interface EvmServedQuoteAsset {
  readonly kind: 'native' | 'erc20';
  readonly address: string | null;
}

export interface EvmServedQuoteApproval {
  readonly required: boolean;
  readonly assetAddress: string | null;
  readonly spender: string | null;
  readonly amount: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const MONEY_DECIMAL = /^[1-9][0-9]{0,38}$/;
const NONNEGATIVE_MONEY_DECIMAL = /^(0|[1-9][0-9]{0,38})$/;
const U128_MAX = 340282366920938463463374607431768211455n;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function moneyString(value: unknown): string | null {
  return typeof value === 'string' &&
    MONEY_DECIMAL.test(value) &&
    BigInt(value) <= U128_MAX
    ? value
    : null;
}

function nonnegativeMoneyString(value: unknown): string | null {
  return typeof value === 'string' &&
    NONNEGATIVE_MONEY_DECIMAL.test(value) &&
    BigInt(value) <= U128_MAX
    ? value
    : null;
}

function sameAsset(left: EvmServedQuoteAsset, right: EvmServedQuoteAsset): boolean {
  return left.kind === right.kind && left.address === right.address;
}

function quoteAsset(value: unknown): EvmServedQuoteAsset | null {
  const asset = record(value);
  if (asset === null) return null;
  const kind = asset['kind'];
  const address = asset['address'];
  if (kind === 'native' && address === null) return { kind, address: null };
  if (kind === 'erc20' && typeof address === 'string' && EVM_ADDRESS.test(address)) {
    return { kind, address: address.toLowerCase() };
  }
  return null;
}

function quoteApproval(value: unknown): EvmServedQuoteApproval | null {
  const approval = record(value);
  if (approval === null) return null;
  const required = approval['required'];
  const assetAddress = approval['asset_address'];
  const spender = approval['spender'];
  const amount = approval['amount'];
  if (required === false) {
    return assetAddress === null && spender === null && amount === null
      ? { required: false, assetAddress: null, spender: null, amount: null }
      : null;
  }
  const parsedAmount = moneyString(amount);
  return required === true &&
    typeof assetAddress === 'string' &&
    EVM_ADDRESS.test(assetAddress) &&
    typeof spender === 'string' &&
    EVM_ADDRESS.test(spender) &&
    parsedAmount !== null
    ? {
        required: true,
        assetAddress: assetAddress.toLowerCase(),
        spender: spender.toLowerCase(),
        amount: parsedAmount,
      }
    : null;
}

/** Pure response classifier, exported so the contract is unit-testable. */
export function parseEvmServedQuoteResponse(
  body: Record<string, unknown> | null,
  httpStatus: number,
  expected?: Pick<
    FetchEvmServedQuoteInput,
    | 'chain'
    | 'token'
    | 'walletAccountId'
    | 'side'
    | 'amountBaseUnits'
    | 'quoteAssetAddress'
    | 'slippageBps'
  >,
  nowMs = Date.now(),
): EvmServedQuoteResult {
  if (body?.['reauth_required'] === true) return { kind: 'reauth' };
  if (httpStatus === 429) return { kind: 'limited' };
  if (httpStatus === 502) {
    return { kind: 'unavailable', detail: 'gateway_unavailable' };
  }
  if (httpStatus === 503 && body?.['error_code'] === 'evm_quote_refused') {
    const refused = body['refused'];
    const reason = body['reason'];
    return {
      kind: 'refused',
      // The engine's own vocabulary, verbatim — never rewritten here. An
      // unexpected shape still classifies as refused (the status + code said
      // so); the empty string routes the UI to its generic-refusal sentence.
      refused: typeof refused === 'string' ? refused : '',
      reason: typeof reason === 'string' ? reason : null,
    };
  }
  if (httpStatus === 400) {
    const message = body?.['message'];
    return {
      kind: 'invalid',
      message: typeof message === 'string' ? message : 'quote request rejected',
    };
  }
  if (httpStatus >= 200 && httpStatus < 300 && body !== null) {
    const chain = body['chain'];
    const token = body['token'];
    const side = body['side'];
    const walletAccountId = body['wallet_account_id'];
    const slippageBps = body['slippage_bps'];
    const expectedOut = moneyString(body['expected_out']);
    const minAmountOut = moneyString(body['min_amount_out']);
    const amountIn = moneyString(body['amount_in']);
    const inputAsset = quoteAsset(body['input_asset']);
    const outputAsset = quoteAsset(body['output_asset']);
    const approval = quoteApproval(body['approval']);
    const platformFeeAsset = quoteAsset(body['platform_fee_asset']);
    const platformFeeBaseUnits = nonnegativeMoneyString(body['platform_fee_base_units']);
    const platformFeeWei = nonnegativeMoneyString(body['platform_fee_wei']);
    const venue = body['venue'];
    const routeMode = body['route_mode'];
    const quotedBlockNumber = body['quoted_block_number'];
    const quotedBlockHash = body['quoted_block_hash'];
    const quotedAtMs = body['quoted_at_ms'];
    const expiresAtMs = body['expires_at_ms'];
    const tokenLower = typeof token === 'string' ? token.toLowerCase() : null;
    const requestedAmount = expected?.amountBaseUnits.toString();
    const expectedQuoteAddress = expected?.quoteAssetAddress?.toLowerCase() ?? null;
    const expectedQuoteAsset: EvmServedQuoteAsset = expectedQuoteAddress === null
      ? { kind: 'native', address: null }
      : { kind: 'erc20', address: expectedQuoteAddress };
    const assetsMatch =
      side === 'buy'
        ? inputAsset !== null &&
          sameAsset(inputAsset, expectedQuoteAsset) &&
          outputAsset?.kind === 'erc20' &&
          outputAsset.address === tokenLower &&
          (expectedQuoteAddress === null
            ? approval?.required === false
            : approval?.required === true &&
              approval.assetAddress === expectedQuoteAddress &&
              approval.amount === amountIn)
        : side === 'sell'
          ? inputAsset?.kind === 'erc20' &&
            inputAsset.address === tokenLower &&
            outputAsset !== null &&
            sameAsset(outputAsset, expectedQuoteAsset) &&
            approval?.required === true &&
            approval.assetAddress === tokenLower &&
            approval.amount === amountIn
          : false;
    const feeValid =
      inputAsset !== null &&
      outputAsset !== null &&
      platformFeeAsset !== null &&
      platformFeeBaseUnits !== null &&
      platformFeeWei !== null &&
      sameAsset(platformFeeAsset, side === 'buy' ? inputAsset : outputAsset) &&
      (platformFeeAsset.kind === 'native'
        ? platformFeeWei === platformFeeBaseUnits
        : platformFeeWei === '0');
    const blockIdentityValid =
      moneyString(quotedBlockNumber) !== null &&
      typeof quotedBlockHash === 'string' &&
      EVM_BLOCK_HASH.test(quotedBlockHash) &&
      !/^0x0{64}$/i.test(quotedBlockHash);
    const quoteClockValid =
      typeof quotedAtMs === 'number' &&
      Number.isSafeInteger(quotedAtMs) &&
      quotedAtMs > 0 &&
      quotedAtMs <= nowMs + 30_000 &&
      typeof expiresAtMs === 'number' &&
      Number.isSafeInteger(expiresAtMs) &&
      expiresAtMs > nowMs &&
      expiresAtMs > quotedAtMs &&
      expiresAtMs - quotedAtMs <= 3_000;
    // Shape-checked, not cast: a malformed figure rendered as a binding
    // minimum is exactly the confident-wrong-number this directory exists to
    // prevent.
    if (
      (chain === 'bsc' || chain === 'robinhood_chain') &&
      typeof token === 'string' && EVM_ADDRESS.test(token) &&
      (side === 'buy' || side === 'sell') &&
      typeof walletAccountId === 'string' &&
      UUID.test(walletAccountId) &&
      typeof slippageBps === 'number' &&
      Number.isInteger(slippageBps) &&
      slippageBps >= 1 &&
      slippageBps <= 10_000 &&
      body['quote_version'] === 1 &&
      (expected === undefined || (
        chain === expected.chain &&
        token.toLowerCase() === expected.token.toLowerCase() &&
        side === expected.side &&
        walletAccountId === expected.walletAccountId &&
        slippageBps === expected.slippageBps &&
        amountIn === requestedAmount
      )) &&
      expectedOut !== null &&
      minAmountOut !== null &&
      BigInt(minAmountOut) <= BigInt(expectedOut) &&
      amountIn !== null &&
      inputAsset !== null &&
      outputAsset !== null &&
      approval !== null &&
      assetsMatch &&
      feeValid &&
      typeof venue === 'string' &&
      venue.length > 0 &&
      typeof routeMode === 'string' &&
      routeMode.length > 0 &&
      blockIdentityValid &&
      quoteClockValid
    ) {
      return {
        kind: 'quoted',
        quoteVersion: 1,
        chain,
        token: token.toLowerCase(),
        side,
        walletAccountId,
        slippageBps,
        expectedOut,
        minAmountOut,
        venue,
        routeMode,
        amountIn,
        inputAsset,
        outputAsset,
        approval,
        platformFeeAsset,
        platformFeeBaseUnits,
        platformFeeWei,
        quotedBlockNumber: quotedBlockNumber as string,
        quotedBlockHash: (quotedBlockHash as string).toLowerCase(),
        quotedAtMs: quotedAtMs as number,
        expiresAtMs: expiresAtMs as number,
      };
    }
    return { kind: 'error', reason: 'shape_mismatch' };
  }
  return { kind: 'error', reason: `http_${httpStatus}` };
}

export interface FetchEvmServedQuoteInput {
  /** Storage tag — `bsc` | `robinhood_chain`. */
  readonly chain: string;
  /** Lowercase 0x token address. */
  readonly token: string;
  /** The owned wallet whose address the gateway resolves for this quote. */
  readonly walletAccountId: string;
  readonly side: EvmOrderSide;
  /**
   * Integer base units — wei on a buy, token base units on a sell. A bigint
   * so a float can never reach the query string.
   */
  readonly amountBaseUnits: bigint;
  /** `null` for a native quote, otherwise the exact lowercase ERC-20 quote. */
  readonly quoteAssetAddress: string | null;
  /** Forwarded so `min_amount_out` is the same floor the order binds. */
  readonly slippageBps: number;
  readonly signal?: AbortSignal;
}

/** Exact authenticated route for a wallet-bound served quote. */
export function evmServedQuotePath(input: FetchEvmServedQuoteInput): string {
  const query = new URLSearchParams({
    chain: input.chain,
    token: input.token,
    side: input.side,
    slippage_bps: String(input.slippageBps),
    wallet_account_id: input.walletAccountId,
  });
  if (input.side === 'sell') {
    query.set('tokens_in', input.amountBaseUnits.toString());
  } else if (input.quoteAssetAddress === null) {
    query.set('native_in_wei', input.amountBaseUnits.toString());
  } else {
    query.set('quote_in', input.amountBaseUnits.toString());
    query.set('quote_asset', input.quoteAssetAddress.toLowerCase());
  }
  return `/api/v1/evm/trade/quote?${query}`;
}

export async function fetchEvmServedQuote(
  input: FetchEvmServedQuoteInput,
): Promise<EvmServedQuoteResult> {
  try {
    const response = await fetchAuthenticatedApi(
      evmServedQuotePath(input),
      { method: 'GET' },
      { signal: input.signal },
    );
    const body = record(await response.json().catch(() => null));
    return parseEvmServedQuoteResponse(body, response.status, input);
  } catch (error) {
    if (input.signal?.aborted) return { kind: 'error', reason: 'aborted' };
    return {
      kind: 'unavailable',
      detail: (error as Error)?.message || 'network_error',
    };
  }
}

/**
 * Honest UI copy for an engine refusal.
 *
 * The KNOWN vocabulary is named because each entry is a different instruction
 * to the reader — wait, leave, or "this market cannot be quoted here". An
 * unrecognised string is shown VERBATIM inside a sentence rather than
 * flattened into a generic error: the engine's refusal vocabulary is
 * load-bearing product state, and hiding a new word behind "something went
 * wrong" is how a support ticket loses its only lead.
 */
export function evmQuoteRefusalText(refused: string, reason: string | null): string {
  const detail = reason !== null && reason.length > 0 && reason !== refused ? ` (${reason})` : '';
  switch (refused) {
    case 'order.chainNotConfigured':
      return 'The trading engine is not configured for this chain, so no served quote exists.';
    case 'residentQuote.notWarm':
      return 'The engine has not warmed this market yet. The served quote appears once it is warm; the instant estimate below is all there is until then.';
    case 'v3Quote.noPool':
      return 'The engine found no pool for this market, so it cannot serve a quote.';
    case 'quote_not_native':
      return 'The engine does not support this quote asset on the selected execution route.';
    case 'migrating':
      return 'Liquidity is migrating to the AMM; the engine will not quote until the pool is live.';
    default:
      return refused.length > 0
        ? `The trading engine declined to quote this order: “${refused}”${detail}.`
        : 'The trading engine declined to quote this order.';
  }
}

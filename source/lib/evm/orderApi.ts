'use client';

/**
 * EVM order submit client — `POST /api/v1/trade/orders` with `chain` set to
 * an EVM storage tag.
 *
 * ONE ROUTE, NOT TWO. The api's order schema has carried an optional `chain`
 * enum since WP-103 (`api/src/routes/trade/orders.ts`, `ORDER_INTENT_REQUEST`)
 * and the backend `the backend service` already forks per chain; the EVM order is the
 * same intent with a different chain tag, so it goes down the same pipe. A
 * second public route would duplicate the session gate, the idempotency
 * contract and the reauth envelope — three places for a money-path bug to
 * differ.
 *
 * WIRE RULES, all of them load-bearing and all of them READ OFF THE SERVER
 * that parses them (an internal backend type),
 * not invented here:
 * - **The buy field is `native_in_wei`, not `native_in`.** The gateway
 *   already defines it (the backend source), refuses a JSON NUMBER by type
 *   before it even pattern-matches — because a number is an f64 on the way
 *   through and corrupts 2^53-adjacent wei silently — and bounds it at 39
 *   digits, the u128 domain. This module honours all three.
 * - **`native_in_wei` and `tokens_in` are DECIMAL STRINGS of integer base
 *   units.** 1 BNB is 10^18 wei, which is past `Number.MAX_SAFE_INTEGER`
 *   before you reach a hundredth of a coin. Nothing in this module accepts a
 *   `number` for an amount, and `JSON.stringify` therefore cannot emit one.
 * - **`mint` carries the 0x token address.** The api's field is named for
 *   Solana; the value is chain-scoped by `chain`, exactly as `the backend service`
 *   reads it (the backend source takes `token`).
 * - **`client_order_id` is both the correlation key and the EVM replay
 *   guard.** The EVM gateway path owns an awaited, durable reserve keyed by
 *   `(user, client_order_id, chain)` and refuses a conflict before dispatch.
 *   The EVM engine still has no independent duplicate store, so that gateway
 *   gate is load-bearing and fails closed when its database verdict is
 *   unavailable.
 *
 *   The id is held stable across the retries this module performs, and every
 *   retry re-POSTs the IDENTICAL body. A network error or timeout is still
 *   NEVER retried here: status reconciliation is more informative than a
 *   duplicate POST, and a fresh user click could mint a different id while
 *   the original transaction is live.
 *
 * The result union has no "probably fine" state. A timeout is
 * `indeterminate`, not a failure — the panel must say the order may still be
 * live rather than inviting the user to press Buy again.
 */

import { fetchAuthenticatedApi } from '@/lib/api/trading';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { mintFreshOrderToken } from '@/lib/api/orders';

/** Hard ceiling on the POST round trip, mirroring the Solana submit path. */
/**
 * The gateway's EVM engine hop is 45s because approval-required sells can
 * synchronously sign and confirm two transactions. The browser must be the
 * outermost deadline, never the first hop to abandon an order that can still
 * complete successfully.
 */
export const EVM_ORDER_TIMEOUT_MS = 65_000;

export type EvmOrderSide = 'buy' | 'sell';

export interface EvmOrderRequest {
  /** Idempotency key. Stable across the reauth retry, never regenerated. */
  readonly client_order_id: string;
  /** Storage tag — `bsc` | `robinhood_chain`. Never a URL slug. */
  readonly chain: string;
  readonly side: EvmOrderSide;
  /** Lowercase 0x token address. */
  readonly mint: string;
  /** `wallets.wallet_accounts.id` of the EVM wallet to trade from. */
  readonly wallet_account_id: string;
  /**
   * Buy sizing: native spend in WEI, decimal string, at most 39 digits.
   * The name and the bound are the gateway's (the backend source).
   */
  readonly native_in_wei?: string;
  /** Token-quoted buy sizing, in the exact `quote_asset` base units. */
  readonly quote_in?: string;
  /** Lowercase ERC-20 quote asset. Present exactly with `quote_in`. */
  readonly quote_asset?: string;
  /** Sell sizing: token amount in ERC-20 base units, decimal string. */
  readonly tokens_in?: string;
  readonly slippage_bps: number;
  /** Browser clock at the button press, for the engine's latency trace. */
  readonly client_ts?: number;
}

/**
 * The u128 wei domain, as the gateway enforces it
 * (`matches_positive_digits(raw, 39)`).
 *
 * Checked HERE so an over-domain amount is a local, explained refusal rather
 * than a round trip that comes back as a generic `intake_body_invalid`.
 */
export const MAX_WEI_DIGITS = 39;
/** `tokens_in` is `^[0-9]{1,40}$` on the gateway. Same reasoning. */
export const MAX_TOKEN_DIGITS = 40;
const U128_MAX = 340282366920938463463374607431768211455n;

/** Does this decimal string fit the wire field it is destined for? */
export function fitsWireAmount(decimal: string, side: EvmOrderSide): boolean {
  const limit = side === 'buy' ? MAX_WEI_DIGITS : MAX_TOKEN_DIGITS;
  return /^[1-9][0-9]*$/.test(decimal)
    && decimal.length <= limit
    && BigInt(decimal) <= U128_MAX;
}

/**
 * Build the request body from the panel's state.
 *
 * Pure and exported so the MONEY-PATH COMPOSITION is unit-tested rather than
 * only reachable through a React render — the terminal has no DOM test rig,
 * and "which field carries the amount" is exactly the thing that must not be
 * verified by eye.
 */
export function buildEvmOrderBody(input: {
  clientOrderId: string;
  chain: string;
  side: EvmOrderSide;
  /** Lowercase 0x token address. */
  token: string;
  walletAccountId: string;
  /** Integer base units. A bigint, so a float can never reach the wire. */
  baseUnits: bigint;
  /** `null` for native buys; exact ERC-20 address for token-quoted buys. */
  quoteAssetAddress?: string | null;
  slippageBps: number;
  clientTsMs?: number;
}): EvmOrderRequest {
  const amount = input.baseUnits.toString();
  return {
    client_order_id: input.clientOrderId,
    chain: input.chain,
    side: input.side,
    mint: input.token,
    wallet_account_id: input.walletAccountId,
    ...(input.side === 'buy'
      ? input.quoteAssetAddress == null
        ? { native_in_wei: amount }
        : { quote_in: amount, quote_asset: input.quoteAssetAddress.toLowerCase() }
      : { tokens_in: amount }),
    slippage_bps: input.slippageBps,
    ...(input.clientTsMs === undefined ? {} : { client_ts: input.clientTsMs }),
  };
}

/**
 * Everything that makes a request a DIFFERENT order.
 *
 * A held `client_order_id` may be re-sent only for a byte-identical retry.
 * Re-using one across a changed order (the user edits the amount after a
 * timeout, or navigates to another token — the trade page reuses the
 * component instance, so a ref outlives the form reset) mislabels the second
 * order as a replay of the first in every ledger keyed on
 * `(user, client_order_id)`; the api's row is `ON CONFLICT DO NOTHING`, so
 * the first order's wallet and timing silently stand for both.
 *
 * Derived from the built body rather than from the panel's state, so a field
 * added to the wire cannot be forgotten here.
 */
export function evmOrderFingerprint(body: EvmOrderRequest): string {
  return [
    body.chain,
    body.side,
    body.mint,
    body.wallet_account_id,
    body.native_in_wei ?? '',
    body.quote_in ?? '',
    body.quote_asset ?? '',
    body.tokens_in ?? '',
    String(body.slippage_bps),
  ].join('|');
}

export interface EvmOrderAck {
  readonly clientOrderId: string;
  readonly orderSeq: string | null;
  readonly tsMs: number | null;
  readonly state: string;
  /**
   * The trade's transaction hash. **Present once a mined receipt is observed.**
   *
   * An EVM order confirms SYNCHRONOUSLY — `the backend service`'s own words at
   * the backend source: "an EVM order confirms synchronously, so a client
   * that never sees a hash has no way to look up a trade that definitely
   * happened." That synchronous confirmation is receipt inclusion, not
   * canonical finality: the server's durable fill appears only after the
   * finality observer promotes it. The terminal therefore keeps polling this
   * correlation id. `null` means the gateway omitted the hash; it is never
   * fabricated.
   */
  readonly txHash: string | null;
  /** Block the fill landed in, or `null` when not reported. */
  readonly blockNumber: number | null;
  /** The platform fee leg's own hash, when the fee rode a separate tx. */
  readonly feeTxHash: string | null;
  /** Decimal STRING of wei. Never parsed to a number — see the header. */
  readonly platformFeeWei: string | null;
}

export type EvmOrderResult =
  /** A mined receipt was observed; canonical finality is still polled. */
  | { kind: 'accepted'; ack: EvmOrderAck }
  /** Session is not usable. The panel must send the user through reauth. */
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  /** A typed refusal with a machine code — rendered verbatim, never guessed. */
  | { kind: 'refused'; status: number; errorCode: string; message: string }
  /**
   * **HTTP 202 `evm_order_indeterminate` — the transaction MAY BE ON CHAIN.**
   *
   * This is a SERVER ASSERTION, not our own loss of the answer, and that is
   * why it is its own variant rather than folded into `indeterminate`. The
   * engine got far enough that a broadcast may have happened and cannot prove
   * otherwise; the backend source gives it the only 202 in
   * the whole gateway taxonomy precisely so neither obvious mapping can be
   * taken: "rendering it as a failure invites the user to place a FRESH order
   * on top of a trade that may already be live, and rendering it as a success
   * reports a fill that may not exist."
   *
   * Callers MUST render this as pending-unconfirmed and MUST NOT offer a
   * retry. `isEvmRefusalRetryable` cannot see it (it is not a `refused`), and
   * no code path in this module re-sends on it.
   */
  | { kind: 'may_be_live'; reason: string }
  /**
   * The request did not complete. **It may or may not have executed.** This
   * is deliberately not merged with `refused`: a refusal is a proof that
   * nothing happened, and a timeout is the absence of that proof.
   */
  | { kind: 'indeterminate'; reason: string };

export interface SubmitEvmOrderOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
  /** Injected by tests. Production uses the authenticated fetch wrapper. */
  readonly postImpl?: (
    body: EvmOrderRequest,
    authToken: string | null | undefined,
    signal: AbortSignal,
  ) => Promise<Response>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reauthReason(raw: unknown): 'no_session' | 'session_expired' | 'session_invalid' {
  return raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
    ? raw
    : 'session_invalid';
}

/**
 * The 202's machine code, as the backend source emits it.
 *
 * Matched on the CODE as well as the status, because either alone is a weaker
 * test than the pair: a proxy that rewrites a 202 to 200 must still be caught,
 * and a future 202 on some other route must not be read as "your money may be
 * in flight".
 */
export const EVM_MAY_BE_LIVE_CODE = 'evm_order_indeterminate';

/**
 * Is this response the 202 "transaction may be on chain" answer?
 *
 * Exported so the money-safety contract is unit-tested directly rather than
 * only through the union it produces.
 */
export function isMayBeLiveResponse(
  status: number,
  body: Record<string, unknown>,
): boolean {
  return status === 202 || body['error_code'] === EVM_MAY_BE_LIVE_CODE;
}

/** A 0x-prefixed 32-byte transaction hash, or `null`. Never a partial string. */
function parseTxHash(raw: unknown): string | null {
  return typeof raw === 'string' && /^0x[0-9a-fA-F]{64}$/.test(raw) ? raw : null;
}

function parseAck(body: Record<string, unknown>, fallbackId: string): EvmOrderAck | null {
  const order = body['order'];
  if (!isObject(order)) return null;
  const state = order['state'];
  if (typeof state !== 'string') return null;
  const seq = order['order_seq'];
  const tsMs = order['ts_ms'];
  const clientOrderId = order['client_order_id'];
  if (clientOrderId !== fallbackId) return null;
  const blockNumber = order['block_number'];
  const platformFeeWei = order['platform_fee_wei'];
  return {
    clientOrderId,
    // ABSENT stays null. A `0` sequence would correlate to a real order.
    orderSeq: typeof seq === 'string' ? seq : null,
    tsMs: typeof tsMs === 'number' && Number.isFinite(tsMs) ? tsMs : null,
    state,
    // Shape-checked, not merely typed: a truncated or malformed hash rendered
    // as an explorer link sends the user to a page about someone else's
    // transaction, or to a 404 that reads as "my trade did not happen".
    txHash: parseTxHash(order['tx_hash']),
    blockNumber:
      typeof blockNumber === 'number' && Number.isInteger(blockNumber) && blockNumber >= 0
        ? blockNumber
        : null,
    feeTxHash: parseTxHash(order['fee_tx_hash']),
    // Stays a STRING. Wei at 18 decimals is past 2^53 for any fee worth
    // showing, so parsing it here would be the precision bug this whole
    // directory exists to prevent.
    platformFeeWei:
      typeof platformFeeWei === 'string' && /^[0-9]+$/.test(platformFeeWei)
        ? platformFeeWei
        : null,
  };
}

async function postOnce(
  body: EvmOrderRequest,
  options: SubmitEvmOrderOptions,
): Promise<EvmOrderResult> {
  const timeout = AbortSignal.timeout(EVM_ORDER_TIMEOUT_MS);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

  let response: Response;
  try {
    response =
      options.postImpl === undefined
        ? await fetchAuthenticatedApi(
            '/api/v1/trade/orders',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
            { authToken: options.authToken, signal },
          )
        : await options.postImpl(body, options.authToken, signal);
  } catch (error) {
    // The POST never completed. It is NOT known to have failed — the api may
    // have dispatched before the socket died. Say exactly that.
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? 'The order request timed out.'
      : (error as Error)?.message ?? 'network error';
    return { kind: 'indeterminate', reason };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const body_ = isObject(parsed) ? parsed : {};

  if (body_['reauth_required'] === true) {
    return { kind: 'reauth', reason: reauthReason(body_['reason']) };
  }

  // ── 202: THE TRANSACTION MAY ALREADY BE ON CHAIN ──────────────────────
  //
  // Checked BEFORE the `response.ok` branch, because 202 IS ok. Without this
  // arm a 202 fell through to "the server accepted the request but its answer
  // was not recognisable" — which is safe by accident (that lands in
  // `indeterminate`, which offers no retry) but tells the user a PROTOCOL
  // story about a MONEY event. The user needs to know their trade may be
  // live, not that we could not parse something.
  //
  // The gateway's own `message` is deliberately NOT relayed to the user here.
  // Although its awaited reserve makes the SAME id replay-safe, the browser's
  // recovery action is an authoritative status read, not another POST. We
  // carry the engine's `refused` string as diagnosis and write copy that does
  // not invite a fresh click with a newly-minted id.
  if (isMayBeLiveResponse(response.status, body_)) {
    const refused = body_['refused'];
    return {
      kind: 'may_be_live',
      reason:
        typeof refused === 'string' && refused.length > 0
          ? refused
          : 'the order service could not confirm whether the transaction was broadcast',
    };
  }

  if (response.ok && body_['reauth_required'] === false) {
    const ack = parseAck(body_, body.client_order_id);
    if (ack === null) {
      // A 200 whose shape we do not recognise is NOT an acceptance. Treating
      // it as one puts a fabricated "order placed" in front of a user.
      return {
        kind: 'indeterminate',
        reason: 'The server accepted the request but its answer was not recognisable.',
      };
    }
    return { kind: 'accepted', ack };
  }
  if (response.ok) {
    return {
      kind: 'indeterminate',
      reason: 'The server answered 200 with no order envelope.',
    };
  }
  const errorCode = body_['error_code'];
  const message = body_['message'];
  return {
    kind: 'refused',
    status: response.status,
    errorCode: typeof errorCode === 'string' ? errorCode : 'unknown_error',
    message: typeof message === 'string' ? message : `Request failed (HTTP ${response.status}).`,
  };
}

/**
 * Submit one EVM order.
 *
 * Retries EXACTLY ONCE, and only on `reauth`, with the identical body. See
 * the module header for why nothing else is retryable.
 */
export async function submitEvmOrder(
  body: EvmOrderRequest,
  options: SubmitEvmOrderOptions = {},
): Promise<EvmOrderResult> {
  const first = await postOnce(body, options);
  if (first.kind !== 'reauth') return first;
  if (typeof options.authToken !== 'string' || getClerkSession().isSignedIn !== true) {
    return first;
  }
  const fresh = await mintFreshOrderToken();
  if (fresh === null) return first;
  return postOnce(body, { ...options, authToken: fresh });
}

/**
 * Human text for a refusal code.
 *
 * Codes the EVM path can actually produce are named; anything else falls
 * back to the server's own message rather than to a cheerful generic — an
 * unrecognised refusal is exactly the case where inventing wording is worst.
 */
export function evmRefusalText(result: Extract<EvmOrderResult, { kind: 'refused' }>): string {
  switch (result.errorCode) {
    case 'chain_not_supported_yet':
      return 'This chain is not accepting orders on this deployment yet.';
    case 'intake_body_invalid':
      // The api's sizing-shape refusal (`validateEvmIntentShape`): a buy must
      // size with `native_in_wei`, a sell with `tokens_in`, exactly one of
      // the two, decimal strings only. Both sides of the wire are live —
      // reaching this code means the CLIENT built a wrong body, which
      // `buildEvmOrderBody`'s own tests exist to prevent.
      return 'The order service did not accept this order shape.';
    case 'evm_wallet_not_provisioned':
      return 'You do not have a wallet on this chain yet. Create one from the Wallets tab.';
    case 'context_cold':
      return 'Your trading session is still warming up. Try again in a moment.';
    case 'global_trading_disabled':
      return 'Trading is disabled platform-wide right now.';
    case 'trade_intake_disabled':
      return 'Order intake is disabled right now.';
    case 'wallet_not_owned_by_user':
      return 'That wallet is not on this account.';
    case 'wallet_disabled':
    case 'wallet_account_disabled':
      return 'That wallet is disabled.';
    case 'wallet_archived':
      return 'That wallet is archived. Pick another wallet to trade from.';
    case 'insufficient_balance':
      return 'Not enough balance in this wallet for that amount plus gas.';

    // ── Codes only the EVM gateway emits (the backend source) ────
    // These previously fell through to `result.message`, which is written for
    // an OPERATOR ("EVM engine refused the order") and tells a trader nothing
    // about what to do. The engine's own `refused`/`reason` string still
    // rides in `result.message` and is shown as the detail line by the panel.
    case 'evm_order_refused':
      // 403 — the verifier declined. This is the SAFE outcome: a refusal is
      // proof that nothing was signed and nothing was sent.
      return 'The trading engine refused this order after checking it. Nothing was sent and nothing was spent.';
    case 'evm_intent_invalid':
      // 400 — the engine rejected the intent shape. A client-side bug, but
      // still nothing sent.
      return 'The trading engine rejected this order’s shape. Nothing was sent.';
    case 'evm_engine_auth_rejected':
      // 502 — OUR bug (the gateway could not authenticate to the engine).
      // The engine rejected the STAMP, which it does before doing any work,
      // so this one really is proof that nothing happened.
      return 'The order could not be placed because of a problem on our side, not with your order. Nothing was sent — please try again shortly.';
    case 'evm_engine_unavailable':
    case 'trading_engine_unavailable':
      // DELIBERATELY NOT "nothing was sent". See `isEvmRefusalPossiblyLive`:
      // this code bundles an engine TIMEOUT, and a timeout is the absence of
      // proof rather than proof of absence. The panel routes it to the
      // may-be-live surface; this string is only its detail line.
      return 'The trading engine did not answer in time, so the outcome of this order is unknown.';
    case 'evm_idempotency_unavailable':
      // 503, fail-closed BEFORE dispatch (the backend source): the gateway
      // could not tell a first attempt from a replay, so it declined rather
      // than risk two nonces. Nothing was sent.
      return 'We could not safely confirm this was a first attempt, so the order was not placed. Nothing was sent — you can retry.';
    case 'evm_order_row_unavailable':
      // 503, written AFTER the reserve and BEFORE dispatch
      // (the backend source): refused rather than executed unpersistably,
      // because a trade nobody can account for is worse than a refused one.
      return 'The order could not be recorded, so it was refused rather than sent untracked. Nothing was sent — you can retry.';
    default:
      return result.message;
  }
}

/**
 * **Could this "refusal" be hiding a transaction that is already on chain?**
 *
 * The 202 is not the only answer that can. Two of the gateway's 502s bundle a
 * TIMEOUT, and a timeout on a hop that may already have signed and broadcast
 * is the absence of proof, not proof of absence:
 *
 *  - `evm_engine_unavailable` — the gateway→engine hop.
 *    an internal routine maps **every** transport failure to
 *    an internal routine, and `post_stamped` produces
 *    `"http_timeout"` for a timed-out send exactly as it produces
 *    `"connect_error"` for a refused connection
 *    (the backend source). A connect error is provably
 *    safe; a timeout is not. **The gateway does not serialize which one it
 *    was** (the backend source: `reason: _operator` is dropped from the wire body),
 *    so the terminal cannot distinguish them and must assume the unsafe one.
 *  - `trading_engine_unavailable` — the api→gateway hop
 *    (`api/src/trade/errors.ts:202`). Same reasoning, one hop earlier: the
 *    gateway may have dispatched before the api's socket timed out. This one
 *    DOES carry its `reason`, but the safe classification does not depend on
 *    reading it.
 *
 * Fail-safe direction: mis-classifying a genuinely-dead order as "may be
 * live" costs the user one manual check of their balance. Mis-classifying a
 * live order as dead costs them a second trade they did not want. So this
 * errs toward may-be-live, and the panel renders these with the SAME
 * no-retry affordance as the explicit 202.
 */
const EVM_DEFINITIVELY_UNSENT_CODES = new Set([
  'chain_not_supported_yet',
  'intake_body_invalid',
  'evm_wallet_not_provisioned',
  'context_cold',
  'quote_cold',
  'global_trading_disabled',
  'trade_intake_disabled',
  'wallet_not_owned_by_user',
  'wallet_disabled',
  'wallet_account_disabled',
  'wallet_archived',
  'insufficient_balance',
  'evm_order_refused',
  'evm_intent_invalid',
  'evm_engine_auth_rejected',
  'evm_idempotency_unavailable',
  'evm_order_row_unavailable',
]);

export function isEvmRefusalPossiblyLive(
  result: Extract<EvmOrderResult, { kind: 'refused' }>,
): boolean {
  return (
    result.errorCode === 'evm_engine_unavailable' ||
    result.errorCode === 'trading_engine_unavailable' ||
    result.errorCode === EVM_MAY_BE_LIVE_CODE ||
    (result.status >= 500 && !EVM_DEFINITIVELY_UNSENT_CODES.has(result.errorCode))
  );
}

/**
 * A refusal that is safe to retry with the SAME `client_order_id`.
 *
 * The bar is not "it looks transient" — it is **the server proved nothing was
 * dispatched.** Anything we do not recognise is not retryable, because the
 * cost of being wrong is a double fill, and `may_be_live` and `indeterminate`
 * are not `refused` at all so they can never reach this function.
 *
 * Each entry below is admitted on a citation, not on a guess:
 *  - `context_cold` / `quote_cold` — the api answers these strictly before
 *    intake, so no intent was ever built.
 *  - `evm_idempotency_unavailable` — the gateway's reserve is FAIL-CLOSED and
 *    runs before dispatch (the backend source). It declined
 *    precisely so it would not risk two nonces; nothing was sent.
 *  - `evm_order_row_unavailable` — written after the reserve and before
 *    dispatch (the backend source), which states in
 *    terms that "nothing has been sent yet" and that a retry "either
 *    re-writes the missing order row or conflicts — never dispatches twice."
 *
 * Deliberately NOT here: `evm_engine_unavailable`. A 502 covers a TIMEOUT of
 * the engine call, and a timeout is the absence of proof, not proof of
 * absence — the engine may have signed and broadcast before the socket died.
 * It is surfaced to the user as "nothing was sent" only where the gateway
 * itself distinguishes that case; it is never AUTO-retried here.
 */
export function isEvmRefusalRetryable(
  result: Extract<EvmOrderResult, { kind: 'refused' }>,
): boolean {
  return (
    result.errorCode === 'context_cold' ||
    result.errorCode === 'quote_cold' ||
    result.errorCode === 'evm_idempotency_unavailable' ||
    result.errorCode === 'evm_order_row_unavailable'
  );
}

'use client';

import { getClerkSession } from '@/lib/state/clerk-session-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import {
  applyOrderFetchStamps,
  beginOrderTiming,
  finalizeOrderTimingFailure,
  stampAckParsed,
  stampFetchStart,
  stampFirstByte,
  tradeTimingNow,
  type OrderFetchStamps,
  type TradePressTiming,
} from '@/lib/telemetry/tradeTiming';
import type { ProvisioningState } from './me';
import { fetchAuthenticatedApi } from './trading';
import { fetchTradeFills } from './trade-fills';

// T5 client wrapper for `POST /api/v1/trade/orders`. Sends snake_case
// fields, expects the gated reauth / success / error shapes documented
// in `api/src/routes/trade/orders.ts`.
//
// The client itself does not invalidate `useMe()` on reauth — the
// caller (`useTradeStream.submit`) is responsible for that so the
// abstraction is reusable.

export interface OrderIntentRequest {
  client_order_id: string;
  side: 'buy' | 'sell';
  mint: string;
  amount_lamports?: string;
  /**
   * USDC pair support: buy size in integer micro-USDC (6dp). Mutually
   * exclusive with `amount_lamports` — exactly one amount field per
   * buy. Sells are unchanged (tokens_in / sell_percent_bps).
   */
  amount_usdc_micro?: string | number;
  /**
   * Optional spend-currency marker; when present it must agree with
   * the amount field (`'usdc'` ↔ `amount_usdc_micro`). Omitted on
   * legacy SOL buys so their request bodies stay byte-identical.
   */
  spend_currency?: 'sol' | 'usdc';
  tokens_in?: string;
  sell_percent_bps?: number;
  sell_token_balance_hint?: string;
  slippage_bps: number;
  send_mode?: 'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  route_override?: 'auto' | 'bc_zeroslot' | 'amm_zeroslot';
  /** Monotonic Discover/DB marker; when true trading must not route BC. */
  graduated?: boolean;
  background_ack?: boolean;
  origin?: 'manual_ui' | 'automated_trigger' | 'replay';
  /**
   * Latency-tracing: `Date.now()` captured at the Buy/Sell button press.
   * Forwarded by the api/ to the trading engine as the trace `clickedAtMs`
   * head stamp so end-to-end latency can be measured from the click.
   * Optional; older clients simply omit it (engine treats as missing).
   */
  client_ts?: number;
  /**
   * Slice "Terminal wallet selector": explicit wallet to trade from.
   * When omitted, the api/ resolves the user's primary wallet for
   * back-compat with pre-selector clients. UUID format; the api/
   * Ajv schema enforces the same pattern server-side.
   */
  wallet_account_id?: string;
  /**
   * Slice "Trading Settings Presets": active preset's fee overrides
   * for THIS trade. Both fields are integer lamports in [0, 1e10].
   *
   * `priority_lamports` is the TOTAL priority-fee budget for the
   * transaction. The trading engine derives the per-CU microlamports
   * price at compose time using each route's own compute-unit limit
   * (BC 250k, AMM 350k by default): `cuPrice = floor(p × 1e6 / cuLimit)`.
   *
   * `bribe_lamports` is the lamport amount paid to the Jito/0slot/
   * Nozomi tip account as a `SystemProgram.transfer` ix. Ignored
   * when `send_mode = 'rpc'` (plain RPC carries no relay tip);
   * `'auto'` CAN resolve to a tipped mode, in which case the tip
   * applies to whatever path the engine picks.
   *
   * Both are OPTIONAL: when absent, the engine falls back to its
   * compiled-in compute-budget defaults and the env-driven tip.
   */
  priority_lamports?: number;
  bribe_lamports?: number;
}

export type OrderSubmitResult =
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | {
      kind: 'ok';
      order: {
        client_order_id: string;
        order_seq: string | null;
        ts_ms: number | null;
        state: string;
      };
      context: { authorization_id: string; policy_version: string };
    }
  | {
      kind: 'error';
      status: number;
      errorCode: string;
      message: string;
      extras: Record<string, unknown>;
    }
  | { kind: 'network_error'; reason: string };

export interface SubmitOrderOptions {
  signal?: AbortSignal;
  authToken?: string | null;
  /**
   * E2E latency waterfall: per-surface press stamps (performance.now()
   * clock). When present, `submitOrder` tracks the full
   * press→POST→ack→SSE→paint timeline for this clientOrderId and emits
   * one fire-and-forget beacon after the terminal SSE event (see
   * lib/telemetry/tradeTiming.ts). Purely observational — never awaited,
   * never alters the submit path.
   */
  timing?: TradePressTiming;
}

/** Hard ceiling on the order POST round trip. Without it, a stalled or
 *  connection-starved request leaves the toast on "Sending…" forever; an
 *  abort maps to the existing `network_error` branch, which the toast
 *  surfaces as a retryable failure. Generous vs the p99 intake ack. */
const ORDER_SUBMIT_TIMEOUT_MS = 10_000;

function orderSubmitSignal(callerSignal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(ORDER_SUBMIT_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

// ─────────────────────────────────────────────────────────────────────
// One-shot reauth retry, centralised here so every submit surface
// (TradePanel, InstantTradeBox, quickbuy, sell-all) inherits it.
//
// After an idle return the Clerk mirror can hold an EXPIRED JWT (no exp
// check on the synchronous fast path); the api then answers
// `reauth_required` even though the user is still signed in. When that
// happens we mint one fresh token and re-POST the identical body once.
//
// SAFETY: retry ONLY on `reauth` — the api returns `reauth_required`
// strictly BEFORE order intake/dispatch (api/src/routes/trade/
// orders.ts:241-247, batch-orders.ts ~490), so the rejected attempt
// provably executed nothing and the re-POST cannot double-fill. NEVER
// extend this to network errors or timeouts: the server's idempotency
// reservation on client_order_id is non-blocking bookkeeping
// (api/src/trade/execute-order-intent.ts:484-491), so a duplicate POST
// of an order that may already have dispatched WOULD double-execute.
// ─────────────────────────────────────────────────────────────────────

/** Bound on the retry's token mint, mirroring ORDER_TOKEN_WAIT_MS in
 *  lib/auth/orderAuthToken.ts — a genuinely revoked session fails fast. */
const REAUTH_RETRY_TOKEN_WAIT_MS = 1_000;

interface ClerkGlobal {
  Clerk?: {
    session?: {
      getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
    } | null;
  };
}

/**
 * Fresh-token mint for the reauth retry: `getToken({ skipCache: true })`
 * on the global clerk-js session, raced against a short timeout (same
 * pattern as `resolveOrderAuthToken`, which we can't reuse here — its
 * fast path would hand back the mirrored token that was just rejected).
 * Preferred over awaiting `forceClerkMirrorRefresh()`, which returns
 * void and early-returns while a wake-mint is already in flight.
 * Exported for the advanced-orders client, which inherits the same
 * one-shot reauth retry (creation reauths strictly before intake).
 */
export async function mintFreshOrderToken(): Promise<string | null> {
  const session = (globalThis as ClerkGlobal).Clerk?.session;
  if (!session) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      session.getToken({ skipCache: true }).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REAUTH_RETRY_TOKEN_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Retry only when the reauth'd request DID carry a bearer (a token-less
 *  POST reauths for a different reason) and the mirror still says
 *  signed-in (a real sign-out must surface the reauth path unchanged).
 *  Exported for the advanced-orders client (same retry contract). */
export function shouldRetryReauth(options: SubmitOrderOptions): boolean {
  return typeof options.authToken === 'string' && getClerkSession().isSignedIn === true;
}

// ─────────────────────────────────────────────────────────────────────
// Two-attempt cold retry ladder (`context_cold` / `quote_cold`).
//
// The api's resident-memory-only order path answers 503 `context_cold`
// (with a `retry_after_ms` hint) when a required cache isn't resident,
// having ALREADY fired the warm in the background. Like the reauth
// retry, the rejection is strictly pre-dispatch (the api rejects before
// its idempotency reserve and engine dispatch), so re-POSTing the
// IDENTICAL body — same client_order_id, same client_ts — cannot
// double-fill. TWO retries max: the first after the server hint (or
// the code's default), and — only if that also lands cold — one final
// backstop retry after ~900ms (a brand-new pump.fun launch's warm can
// need an ingestion timeout + RPC curve read, >700ms; the old one-shot
// retry failed the user's first click on exactly that flow). A third
// cold response surfaces as a normal error toast — never a retry loop.
//
// `quote_cold` is the engine-side sibling: the trading engine rejects a
// never-seen/stale-quote mint fast while warming its quote cache in the
// background, and the api maps that reject to 503 `quote_cold` (see
// api/src/trade/errors.ts for the wire contract). The engine reject is
// strictly pre-side-effect (no idempotency consumption, no sign, no
// send), so the identical re-POSTs are equally replay-safe. Its
// fallback delay is longer — the quote warm needs an ingestion fetch
// (~100-300ms), not just an in-process cache fill.
// ─────────────────────────────────────────────────────────────────────

const CONTEXT_COLD_DEFAULT_RETRY_MS = 200;
const QUOTE_COLD_DEFAULT_RETRY_MS = 350;
const COLD_MAX_RETRY_MS = 1_000;
/** Fixed wait before the second (final) cold retry — worst-case added
 *  client wait stays ~1.3s before the error surfaces as today. */
const COLD_SECOND_RETRY_MS = 900;

function coldRetryDelayMs(extras: Record<string, unknown>, defaultMs: number): number {
  const raw = extras['retry_after_ms'];
  const ms = typeof raw === 'number' && Number.isFinite(raw) ? raw : defaultMs;
  return Math.max(0, Math.min(ms, COLD_MAX_RETRY_MS));
}

function coldRetryDefaultMs(errorCode: string): number {
  return errorCode === 'quote_cold' ? QUOTE_COLD_DEFAULT_RETRY_MS : CONTEXT_COLD_DEFAULT_RETRY_MS;
}

function isColdResult(
  result: OrderSubmitResult,
): result is Extract<OrderSubmitResult, { kind: 'error' }> {
  return (
    result.kind === 'error' &&
    (result.errorCode === 'context_cold' || result.errorCode === 'quote_cold')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ack-time order correlation: the POST response already carries the
 * engine's `order_seq`/`ts_ms`, so register the OrderKey → clientOrderId
 * mapping here instead of depending on the SSE `accepted` frame (which
 * can land in a stream reconnect gap — previously stranding the toast on
 * "sending…" because every later lifecycle event failed to correlate).
 */
function registerAckOrderKey(clientOrderId: string, orderSeq: string | null, tsMs: number | null): void {
  if (orderSeq === null || tsMs === null || clientOrderId.length === 0) return;
  try {
    useTradeActivityStore.getState().registerOrderKey(clientOrderId, { seq: orderSeq, tsMs });
  } catch {
    // Correlation is best-effort; never fail a submit over it.
  }
}

export async function submitOrder(
  body: OrderIntentRequest,
  options: SubmitOrderOptions = {},
): Promise<OrderSubmitResult> {
  // E2E waterfall: begin the timing record at the shared submit seam so
  // every surface (TradePanel, InstantTradeBox, quickbuy) is covered by
  // one instrumentation point. In-memory bookkeeping only.
  if (options.timing !== undefined) {
    beginOrderTiming(body.client_order_id, {
      mint: body.mint,
      side: body.side,
      press: options.timing,
    });
  }
  // The reauth retry folds its fresh token in here so a subsequent cold
  // retry re-POSTs with the token that just authenticated, not the stale
  // one the server already rejected.
  let activeOptions = options;
  let result = await submitOrderOnce(body, activeOptions);
  if (result.kind === 'reauth' && shouldRetryReauth(activeOptions)) {
    const freshToken = await mintFreshOrderToken();
    if (freshToken !== null) {
      // Identical body (same client_order_id) — safe per the reauth-only
      // constraint documented above. If this also reauths, callers see
      // the same result they do today.
      activeOptions = { ...activeOptions, authToken: freshToken };
      result = await submitOrderOnce(body, activeOptions);
    }
  }
  if (isColdResult(result)) {
    // Self-healing cold click: the api (context_cold) or engine
    // (quote_cold) is warming in the background; identical body
    // re-POST after the hint (see block comment).
    await sleep(coldRetryDelayMs(result.extras, coldRetryDefaultMs(result.errorCode)));
    result = await submitOrderOnce(body, activeOptions);
    if (isColdResult(result)) {
      // Still cold: the warm outran the first retry (fresh-launch RPC
      // path). One final backstop re-POST, then surface the error.
      await sleep(COLD_SECOND_RETRY_MS);
      result = await submitOrderOnce(body, activeOptions);
    }
  }
  if (result.kind === 'ok') {
    registerAckOrderKey(body.client_order_id, result.order.order_seq, result.order.ts_ms);
  } else if (options.timing !== undefined) {
    // The POST itself ended the order (reauth / rejection / network):
    // flush the partial waterfall now instead of waiting out the timeout.
    finalizeOrderTimingFailure(
      body.client_order_id,
      result.kind === 'error' ? result.errorCode : result.kind,
    );
  }
  return result;
}

async function submitOrderOnce(
  body: OrderIntentRequest,
  options: SubmitOrderOptions = {},
): Promise<OrderSubmitResult> {
  let res: Response;
  // Timing stamps are keyed by clientOrderId and no-op when the order is
  // untracked; retries overwrite so the successful attempt's stamps win.
  stampFetchStart(body.client_order_id);
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/trade/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: orderSubmitSignal(options.signal) },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  stampFirstByte(body.client_order_id);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    const reason =
      typeof json['reason'] === 'string'
        ? (json['reason'] as 'no_session' | 'session_expired' | 'session_invalid')
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (res.ok && json['reauth_required'] === false) {
    // Accepted ack parsed. `server_received_at_ms` is the api's echoed
    // handler-entry stamp, feeding the clock-offset estimate.
    stampAckParsed(
      body.client_order_id,
      typeof json['server_received_at_ms'] === 'number'
        ? (json['server_received_at_ms'] as number)
        : null,
    );
    const order = json['order'] as Record<string, unknown> | undefined;
    const context = json['context'] as Record<string, unknown> | undefined;
    if (!order || !context) {
      return {
        kind: 'error',
        status: res.status,
        errorCode: 'shape_mismatch',
        message: 'API returned an unexpected success shape',
        extras: {},
      };
    }
    return {
      kind: 'ok',
      order: {
        client_order_id: String(order['client_order_id'] ?? ''),
        order_seq: order['order_seq'] === null ? null : String(order['order_seq'] ?? ''),
        ts_ms: typeof order['ts_ms'] === 'number' ? (order['ts_ms'] as number) : null,
        state: typeof order['state'] === 'string' ? (order['state'] as string) : 'accepted',
      },
      context: {
        authorization_id: String(context['authorization_id'] ?? ''),
        policy_version: String(context['policy_version'] ?? ''),
      },
    };
  }
  const errorCode =
    typeof json['error_code'] === 'string' ? (json['error_code'] as string) : 'unknown';
  const message =
    typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
  // Strip well-known fields; everything else is extras for support.
  const { error_code: _ec, message: _msg, reauth_required: _rr, ...extras } = json;
  void _ec;
  void _msg;
  void _rr;
  return { kind: 'error', status: res.status, errorCode, message, extras };
}

export function provisioningStateBlocksTrading(state: ProvisioningState): boolean {
  return state !== 'ready_to_trade';
}

// ─────────────────────────────────────────────────────────────────────
// Cold-load toast reconciliation: order-status lookup by client_order_id.
//
// The api/ exposes no `GET /orders/:client_order_id`; the closest read
// is `GET /api/v1/trade/fills?wallet_account_id=…&mint=…`, which joins
// confirmed `trading.fills` rows against the `trading.orders` lifecycle
// and carries `client_order_id` + `order_state` per row. A fill row
// existing for our clientOrderId means the order LANDED on-chain — the
// exact case a stuck "sending…" toast needs resolved when the order SSE
// connected after the events fired. Orders that failed (or are still in
// flight) never produce a fill row and come back `not_found`; the
// caller falls through to the stalled-copy escalation for those.
// ─────────────────────────────────────────────────────────────────────

export interface OrderStatusLookupInput {
  clientOrderId: string;
  mint: string;
  /** Omit/null → the api/ resolves the user's default wallet, mirroring submit. */
  walletAccountId?: string | null;
}

export type OrderStatusLookupResult =
  | {
      kind: 'found';
      orderState: string;
      /** Null for engine-FAILED orders resolved via the status fallback
       *  (no transaction ever landed, so there is no signature). */
      signature: string | null;
      /** `trading.orders.last_error_kind` when the status fallback
       *  resolved a failed order — the toast's real error copy. */
      errorKind?: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; reason: string }
  | { kind: 'network_error'; reason: string };

/**
 * A10 fallback: `GET /api/v1/trade/order-status?client_order_id=…` —
 * a read over `trading.orders` itself (state, signature,
 * last_error_kind, terminal_at), scoped server-side to the
 * authenticated user. Unlike the fills join it SEES engine-failed
 * orders, which never produce a fill row.
 */
interface OrderStatusWire {
  state: string;
  signature: string | null;
  lastErrorKind: string | null;
  terminalAt: string | null;
}

type FetchOrderStatusResult =
  | { kind: 'found'; order: OrderStatusWire }
  | { kind: 'not_found' }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; reason: string }
  | { kind: 'network_error'; reason: string };

async function fetchOrderStatus(
  clientOrderId: string,
  options: SubmitOrderOptions,
): Promise<FetchOrderStatusResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      `/api/v1/trade/order-status?client_order_id=${encodeURIComponent(clientOrderId)}`,
      { method: 'GET' },
      { authToken: options.authToken ?? null, ...(options.signal ? { signal: options.signal } : {}) },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    return {
      kind: 'reauth',
      reason:
        raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
          ? raw
          : 'session_invalid',
    };
  }
  if (typeof json['error_code'] === 'string') {
    return { kind: 'error', reason: json['error_code'] as string };
  }
  if (!res.ok || json['reauth_required'] !== false) {
    return { kind: 'error', reason: 'shape_mismatch' };
  }
  if (json['found'] !== true) return { kind: 'not_found' };
  const order = json['order'];
  if (order === null || typeof order !== 'object' || Array.isArray(order)) {
    return { kind: 'error', reason: 'shape_mismatch' };
  }
  const rec = order as Record<string, unknown>;
  if (typeof rec['state'] !== 'string') return { kind: 'error', reason: 'shape_mismatch' };
  return {
    kind: 'found',
    order: {
      state: rec['state'] as string,
      signature: typeof rec['signature'] === 'string' ? (rec['signature'] as string) : null,
      lastErrorKind:
        typeof rec['last_error_kind'] === 'string' ? (rec['last_error_kind'] as string) : null,
      terminalAt: typeof rec['terminal_at'] === 'string' ? (rec['terminal_at'] as string) : null,
    },
  };
}

/** Order lifecycle states that are conclusively over — the only states
 *  the status fallback may resolve a toast from. A non-terminal state
 *  (pending/accepted/submitted/confirmed) stays `not_found` so the
 *  reconciliation keeps polling instead of guessing. */
const TERMINAL_ORDER_STATES = new Set(['filled', 'failed', 'cancelled', 'expired', 'reverted']);

export async function lookupOrderStatus(
  input: OrderStatusLookupInput,
  options: SubmitOrderOptions = {},
): Promise<OrderStatusLookupResult> {
  const result = await fetchTradeFills(
    {
      mint: input.mint,
      walletAccountId: input.walletAccountId ?? null,
      // The order is seconds old, so it is at the head of the
      // created_at-ordered listing; a generous page guards against a
      // burst of fills on the same mint landing in between.
      limit: 50,
    },
    { authToken: options.authToken ?? null, ...(options.signal ? { signal: options.signal } : {}) },
  );
  switch (result.kind) {
    case 'ok': {
      const fill = result.fills.find((f) => f.client_order_id === input.clientOrderId);
      if (fill) {
        return { kind: 'found', orderState: fill.order_state, signature: fill.signature };
      }
      // A10 fallback: no fill row can mean "still working" OR "failed
      // and will never fill" — the fills join cannot tell them apart.
      // Read trading.orders directly; only a TERMINAL state resolves.
      const status = await fetchOrderStatus(input.clientOrderId, options);
      if (status.kind === 'found' && TERMINAL_ORDER_STATES.has(status.order.state)) {
        return {
          kind: 'found',
          orderState: status.order.state,
          signature: status.order.signature,
          errorKind: status.order.lastErrorKind,
        };
      }
      if (status.kind === 'reauth') return status;
      return { kind: 'not_found' };
    }
    case 'reauth':
      return { kind: 'reauth', reason: result.reason };
    case 'network_error':
      return { kind: 'network_error', reason: result.reason };
    case 'error':
      return { kind: 'error', reason: result.errorCode };
    case 'shape_mismatch':
      return { kind: 'error', reason: result.reason };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Slice "Multi-wallet split buy/sell orders": batch-orders client.
//
//   POST /api/v1/trade/batch-orders
//
// Splits a single user intent across N user-owned wallets as N
// independent child orders sharing one parent. The api/ gates the
// route behind `TRADE_BATCH_ORDERS_ENABLED`; the Terminal also
// gates the UI behind `NEXT_PUBLIC_TERMINAL_MULTI_WALLET_ENABLED`.
//
// Tagged-union result mirrors `transferSol` from slice 8: every
// branch the api/ can return is a discrete `kind` so the caller
// can pattern-match without re-narrowing.
// ─────────────────────────────────────────────────────────────────────

const POSITIVE_INT_REGEX = /^[1-9][0-9]*$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface BatchOrderBuyInput {
  side: 'buy';
  clientParentId: string;
  walletAccountIds: ReadonlyArray<string>;
  mint: string;
  graduated?: boolean;
  /**
   * Total buy size. Exactly one of `amountLamports` (SOL pairs) or
   * `amountUsdcMicro` (USDC pairs, integer micro-USDC string) must be
   * set; the api/ equal-splits the total per wallet either way.
   */
  amountLamports?: string;
  amountUsdcMicro?: string;
  maxSlippageBps: number;
  sendMode?: 'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  origin?: 'manual_ui' | 'automated_trigger' | 'replay';
  /**
   * Per-batch fee overrides applied to every child in the batch.
   * Mirrors `OrderIntentRequest.priority_lamports` /
   * `bribe_lamports` — see that interface for unit semantics.
   * Single value across the batch (matches the existing
   * `maxSlippageBps` semantic: one slippage tolerance applies to
   * every child wallet).
   */
  priorityLamports?: number;
  bribeLamports?: number;
  /**
   * Latency-tracing: `Date.now()` at the Buy/Sell button press. Sent to the
   * api/ as `client_ts` and fanned out to every child's trace `clickedAtMs`
   * (one click → one batch). Optional.
   */
  clientTsMs?: number;
  /**
   * E2E latency waterfall (client-side, monotonic clock): per-surface
   * press stamps. Each dispatched child gets its own timing record at
   * ack time, sharing the press and the batch POST's fetch stamps.
   * Observational only — never sent on the wire.
   */
  timing?: TradePressTiming;
}

export interface BatchOrderSellInput {
  side: 'sell';
  clientParentId: string;
  walletAccountIds: ReadonlyArray<string>;
  mint: string;
  graduated?: boolean;
  /**
   * Size the sell EITHER by a single percentage applied to every wallet
   * (`sellPercentBps`) OR by a per-wallet absolute token amount
   * (`sellTokensInByWallet`, keyed by `wallet_account_id` → base-units
   * string). Exactly one must be set — the latter is how a SOL-denominated
   * equal-split sell routes through the batch endpoint, mirroring the
   * equal-split buy. When `sellTokensInByWallet` is used, every wallet in
   * `walletAccountIds` must have an entry.
   */
  sellPercentBps?: number;
  sellTokensInByWallet?: Readonly<Record<string, string>>;
  maxSlippageBps: number;
  sendMode?: 'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  origin?: 'manual_ui' | 'automated_trigger' | 'replay';
  priorityLamports?: number;
  bribeLamports?: number;
  /**
   * Per-wallet token balance hints keyed by `wallet_account_id`
   * (base-units string, the same `/api/v1/trade/token-balance` snapshot
   * the single-wallet sell forwards as `sellTokenBalanceHint`). Lets each
   * batch child take the engine's robust hint short-circuit instead of a
   * cold per-wallet index / fail-closed chain read that would otherwise
   * cancel the sell as `no sellable balance`. Build with
   * `pickSellTokenBalanceHints`; entries for un-hinted wallets are simply
   * omitted (engine falls back to its chain read for those).
   */
  sellTokenBalanceHints?: Readonly<Record<string, string>>;
  /**
   * USDC-proceeds preference (USDC trade mode on SOL pairs). Forwarded
   * to every child as `spend_currency` — the engine appends the
   * SOL→USDC proceeds swap per child. Omit for pair-native settlement
   * (SOL pairs in SOL mode; USDC pairs settle USDC automatically).
   */
  spendCurrency?: 'usdc';
  /** Latency-tracing: `Date.now()` at button-press, shared by every child. */
  clientTsMs?: number;
  /** E2E latency waterfall — see `BatchOrderBuyInput.timing`. */
  timing?: TradePressTiming;
}

export type BatchOrderInput = BatchOrderBuyInput | BatchOrderSellInput;

export type BatchChildState =
  | 'pending'
  | 'dispatched'
  | 'failed'
  | 'idempotency_conflict'
  | 'gate_rejected';

export interface BatchOrderChild {
  readonly wallet_account_id: string;
  readonly client_order_id: string;
  readonly child_index: number;
  readonly state: BatchChildState;
  readonly amount_lamports: string | null;
  readonly order_seq: string | null;
  readonly signature: string | null;
  readonly ts_ms: number | null;
  readonly turnkey_activity_id: string | null;
  readonly error_code: string | null;
  readonly error_kind: string | null;
}

export type BatchOrderParentStatus =
  | 'reserved'
  | 'running'
  | 'filled'
  | 'partial_failed'
  | 'failed'
  | 'cancelled';

export interface BatchOrderParent {
  readonly id: string;
  readonly client_parent_id: string;
  readonly status: BatchOrderParentStatus;
  readonly wallet_count: number;
  readonly side: 'buy' | 'sell';
  readonly mint: string;
  readonly split_mode: 'equal';
  readonly total_amount_lamports: string | null;
  readonly sell_percent_bps: number | null;
  readonly total_tokens_in: string | null;
  readonly max_slippage_bps: number;
  readonly terminal_at: string | null;
  readonly error_code: string | null;
}

export type BatchOrderResult =
  | { kind: 'ok'; parent: BatchOrderParent; children: ReadonlyArray<BatchOrderChild> }
  | {
      kind: 'partial_failed';
      parent: BatchOrderParent;
      children: ReadonlyArray<BatchOrderChild>;
    }
  | { kind: 'failed'; parent: BatchOrderParent; children: ReadonlyArray<BatchOrderChild> }
  | { kind: 'cancelled'; parent: BatchOrderParent; children: ReadonlyArray<BatchOrderChild> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'in_flight'; parentId: string }
  | {
      kind: 'error';
      status: number;
      errorCode: string;
      message: string;
      details: Record<string, unknown>;
    }
  | { kind: 'network_error'; reason: string }
  /**
   * B3: the batch POST was aborted (10s client timeout / caller abort)
   * with the request possibly ALREADY dispatching children at the
   * engine. Unlike `network_error` this is NOT a failure verdict —
   * callers must keep child toasts PENDING and let the reconciliation
   * flow (fills lookup + order-status fallback) resolve their real
   * outcomes. Marking them failed baited a re-click into a guaranteed
   * double spend while the engine filled the first batch.
   */
  | { kind: 'unknown_outcome'; reason: string }
  | { kind: 'invalid_input'; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseChild(raw: unknown): BatchOrderChild | null {
  if (!isObject(raw)) return null;
  const walletAccountId = raw['wallet_account_id'];
  const clientOrderId = raw['client_order_id'];
  const childIndex = raw['child_index'];
  const state = raw['state'];
  if (
    typeof walletAccountId !== 'string' ||
    typeof clientOrderId !== 'string' ||
    typeof childIndex !== 'number' ||
    (state !== 'pending' &&
      state !== 'dispatched' &&
      state !== 'failed' &&
      state !== 'idempotency_conflict' &&
      state !== 'gate_rejected')
  ) {
    return null;
  }
  const amountLamports = raw['amount_lamports'];
  const orderSeq = raw['order_seq'];
  const signature = raw['signature'];
  const tsMs = raw['ts_ms'];
  const turnkeyActivityId = raw['turnkey_activity_id'];
  const errorCode = raw['error_code'];
  const errorKind = raw['error_kind'];
  return {
    wallet_account_id: walletAccountId,
    client_order_id: clientOrderId,
    child_index: Math.max(0, Math.floor(childIndex)),
    state,
    amount_lamports: typeof amountLamports === 'string' ? amountLamports : null,
    order_seq: typeof orderSeq === 'string' ? orderSeq : null,
    signature: typeof signature === 'string' ? signature : null,
    ts_ms: typeof tsMs === 'number' ? tsMs : null,
    turnkey_activity_id: typeof turnkeyActivityId === 'string' ? turnkeyActivityId : null,
    error_code: typeof errorCode === 'string' ? errorCode : null,
    error_kind: typeof errorKind === 'string' ? errorKind : null,
  };
}

function parseParent(raw: unknown): BatchOrderParent | null {
  if (!isObject(raw)) return null;
  const id = raw['id'];
  const clientParentId = raw['client_parent_id'];
  const status = raw['status'];
  const walletCount = raw['wallet_count'];
  const side = raw['side'];
  const mint = raw['mint'];
  if (
    typeof id !== 'string' ||
    typeof clientParentId !== 'string' ||
    (status !== 'reserved' &&
      status !== 'running' &&
      status !== 'filled' &&
      status !== 'partial_failed' &&
      status !== 'failed' &&
      status !== 'cancelled') ||
    typeof walletCount !== 'number' ||
    (side !== 'buy' && side !== 'sell') ||
    typeof mint !== 'string'
  ) {
    return null;
  }
  return {
    id,
    client_parent_id: clientParentId,
    status,
    wallet_count: Math.max(0, Math.floor(walletCount)),
    side,
    mint,
    split_mode: 'equal',
    total_amount_lamports:
      typeof raw['total_amount_lamports'] === 'string'
        ? (raw['total_amount_lamports'] as string)
        : null,
    sell_percent_bps:
      typeof raw['sell_percent_bps'] === 'number' ? (raw['sell_percent_bps'] as number) : null,
    total_tokens_in:
      typeof raw['total_tokens_in'] === 'string' ? (raw['total_tokens_in'] as string) : null,
    max_slippage_bps:
      typeof raw['max_slippage_bps'] === 'number' ? (raw['max_slippage_bps'] as number) : 0,
    terminal_at: typeof raw['terminal_at'] === 'string' ? (raw['terminal_at'] as string) : null,
    error_code: typeof raw['error_code'] === 'string' ? (raw['error_code'] as string) : null,
  };
}

/**
 * Pure parser. Exported for unit tests so the branch table is
 * exercised without `fetch`.
 */
export function parseBatchOrderResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): BatchOrderResult {
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
    const message =
      typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
    if (errorCodeRaw === 'batch_in_flight' && typeof json['parent_id'] === 'string') {
      return { kind: 'in_flight', parentId: json['parent_id'] as string };
    }
    const detailsRaw = json['details'];
    const details = isObject(detailsRaw) ? (detailsRaw as Record<string, unknown>) : {};
    // `retry_after_ms` rides at the top level of the api's error body
    // (context_cold); fold it into details so the one-shot cold retry
    // can read its wait hint without a second parse path.
    if (typeof json['retry_after_ms'] === 'number') {
      details['retry_after_ms'] = json['retry_after_ms'];
    }
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: errorCodeRaw,
      message,
      details,
    };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const parent = parseParent(json['parent']);
    const childrenRaw = json['children'];
    if (!parent || !Array.isArray(childrenRaw)) {
      return {
        kind: 'error',
        status: httpStatus,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
        details: {},
      };
    }
    const children: BatchOrderChild[] = [];
    for (const c of childrenRaw) {
      const parsed = parseChild(c);
      if (parsed) children.push(parsed);
    }
    if (parent.status === 'failed') {
      return { kind: 'failed', parent, children };
    }
    if (parent.status === 'partial_failed') {
      return { kind: 'partial_failed', parent, children };
    }
    // A `cancelled` parent means every child cancelled before dispatch
    // (e.g. `cancel.no sellable balance`). It must NOT collapse to `ok`,
    // otherwise the caller reports "Sell queued" while nothing sold.
    if (parent.status === 'cancelled') {
      return { kind: 'cancelled', parent, children };
    }
    return { kind: 'ok', parent, children };
  }
  return {
    kind: 'error',
    status: httpStatus,
    errorCode: 'shape_mismatch',
    message: 'unexpected response shape',
    details: {},
  };
}

interface BatchOrderWireBuy {
  client_parent_id: string;
  wallet_account_ids: string[];
  split_mode: 'equal';
  side: 'buy';
  mint: string;
  amount_lamports?: string;
  amount_usdc_micro?: string;
  spend_currency?: 'sol' | 'usdc';
  max_slippage_bps: number;
  send_mode?: 'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  origin?: 'manual_ui' | 'automated_trigger' | 'replay';
  priority_lamports?: number;
  bribe_lamports?: number;
  /** Latency-tracing: button-press clock, shared by every child. */
  client_ts?: number;
}
interface BatchOrderWireSell {
  client_parent_id: string;
  wallet_account_ids: string[];
  split_mode: 'equal';
  side: 'sell';
  mint: string;
  graduated?: boolean;
  sell_percent_bps?: number;
  sell_tokens_in?: Record<string, string>;
  spend_currency?: 'sol' | 'usdc';
  max_slippage_bps: number;
  send_mode?: 'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  origin?: 'manual_ui' | 'automated_trigger' | 'replay';
  priority_lamports?: number;
  bribe_lamports?: number;
  sell_token_balance_hints?: Record<string, string>;
  /** Latency-tracing: button-press clock, shared by every child. */
  client_ts?: number;
}

/**
 * Project the caller's per-wallet sell hints onto the wire, defensively
 * filtered to wallets actually in this batch with strictly-positive
 * integer base-unit values. Malformed/zero entries are dropped so the
 * api's `sell_token_balance_hints` Ajv schema never 400s the whole
 * batch over one bad value (the engine falls back to a chain read for
 * the omitted wallets).
 */
function sellHintsWire(
  hints: Readonly<Record<string, string>> | undefined,
  walletIds: ReadonlyArray<string>,
): { sell_token_balance_hints?: Record<string, string> } {
  if (!hints) return {};
  const ids = new Set(walletIds);
  const out: Record<string, string> = {};
  for (const [walletId, tokens] of Object.entries(hints)) {
    if (!ids.has(walletId)) continue;
    if (!POSITIVE_INT_REGEX.test(tokens)) continue;
    out[walletId] = tokens;
  }
  return Object.keys(out).length > 0 ? { sell_token_balance_hints: out } : {};
}

/**
 * camelCase -> snake_case projection for the optional fee fields
 * shared by both buy + sell wire bodies. Centralized so the two
 * branches in `submitBatchOrder` don't duplicate the conditional
 * spread logic.
 */
function feeOverridesWire(input: Pick<BatchOrderBuyInput, 'priorityLamports' | 'bribeLamports'>): {
  priority_lamports?: number;
  bribe_lamports?: number;
} {
  return {
    ...(input.priorityLamports !== undefined ? { priority_lamports: input.priorityLamports } : {}),
    ...(input.bribeLamports !== undefined ? { bribe_lamports: input.bribeLamports } : {}),
  };
}

export async function submitBatchOrder(
  input: BatchOrderInput,
  options: SubmitOrderOptions = {},
): Promise<BatchOrderResult> {
  if (
    typeof input.clientParentId !== 'string' ||
    input.clientParentId.length === 0 ||
    input.clientParentId.length > 128
  ) {
    return { kind: 'invalid_input', reason: 'client_parent_id must be 1..128 chars' };
  }
  if (input.walletAccountIds.length === 0) {
    return { kind: 'invalid_input', reason: 'at least one wallet_account_id is required' };
  }
  for (const id of input.walletAccountIds) {
    if (!UUID_REGEX.test(id)) {
      return { kind: 'invalid_input', reason: 'wallet_account_id must be a UUID' };
    }
  }
  // Reject in-place duplicates client-side so the user sees a clearer
  // error than the api's `uniqueItems: true` Ajv message.
  const seen = new Set<string>();
  for (const id of input.walletAccountIds) {
    if (seen.has(id)) {
      return { kind: 'invalid_input', reason: 'duplicate wallet_account_id' };
    }
    seen.add(id);
  }
  let body: BatchOrderWireBuy | BatchOrderWireSell;
  if (input.side === 'buy') {
    const hasLamports = input.amountLamports !== undefined;
    const hasUsdcMicro = input.amountUsdcMicro !== undefined;
    if (hasLamports === hasUsdcMicro) {
      return {
        kind: 'invalid_input',
        reason: 'exactly one of amountLamports or amountUsdcMicro must be set',
      };
    }
    if (hasUsdcMicro && !POSITIVE_INT_REGEX.test(input.amountUsdcMicro!)) {
      return {
        kind: 'invalid_input',
        reason: 'amount_usdc_micro must be a positive integer string',
      };
    }
    if (hasLamports && !POSITIVE_INT_REGEX.test(input.amountLamports!)) {
      return { kind: 'invalid_input', reason: 'amount_lamports must be a positive integer string' };
    }
    body = {
      client_parent_id: input.clientParentId,
      wallet_account_ids: [...input.walletAccountIds],
      split_mode: 'equal',
      side: 'buy',
      mint: input.mint,
      ...(input.graduated === true ? { graduated: true } : {}),
      // SOL buys keep their exact legacy body; USDC buys carry the
      // micro amount plus the explicit spend marker.
      ...(hasLamports
        ? { amount_lamports: input.amountLamports! }
        : { amount_usdc_micro: input.amountUsdcMicro!, spend_currency: 'usdc' as const }),
      max_slippage_bps: input.maxSlippageBps,
      ...(input.sendMode !== undefined ? { send_mode: input.sendMode } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.clientTsMs !== undefined ? { client_ts: input.clientTsMs } : {}),
      ...feeOverridesWire(input),
    };
  } else {
    const hasPercent = input.sellPercentBps !== undefined;
    const hasTokens = input.sellTokensInByWallet !== undefined;
    if (hasPercent === hasTokens) {
      return {
        kind: 'invalid_input',
        reason: 'exactly one of sellPercentBps or sellTokensInByWallet must be set',
      };
    }
    let sizing: Pick<BatchOrderWireSell, 'sell_percent_bps' | 'sell_tokens_in'> &
      Pick<BatchOrderWireSell, 'sell_token_balance_hints'>;
    if (hasTokens) {
      const tokensByWallet = input.sellTokensInByWallet!;
      const out: Record<string, string> = {};
      for (const id of input.walletAccountIds) {
        const raw = tokensByWallet[id];
        if (raw === undefined || !POSITIVE_INT_REGEX.test(raw)) {
          return {
            kind: 'invalid_input',
            reason: 'sellTokensInByWallet must hold a positive integer for every wallet',
          };
        }
        out[id] = raw;
      }
      // Token sells never carry a balance hint (the engine rejects a hint
      // without a percentage sell).
      sizing = { sell_tokens_in: out };
    } else {
      if (
        !Number.isInteger(input.sellPercentBps) ||
        input.sellPercentBps! < 1 ||
        input.sellPercentBps! > 10_000
      ) {
        return { kind: 'invalid_input', reason: 'sell_percent_bps must be in 1..10000' };
      }
      sizing = {
        sell_percent_bps: input.sellPercentBps,
        ...sellHintsWire(input.sellTokenBalanceHints, input.walletAccountIds),
      };
    }
    body = {
      client_parent_id: input.clientParentId,
      wallet_account_ids: [...input.walletAccountIds],
      split_mode: 'equal',
      side: 'sell',
      mint: input.mint,
      ...(input.graduated === true ? { graduated: true } : {}),
      ...(input.spendCurrency !== undefined ? { spend_currency: input.spendCurrency } : {}),
      max_slippage_bps: input.maxSlippageBps,
      ...(input.sendMode !== undefined ? { send_mode: input.sendMode } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.clientTsMs !== undefined ? { client_ts: input.clientTsMs } : {}),
      ...feeOverridesWire(input),
      ...sizing,
    };
  }
  // Same as submitOrder: fold the reauth retry's fresh token into the
  // options a subsequent cold retry uses.
  let activeOptions = options;
  // Batch children's client_order_ids are server-derived, so their timing
  // records can only begin at ack time; the batch POST's fetch stamps are
  // captured here and copied onto each child below (overwrite per attempt
  // so the successful POST's stamps win).
  const fetchStamps: OrderFetchStamps = {};
  let result = await postBatchOrder(body, activeOptions, fetchStamps);
  if (result.kind === 'reauth' && shouldRetryReauth(activeOptions)) {
    const freshToken = await mintFreshOrderToken();
    if (freshToken !== null) {
      // Identical body (same client_parent_id → same derived child
      // client_order_ids) — safe per the reauth-only constraint above:
      // batch-orders.ts reauths before any child is reserved/dispatched.
      activeOptions = { ...activeOptions, authToken: freshToken };
      result = await postBatchOrder(body, activeOptions, fetchStamps);
    }
  }
  if (result.kind === 'error' && result.errorCode === 'context_cold') {
    // Same one-shot cold retry as submitOrder: the batch route rejects
    // `context_cold` before any child is reserved or dispatched, so the
    // identical re-POST is replay-safe. `quote_cold` deliberately does
    // NOT retry here — it only surfaces per child AFTER children are
    // reserved/dispatched (never as a whole-batch reject), so a batch
    // re-POST would bounce off the engine's idempotency instead.
    await sleep(coldRetryDelayMs(result.details, CONTEXT_COLD_DEFAULT_RETRY_MS));
    result = await postBatchOrder(body, activeOptions, fetchStamps);
  }
  // Ack-time correlation for every dispatched child (same rationale as
  // submitOrder — don't depend on the SSE `accepted` frame).
  if (result.kind === 'ok' || result.kind === 'partial_failed') {
    for (const child of result.children) {
      registerAckOrderKey(child.client_order_id, child.order_seq, child.ts_ms);
      // E2E waterfall per dispatched child: shared press + batch POST
      // stamps; the SSE lifecycle and paint stamps land per child.
      if (input.timing !== undefined && child.state === 'dispatched') {
        beginOrderTiming(child.client_order_id, {
          mint: input.mint,
          side: input.side,
          press: input.timing,
        });
        applyOrderFetchStamps(child.client_order_id, fetchStamps);
      }
    }
  }
  return result;
}

/** Abort/timeout rejections from fetch carry the signal's reason —
 *  DOMException `AbortError` (caller abort) or `TimeoutError`
 *  (AbortSignal.timeout). Anything else is a plain network failure. */
function isAbortLikeError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

async function postBatchOrder(
  body: BatchOrderWireBuy | BatchOrderWireSell,
  options: SubmitOrderOptions,
  fetchStamps?: OrderFetchStamps,
): Promise<BatchOrderResult> {
  let res: Response;
  if (fetchStamps !== undefined) {
    fetchStamps.fetchStartAtMs = tradeTimingNow();
    fetchStamps.fetchStartWallMs = Date.now();
  }
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/trade/batch-orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: orderSubmitSignal(options.signal) },
    );
  } catch (err) {
    // B3: an abort is indeterminate — the POST may have reached the api
    // and dispatched children before the 10s timeout fired. Surface it
    // as `unknown_outcome` (keep toasts pending; reconcile) instead of
    // a definite failure. Non-abort throws keep the failure mapping.
    if (isAbortLikeError(err)) {
      return { kind: 'unknown_outcome', reason: (err as Error).name ?? 'aborted' };
    }
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  if (fetchStamps !== undefined) {
    fetchStamps.firstByteAtMs = tradeTimingNow();
    fetchStamps.firstByteWallMs = Date.now();
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (fetchStamps !== undefined) {
    fetchStamps.ackParsedAtMs = tradeTimingNow();
    if (typeof json['server_received_at_ms'] === 'number') {
      fetchStamps.serverReceivedAtMs = json['server_received_at_ms'] as number;
    }
  }
  return parseBatchOrderResponse(json, res.status);
}

/**
 * Slice "Multi-wallet split buy/sell orders" (UI revision): mirrors
 * `deriveChildClientOrderId` from
 * [api/src/routes/trade/batch-orders.ts](../../api/src/routes/trade/batch-orders.ts).
 *
 * SHA-256 over `${clientParentId}:${walletAccountId}`, lower-case hex,
 * truncated to the first 32 chars. The terminal computes the same
 * id locally at click time so per-child toasts can be pre-created and
 * then correlated with the SSE `accepted` / `submitted` / `filled` /
 * `failed` events that arrive keyed on the same `clientOrderId`.
 */
export async function deriveChildClientOrderId(
  clientParentId: string,
  walletAccountId: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${clientParentId}:${walletAccountId}`);
  const subtle = typeof globalThis !== 'undefined' && globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle.digest not available');
  }
  const buf = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex.slice(0, 32);
}

'use client';

/**
 * EVM trade panel — buy and sell, live.
 *
 * This file used to be a deliberately disabled shell, and that was the honest
 * end state while `the backend service` answered `403
 * evm_signing_gated_off_wp207` to every order. The signer landed and the gate
 * opened, so the shell became the lie the old header warned about. This is
 * the working panel.
 *
 * IT IS STILL A SEPARATE COMPONENT FROM THE SOLANA `TradePanel`, and that is
 * not laziness. That file owns the Solana trade store, the prewarm ladder,
 * the send-mode/route overrides, the Jito tip fields and the fills stream —
 * none of which exist on this chain, all of which are live-money surface
 * where "Solana behavior must not change" is the acceptance bar. Branching it
 * on chain would put an EVM code path inside the Solana order hot path. A
 * parallel panel that speaks the same api route is the smaller risk.
 *
 * DOCTRINE, unchanged from the rest of this directory:
 * - **No amount touches a JS number.** The user's text becomes base units by
 *   string surgery in `lib/evm/amount.ts`, travels as a decimal STRING, and
 *   is displayed by the BigInt formatters. `nativeIn` is never a `number` on
 *   the wire — `JSON.stringify` cannot make it one because it is never one.
 * - **Absent is never zero.** An unknown token balance disables the percent
 *   presets and SAYS SO; it does not render 0 and offer "100%".
 * - **An unknown scale is never 18.** Every token amount here — typed, preset
 *   or MAX — is sized from the token's MEASURED `decimals`, and a token whose
 *   scale nobody read cannot be sold from this panel at all. Decimals are not
 *   universally 18 (on BSC, DOGE is 8 and TLM is 4), so the old hardcoded
 *   scale sized a sell on a 6-decimal token wrong by 10^12 with no error
 *   shown. A disabled control with a reason is honest; a silently mis-sized
 *   live-money order is the worst failure this codebase has, because it looks
 *   like it worked. See `lib/evm/sizing.ts`.
 * - **A timeout is not a failure.** `indeterminate` is its own state with its
 *   own wording, and the submit button stays disabled behind it: re-pressing
 *   after a timeout is how one order becomes two.
 * - **The estimate is labelled an estimate everywhere it appears.** The
 *   binding `minAmountOut` is computed by the engine against live reserves
 *   and re-checked by the verifier; nothing here is authoritative.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import {
  nativeSymbolForChain,
  type EvmTradeBlockedReason,
} from '@/lib/evm/discoverAdapter';
import { tradeBlockedText } from '@/components/discover/chainBinding';
import {
  baseUnitsToInputText,
  parseDecimalAmount,
  percentOf,
  type AmountParseResult,
} from '@/lib/evm/amount';
import { EVM_NATIVE_DECIMALS, formatBigIntUnits, formatUnits } from '@/lib/evm/money';
import { maxBuyRequiredBalanceWei, maxBuySpendWei } from '@/lib/evm/maxBuy';
import { resolveOrderScale, resolveTokenScale } from '@/lib/evm/sizing';
import { estimateBuy, estimateSell, pickPriceRatio, type EvmOrderEstimate } from '@/lib/evm/quote';
import {
  buildEvmOrderBody,
  evmOrderFingerprint,
  evmRefusalText,
  fitsWireAmount,
  isEvmRefusalPossiblyLive,
  isEvmRefusalRetryable,
  MAX_WEI_DIGITS,
  submitEvmOrder,
  type EvmOrderAck,
  type EvmOrderRequest,
  type EvmOrderResult,
  type EvmOrderSide,
} from '@/lib/evm/orderApi';
import { explorerName, explorerTxUrl, shortTxHash } from '@/lib/evm/explorer';
import {
  evmQuoteRefusalText,
  fetchEvmServedQuote,
  type EvmServedQuoteAsset,
  type EvmServedQuoteResult,
} from '@/lib/evm/quoteApi';
import { useEvmWallets } from '@/lib/evm/useEvmWallets';
import {
  browserEvmOrderStorage,
  clearPendingEvmOrder,
  fetchEvmOrderStatus,
  readPendingEvmOrder,
  reconcilePendingEvmOrderStatus,
  writePendingEvmOrder,
} from '@/lib/evm/orderStatusApi';
import { openEvmOrderEvents } from '@/lib/evm/orderEvents';
import type {
  EvmWalletBalance,
  EvmWalletBalancesResult,
} from '@/lib/api/evm-wallet-balances';
import { WalletCountButton } from './WalletCountButton';
import type { EvmTokenBalanceRow } from '@/lib/evm/tokenBalanceApi';
import {
  buildEvmBatchOrderBody,
  evmBatchOrderFingerprint,
  fetchEvmBatchOrderStatus,
  submitEvmBatchOrder,
  type EvmBatchOrderInput,
  type EvmBatchOrderResult,
  type EvmBatchOrderStatusResult,
} from '@/lib/evm/batchOrderApi';
import {
  aggregateEvmBatchQuotes,
  fetchEvmBatchQuotesBounded,
  isCurrentEvmBatchQuotes,
  isSameEvmBatchQuoteSubjects,
  splitEvmBatchAmount,
  type EvmBatchQuoteSubject,
  type QuotedEvmBatchChild,
} from '@/lib/evm/batchQuote';
import {
  clearPendingEvmBatchOrder,
  readPendingEvmBatchOrder,
  reconcilePendingEvmBatchStatus,
  writePendingEvmBatchOrder,
  type PendingEvmBatchOrder,
} from '@/lib/evm/batchOrderStatus';
import { EvmAdvancedOrderForm } from './advanced/EvmAdvancedOrderForm';

/**
 * Default slippage tolerance, in basis points.
 *
 * 3% rather than the 1% a spot DEX would use: both wave-1 venues are
 * launchpad markets where a single block routinely moves the curve more than
 * a percent, and a tolerance too tight does not protect the user — it reverts
 * their order and charges them the gas anyway.
 */
const DEFAULT_SLIPPAGE_BPS = 300;
const MIN_SLIPPAGE_BPS = 1;
const MAX_SLIPPAGE_BPS = 5_000;

// THE SELL WIRE IS LIVE END TO END — there is no wire-support gate here any
// more, and none may be reintroduced on the strength of a comment. The
// previous gate (`EVM_SELL_WIRE_SUPPORTED = false`) justified itself with
// three refusals that were all FALSE in the tree it claimed to describe. The
// facts, each pinned by that component's OWN tests rather than by prose:
//  - the api admits `tokens_in` as the sell size
//    (`api/src/trade/evm-order-router.ts::validateEvmIntentShape`);
//  - the gateway forwards it as `tokensIn`
//    (an internal backend type, sell tests beside
//    it);
//  - the engine parses it (an internal backend type,
//    asserted against the engine's actual parser by the gateway's
//    `the_engine_parses_our_sell_intent` coordination test).
// If a hop ever regresses, those tests fail — dead text here cannot.

/**
 * Debounce on the served-quote fetch while the user is typing. Long enough
 * that each keystroke does not cost a gateway→engine round trip, short enough
 * that the served figure lands before the user reaches the submit button.
 */
const SERVED_QUOTE_DEBOUNCE_MS = 300;

/**
 * The served quote — the ENGINE's own answer for an identical order, from
 * `GET /api/v1/evm/trade/quote`. Its `min_amount_out` is the binding floor;
 * the client-side `estimate` stays on screen as instant feedback while this
 * is in flight, labelled as the estimate it is.
 *
 * `refused` and `note` are different claims: a refusal is the engine's own
 * product state (migrating, not warm, no pool — rendered in its own words),
 * a note is this client failing to OBTAIN an answer (rate-limited, gateway
 * down, session expired). Both block submission. The engine still re-quotes
 * at execution, but an unavailable confirmation quote is not executable.
 */
type QuotedEvmServedQuote = Extract<EvmServedQuoteResult, { kind: 'quoted' }> & {
  /** Client-captured ingestion route subject; the quote wire need not echo it. */
  readonly marketVenue?: string | null;
};

type ServedQuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | QuotedEvmServedQuote
  | { kind: 'refused'; refused: string; text: string }
  | { kind: 'note'; text: string };

type BatchQuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'quoted';
      quotes: readonly QuotedEvmBatchChild[];
      subjects: readonly EvmBatchQuoteSubject[];
    }
  | { kind: 'refused'; text: string }
  | { kind: 'note'; text: string };

type BatchSubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'recovering'; detail: string; children: readonly string[] }
  | {
      kind: 'confirmed' | 'partial_failed' | 'failed' | 'cancelled';
      parentId: string;
      children: readonly string[];
    }
  | { kind: 'reorged'; detail: string; children: readonly string[] }
  | { kind: 'reauth' }
  | { kind: 'refused'; code: string; text: string };

export interface EvmServedQuoteSubject {
  readonly chain: string;
  readonly token: string;
  readonly walletAccountId: string;
  readonly side: EvmOrderSide;
  readonly amountBaseUnits: string;
  readonly quoteAssetAddress: string | null;
  readonly slippageBps: number;
  readonly marketVenue?: string | null;
}

function quoteAssetMatchesSubject(
  quote: QuotedEvmServedQuote,
  subject: EvmServedQuoteSubject,
): boolean {
  const asset = quote.side === 'buy' ? quote.inputAsset : quote.outputAsset;
  const expectedAddress = subject.quoteAssetAddress?.toLowerCase() ?? null;
  return expectedAddress === null
    ? asset.kind === 'native' && asset.address === null
    : asset.kind === 'erc20' && asset.address === expectedAddress;
}

/**
 * Pure submit gate: every mutable UI selection and the wall-clock are checked
 * again at render and click. This closes the render-before-effect race where
 * React still holds wallet A's quote for one frame after selecting wallet B.
 */
export function isCurrentEvmServedQuote(
  quote: QuotedEvmServedQuote | null,
  subject: EvmServedQuoteSubject | null,
  nowMs: number,
): boolean {
  return quote !== null &&
    subject !== null &&
    quote.chain === subject.chain &&
    quote.token === subject.token.toLowerCase() &&
    quote.side === subject.side &&
    quote.walletAccountId === subject.walletAccountId &&
    quote.slippageBps === subject.slippageBps &&
    quote.amountIn === subject.amountBaseUnits &&
    quote.marketVenue === subject.marketVenue &&
    quoteAssetMatchesSubject(quote, subject) &&
    quote.quotedAtMs <= nowMs + 30_000 &&
    quote.expiresAtMs > nowMs;
}

/** Newly admitted venues require their own execution proof. A generic V4
 * quote is not evidence for the distinct Crowd tick-50 pool. */
export function quoteProvesEvmMarketVenue(
  marketVenue: string | null,
  quote: Pick<QuotedEvmServedQuote, 'venue' | 'routeMode'>,
): boolean {
  return marketVenue !== 'pools_trade_crowd_tick50'
    || (
      quote.venue === 'pools_trade_crowd_tick50'
      && quote.routeMode === 'pools_trade_crowd_tick50'
    );
}

/** Exact display label for the fee asset the quote itself names. */
export function evmQuoteAssetDisplayLabel(
  asset: EvmServedQuoteAsset,
  nativeSymbol: string,
  knownErc20Symbol: string | null,
): string {
  if (asset.kind === 'native') return nativeSymbol;
  if (knownErc20Symbol !== null && knownErc20Symbol.trim().length > 0) {
    return knownErc20Symbol;
  }
  const address = asset.address;
  return address === null ? 'quote token' : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Native-denominated quick sizes. Strings, so they re-parse exactly. */
const BUY_PRESETS = ['0.05', '0.1', '0.25', '0.5'] as const;
const SELL_PRESET_BPS = [2_500, 5_000, 10_000] as const;

/** What the panel knows about the user's balance of THIS token. */
export type EvmTokenBalance =
  | { kind: 'known'; baseUnits: string }
  /** Genuinely unknown — say which unknown, never render it as zero. */
  | { kind: 'unknown'; why: string };

export interface EvmSelectedWallet {
  readonly walletAccountId: string;
  readonly walletAddress: string;
}

export interface EvmTradePanelProps {
  /** Storage tag: `bsc`, `robinhood_chain`. Picks the input's denomination. */
  chain: string;
  /** Lowercase 0x token address. */
  address: string;
  /** Ticker for the token side of the pair; falls back to a short address. */
  tokenSymbol: string;
  /** Curve reserves from the trade header, for the price estimate. */
  reserveNative?: string | null;
  reserveToken?: string | null;
  /**
   * WHAT those two words mean. Load-bearing, not decorative: on a `curve`
   * basis they are cumulative funds over remaining offers and their ratio is
   * ~480x off the real price, so `pickPriceRatio` must know the basis before
   * it may use them. See `lib/evm/quote.ts`.
   */
  reserveBasis?:
    | 'curve'
    | 'amm_pair'
    | 'pancake_v2'
    | 'pancake_v3'
    | 'uniswap_v2'
    | 'uniswap_v3'
    | 'uniswap_v4'
    | 'pancake_infinity_cl'
    | 'flap_curve'
    | 'concentrated_virtual'
    | null;
  /** four.meme's own marginal price word — THE price on a `curve` basis. */
  curvePriceWord?: string | null;
  /** Newest observed fill, which prices better than the curve when present. */
  lastTrade?: { cost: string; amount: string } | null;
  /** Requested-side execution capabilities from the authoritative wire. */
  buyable: boolean;
  sellable: boolean;
  buyBlockedReason: EvmTradeBlockedReason | null;
  sellBlockedReason: EvmTradeBlockedReason | null;
  /** Exact ingestion execution discriminator. Used to fail closed when the
   * execution plane has not admitted a newly distinguished venue yet. */
  marketVenue?: string | null;
  /** The selected wallet's balance of this token, for the sell presets. */
  tokenBalance?: EvmTokenBalance;
  /** Authoritative rows for every wallet on this chain. Batch sell sizing
   * refuses unless every selected wallet has an exact row. */
  tokenBalances?: readonly EvmTokenBalanceRow[] | null;
  /**
   * Whether this market's money leg is the chain's own coin
   * (`EvmCardView.quote.isNative`).
   *
   * REQUIRED, and never defaulted to `true`. The buy box's only wire field is
   * `native_in_wei`, so a number typed into it is read as wei of the native
   * asset — which is a lie on the ~half of live Pons v2 launches quoted in
   * Robinhood stock tokens, where the money leg is that token and the wire
   * publishes no decimals for it. `resolveOrderScale` refuses the buy for
   * exactly that reason; silence here must not be read as ETH.
   */
  quoteIsNative: boolean;
  /** Exact quote ERC-20, or null when execution uses the chain coin. */
  quoteAssetAddress: string | null;
  /** Measured money-leg scale; required for token-quoted sizing. */
  quoteDecimals?: number | null;
  /** Display label only. The address above binds identity. */
  quoteSymbol?: string | null;
  /**
   * The token's MEASURED ERC-20 decimals, or `null` if nothing measured them.
   *
   * This is the scale every token-denominated amount in this panel is sized
   * and rendered at. It must be the measured value —
   * `EvmCardView.measuredTokenDecimals` — and never the render-time fallback
   * `tokenDecimals`, which is 18 whenever the wire served no scale. `null` is
   * a refusal to size a sell, not a cue to assume; see `lib/evm/sizing.ts`.
   */
  tokenDecimals?: number | null;
  /** Why `tokenDecimals` is absent, from the wire's `identityAbsent.decimals`
   *  (`EvmCardView.tokenDecimalsAbsentText`). Shown with the refusal. */
  tokenDecimalsAbsentText?: string | null;
  /** Told which wallet is selected so the parent can look up its balance. */
  onWalletChange?: (wallet: EvmSelectedWallet | null) => void;
  /**
   * Which side the panel opens on. Defaults to `buy`, which is what every
   * caller wants; tests set it because the sell branch is otherwise only
   * reachable through a click, and the defects it carried were defects of
   * RENDERED COMPOSITION — two correct sentences printed twice — which only a
   * rendered sell panel can catch.
   */
  initialSide?: EvmOrderSide;
  /** Injected by tests. */
  walletsLoader?: () => Promise<EvmWalletBalancesResult>;
  submitImpl?: typeof submitEvmOrder;
  submitBatchImpl?: typeof submitEvmBatchOrder;
  batchStatusImpl?: typeof fetchEvmBatchOrderStatus;
  quoteImpl?: typeof fetchEvmServedQuote;
  newClientOrderId?: () => string;
  newClientParentId?: () => string;
  onOrderTransition?: () => void;
  /** Desktop-only modes admitted by the authoritative capability endpoint. */
  desktopAdvancedModes?: Readonly<{ limit: boolean; recurring: boolean }>;
  onAdvancedCreated?: () => void;
}

/**
 * The order lifecycle, as the SERVER can actually report it.
 *
 * A successful POST has a mined receipt, but the server does not persist its
 * authoritative fill until canonical finality. The receipt may still reorg,
 * so `pending_finality` retains the durable correlation id and polls the
 * server until a final fill exists. `may_be_live` is the distinct state where
 * neither client nor server can yet prove whether a broadcast landed.
 */
export type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  /** Canonical fill. `txHash` is the finalized receipt; absent means unreported. */
  | {
      kind: 'confirmed';
      state: string;
      orderSeq: string | null;
      txHash: string | null;
      blockNumber: string | number | null;
    }
  | {
      kind: 'pending_finality';
      state: string;
      orderSeq: string | null;
      txHash: string | null;
      blockNumber: string | number | null;
    }
  | { kind: 'reorged'; afterFinality: boolean }
  | { kind: 'refused'; text: string; code: string }
  | { kind: 'reauth' }
  /**
   * **The transaction may already be on chain.** Reached from the server's
   * own 202, from a 502 that bundles an engine timeout, or from our own POST
   * never completing. All three are the same thing to a user — an unknown
   * outcome on a live-money action — and all three MUST refuse to offer a
   * one-click retry. `detail` says which one it was, for support.
   */
  | { kind: 'may_be_live'; reason: string; source: 'server' | 'transport' };

/** Unknown/canonicality-active states retain the original order's one-click slot. */
export function evmSubmitStateBlocksNewOrder(state: SubmitState): boolean {
  return state.kind === 'submitting'
    || state.kind === 'may_be_live'
    || state.kind === 'pending_finality'
    || state.kind === 'reorged';
}

export function submitStateForAcceptedEvmOrder(ack: EvmOrderAck): SubmitState {
  return {
    kind: 'pending_finality',
    state: ack.state,
    orderSeq: ack.orderSeq,
    txHash: ack.txHash,
    blockNumber: ack.blockNumber,
  };
}

function defaultClientOrderId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // Never a bare timestamp: two distinct presses in the same millisecond must
  // not collide and make the second look like a replay of the first.
  return `evm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function EvmTradePanel({
  chain,
  address,
  tokenSymbol,
  reserveNative,
  reserveToken,
  reserveBasis = null,
  curvePriceWord = null,
  lastTrade,
  buyable,
  sellable,
  buyBlockedReason,
  sellBlockedReason,
  marketVenue = null,
  tokenBalance = { kind: 'unknown', why: 'Your balance of this token has not been read.' },
  tokenBalances = null,
  quoteIsNative,
  quoteAssetAddress,
  quoteDecimals = null,
  quoteSymbol = null,
  tokenDecimals = null,
  tokenDecimalsAbsentText = null,
  onWalletChange,
  initialSide = 'buy',
  walletsLoader,
  submitImpl,
  submitBatchImpl,
  batchStatusImpl,
  quoteImpl,
  newClientOrderId,
  newClientParentId,
  onOrderTransition,
  desktopAdvancedModes = { limit: false, recurring: false },
  onAdvancedCreated,
}: EvmTradePanelProps) {
  const [side, setSide] = useState<EvmOrderSide>(initialSide);
  const sideTradeable = side === 'buy' ? buyable : sellable;
  const sideTradeBlockedReason = side === 'buy' ? buyBlockedReason : sellBlockedReason;
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'recurring'>('market');
  const [amountText, setAmountText] = useState('');
  const [batchSellPercent, setBatchSellPercent] = useState<{
    bps: number;
    walletSubject: string;
  } | null>(null);
  const [slippageText, setSlippageText] = useState(String(DEFAULT_SLIPPAGE_BPS));
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });
  const [statusRefreshTick, setStatusRefreshTick] = useState(0);
  const nativeSymbol = nativeSymbolForChain(chain);
  const {
    state: walletsState,
    selected,
    selectedWallets,
    select: selectWallet,
    selectMany: selectWallets,
    maxWallets,
    reload: reloadWallets,
  } = useEvmWallets(chain, walletsLoader);
  const selectedWalletAccountId = selected?.wallet_account_id ?? null;
  const hasAdvancedMode = desktopAdvancedModes.limit || desktopAdvancedModes.recurring;
  useEffect(() => {
    if (
      (orderType === 'limit' && !desktopAdvancedModes.limit) ||
      (orderType === 'recurring' && !desktopAdvancedModes.recurring)
    ) {
      setOrderType('market');
    }
  }, [desktopAdvancedModes.limit, desktopAdvancedModes.recurring, orderType]);
  const selectedWalletIds = useMemo(
    () => selectedWallets.map((wallet) => wallet.wallet_account_id),
    [selectedWallets],
  );
  const selectedWalletSubject = selectedWalletIds.join(',');
  const batchMode = selectedWalletIds.length >= 2;
  const [batchSubmitState, setBatchSubmitState] = useState<BatchSubmitState>({ kind: 'idle' });
  const inFlightBatch = useRef<PendingEvmBatchOrder | null>(null);
  const activeBatchSubmit = useRef(false);

  // The order id is minted at the press and held until that submit RESOLVES,
  // so the one retry inside the client and the one bounded cold retry here
  // re-send the identical id.
  //
  // IT IS HELD WITH THE BODY IT WAS MINTED FOR. Reusing an id across a
  // DIFFERENT order (the user edits the amount, or navigates to another token
  // — `address` changes reset the form but a ref survives) makes the gateway
  // correctly reject it as a replay of the first. A changed fingerprint mints
  // a fresh id so a genuinely different intent is not confused with recovery.
 //
  // The awaited gateway reserve is the double-fill guard; status polling is
  // still the recovery action for an unknown outcome — see `SubmitStatus`.
  const inFlightOrder = useRef<{ id: string; fingerprint: string } | null>(null);
  const watchedOrder = useRef<{
    id: string;
    fingerprint: string;
    txHash: string | null;
    walletAccountId: string | null;
    walletAddress: string | null;
  } | null>(null);
  const [watchedClientOrderId, setWatchedClientOrderId] = useState<string | null>(null);
  const [watchedWalletAddress, setWatchedWalletAddress] = useState<string | null>(null);
  const finalityPollMs = chain === 'robinhood_chain' ? 5_000 : 1_000;

  useEffect(() => {
    const storage = browserEvmOrderStorage();
    if (storage === null) return;
    const pending = readPendingEvmOrder(storage, { chain, token: address });
    if (pending === null) return;
    inFlightOrder.current = { id: pending.clientOrderId, fingerprint: pending.fingerprint };
    watchedOrder.current = {
      id: pending.clientOrderId,
      fingerprint: pending.fingerprint,
      txHash: null,
      walletAccountId: pending.walletAccountId ?? null,
      walletAddress: pending.walletAddress ?? null,
    };
    setWatchedClientOrderId(pending.clientOrderId);
    setWatchedWalletAddress(pending.walletAddress ?? null);
    setSubmitState({ kind: 'may_be_live', reason: 'restored_pending_order', source: 'transport' });
  }, [address, chain]);

  useEffect(() => {
    const storage = browserEvmOrderStorage();
    if (storage === null) return;
    const pending = readPendingEvmBatchOrder(storage, { chain, token: address });
    if (pending === null) return;
    inFlightBatch.current = pending;
    activeBatchSubmit.current = true;
    setBatchSubmitState({
      kind: 'recovering',
      detail: 'Restored an unresolved batch. Checking its durable status...',
      children: [],
    });
  }, [address, chain]);

  useEffect(() => {
    const pending = inFlightBatch.current;
    if (pending === null || batchSubmitState.kind === 'submitting') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (controller.signal.aborted || inFlightBatch.current !== pending) return;
      const read = batchStatusImpl ?? fetchEvmBatchOrderStatus;
      const result: EvmBatchOrderStatusResult = await read(pending.input, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || inFlightBatch.current !== pending) return;
      if (result.kind === 'found') {
        const children = result.children.map((child) => (
          `${child.walletAccountId.slice(0, 8)}: ${child.state}`
        ));
        const storage = browserEvmOrderStorage();
        if (result.parent.status === 'running' || result.parent.status === 'reserved') {
          if (batchSubmitState.kind === 'confirmed') {
            if (storage !== null) writePendingEvmBatchOrder(storage, pending);
            setBatchSubmitState({
              kind: 'reorged',
              detail: 'A previously finalized batch fill was retracted by a chain reorganization. The original parent remains locked while status is repaired.',
              children,
            });
          } else {
            setBatchSubmitState({
              kind: 'recovering',
              detail: result.children.some((child) => child.state === 'indeterminate')
                ? 'At least one batch child may be live. The original parent key stays locked while status is reconciled.'
                : 'Batch submitted. Waiting for durable finalized child results.',
              children,
            });
          }
          timer = setTimeout(poll, finalityPollMs);
          return;
        }
        if (storage !== null) reconcilePendingEvmBatchStatus(storage, pending, result);
        if (result.parent.status === 'filled') {
          activeBatchSubmit.current = false;
          if (batchSubmitState.kind !== 'confirmed') {
            setBatchSubmitState({
              kind: 'confirmed',
              parentId: result.parent.id,
              children,
            });
            reloadWallets();
            onOrderTransition?.();
          }
          // Keep one read-only watcher alive in this mounted page so a rare
          // post-finality reorg can retract the green state. No POST is made.
          timer = setTimeout(poll, finalityPollMs);
          return;
        }
        inFlightBatch.current = null;
        activeBatchSubmit.current = false;
        setBatchSubmitState({
          kind: result.parent.status,
          parentId: result.parent.id,
          children,
        });
        reloadWallets();
        onOrderTransition?.();
        return;
      }
      if (result.kind === 'reauth') {
        setBatchSubmitState({ kind: 'reauth' });
      } else {
        setBatchSubmitState({
          kind: 'recovering',
          detail: result.kind === 'missing'
            ? 'The durable parent is not visible yet. This is not proof the POST failed; the original key stays locked.'
            : 'Batch status is temporarily unavailable. The original parent key stays locked; no retry is being sent.',
          children: [],
        });
      }
      timer = setTimeout(poll, 5_000);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [
    batchStatusImpl,
    batchSubmitState.kind,
    finalityPollMs,
    onOrderTransition,
    reloadWallets,
  ]);

  useEffect(() => {
    if (
      (
        submitState.kind !== 'may_be_live'
        && submitState.kind !== 'pending_finality'
        && submitState.kind !== 'reorged'
      ) ||
      inFlightOrder.current === null
    ) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const current = inFlightOrder.current;
      if (current === null || controller.signal.aborted) return;
      const status = await fetchEvmOrderStatus(chain, current.id, controller.signal, address);
      if (controller.signal.aborted) return;
      if (status.kind === 'order' && status.txHash !== null && watchedOrder.current?.id === current.id) {
        watchedOrder.current = { ...watchedOrder.current, txHash: status.txHash };
      }
      if (status.kind === 'reauth') {
        if (submitState.kind === 'may_be_live') {
          setSubmitState({
            kind: 'may_be_live',
            reason: 'sign_in_required_to_reconcile',
            source: 'transport',
          });
        }
        timer = setTimeout(poll, 5_000);
        return;
      }
        const storage = browserEvmOrderStorage();
        const disposition = storage === null
          ? 'continue'
          : reconcilePendingEvmOrderStatus(
              storage,
              { chain, clientOrderId: current.id },
              status,
            );
      if (disposition === 'filled' && status.kind === 'order') {
        inFlightOrder.current = null;
        setSubmitState({
          kind: 'confirmed',
          state: status.state,
          orderSeq: null,
          txHash: status.txHash,
          blockNumber: status.blockNumber,
        });
        reloadWallets();
        onOrderTransition?.();
        return;
      }
      if (disposition === 'refused' && status.kind === 'order') {
        inFlightOrder.current = null;
        watchedOrder.current = null;
        setWatchedClientOrderId(null);
        setWatchedWalletAddress(null);
        setSubmitState({
          kind: 'refused',
          code: 'order_refused',
          text: status.refusedReason ?? 'Order refused.',
        });
        onOrderTransition?.();
        return;
      }
      if (disposition === 'safe_to_retry') {
        inFlightOrder.current = null;
        watchedOrder.current = null;
        setWatchedClientOrderId(null);
        setWatchedWalletAddress(null);
        setSubmitState({
          kind: 'refused',
          code: 'safe_to_retry',
          text: 'The order was not sent. You can submit it again.',
        });
        return;
      }
      if (status.kind === 'order' && status.state === 'indeterminate') {
        if (
          watchedOrder.current?.txHash !== null
          || submitState.kind === 'pending_finality'
          || submitState.kind === 'reorged'
        ) {
          setSubmitState({ kind: 'reorged', afterFinality: false });
        } else {
          setSubmitState({
            kind: 'may_be_live',
            reason: status.refusedReason ?? 'canonicality_repair',
            source: 'server',
          });
        }
        timer = setTimeout(poll, finalityPollMs);
        return;
      }
      if (
        status.kind === 'order' &&
        status.state === 'pending_finality' &&
        (submitState.kind === 'may_be_live' || submitState.kind === 'reorged')
      ) {
        setSubmitState({
          kind: 'pending_finality',
          state: status.state,
          orderSeq: null,
          txHash: status.txHash,
          blockNumber: status.blockNumber,
        });
        return;
      }
      timer = setTimeout(poll, finalityPollMs);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [address, chain, finalityPollMs, onOrderTransition, reloadWallets, statusRefreshTick, submitState.kind]);

  const awaitingCanonicalOutcome =
    submitState.kind === 'may_be_live'
    || submitState.kind === 'pending_finality'
    || submitState.kind === 'reorged';
  const shouldWatchCanonicality = awaitingCanonicalOutcome || submitState.kind === 'confirmed';
  useEffect(() => {
    if (
      !shouldWatchCanonicality
      || watchedClientOrderId === null
      || watchedWalletAddress === null
      || (chain !== 'bsc' && chain !== 'robinhood_chain')
    ) return;
    return openEvmOrderEvents({
      chain,
      wallet: watchedWalletAddress,
      handlers: {
        onOrder: (event) => {
          const watched = watchedOrder.current;
          // Receipt-poller resolution events can legitimately lack the
          // original client id. A null id is attributable only when its tx
          // hash matches the receipt we watched; another order on the same
          // wallet must never retract this one.
          const matches = watched !== null && (
            event.clientOrderId === watched.id
            || (
              event.clientOrderId === null
              && event.txHash !== null
              && watched.txHash !== null
              && event.txHash.toLowerCase() === watched.txHash.toLowerCase()
            )
          );
          if (!matches || watched === null) return;
          if (event.kind === 'reorged') {
            inFlightOrder.current = { id: watched.id, fingerprint: watched.fingerprint };
            const storage = browserEvmOrderStorage();
            if (storage !== null) {
              writePendingEvmOrder(storage, {
                chain,
                token: address,
                clientOrderId: watched.id,
                fingerprint: watched.fingerprint,
                ...(watched.walletAccountId === null
                  ? {}
                  : { walletAccountId: watched.walletAccountId }),
                ...(watched.walletAddress === null
                  ? {}
                  : { walletAddress: watched.walletAddress }),
              });
            }
            setSubmitState({ kind: 'reorged', afterFinality: event.afterFinality === true });
          }
          if (inFlightOrder.current !== null) setStatusRefreshTick((tick) => tick + 1);
        },
        onResnapshot: (reason) => {
          const watched = watchedOrder.current;
          if (watched === null) return;
          if (
            reason !== 'hello'
            && inFlightOrder.current === null
            && submitState.kind === 'confirmed'
          ) {
            inFlightOrder.current = { id: watched.id, fingerprint: watched.fingerprint };
            const storage = browserEvmOrderStorage();
            if (storage !== null) {
              writePendingEvmOrder(storage, {
                chain,
                token: address,
                clientOrderId: watched.id,
                fingerprint: watched.fingerprint,
                ...(watched.walletAccountId === null
                  ? {}
                  : { walletAccountId: watched.walletAccountId }),
                ...(watched.walletAddress === null
                  ? {}
                  : { walletAddress: watched.walletAddress }),
              });
            }
            setSubmitState({
              kind: 'may_be_live',
              reason: 'canonicality_resnapshot',
              source: 'server',
            });
          }
          if (inFlightOrder.current !== null) setStatusRefreshTick((tick) => tick + 1);
        },
      },
    });
  }, [
    address,
    chain,
    shouldWatchCanonicality,
    submitState.kind,
    watchedClientOrderId,
    watchedWalletAddress,
  ]);

  // Legacy recovery records did not carry a wallet address. Attach one only
  // when the selected wallet matches the persisted account id (or when the
  // legacy record had no account id). Once attached, wallet selector changes
  // cannot move canonicality monitoring to a different wallet.
  useEffect(() => {
    const watched = watchedOrder.current;
    if (watched === null || watched.walletAddress !== null || selected === null) return;
    if (
      watched.walletAccountId !== null
      && watched.walletAccountId !== selected.wallet_account_id
    ) return;
    watchedOrder.current = {
      ...watched,
      walletAccountId: selected.wallet_account_id,
      walletAddress: selected.wallet_pubkey,
    };
    setWatchedWalletAddress(selected.wallet_pubkey);
  }, [selected]);

  useEffect(() => {
    onWalletChange?.(selected === null
      ? null
      : {
          walletAccountId: selected.wallet_account_id,
          walletAddress: selected.wallet_pubkey,
        });
  }, [selected, onWalletChange]);

  // Switching side or token invalidates a typed amount: 0.1 BNB and 0.1
  // tokens are not the same order, and leaving the digits in place is how a
  // user submits the wrong one.
  useEffect(() => {
    setAmountText('');
    setBatchSellPercent(null);
    const storage = browserEvmOrderStorage();
    if (storage === null) {
      setSubmitState({ kind: 'idle' });
      return;
    }
    const pending = readPendingEvmOrder(storage, { chain, token: address });
    if (pending === null) {
      setSubmitState({ kind: 'idle' });
    }
  }, [side, address, chain]);

  /**
   * THE SCALE THIS ORDER IS SIZED AT — measured, or refused.
   *
   * It used to be `side === 'buy' ? EVM_NATIVE_DECIMALS : EVM_TOKEN_DECIMALS`,
   * i.e. every sell was sized against a hardcoded 18 whatever the token
   * actually is. Decimals are not universally 18 (on BSC, DOGE is 8 and TLM is
   * 4), so that sized a sell on a 6-decimal token wrong by 10^12 — with no
   * error, no warning and no way for the user to tell. `resolveOrderScale`
   * refuses instead; see `lib/evm/sizing.ts` for why refusing is the only
   * honest branch.
   */
  const tokenScale = useMemo(
    () =>
      resolveTokenScale({
        measuredTokenDecimals: tokenDecimals,
        decimalsAbsentText: tokenDecimalsAbsentText,
        nativeSymbol,
      }),
    [tokenDecimals, tokenDecimalsAbsentText, nativeSymbol],
  );
  const orderScale = useMemo(
    () =>
      resolveOrderScale({
        side,
        measuredTokenDecimals: tokenDecimals,
        decimalsAbsentText: tokenDecimalsAbsentText,
        nativeSymbol,
        quoteIsNative,
        quoteDecimals,
        quoteSymbol,
      }),
    [
      side,
      tokenDecimals,
      tokenDecimalsAbsentText,
      nativeSymbol,
      quoteIsNative,
      quoteDecimals,
      quoteSymbol,
    ],
  );

  const parsed: AmountParseResult = useMemo(
    // With no scale there is nothing to parse INTO, so the amount never
    // becomes base units and `canSubmit` (which requires `ok`) can never fire.
    // Not `invalid`: the user's text is not the problem and blaming it would
    // be the wrong sentence. The real reason is rendered by `blockedReason`
    // and the disclosure at the foot of the panel.
    () =>
      orderScale.kind === 'known'
        ? parseDecimalAmount(amountText, orderScale.decimals)
        : { kind: 'empty' },
    [amountText, orderScale],
  );

  const slippageBps = useMemo(() => {
    // Digits only. `Number.parseInt('300abc')` is 300 — accepting that would
    // submit a tolerance the user did not type.
    const text = slippageText.trim();
    if (!/^\d+$/.test(text)) return null;
    const raw = Number.parseInt(text, 10);
    if (!Number.isInteger(raw)) return null;
    if (raw < MIN_SLIPPAGE_BPS || raw > MAX_SLIPPAGE_BPS) return null;
    return raw;
  }, [slippageText]);

  const selectedTokenBalances = useMemo(() => {
    if (tokenBalances === null) return null;
    const byWallet = new Map(tokenBalances.map((row) => [row.walletAccountId, row]));
    const result: Record<string, string> = {};
    for (const walletId of selectedWalletIds) {
      const row = byWallet.get(walletId);
      if (row?.status !== 'ok' || row.balanceBaseUnits === null) return null;
      result[walletId] = row.balanceBaseUnits;
    }
    return result;
  }, [selectedWalletIds, tokenBalances]);

  const batchChildAmounts = useMemo<Readonly<Record<string, string>> | null>(() => {
    if (!batchMode || parsed.kind !== 'ok') return null;
    if (
      side === 'sell'
      && batchSellPercent !== null
      && batchSellPercent.walletSubject === selectedWalletSubject
    ) {
      if (selectedTokenBalances === null) return null;
      const amounts: Record<string, string> = {};
      for (const walletId of selectedWalletIds) {
        const balance = selectedTokenBalances[walletId];
        if (balance === undefined) return null;
        const amount = (BigInt(balance) * BigInt(batchSellPercent.bps)) / 10_000n;
        if (amount <= 0n) return null;
        amounts[walletId] = amount.toString();
      }
      const total = Object.values(amounts).reduce((sum, amount) => sum + BigInt(amount), 0n);
      return total === parsed.baseUnits ? amounts : null;
    }
    return splitEvmBatchAmount(parsed.baseUnits, selectedWalletIds);
  }, [
    batchMode,
    batchSellPercent,
    parsed,
    selectedTokenBalances,
    selectedWalletIds,
    selectedWalletSubject,
    side,
  ]);

  const batchQuoteSubjects = useMemo<readonly EvmBatchQuoteSubject[]>(() => {
    if (batchChildAmounts === null || slippageBps === null) return [];
    return selectedWalletIds.map((walletAccountId) => ({
      chain,
      token: address,
      walletAccountId,
      side,
      amountBaseUnits: batchChildAmounts[walletAccountId]!,
      quoteAssetAddress,
      slippageBps,
      marketVenue,
    }));
  }, [
    address,
    batchChildAmounts,
    chain,
    quoteAssetAddress,
    marketVenue,
    selectedWalletIds,
    side,
    slippageBps,
  ]);

  const price = useMemo(
    () =>
      pickPriceRatio(lastTrade ?? null, {
        native: reserveNative,
        token: reserveToken,
        basis: reserveBasis,
        curvePriceWord,
      }),
    [lastTrade, reserveNative, reserveToken, reserveBasis, curvePriceWord],
  );

  const estimate: EvmOrderEstimate | null = useMemo(() => {
    if (parsed.kind !== 'ok' || price === null || slippageBps === null) return null;
    return side === 'buy'
      ? estimateBuy(parsed.baseUnits, price, slippageBps)
      : estimateSell(parsed.baseUnits, price, slippageBps);
  }, [parsed, price, slippageBps, side]);

  // THE SERVED QUOTE. Debounced behind typing, aborted on every input change,
  // sized with the EXACT base units and slippage the order would carry — so
  // the `min_amount_out` on screen is the same floor an identical order
  // binds. The engine still re-quotes at execution, but `canSubmit` requires
  // this exact amount-bound quote to remain fresh: an estimate that excludes
  // impact and fees is typing feedback, not executable confirmation.
  const [servedQuote, setServedQuote] = useState<ServedQuoteState>({ kind: 'idle' });
  const [batchQuote, setBatchQuote] = useState<BatchQuoteState>({ kind: 'idle' });
  const [quoteRefreshToken, refreshQuote] = useReducer((count: number) => count + 1, 0);
  const parsedBaseUnitsText = parsed.kind === 'ok' ? parsed.baseUnits.toString() : null;
  useEffect(() => {
    if (
      parsedBaseUnitsText === null
      || slippageBps === null
      || !sideTradeable
      || selectedWalletAccountId === null
      || batchMode
    ) {
      // No sized amount (or a frozen market) means there is nothing to quote.
      // The market-level refusals (migrating, quote-not-native) are already
      // rendered by `blockedReason`; asking the engine to restate them per
      // keystroke would be a round trip for a known answer.
      setServedQuote({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setServedQuote({ kind: 'loading' });
    const fetchQuote = quoteImpl ?? fetchEvmServedQuote;
    const timer = setTimeout(() => {
      void fetchQuote({
        chain,
        token: address,
        walletAccountId: selectedWalletAccountId,
        side,
        amountBaseUnits: BigInt(parsedBaseUnitsText),
        quoteAssetAddress,
        slippageBps,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return;
        switch (result.kind) {
          case 'quoted':
            if (!quoteProvesEvmMarketVenue(marketVenue, result)) {
              setServedQuote({
                kind: 'note',
                text: 'The quote did not prove the exact Crowd tick-50 execution route. Submission stays disabled rather than relabeling another pools.trade route.',
              });
              return;
            }
            setServedQuote({ ...result, marketVenue });
            return;
          case 'refused':
            // The engine's own product state, in its own vocabulary.
            setServedQuote({
              kind: 'refused',
              refused: result.refused,
              text: evmQuoteRefusalText(result.refused, result.reason),
            });
            return;
          case 'reauth':
            setServedQuote({
              kind: 'note',
              text: 'Sign in again to obtain the required executable quote. The instant estimate is non-executable typing feedback, and submission stays disabled.',
            });
            return;
          case 'limited':
            setServedQuote({
              kind: 'note',
              text: 'Quote requests are rate-limited right now. Retry the quote; submission stays disabled until a fresh executable quote lands.',
            });
            return;
          case 'unavailable':
            setServedQuote({
              kind: 'note',
              text: 'The quote service did not answer. The instant estimate is non-executable typing feedback; retry is required and submission stays disabled.',
            });
            return;
          case 'invalid':
          case 'error':
            setServedQuote({
              kind: 'note',
              text: 'The served quote could not be read. The instant estimate is non-executable typing feedback; retry is required and submission stays disabled.',
            });
        }
      });
    }, SERVED_QUOTE_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    parsedBaseUnitsText,
    slippageBps,
    sideTradeable,
    chain,
    address,
    side,
    selectedWalletAccountId,
    quoteAssetAddress,
    quoteImpl,
    quoteRefreshToken,
    batchMode,
    marketVenue,
  ]);

  useEffect(() => {
    if (!batchMode || batchQuoteSubjects.length < 2 || !sideTradeable) {
      setBatchQuote({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setBatchQuote({ kind: 'loading' });
    const fetchQuote = quoteImpl ?? fetchEvmServedQuote;
    const timer = setTimeout(() => {
      void fetchEvmBatchQuotesBounded(
        batchQuoteSubjects,
        (subject) => fetchQuote({
          chain: subject.chain,
          token: subject.token,
          walletAccountId: subject.walletAccountId,
          side: subject.side,
          amountBaseUnits: BigInt(subject.amountBaseUnits),
          quoteAssetAddress: subject.quoteAssetAddress,
          slippageBps: subject.slippageBps,
          signal: controller.signal,
        }),
        controller.signal,
      ).then((results) => {
        if (controller.signal.aborted) return;
        const quoted = results.filter(
          (result): result is QuotedEvmBatchChild => result.kind === 'quoted',
        );
        if (
          quoted.length === results.length
          && quoted.every((result) => quoteProvesEvmMarketVenue(marketVenue, result))
        ) {
          setBatchQuote({ kind: 'quoted', quotes: quoted, subjects: batchQuoteSubjects });
          return;
        }
        const refusal = results.find((result) => result.kind === 'refused');
        if (refusal?.kind === 'refused') {
          setBatchQuote({
            kind: 'refused',
            text: `A selected wallet quote was refused after ${quoted.length}/${results.length} child quotes succeeded. ${evmQuoteRefusalText(refusal.refused, refusal.reason)}`,
          });
          return;
        }
        setBatchQuote({
          kind: 'note',
          text: 'At least one selected wallet did not receive an executable quote. Every child quote is required before a batch can be submitted.',
        });
      }).catch(() => {
        if (controller.signal.aborted) return;
        setBatchQuote({
          kind: 'note',
          text: 'The batch quote set did not complete. Every child quote is required before submission.',
        });
      });
    }, SERVED_QUOTE_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [batchMode, batchQuoteSubjects, marketVenue, quoteImpl, quoteRefreshToken, sideTradeable]);

  // Quotes live for at most three seconds. At the exact expiry boundary clear
  // the executable figure before starting a replacement read, so a delayed
  // React render or click cannot submit against yesterday's state.
  useEffect(() => {
    if (servedQuote.kind !== 'quoted') return;
    const delayMs = Math.max(0, servedQuote.expiresAtMs - Date.now());
    const timer = globalThis.setTimeout(() => {
      setServedQuote((current) => current === servedQuote ? { kind: 'loading' } : current);
      refreshQuote();
    }, delayMs);
    return () => globalThis.clearTimeout(timer);
  }, [servedQuote]);

  useEffect(() => {
    if (batchQuote.kind !== 'quoted') return;
    const aggregate = aggregateEvmBatchQuotes(batchQuote.quotes);
    const delayMs = Math.max(0, (aggregate?.expiresAtMs ?? Date.now()) - Date.now());
    const timer = globalThis.setTimeout(() => {
      setBatchQuote((current) => current === batchQuote ? { kind: 'loading' } : current);
      refreshQuote();
    }, delayMs);
    return () => globalThis.clearTimeout(timer);
  }, [batchQuote]);

  const nativeBalanceWei = useMemo(() => {
    if (selected === null || selected.wei === null) return null;
    try {
      return BigInt(selected.wei);
    } catch {
      return null;
    }
  }, [selected]);

  const tokenBalanceUnits = useMemo(() => {
    if (tokenBalance.kind !== 'known') return null;
    try {
      return BigInt(tokenBalance.baseUnits);
    } catch {
      return null;
    }
  }, [tokenBalance]);

  const blockedReason = useMemo<string | null>(() => {
    // The scale check leads because it is the money-safety one: `orderScale`
    // already made the amount unsizeable, the presets below are disabled, and
    // the disclosure states this reason unconditionally.
    if (orderScale.kind === 'unknown') return orderScale.why;
    if (!sideTradeable) {
      return sideTradeBlockedReason === null
        ? 'This order side is disabled because its execution capability is unknown.'
        : tradeBlockedText(sideTradeBlockedReason);
    }
    if (walletsState.kind === 'reauth') return 'Sign in again to trade.';
    if (walletsState.kind === 'error') {
      return `Your wallets could not be read (${walletsState.detail}). This says nothing about whether they exist.`;
    }
    if (walletsState.kind === 'ready' && walletsState.wallets.length === 0) {
      return `You have no wallet on ${chain === 'bsc' ? 'BSC' : 'this chain'} yet.`;
    }
    return null;
  }, [orderScale, sideTradeable, sideTradeBlockedReason, walletsState, chain]);

  // The wire's own domain, checked before the round trip so an over-domain
  // amount is an explained refusal here rather than a generic
  // `intake_body_invalid` from a service the user cannot see.
  const overWireDomain = parsed.kind === 'ok' && !fitsWireAmount(parsed.baseUnits.toString(), side);

  const insufficient = useMemo(() => {
    if (parsed.kind !== 'ok') return false;
    if (side === 'buy' && quoteAssetAddress === null) {
      return nativeBalanceWei !== null && parsed.baseUnits > nativeBalanceWei;
    }
    // A TOKEN-QUOTED BUY IS NOT PROVEN AFFORDABLE HERE — it is UNCHECKED.
    // The money leg is an ERC-20 whose balance this panel never reads, so
    // there is nothing to compare `parsed.baseUnits` against and `false` is
    // "no evidence of insufficiency", not "sufficient". The user is told so
    // by `evm-buy-balance-unknown`, which renders on exactly this condition;
    // do not delete one without the other.
    if (side === 'buy') return false;
    return tokenBalanceUnits !== null && parsed.baseUnits > tokenBalanceUnits;
  }, [parsed, side, quoteAssetAddress, nativeBalanceWei, tokenBalanceUnits]);

  const requiredBuyBalance =
    parsed.kind === 'ok' && side === 'buy' && quoteAssetAddress === null
      ? maxBuyRequiredBalanceWei(parsed.baseUnits, chain)
      : null;
  const gasTight =
    requiredBuyBalance !== null &&
    !insufficient &&
    nativeBalanceWei !== null &&
    requiredBuyBalance > nativeBalanceWei;

  const maxBuyWei =
    quoteAssetAddress === null && nativeBalanceWei !== null
      ? maxBuySpendWei(nativeBalanceWei, chain)
      : 0n;
  const batchBuyCaps = batchMode && quoteAssetAddress === null
    && selectedWallets.every((wallet) => wallet.wei !== null)
      ? selectedWallets.map((wallet) => maxBuySpendWei(BigInt(wallet.wei!), chain))
      : [];
  const maxBuyBaseUnits = batchBuyCaps.length > 0
    ? batchBuyCaps.reduce((minimum, cap) => cap < minimum ? cap : minimum)
      * BigInt(batchBuyCaps.length)
    : maxBuyWei;
  const currentServedQuote = servedQuote.kind === 'quoted' ? servedQuote : null;
  const currentQuoteSubject: EvmServedQuoteSubject | null =
    parsedBaseUnitsText !== null &&
    selectedWalletAccountId !== null &&
    slippageBps !== null
      ? {
          chain,
          token: address,
          walletAccountId: selectedWalletAccountId,
          side,
          amountBaseUnits: parsedBaseUnitsText,
          quoteAssetAddress,
          slippageBps,
          marketVenue,
        }
      : null;
  const quoteReady = isCurrentEvmServedQuote(
    currentServedQuote,
    currentQuoteSubject,
    Date.now(),
  ) && (
    currentServedQuote === null
    || quoteProvesEvmMarketVenue(marketVenue, currentServedQuote)
  );
  const batchQuoteReady = batchQuote.kind === 'quoted'
    && isCurrentEvmBatchQuotes(batchQuote.quotes, batchQuoteSubjects, Date.now())
    && isSameEvmBatchQuoteSubjects(batchQuote.subjects, batchQuoteSubjects)
    && batchQuote.quotes.every((quote) => quoteProvesEvmMarketVenue(marketVenue, quote));
  const batchQuoteAggregate = batchQuoteReady && batchQuote.kind === 'quoted'
    ? aggregateEvmBatchQuotes(batchQuote.quotes)
    : null;
  const batchSellBalanceUnknown = batchMode
    && side === 'sell'
    && selectedTokenBalances === null;
  const batchInsufficient = batchMode
    && batchChildAmounts !== null
    && selectedWallets.some((wallet) => {
      const amount = batchChildAmounts[wallet.wallet_account_id];
      if (amount === undefined) return true;
      if (side === 'sell') {
        const balance = selectedTokenBalances?.[wallet.wallet_account_id];
        return balance === undefined || BigInt(amount) > BigInt(balance);
      }
      // Same unchecked case as `insufficient`'s token-quoted buy arm: with no
      // balance for the quote ERC-20 there is nothing to compare, so this is
      // "unknown", not "affordable". `evm-buy-balance-unknown` says so.
      return quoteAssetAddress === null
        && wallet.wei !== null
        && BigInt(amount) > BigInt(wallet.wei);
    });
  const batchGasTight = batchMode
    && side === 'buy'
    && quoteAssetAddress === null
    && batchChildAmounts !== null
    && selectedWallets.some((wallet) => {
      const amount = batchChildAmounts[wallet.wallet_account_id];
      if (amount === undefined || wallet.wei === null) return false;
      const required = maxBuyRequiredBalanceWei(BigInt(amount), chain);
      return required !== null && required > BigInt(wallet.wei);
    });
  const batchSubmitBlocked = batchSubmitState.kind === 'submitting'
    || batchSubmitState.kind === 'recovering'
    || batchSubmitState.kind === 'reorged';

  const singleCanSubmit =
    blockedReason === null &&
    selected !== null &&
    parsed.kind === 'ok' &&
    slippageBps !== null &&
    !insufficient &&
    !gasTight &&
    !overWireDomain &&
    quoteReady &&
    !batchSubmitBlocked &&
    !activeBatchSubmit.current &&
    // The CTA stays disabled behind an unknown outcome. This is the button
    // half of the money-safety contract: a fresh click can mint another id,
    // and an enabled button would invite exactly that before reconciliation.
    !evmSubmitStateBlocksNewOrder(submitState);
  const batchCanSubmit =
    blockedReason === null
    && batchMode
    && parsed.kind === 'ok'
    && slippageBps !== null
    && batchChildAmounts !== null
    && !batchSellBalanceUnknown
    && !batchInsufficient
    && !batchGasTight
    && !overWireDomain
    && batchQuoteReady
    && batchQuoteAggregate !== null
    && !batchSubmitBlocked
    && !evmSubmitStateBlocksNewOrder(submitState);
  const canSubmit = batchMode ? batchCanSubmit : singleCanSubmit;

  const submit = useCallback(async () => {
    if (batchMode || parsed.kind !== 'ok' || selected === null || slippageBps === null) return;
    // Re-check at the click boundary. The expiry timer drives the visible
    // state, but browser timers can be delayed in a background tab.
    if (
      !isCurrentEvmServedQuote(
        servedQuote.kind === 'quoted' ? servedQuote : null,
        {
          chain,
          token: address,
          walletAccountId: selected.wallet_account_id,
          side,
          amountBaseUnits: parsed.baseUnits.toString(),
          quoteAssetAddress,
          slippageBps,
          marketVenue,
        },
        Date.now(),
      )
      || (
        servedQuote.kind === 'quoted'
        && !quoteProvesEvmMarketVenue(marketVenue, servedQuote)
      )
    ) {
      return;
    }
    // Built by a pure exported function so the field-name/units decision is
    // unit-tested rather than verified by eye in a component. The id is
    // filled in below, once the fingerprint has decided whether a held one
    // still describes THIS order.
    const shape: EvmOrderRequest = buildEvmOrderBody({
      clientOrderId: '',
      chain,
      side,
      token: address,
      walletAccountId: selected.wallet_account_id,
      baseUnits: parsed.baseUnits,
      quoteAssetAddress,
      slippageBps,
      clientTsMs: Date.now(),
    });
    const fingerprint = evmOrderFingerprint(shape);
    const held = inFlightOrder.current;
    const clientOrderId =
      held !== null && held.fingerprint === fingerprint
        ? held.id
        : (newClientOrderId ?? defaultClientOrderId)();
    inFlightOrder.current = { id: clientOrderId, fingerprint };
    watchedOrder.current = {
      id: clientOrderId,
      fingerprint,
      txHash: null,
      walletAccountId: selected.wallet_account_id,
      walletAddress: selected.wallet_pubkey,
    };
    setWatchedClientOrderId(clientOrderId);
    setWatchedWalletAddress(selected.wallet_pubkey);
    const storage = browserEvmOrderStorage();
    if (
      storage === null ||
      !writePendingEvmOrder(storage, {
        chain,
        token: address,
        clientOrderId,
        fingerprint,
        walletAccountId: selected.wallet_account_id,
        walletAddress: selected.wallet_pubkey,
      })
    ) {
      inFlightOrder.current = null;
      watchedOrder.current = null;
      setWatchedClientOrderId(null);
      setWatchedWalletAddress(null);
      setSubmitState({
        kind: 'refused',
        code: 'durable_storage_unavailable',
        text: 'This browser cannot preserve the order correlation id, so the order was not submitted. Enable site storage and try again.',
      });
      return;
    }
    setSubmitState({ kind: 'submitting' });
    const body: EvmOrderRequest = { ...shape, client_order_id: clientOrderId };

    const authToken = await resolveOrderAuthToken(async () => {
      const session = (
        globalThis as { Clerk?: { session?: { getToken: () => Promise<string | null> } | null } }
      ).Clerk?.session;
      return session === undefined || session === null ? null : session.getToken();
    });

    const send = submitImpl ?? submitEvmOrder;
    let result: EvmOrderResult = await send(body, { authToken });
    // ONE bounded retry, and only for refusals the api answers strictly
    // before intake. Same body, same key — see orderApi's header.
    if (result.kind === 'refused' && isEvmRefusalRetryable(result)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      result = await send(body, { authToken });
    }

    switch (result.kind) {
      case 'accepted':
        watchedOrder.current = {
          id: clientOrderId,
          fingerprint,
          txHash: result.ack.txHash,
          walletAccountId: selected.wallet_account_id,
          walletAddress: selected.wallet_pubkey,
        };
        setSubmitState(submitStateForAcceptedEvmOrder(result.ack));
        setAmountText('');
        onOrderTransition?.();
        return;
      case 'reauth':
        inFlightOrder.current = null;
        watchedOrder.current = null;
        setWatchedClientOrderId(null);
        setWatchedWalletAddress(null);
        if (storage !== null) clearPendingEvmOrder(storage, { chain, clientOrderId });
        setSubmitState({ kind: 'reauth' });
        return;
      case 'refused':
        // A 502 that bundles an engine TIMEOUT is not a refusal, whatever its
        // status line says — the engine may have signed and broadcast before
        // the socket died, and the gateway does not tell us which transport
        // failure it was. Route it to the may-be-live surface, which offers
        // no retry, rather than to the refusal line, which reads as "nothing
        // happened". See `isEvmRefusalPossiblyLive`.
        if (isEvmRefusalPossiblyLive(result)) {
          setSubmitState({
            kind: 'may_be_live',
            reason: evmRefusalText(result),
            source: 'server',
          });
          return;
        }
        inFlightOrder.current = null;
        watchedOrder.current = null;
        setWatchedClientOrderId(null);
        setWatchedWalletAddress(null);
        if (storage !== null) clearPendingEvmOrder(storage, { chain, clientOrderId });
        setSubmitState({
          kind: 'refused',
          text: evmRefusalText(result),
          code: result.errorCode,
        });
        return;
      case 'may_be_live':
        // The server's own 202. The held key is retained (not cleared) so
        // that IF the user later chooses to act, the correlation id is
        // unchanged — but nothing here offers them that choice.
        setSubmitState({ kind: 'may_be_live', reason: result.reason, source: 'server' });
        return;
      case 'indeterminate':
        // Our POST never completed. Same user-facing meaning as the 202: the
        // request may have dispatched, so reconcile before any fresh click.
        setSubmitState({ kind: 'may_be_live', reason: result.reason, source: 'transport' });
    }
  }, [
    parsed,
    selected,
    slippageBps,
    chain,
    side,
    address,
    quoteAssetAddress,
    submitImpl,
    newClientOrderId,
    onOrderTransition,
    servedQuote,
    batchMode,
    marketVenue,
  ]);

  const submitBatch = useCallback(async () => {
    if (
      !batchMode
      || parsed.kind !== 'ok'
      || slippageBps === null
      || batchChildAmounts === null
      || batchQuote.kind !== 'quoted'
      || !isCurrentEvmBatchQuotes(batchQuote.quotes, batchQuoteSubjects, Date.now())
      || !isSameEvmBatchQuoteSubjects(batchQuote.subjects, batchQuoteSubjects)
      || !batchQuote.quotes.every((quote) => quoteProvesEvmMarketVenue(marketVenue, quote))
      || aggregateEvmBatchQuotes(batchQuote.quotes) === null
      || batchSellBalanceUnknown
      || batchInsufficient
      || batchGasTight
      || batchSubmitBlocked
      || activeBatchSubmit.current
      || blockedReason !== null
    ) return;

    activeBatchSubmit.current = true;

    const clientParentId = (newClientParentId ?? defaultClientOrderId)();
    const common = {
      chain: chain as 'bsc' | 'robinhood_chain',
      clientParentId,
      walletAccountIds: selectedWalletIds,
      token: address,
      maxSlippageBps: slippageBps,
      clientTsMs: Date.now(),
    } as const;
    const input: EvmBatchOrderInput = side === 'buy'
      ? {
          ...common,
          side: 'buy',
          totalBaseUnits: parsed.baseUnits.toString(),
          quoteAssetAddress,
        }
      : batchSellPercent !== null
          && batchSellPercent.walletSubject === selectedWalletSubject
          && selectedTokenBalances !== null
        ? {
            ...common,
            side: 'sell',
            sellPercentBps: batchSellPercent.bps,
            sellTokenBalanceHints: selectedTokenBalances,
          }
        : {
            ...common,
            side: 'sell',
            sellTokensInByWallet: batchChildAmounts,
          };
    const built = buildEvmBatchOrderBody(input);
    if (built.kind !== 'ok') {
      activeBatchSubmit.current = false;
      setBatchSubmitState({ kind: 'refused', code: 'invalid_input', text: built.reason });
      return;
    }
    const pending: PendingEvmBatchOrder = {
      input,
      fingerprint: evmBatchOrderFingerprint(built.body),
    };
    const storage = browserEvmOrderStorage();
    if (storage === null || !writePendingEvmBatchOrder(storage, pending)) {
      activeBatchSubmit.current = false;
      setBatchSubmitState({
        kind: 'refused',
        code: 'durable_storage_unavailable',
        text: 'This browser cannot preserve the batch parent key, so no order was submitted. Enable site storage and try again.',
      });
      return;
    }
    inFlightBatch.current = pending;
    setBatchSubmitState({ kind: 'submitting' });
    const authToken = await resolveOrderAuthToken(async () => {
      const session = (
        globalThis as { Clerk?: { session?: { getToken: () => Promise<string | null> } | null } }
      ).Clerk?.session;
      return session === undefined || session === null ? null : session.getToken();
    });
    const send = submitBatchImpl ?? submitEvmBatchOrder;
    const result: EvmBatchOrderResult = await send(input, { authToken });
    switch (result.kind) {
      case 'ok':
      case 'partial_failed':
      case 'failed':
      case 'cancelled':
      case 'in_flight':
      case 'unknown_outcome':
      case 'shape_mismatch':
        setBatchSubmitState({
          kind: 'recovering',
          detail: result.kind === 'unknown_outcome'
            ? 'The POST outcome is unknown. No retry is being sent; the original parent key is being reconciled.'
            : result.kind === 'shape_mismatch'
              ? 'The POST response could not be proven, so the original parent key is being reconciled before any new order.'
              : 'Batch accepted. Waiting for durable finalized child results.',
          children: 'children' in result
            ? result.children.map((child) => `${child.walletAccountId.slice(0, 8)}: ${child.state}`)
            : [],
        });
        setAmountText('');
        setBatchSellPercent(null);
        onOrderTransition?.();
        return;
      case 'reauth':
        clearPendingEvmBatchOrder(storage, input);
        inFlightBatch.current = null;
        activeBatchSubmit.current = false;
        setBatchSubmitState({ kind: 'reauth' });
        return;
      case 'refused':
      case 'invalid_input':
        clearPendingEvmBatchOrder(storage, input);
        inFlightBatch.current = null;
        activeBatchSubmit.current = false;
        setBatchSubmitState({
          kind: 'refused',
          code: result.kind === 'refused' ? result.errorCode : 'invalid_input',
          text: result.kind === 'refused' ? result.message : result.reason,
        });
    }
  }, [
    address,
    batchChildAmounts,
    batchGasTight,
    batchInsufficient,
    batchMode,
    batchQuote,
    batchQuoteSubjects,
    batchSellBalanceUnknown,
    batchSellPercent,
    batchSubmitBlocked,
    blockedReason,
    chain,
    marketVenue,
    newClientParentId,
    onOrderTransition,
    parsed,
    quoteAssetAddress,
    selectedTokenBalances,
    selectedWalletIds,
    selectedWalletSubject,
    side,
    slippageBps,
    submitBatchImpl,
  ]);

  const receiveSymbol = side === 'buy' ? tokenSymbol : (quoteSymbol ?? 'quote token');
  /**
   * The scale the ESTIMATE is rendered at — the mirror of `orderScale`.
   *
   * A buy spends native and receives TOKENS, so the figure a buyer reads is
   * the one that needs the token's scale; a sell is the other way round. This
   * was `EVM_TOKEN_DECIMALS` on the buy leg, which put "≈ 1,000 tokens" in
   * front of a user who was about to receive a billion of them, or a
   * millionth of one.
   *
   * `unknown` here does NOT block the buy — the amount spent is exact in
   * native either way. It only withholds the estimate, which is the correct
   * trade: an unquantified receipt is a smaller loss than a confidently wrong
   * one.
   */
  const quoteScale = resolveOrderScale({
    side: 'buy',
    measuredTokenDecimals: tokenDecimals,
    decimalsAbsentText: tokenDecimalsAbsentText,
    nativeSymbol,
    quoteIsNative,
    quoteDecimals,
    quoteSymbol,
  });
  const receiveScale = side === 'buy' ? tokenScale : quoteScale;
  const activePlatformFeeAsset = batchQuoteAggregate?.platformFeeAsset
    ?? (quoteReady && servedQuote.kind === 'quoted' ? servedQuote.platformFeeAsset : null);
  const activePlatformFeeBaseUnits = batchQuoteAggregate?.platformFeeBaseUnits
    ?? (quoteReady && servedQuote.kind === 'quoted'
      ? BigInt(servedQuote.platformFeeBaseUnits)
      : null);
  const platformFeeScale =
    activePlatformFeeAsset?.kind === 'native'
      ? ({ kind: 'known', decimals: EVM_NATIVE_DECIMALS } as const)
      : quoteScale;
  const platformFeeSymbol =
    activePlatformFeeAsset !== null
      ? evmQuoteAssetDisplayLabel(activePlatformFeeAsset, nativeSymbol, quoteSymbol)
      : null;

  /* The served quote's figures as bigints. The parser admitted only decimal
     digit strings, so `BigInt` cannot throw here — and the amounts stay
     integers end to end. */
  const servedReceive =
    batchQuoteAggregate?.expectedOut
    ?? (quoteReady && servedQuote.kind === 'quoted' ? BigInt(servedQuote.expectedOut) : null);
  const servedMinimum =
    batchQuoteAggregate?.minAmountOut
    ?? (quoteReady && servedQuote.kind === 'quoted' ? BigInt(servedQuote.minAmountOut) : null);
  const servedVenue = batchQuoteAggregate?.venueLabel
    ?? (quoteReady && servedQuote.kind === 'quoted' ? servedQuote.venue : null);
  const servedRouteMode =
    batchQuoteAggregate?.routeLabel
    ?? (quoteReady && servedQuote.kind === 'quoted' ? servedQuote.routeMode : null);

  /**
   * THE TICKER THE AMOUNT BOX IS DENOMINATED IN — or `null` when the panel
   * cannot name one, which is a state the label used to have no way to express.
   *
   * A buy is a count of the MONEY leg, and the money leg is only the chain's
   * own coin when `quoteIsNative`. On a stock-quoted market it is not, and
   * `resolveOrderScale` refuses the buy for exactly that reason — but the box
   * above the refusal still read `Amount (BNB)`, the button still said `Buy
   * with BNB`, and the presets still wrote BNB figures into a box that could
   * not parse them. Three assertions of BNB stacked on top of a paragraph
   * saying the money leg is not BNB. The refusal was right; the labels were
   * the lie. `null` means: we will not name a unit we cannot name.
   */
  const amountSymbol: string | null = side === 'buy' ? quoteSymbol : tokenSymbol;

  /**
   * The sentence under the estimate rows, or `null` for SILENCE.
   *
   * It used to branch on `estimate === null`, which is true whenever the
   * amount box is EMPTY — so the market diagnosis below ("no price can be
   * computed for this token") was the default state of every EVM trade page,
   * including tokens with a perfectly good price, before the user typed a
   * character. A missing estimate has three causes and only ONE of them is a
   * fact about the market; the other two are facts about the input, and the
   * input already has its own error lines. So the market sentence branches on
   * `price === null` and nothing else, and an empty or invalid amount says
   * nothing rather than diagnosing a market it knows nothing about.
   */
  const estimateNote: string | null =
    price === null
      ? /* DEPTH UNKNOWN IS NOT DEPTH ZERO, and the two reasons a price is
           missing are different enough that collapsing them misleads.
           `the ingestion service` omits the reserve KEYS entirely rather than sending
           0 (the backend source, pinned by its own
           `unmeasured_reserves_are_absent_not_zero` test), and it does so both
           for a token nobody has traded yet AND for a concentrated-liquidity
           pool whose depth it deliberately WITHHOLDS (the backend source
           — the derived virtual reserves are counted and dropped, because a V3
           `liquidity` word is in-range depth, not the book). The wire cannot
           tell the terminal which case it is, so the terminal must not pretend
           to know. What it can say with certainty is the part that protects the
           user: there is no estimate, and that is not an estimate of zero. */
        'No price can be computed for this token. Either it has not traded yet, or its pool is a concentrated-liquidity market whose true depth this indexer deliberately does not publish. This is NOT a price of zero and NOT an empty pool — it is unknown. You can still place an order; the order engine reads live reserves itself and will refuse rather than fill blind.'
      : estimate === null
        ? null
        : receiveScale.kind !== 'known'
          ? /* A PRICE EXISTS AND THE ESTIMATE IS STILL WITHHELD, which is the
               one combination worth spelling out. The arithmetic is fine —
               `estimateBuy` works entirely in base units and never needed a
               scale — but the ANSWER is a count of base units, and rendering
               that as a token quantity takes a scale nobody measured. So the
               figure above is an em dash for a reason that has nothing to do
               with the market, and saying which keeps it from reading as "this
               token has no price". */
            `The price is known, but the number of ${tokenSymbol} it works out to cannot be shown: ${receiveScale.why} Your spend is still exact — the order engine computes the binding minimum itself, in base units, against live reserves at signing time.`
          : `Estimate at the ${estimate.source} price. It excludes price impact and venue fees, so the fill is at or below it. The binding minimum is computed by the order engine against live reserves at signing time.`;

  return (
    <section
      aria-label="Trade panel"
      data-testid="evm-trade-panel"
      data-side={side}
      className="flex w-full flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1" role="tablist" aria-label="Order side">
          {(['buy', 'sell'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={side === value}
              onClick={() => setSide(value)}
              data-testid={`evm-side-${value}`}
              className={
                side === value
                  ? 'rounded bg-primary px-2 py-1 text-sm font-semibold text-primary-foreground'
                  : 'rounded bg-muted px-2 py-1 text-sm text-muted-foreground'
              }
            >
              {value === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
        {walletsState.kind === 'ready' && walletsState.wallets.length > 0 && (
          <div className="hidden lg:block">
            <WalletCountButton
              count={selectedWallets.length}
              testIdPrefix="evm-wallet-count"
              popoverContent={(
                <EvmMultiWalletSelector
                  wallets={walletsState.wallets}
                  selectedIds={selectedWallets.map((wallet) => wallet.wallet_account_id)}
                  maxWallets={maxWallets}
                  nativeSymbol={nativeSymbol}
                  tokenSymbol={tokenSymbol}
                  tokenDecimals={tokenDecimals}
                  tokenBalances={tokenBalances}
                  onSelect={selectWallets}
                />
              )}
            />
          </div>
        )}
      </div>

      <div className="lg:hidden">
        <WalletSelect
          state={walletsState}
          selectedId={selected?.wallet_account_id ?? null}
          onSelect={selectWallet}
          nativeSymbol={nativeSymbol}
        />
      </div>

      {hasAdvancedMode ? (
        <div className="seg hidden lg:flex" role="tablist" aria-label="Order type">
          <button
            type="button"
            role="tab"
            aria-selected={orderType === 'market'}
            className={`seg__btn ${orderType === 'market' ? 'active' : ''}`}
            data-testid="evm-order-type-market"
            onClick={() => setOrderType('market')}
          >
            Market
          </button>
          {desktopAdvancedModes.limit ? (
            <button
              type="button"
              role="tab"
              aria-selected={orderType === 'limit'}
              className={`seg__btn ${orderType === 'limit' ? 'active' : ''}`}
              data-testid="evm-order-type-limit"
              onClick={() => setOrderType('limit')}
            >
              Limit
            </button>
          ) : null}
          {desktopAdvancedModes.recurring ? (
            <button
              type="button"
              role="tab"
              aria-selected={orderType === 'recurring'}
              className={`seg__btn ${orderType === 'recurring' ? 'active' : ''}`}
              data-testid="evm-order-type-recurring"
              onClick={() => setOrderType('recurring')}
            >
              Adv.
            </button>
          ) : null}
        </div>
      ) : null}

      {orderType === 'market' ? (
        <>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {amountSymbol === null ? 'Amount' : `Amount (${amountSymbol})`}
        <span className="flex items-center gap-2 rounded border px-2 py-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amountText}
            onChange={(event) => {
              setAmountText(event.target.value);
              setBatchSellPercent(null);
            }}
            data-testid="evm-trade-amount"
            aria-label={amountSymbol === null ? 'Amount' : `Amount in ${amountSymbol}`}
            className="w-full bg-transparent text-sm outline-none"
          />
          {/* `whitespace-nowrap` because the ticker is not always a ticker: an
              unnamed token falls back to a shortened address, and the browser
              broke `0x1111…1111` at the ellipsis into two lines inside a 320px
              column. `shrink-0` keeps that from being solved by squeezing the
              input instead. */}
          {amountSymbol !== null && (
            <span
              className="shrink-0 whitespace-nowrap text-xs font-semibold"
              data-testid="evm-trade-amount-unit"
            >
              {amountSymbol}
            </span>
          )}
        </span>
      </label>

      {side === 'buy' ? (
        <div className="flex flex-wrap gap-1">
          {/* A PRESET WRITES AN AMOUNT INTO THE BOX, so it is live only when
              the box can be parsed. On a stock-quoted market `resolveOrderScale`
              refuses the buy and `parsed` is pinned to `empty`, so an enabled
              `0.05 BNB` button wrote a figure nothing downstream would read —
              a control that visibly does nothing, one paragraph above the
              sentence saying why it cannot work. Disabled, carrying the same
              reason on `title` that the sell presets already carry. */}
          {BUY_PRESETS.map((preset) => (
            <PresetButton
              key={preset}
              label={`${preset} ${quoteSymbol ?? 'quote'}`}
              testId={`evm-preset-${preset}`}
              disabled={orderScale.kind !== 'known'}
              title={orderScale.kind === 'known' ? undefined : orderScale.why}
              onClick={() => {
                if (orderScale.kind !== 'known') return;
                setAmountText(preset);
              }}
            />
          ))}
          {maxBuyBaseUnits > 0n && (
            <PresetButton
              label="MAX"
              testId="evm-preset-max"
              disabled={orderScale.kind !== 'known'}
              title={
                orderScale.kind === 'known'
                  ? 'Uses the largest spend that still covers the 1% platform fee and worst-case gas authority.'
                  : orderScale.why
              }
              onClick={() => {
                if (orderScale.kind !== 'known') return;
                setAmountText(
                  baseUnitsToInputText(maxBuyBaseUnits, EVM_NATIVE_DECIMALS),
                );
              }}
            />
          )}
          {/* THE BUY-SIDE BALANCE UNKNOWN — the twin of
              `evm-sell-balance-unknown`, and the slot that was empty.
              On a token-quoted market the money leg is an ERC-20 this panel
              holds NO balance for: the wallet read carries native wei
              (`selected.wei`) and the page token (`tokenBalances`), and
              nothing else. So `insufficient` returns false for every
              token-quoted buy — not because the wallet can cover it, but
              because there is nothing to compare against — and an empty slot
              under an enabled button reads as "this is funded".

              A DISCLOSURE, NOT A REFUSAL. An unknown balance is not an
              insufficient one; refusing here would take away a buy the wallet
              may well be able to make, and the engine re-reads the real
              balance before it spends anything. The sell side has drawn this
              distinction since it had presets to disable.

              Gated on a KNOWN scale for the same reason the sell twin is:
              when the scale is unknown `blockedReason` already prints its own
              paragraph, and one refusal gets one slot. */}
          {quoteAssetAddress !== null && orderScale.kind === 'known' && (
            <span
              className="text-[10px] text-muted-foreground"
              data-testid="evm-buy-balance-unknown"
            >
              {`Your balance of ${quoteSymbol ?? 'this market’s quote token'} has not been read, `
                + 'so this panel cannot tell you whether this order is funded. Each buy also '
                + `needs ${nativeSymbol} for gas on top of the spend.`}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {/* A PERCENTAGE PRESET IS THE SAME SIZING DECISION AS A TYPED
              AMOUNT, so it reads the same `orderScale`. It used to write its
              text at `EVM_TOKEN_DECIMALS` while the box that text lands in
              would soon be parsed at whatever scale the panel believed — one
              bug wearing two hats, and the preset half is the one a user
              trusts most because they did not do the arithmetic.

              TWO independent preconditions, both required and neither
              substitutable for the other: a BALANCE to take a percentage of,
              and a SCALE to express the result in. */}
          {SELL_PRESET_BPS.map((bps) => (
            <PresetButton
              key={bps}
              label={`${bps / 100}%`}
              testId={`evm-preset-${bps}`}
              disabled={
                orderScale.kind !== 'known'
                || (batchMode ? selectedTokenBalances === null : tokenBalanceUnits === null)
                || (
                  batchMode
                  && selectedTokenBalances !== null
                  && selectedWalletIds.some((walletId) => (
                    percentOf(BigInt(selectedTokenBalances[walletId]!), bps) === 0n
                  ))
                )
              }
              title={
                orderScale.kind !== 'known'
                  ? orderScale.why
                  : batchMode && selectedTokenBalances === null
                    ? 'Every selected wallet needs an exact token balance for a percentage batch sell.'
                    : batchMode && selectedTokenBalances !== null
                      && selectedWalletIds.some((walletId) => (
                        percentOf(BigInt(selectedTokenBalances[walletId]!), bps) === 0n
                      ))
                      ? 'This percentage would produce a zero-sized child for at least one selected wallet.'
                    : !batchMode && tokenBalanceUnits === null
                    ? tokenBalance.kind === 'unknown'
                      ? tokenBalance.why
                      : 'Balance unavailable'
                    : undefined
              }
              onClick={() => {
                if (orderScale.kind !== 'known') return;
                if (batchMode) {
                  if (selectedTokenBalances === null) return;
                  const total = selectedWalletIds.reduce((sum, walletId) => (
                    sum + percentOf(BigInt(selectedTokenBalances[walletId]!), bps)
                  ), 0n);
                  if (total <= 0n) return;
                  setBatchSellPercent({ bps, walletSubject: selectedWalletSubject });
                  setAmountText(baseUnitsToInputText(total, orderScale.decimals));
                  return;
                }
                if (tokenBalanceUnits === null) return;
                setBatchSellPercent(null);
                setAmountText(baseUnitsToInputText(
                  percentOf(tokenBalanceUnits, bps),
                  orderScale.decimals,
                ));
              }}
            />
          ))}
          {/* An unknown SCALE, stated where the presets it disabled are. This
              is a different unknown from the balance below — we may know
              exactly how many base units the wallet holds and still not know
              what one base unit is worth as a quantity. */}
          {orderScale.kind !== 'known' && (
            <span
              className="text-[10px] text-muted-foreground"
              data-testid="evm-sell-scale-unknown"
            >
              {orderScale.why}
            </span>
          )}
          {/* An unknown balance is stated, not rendered as 0 with a live
              "100%" button that would submit a zero-token sell. */}
          {orderScale.kind === 'known'
            && (batchMode ? selectedTokenBalances === null : tokenBalanceUnits === null) && (
            <span
              className="text-[10px] text-muted-foreground"
              data-testid="evm-sell-balance-unknown"
            >
              {/* NOTHING IS APPENDED HERE. `resolveSellBalance`'s partial-page
                  reason already ends "…so the presets are unavailable. Type an
                  amount instead.", and a second copy tacked on by the panel
                  rendered that sentence twice in a row on screen. `sizing.ts`
                  owns the wording of its own refusals. */}
              {batchMode
                ? 'Every selected wallet needs an exact token balance for percentage sizing.'
                : tokenBalance.kind === 'unknown' ? tokenBalance.why : 'Balance unavailable'}
            </span>
          )}
        </div>
      )}

      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Max slippage (bps)</span>
        <input
          type="text"
          inputMode="numeric"
          value={slippageText}
          onChange={(event) => setSlippageText(event.target.value)}
          data-testid="evm-trade-slippage"
          aria-label="Max slippage in basis points"
          className="w-20 rounded border bg-transparent px-2 py-1 text-right text-sm outline-none"
        />
      </label>
      {slippageBps === null && (
        <p className="text-xs" style={{ color: 'var(--negative, #e05260)' }}>
          Slippage must be a whole number between {MIN_SLIPPAGE_BPS} and {MAX_SLIPPAGE_BPS} basis
          points.
        </p>
      )}

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {/* SERVED BEATS ESTIMATED, AND SAYS WHICH IT IS. When the engine's
            quote has landed, both figures below are ITS answer (the minimum
            is the floor an identical order binds); until then the client
            estimate holds the slot, labelled as the instant estimate it is.
            The scale rule is unchanged: an unknown receive scale withholds
            BOTH figures — a served count of base units rendered at a guessed
            scale is exactly as wrong as an estimated one. */}
        <div className="flex items-baseline justify-between gap-2">
          <span>
            Estimated {side === 'buy' ? 'tokens' : (quoteSymbol ?? 'quote')}{' '}
            <span className="text-[10px]" data-testid="evm-trade-quote-source">
              {servedReceive !== null
                ? `(engine quote · ${servedVenue} / ${servedRouteMode})`
                : (batchMode ? batchQuote.kind === 'loading' : servedQuote.kind === 'loading')
                  ? batchMode
                    ? '(non-executable estimate - child quotes loading...)'
                    : '(non-executable estimate - engine quote loading...)'
                  : '(non-executable instant estimate)'}
            </span>
          </span>
          <span className="tabular-nums" data-testid="evm-trade-quote">
            {receiveScale.kind !== 'known'
              ? '—'
              : servedReceive !== null
                ? `≈ ${formatBigIntUnits(servedReceive, receiveScale.decimals, 4)} ${receiveSymbol}`
                : estimate === null
                  ? '—'
                  : `≈ ${formatBigIntUnits(estimate.receive, receiveScale.decimals, 4)} ${receiveSymbol}`}
          </span>
        </div>
        {(quoteReady || batchQuoteReady) &&
          activePlatformFeeBaseUnits !== null &&
          platformFeeScale.kind === 'known' &&
          platformFeeSymbol !== null && (
          <div className="flex items-baseline justify-between gap-2">
            <span>Estimated platform fee</span>
            <span className="tabular-nums" data-testid="evm-trade-platform-fee">
              {formatBigIntUnits(
                activePlatformFeeBaseUnits,
                platformFeeScale.decimals,
                4,
              )}{' '}
              {platformFeeSymbol}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span>
            Minimum at {slippageBps === null ? '—' : `${slippageBps / 100}%`} slippage{' '}
            <span className="text-[10px]" data-testid="evm-trade-minimum-source">
              {servedMinimum !== null ? '(engine, binding)' : '(non-executable client estimate)'}
            </span>
          </span>
          <span className="tabular-nums" data-testid="evm-trade-minimum">
            {receiveScale.kind !== 'known'
              ? '—'
              : servedMinimum !== null
                ? `${formatBigIntUnits(servedMinimum, receiveScale.decimals, 4)} ${receiveSymbol}`
                : estimate === null
                  ? '—'
                  : `${formatBigIntUnits(estimate.minimum, receiveScale.decimals, 4)} ${receiveSymbol}`}
          </span>
        </div>
        {(batchMode ? batchQuote.kind === 'refused' : servedQuote.kind === 'refused') && (
          /* The ENGINE's refusal, as the product state it is — migrating
             freeze, not-warm, unsupported market — never a generic error.
             Warning tone, not destructive: nothing failed, the engine
             answered. Submission stays available; the engine re-quotes at
             execution and refuses there if it still must. */
          <p
            className="text-[10px]"
            data-testid="evm-trade-quote-refused"
            data-refused={
              batchMode
                ? 'batch_child_refused'
                : servedQuote.kind === 'refused' ? servedQuote.refused : undefined
            }
            style={{ color: 'var(--warning, #d99a2b)' }}
          >
            {batchMode
              ? batchQuote.kind === 'refused' ? batchQuote.text : ''
              : servedQuote.kind === 'refused' ? servedQuote.text : ''}
          </p>
        )}
        {(batchMode ? batchQuote.kind === 'note' : servedQuote.kind === 'note') && (
          /* This CLIENT failing to obtain a quote — a different claim from a
             refusal, and worded as one. */
          <p className="text-[10px]" data-testid="evm-trade-quote-note">
            {batchMode
              ? batchQuote.kind === 'note' ? batchQuote.text : ''
              : servedQuote.kind === 'note' ? servedQuote.text : ''}
          </p>
        )}
        {(batchMode
          ? batchQuote.kind === 'refused' || batchQuote.kind === 'note'
          : servedQuote.kind === 'refused' || servedQuote.kind === 'note') && (
          <button
            type="button"
            className="self-start text-[10px] underline underline-offset-2"
            data-testid="evm-trade-quote-retry"
            onClick={refreshQuote}
          >
            Retry quote
          </button>
        )}
        {estimateNote !== null && (
          <p className="text-[10px]" data-testid="evm-trade-estimate-note">
            {estimateNote}
          </p>
        )}
        {/* THE DENOMINATION CAVEAT. `the ingestion service` publishes no pair-token
            field on any payload (the backend source), and its own config says why
            that matters (the backend source): "Pons v2 LAUNCHES carry their
            own pairToken, which is usually the ZERO ADDRESS (native ETH …)
            and is sometimes a Robinhood STOCK TOKEN — the capture holds
            launches quoted in NVDA and SPY." The terminal maps chain → symbol
            and cannot do better, so it discloses rather than asserts.

            The split below is the precise one, not a blanket hedge: the SPEND
            side is genuinely the chain's native coin (the wire field is
            `native_in_wei`, wei of the chain's own asset), so the button and
            the amount box are exact. It is only the PRICE and RESERVE figures,
            which are denominated in whatever the pool is paired against, that
            carry the assumption. */}
        {estimate !== null && (
          <p className="text-[10px]" data-testid="evm-trade-denomination-note">
            This market is quoted in {quoteSymbol ?? 'an identified quote token'}. Amounts,
            estimates, the binding minimum, and the served fee use that same measured money-leg
            scale; the contract address, not this display label, binds the order.
          </p>
        )}
      </div>

      {!batchMode && insufficient && (
        <p
          className="text-xs"
          data-testid="evm-trade-insufficient"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          That is more than this wallet holds
          {side === 'buy' ? ' — and a buy also needs gas on top of the spend.' : '.'}
        </p>
      )}
      {batchMode && batchInsufficient && (
        <p
          className="text-xs"
          data-testid="evm-trade-insufficient"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          At least one selected wallet cannot cover its exact child amount. Each buy also needs
          gas on top of its spend.
        </p>
      )}
      {!batchMode && gasTight && (
        <p
          className="text-xs"
          data-testid="evm-trade-gas-tight"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          This amount does not leave enough {nativeSymbol} for the 1% platform fee and worst-case
          gas authority. Reduce it or use MAX.
        </p>
      )}
      {batchMode && batchGasTight && (
        <p
          className="text-xs"
          data-testid="evm-trade-gas-tight"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          At least one selected wallet would not retain enough {nativeSymbol} for the 1% platform
          fee and worst-case gas authority. Reduce the total.
        </p>
      )}
      {batchSellBalanceUnknown && (
        <p className="text-xs text-muted-foreground" data-testid="evm-batch-balance-unknown">
          Every selected wallet needs an exact on-chain token balance before a batch sell can be
          sized or quoted.
        </p>
      )}
      {overWireDomain && (
        <p
          className="text-xs"
          data-testid="evm-trade-over-domain"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          That amount is larger than the order service can carry (at most{' '}
          {side === 'buy' ? MAX_WEI_DIGITS : 40} digits of base units).
        </p>
      )}
      {parsed.kind === 'invalid' && (
        <p
          className="text-xs"
          data-testid="evm-trade-amount-invalid"
          style={{ color: 'var(--negative, #e05260)' }}
        >
          {parsed.reason}
        </p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        onClick={() => void (batchMode ? submitBatch() : submit())}
        data-testid="evm-trade-submit"
        title={
          blockedReason ??
          (parsed.kind === 'ok' && !(batchMode ? batchQuoteReady : quoteReady)
            ? batchMode
              ? 'A fresh wallet-bound engine quote is required for every batch child.'
              : 'A current engine quote is required before submission.'
            : undefined)
        }
        className={
          canSubmit
            ? 'rounded bg-primary px-2 py-1.5 text-sm font-semibold text-primary-foreground'
            : 'rounded bg-muted px-2 py-1.5 text-sm font-semibold text-muted-foreground disabled:cursor-not-allowed'
        }
      >
        {/* `Buy with BNB` is only true when the money leg IS BNB. On a
            stock-quoted market it is not, and the button said it anyway,
            directly under the paragraph explaining that it is not. With no
            nameable denomination the verb stands alone. */}
        {submitState.kind === 'submitting' || batchSubmitState.kind === 'submitting'
          ? 'Sending…'
          : side === 'buy'
            ? amountSymbol === null
              ? 'Buy'
              : `Buy with ${amountSymbol}${batchMode ? ` across ${selectedWalletIds.length} wallets` : ''}`
            : `Sell for ${receiveSymbol}${batchMode ? ` across ${selectedWalletIds.length} wallets` : ''}`}
      </button>

      <p className="text-[10px] text-muted-foreground" data-testid="evm-order-scope-note">
        Market orders support one wallet or exact equal-split multi-wallet batches. Advanced
        orders use one selected wallet. Distribute/consolidate remains unavailable until its EVM
        contract exists. Quick-buy is available from Discover rows once an amount is configured.
      </p>

      {/* ONE SLOT PER REFUSAL. On the sell side an unknown scale is already
          printed by `evm-sell-scale-unknown`, inline beside the presets it
          disabled — and when `orderScale` is unknown on a sell,
          `blockedReason` IS that same paragraph (it is the first arm of the
          memo). Rendering the banner too put the same five sentences twice
          into one 320px column, so the banner yields; the CTA above stays
          disabled either way, because `canSubmit` reads `blockedReason`
          itself, not this element. */}
      {blockedReason !== null && !(side === 'sell' && orderScale.kind === 'unknown') && (
        <p className="text-xs text-muted-foreground" data-testid="evm-trade-blocked">
          {blockedReason}
        </p>
      )}

      <SubmitStatus state={submitState} chain={chain} />
      <BatchSubmitStatus state={batchSubmitState} />

      {/* THE SCALE DISCLOSURE, and it is now CONDITIONAL — which is the whole
          result of this review.

          It used to be unconditional and it had to be: this panel sized every
          token amount at a hardcoded 18, so the assumption was real on every
          token whatever the wire said. That was the bug. Sizing reads the
          MEASURED scale now and refuses when there is none, so on a measured
          token there is no longer an assumption to disclose — and a notice
          that fires when there is nothing to disclose is how a reader learns
          to skip the one that matters. This matches what the trade page does
          with `EVM_TOKEN_DECIMALS_NOTE` (gated on `tokenDecimalsAssumed`); the
          two surfaces no longer disagree about whether the scale is known.

          What it says also changed. The old text disclosed an assumption
          ("amounts assume 18"). There is no assumption left to disclose: this
          says the scale is UNKNOWN and that the panel therefore refuses,
          because "we guessed" and "we declined to guess" are different
          promises and only the second one is now true.

          AND IT IS THE SECOND HALF OF AN EITHER/OR. On the sell side
          `orderScale` IS `tokenScale`, so `evm-sell-scale-unknown` above
          already prints this exact paragraph beside the presets it disabled —
          and both were rendering, putting the same five sentences twice into
          one 320px column. The refusal is entitled to one slot: the sell side
          takes the inline one, which sits with the controls it explains, and
          the buy side (where there is no preset row to hang it on) takes this
          one. */}
      {tokenScale.kind !== 'known' && side === 'buy' && (
        <p className="text-[10px] text-muted-foreground" data-testid="evm-decimals-disclosure">
          {tokenScale.why}
        </p>
      )}
        </>
      ) : chain === 'bsc' || chain === 'robinhood_chain' ? (
        /* THE SAME REFUSAL AS THE MARKET TAB. `blockedReason` is a fact about
           the MARKET — a tax token the engine cannot size, a non-native quote
           leg, a migrating pool, an unmeasured scale, no wallet on this chain
           — and none of those become tradeable by scheduling the order for
           later. This tab used to render without consulting it, so the token
           the Market tab had just refused could be given a limit or DCA order
           from the tab one click away. */
        <EvmAdvancedOrderForm
          chain={chain}
          kind={orderType}
          blockedReason={blockedReason}
          side={side}
          tokenAddress={address}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          quoteAsset={quoteAssetAddress ?? 'native'}
          quoteSymbol={quoteSymbol ?? nativeSymbol}
          quoteDecimals={quoteAssetAddress === null ? (selected?.native_decimals ?? quoteDecimals) : quoteDecimals}
          walletAccountId={selectedWalletAccountId}
          walletCount={selectedWallets.length}
          inputBalanceBaseUnits={
            // `null` on the token-quoted buy is the ONLY honest value: this
            // panel reads native wei and the page token, never the quote
            // ERC-20 (see `insufficient`). The form renders it as
            // "Balance: unavailable" and skips its own over-balance arm
            // rather than measuring against a fabricated figure — the same
            // posture the Market tab takes with `evm-buy-balance-unknown`.
            side === 'buy'
              ? quoteAssetAddress === null
                ? (selected?.wei ?? null)
                : null
              : tokenBalance.kind === 'known'
                ? tokenBalance.baseUnits
                : null
          }
          defaultSlippageBps={DEFAULT_SLIPPAGE_BPS}
          onCreated={onAdvancedCreated}
        />
      ) : null}
    </section>
  );
}

function PresetButton({
  label,
  testId,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function WalletSelect({
  state,
  selectedId,
  onSelect,
  nativeSymbol,
}: {
  state: ReturnType<typeof useEvmWallets>['state'];
  selectedId: string | null;
  onSelect: (walletAccountId: string) => void;
  nativeSymbol: string;
}) {
  if (state.kind === 'loading') {
    return (
      <p className="text-xs text-muted-foreground" data-testid="evm-wallets-loading">
        Loading your wallets…
      </p>
    );
  }
  if (state.kind === 'reauth') {
    return (
      <p className="text-xs text-muted-foreground" data-testid="evm-wallets-reauth">
        Your session ended ({state.reason.replace('_', ' ')}). Sign in again to trade.
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="text-xs text-muted-foreground" data-testid="evm-wallets-error">
        Couldn&apos;t read your wallets ({state.detail}). This says nothing about whether they
        exist.
      </p>
    );
  }
  if (state.wallets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="evm-wallets-none">
        No wallet on this chain yet.
      </p>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      From wallet
      <select
        value={selectedId ?? state.wallets[0]?.wallet_account_id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        data-testid="evm-wallet-select"
        aria-label="Wallet to trade from"
        className="rounded border bg-transparent px-2 py-1 text-sm"
      >
        {state.wallets.map((wallet) => {
          const amount = formatUnits(wallet.wei, wallet.native_decimals, 4);
          return (
            <option key={wallet.wallet_account_id} value={wallet.wallet_account_id}>
              {`${wallet.wallet_pubkey.slice(0, 8)}…${wallet.wallet_pubkey.slice(-6)} · ${
                /* An unread balance is an em dash. Rendering 0 here tells a
                   funded user their wallet is empty. */
                amount === null ? '—' : amount
              } ${wallet.native_symbol || nativeSymbol}`}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function EvmMultiWalletSelector({
  wallets,
  selectedIds,
  maxWallets,
  nativeSymbol,
  tokenSymbol,
  tokenDecimals,
  tokenBalances,
  onSelect,
}: {
  wallets: readonly EvmWalletBalance[];
  selectedIds: readonly string[];
  maxWallets: number;
  nativeSymbol: string;
  tokenSymbol: string;
  tokenDecimals: number | null;
  tokenBalances: readonly EvmTokenBalanceRow[] | null;
  onSelect: (walletAccountIds: readonly string[]) => void;
}) {
  const selectedSet = new Set(selectedIds);
  const atCap = selectedIds.length >= maxWallets;
  const fallbackId = selectedIds[0] ?? wallets[0]?.wallet_account_id ?? null;
  const toggle = (walletAccountId: string) => {
    if (selectedSet.has(walletAccountId)) {
      const next = selectedIds.filter((id) => id !== walletAccountId);
      onSelect(next.length > 0 ? next : fallbackId === null ? [] : [fallbackId]);
      return;
    }
    if (atCap) return;
    onSelect([...selectedIds, walletAccountId]);
  };
  const selectAll = () => onSelect(
    wallets.slice(0, maxWallets).map((wallet) => wallet.wallet_account_id),
  );
  const clear = () => onSelect(fallbackId === null ? [] : [fallbackId]);

  return (
    <div data-testid="evm-multi-wallet-selector" className="flex flex-col">
      <div
        className="flex items-baseline border-b px-3.5 py-3"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          Wallets
        </span>
        <span
          className="ml-2 font-mono text-[11px]"
          data-testid="evm-multi-wallet-count"
          style={{ color: 'var(--ink-3)' }}
        >
          {selectedIds.length}/{maxWallets}
        </span>
        <div className="ml-auto flex gap-2.5 text-[11px]">
          <button type="button" onClick={selectAll} data-testid="evm-wallet-select-all">
            All
          </button>
          <button type="button" onClick={clear} data-testid="evm-wallet-clear">
            Clear
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className="grid grid-cols-[15px_minmax(0,1fr)_70px_62px] gap-2 px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.6px]"
        style={{ color: 'var(--ink-3)' }}
      >
        <span />
        <span>wallet</span>
        <span className="text-right">{nativeSymbol}</span>
        <span className="truncate text-right">{tokenSymbol}</span>
      </div>
      <div
        role="listbox"
        aria-label="EVM wallets for batch trade"
        className="flex max-h-[290px] flex-col overflow-y-auto"
      >
        {wallets.map((wallet) => {
          const checked = selectedSet.has(wallet.wallet_account_id);
          const disabled = !checked && atCap;
          const amount = formatUnits(wallet.wei, wallet.native_decimals, 4);
          const tokenRow = tokenBalances?.find(
            (row) => row.walletAccountId === wallet.wallet_account_id,
          );
          const tokenAmount = tokenDecimals === null
            || tokenRow?.status !== 'ok'
            || tokenRow.balanceBaseUnits === null
              ? null
              : formatUnits(tokenRow.balanceBaseUnits, tokenDecimals, 4);
          return (
            <label
              key={wallet.wallet_account_id}
              data-testid={`evm-multi-wallet-row-${wallet.wallet_account_id}`}
              className="grid grid-cols-[15px_minmax(0,1fr)_70px_62px] items-center gap-2 px-3.5 py-2"
              style={{
                background: checked ? 'var(--accent-soft)' : 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: 'var(--ink-0)',
              }}
              title={disabled ? `Already at the batch cap of ${maxWallets} wallets` : undefined}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(wallet.wallet_account_id)}
                data-testid={`evm-multi-wallet-check-${wallet.wallet_account_id}`}
              />
              <span className="truncate font-mono text-[11px]">
                {wallet.wallet_pubkey.slice(0, 8)}â€¦{wallet.wallet_pubkey.slice(-4)}
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums">
                {amount ?? 'â€”'}
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums">
                {tokenAmount ?? 'â€”'}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The outcome of the last submit, with receipt inclusion kept distinct from
 * canonical finality and from an unknown broadcast outcome.
 *
 * ON THE `indeterminate` WORDING. It used to say a retry "would use the same
 * idempotency key, so a duplicate cannot fill twice". The gateway now owns a
 * durable, awaited idempotency gate, but the safe recovery action is still a
 * status read, not a fresh click: once an outcome is unknown, the UI must not
 * invent a new order id or silently alter the original body.
 */
export function SubmitStatus({ state, chain }: { state: SubmitState; chain: string }) {
  if (state.kind === 'idle' || state.kind === 'submitting') return null;
  if (state.kind === 'confirmed') {
    const url = state.txHash === null ? null : explorerTxUrl(chain, state.txHash);
    const site = explorerName(chain);
    return (
      <div
        className="rounded border p-2 text-xs"
        data-testid="evm-trade-confirmed"
        style={{ borderColor: 'var(--positive, #37c07a)' }}
      >
        <p style={{ color: 'var(--positive, #37c07a)' }}>
          <strong>Trade confirmed on chain.</strong>
          {state.blockNumber === null ? '' : ` Block ${state.blockNumber}.`}
        </p>
        {state.txHash === null ? (
          /* Confirmed, but the hash was not reported. Saying so beats an
             empty space that reads as "there was no transaction" — and it is
             the honest form of absent-is-not-zero for a receipt. */
          <p className="mt-1 text-muted-foreground" data-testid="evm-trade-tx-missing">
            The order service did not report a transaction hash for this fill, so there is no link
            to show. The trade itself is confirmed.
          </p>
        ) : (
          <p className="mt-1 break-all font-mono" data-testid="evm-trade-tx">
            {url === null ? (
              /* An unknown chain gets the bare hash, never a guessed explorer
                 URL — a 404 after spending real money reads as "my trade did
                 not happen". */
              shortTxHash(state.txHash)
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
                data-testid="evm-trade-tx-link"
              >
                {shortTxHash(state.txHash)}
                {site === null ? '' : ` · view on ${site}`}
              </a>
            )}
          </p>
        )}
        {state.orderSeq !== null && (
          <p className="mt-1 text-muted-foreground">Order #{state.orderSeq}</p>
        )}
      </div>
    );
  }
  if (state.kind === 'pending_finality') {
    const url = state.txHash === null ? null : explorerTxUrl(chain, state.txHash);
    const site = explorerName(chain);
    return (
      <div
        className="rounded border border-dashed p-2 text-xs"
        data-testid="evm-trade-pending-finality"
      >
        <p style={{ color: 'var(--warning, #d99a2b)' }}>
          <strong>Trade included — waiting for canonical finality.</strong>
          {state.blockNumber === null ? '' : ` Receipt observed in block ${state.blockNumber}.`}
        </p>
        {state.txHash !== null && (
          <p className="mt-1 break-all font-mono" data-testid="evm-trade-pending-tx">
            {url === null ? (
              shortTxHash(state.txHash)
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
                data-testid="evm-trade-pending-tx-link"
              >
                {shortTxHash(state.txHash)}
                {site === null ? '' : ` · view on ${site}`}
              </a>
            )}
          </p>
        )}
        <p className="mt-1 text-muted-foreground">
          A receipt can still be reorganized. Trading stays locked until the authoritative fill is
          finalized; do not place this order again.
        </p>
        <p className="mt-1 text-muted-foreground" data-testid="evm-trade-finality-window">
          {chain === 'robinhood_chain'
            ? 'This chain can take about 20 minutes to reach canonical finality even though inclusion is immediate.'
            : 'BSC normally reaches canonical finality within seconds.'}
        </p>
        <p className="mt-1 text-muted-foreground" data-testid="evm-trade-status-polling">
          Checking the authoritative order record.
        </p>
      </div>
    );
  }
  if (state.kind === 'reauth') {
    return (
      <p className="text-xs text-muted-foreground" data-testid="evm-trade-reauth">
        Your session ended before the order was placed. Nothing was submitted — sign in again and
        retry.
      </p>
    );
  }
  if (state.kind === 'refused') {
    return (
      <p
        className="text-xs"
        data-testid="evm-trade-refused"
        data-code={state.code}
        style={{ color: 'var(--negative, #e05260)' }}
      >
        {state.text}
      </p>
    );
  }
  if (state.kind === 'reorged') {
    return (
      <div
        className="rounded border border-dashed p-2 text-xs"
        data-testid="evm-trade-reorged"
        style={{ borderColor: 'var(--negative, #e05260)' }}
      >
        <p style={{ color: 'var(--negative, #e05260)' }}>
          <strong>Chain reorganization detected.</strong> The previously included transaction is
          no longer canonical{state.afterFinality ? ' after it had appeared finalized' : ''}.
        </p>
        <p className="mt-1 text-muted-foreground">
          Its optimistic confirmation has been withdrawn. Trading stays locked while the original
          order is reconciled; do not submit it again.
        </p>
        <p className="mt-1 text-muted-foreground" data-testid="evm-trade-status-polling">
          Checking the authoritative order record for a replacement receipt or a safe refusal.
        </p>
      </div>
    );
  }
  /**
   * PENDING — UNCONFIRMED. Not a failure, and deliberately not styled as one.
   *
   * The affordance is the whole point. There is NO retry button here, and the
   * Buy/Sell CTA above is disabled while this is showing, because the one
   * thing a user must not be able to do in one click is place a second order
   * on top of a live one. The notice cannot be dismissed while the outcome is
   * unsafe; the durable order-status read is the only thing that unlocks it.
   */
  return (
    <div
      className="rounded border border-dashed p-2 text-xs"
      data-testid="evm-trade-may-be-live"
      data-source={state.source}
    >
      <p style={{ color: 'var(--warning, #d99a2b)' }}>
        <strong>Pending — unconfirmed.</strong> This transaction may already be on chain.
      </p>
      <p className="mt-1 text-muted-foreground">
        {state.reason === 'canonicality_resnapshot'
          ? 'The order lifecycle stream reported a replay gap after confirmation, so canonicality must be checked again'
          : state.source === 'server'
          ? 'The trading engine could not confirm whether it broadcast your transaction'
          : state.reason === 'restored_pending_order'
            ? 'This browser restored an order whose final outcome was not recorded locally'
            : state.reason === 'sign_in_required_to_reconcile'
              ? 'Your session ended while this order was being reconciled; sign in again so polling can continue'
              : 'The order request did not complete, so we never saw the answer'}
        {state.reason === 'restored_pending_order' ||
        state.reason === 'sign_in_required_to_reconcile' ||
        state.reason === 'canonicality_resnapshot'
          ? '. '
          : ` (${state.reason}). `}
        {state.reason === 'canonicality_resnapshot'
          ? ' The previously reported fill is being revalidated before it is trusted again.'
          : ' It was not reported as failed, and it was not reported as filled.'}
      </p>
      <p className="mt-1 text-muted-foreground">
        <strong>Do not place this order again yet.</strong> A fresh click can mint a new order id;
        wait for the authoritative order check below to settle the original.
      </p>
      <p className="mt-1 text-muted-foreground" data-testid="evm-trade-status-polling">
        Checking the authoritative order record. Trading stays locked until the outcome is safe.
      </p>
    </div>
  );
}

export function BatchSubmitStatus({ state }: { state: BatchSubmitState }) {
  if (state.kind === 'idle' || state.kind === 'submitting') return null;
  if (state.kind === 'recovering' || state.kind === 'reorged') {
    return (
      <div
        className="rounded border p-2 text-xs"
        data-testid={state.kind === 'reorged' ? 'evm-batch-reorged' : 'evm-batch-recovering'}
        style={{ borderColor: 'var(--warning, #d99a2b)' }}
      >
        <strong>{state.kind === 'reorged' ? 'Batch finality was retracted.' : 'Batch outcome pending.'}</strong>
        <p className="mt-1 text-muted-foreground">{state.detail}</p>
        {state.children.map((child, index) => <p key={`${index}:${child}`} className="font-mono">{child}</p>)}
      </div>
    );
  }
  if (state.kind === 'confirmed') {
    return (
      <div
        className="rounded border p-2 text-xs"
        data-testid="evm-batch-confirmed"
        style={{ borderColor: 'var(--positive, #37c07a)' }}
      >
        <strong>Every batch child has a durable finalized fill.</strong>
        {state.children.map((child, index) => <p key={`${index}:${child}`} className="font-mono">{child}</p>)}
      </div>
    );
  }
  if (
    state.kind === 'partial_failed'
    || state.kind === 'failed'
    || state.kind === 'cancelled'
  ) {
    return (
      <div
        className="rounded border p-2 text-xs"
        data-testid={`evm-batch-${state.kind}`}
        style={{ borderColor: 'var(--negative, #e05260)' }}
      >
        <strong>
          {state.kind === 'partial_failed'
            ? 'Some batch children failed.'
            : state.kind === 'cancelled' ? 'The batch was cancelled.' : 'The batch failed.'}
        </strong>
        {state.children.map((child, index) => <p key={`${index}:${child}`} className="font-mono">{child}</p>)}
      </div>
    );
  }
  if (state.kind === 'reauth') {
    return <p className="text-xs text-muted-foreground" data-testid="evm-batch-reauth">Sign in again to reconcile this batch.</p>;
  }
  if (state.kind !== 'refused') return null;
  return (
    <p className="text-xs" data-testid="evm-batch-refused" style={{ color: 'var(--negative, #e05260)' }}>
      {state.text} ({state.code})
    </p>
  );
}

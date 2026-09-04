import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { Caption, Numeral, type Tone } from '@/components/listen/primitives';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { resolveOrderAuthToken, warmOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { logPreSubmitTiming } from './submitTiming';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import {
  mergeDisplayBalance,
  readOptimisticBalance,
  useTradeActivityStore,
} from '@/lib/state/trade-activity-store';
import { useTradeStore, type SellChipMode } from '@/lib/state/trade-store';
import {
  deriveChildClientOrderId,
  submitBatchOrder,
  type BatchOrderInput,
  type BatchOrderResult,
} from '@/lib/api/orders';
import { useTradeLedger } from './useTradeLedger';
import { ledgerToPnl } from './ledgerPnl';
import { WalletCountButton, routeForWalletCount } from './WalletCountButton';
import { QuickChipsEditor } from './QuickChipsEditor';
import { QuoteModeToggle } from './QuoteModeToggle';
import { SettingsReadout } from './SettingsReadout';
import {
  isUsdcPair,
  resolveSpendCurrency,
  usdToUsdcMicroDecimalString,
} from '@/lib/trade/spend-currency';
import { compactNumber, formatUsdAmount, formatUsdcMicro } from '@/lib/format';
import { useWalletBalance } from '@/components/listen/useWalletBalance';
import { planSolSellFanOut } from './sellSizing';
import { HoverPreview } from './HoverPreview';
import { Solana } from '@/components/listen/icons/Icons';
import type { MockPnL, MockToken } from './mockTrade';
import type {
  TradeOrderEvent,
  TradeOrderKey,
  TradeSellQuoteInfo,
  UseTradeStream,
} from './useTradeStream';
import {
  filterSellableWalletIds,
  mergeSellHintsWithFloors,
  type MultiWalletTokenBalance,
} from './useMultiWalletTokenBalance';
import { TradeToasts, type TradeToastItem } from './TradeToasts';
import { resolveFailedBatchChildren } from './batchChildToasts';
import { unlockTradeSuccessSound } from './tradeSound';
import { estimateBuyTokens, estimateSellLamports } from './sellEstimate';
import { formatTokenAmount } from './formatTokenAmount';
import { isAllowedAmountInput, parseTradeAmount } from './amountInput';
import { REAUTH_HUMAN_MESSAGE } from './reauthMessage';
import { AdvancedTabBody } from './advanced/AdvancedTabBody';
import { LimitTabBody } from './advanced/LimitTabBody';

interface Props {
  token: MockToken;
  pnl: MockPnL;
  /** When provided, TradePanel wires the Buy CTA to POST /api/v1/trade/orders for this mint. */
  mint?: string;
  /** Current price in lamports per token base unit (from the ingestion service snapshot). */
  priceLamportsPerBaseUnit?: number;
  stream: UseTradeStream;
  /** Shared multi-wallet token-balance snapshot, owned by TradePage so
   *  this panel and the Instant Trade box never double-poll. */
  multiTokenBalance: MultiWalletTokenBalance;
}

type Side = 'Buy' | 'Sell';
type OrderType = 'Market' | 'Limit' | 'Adv.';

const ORDER_TYPES: readonly OrderType[] = ['Market', 'Limit', 'Adv.'] as const;
const DISPLAY_ZERO_SOL = 0.000001;
const MAX_TRADE_TOASTS = 60;
const MIN_DISPLAY_SELLABLE_BASE_UNITS = 10_000n; // 0.01 token with 6 decimals.

function formatSol(lamports: number, frac = 4): string {
  if (!Number.isFinite(lamports) || lamports === 0) return '0 SOL';
  const sol = lamports / 1e9;
  if (Math.abs(sol) < DISPLAY_ZERO_SOL) return '0 SOL';
  if (Math.abs(sol) < 0.0001) return sol.toExponential(2) + ' SOL';
  return sol.toFixed(frac) + ' SOL';
}

function formatSignedPct(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%';
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function numberFromDecimal(decimal: string | undefined): number {
  if (!decimal) return 0;
  try {
    return Number(BigInt(decimal));
  } catch {
    return Number(decimal) || 0;
  }
}

function tokensToSol(tokens: string, priceLamportsPerBaseUnit: number): number {
  if (!priceLamportsPerBaseUnit) return 0;
  try {
    return Math.max(0, Number(tokens)) * priceLamportsPerBaseUnit;
  } catch {
    return 0;
  }
}

// Slice "Per-wallet positions / fills + wallet management UI"
// retired the in-memory `formatPosition(stream.position, ...)` path
// in favour of `formatPerWalletPosition` below — the in-memory
// `PositionStore` is mint-keyed, so it would silently leak
// another wallet's totals into the PnL strip. `numberFromDecimal`
// and `tokensToSol` are still used by the per-wallet formatter.

/**
 * Slice "Per-wallet positions / fills + wallet management UI":
 * format a per-wallet `TradePositionEntry` (from `portfolio.positions`)
 * for the TradePanel PnL strip. Cost-basis / PnL are dashed-out
 * when the row's provenance is `imported_unknown` — the slice-7
 * persister starts new positions in that state until per-wallet
 * cost-basis accounting ships. Holding (current SOL value of the
 * tokens) is honest from the moment the first fill lands.
 */
export function formatPerWalletPosition(
  p: {
    tokens: string;
    cost_basis_lamports: string;
    cost_basis_provenance: string;
  },
  price: number,
): MockPnL {
  const valueLamports = tokensToSol(p.tokens, price);
  const holding = formatSol(valueLamports, 4);
  const basisKnown = p.cost_basis_provenance === 'observed_fill';
  if (!basisKnown) {
    return { bought: '—', sold: '—', holding, pnl: '—' };
  }
  const boughtLamports = numberFromDecimal(p.cost_basis_lamports);
  const totalPnlLamports = valueLamports - boughtLamports;
  const pnlPct = boughtLamports > 0 ? (totalPnlLamports / boughtLamports) * 100 : null;
  return {
    bought: formatSol(boughtLamports, 4),
    sold: '—',
    holding,
    pnl: pnlPct !== null ? formatSignedPct(pnlPct) : '—',
  };
}

function baseUnitsToWholeTokenAmount(baseUnits: string): string {
  try {
    const raw = BigInt(baseUnits);
    const whole = raw / 1_000_000n;
    return whole > 0n ? whole.toString() : '0';
  } catch {
    return '0';
  }
}

function pctOfBaseUnits(baseUnits: string | undefined, pct: number): string {
  if (!baseUnits || !Number.isFinite(pct) || pct <= 0) return '0';
  try {
    const raw = BigInt(baseUnits);
    if (raw <= 0n) return '0';
    // Basis-point math so fractional percents (0.5%) execute as typed.
    const out = (raw * BigInt(Math.round(pct * 100))) / 10_000n;
    return out > 0n ? out.toString() : '0';
  } catch {
    return '0';
  }
}

function isBelowDisplaySellableBalance(baseUnits: string | null | undefined): boolean {
  if (!baseUnits) return false;
  try {
    return BigInt(baseUnits) < MIN_DISPLAY_SELLABLE_BASE_UNITS;
  } catch {
    return false;
  }
}

function orderKeyId(key: TradeOrderKey): string {
  return `${key.seq}:${key.tsMs}`;
}

function orderEventId(event: TradeOrderEvent): string {
  const base = `${orderKeyId(event.key)}:${event.kind}:${event.tsMs}`;
  if (event.kind === 'accepted') return `${base}:${event.intent.clientOrderId}`;
  if (event.kind === 'submitted' || event.kind === 'confirmed' || event.kind === 'fill_pending')
    return `${base}:${event.signature}`;
  if (event.kind === 'filled' || event.kind === 'partial') return `${base}:${event.fill.signature}`;
  if (event.kind === 'failed') return `${base}:${event.error.kind}`;
  if (event.kind === 'cancelled') return `${base}:${event.reason}`;
  return base;
}

/** Event kinds after which an order's lifecycle is over for toast purposes. */
const TERMINAL_ORDER_EVENT_KINDS: ReadonlySet<TradeOrderEvent['kind']> = new Set([
  'confirmed',
  'fill_pending',
  'filled',
  'partial',
  'failed',
  'cancelled',
]);

/** OrderKeys (as `orderKeyId`) of orders that already reached a terminal event. */
function terminalOrderKeyIds(events: ReadonlyArray<TradeOrderEvent>): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (TERMINAL_ORDER_EVENT_KINDS.has(event.kind)) keys.add(orderKeyId(event.key));
  }
  return keys;
}

function solFromLamports(decimal: string): number {
  try {
    const value = BigInt(decimal);
    const abs = value < 0n ? -value : value;
    return Number(abs) / 1e9;
  } catch {
    return 0;
  }
}

function solAmountFromIntent(
  event: Extract<TradeOrderEvent, { kind: 'accepted' }>,
  priceLamportsPerBaseUnit: number,
  tokenBalance: string | null,
): { solAmount: number | null; estimated: boolean } {
  if (event.intent.side === 'buy' && event.intent.solIn) {
    return { solAmount: solFromLamports(event.intent.solIn), estimated: false };
  }
  if (event.intent.side === 'sell' && event.intent.tokensIn) {
    return {
      solAmount: tokensToSol(event.intent.tokensIn, priceLamportsPerBaseUnit) / 1e9,
      estimated: true,
    };
  }
  if (event.intent.side === 'sell' && event.intent.sellPctBps) {
    if (!tokenBalance) return { solAmount: null, estimated: true };
    const rawAmount = pctOfBaseUnits(tokenBalance, event.intent.sellPctBps / 100);
    return {
      solAmount: tokensToSol(rawAmount, priceLamportsPerBaseUnit) / 1e9,
      estimated: true,
    };
  }
  return { solAmount: null, estimated: event.intent.side === 'sell' };
}

export function TradePanel({ token, pnl: pnlMock, mint, priceLamportsPerBaseUnit, stream, multiTokenBalance }: Props) {
  const side = useTradeStore((state) => state.side);
  const setSide = useTradeStore((state) => state.setSide);
  const buyAmount = useTradeStore((state) => state.buyAmount);
  const setBuyAmount = useTradeStore((state) => state.setBuyAmount);
  const sellAmount = useTradeStore((state) => state.sellAmount);
  const setSellAmount = useTradeStore((state) => state.setSellAmount);
  const selectedSellPct = useTradeStore((state) => state.selectedSellPct);
  const setSelectedSellPct = useTradeStore((state) => state.setSelectedSellPct);
  const quickChips = useTradeStore((state) => state.quickChips);
  const sellChipMode = useTradeStore((state) => state.sellChipMode);
  const setSellChipMode = useTradeStore((state) => state.setSellChipMode);
  /* USDC pair support: the global trade mode + the pair's quote mint
     resolve the effective spend currency through the single shared
     resolver. USDC pairs ALWAYS spend USDC; SOL pairs in USDC mode
     fall back to SOL (with a notice) until cross-quote ships. */
  const tradeQuoteMode = useTradeStore((state) => state.usdcTrade.trade_quote_mode);
  const usdcQuickBuyMicro = useTradeStore((state) => state.usdcTrade.quick_buy_usdc_micro);
  /* Trading-presets slice: buy and sell read independent
     `slippage_bps` / `priority_lamports` / `bribe_lamports` from
     the GLOBAL active preset's matching side. Trade page is not
     section-bound (unlike Discover QuickBuy cards), so it always
     resolves through `tradePresets.active_index`. All three values
     thread through into the order intake body and the trading
     engine consumes them at compose-time (priority -> µLamports/CU
     via the route's CU-limit divisor; bribe -> exact lamports on
     the relay tip transfer). */
  const slippageBpsBuy = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.slippage_bps,
  );
  const slippageBpsSell = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].sell.slippage_bps,
  );
  const priorityLamportsBuy = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.priority_lamports,
  );
  const priorityLamportsSell = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].sell.priority_lamports,
  );
  const bribeLamportsBuy = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.bribe_lamports,
  );
  const bribeLamportsSell = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].sell.bribe_lamports,
  );
  const sendModeBuy = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.send_mode,
  );
  const sendModeSell = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].sell.send_mode,
  );
  // Optimistic submit gate (see the same note in InstantTradeBox): don't
  // pre-gate the click on the cold-boot auth waterfall or the live trading
  // SSE connection. Order intake is the authoritative gate and prompts for
  // reauth/setup only if the order actually needs it.
  const { getToken } = useAuth();
  const { decision: tradingReadyDecision, requireTradingReady } = useRequireTradingReady({
    optimistic: true,
  });
  const queryClient = useQueryClient();
  // Slice "Terminal wallet selector" + "Multi-wallet split buy/sell
  // orders" (UI revision): the multi-wallet set is the single source
  // of truth. `selectedWalletAccountId` mirrors its head and is used
  // for the per-wallet PnL strip / recent fills / token-balance poll;
  // routing on submit forks on the array length.
  const selectedWalletAccountId = useSelectedWalletStore((s) => s.selectedWalletAccountId);
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  // Sell-side chip behavior must NOT be gated on the focused wallet's
  // local position state when routing is going to fan out to multiple
  // wallets — the trading engine reads each child wallet's chain
  // balance independently. We derive this from the set length so the
  // existing chip path stays single-wallet-correct in the 1-wallet
  // case and multi-wallet-permissive in the 2+ case.
  const isMultiWalletTrade = multiSelectedWalletAccountIds.length >= 2;
  const pairIsUsdc = isUsdcPair(token.quoteMint);
  // Venue matters: bonding-curve SOL pairs support cross-quote USDC
  // spending; graduated (pump-AMM) pairs fall back to SOL + notice.
  const spend = resolveSpendCurrency(
    tradeQuoteMode,
    token.quoteMint,
    token.graduated === true,
  );
  const buyInUsdc = spend.currency === 'usdc';
  /* USDC balance for the insufficient-spend check + display. Polls only
     while a USDC buy surface is actually visible (enabled flag), so SOL
     pairs in SOL mode pay zero extra read cost. The value is in memory
     before the user clicks Buy — no fetch on the press path. */
  const usdcWalletBalance = useWalletBalance(selectedWalletAccountId, {
    includeUsdc: true,
    enabled: buyInUsdc,
  });
  /* The SOL mirror of the read above, on the same terms: it polls only
     while a SOL buy surface is visible, so a USDC buy and every sell
     still pay zero extra read cost. A SOL buy is the one case the USDC
     guard never covered, which mattered little while every wallet was
     one the user funds by hand — and matters now that the agent wallet
     is selectable here and is funded by transfer. */
  const solWalletBalance = useWalletBalance(selectedWalletAccountId, {
    enabled: side === 'Buy' && !buyInUsdc,
  });
  const optimisticBalances = useTradeActivityStore((s) => s.optimisticBalances);
  const registerOrderContext = useTradeActivityStore((s) => s.registerOrderContext);
  const reconcileOptimisticBalance = useTradeActivityStore((s) => s.reconcileOptimisticBalance);
  // Multi-wallet sell preview: the SUMMED token balance across the
  // selected wallets so the percent chips (25/50/75/100) and the
  // "Sell N SOL" CTA size against the whole set, not just the focused
  // wallet's. The snapshot is owned by TradePage (`multiTokenBalance`
  // prop) and is idle (returns 0n) when fewer than 2 wallets are
  // selected, so the legacy single-wallet path keeps using
  // `stream.tokenBalance`.
  const [order, setOrder] = useState<OrderType>('Market');
  const [sellAmountBaseUnits, setSellAmountBaseUnits] = useState<string | null>(null);
  // Pending SOL-amount target for a MULTI-wallet sell. Single-wallet SOL
  // sells resolve to `sellAmountBaseUnits` directly; multi-wallet keeps the
  // SOL target here and converts it per-wallet at submit (equal split).
  const [sellSolTargetMulti, setSellSolTargetMulti] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toasts, setToasts] = useState<TradeToastItem[]>([]);
  const toastByClientIdRef = useRef(new Map<string, string>());
  const toastByOrderKeyRef = useRef(new Map<string, string>());
  // Dedup set for the global order-event ring. `null` until the first
  // effect run so we can tell "fresh mount" apart from "live updates" —
  // the ring outlives this panel, and replaying it wholesale on remount
  // would resurrect toasts for orders that already finished.
  const processedOrderEventsRef = useRef<Set<string> | null>(null);

  const liveTokenBalanceRef = useRef<string | null>(null);
  // Latency head stamp: the CTA press moment, captured at pointerdown so
  // `clientTsMs` reflects the true click (~60-120ms before `click` fires).
  const ctaPointerDownAtMsRef = useRef<number | null>(null);
  // Monotonic twin of the wall stamp above (performance.now()), feeding
  // the e2e timing waterfall's press stamp (tradeTiming.ts) — durations
  // must never come from Date.now().
  const ctaPointerDownPerfAtMsRef = useRef<number | null>(null);
  // CTA submits at pointerdown (see the CTA button below). Deduping the
  // same press's synthetic click is PRESS-SCOPED, not time-windowed: a
  // press held longer than any fixed window would fire the click after
  // the window and SUBMIT THE ORDER TWICE. The flag arms at
  // pointerdown-submit and is consumed by the press's click;
  // pointercancel clears it. Keyboard activation (click with
  // detail === 0) always submits; the 750ms stamp only dedups assistive
  // tech that dispatches BOTH a pointerdown and a detail===0 click for
  // one press.
  const ctaPressSubmittedRef = useRef(false);
  const ctaPointerFiredAtRef = useRef(0);
  const isBuy = side === 'Buy';
  const amount = isBuy ? buyAmount : sellAmount;
  const price = priceLamportsPerBaseUnit ?? 0;
  // Latest-value mirrors for `submitSolSellFanOut`'s bounded gate: that
  // closure's `price` / `stream.tokenBalanceInfo` are frozen at render
  // time, so its wait loop polls these refs instead of the stale state.
  const priceRef = useRef(price);
  const tokenBalanceInfoRef = useRef(stream.tokenBalanceInfo);
  useEffect(() => {
    priceRef.current = price;
    tokenBalanceInfoRef.current = stream.tokenBalanceInfo;
  }, [price, stream.tokenBalanceInfo]);
  // Slice "Per-wallet positions / fills + wallet management UI":
  // do NOT fall back to `stream.position?.tokens` for sell sizing —
  // the in-memory `PositionStore` is mint-keyed (not wallet-scoped)
  // and would surface another wallet's tokens. The slice-6 wallet-
  // scoped token-balance poll is the authoritative source. We
  // coerce `null` → `undefined` so the call sites that take
  // `string | undefined` keep working unchanged.
  const liveTokenBalance: string | undefined = stream.tokenBalance ?? undefined;
  const optimisticFloor = mint
    ? readOptimisticBalance(optimisticBalances, selectedWalletAccountId, mint)
    : null;
  const multiDisplayTokenBalance = useMemo(() => {
    if (!mint || !isMultiWalletTrade) return '0';
    let total = 0n;
    for (const walletId of multiSelectedWalletAccountIds) {
      const chainTokens = multiTokenBalance.perWallet.get(walletId)?.tokens ?? null;
      const floor = readOptimisticBalance(optimisticBalances, walletId, mint);
      const displayTokens = mergeDisplayBalance(chainTokens, floor);
      try {
        const v = BigInt(displayTokens);
        if (v > 0n) total += v;
      } catch {
        // Malformed display input contributes zero.
      }
    }
    return total.toString(10);
  }, [
    mint,
    isMultiWalletTrade,
    multiSelectedWalletAccountIds,
    multiTokenBalance.perWallet,
    optimisticBalances,
  ]);
  const displayTokenBalance = isMultiWalletTrade
    ? multiDisplayTokenBalance
    : mergeDisplayBalance(stream.tokenBalance ?? null, optimisticFloor);

  // PnL strip: lifetime cash-flow ledger for this coin, blended across the
  // selected wallet set, from the durable `trading.fills` ledger — so it
  // PERSISTS after a full sell (the open position zeroes out; the ledger
  // does not). BOUGHT/SOLD are cumulative SOL in/out; HOLDING + PNL
  // recompute from the fast local `price` so they tick live between
  // refetches. Cash-flow from the user's own fills is always known, so
  // there is no basis-unknown dash here.
  const ledger = useTradeLedger(mint ?? null);
  const livePnl = useMemo<MockPnL | null>(() => ledgerToPnl(ledger, price), [ledger, price]);
  const pnl = livePnl ?? pnlMock;
  const pnlTone: Tone = (pnl.pnl.trim().startsWith('-') ? 'down' : 'up') as Tone;

  // Position value in SOL (current price × tokens).
  const positionTokens = Math.max(0, Number(displayTokenBalance));
  const sellQuote = stream.tokenBalanceInfo?.quote ?? null;
  // When multi-wallet AND a percent chip is active, derive base
  // units from the summed multi-wallet token balance so the CTA
  // shows "Est. receive: X SOL" against ALL selected wallets, not
  // just the focused one. Otherwise fall back to the existing
  // single-wallet `sellAmountBaseUnits` / typed `sellAmount` path.
  const multiSellBaseUnits =
    !isBuy && isMultiWalletTrade && selectedSellPct !== null
      ? pctOfBaseUnits(multiTokenBalance.totalBaseUnits.toString(), selectedSellPct)
      : null;
  // Keep the token base-units fresh as the live balance moves, so the
  // "Est. receive" on the CTA tracks a percentage selection. Purely derived
  // from render-visible values (this replaced a 50ms polling interval over
  // refs computing the same result). The DISPLAYED amount is intentionally
  // left alone — in percent mode the field shows the percent (e.g. "25").
  // The submit path recomputes the pct from the live balance at click time
  // (see `submitSingleTrade`), so execution never reads this value.
  const syncedSellBaseUnits = useMemo(() => {
    if (selectedSellPct === null) return null;
    const balance = liveTokenBalance ?? stream.position?.tokens;
    if (!balance || Number(balance) <= 0) return null;
    const rawAmount = pctOfBaseUnits(balance, selectedSellPct);
    return rawAmount !== '0' ? rawAmount : null;
  }, [liveTokenBalance, selectedSellPct, stream.position]);
  const effectiveSellBaseUnits =
    selectedSellPct !== null ? syncedSellBaseUnits : sellAmountBaseUnits;
  // Est-receive renders in $ whenever the user RECEIVES USDC: native
  // USDC pairs, and cross-quote sells (the engine swaps the SOL
  // proceeds to USDC). Sell sizing itself is unchanged — reserves are
  // SOL-flattened on the wire.
  const receiveUsdRate =
    pairIsUsdc || spend.crossQuote ? (token.solUsd ?? null) : null;
  // A typed SOL-mode target is a SOL amount, never a token count: derive
  // its base units from the live price (capped at the sellable balance)
  // instead of letting the fallback read "0.5" as half a token.
  const solTargetBaseUnits =
    !isBuy && sellChipMode === 'sol' && sellSolTargetMulti != null && price > 0
      ? (() => {
          let units = Math.floor((sellSolTargetMulti * 1e9) / price);
          const balance = Number(liveTokenBalance ?? 'NaN');
          if (Number.isFinite(balance)) units = Math.min(units, balance);
          return units > 0 ? String(units) : '0';
        })()
      : null;
  const sellButtonSolAmount = isBuy
    ? null
    : sellCtaSolAmount(
        multiSellBaseUnits ?? effectiveSellBaseUnits ?? solTargetBaseUnits,
        sellChipMode === 'sol' ? '0' : sellAmount,
        price,
        sellQuote,
        receiveUsdRate,
      );
  const sellButtonPreview = sellButtonSolAmount
    ? `Est. receive: ${sellButtonSolAmount}`
    : undefined;
  // Buy CTA mirror of the sell est-receive: approximate tokens the typed
  // spend receives (venue quote when polled, spot fallback). Native title
  // only — `.buy-cta > * { position: relative }` breaks in-button overlays.
  const buyButtonPreview = useMemo(() => {
    if (!isBuy) return undefined;
    const typed = parseTradeAmount(buyAmount);
    if (typed === null || typed <= 0) return undefined;
    return buyTokensPreview(
      buyInUsdc ? usdSpendLamports(typed, token.solUsd ?? null) : solSpendLamports(typed),
      sellQuote,
      price,
      multiSelectedWalletAccountIds.length,
    );
  }, [
    isBuy,
    buyAmount,
    buyInUsdc,
    token.solUsd,
    sellQuote,
    price,
    multiSelectedWalletAccountIds.length,
  ]);
  liveTokenBalanceRef.current = liveTokenBalance ?? null;

  // Cross-quote buy token estimate: the $ spend is exact; the token
  // amount is approximate — spend converted at the pair's displayed
  // price (the engine applies a 50bps swap tolerance + the user's
  // slippage on the curve leg, so the realized amount can differ).
  const crossQuoteBuyTokenEst = useMemo(() => {
    if (!isBuy || !spend.crossQuote) return null;
    const typedUsd = parseTradeAmount(buyAmount);
    if (typedUsd === null || typedUsd <= 0) return null;
    const solUsd = token.solUsd;
    if (solUsd == null || solUsd <= 0 || !price || price <= 0) return null;
    const wholeTokens = Math.floor(((typedUsd / solUsd) * 1e9) / price / 1_000_000);
    if (wholeTokens <= 0 || !Number.isFinite(wholeTokens)) return null;
    return compactNumber(wholeTokens);
  }, [isBuy, spend.crossQuote, buyAmount, token.solUsd, price]);

  // Insufficient-USDC check (display only; intake re-validates). Uses
  // the raw micro strings so display rounding can never flip the state.
  const usdcInsufficient = useMemo(() => {
    if (!isBuy || !buyInUsdc || usdcWalletBalance.usdcMicro === null) return false;
    const typed = parseTradeAmount(buyAmount);
    if (typed === null || typed <= 0) return false;
    try {
      return (
        BigInt(usdToUsdcMicroDecimalString(typed)) > BigInt(usdcWalletBalance.usdcMicro)
      );
    } catch {
      return false;
    }
  }, [isBuy, buyInUsdc, buyAmount, usdcWalletBalance.usdcMicro]);

  const solInsufficient = useMemo(
    () =>
      solSpendExceedsBalance({
        isSolBuy: isBuy && !buyInUsdc,
        isMultiWalletTrade,
        balanceLamports: solWalletBalance.lamports,
        typedAmount: buyAmount,
      }),
    [isBuy, buyInUsdc, isMultiWalletTrade, buyAmount, solWalletBalance.lamports],
  );

  useEffect(() => {
    if (!mint || isMultiWalletTrade) return;
    if (stream.tokenBalanceInfo?.known !== true) return;
    reconcileOptimisticBalance(selectedWalletAccountId, mint, stream.tokenBalance ?? null);
  }, [
    mint,
    isMultiWalletTrade,
    selectedWalletAccountId,
    stream.tokenBalance,
    stream.tokenBalanceInfo?.known,
    reconcileOptimisticBalance,
  ]);

  useEffect(() => {
    if (!mint || !isMultiWalletTrade) return;
    for (const walletId of multiSelectedWalletAccountIds) {
      const entry = multiTokenBalance.perWallet.get(walletId);
      if (entry?.known === true) {
        reconcileOptimisticBalance(walletId, mint, entry.tokens);
      }
    }
  }, [
    mint,
    isMultiWalletTrade,
    multiSelectedWalletAccountIds,
    multiTokenBalance.perWallet,
    reconcileOptimisticBalance,
  ]);

  useEffect(() => {
    let processed = processedOrderEventsRef.current;
    if (processed === null) {
      // Fresh mount: the global event ring may hold history from a
      // previous visit. Orders that already reached a terminal event are
      // done — mark their events processed WITHOUT applying so their
      // toasts don't replay. Orders still in flight do replay, so a user
      // returning mid-trade sees live progress.
      processed = new Set<string>();
      processedOrderEventsRef.current = processed;
      const doneKeys = terminalOrderKeyIds(stream.orderEvents);
      for (const event of stream.orderEvents) {
        if (doneKeys.has(orderKeyId(event.key))) processed.add(orderEventId(event));
      }
    }
    const keepIds = new Set(stream.orderEvents.map(orderEventId));
    for (const id of processed) {
      if (!keepIds.has(id)) processed.delete(id);
    }
    for (const event of stream.orderEvents) {
      const id = orderEventId(event);
      if (processed.has(id)) continue;
      processed.add(id);
      applyOrderEventToToasts(event);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.orderEvents]);

  const handleClick = async (): Promise<void> => {
    // Prefer the pointerdown clock for the latency head stamp; fall back
    // to now for keyboard activation or a stale (aborted) earlier press.
    const downAtMs = ctaPointerDownAtMsRef.current;
    ctaPointerDownAtMsRef.current = null;
    const clickedAtMs =
      downAtMs !== null && Date.now() - downAtMs < 1_500 ? downAtMs : Date.now();
    // Monotonic press stamp for the e2e waterfall — same freshness rule.
    const downPerfAtMs = ctaPointerDownPerfAtMsRef.current;
    ctaPointerDownPerfAtMsRef.current = null;
    const pressPerfAtMs =
      downPerfAtMs !== null && performance.now() - downPerfAtMs < 1_500
        ? downPerfAtMs
        : performance.now();
    // Press-time token warm (fire-and-forget, single-flight): on a cold /
    // near-expiry Clerk mirror this starts the mint NOW so the submit
    // path's `resolveOrderAuthToken` joins an already-in-flight request
    // instead of paying the full mint after validation/gates. The CTA
    // submits at pointerdown, so this IS the earliest press signal.
    warmOrderAuthToken(getToken);
    // T2-Clerk-A: signed-out users get the Clerk modal instead of an
    // attempted order submission. Signed-in users continue through the
    // existing flow; backend Clerk verification arrives in T2-Clerk-B.
    if (!requireTradingReady()) {
      setStatusMessage(messageForTradingReadyDecision(tradingReadyDecision));
      return;
    }
    if (!mint) {
      setStatusMessage('No mint in URL — pass ?mint=<base58> to enable trading.');
      return;
    }
    // Click-time self-warm (quickbuy pattern, fire-and-forget — never
    // awaited): kick the engine's quote warm so it races the order POST
    // instead of relying on the page heartbeat, which may have lapsed
    // (tab return / pane reveal). The prewarm cooldown dedups it against
    // a live heartbeat.
    const warmSession = getClerkSession();
    if (warmSession.isSignedIn === true) {
      prewarmMints([mint], warmSession.token, {
        graduatedMints: token.graduated === true ? [mint] : [],
        immediate: true,
      });
    }
    // Plain-decimal parser only — `Number()` would coerce hex ("0x10" →
    // 16 SOL) and scientific notation ("1e5" → 100,000 SOL), and values
    // around 1e21 make the lamports serializer throw mid-submit.
    const num = parseTradeAmount(amount);
    if (num === null) {
      setStatusMessage('Enter a valid amount (plain decimal, up to 9 decimals).');
      return;
    }
    if (num <= 0 && !(side === 'Sell' && selectedSellPct !== null)) {
      setStatusMessage('Enter a positive amount.');
      return;
    }
    unlockTradeSuccessSound();
    setStatusMessage(null);

    // Slice "Multi-wallet split buy/sell orders" (UI revision): the
    // multi-selection set drives the route. We snapshot the array at
    // click time so concurrent re-renders cannot change which wallets
    // the user is submitting through.
    const walletIds = multiSelectedWalletAccountIds;
    const route = routeForWalletCount(walletIds.length);
    if (route === 'none') {
      // The store invariant should keep this unreachable in practice;
      // we still guard so a `useSyncSelectedWallet` race never lets us
      // POST with zero wallets.
      setStatusMessage('Select a wallet before submitting.');
      return;
    }

    // SOL-amount sell with a pending target: split it equally and fan out
    // one tokensIn sell per wallet. A TYPED SOL amount sets
    // `sellSolTargetMulti` for ANY wallet count (chips resolve the
    // single-wallet case to `sellAmountBaseUnits` directly), so the
    // fan-out must handle 1..N wallets — the 1-wallet case feeds the live
    // single-wallet balance into the plan (see `submitSolSellFanOut`).
    if (side === 'Sell' && sellChipMode === 'sol' && sellSolTargetMulti !== null) {
      await submitSolSellFanOut({
        solTarget: sellSolTargetMulti,
        walletIds,
        clickedAtMs,
        pressPerfAtMs,
      });
      return;
    }

    if (route === 'batch') {
      await submitBatchTrade({ num, walletIds, clickedAtMs, pressPerfAtMs });
      return;
    }

    await submitSingleTrade({
      num,
      walletAccountId: walletIds[0] ?? null,
      clickedAtMs,
      pressPerfAtMs,
    });
  };

  // Multi-wallet SOL-amount sell: equal-split the SOL target across the
  // selected wallets (like the equal-split buy), convert each share to a
  // token amount capped at that wallet's balance, then route through the
  // SAME batch endpoint as buys (one POST + parent order). Mirrors
  // `submitBatchTrade`'s child-toast + result handling.
  async function submitSolSellFanOut(input: {
    solTarget: number;
    walletIds: ReadonlyArray<string>;
    /** Button-press clock from `handleClick` (latency tracing). */
    clickedAtMs?: number;
    /** Monotonic press stamp (performance.now()) for the e2e waterfall. */
    pressPerfAtMs?: number;
  }): Promise<void> {
    const { solTarget, walletIds } = input;
    const clickedAtMs = input.clickedAtMs ?? Date.now();
    const pressPerfAtMs = input.pressPerfAtMs ?? performance.now();
    if (!mint) return;
    // Single-wallet mode: `multiTokenBalance` is the frozen EMPTY map
    // below 2 wallets, so feed the plan the live single-wallet balance
    // poll instead — the same source the SOL chips resolve against.
    // Optimistic floors still merge in via `mergeSellHintsWithFloors`.
    const singleWalletId = walletIds.length === 1 ? walletIds[0] : undefined;
    // Start the auth-token resolve BEFORE the bounded gate below so the
    // two cold costs overlap instead of serializing (observed live: gate
    // wait + cold Clerk mint back-to-back ≈ 2s press→POST). Resolution
    // only — the token is awaited (and the authorization decided) exactly
    // where it was before, inside the POST closure. `resolveOrderAuthToken`
    // never rejects, so an early return below cannot strand a rejection.
    let tokenReadyAtMs: number | undefined;
    let tokenReadyPerfAtMs: number | undefined;
    const authTokenPromise = resolveOrderAuthToken(getToken).then((token) => {
      tokenReadyAtMs = Date.now();
      tokenReadyPerfAtMs = performance.now();
      return token;
    });
    // Bounded auto-proceed instead of dropping the click: on cold paths
    // (fresh navigation, wallet switch) the live price / single-wallet
    // balance poll can resolve a beat after the press. Poll the LATEST
    // values via the mirror refs (this closure's `price` /
    // `stream.tokenBalanceInfo` are frozen at render time) and submit
    // with the ORIGINAL `clickedAtMs` the instant the data lands. The
    // synchronous first check keeps the warm path identical to today —
    // zero added latency when the data is already here.
    const gatesClear = (): boolean =>
      priceRef.current > 0 &&
      (singleWalletId === undefined || tokenBalanceInfoRef.current?.known === true);
    if (!gatesClear()) {
      const deadlineMs = Date.now() + 1_200;
      while (!gatesClear() && Date.now() < deadlineMs) {
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      if (!gatesClear()) {
        // Deadline expired — surface the same message the hard gate did.
        // (Balance gate: "no sellable balance" would be a lie — the user
        // may hold plenty; the poll just hasn't resolved.)
        setStatusMessage(
          priceRef.current > 0
            ? 'Balance still loading — try again in a second.'
            : 'No live price yet — try again in a moment.',
        );
        return;
      }
    }
    const gatesClearAtMs = Date.now();
    const gatesClearPerfAtMs = performance.now();
    const livePrice = priceRef.current;
    const tokenBalanceInfo = tokenBalanceInfoRef.current;
    const perWalletForPlan =
      singleWalletId !== undefined && tokenBalanceInfo?.known === true
        ? new Map([[singleWalletId, { tokens: tokenBalanceInfo.tokens, known: true }]])
        : multiTokenBalance.perWallet;
    const plan = planSolSellFanOut(
      solTarget,
      walletIds,
      mergeSellHintsWithFloors(perWalletForPlan, optimisticBalances, mint, walletIds),
      livePrice,
    );
    if (!plan) {
      setStatusMessage(
        walletIds.length === 1
          ? 'No sellable balance.'
          : 'No sellable balance in the selected wallets.',
      );
      return;
    }
    const { walletIds: fundedWalletIds, sellTokensInByWallet } = plan;
    const clientParentId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const input2: BatchOrderInput = {
      side: 'sell',
      clientParentId,
      walletAccountIds: fundedWalletIds,
      mint,
      graduated: token.graduated === true,
      sellTokensInByWallet,
      // Cross-quote: every child's proceeds swap SOL→USDC in-tx.
      ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
      maxSlippageBps: slippageBpsSell,
      priorityLamports: priorityLamportsSell,
      bribeLamports: bribeLamportsSell,
      sendMode: sendModeSell,
      origin: 'manual_ui',
      clientTsMs: clickedAtMs,
    };
    // The POST only needs `clientParentId` (child ids are server-derived
    // with the same SHA-256 scheme) — fire it BEFORE the SubtleCrypto
    // derivation so the order never serializes behind digest work; ids
    // and toasts are produced concurrently and correlated after.
    const resultPromise = (async () => {
      const authToken = await authTokenPromise;
      logPreSubmitTiming('sell fan-out', {
        pressAtMs: clickedAtMs,
        gatesClearAtMs,
        ...(tokenReadyAtMs !== undefined ? { tokenReadyAtMs } : {}),
        postStartAtMs: Date.now(),
      });
      // E2E waterfall press stamps (monotonic clock) — attached here so
      // the token-ready stamp from the overlapped resolve is included.
      return submitBatchOrder(
        {
          ...input2,
          timing: {
            pressAtMs: pressPerfAtMs,
            surface: 'panel',
            gatesClearAtMs: gatesClearPerfAtMs,
            ...(tokenReadyPerfAtMs !== undefined ? { tokenReadyAtMs: tokenReadyPerfAtMs } : {}),
          },
        },
        { authToken },
      );
    })();
    let childClientOrderIds: string[];
    try {
      childClientOrderIds = await Promise.all(
        fundedWalletIds.map((wid) => deriveChildClientOrderId(clientParentId, wid)),
      );
    } catch (err) {
      resultPromise.catch(() => undefined);
      setStatusMessage(`Error: ${(err as Error).message}`);
      return;
    }
    for (let i = 0; i < fundedWalletIds.length; i += 1) {
      const childId = childClientOrderIds[i];
      if (childId === undefined) continue;
      const walletId = fundedWalletIds[i] ?? null;
      registerOrderContext(childId, walletId, mint);
      // Per-wallet display amount comes from the plan's actual token
      // allocation (equal split capped at each wallet's balance), so the
      // toast matches what that wallet really sells.
      const plannedTokens = walletId === null ? undefined : sellTokensInByWallet[walletId];
      const toast: TradeToastItem = {
        id: childId,
        side: 'sell',
        phase: 'pending',
        solAmount:
          plannedTokens !== undefined
            ? tokensToSol(plannedTokens, livePrice) / 1e9
            : solTarget / fundedWalletIds.length,
        estimated: true,
        createdAt: Date.now(),
      };
      toastByClientIdRef.current.set(childId, toast.id);
      pushToast(toast);
    }
    let result: BatchOrderResult;
    try {
      result = await resultPromise;
    } catch (err) {
      const message = (err as Error).message ?? 'network_error';
      markBatchChildrenAsError(childClientOrderIds, message);
      setStatusMessage(`Error: ${message}`);
      return;
    }
    if (
      result.kind === 'ok' ||
      result.kind === 'partial_failed' ||
      result.kind === 'failed' ||
      result.kind === 'cancelled'
    ) {
      markFailedBatchChildren(result.children);
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      if (result.kind === 'failed') {
        setStatusMessage(`Batch failed (${result.parent.error_code ?? 'unknown'}).`);
      } else if (result.kind === 'partial_failed') {
        setStatusMessage('Batch partial: some wallets were skipped or failed (see toasts).');
      } else if (result.kind === 'cancelled') {
        setStatusMessage(messageForBatchCancel(result.children));
      } else {
        setStatusMessage(null);
      }
      return;
    }
    // B3: an aborted batch POST is indeterminate — the engine may be
    // filling every child right now. Keep the toasts PENDING (the
    // reconciliation flow resolves them from fills / order-status)
    // instead of marking failed and baiting a double-spend re-click.
    if (result.kind === 'unknown_outcome') {
      setStatusMessage('Batch still working — outcomes will update shortly.');
      return;
    }
    // Reauth: refresh /me so the trading-ready gate flips and prompts
    // for sign-in on the next interaction.
    if (result.kind === 'reauth') {
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
    const failureMessage = messageForBatchResult(result);
    markBatchChildrenAsError(childClientOrderIds, failureMessage);
    setStatusMessage(`Batch error: ${failureMessage}`);
  }

  async function submitSingleTrade(input: {
    num: number;
    walletAccountId: string | null;
    /** Button-press clock from `handleClick` (latency tracing). */
    clickedAtMs?: number;
    /** Monotonic press stamp (performance.now()) for the e2e waterfall. */
    pressPerfAtMs?: number;
  }): Promise<void> {
    const { num, walletAccountId } = input;
    const clickedAtMs = input.clickedAtMs ?? Date.now();
    const pressPerfAtMs = input.pressPerfAtMs ?? performance.now();
    if (!mint) return;
    let tokensIn = isBuy ? '0' : (sellAmountBaseUnits ?? Math.floor(num * 1_000_000).toString());
    if (!isBuy && selectedSellPct !== null) {
      // Percent mode: `num` IS a percent. With the balance still unknown
      // there is no token amount to show — leave it 0 so the toast omits
      // the amount instead of pricing "50" as 50 tokens.
      tokensIn = liveTokenBalance ? pctOfBaseUnits(liveTokenBalance, selectedSellPct) : '0';
    } else if (!isBuy && liveTokenBalance) {
      try {
        if (BigInt(tokensIn) <= 0n) {
          setStatusMessage('Live balance is too small to sell.');
          return;
        }
        if (BigInt(tokensIn) > BigInt(liveTokenBalance)) {
          setStatusMessage('Sell amount is above latest live balance.');
          return;
        }
      } catch {
        setStatusMessage('Invalid sell amount.');
        return;
      }
    }
    const clientOrderId = `ui-${crypto.randomUUID()}`;
    registerOrderContext(clientOrderId, walletAccountId, mint);
    // USDC buys size in dollars; the toast displays SOL, so convert via
    // the live SOL/USD rate (estimated) or omit the amount when absent.
    const usdcBuyToastSol =
      token.solUsd != null && token.solUsd > 0 ? num / token.solUsd : null;
    const pendingToast: TradeToastItem = {
      id: clientOrderId,
      side: isBuy ? 'buy' : 'sell',
      phase: 'pending',
      solAmount: isBuy
        ? buyInUsdc
          ? usdcBuyToastSol
          : num
        : selectedSellPct !== null && tokensIn === '0'
          ? null
          : tokensToSol(tokensIn, price) / 1e9,
      estimated: !isBuy || buyInUsdc,
      createdAt: Date.now(),
    };
    toastByClientIdRef.current.set(clientOrderId, pendingToast.id);
    pushToast(pendingToast);
    try {
      // Confirmed-buy instant hint: fold the wallet-scoped optimistic
      // floor (set on the buy `filled` fill) into the chain-poll balance
      // so a just-confirmed buy raises the sell hint without waiting for
      // the next poll. `max(chain, floor)` only reflects tokens already
      // landed on-chain by the confirmed buy.
      const latestSellBalanceHint =
        stream.tokenBalanceInfo?.known === true || optimisticFloor !== null
          ? mergeDisplayBalance(
              stream.tokenBalanceInfo?.known ? stream.tokenBalanceInfo.tokens : null,
              optimisticFloor,
            )
          : undefined;
      // Slice "Terminal wallet selector": attach `walletAccountId`
      // when the user has an active selection. `requireTradingReady`
      // above already gates on it being present + ready when
      // `selectedWallet` flowed through; we re-read here so the wire
      // snapshot is consistent with the click moment.
      const walletAccountIdField =
        typeof walletAccountId === 'string' ? { walletAccountId } : {};
      const args = isBuy
        ? {
            clientOrderId,
            side: 'buy' as const,
            mint,
            graduated: token.graduated === true,
            // USDC spend: the typed amount is dollars → integer micro
            // string. SOL spend keeps the exact legacy field.
            ...(buyInUsdc
              ? { usdcIn: usdToUsdcMicroDecimalString(num) }
              : { solIn: num }),
            maxSlippageBps: slippageBpsBuy,
            priorityLamports: priorityLamportsBuy,
            bribeLamports: bribeLamportsBuy,
            sendMode: sendModeBuy,
            clientTsMs: clickedAtMs,
            timing: { pressAtMs: pressPerfAtMs, surface: 'panel' },
            ...walletAccountIdField,
          }
        : {
            clientOrderId,
            side: 'sell' as const,
            mint,
            graduated: token.graduated === true,
            // Manual input is whole tokens; percentage chips keep exact raw
            // base units in `sellAmountBaseUnits`. Percentage sells attach the
            // latest active 50ms balance-poll snapshot so build sizing matches
            // the UI balance the click was based on.
            // Math.round: fractional percents (e.g. 0.29%) can yield a
            // non-integer under IEEE-754 (28.999999999999996 bps), which
            // the api's integer schema rejects as an opaque 400.
            ...(selectedSellPct !== null
              ? { sellPctBps: Math.round(selectedSellPct * 100) }
              : { tokensIn }),
            ...(selectedSellPct !== null && latestSellBalanceHint !== undefined
              ? { sellTokenBalanceHint: latestSellBalanceHint }
              : {}),
            // Cross-quote: the engine appends a SOL→USDC proceeds swap.
            ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
            maxSlippageBps: slippageBpsSell,
            priorityLamports: priorityLamportsSell,
            bribeLamports: bribeLamportsSell,
            sendMode: sendModeSell,
            clientTsMs: clickedAtMs,
            timing: { pressAtMs: pressPerfAtMs, surface: 'panel' },
            ...walletAccountIdField,
          };
      const result = await stream.submit(args);
      if (!result.accepted) {
        // The sync API path wraps engine kinds as `engine_<kind>` (see
        // api/src/trade/errors.ts TradingEngineRejected) and exposes the
        // unwrapped kind in the `engine_error_kind` extra — match both.
        if (
          result.error?.kind === 'preWarm.positionInsufficient' ||
          result.error?.['engine_error_kind'] === 'preWarm.positionInsufficient'
        ) {
          applyLiveHaveAmount(result.error);
        } else if (result.error?.kind === 'reauth_required') {
          // Human copy instead of the literal error kind. The /me
          // invalidation (done centrally in useTradeStream.submit) flips
          // the trading-ready gate, which handles the rest on next click.
          setStatusMessage(REAUTH_HUMAN_MESSAGE);
        } else {
          setStatusMessage(`Rejected: ${result.error?.kind ?? 'unknown'}`);
        }
        updateToast(pendingToast.id, {
          phase: 'error',
          error:
            result.error?.kind === 'reauth_required'
              ? REAUTH_HUMAN_MESSAGE
              : (result.error?.kind ?? 'Order rejected'),
        });
      } else {
        if (result.key) {
          toastByOrderKeyRef.current.set(orderKeyId(result.key), pendingToast.id);
        }
        setStatusMessage(null);
      }
    } catch (err) {
      setStatusMessage(`Error: ${(err as Error).message}`);
      updateToast(pendingToast.id, {
        phase: 'error',
        error: (err as Error).message,
      });
    }
  }

  async function submitBatchTrade(input: {
    num: number;
    walletIds: ReadonlyArray<string>;
    /** Button-press clock from `handleClick` (latency tracing). */
    clickedAtMs?: number;
    /** Monotonic press stamp (performance.now()) for the e2e waterfall. */
    pressPerfAtMs?: number;
  }): Promise<void> {
    const { num } = input;
    const clickedAtMs = input.clickedAtMs ?? Date.now();
    const pressPerfAtMs = input.pressPerfAtMs ?? performance.now();
    if (!mint) return;
    // Buy: amount input is the TOTAL — the api/ equal-splits per wallet.
    // Sell: percentage applies to each selected wallet's own balance.
    if (!isBuy && selectedSellPct === null) {
      setStatusMessage('Pick a percentage chip to sell from multiple wallets.');
      return;
    }
    // Percentage sells skip wallets KNOWN to hold zero of the mint
    // (e.g. just aggregated to primary) — those children only fail.
    const walletIds = isBuy
      ? input.walletIds
      : filterSellableWalletIds(
          multiTokenBalance.perWallet,
          optimisticBalances,
          mint,
          input.walletIds,
        );
    if (!isBuy && walletIds.length === 0) {
      setStatusMessage('No selected wallet holds this token.');
      return;
    }
    const clientParentId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Math.round: see the single-wallet sellPctBps site.
    const sellPercentBps = selectedSellPct !== null ? Math.round(selectedSellPct * 100) : 0;
    let input2: BatchOrderInput;
    if (isBuy) {
      input2 = {
        side: 'buy',
        clientParentId,
        walletAccountIds: walletIds,
        mint,
        graduated: token.graduated === true,
        ...(buyInUsdc
          ? { amountUsdcMicro: usdToUsdcMicroDecimalString(num) }
          : { amountLamports: solToLamportsDecimalString(num) }),
        maxSlippageBps: slippageBpsBuy,
        priorityLamports: priorityLamportsBuy,
        bribeLamports: bribeLamportsBuy,
        sendMode: sendModeBuy,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
      };
    } else {
      input2 = {
        side: 'sell',
        clientParentId,
        walletAccountIds: walletIds,
        mint,
        graduated: token.graduated === true,
        sellPercentBps,
        // Cross-quote: every child's proceeds swap SOL→USDC in-tx.
        ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
        maxSlippageBps: slippageBpsSell,
        priorityLamports: priorityLamportsSell,
        bribeLamports: bribeLamportsSell,
        sendMode: sendModeSell,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
        // Forward per-wallet balances so each child takes the engine's
        // hint short-circuit (mirrors the single-wallet sell). Without
        // this, batch children resolve from a cold per-wallet index /
        // fail-closed chain read and silently cancel as "no sellable
        // balance". Floors fold in each wallet's confirmed-buy delta so
        // a just-bought balance is hintable before the next poll.
        sellTokenBalanceHints: mergeSellHintsWithFloors(
          multiTokenBalance.perWallet,
          optimisticBalances,
          mint,
          walletIds,
        ),
      };
    }
    // Fire the POST FIRST — the body only needs `clientParentId` (child
    // ids are server-derived with the same SHA-256 scheme; see
    // api/src/routes/trade/batch-orders.ts `deriveChildClientOrderId`).
    // The per-child ids + toasts are produced concurrently below and the
    // SSE `accepted` / `submitted` / `filled` / `failed` events arrive
    // keyed on the same ids, so `applyOrderEventToToasts` lights each
    // toast up exactly as before — minus the digest wait on the order's
    // critical path.
    const resultPromise = (async () => {
      const authToken = await resolveOrderAuthToken(getToken);
      // E2E waterfall press stamps (monotonic clock), token resolve just
      // settled on this line.
      return submitBatchOrder(
        {
          ...input2,
          timing: {
            pressAtMs: pressPerfAtMs,
            surface: 'panel',
            tokenReadyAtMs: performance.now(),
          },
        },
        { authToken },
      );
    })();
    let childClientOrderIds: string[];
    try {
      childClientOrderIds = await Promise.all(
        walletIds.map((wid) => deriveChildClientOrderId(clientParentId, wid)),
      );
    } catch (err) {
      resultPromise.catch(() => undefined);
      setStatusMessage(`Error: ${(err as Error).message}`);
      return;
    }
    // USDC buys size in dollars; convert for the SOL-denominated toast
    // display (estimated) or omit the amount when no live rate exists.
    const perWalletDisplaySol = isBuy
      ? buyInUsdc
        ? token.solUsd != null && token.solUsd > 0
          ? num / token.solUsd / walletIds.length
          : null
        : num / walletIds.length
      : null;
    for (let i = 0; i < walletIds.length; i += 1) {
      const childId = childClientOrderIds[i];
      if (childId === undefined) continue;
      registerOrderContext(childId, walletIds[i] ?? null, mint);
      const toast: TradeToastItem = {
        id: childId,
        side: isBuy ? 'buy' : 'sell',
        phase: 'pending',
        solAmount: perWalletDisplaySol,
        estimated: !isBuy || buyInUsdc,
        createdAt: Date.now(),
      };
      toastByClientIdRef.current.set(childId, toast.id);
      pushToast(toast);
    }

    let result: BatchOrderResult;
    try {
      result = await resultPromise;
    } catch (err) {
      const message = (err as Error).message ?? 'network_error';
      markBatchChildrenAsError(childClientOrderIds, message);
      setStatusMessage(`Error: ${message}`);
      return;
    }

    if (
      result.kind === 'ok' ||
      result.kind === 'partial_failed' ||
      result.kind === 'failed' ||
      result.kind === 'cancelled'
    ) {
      markFailedBatchChildren(result.children);
      // The SSE stream will update each child toast as engine events
      // arrive. We still refresh the /me query so wallet trade_ready
      // / nonce_setup counters stay current.
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      if (result.kind === 'failed') {
        setStatusMessage(`Batch failed (${result.parent.error_code ?? 'unknown'}).`);
      } else if (result.kind === 'partial_failed') {
        setStatusMessage('Batch partial: some wallets were skipped or failed (see toasts).');
      } else if (result.kind === 'cancelled') {
        setStatusMessage(messageForBatchCancel(result.children));
      } else {
        setStatusMessage(null);
      }
      return;
    }
    // B3: aborted POST = unknown outcome — children may be filling at
    // the engine. Keep toasts PENDING for the reconciliation flow;
    // never mark failed (that baited double-spend re-clicks).
    if (result.kind === 'unknown_outcome') {
      setStatusMessage('Batch still working — outcomes will update shortly.');
      return;
    }
    // Reauth: refresh /me so the trading-ready gate flips and prompts
    // for sign-in on the next interaction.
    if (result.kind === 'reauth') {
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
    // Non-success branches: mark every pending child as error.
    const failureMessage = messageForBatchResult(result);
    markBatchChildrenAsError(childClientOrderIds, failureMessage);
    setStatusMessage(`Batch error: ${failureMessage}`);
  }

  function markBatchChildrenAsError(ids: ReadonlyArray<string>, message: string): void {
    for (const id of ids) {
      updateToast(id, { phase: 'error', error: message });
    }
  }

  function markFailedBatchChildren(
    children: ReadonlyArray<{
      client_order_id: string;
      state: string;
      error_code: string | null;
      error_kind: string | null;
    }>,
  ): void {
    resolveFailedBatchChildren(children, {
      markError: (id, error) => updateToast(id, { phase: 'error', error }),
      dismiss: dismissToast,
    });
  }

  function messageForBatchCancel(
    children: ReadonlyArray<{ error_code: string | null; error_kind: string | null }>,
  ): string {
    const errors = children.map((child) => child.error_code ?? child.error_kind ?? '');
    if (errors.every((error) => error === 'cancel.sell balance pending')) {
      return 'Sell already pending; waiting for wallet balances to sync.';
    }
    if (errors.every((error) => error === 'cancel.no sellable balance')) {
      return 'No sellable balance in the selected wallets.';
    }
    return 'Batch cancelled.';
  }

  function pushToast(toast: TradeToastItem) {
    setToasts((prev) => [...prev.filter((t) => t.id !== toast.id), toast].slice(-MAX_TRADE_TOASTS));
  }

  function updateToast(id: string, patch: Partial<TradeToastItem>) {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    for (const [clientId, toastId] of toastByClientIdRef.current) {
      if (toastId === id) toastByClientIdRef.current.delete(clientId);
    }
    for (const [orderKey, toastId] of toastByOrderKeyRef.current) {
      if (toastId === id) toastByOrderKeyRef.current.delete(orderKey);
    }
  }

  function applyOrderEventToToasts(event: TradeOrderEvent) {
    if (event.kind === 'accepted') {
      if (mint && event.intent.mint !== mint) return;
      // Advanced-order suborders (adv- ids, server-originated) are
      // toasted exclusively by the global TradeActivityToasts layer
      // (confirmed-only, DCA/Limit-labeled) — a panel toast here would
      // duplicate it. Skipping `accepted` keeps every later lifecycle
      // event unmapped in toastByOrderKeyRef, so none of them render.
      if (event.intent.clientOrderId.startsWith('adv-')) return;
      const existingToastId = toastByClientIdRef.current.get(event.intent.clientOrderId);
      const toastId = existingToastId ?? event.intent.clientOrderId;
      toastByClientIdRef.current.set(event.intent.clientOrderId, toastId);
      toastByOrderKeyRef.current.set(orderKeyId(event.key), toastId);
      if (!existingToastId) {
        const intentAmount = solAmountFromIntent(
          event,
          price,
          stream.tokenBalance ?? stream.position?.tokens ?? null,
        );
        pushToast({
          id: toastId,
          side: event.intent.side,
          phase: 'pending',
          solAmount: intentAmount.solAmount,
          estimated: intentAmount.estimated,
          createdAt: Date.now(),
        });
      }
      return;
    }

    const toastId = toastByOrderKeyRef.current.get(orderKeyId(event.key));
    if (!toastId) return;

    if (event.kind === 'submitted') {
      updateToast(toastId, { phase: 'submitted', signature: event.signature });
      return;
    }
    if (event.kind === 'confirmed') {
      updateToast(toastId, { phase: 'confirmed', signature: event.signature });
      setStatusMessage('Confirmed on-chain.');
      return;
    }
    if (event.kind === 'fill_pending') {
      updateToast(toastId, { phase: 'confirmed', signature: event.signature });
      setStatusMessage('Confirmed on-chain.');
      return;
    }
    if (event.kind === 'filled' || event.kind === 'partial') {
      // `confirmed` is the terminal user-facing phase (tx landed on a
      // slot). The fill itself is internal balance/DB bookkeeping — keep
      // the toast at confirmed instead of advancing to a success state.
      updateToast(toastId, { phase: 'confirmed', signature: event.fill.signature });
      return;
    }
    if (event.kind === 'failed') {
      if (event.error.kind === 'preWarm.positionInsufficient') {
        applyLiveHaveAmount(event.error);
      }
      updateToast(toastId, { phase: 'error', error: errorMessage(event.error) });
      return;
    }
    if (event.kind === 'cancelled') {
      if (event.reason === 'no sellable balance') {
        dismissToast(toastId);
        if (isBelowDisplaySellableBalance(liveTokenBalanceRef.current)) {
          setStatusMessage('No sellable balance to sell.');
        }
        return;
      }
      if (event.reason === 'sell balance pending') {
        dismissToast(toastId);
        return;
      }
      updateToast(toastId, { phase: 'error', error: event.reason });
    }
  }

  function errorMessage(error: { kind: string; [k: string]: unknown }): string {
    const cause = typeof error['cause'] === 'string' ? error['cause'] : null;
    if (isTurnkeySignTimeout(error.kind, cause)) return 'turnkey signing timed out';
    const message = typeof error['message'] === 'string' ? error['message'] : null;
    return cause ? `${error.kind}: ${cause}` : (message ?? error.kind);
  }

  function isTurnkeySignTimeout(kind: string, cause: string | null): boolean {
    return (
      kind.includes('turnkey_sign_timeout') ||
      cause === 'turnkey usage low' ||
      cause === 'turnkey signing timed out' ||
      (cause?.includes('turnkey_sign_timeout') ?? false)
    );
  }

  function applyLiveHaveAmount(error: { kind: string; [k: string]: unknown }): void {
    const have = typeof error['have'] === 'string' ? error['have'] : null;
    if (!have || have === '0') {
      setSelectedSellPct(null);
      setSellAmountBaseUnits(null);
      setSellAmount('0.0');
      setStatusMessage('Live wallet balance is 0 for this mint.');
      return;
    }
    setSelectedSellPct(null);
    setSellAmountBaseUnits(have);
    setSellAmount(baseUnitsToWholeTokenAmount(have));
    setStatusMessage(
      `Adjusted sell amount to live wallet balance: ${baseUnitsToWholeTokenAmount(have)} tokens`,
    );
  }

  return (
    <>
      <TradeToasts toasts={toasts} onDismiss={dismissToast} />
      <aside className="panel scroll-hide flex min-h-0 w-full flex-col gap-3 overflow-y-auto p-3 lg:h-full">
        <SideTabs onChange={setSide} isBuy={isBuy} />
        <OrderRow value={order} onChange={setOrder} mint={mint ?? null} />

        {/* Advanced-orders engine: the middle of the panel swaps on the
            order-type tab. 'Market' renders the existing body unchanged;
            'Limit' / 'Adv.' mount the advanced-orders forms. SideTabs,
            OrderRow (above) and the PnL strip (below) stay visible on
            every tab.

            The forms are taller than the Market body, and `.listen-root
            .panel { overflow: hidden }` out-specifies the aside's
            overflow-y-auto utility — so they scroll in their OWN
            container. The max-height cap keeps the tab (not the page)
            scrolling below the lg bound too, where the rail stacks and
            the aside has no height bound; --h-app-content is the
            ui-scale-compensated viewport budget, minus the panel's
            always-visible chrome (SideTabs + OrderRow + PnL strip). */}
        {order === 'Limit' || order === 'Adv.' ? (
          <div
            // flex-auto, NOT flex-1: below lg the aside is content-sized
            // (stacked layout, page scrolls) and a basis-0 child
            // contributes no height of its own — the wrapper renders
            // undersized and the form tail is unreachable. basis:auto
            // sizes to content, the maxHeight cap bounds it to the
            // viewport budget (internal scroll), and in the locked
            // desktop rail flex-shrink still bounds it to the rail.
            // [&>*]:shrink-0 is load-bearing: this is a HEIGHT-BOUNDED
            // flex column, so without it flex-shrink crushes the form's
            // children to min-content instead of overflowing into the
            // scrollbar — the submit CTA rendered 2px tall ("a teal
            // line") while scrollTop sat at max. Verified via
            // perf-harness/adv-probe.mjs at 1017x945.
            className="scroll-hide flex min-h-0 flex-auto flex-col gap-3 overflow-y-auto [&>*]:shrink-0"
            style={{ maxHeight: 'calc(var(--h-app-content, 100dvh) - 190px)' }}
          >
            {order === 'Limit' ? (
              <LimitTabBody
                token={token}
                mint={mint ?? null}
                priceLamportsPerBaseUnit={price}
                isBuy={isBuy}
              />
            ) : (
              <AdvancedTabBody
                token={token}
                mint={mint ?? null}
                priceLamportsPerBaseUnit={price}
              />
            )}
          </div>
        ) : (
          <>
        <AmountInput
          value={amount}
          unit={
            isBuy
              ? buyInUsdc
                ? 'usd'
                : 'sol'
              : sellChipMode === 'sol'
                ? 'sol'
                : 'pct'
          }
          onChange={(next) => {
            if (isBuy) {
              setBuyAmount(next);
              return;
            }
            setSellAmount(next);
            setSellAmountBaseUnits(null);
            if (sellChipMode === 'pct') {
              // Percent mode: the field is a % of holdings; the sync effect
              // recomputes the token base-units from the live balance.
              const p = Number(next);
              // Basis-point precision: "0.5" must execute as 0.5%, not
              // round to 1% while the field still shows 0.5.
              setSelectedSellPct(
                Number.isFinite(p) && p > 0
                  ? Math.min(Math.max(Math.round(p * 100) / 100, 0.01), 100)
                  : null,
              );
            } else {
              // SOL mode: the field is a SOL target, never a token count.
              // Route through the fan-out plan (handles 1..N wallets, caps
              // at each wallet's balance) so a typed value and a chip value
              // are interpreted identically — and a typed edit replaces any
              // previously clicked chip target.
              setSelectedSellPct(null);
              const sol = Number(next);
              setSellSolTargetMulti(Number.isFinite(sol) && sol > 0 ? sol : null);
            }
          }}
        />
        <QuickAmountChips
          side={side}
          // Buy chips on a USDC spend are dollar amounts from the
          // `quick_buy_usdc_micro` presets (the SOL chips editor is
          // hidden — it edits the SOL set, not this one).
          buyChipPrefix={isBuy && buyInUsdc ? '$' : undefined}
          sellMode={isBuy ? undefined : sellChipMode}
          onToggleSellMode={
            isBuy
              ? undefined
              : () => {
                  setSellChipMode(sellChipMode === 'pct' ? 'sol' : 'pct');
                  // Reset the pending sell amount so a "%" selection doesn't
                  // linger as a "SOL" value (or vice versa) after the swap.
                  setSelectedSellPct(null);
                  setSellAmountBaseUnits(null);
                  setSellSolTargetMulti(null);
                  setSellAmount('0.0');
                }
          }
          values={(isBuy
            ? buyInUsdc
              ? usdcQuickBuyMicro.map((micro) => micro / 1_000_000)
              : // The quickChips sets hold 8 values (row 1 + the instant
                // box's overflow row); this panel's single chip row shows
                // the first 4. The pencil editor still edits all 8.
                quickChips.buy.slice(0, 4)
            : sellChipMode === 'sol'
              ? quickChips.sellSol.slice(0, 4)
              : quickChips.sell.slice(0, 4)
          ).map((v) => String(v))}
          getPreview={
            isBuy
              ? // Approximate receive estimate: SOL chips through the venue
                // quote; $ chips (USDC presets) convert $→SOL at the live
                // rate first (same math as the cross-quote estimate row).
                (chip) =>
                  buyTokensPreview(
                    buyInUsdc
                      ? usdSpendLamports(Number(chip), token.solUsd ?? null)
                      : solSpendLamports(Number(chip)),
                    sellQuote,
                    price,
                    multiSelectedWalletAccountIds.length,
                  )
              : sellChipMode === 'sol'
                ? (chip) =>
                    sellSolPreview(
                      Number(chip),
                      price,
                      isMultiWalletTrade
                        ? multiTokenBalance.totalBaseUnits.toString()
                        : liveTokenBalance,
                    )
                : (chip) =>
                    sellPctPreview(
                      // Multi-wallet sell: hover preview reflects the
                      // summed token balance across all selected
                      // wallets. Single-wallet stays on the focused
                      // wallet's live balance.
                      isMultiWalletTrade
                        ? multiTokenBalance.totalBaseUnits.toString()
                        : liveTokenBalance,
                      Number(chip),
                      price,
                      sellQuote,
                      receiveUsdRate,
                    )
          }
          onPick={(chip) => {
            if (isBuy) {
              setBuyAmount(chip);
              setSellAmountBaseUnits(null);
              setSelectedSellPct(null);
              setSellSolTargetMulti(null);
              return;
            }
            // Sell, SOL mode: the chip is a SOL TARGET ("sell ~N SOL worth
            // of tokens"). Convert the SOL target to token base units via
            // the live spot price and route through the existing typed
            // (`tokensIn`) sell path — slippage is bounded by the order's
            // maxSlippageBps, so the realized SOL out tracks the target.
            if (sellChipMode === 'sol') {
              const solTarget = Number(chip);
              if (!price || price <= 0) {
                setStatusMessage('No live price yet — try again in a moment.');
                return;
              }
              // Multi-wallet: split the SOL target EQUALLY across the
              // selected wallets (like the equal-split buy — 3 SOL across 3
              // wallets = 1 SOL each). Keep the SOL target and convert it
              // per-wallet at submit; the order fans out into one tokensIn
              // sell per wallet.
              if (isMultiWalletTrade) {
                setSelectedSellPct(null);
                setSellAmountBaseUnits(null);
                setSellSolTargetMulti(solTarget);
                setSellAmount(String(chip));
                setStatusMessage(
                  `≈ ${chip} SOL split across ${multiSelectedWalletAccountIds.length} wallets`,
                );
                return;
              }
              const balance = safeBigIntOrZero(liveTokenBalance);
              if (balance <= 0n) {
                setSelectedSellPct(null);
                setStatusMessage('No live wallet balance for this mint.');
                return;
              }
              let tokenBaseUnits = BigInt(Math.floor((solTarget * 1e9) / price));
              // Never oversell: cap the SOL target at the full holdings.
              if (tokenBaseUnits > balance) tokenBaseUnits = balance;
              if (tokenBaseUnits <= 0n) {
                setStatusMessage(`Balance is too small to sell ${chip} SOL worth.`);
                return;
              }
              const baseUnitsStr = tokenBaseUnits.toString();
              setSelectedSellPct(null);
              setSellSolTargetMulti(null);
              setSellAmountBaseUnits(baseUnitsStr);
              // Field shows the SOL target (matching the 'sol' unit glyph);
              // the converted token base-units above drive execution.
              setSellAmount(String(chip));
              setStatusMessage(
                `≈ ${chip} SOL = ${formatTokenAmount(baseUnitsStr)} tokens`,
              );
              return;
            }
            // Sell, percentage mode: chip is a percentage of holdings.
            const pct = Number(chip);
            setSellSolTargetMulti(null);
            // Slice "Multi-wallet split buy/sell orders" (UI revision):
            // when the user has selected 2+ wallets in the popover the
            // percentage applies to EACH wallet's own balance,
            // computed at the trading engine via
            // `readChainTokenBalance(mint, walletPubkey)` per child.
            // The focused wallet's `positionTokens` (Aurora-backed,
            // written by the persister AFTER on-chain confirm) is
            // irrelevant for the OTHER wallets and may be stale for
            // ~10–30 s after a fresh buy. So we set `selectedSellPct`
            // unconditionally for multi-wallet trades; the single-
            // wallet path keeps the existing balance gate so a sell
            // with no basis stays blocked at the UI.
            // The amount field shows the PERCENT (e.g. "25"); the matching
            // token base-units (for the estimate + execution) are computed
            // from the live balance and kept fresh by the sync effect above.
            setSelectedSellPct(pct);
            setSellAmount(String(pct));
            if (isMultiWalletTrade) {
              setStatusMessage(
                `Multi-wallet: each selected wallet sells ${chip}% of its own balance.`,
              );
              return;
            }
            if (liveTokenBalance && positionTokens > 0) {
              const rawAmount = pctOfBaseUnits(liveTokenBalance, pct);
              setSellAmountBaseUnits(rawAmount !== '0' ? rawAmount : null);
              setStatusMessage(
                rawAmount !== '0'
                  ? `${chip}% = ${formatTokenAmount(rawAmount)} tokens`
                  : 'Balance is too small to sell with this chip.',
              );
            } else {
              setSellAmountBaseUnits(null);
              setStatusMessage('Waiting for live wallet balance for this mint…');
            }
          }}
        />

        {/* USDC spend surfaces: wallet USDC balance next to the input
            (with the insufficient state) + the cross-quote fallback
            notice for USDC mode on a SOL pair. Both render nothing on
            SOL pairs in SOL mode. */}
        {isBuy && buyInUsdc ? (
          <div
            className="flex items-center justify-between"
            style={{ fontSize: 11, color: 'var(--ink-3)' }}
          >
            <span>USDC balance</span>
            <span
              className="tabular-nums"
              style={{
                fontFamily: 'var(--mono)',
                color: usdcInsufficient ? 'var(--down)' : 'var(--ink-1)',
              }}
            >
              {usdcWalletBalance.usdcMicro !== null
                ? formatUsdcMicro(usdcWalletBalance.usdcMicro)
                : '—'}
              {usdcInsufficient ? ' — insufficient' : ''}
            </span>
          </div>
        ) : null}
        {/* The SOL mirror of the row above. Renders only on a SOL buy,
            and only for a single-wallet trade — the same conditions
            under which `solInsufficient` can be answered honestly.
            A wallet whose balance has not resolved shows "—" and no
            insufficient state: silence beats a wrong verdict. */}
        {isBuy && !buyInUsdc && !isMultiWalletTrade ? (
          <div
            className="flex items-center justify-between"
            style={{ fontSize: 11, color: 'var(--ink-3)' }}
          >
            <span>SOL balance</span>
            <span
              className="tabular-nums"
              data-testid="trade-sol-balance"
              style={{
                fontFamily: 'var(--mono)',
                color: solInsufficient ? 'var(--down)' : 'var(--ink-1)',
              }}
            >
              {solWalletBalance.lamports !== null ? `${solWalletBalance.label} SOL` : '—'}
              {solInsufficient ? ' — insufficient' : ''}
            </span>
          </div>
        ) : null}
        {isBuy && spend.crossQuote && crossQuoteBuyTokenEst !== null ? (
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {`≈ ${crossQuoteBuyTokenEst} tokens (approx — swap tolerance + slippage apply)`}
          </div>
        ) : null}
        {/* SettingsReadout shows the fees that will be applied to
            the user's NEXT click. Each value matches the current
            side tab (buy or sell), so the readout stays in sync
            with what the engine receives at submit-time. The
            trailing P1/P2/P3 cluster lets the user switch the
            global active preset directly from the trade page —
            click flips `tradePresets.active_index`, which atomically
            updates the slippage/priority/bribe values rendered to
            the left and the values that the next click will ship. */}
        <SettingsReadout
          slippageBps={side === 'Buy' ? slippageBpsBuy : slippageBpsSell}
          priorityLamports={side === 'Buy' ? priorityLamportsBuy : priorityLamportsSell}
          bribeLamports={side === 'Buy' ? bribeLamportsBuy : bribeLamportsSell}
        />

        {/* Buy and Sell both read "<side> <symbol>", centered. The Sell
            side's estimated SOL received is surfaced via the native
            `title` tooltip rather than an in-button overlay — that overlay
            was a direct child, and `.sell-cta > * { position: relative }`
            overrode its `absolute`, turning it into an in-flow sibling that
            pushed the label off-center. */}
        <button
          type="button"
          className={isBuy ? 'buy-cta' : 'sell-cta'}
          // Submit at pointerdown instead of click: a click waits for
          // pointer-up, paying the 60-120ms press duration on the order's
          // critical path. Press-scoped dedupe semantics documented at
          // `ctaPressSubmittedRef` (mirrors InstantTradeBox's QuickChip).
          // Pre-press token warm. `handleClick` already warms at
          // pointerdown, but the CTA submits at pointerdown too, so that
          // head start is ~0. Hover/focus lands tens-to-hundreds of ms
          // earlier, which is the whole margin on a cold mirror: a
          // returning user whose Clerk JWT expired while the tab was
          // hidden otherwise races `ORDER_TOKEN_WAIT_MS`, and losing that
          // race LOSES THE CLICK — `shouldRetryReauth` requires the POST
          // to have carried a bearer, so a token-less submit is not
          // retried. Single-flighted and a synchronous no-op when the
          // mirror is warm, so hovering costs nothing.
          onPointerEnter={() => warmOrderAuthToken(getToken)}
          onFocus={() => warmOrderAuthToken(getToken)}
          onPointerDown={(event) => {
            ctaPointerDownAtMsRef.current = Date.now();
            ctaPointerDownPerfAtMsRef.current = performance.now();
            if (event.button !== 0) return;
            ctaPressSubmittedRef.current = true;
            ctaPointerFiredAtRef.current = Date.now();
            void handleClick();
          }}
          onPointerCancel={() => {
            ctaPressSubmittedRef.current = false;
            ctaPointerFiredAtRef.current = 0;
          }}
          onClick={(event) => {
            if (event.detail > 0) {
              if (ctaPressSubmittedRef.current) {
                // Same-press synthetic click — already submitted at
                // pointerdown, however long the press was held. Clear the
                // AT stamp too so a keyboard activation right after a
                // click is never mistaken for the same press.
                ctaPressSubmittedRef.current = false;
                ctaPointerFiredAtRef.current = 0;
                return;
              }
              void handleClick();
              return;
            }
            if (Date.now() - ctaPointerFiredAtRef.current < 750) return;
            void handleClick();
          }}
          title={isBuy ? buyButtonPreview : sellButtonPreview}
        >
          <span>{`${side} ${token.symbol}`}</span>
        </button>
        {statusMessage && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{statusMessage}</div>
        )}
          </>
        )}
        <div
          className="mt-1 grid grid-cols-4 pt-3"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <PnLCell label="Bought" value={pnl.bought} valueTone="up" sol divider />
          <PnLCell label="Sold" value={pnl.sold} valueTone="down" sol divider />
          <PnLCell label="Holding" value={pnl.holding} sol divider />
          <PnLCell label="PnL" value={pnl.pnl} valueTone={pnlTone} />
        </div>
      </aside>
    </>
  );
}

/* ─── Sub-blocks ─────────────────────────────────────────────────────── */

function SideTabs({ onChange, isBuy }: { onChange: (s: Side) => void; isBuy: boolean }) {
  return (
    <div className="seg" style={{ width: '100%' }}>
      <button
        type="button"
        onClick={() => onChange('Buy')}
        className={`seg__btn seg__btn--buy flex-1 ${isBuy ? 'active' : ''}`}
        style={{ height: 34, fontSize: 13 }}
      >
        Buy
      </button>
      <button
        type="button"
        onClick={() => onChange('Sell')}
        className={`seg__btn seg__btn--sell flex-1 ${!isBuy ? 'active' : ''}`}
        style={{ height: 34, fontSize: 13 }}
      >
        Sell
      </button>
    </div>
  );
}

function OrderRow({
  value,
  onChange,
  mint,
}: {
  value: OrderType;
  onChange: (o: OrderType) => void;
  mint?: string | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="seg">
        {ORDER_TYPES.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`seg__btn ${value === o ? 'active' : ''}`}
          >
            {o}
          </button>
        ))}
      </div>
      {/*
       * Slice "Multi-wallet split buy/sell orders" (UI revision):
       * compact wallet-count button — opens a popover with the
       * wallet selector. Selecting N wallets routes the next submit
       * via the batch endpoint; selecting 1 keeps the single-order
       * path. Always shows the integer count; the store invariant
       * guarantees the count is >= 1 after the first sync.
       *
       * The legacy "Calendar 1 / 0" mini-button that lived here is
       * removed; the wallet-count button now shares the right side of
       * the order-type segment with the SOL/USDC trade-mode toggle.
       */}
      <div className="flex items-center gap-2">
        <QuoteModeToggle />
        <WalletCountButton mint={mint ?? null} />
      </div>
    </div>
  );
}

function AmountInput({
  value,
  onChange,
  unit,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Trailing unit: `sol` renders the Solana mark, `pct` renders "%",
   *  `usd` renders "$" (USDC-denominated buys). */
  unit: 'sol' | 'pct' | 'usd';
}) {
  return (
    <div className="amt-input">
      <Caption size="sm" tone="ink-3">
        Amount
      </Caption>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          // Keystroke whitelist (mirrors TransferModal): digits, one dot,
          // up to 9 decimals. Blocks hex / exponent / sign characters at
          // the source so the submit parser never sees them.
          if (!isAllowedAmountInput(e.target.value)) return;
          onChange(e.target.value);
        }}
        className="min-w-0 flex-1 border-0 bg-transparent text-right text-[14px] tabular-nums outline-none"
        style={{
          color: 'var(--ink-0)',
          fontFamily: 'var(--mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      {/* Trailing unit: SOL-denominated amounts get the Solana mark;
          percentage-of-holdings amounts show a plain "%"; USDC buys "$". */}
      <span className="inline-flex shrink-0 items-center justify-center" aria-hidden>
        {unit === 'sol' ? (
          <Solana style={{ width: 14, height: 14, display: 'block' }} />
        ) : (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-3)' }}>
            {unit === 'usd' ? '$' : '%'}
          </span>
        )}
      </span>
    </div>
  );
}

function QuickAmountChips({
  side,
  values,
  onPick,
  getPreview,
  sellMode,
  onToggleSellMode,
  buyChipPrefix,
}: {
  side: Side;
  values: ReadonlyArray<string>;
  onPick: (amt: string) => void;
  getPreview?: (amt: string) => string | undefined;
  /** Sell-only: the active unit + a toggle. Undefined on the Buy side. */
  sellMode?: SellChipMode;
  onToggleSellMode?: () => void;
  /** Buy-only display prefix ("$" for USDC chips). When set, the chips
   *  are the USDC preset set and the SOL chips editor cell is hidden
   *  (it edits the SOL set; the 5 USDC chips fill the grid instead). */
  buyChipPrefix?: string;
}) {
  // Editor target: Buy edits `buy` (SOL) or the USDC presets when the
  // chips render dollars; Sell edits whichever set the active mode
  // points at (percentages or SOL amounts).
  const buyInUsdc = side === 'Buy' && buyChipPrefix !== undefined;
  const editorField: 'buy' | 'sell' | 'sellSol' | 'usdcBuy' =
    side === 'Buy' ? (buyInUsdc ? 'usdcBuy' : 'buy') : sellMode === 'sol' ? 'sellSol' : 'sell';
  const editorUnit: 'sol' | 'pct' | 'usd' = buyInUsdc
    ? 'usd'
    : side === 'Buy' || sellMode === 'sol'
      ? 'sol'
      : 'pct';
  const editorTitle =
    side === 'Buy' ? 'Buy amounts' : sellMode === 'sol' ? 'Sell SOL amounts' : 'Sell percentages';
  return (
    /* USDC buys render 5 chips + the editor pencil (6 cells); SOL buys
       and sells render 4 values + the editor/toggle cell (5 cells). */
    <div className={buyInUsdc ? 'grid grid-cols-6 gap-1' : 'grid grid-cols-5 gap-1'}>
      {values.map((amt, chipIndex) => {
        const preview = getPreview?.(amt);
        return (
          <HoverPreview key={`${chipIndex}-${amt}`} label={preview}>
            <button
              type="button"
              onClick={() => onPick(amt)}
              className={`amt-chip group relative${side === 'Sell' ? ' amt-chip--sell' : ''}`}
              style={{ minWidth: 0, width: '100%', overflow: 'visible' }}
            >
              {buyChipPrefix ? `${buyChipPrefix}${amt}` : amt}
            </button>
          </HoverPreview>
        );
      })}
      {/* Last cell: Buy shows just the editor pencil (USDC mode edits
          the dollar presets). Sell pairs a unit toggle (% <-> SOL) with
          a compact pencil so both fit one cell. */}
      {side === 'Sell' && sellMode && onToggleSellMode ? (
        <div className="flex min-w-0 gap-1">
          <button
            type="button"
            onClick={onToggleSellMode}
            aria-label={`Sell unit: ${sellMode === 'pct' ? 'percent' : 'SOL'}. Toggle.`}
            title={
              sellMode === 'pct'
                ? 'Selling % of holdings — switch to SOL'
                : 'Selling a SOL amount — switch to %'
            }
            className="amt-chip amt-chip--sell"
            style={{ minWidth: 0, flex: '1 1 0', padding: 0 }}
          >
            {sellMode === 'pct' ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>%</span>
            ) : (
              <Solana style={{ width: 13, height: 13, display: 'block' }} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <QuickChipsEditor field={editorField} unit={editorUnit} title={editorTitle} sell />
          </div>
        </div>
      ) : (
        <QuickChipsEditor field={editorField} unit={editorUnit} title={editorTitle} />
      )}
    </div>
  );
}

/** Format an est-receive amount: `$` when the pair settles in USDC
 *  (usdRate = live SOL/USD), SOL otherwise. */
function formatReceive(lamports: number, usdRate: number | null): string {
  if (usdRate != null) return formatUsdAmount((lamports / 1e9) * usdRate);
  return formatSol(lamports, 4);
}

function sellPctPreview(
  tokenBalance: string | undefined,
  pct: number,
  priceLamportsPerBaseUnit: number,
  quote: TradeSellQuoteInfo | null,
  receiveUsdRate: number | null,
): string {
  const rawAmount = pctOfBaseUnits(tokenBalance, pct);
  if (rawAmount === '0') return `Est. receive: ${receiveUsdRate != null ? '$0' : '0 SOL'}`;
  return `Est. receive: ${formatReceive(estimateSellLamports(rawAmount, quote, priceLamportsPerBaseUnit), receiveUsdRate)}`;
}

/** Hover preview for a SOL-mode sell chip: how many tokens ~N SOL buys back
 *  at the live spot price, capped at the wallet's holdings. */
function sellSolPreview(
  solTarget: number,
  priceLamportsPerBaseUnit: number,
  tokenBalance: string | undefined,
): string {
  if (!priceLamportsPerBaseUnit || priceLamportsPerBaseUnit <= 0) return 'Sell ~? tokens';
  let baseUnits = BigInt(Math.floor((solTarget * 1e9) / priceLamportsPerBaseUnit));
  const balance = safeBigIntOrZero(tokenBalance);
  if (balance > 0n && baseUnits > balance) baseUnits = balance;
  if (baseUnits <= 0n) return 'Sell ~0 tokens';
  return `Sell ~${formatTokenAmount(baseUnits.toString())} tokens`;
}

/** Integer lamports for a SOL spend; 0n on garbage. Preview-only. */
function solSpendLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol <= 0) return 0n;
  try {
    return BigInt(Math.floor(sol * 1e9));
  } catch {
    return 0n;
  }
}

/**
 * Does the typed SOL spend exceed the selected wallet's known balance?
 *
 * DISPLAY ONLY, and deliberately so. It tints the balance row and adds
 * the word "insufficient"; it does NOT gate the CTA, and nothing may
 * make it. The engine is the arbiter of whether a trade can happen —
 * the attempt always goes out and an underfunded one fails with the
 * chain's own rejection, never with a button this file greyed out on a
 * balance that could be seconds stale.
 *
 * FALSE whenever the answer is not knowable: no balance yet, a USDC or
 * sell surface, or a multi-wallet trade — there the typed amount is the
 * TOTAL the api equal-splits, so one wallet's balance says nothing.
 * Raw lamports throughout, so display rounding cannot flip the state.
 */
export function solSpendExceedsBalance(input: {
  readonly isSolBuy: boolean;
  readonly isMultiWalletTrade: boolean;
  readonly balanceLamports: string | null;
  readonly typedAmount: string;
}): boolean {
  if (!input.isSolBuy || input.isMultiWalletTrade) return false;
  if (input.balanceLamports === null) return false;
  const typed = parseTradeAmount(input.typedAmount);
  if (typed === null || typed <= 0) return false;
  const needed = solSpendLamports(typed);
  if (needed <= 0n) return false;
  try {
    return needed > BigInt(input.balanceLamports);
  } catch {
    return false;
  }
}

/** $ spend converted to lamports at the live SOL/USD rate; 0n without a
 *  rate. Preview-only. */
function usdSpendLamports(usd: number, solUsd: number | null): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || solUsd == null || solUsd <= 0) return 0n;
  return solSpendLamports(usd / solUsd);
}

/**
 * Hover/title preview for a buy spend: approximate tokens received via
 * the venue quote (constant-product + fee haircut), spot-price fallback
 * when no quote is polled yet. Approximate — the engine applies swap
 * tolerance + the user's slippage at execution. Multi-wallet amounts are
 * the TOTAL spend (the api equal-splits), noted in the copy.
 */
function buyTokensPreview(
  spendLamports: bigint,
  quote: TradeSellQuoteInfo | null,
  priceLamportsPerBaseUnit: number,
  walletCount: number,
): string | undefined {
  if (spendLamports <= 0n) return undefined;
  const tokens = estimateBuyTokens(spendLamports.toString(10), quote, priceLamportsPerBaseUnit);
  if (tokens <= 0n) return undefined;
  const suffix = walletCount >= 2 ? ` across ${walletCount} wallets` : '';
  return `≈ ${formatTokenAmount(tokens.toString(10))} tokens (approx)${suffix}`;
}

function safeBigIntOrZero(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function sellCtaSolAmount(
  sellAmountBaseUnits: string | null,
  sellAmount: string,
  priceLamportsPerBaseUnit: number,
  quote: TradeSellQuoteInfo | null,
  receiveUsdRate: number | null,
): string {
  const baseUnits = sellAmountBaseUnits ?? wholeTokensToBaseUnits(sellAmount);
  if (baseUnits === '0') return receiveUsdRate != null ? '$0' : '0 SOL';
  return formatReceive(
    estimateSellLamports(baseUnits, quote, priceLamportsPerBaseUnit),
    receiveUsdRate,
  );
}

function wholeTokensToBaseUnits(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.floor(n * 1_000_000).toString();
}

// Slice "Multi-wallet split buy/sell orders" (UI revision): integer
// lamports as a decimal string. The api/ batch route expects
// `amount_lamports` as a positive-integer string (matching the Ajv
// schema in api/src/routes/trade/batch-orders.ts). Guarded like the
// InstantTradeBox copy: huge inputs make `toFixed(9)` emit scientific
// notation, which would make `BigInt()` throw at the call site (outside
// the submit try/catch) and strand every pending child toast.
function solToLamportsDecimalString(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0';
  const [whole, frac = ''] = sol.toFixed(9).split('.');
  const padded = frac.padEnd(9, '0').slice(0, 9);
  try {
    return (BigInt(whole ?? '0') * 1_000_000_000n + BigInt(padded || '0')).toString(10);
  } catch {
    return '0';
  }
}

function messageForBatchResult(result: BatchOrderResult): string {
  switch (result.kind) {
    case 'reauth':
      return REAUTH_HUMAN_MESSAGE;
    case 'network_error':
      return result.reason || 'network_error';
    case 'unknown_outcome':
      // Handled before this helper is consulted (toasts stay pending);
      // copy kept for exhaustiveness.
      return 'batch outcome unknown — reconciling';
    case 'invalid_input':
      return result.reason;
    case 'in_flight':
      return 'A previous batch with this id is still in flight.';
    case 'error':
      return result.message || result.errorCode || 'request failed';
    case 'ok':
    case 'partial_failed':
    case 'failed':
    case 'cancelled':
      // The parent-bearing branches are handled separately in
      // `submitBatchTrade`; this helper is only consulted for the
      // non-success result kinds.
      return 'unknown';
    default: {
      const _exhaustive: never = result;
      void _exhaustive;
      return 'unknown';
    }
  }
}

function messageForTradingReadyDecision(
  decision: ReturnType<typeof useRequireTradingReady>['decision'],
): string {
  switch (decision.kind) {
    case 'trading_disconnected':
      return decision.state === 'offline'
        ? 'Trading connection offline; reconnecting...'
        : 'Trading connection syncing; try again in a moment.';
    case 'authorization_not_ready':
      return decision.state === 'refreshing'
        ? 'Refreshing trading authorization...'
        : 'Trading authorization is not ready yet.';
    case 'loading':
      return 'Loading wallet state...';
    case 'needs_sign_in':
      return 'Sign in required.';
    case 'needs_wallet_setup':
    case 'needs_wallet_selection':
    case 'needs_per_wallet_setup':
    case 'wallet_unavailable':
      return 'Wallet setup required.';
    case 'ready':
      return '';
  }
}

function PnLCell({
  label,
  value,
  valueTone,
  divider,
  sol,
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  divider?: boolean;
  /** Prefix the value with the small SOL logomark (SOL-denominated cells). */
  sol?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-col items-center gap-1.5 px-1.5"
      style={divider ? { borderRight: '1px solid var(--hairline)' } : undefined}
    >
      <Caption size="sm" tone="ink-3">
        {label}
      </Caption>
      <span className="flex min-w-0 items-center gap-1">
        {sol ? <Solana style={{ width: 9, height: 9, flexShrink: 0 }} /> : null}
        <Numeral
          size="xs"
          tone={valueTone ?? 'ink-1'}
          className="whitespace-nowrap"
          style={{ fontSize: '10px' }}
        >
          {value}
        </Numeral>
      </span>
    </div>
  );
}

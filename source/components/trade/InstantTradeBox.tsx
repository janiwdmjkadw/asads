import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './instant-trade.css';
import { useQueryClient } from '@tanstack/react-query';
import { Solana } from '@/components/listen/icons/Icons';
import { Caption, Numeral, type Tone } from '@/components/listen/primitives';
import { cn } from '@/lib/utils';
import { formatSolCompact } from '@/lib/format';
import { ActivePresetSelector, SettingsReadout } from './SettingsReadout';
import { planSolSellFanOut } from './sellSizing';
import { QuickChipsEditor } from './QuickChipsEditor';
import { QuoteModeToggle } from './QuoteModeToggle';
import { WalletCountButton } from './WalletCountButton';
import {
  isUsdcPair,
  resolveSpendCurrency,
  usdToUsdcMicroDecimalString,
} from '@/lib/trade/spend-currency';
import { formatUsdAmount } from '@/lib/format';
import { HoverPreview } from './HoverPreview';
import {
  BAR_PAD_Y,
  BODY_INSET,
  BODY_PAD_Y,
  CHIP_GRID,
  GROUP_GAP,
  PANEL_RADIUS,
  SECTION_GAP,
  instantChip,
  statusTone,
  type ChipSide,
} from './instant-trade-styles';
import { useTradeStore } from '@/lib/state/trade-store';
import { useFloatingPanelZ } from '@/lib/state/floating-panel-order';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import {
  RESIZE_EDGES,
  resizeHandleStyle,
  shouldStartSurfaceDrag,
  useFloatingBox,
} from '@/components/listen/useFloatingBox';
import type { MockPnL, MockToken } from './mockTrade';
import type {
  TradeOrderEvent,
  TradeOrderKey,
  TradeSellQuoteInfo,
  UseTradeStream,
} from './useTradeStream';
import { unlockTradeSuccessSound } from './tradeSound';
import { estimateBuyTokens, estimateSellLamports, pctOfBaseUnits } from './sellEstimate';
import { formatTokenAmount } from './formatTokenAmount';
import { readDisplayBalance } from './balanceDisplayCache';
import { routeForWalletCount } from './walletCountRoute';
import {
  filterSellableWalletIds,
  mergeSellHintsWithFloors,
  type MultiWalletTokenBalance,
} from './useMultiWalletTokenBalance';
import { deriveChildClientOrderId, submitBatchOrder, type BatchOrderInput } from '@/lib/api/orders';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { resolveOrderAuthToken, warmOrderAuthToken } from '@/lib/auth/orderAuthToken';
import {
  mergeDisplayBalance,
  readOptimisticBalance,
  useTradeActivityStore,
} from '@/lib/state/trade-activity-store';
import { useTradeLedger } from './useTradeLedger';
import { ledgerToPnl } from './ledgerPnl';
import { REAUTH_HUMAN_MESSAGE } from './reauthMessage';

interface Props {
  token: MockToken;
  mint?: string;
  priceLamportsPerBaseUnit: number;
  initialAnchor: DOMRectReadOnly | null;
  stream: UseTradeStream;
  walletBalance: string;
  /** Shared multi-wallet token-balance snapshot, owned by TradePage so
   *  this box and the main TradePanel never double-poll. */
  multiTokenBalance: MultiWalletTokenBalance;
  onClose: () => void;
}

// Temporarily hide the custom SOL amount input + Buy button (chips only).
const SHOW_CUSTOM_BUY_INPUT = false;

// Every rendered chip — row 1 (chips 1-4) AND the overflow row 2 (chips
// 5-8, revealed when the panel is tall enough — see useFittingRows) —
// comes from the user's editable `trade-store.quickChips`, so the pencil
// editors edit exactly what the box shows. The old hardcoded overflow
// pools live on only as the store's default values for chips 5-8.
function chipStrings(values: ReadonlyArray<number | string>): string[] {
  return values.map(String);
}

// Row geometry — must match `CHIP_GRID` (auto-rows-[2.25rem] = 36px,
// gap-1.5 = 6px). Used to compute how many fixed-height rows fit.
const CHIP_ROW_PX = 36;
const CHIP_ROW_GAP_PX = 6;
/* One. The store holds four amounts per side now, so a second row could
   only ever be empty. */
const MAX_CHIP_ROWS = 1;

type SellMode = 'pct' | 'sol';

/**
 * Measure a chip area and return how many whole rows of chips fit (1..max).
 * A `ResizeObserver` keeps it live, so growing the panel reveals another row
 * of presets instead of stretching the existing ones.
 */
function useFittingRows() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const fit = Math.floor((el.clientHeight + CHIP_ROW_GAP_PX) / (CHIP_ROW_PX + CHIP_ROW_GAP_PX));
      const next = Math.max(1, Math.min(MAX_CHIP_ROWS, fit));
      setRows((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, rows };
}
const BOX_STORAGE_KEY = 'trade:instant-box-rect:v6';
/** Visual scale of the panel content (user ask: 33% smaller). Applied as
 *  CSS zoom on the content wrapper: unlike transform, zoom participates
 *  in layout, keeps text crisp, and reports element metrics in logical
 *  px — so useFittingRows and the drag/resize plumbing need no changes. */
const BOX_SCALE = 0.77;
const DISPLAY_ZERO_SOL = 0.000001;
const MIN_DISPLAY_SELLABLE_BASE_UNITS = 10_000n; // 0.01 token with 6 decimals.

/* There is no session on this build, so the token resolves to nothing
   and every caller takes its own "no token" path. */
const ALWAYS_UNAUTHENTICATED = async (): Promise<string | null> => null;

const NOT_WIRED_MESSAGE = 'Orders are not wired up on this build.';

export function InstantTradeBox({
  token,
  mint,
  priceLamportsPerBaseUnit,
  initialAnchor,
  stream,
  multiTokenBalance,
  onClose,
}: Props) {
  const { rect, startDrag, boxRef } = useFloatingBox({
    // Min size is tuned to the densest layout (stats + buy + sell +
    // ledger PnL + readout + status) so the panel never clips or
    // scrolls; resizing larger just gives the controls more breathing
    // room (the body centers the buy/sell block in the spare space).
    storageKey: BOX_STORAGE_KEY,
    // Footprint is the pre-shrink layout ×0.67 (user ask: 33% smaller
    // box, two chip rows still comfortable). BOX_SCALE's zoom wrapper
    // renders the SAME logical layout into this smaller physical box, so
    // clientHeight-based row fitting keeps working unchanged (zoom keeps
    // layout math in logical px).
    minWidth: 278,
    // Chips are a fixed rectangular height. Min fits exactly one row; the
    // capped max fits two rows — so the panel grows just enough to reveal
    // the second preset row, then stops (chips never balloon).
    minHeight: 235,
    maxHeight: 315,
    defaultWidth: 293,
    defaultHeight: 240,
    initialAnchor,
    defaultLeft: 24,
    defaultTop: 150,
  });
  // Click-to-raise among the floating surfaces; opening the box also puts
  // it on top (it mounts on open).
  const { zIndex: panelZ, raise: raisePanel } = useFloatingPanelZ('instant-trade');
  useEffect(() => raisePanel(), [raisePanel]);
  /* Trading-presets slice: buy and sell read independent slippage,
     priority, and bribe values from the global active preset's
     matching side. See the identical comment in TradePanel.tsx for
     the unit semantics — values flow end-to-end through the order
     body, api/ intake, and trading engine compose stage. */
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
  // Editable quick chips (shared with TradePanel): the top-bar
  // QuickChipsEditor writes this store slice, so the box's primary chip
  // row must render it — not the hardcoded pool — or edits never show.
  const quickChips = useTradeStore((state) => state.quickChips);
  /* USDC pair support: effective spend currency through the shared
     resolver — USDC pairs always spend USDC; SOL pairs in USDC mode
     fall back to SOL with a notice until cross-quote ships. */
  const tradeQuoteMode = useTradeStore((state) => state.usdcTrade.trade_quote_mode);
  const usdcQuickBuyMicro = useTradeStore((state) => state.usdcTrade.quick_buy_usdc_micro);
  const pairIsUsdc = isUsdcPair(token.quoteMint);
  // Venue matters: bonding-curve SOL pairs support cross-quote USDC
  // spending; graduated (pump-AMM) pairs fall back to SOL + notice.
  const spend = resolveSpendCurrency(
    tradeQuoteMode,
    token.quoteMint,
    token.graduated === true,
  );
  const buyInUsdc = spend.currency === 'usdc';
  const [customBuyAmount, setCustomBuyAmount] = useState('0.01');
  const [sellMode, setSellMode] = useState<SellMode>('pct');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const clientIdsRef = useRef(new Set<string>());
  const orderKeysRef = useRef(new Set<string>());
  // Optimistic submit gate. Do NOT pre-gate the click on the cold-boot auth
  // waterfall (Clerk init -> /me round-trip -> trading-authorization sync) or
  // on the live trading SSE connection (which only RECEIVES fills). Once
  // Clerk is loaded and signed in, the order POST carries the session token
  // and intake validates server-side — so Quickbuy is pressable the instant
  // the page renders, and the user is prompted for reauth/setup only if the
  // order actually needs it. This is the root fix for "can't press quickbuy
  // for a couple seconds after a hard refresh".
  /*
   * ── NO AUTH ──────────────────────────────────────────────────────
   *
   * This box used to sit behind Clerk: a session token warmed on every
   * interaction, and a `requireTradingReady()` gate in front of each
   * submit. Neither is here — there is no account, no wallet and no
   * order endpoint on this build, so the gate could only ever say no.
   *
   * The submit path is kept whole so the box behaves the way it will
   * once there IS an account behind it; it just resolves an empty token
   * and passes the gate.
   */
  const getToken = ALWAYS_UNAUTHENTICATED;
  const queryClient = useQueryClient();
  const requireTradingReady = () => true;
  // Slice "Terminal wallet selector" + "Multi-wallet split buy/sell
  // orders": selected wallet(s) to trade from. The single id is the
  // legacy head of the array (kept as a fast path for the single-
  // wallet case). The full array drives the multi-wallet routing.
  const selectedWalletAccountId = useSelectedWalletStore((s) => s.selectedWalletAccountId);
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  const isMultiWalletTrade = multiSelectedWalletAccountIds.length >= 2;
  // Shared optimistic balance: a Discover quickbuy (or a prior buy on
  // this page) writes a wallet-scoped floor on fill, so this box shows
  // the just-bought tokens immediately instead of `0` while the chain
  // poll catches up. Display-only — sell sizing still uses the chain
  // balance, so this never causes an oversell.
  const optimisticBalances = useTradeActivityStore((s) => s.optimisticBalances);
  const registerOrderContext = useTradeActivityStore((s) => s.registerOrderContext);
  const reconcileOptimisticBalance = useTradeActivityStore((s) => s.reconcileOptimisticBalance);
  // Multi-wallet sell preview: aggregate token balance across the
  // selected wallets so the percent chips (10/25/50/100) and the
  // "Sell" CTA size against the SUMMED balance, not the focused
  // wallet's. Owned by TradePage (`multiTokenBalance` prop), idle
  // until 2+ wallets are selected.
  // Durable lifetime ledger for this coin (blended across the selected
  // wallets), same source as the trade-page strip. Persists after a full
  // sell; PNL ticks with the live price.
  const ledger = useTradeLedger(mint ?? null);
  const ledgerPnl = useMemo(
    () => ledgerToPnl(ledger, priceLamportsPerBaseUnit),
    [ledger, priceLamportsPerBaseUnit],
  );

  // Consume the FULL order-event ring (same pattern as TradePanel), not
  // just `stream.lastEvent`: two SSE events landing in one render batch
  // (e.g. order A `failed` + order B `confirmed`) would lose the earlier
  // one if we only looked at the latest. `null` until the first run so a
  // fresh mount marks the ring's history processed instead of replaying
  // it (this box's clientId/orderKey sets are per-mount anyway).
  const processedOrderEventsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    let processed = processedOrderEventsRef.current;
    if (processed === null) {
      processed = new Set(stream.orderEvents.map(orderEventId));
      processedOrderEventsRef.current = processed;
      return;
    }
    const keepIds = new Set(stream.orderEvents.map(orderEventId));
    for (const id of processed) {
      if (!keepIds.has(id)) processed.delete(id);
    }
    for (const event of stream.orderEvents) {
      const id = orderEventId(event);
      if (processed.has(id)) continue;
      processed.add(id);
      applyOrderEvent(event);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.orderEvents]);

  // Once the chain-backed balance reflects the buy, drop the optimistic
  // floor so the live balance is the sole source of truth again.
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

  // Slice "Per-wallet positions / fills + wallet management UI":
  // sell sizing reads ONLY the wallet-scoped token-balance poll
  // (slice 6). `stream.position` is mint-keyed in-memory and may
  // aggregate across wallets; never fall back to it here.
  //
  // Multi-wallet mode: swap the single-wallet hot poll for the
  // summed multi-wallet balance so the chip previews, position
  // readout and "Sell" CTA all reflect what's actually about to be
  // sold (sum across the selected wallets).
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
  const liveTokenBalance = isMultiWalletTrade
    ? multiDisplayTokenBalance
    : mergeDisplayBalance(stream.tokenBalance ?? null, optimisticFloor);
  // DISPLAY-only balance: `null` while the single-wallet balance is truly
  // unknown (poll not resolved yet — e.g. right after a wallet switch)
  // so the header can fall back to the last remembered value instead of
  // flashing "0 tokens". Sizing keeps reading `liveTokenBalance`.
  const displayTokenBalance: string | null = isMultiWalletTrade
    ? multiDisplayTokenBalance
    : stream.tokenBalance !== null || optimisticFloor !== null
      ? liveTokenBalance
      : null;
  const rememberedTokenBalance =
    displayTokenBalance === null && mint
      ? (readDisplayBalance(selectedWalletAccountId ?? null, mint)?.tokens ?? null)
      : null;
  // Bottom P&L strip is always visible. Before any tracked fills the
  // ledger is null, so fall back to a zeroed strip whose HOLDING still
  // reflects the live value of whatever tokens are in the wallet.
  const ledgerStripPnl: MockPnL =
    ledgerPnl ?? zeroLedgerPnl(tokensToLamports(liveTokenBalance, priceLamportsPerBaseUnit));

  async function submitBuy(amountText: string) {
    // Latency head stamp: capture the button-press clock before any
    // validation / pre-submit work so the trace's `clickedAtMs` is the
    // true click time. `amountText` is SOL on SOL spends, dollars on
    // USDC spends (the chips render the matching unit).
    const clickedAtMs = Date.now();
    // Monotonic twin for the e2e waterfall (durations never use Date.now).
    const pressPerfAtMs = performance.now();
    // Press-time token warm (fire-and-forget, single-flight): QuickChip
    // submits at pointerdown, so this starts a cold Clerk mint at the
    // earliest press signal; the submit path's `resolveOrderAuthToken`
    // joins the same in-flight request via clerk-js's token cache.
    warmOrderAuthToken(getToken);
    if (!mint) {
      setStatusMessage('No mint in URL.');
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
    const amountIn = Number(amountText);
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      setStatusMessage(`Enter a positive ${buyInUsdc ? 'USDC' : 'SOL'} amount.`);
      return;
    }
    const amountLabel = buyInUsdc
      ? `$${trimAmount(amountText)}`
      : `${trimAmount(amountText)} SOL`;
    if (!requireTradingReady()) {
      setStatusMessage(NOT_WIRED_MESSAGE);
      return;
    }
    const route = routeForWalletCount(multiSelectedWalletAccountIds.length);
    if (route === 'batch') {
      await submitBatchInstant({
        side: 'buy',
        walletIds: multiSelectedWalletAccountIds,
        mint,
        graduated: token.graduated === true,
        ...(buyInUsdc
          ? { amountUsdcMicro: usdToUsdcMicroDecimalString(amountIn) }
          : { amountLamports: solToLamportsDecimalString(amountIn) }),
        toastLabel: `Sending buy ${amountLabel} across ${multiSelectedWalletAccountIds.length} wallets...`,
        successLabel: `Buy queued across ${multiSelectedWalletAccountIds.length} wallets`,
        clickedAtMs,
        pressPerfAtMs,
      });
      return;
    }
    const clientOrderId = createClientOrderId();
    clientIdsRef.current.add(clientOrderId);
    // Register wallet+mint so the global SSE `filled` event can raise
    // the optimistic balance floor for THIS wallet.
    registerOrderContext(clientOrderId, selectedWalletAccountId ?? null, mint);
    unlockTradeSuccessSound();
    setStatusMessage(`Sending buy ${amountLabel}...`);
    try {
      const result = await stream.submit({
        clientOrderId,
        side: 'buy',
        mint,
        graduated: token.graduated === true,
        ...(buyInUsdc
          ? { usdcIn: usdToUsdcMicroDecimalString(amountIn) }
          : { solIn: amountIn }),
        maxSlippageBps: slippageBpsBuy,
        priorityLamports: priorityLamportsBuy,
        bribeLamports: bribeLamportsBuy,
        sendMode: sendModeBuy,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
        timing: { pressAtMs: pressPerfAtMs, surface: 'instant' },
        ...(typeof selectedWalletAccountId === 'string'
          ? { walletAccountId: selectedWalletAccountId }
          : {}),
      });
      if (!result.accepted) {
        setStatusMessage(rejectionMessage(result.error?.kind));
        return;
      }
      if (result.key) orderKeysRef.current.add(orderKeyId(result.key));
      setStatusMessage(`Buy queued: ${amountLabel}`);
    } catch (err) {
      setStatusMessage(`Error: ${errorText(err)}`);
    }
  }

  async function submitSellPct(pct: number) {
    const clickedAtMs = Date.now();
    const pressPerfAtMs = performance.now();
    // Press-time token warm — see `submitBuy`.
    warmOrderAuthToken(getToken);
    if (!mint) {
      setStatusMessage('No mint in URL.');
      return;
    }
    // Click-time self-warm — see `submitBuy` (fire-and-forget).
    const warmSession = getClerkSession();
    if (warmSession.isSignedIn === true) {
      prewarmMints([mint], warmSession.token, {
        graduatedMints: token.graduated === true ? [mint] : [],
        immediate: true,
      });
    }
    if (!requireTradingReady()) {
      setStatusMessage(NOT_WIRED_MESSAGE);
      return;
    }
    const route = routeForWalletCount(multiSelectedWalletAccountIds.length);
    if (route === 'batch') {
      await submitBatchInstant({
        side: 'sell',
        walletIds: multiSelectedWalletAccountIds,
        mint,
        graduated: token.graduated === true,
        // Math.round: fractional percents (e.g. 0.29%) can yield a
        // non-integer under IEEE-754 (28.999999999999996 bps), which
        // the api's integer schema rejects as an opaque 400.
        sellPercentBps: Math.round(pct * 100),
        toastLabel: `Sending sell ${pct}% across ${multiSelectedWalletAccountIds.length} wallets...`,
        successLabel: `Sell queued across ${multiSelectedWalletAccountIds.length} wallets`,
        clickedAtMs,
        pressPerfAtMs,
      });
      return;
    }
    const clientOrderId = createClientOrderId();
    clientIdsRef.current.add(clientOrderId);
    registerOrderContext(clientOrderId, selectedWalletAccountId ?? null, mint);
    unlockTradeSuccessSound();
    setStatusMessage(`Sending sell ${pct}%...`);
    try {
      const result = await stream.submit({
        clientOrderId,
        side: 'sell',
        mint,
        graduated: token.graduated === true,
        // Math.round: see the batch sellPercentBps site above.
        sellPctBps: Math.round(pct * 100),
        // Confirmed-buy instant hint: fold the wallet-scoped optimistic
        // floor (set on the buy `filled` fill) into the chain-poll
        // balance so a just-confirmed buy raises the sell hint without
        // waiting for the next poll. `max(chain, floor)` only ever
        // reflects tokens already on-chain from the confirmed buy.
        ...(stream.tokenBalanceInfo?.known === true || optimisticFloor !== null
          ? {
              sellTokenBalanceHint: mergeDisplayBalance(
                stream.tokenBalanceInfo?.known ? stream.tokenBalanceInfo.tokens : null,
                optimisticFloor,
              ),
            }
          : {}),
        // Cross-quote: the engine appends a SOL→USDC proceeds swap.
        ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
        maxSlippageBps: slippageBpsSell,
        priorityLamports: priorityLamportsSell,
        bribeLamports: bribeLamportsSell,
        sendMode: sendModeSell,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
        timing: { pressAtMs: pressPerfAtMs, surface: 'instant' },
        ...(typeof selectedWalletAccountId === 'string'
          ? { walletAccountId: selectedWalletAccountId }
          : {}),
      });
      if (!result.accepted) {
        // The sync API path wraps engine kinds as `engine_<kind>` (see
        // api/src/trade/errors.ts TradingEngineRejected) and exposes the
        // unwrapped kind in the `engine_error_kind` extra — match both.
        if (
          result.error?.kind === 'preWarm.positionInsufficient' ||
          result.error?.['engine_error_kind'] === 'preWarm.positionInsufficient'
        ) {
          setStatusMessage(`Rejected: wallet balance ${formatHave(result.error)}`);
        } else {
          setStatusMessage(rejectionMessage(result.error?.kind));
        }
        return;
      }
      if (result.key) orderKeysRef.current.add(orderKeyId(result.key));
      setStatusMessage(`Sell queued: ${pct}%`);
    } catch (err) {
      setStatusMessage(`Error: ${errorText(err)}`);
    }
  }

  // SOL-denominated sell: "sell ~N SOL worth of tokens". Converts the SOL
  // target to token base units at the live spot price (capped at the live
  // balance so it never oversells) and routes through the `tokensIn` sell
  // path. Multi-wallet splits the SOL target EQUALLY across the wallets —
  // exactly like the equal-split buy (sell 3 SOL across 3 wallets = 1 SOL
  // from each) — by fanning out one `tokensIn` sell per wallet.
  async function submitSellSol(solTarget: number) {
    const clickedAtMs = Date.now();
    const pressPerfAtMs = performance.now();
    // Press-time token warm — see `submitBuy`.
    warmOrderAuthToken(getToken);
    if (!mint) {
      setStatusMessage('No mint in URL.');
      return;
    }
    // Click-time self-warm — see `submitBuy` (fire-and-forget).
    const warmSession = getClerkSession();
    if (warmSession.isSignedIn === true) {
      prewarmMints([mint], warmSession.token, {
        graduatedMints: token.graduated === true ? [mint] : [],
        immediate: true,
      });
    }
    if (!requireTradingReady()) {
      setStatusMessage(NOT_WIRED_MESSAGE);
      return;
    }
    if (!priceLamportsPerBaseUnit || priceLamportsPerBaseUnit <= 0) {
      setStatusMessage('No live price yet — try again in a moment.');
      return;
    }

    if (isMultiWalletTrade) {
      // Equal-split the SOL target across wallets, convert each share to
      // tokens (capped at that wallet's balance), then route through the
      // SAME batch endpoint as buys — one POST, one parent order.
      const plan = planSolSellFanOut(
        solTarget,
        multiSelectedWalletAccountIds,
        mergeSellHintsWithFloors(
          multiTokenBalance.perWallet,
          optimisticBalances,
          mint,
          multiSelectedWalletAccountIds,
        ),
        priceLamportsPerBaseUnit,
      );
      if (!plan) {
        setStatusMessage('No sellable balance in the selected wallets.');
        return;
      }
      // The plan caps each wallet at its balance and drops unfunded wallets,
      // so the actual total can be below the requested target — label with
      // the planned amount rather than the raw target.
      const plannedLamports = Object.values(plan.sellTokensInByWallet).reduce(
        (sum, tokens) => sum + Number(tokens) * priceLamportsPerBaseUnit,
        0,
      );
      await submitBatchInstant({
        side: 'sell',
        walletIds: plan.walletIds,
        mint,
        graduated: token.graduated === true,
        sellTokensInByWallet: plan.sellTokensInByWallet,
        toastLabel: `Sending sell ~${formatSol(plannedLamports)} across ${plan.walletIds.length} wallets...`,
        successLabel: `Sell queued across ${plan.walletIds.length} wallets`,
        clickedAtMs,
        pressPerfAtMs,
      });
      return;
    }

    const balance = bigIntSafe(liveTokenBalance);
    if (balance <= 0n) {
      setStatusMessage('No sellable balance.');
      return;
    }
    let tokenBaseUnits = BigInt(Math.floor((solTarget * 1e9) / priceLamportsPerBaseUnit));
    if (tokenBaseUnits > balance) tokenBaseUnits = balance;
    if (tokenBaseUnits <= 0n) {
      setStatusMessage(`Balance too small to sell ${solTarget} SOL.`);
      return;
    }
    const tokensIn = tokenBaseUnits.toString();
    const clientOrderId = createClientOrderId();
    clientIdsRef.current.add(clientOrderId);
    registerOrderContext(clientOrderId, selectedWalletAccountId ?? null, mint);
    unlockTradeSuccessSound();
    setStatusMessage(`Sending sell ~${solTarget} SOL...`);
    try {
      const result = await stream.submit({
        clientOrderId,
        side: 'sell',
        mint,
        graduated: token.graduated === true,
        tokensIn,
        // Cross-quote: the engine appends a SOL→USDC proceeds swap.
        ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
        maxSlippageBps: slippageBpsSell,
        priorityLamports: priorityLamportsSell,
        bribeLamports: bribeLamportsSell,
        sendMode: sendModeSell,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
        timing: { pressAtMs: pressPerfAtMs, surface: 'instant' },
        ...(typeof selectedWalletAccountId === 'string'
          ? { walletAccountId: selectedWalletAccountId }
          : {}),
      });
      if (!result.accepted) {
        // The sync API path wraps engine kinds as `engine_<kind>` (see
        // api/src/trade/errors.ts TradingEngineRejected) and exposes the
        // unwrapped kind in the `engine_error_kind` extra — match both.
        if (
          result.error?.kind === 'preWarm.positionInsufficient' ||
          result.error?.['engine_error_kind'] === 'preWarm.positionInsufficient'
        ) {
          setStatusMessage(`Rejected: wallet balance ${formatHave(result.error)}`);
        } else {
          setStatusMessage(rejectionMessage(result.error?.kind));
        }
        return;
      }
      if (result.key) orderKeysRef.current.add(orderKeyId(result.key));
      setStatusMessage(`Sell queued: ~${solTarget} SOL`);
    } catch (err) {
      setStatusMessage(`Error: ${errorText(err)}`);
    }
  }

  // Multi-wallet batch submit. Mirrors the routing in
  // `TradePanel.submitBatchTrade`: pre-derive per-child clientOrderIds
  // (registered with `clientIdsRef` so the existing applyOrderEvent
  // machinery surfaces per-child status), then POST a single
  // `/api/v1/trade/batch-orders` request with equal split semantics.
  async function submitBatchInstant(args: {
    side: 'buy' | 'sell';
    walletIds: ReadonlyArray<string>;
    mint: string;
    amountLamports?: string;
    /** USDC-pair buy total in integer micro-USDC. Mutually exclusive
     *  with `amountLamports`. */
    amountUsdcMicro?: string;
    sellPercentBps?: number;
    /** Per-wallet absolute token amounts for a SOL-denominated equal-split
     *  sell. Mutually exclusive with `sellPercentBps`. */
    sellTokensInByWallet?: Record<string, string>;
    graduated?: boolean;
    toastLabel: string;
    successLabel: string;
    /** Button-press clock from the calling handler (latency tracing). */
    clickedAtMs?: number;
    /** Monotonic press stamp (performance.now()) for the e2e waterfall. */
    pressPerfAtMs?: number;
  }): Promise<void> {
    const { side, mint: m, toastLabel, successLabel } = args;
    // Shared head stamp for every child in this batch (one click → one batch).
    const clickedAtMs = args.clickedAtMs ?? Date.now();
    const pressPerfAtMs = args.pressPerfAtMs ?? performance.now();
    // Percentage sells skip wallets KNOWN to hold zero of the mint
    // (e.g. just aggregated to primary) — those children only fail.
    const walletIds =
      side === 'sell' && args.sellTokensInByWallet === undefined
        ? filterSellableWalletIds(
            multiTokenBalance.perWallet,
            optimisticBalances,
            m,
            args.walletIds,
          )
        : args.walletIds;
    if (walletIds.length === 0) {
      setStatusMessage(
        side === 'sell' && args.walletIds.length > 0
          ? 'No selected wallet holds this token.'
          : 'Select at least one wallet.',
      );
      return;
    }
    const clientParentId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    unlockTradeSuccessSound();
    setStatusMessage(toastLabel);

    let input: BatchOrderInput;
    if (side === 'buy') {
      if (
        typeof args.amountLamports !== 'string' &&
        typeof args.amountUsdcMicro !== 'string'
      ) {
        setStatusMessage('Internal: missing buy amount.');
        return;
      }
      input = {
        side: 'buy',
        clientParentId,
        walletAccountIds: [...walletIds],
        mint: m,
        graduated: args.graduated === true,
        ...(typeof args.amountUsdcMicro === 'string'
          ? { amountUsdcMicro: args.amountUsdcMicro }
          : { amountLamports: args.amountLamports! }),
        maxSlippageBps: slippageBpsBuy,
        priorityLamports: priorityLamportsBuy,
        bribeLamports: bribeLamportsBuy,
        sendMode: sendModeBuy,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
      };
    } else if (args.sellTokensInByWallet !== undefined) {
      // SOL-denominated equal-split sell: each child sells an explicit
      // token amount. No percentage / balance hint (the engine rejects a
      // hint without a percentage sell).
      input = {
        side: 'sell',
        clientParentId,
        walletAccountIds: [...walletIds],
        mint: m,
        graduated: args.graduated === true,
        sellTokensInByWallet: args.sellTokensInByWallet,
        // Cross-quote: every child's proceeds swap SOL→USDC in-tx.
        ...(spend.crossQuote ? { spendCurrency: 'usdc' as const } : {}),
        maxSlippageBps: slippageBpsSell,
        priorityLamports: priorityLamportsSell,
        bribeLamports: bribeLamportsSell,
        sendMode: sendModeSell,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
      };
    } else {
      if (typeof args.sellPercentBps !== 'number') {
        setStatusMessage('Internal: missing sellPercentBps.');
        return;
      }
      input = {
        side: 'sell',
        clientParentId,
        walletAccountIds: [...walletIds],
        mint: m,
        graduated: args.graduated === true,
        sellPercentBps: args.sellPercentBps,
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
          m,
          walletIds,
        ),
      };
    }

    // The POST only needs `clientParentId` (child ids are server-derived
    // with the same SHA-256 scheme), so fire it BEFORE the SubtleCrypto
    // derivation — the order never serializes behind digest work. The ids
    // are derived concurrently and registered for SSE correlation; digest
    // (<1ms) completes far inside the network RTT.
    const resultPromise = (async () => {
      const authToken = await resolveOrderAuthToken(getToken);
      // E2E waterfall press stamps (monotonic clock), token resolve just
      // settled on this line.
      return submitBatchOrder(
        {
          ...input,
          timing: {
            pressAtMs: pressPerfAtMs,
            surface: 'instant',
            tokenReadyAtMs: performance.now(),
          },
        },
        { authToken },
      );
    })();
    try {
      const childIds = await Promise.all(
        walletIds.map((wid) => deriveChildClientOrderId(clientParentId, wid)),
      );
      for (let i = 0; i < childIds.length; i += 1) {
        const cid = childIds[i];
        if (!cid) continue;
        clientIdsRef.current.add(cid);
        registerOrderContext(cid, walletIds[i] ?? null, m);
      }
    } catch (err) {
      // SubtleCrypto unavailable: the batch is already in flight but its
      // children can't be correlated to this box's status line.
      resultPromise.catch(() => undefined);
      setStatusMessage(`Error: ${errorText(err)}`);
      return;
    }
    try {
      const result = await resultPromise;
      if (result.kind === 'ok' || result.kind === 'partial_failed') {
        setStatusMessage(successLabel);
      } else if (result.kind === 'cancelled') {
        // Every child cancelled before dispatch — most often no
        // sellable balance / a sell still pending. Surface the real
        // reason instead of a false "queued".
        const errors = result.children.map((c) => c.error_code ?? c.error_kind ?? '');
        setStatusMessage(
          errors.every((e) => e === 'cancel.no sellable balance')
            ? 'No sellable balance in the selected wallets.'
            : errors.every((e) => e === 'cancel.sell balance pending')
              ? 'Sell already pending; wallet balances still syncing.'
              : 'Batch cancelled (no sellable balance).',
        );
      } else if (result.kind === 'failed') {
        setStatusMessage(`Batch failed (${result.parent.error_code ?? 'unknown'}).`);
      } else if (result.kind === 'reauth') {
        // Refresh /me so the trading-ready gate flips and prompts for
        // sign-in on the next interaction.
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        setStatusMessage(REAUTH_HUMAN_MESSAGE);
      } else if (result.kind === 'invalid_input') {
        setStatusMessage(`Invalid input: ${result.reason}`);
      } else if (result.kind === 'unknown_outcome') {
        // B3: aborted batch POST — indeterminate, NOT failed. Child
        // toasts stay pending for the reconciliation flow to resolve.
        setStatusMessage('Batch still working — outcomes will update shortly.');
      } else {
        setStatusMessage(`Error: ${result.kind}`);
      }
    } catch (err) {
      setStatusMessage(`Error: ${errorText(err)}`);
    }
  }

  function applyOrderEvent(event: TradeOrderEvent) {
    if (event.kind === 'accepted') {
      if (!clientIdsRef.current.has(event.intent.clientOrderId)) return;
      orderKeysRef.current.add(orderKeyId(event.key));
      setStatusMessage(`${event.intent.side === 'buy' ? 'Buy' : 'Sell'} queued`);
      return;
    }
    if (event.kind === 'resolved') {
      if (!orderKeysRef.current.has(orderKeyId(event.key))) return;
      setStatusMessage(
        `${event.resolved && typeof event.resolved === 'object' && 'venue' in event.resolved ? String(event.resolved.venue) : 'Order'} ready; sending tx`,
      );
      return;
    }
    if (!orderKeysRef.current.has(orderKeyId(event.key))) return;
    if (event.kind === 'submitted') {
      setStatusMessage(`Submitted ${shortSig(event.signature)}`);
      return;
    }
    if (event.kind === 'confirmed') {
      setStatusMessage(`Confirmed ${shortSig(event.signature)}`);
      return;
    }
    if (event.kind === 'fill_pending') {
      setStatusMessage(`Confirmed ${shortSig(event.signature)}`);
      return;
    }
    if (event.kind === 'filled' || event.kind === 'partial') {
      // `confirmed` is the terminal user-facing state (tx landed on a
      // slot). The fill parse is internal balance/DB bookkeeping, so we
      // keep the confirmed status rather than surfacing the fill result.
      return;
    }
    if (event.kind === 'failed') {
      setStatusMessage(`Failed: ${errorMessage(event.error)}`);
      return;
    }
    if (event.kind === 'cancelled') {
      if (event.reason === 'no sellable balance') {
        if (isBelowDisplaySellableBalance(liveTokenBalance)) {
          setStatusMessage('No sellable balance to sell.');
        }
        return;
      }
      if (event.reason === 'sell balance pending') {
        return;
      }
      setStatusMessage(`Cancelled: ${event.reason}`);
    }
  }

  const statusKind = !statusMessage
    ? 'idle'
    : statusMessage.startsWith('Rejected') ||
        statusMessage.startsWith('Failed') ||
        statusMessage.startsWith('Error') ||
        statusMessage === REAUTH_HUMAN_MESSAGE
      ? 'error'
      : 'neutral';

  return (
    <section
      // Fast drag path: with the ref attached, useFloatingBox applies
      // drag/resize via rAF transform writes on the element and commits
      // React state only on pointerup — the chip grids/ledger below never
      // re-render per pointermove.
      ref={boxRef}
      /* NOT `.panel`. That shared class brings a 2xl radius, the theme's
         section shadow and a `::before` carrying two accent radial washes
         — the same decoration this box was stripped of. `.it-box` is the
         whole surface now. */
      className="it-box fixed flex flex-col"
      aria-label="Instant Trade"
      onPointerDownCapture={raisePanel}
      onPointerDown={(event) => {
        if (shouldStartSurfaceDrag(event.target)) startDrag(event, 'move');
      }}
      style={{
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: panelZ,
        touchAction: 'none',
      }}
    >
      {/* Everything except the resize handles renders through the zoom
          wrapper: same logical layout, 33% smaller on screen. relative so
          the absolute accent decorations anchor to it. */}
      <div className="relative flex min-h-0 flex-1 flex-col" style={{ zoom: BOX_SCALE }}>
      {/* No accent wash and no gradient hairline across the top. This is
          a floating panel, not a feature card: what says it is above the
          page is its edge and its shadow. */}
      {/*
        * ── THE BAR ─────────────────────────────────────────────────
        *
        * Presets, pencil · grip · settings, wallet, close.
        * The QUOTE toggle is no longer up here — it moved down beside
        * the Buy label, where the thing it changes actually is.
        *
        * Empty areas double as the drag handle via the section-level
        * surface-drag handler; the buttons opt out.
        */}
      <div
        className={cn('it-bar flex shrink-0 cursor-move select-none items-center gap-1', BODY_INSET, BAR_PAD_Y)}
      >
        <ActivePresetSelector variant="tabs" />
        {/* Mode-aware: USDC spends edit the `quick_buy_usdc_micro`
            presets (the set the chip row actually renders), SOL spends
            edit the SOL quick chips. */}
        <QuickChipsEditor
          field={buyInUsdc ? 'usdcBuy' : 'buy'}
          unit={buyInUsdc ? 'usd' : 'sol'}
          title="Buy amounts"
          variant="ghost"
        />

        {/* The drag dots sit in the box's top edge rather than in the run
            of buttons — they are what you grab, not something you press,
            so they are not shaped like the things beside them. */}
        <span className="it-grip" aria-hidden>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="9" cy="8" r="1.3" /><circle cx="15" cy="8" r="1.3" />
            <circle cx="9" cy="13" r="1.3" /><circle cx="15" cy="13" r="1.3" />
          </svg>
        </span>

        <div className="flex-1" />

        {/* A cog, not the ringed star the reference draws — that mark
            reads as brightness, and nothing here has a brightness. */}
        <button type="button" className="it-ico" aria-label="Settings" onPointerDown={(e) => e.stopPropagation()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.2 2.4h-.4a1.9 1.9 0 0 0-1.9 1.9v.2a1.9 1.9 0 0 1-1 1.6l-.4.3a1.9 1.9 0 0 1-1.9 0l-.2-.1a1.9 1.9 0 0 0-2.6.7l-.2.4a1.9 1.9 0 0 0 .7 2.6l.2.1a1.9 1.9 0 0 1 .9 1.6v.5a1.9 1.9 0 0 1-.9 1.6l-.2.1a1.9 1.9 0 0 0-.7 2.6l.2.4a1.9 1.9 0 0 0 2.6.7l.2-.1a1.9 1.9 0 0 1 1.9 0l.4.3a1.9 1.9 0 0 1 1 1.6v.2a1.9 1.9 0 0 0 1.9 1.9h.4a1.9 1.9 0 0 0 1.9-1.9v-.2a1.9 1.9 0 0 1 1-1.6l.4-.3a1.9 1.9 0 0 1 1.9 0l.2.1a1.9 1.9 0 0 0 2.6-.7l.2-.4a1.9 1.9 0 0 0-.7-2.6l-.2-.1a1.9 1.9 0 0 1-.9-1.6v-.5a1.9 1.9 0 0 1 .9-1.6l.2-.1a1.9 1.9 0 0 0 .7-2.6l-.2-.4a1.9 1.9 0 0 0-2.6-.7l-.2.1a1.9 1.9 0 0 1-1.9 0l-.4-.3a1.9 1.9 0 0 1-1-1.6v-.2a1.9 1.9 0 0 0-1.9-1.9z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <WalletCountButton mint={mint ?? null} />
        <button
          type="button"
          aria-label="Close instant trade"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          className="it-close"
        >
          {/* A DRAWN cross, not `&times;`. The multiplication sign is a
              small glyph sitting in the middle of a large em box, so it
              paints at roughly half the font size it is set at — which
              behind this panel's 0.77 zoom left about a nine pixel mark
              in a twenty six pixel button. An SVG fills the box it is
              given. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col', BODY_INSET, BODY_PAD_Y, SECTION_GAP)}>
        {/* Buy: chips + buy-side fee settings. The group grows so the chip
            row scales with the panel height (diagonal resize feel). USDC
            spends swap the chip set to the `quick_buy_usdc_micro`
            presets, rendered as dollars. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', GROUP_GAP)}>
          <TradeSection
            chips={
              buyInUsdc
                ? usdcQuickBuyMicro.map((micro) => String(micro / 1_000_000))
                : chipStrings(quickChips.buy)
            }
            chipPrefix={buyInUsdc ? '$' : undefined}
            // Approximate receive estimate on hover: plain SOL buys use the
            // already-polled venue quote (constant-product + fee haircut);
            // $ spends (native USDC pair or cross-quote) convert $→SOL at
            // the live rate first. Approximate — the engine applies swap
            // tolerance + the user's slippage at execution.
            getPreview={(amount) =>
              buyTokensPreview(
                buyInUsdc
                  ? usdSpendLamports(Number(amount), token.solUsd ?? null)
                  : solSpendLamports(Number(amount)),
                stream.tokenBalanceInfo?.quote ?? null,
                priceLamportsPerBaseUnit,
                multiSelectedWalletAccountIds.length,
              )
            }
            customAmount={customBuyAmount}
            onCustomAmountChange={setCustomBuyAmount}
            onCustomSubmit={() => void submitBuy(customBuyAmount)}
            onChip={(amount) => void submitBuy(amount)}
          />
          <SettingsReadout
            slippageBps={slippageBpsBuy}
            priorityLamports={priorityLamportsBuy}
            bribeLamports={bribeLamportsBuy}
            showPresets={false}
          />
        </div>

        {/* Sell: chips + sell-side fee settings. Grows like the buy group. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', GROUP_GAP)}>
          <SellSection
            pctChips={chipStrings(quickChips.sell)}
            solChips={chipStrings(quickChips.sellSol)}
            tokenBalance={displayTokenBalance}
            cachedTokenBalance={rememberedTokenBalance}
            priceLamportsPerBaseUnit={priceLamportsPerBaseUnit}
            // $ est-receive whenever the user receives USDC: native
            // USDC pairs + cross-quote sells (proceeds swapped).
            receiveUsdRate={pairIsUsdc || spend.crossQuote ? (token.solUsd ?? null) : null}
            quote={stream.tokenBalanceInfo?.quote ?? null}
            mode={sellMode}
            onModeChange={setSellMode}
            onSellPct={(pct) => void submitSellPct(pct)}
            onSellSol={(sol) => void submitSellSol(sol)}
          />
          <SettingsReadout
            slippageBps={slippageBpsSell}
            priorityLamports={priorityLamportsSell}
            bribeLamports={bribeLamportsSell}
            showPresets={false}
          />
        </div>

        {statusMessage ? (
          <div className={statusTone({ tone: statusKind })}>{statusMessage}</div>
        ) : null}

        <LedgerStrip pnl={ledgerStripPnl} />
      </div>
      </div>

      {RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          aria-hidden
          data-resize-handle="true"
          onPointerDown={(event) => startDrag(event, edge)}
          style={resizeHandleStyle(edge)}
        />
      ))}
    </section>
  );
}

function TradeSection({
  chips,
  chipPrefix,
  getPreview,
  customAmount,
  onCustomAmountChange,
  onCustomSubmit,
  onChip,
}: {
  chips: ReadonlyArray<string>;
  /** Display prefix ("$" for USDC chips); `onChip` still receives the
   *  bare amount string. */
  chipPrefix?: string;
  /** Optional hover preview per chip (cross-quote token estimate). */
  getPreview?: (amount: string) => string | undefined;
  customAmount: string;
  onCustomAmountChange: (value: string) => void;
  onCustomSubmit: () => void;
  onChip: (amount: string) => void;
}) {
  const { ref, rows } = useFittingRows();
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', SECTION_GAP)}>
      {/*
        * ── THE QUOTE SITS WITH THE SIDE IT SPENDS ──────────────────
        *
        * It used to live in the top bar with the presets and the wallet
        * — a row of chrome — where it read as one more setting. It
        * belongs here: "Buy [in SOL]" is one sentence, and the balance
        * at the end of the row is the amount of that currency you have.
        */}
      <div className="flex shrink-0 items-center gap-2">
        <SideLabel>Buy</SideLabel>
        <QuoteModeToggle />
        <div className="flex-1" />
        <QuoteGlyph size={13} />
      </div>
      <div ref={ref} className={cn(CHIP_GRID, 'min-h-0 flex-1')}>
        {chips.slice(0, rows * 4).map((amount, i) => (
          // Index-qualified key: the editable primary row can repeat a
          // value from the hardcoded overflow row.
          <QuickChip
            key={`${i}-${amount}`}
            side="buy"
            onClick={() => onChip(amount)}
            hoverPreview={getPreview?.(amount)}
          >
            {chipPrefix ? `${chipPrefix}${amount}` : amount}
          </QuickChip>
        ))}
      </div>
      {/* Custom SOL amount input + Buy button — temporarily hidden
          (flip SHOW_CUSTOM_BUY_INPUT to restore). */}
      {SHOW_CUSTOM_BUY_INPUT ? (
        <div className="flex gap-1.5">
          <input
            value={customAmount}
            onChange={(event) => onCustomAmountChange(event.target.value)}
            aria-label="Custom buy amount in SOL"
            inputMode="decimal"
            className="t-num-sm h-8 min-w-0 flex-1 rounded-[var(--r-chip)] border border-[color:var(--hairline)] bg-[color:var(--input-bg)] px-2.5 text-[color:var(--ink-0)] outline-none transition-colors focus:border-[color:var(--hairline-2)]"
          />
          <QuickChip side="buy" onClick={onCustomSubmit} className="w-20">
            Buy
          </QuickChip>
        </div>
      ) : null}
    </div>
  );
}

function SellSection({
  pctChips,
  solChips,
  tokenBalance,
  cachedTokenBalance,
  priceLamportsPerBaseUnit,
  receiveUsdRate,
  quote,
  mode,
  onModeChange,
  onSellPct,
  onSellSol,
}: {
  pctChips: ReadonlyArray<string>;
  solChips: ReadonlyArray<string>;
  /** Display balance; `null` while the current wallet's balance is truly
   *  unknown (e.g. right after a wallet switch). */
  tokenBalance: string | null;
  /** Last remembered display balance for the CURRENT wallet key, shown
   *  muted while `tokenBalance` is null. DISPLAY ONLY — never sizes. */
  cachedTokenBalance: string | null;
  priceLamportsPerBaseUnit: number;
  /** Live SOL/USD when the pair settles in USDC (est-receive renders
   *  in $); null on SOL pairs. */
  receiveUsdRate: number | null;
  quote: TradeSellQuoteInfo | null;
  mode: SellMode;
  onModeChange: (mode: SellMode) => void;
  onSellPct: (pct: number) => void;
  onSellSol: (sol: number) => void;
}) {
  // Previews estimate against the KNOWN balance only — the remembered
  // display value never feeds an est-receive hint.
  const previewBalance = tokenBalance ?? '0';
  const hasBalance = bigIntSafe(previewBalance) > 0n;
  const shownBalance = tokenBalance ?? cachedTokenBalance;
  const { ref, rows } = useFittingRows();
  const visibleCount = rows * 4;
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', SECTION_GAP)}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <SideLabel>Sell</SideLabel>
          <SellModeToggle mode={mode} onChange={onModeChange} />
          {/* Mode-aware pencil: edits the sell set the chips currently
              render (% presets vs "sell N SOL worth" presets). */}
          <QuickChipsEditor
            field={mode === 'sol' ? 'sellSol' : 'sell'}
            unit={mode === 'sol' ? 'sol' : 'pct'}
            title={mode === 'sol' ? 'Sell amounts' : 'Sell percentages'}
            sell
            variant="ghost"
          />
        </div>
        {/* Known balance in the usual tones; a remembered (stale) value
            renders muted; a truly unknown balance shows a dash. */}
        <Caption size="sm" tone={tokenBalance !== null && hasBalance ? 'ink-3' : 'ink-4'}>
          {shownBalance !== null ? `${formatTokenAmount(shownBalance)} tokens` : '– tokens'}
        </Caption>
      </div>
      <div ref={ref} className={cn(CHIP_GRID, 'min-h-0 flex-1')}>
        {mode === 'sol'
          ? solChips.slice(0, visibleCount).map((sol, i) => (
              <QuickChip
                key={`${i}-${sol}`}
                side="sell"
                onClick={() => onSellSol(Number(sol))}
                hoverPreview={sellSolPreview(Number(sol), priceLamportsPerBaseUnit, previewBalance)}
              >
                {sol}
              </QuickChip>
            ))
          : pctChips.slice(0, visibleCount).map((pct, i) => (
              <QuickChip
                key={`${i}-${pct}`}
                side="sell"
                onClick={() => onSellPct(Number(pct))}
                hoverPreview={sellPctPreview(
                  previewBalance,
                  Number(pct),
                  priceLamportsPerBaseUnit,
                  quote,
                  receiveUsdRate,
                )}
              >
                {`${pct}%`}
              </QuickChip>
            ))}
      </div>
    </div>
  );
}

function QuickChip({
  side,
  children,
  onClick,
  className,
  hoverPreview,
}: {
  side: ChipSide;
  children: string;
  onClick: () => void;
  className?: string;
  hoverPreview?: string;
}) {
  // Submit at pointerdown instead of click: a click waits for pointer-up,
  // paying the 60-120ms press duration on the order's critical path.
  // Deduping the same press's synthetic click is PRESS-SCOPED, not
  // time-windowed: a press held longer than any fixed window would fire
  // the click after the window and SUBMIT THE ORDER TWICE (live repro).
  // The flag arms at pointerdown-submit and is consumed by the press's
  // click; pointercancel clears it; a slide-off release leaves it armed,
  // which the next pointerdown simply re-arms (pointerdown submits
  // regardless), so no press is ever swallowed. Keyboard activation
  // (Enter/Space → click with detail === 0) always submits; the 750ms
  // stamp only dedups assistive tech that dispatches BOTH a pointerdown
  // and a detail===0 click for one press.
  const pressSubmittedRef = useRef(false);
  const pointerFiredAtRef = useRef(0);
  return (
    <HoverPreview label={hoverPreview}>
    <button
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pressSubmittedRef.current = true;
        pointerFiredAtRef.current = Date.now();
        onClick();
      }}
      onPointerCancel={() => {
        pressSubmittedRef.current = false;
        pointerFiredAtRef.current = 0;
      }}
      onClick={(event) => {
        if (event.detail > 0) {
          if (pressSubmittedRef.current) {
            // Same-press synthetic click — already submitted at
            // pointerdown, however long the press was held. Clear the
            // AT stamp too so a keyboard activation right after a click
            // is never mistaken for the same press.
            pressSubmittedRef.current = false;
            pointerFiredAtRef.current = 0;
            return;
          }
          onClick();
          return;
        }
        if (Date.now() - pointerFiredAtRef.current < 750) return;
        onClick();
      }}
      className={cn(instantChip({ side }), className)}
      // Override `.amt-chip`'s fixed 28px height so the chip stretches to
      // fill its grid row — lets the buy/sell rows scale with the panel.
      style={{ height: '100%' }}
    >
      {children}
    </button>
    </HoverPreview>
  );
}

/*
 * ── THE CURRENCY MARK FOLLOWS THE QUOTE MODE ─────────────────────────
 *
 * This was a hardcoded Solana mark. The BUY header already swapped to a
 * `$` when the box was quoting in USDC, so switching currency changed
 * one half of the panel and left the other insisting on SOL — the sell
 * side and the ledger both kept the wrong money's logo on them.
 *
 * One component, read from the store, used everywhere a quote mark is
 * drawn. It cannot disagree with itself now.
 */
function QuoteGlyph({ size = 12 }: { size?: number }) {
  const mode = useTradeStore((s) => s.usdcTrade.trade_quote_mode);
  if (mode === 'usdc') {
    return (
      <img
        src="/assets/quotes/usdc.png"
        alt=""
        width={size}
        height={size}
        style={{ flexShrink: 0, borderRadius: 999, display: 'block' }}
      />
    );
  }
  return <Solana style={{ width: size, height: size, flexShrink: 0, display: 'block' }} />;
}

function SolGlyph() {
  // Sized to match the adjacent `Numeral size="sm"` (13px) in the P&L strip.
  return <QuoteGlyph size={12} />;
}

/**
 * Borderless `% / ◎` sell-mode toggle — same clean glow treatment as the
 * P1/P2/P3 preset toggle: the selected option lights up (accent glow for
 * `%`, full-strength SOL mark), the other is greyed out.
 */
function SellModeToggle({
  mode,
  onChange,
}: {
  mode: SellMode;
  onChange: (mode: SellMode) => void;
}) {
  const pctActive = mode === 'pct';
  const solActive = mode === 'sol';
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange('pct')}
        aria-pressed={pctActive}
        aria-label="Sell a percentage of holdings"
        className="inline-flex cursor-pointer items-center justify-center"
        style={{
          padding: '2px 5px',
          fontFamily: 'var(--sans)',
          fontSize: 12,
          fontWeight: pctActive ? 700 : 500,
          color: pctActive ? 'var(--accent-primary)' : 'var(--ink-3)',
          background: 'transparent',
          border: 'none',
          textShadow: pctActive ? '0 0 10px var(--accent-glow, var(--accent-primary))' : 'none',
          transition: 'color 120ms var(--ease-out), text-shadow 120ms var(--ease-out)',
        }}
      >
        %
      </button>
      <button
        type="button"
        onClick={() => onChange('sol')}
        aria-pressed={solActive}
        aria-label="Sell a SOL amount"
        className="inline-flex cursor-pointer items-center justify-center"
        style={{
          padding: '2px 5px',
          background: 'transparent',
          border: 'none',
          opacity: solActive ? 1 : 0.4,
          filter: solActive
            ? 'drop-shadow(0 0 6px color-mix(in srgb, var(--accent-primary) 60%, transparent))'
            : 'none',
          transition: 'opacity 120ms var(--ease-out), filter 120ms var(--ease-out)',
        }}
      >
        <QuoteGlyph size={13} />
      </button>
    </div>
  );
}

/** UPPERCASE side label ("Buy" / "Sell") — a touch larger than `Caption`. */
function SideLabel({ children }: { children: string }) {
  return (
    <span
      className="font-semibold uppercase"
      style={{
        fontFamily: 'var(--sans)',
        fontSize: 13,
        letterSpacing: '0.06em',
        color: 'var(--ink-2)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * Bottom P&L footer: BOUGHT / SOLD / HOLDING / PNL as four label-less,
 * SOL-denominated cells split by hairline dividers and color-coded by
 * role (bought=up, sold=down, holding=neutral, pnl=signed). No outer
 * container — just a full-width row under a single hairline separator.
 * PNL gets a double-width track since its value carries both amount and
 * percent.
 */
function LedgerStrip({ pnl }: { pnl: MockPnL }) {
  const pnlTone: Tone = pnl.pnl.trim().startsWith('-') ? 'down' : 'up';
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_2fr]">
      <LedgerCell value={pnl.bought} tone="up" divider />
      <LedgerCell value={pnl.sold} tone="down" divider />
      <LedgerCell value={pnl.holding} tone="ink-0" divider />
      <LedgerCell value={pnl.pnl} tone={pnlTone} />
    </div>
  );
}

function LedgerCell({ value, tone, divider }: { value: string; tone: Tone; divider?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-center gap-1.5 py-0.5',
        divider && 'border-r border-[color:var(--hairline)]',
      )}
    >
      <SolGlyph />
      <Numeral size="sm" tone={tone} className="truncate">
        {value}
      </Numeral>
    </div>
  );
}

/** Zeroed P&L strip used before any tracked fills; HOLDING still shows
 *  the live value of tokens already in the wallet. */
function zeroLedgerPnl(holdingLamports: number): MockPnL {
  return {
    bought: '0',
    sold: '0',
    holding: formatSolCompact(holdingLamports / 1e9),
    pnl: '0',
  };
}

function tokensToLamports(tokens: string, priceLamportsPerBaseUnit: number): number {
  if (!priceLamportsPerBaseUnit) return 0;
  try {
    return Math.max(0, Number(tokens)) * priceLamportsPerBaseUnit;
  } catch {
    return 0;
  }
}

// Local copy of `solToLamportsDecimalString` (also in TradePanel.tsx
// and useTradeStream.ts). The api/ batch route expects
// `amount_lamports` as a positive-integer decimal string; using
// `Number * 1e9 → Math.floor` round-trips through the 8-9th decimal
// imprecisely, so we serialise via a fixed-9 string + BigInt.
function solToLamportsDecimalString(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0';
  const [whole, frac = ''] = sol.toFixed(9).split('.');
  const padded = frac.padEnd(9, '0').slice(0, 9);
  try {
    const lamports = BigInt(whole ?? '0') * 1_000_000_000n + BigInt(padded || '0');
    return lamports.toString();
  } catch {
    return '0';
  }
}

function sellPctPreview(
  tokenBalance: string,
  pct: number,
  priceLamportsPerBaseUnit: number,
  quote: TradeSellQuoteInfo | null,
  receiveUsdRate: number | null,
): string {
  const rawAmount = pctOfBaseUnits(tokenBalance, pct);
  if (rawAmount === '0') return `Est. receive: ${receiveUsdRate != null ? '$0' : '0 SOL'}`;
  const lamports = estimateSellLamports(rawAmount, quote, priceLamportsPerBaseUnit);
  if (receiveUsdRate != null) {
    return `Est. receive: ${formatUsdAmount((lamports / 1e9) * receiveUsdRate)}`;
  }
  return `Est. receive: ${formatSol(lamports, 4)}`;
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

/** $ spend converted to lamports at the live SOL/USD rate; 0n without a
 *  rate. Preview-only. */
function usdSpendLamports(usd: number, solUsd: number | null): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || solUsd == null || solUsd <= 0) return 0n;
  return solSpendLamports(usd / solUsd);
}

/**
 * Hover preview for a buy chip: approximate tokens the spend receives via
 * the venue quote (constant-product + fee haircut), spot-price fallback
 * when no quote is polled yet. Clearly approximate — the engine applies
 * swap tolerance + the user's slippage at execution. Multi-wallet chips
 * are the TOTAL spend (the api equal-splits), noted in the copy.
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

/** Hover preview for a SOL-mode sell chip: how many tokens ~N SOL buys
 *  back at the live spot price, capped at the wallet's holdings. */
function sellSolPreview(
  solTarget: number,
  priceLamportsPerBaseUnit: number,
  tokenBalance: string,
): string {
  if (!priceLamportsPerBaseUnit || priceLamportsPerBaseUnit <= 0) return 'Sell ~? tokens';
  let baseUnits = BigInt(Math.floor((solTarget * 1e9) / priceLamportsPerBaseUnit));
  const balance = bigIntSafe(tokenBalance);
  if (balance > 0n && baseUnits > balance) baseUnits = balance;
  if (baseUnits <= 0n) return 'Sell ~0 tokens';
  return `Sell ~${formatTokenAmount(baseUnits.toString())} tokens`;
}

function formatSol(lamports: number, frac = 4): string {
  if (!Number.isFinite(lamports) || lamports === 0) return '0 SOL';
  const sol = lamports / 1e9;
  if (Math.abs(sol) < DISPLAY_ZERO_SOL) return '0 SOL';
  if (Math.abs(sol) < 0.0001) return `${sol.toExponential(2)} SOL`;
  return `${sol.toFixed(frac)} SOL`;
}

function trimAmount(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  return trimmed.replace(/0+$/, '').replace(/\.$/, '') || trimmed;
}

function createClientOrderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `instant-${crypto.randomUUID()}`;
  }
  return `instant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function orderKeyId(key: TradeOrderKey): string {
  return `${key.seq}:${key.tsMs}`;
}

/** Stable per-event dedup id for the order-event ring (mirrors TradePanel). */
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

function shortSig(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'error';
}

/** Human copy for a rejected single order; reauth gets the friendly line
 *  (the /me invalidation happens centrally in `useTradeStream.submit`). */
function rejectionMessage(errorKind: string | undefined): string {
  if (errorKind === 'reauth_required') return REAUTH_HUMAN_MESSAGE;
  return `Rejected: ${errorKind ?? 'unknown'}`;
}

function formatHave(error: { kind: string; [k: string]: unknown }): string {
  const have = typeof error['have'] === 'string' ? error['have'] : null;
  return have ? `${formatTokenAmount(have)} tokens` : '0 tokens';
}

function bigIntSafe(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function isBelowDisplaySellableBalance(baseUnits: string): boolean {
  return bigIntSafe(baseUnits) < MIN_DISPLAY_SELLABLE_BASE_UNITS;
}

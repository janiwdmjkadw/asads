'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { TokenHeaderBar } from './TokenHeaderBar';
import { ChartToolbar } from './ChartToolbar';
import { PriceChart, type ChartCoinCall } from './PriceChart';
import { createCandleAggregator, timeframeFetchPlan, type ChartTimeframe } from './timeframes';
import { DEV_TOKENS_PAGE_SIZE, useDevTokens } from './useDevTokens';
import { useAdvancedOrders } from './orders-tab/useAdvancedOrders';
import { useMe } from '@/lib/api/me';
import { useAlphaFeed } from '@/lib/api/alpha-calls';
import { parseCompactUsd } from '@/lib/api/alpha-calls-shared';
import { TradePanel } from './TradePanel';
import { InstantTradeBox } from './InstantTradeBox';
import { TradesTable } from './TradesTable';
import { useWalletClasses } from './useWalletClasses';
import { useStableEventArray, useStableKeyedArray } from './stableChartEvents';
import { AnalyticsPanel } from './AnalyticsPanel';
import { RailColumn } from './RailColumn';
import { StatusBadge } from '@/components/listen/primitives';
import { PanelStack, type StackPanel } from '@/components/discover/layout/PanelStack';
import { useTradeLayoutStore } from '@/lib/state/trade-layout-store';
import { useUrlMint } from '@/components/listen/useUrlMint';
import { useTradePaneHidden } from './tradePaneVisibility';
import {
  isEstablishedTokenMint,
  isRememberedLiveTokenMint,
  prefetchView,
  readTokenNavigationHint,
  rememberEstablishedTokenMint,
  shouldHandleTokenHintEvent,
  TOKEN_HINT_EVENT,
  type TokenNavigationSourceSection,
} from '@/components/listen/navigation';
import { useWalletBalanceContext } from '@/components/listen/WalletBalanceProvider';
import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { displayName, displayNameWithEmoji } from '@/components/discover/trackedWallets';
import { useWalletActivity } from '@/components/discover/useWalletActivity';
import { useTrackerWalletActivityForMint } from '@/components/tracker/hooks';
import { metricCount } from '@/lib/dev/hotPathMetrics';
import { TradeWalletActivity } from './TradeWalletActivity';
import { useDiscoverCoin } from '@/components/discover/discoverFeedStore';
import { tokenCardKey } from '@/components/discover/tokenIdentityCache';
import { useTerminalStore } from '@/lib/state/terminal-store';
import { useTradeStore } from '@/lib/state/trade-store';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useMultiWalletTokenBalance } from './useMultiWalletTokenBalance';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';
import type { MockToken, OHLCSnapshot, VolSnapshot, MockPnL, MockTrade } from './mockTrade';

// Honest "no data yet" placeholders rendered while the snapshot loads — all
// zeros / em-dashes, never fabricated values. Replaces the old mock* fixtures
// so the trade page never paints fake token/price/candle/trade data.
const EMPTY_VOL: VolSnapshot = {
  window: '',
  vol: '—',
  buys: { count: 0, amount: '—' },
  sells: { count: 0, amount: '—' },
  netVol: '—',
};
const EMPTY_OHLC: OHLCSnapshot = { o: 0, h: 0, l: 0, c: 0, change: 0, changePct: 0 };
const EMPTY_PNL: MockPnL = { bought: '0', sold: '0', holding: '0', pnl: '—' };
const EMPTY_TRADES: MockTrade[] = [];
const EMPTY_CHART_COIN_CALLS: ChartCoinCall[] = [];
const EMPTY_CHART_EVENTS: WalletActivityEvent[] = [];
const EMPTY_TOKEN_TRADES: TokenTrade[] = [];

/** Key-set identity for tape slices — same (signature:wallet) convention as
 *  the bubble event streams, so `useStableKeyedArray` proves "no
 *  bubble-relevant trade arrived" the same way `useStableEventArray` does. */
function tapeTradeKey(trade: TokenTrade): string {
  return `${trade.signature}:${trade.user}`;
}

/** Live-tape trade → chart bubble event (same wire shape as the wallet
 *  activity stream, so all bubble sources union by signature). */
function tradeToWalletEvent(trade: TokenTrade, mint: string): WalletActivityEvent {
  return {
    signature: trade.signature,
    slot: trade.slot,
    blockTimeMs: trade.blockTimeSec == null ? null : trade.blockTimeSec * 1_000,
    wallet: trade.user,
    mint,
    isBuy: trade.isBuy,
    solLamports: trade.solLamports,
    tokens: trade.tokenBaseUnits,
    venue: 'bonding_curve',
    receivedAtMs: trade.arrivedAtMs,
  };
}
import { adaptSnapshot, adaptTokenTrades } from './snapshotAdapter';
import { useTokenSnapshot } from './useTokenSnapshot';
import { mergeLiveTrades } from './liveOverlay';
import { useCandleTrades, type CandleTradeSelection } from './useCandleTrades';
import { useCandleHistory } from './useCandleHistory';
import { shouldHydrateLatestCandleHistory } from './candleHistoryPolicy';
import {
  latchHistoricalTradeBackfill,
  shouldUseHistoricalTradeBackfill,
  snapshotMatchesMint,
} from './tradeBackfillPolicy';
import { useHistoryTrades } from './useHistoryTrades';
import { MINT_WALLET_TRADES_MAX_WALLETS, useMintWalletTrades } from './useMintWalletTrades';
import { useChartPrefsStore } from '@/lib/state/chart-prefs-store';
import { useChartAlertsStore } from '@/lib/state/chart-alerts-store';
import { fireCrossedChartAlerts, MAX_ALERT_STREAMS } from './ChartAlertsWatcher';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { compactUsd } from '@/lib/format';
import { toast } from 'sonner';
import { useTopHolders } from './useTopHolders';
import {
  readTrackedHoldersPref,
  useTrackedHolders,
  writeTrackedHoldersPref,
} from './useTrackedHolders';
import { useTopTraders } from './useTopTraders';
import { useTradeStream, type TradeSellQuoteInfo } from './useTradeStream';
import { useSelectedTokenStream } from './useSelectedTokenStream';
import { useTradePresence } from './useTradePresence';
import { isStubSnapshot } from './types';
import type { BackfillStatus, CandleResolution, TokenTrade } from './types';

/**
 * Trade-terminal page (Listen redesign).
 *
 * Shared chrome (`.listen-root`, ambient background, top nav, theme, and
 * tracked-wallet store) is owned by the persistent terminal shell. This
 * component just composes the route-scoped trade panels and streams.
 *
 * Responsive behavior — driven by Tailwind breakpoints:
 *
 *   ≥xl (1280px)  Chart + 320px rail side-by-side; Trades + 320px
 *                 analytics side-by-side. (Original wide layout.)
 *   lg (1024px)   Same structure but rail narrows to 280px.
 *   <lg           Right rail stacks BELOW the chart. TradePanel and
 *                 AnalyticsPanel sit side-by-side at md+, full-width
 *                 stacked below md.
 *
 * Chart row uses `min-h-[var(--chart-h-min)]` as a floor and
 * `xl:h-[var(--chart-h)]` as a fixed height on wide viewports.
 */
const RUST_API_ENABLED = true;
const TOKEN_SNAPSHOT_POLL_MS = 5_000;
// Floor between classified-wallet (sniper/bundler) additions to the bubble
// wallet-trades query key — see the `classifiedWalletsKey` commit throttle.
const BUBBLE_CLASSIFIED_COMMIT_MIN_MS = 10_000;
const DIRECT_UNKNOWN_BACKFILL_DELAY_MS = 750;
const INSTANT_TRADE_OPEN_KEY = 'trade:instant-box-open:v1';
/**
 * Default vertical split weights for the left column's chart vs trades
 * table. The chart starts a touch taller (~370px at a typical laptop
 * viewport, matching the old `--chart-h`); a user drag persists per-id
 * weights to `trade-layout-store` and overrides these.
 */
const CHART_WEIGHT = 1.15;
const TABLE_WEIGHT = 1;
/** lg breakpoint — above it the page is viewport-locked with a resizable
 *  chart/table split; below it everything stacks and the page scrolls. */
const LG_QUERY = '(min-width: 1024px)';

/**
 * Tracks the lg breakpoint via matchMedia. Defaults to `true` so SSR and
 * the hydration render both paint the locked desktop layout (no hydration
 * mismatch); a LAYOUT effect corrects to the real value synchronously
 * before the browser paints. On mobile that re-parents the chart/table/
 * panel sections BEFORE their passive mount effects run (chart creation is
 * a passive effect in PriceChart), so the lightweight-charts instance is
 * built exactly once, in the mobile layout — no desktop-frame flash, no
 * chart teardown+rebuild after first paint.
 */
function useIsLgUp(): boolean {
  const [isLgUp, setIsLgUp] = useState(true);
  useLayoutEffect(() => {
    const mql = window.matchMedia(LG_QUERY);
    const onChange = () => setIsLgUp(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isLgUp;
}

interface TablePaginationState {
  mint: string | undefined;
  holderPageIndex: number;
  topTraderPageIndex: number;
  devPageIndex: number;
}

export function TradePage({ mintOverride }: { mintOverride?: string | null } = {}) {
  const urlMint = useUrlMint();
  // The persistent trade pane passes the RETAINED mint while hidden (the
  // URL no longer carries one) so the page keeps rendering its last token
  // and the reveal needs no data work. In-route rendering passes nothing.
  const mint = mintOverride ?? urlMint;
  // Hidden persistent pane → dormant: polls/heartbeat stop, the SSE
  // buffers without applying. Reveal heals with one snapshot refetch.
  const paneHidden = useTradePaneHidden();
  const setSelectedMint = useTerminalStore((state) => state.setSelectedMint);
  const chartSectionRef = useRef<HTMLElement | null>(null);
  const timeframe = useTradeStore((state) => state.chartInterval);
  // Native resolution + group behind the display timeframe (5s/4h/12h/1d
  // aggregate client-side from a native base; see timeframes.ts).
  const candlePlan = timeframeFetchPlan(timeframe);
  const setTimeframe = useTradeStore((state) => state.setChartInterval);
  const layoutSizes = useTradeLayoutStore((state) => state.layout.sizes);
  const setLayoutSizes = useTradeLayoutStore((state) => state.setSizes);
  const hydrateLayout = useTradeLayoutStore((state) => state.hydrateLayout);
  const isLgUp = useIsLgUp();
  // Mint-gated: a candle-filtered trades table must never carry the
  // previous token's bucket onto the next token (back/forward nav or any
  // programmatic mint switch would otherwise filter the new token's
  // trades by a stale bucket).
  const [selectedCandleRaw, setSelectedCandleRaw] = useState<
    (CandleTradeSelection & { mint?: string }) | null
  >(null);
  const [tablePagination, setTablePagination] = useState<TablePaginationState>({
    mint: undefined,
    holderPageIndex: 0,
    topTraderPageIndex: 0,
    devPageIndex: 0,
  });
  const instantTradeOpen = useTerminalStore((state) => state.instantTradeOpen);
  const setInstantTradeOpen = useTerminalStore((state) => state.setInstantTradeOpen);
  const [instantTradeAnchor, setInstantTradeAnchor] = useState<DOMRectReadOnly | null>(null);
  const [tokenHintVersion, setTokenHintVersion] = useState(0);
  const effectiveMint = RUST_API_ENABLED ? mint : null;
  const tradeMint = effectiveMint ?? mint ?? undefined;
  // Per-coin feed subscription: the page root re-renders only when the
  // CURRENT mint's feed entry changes — never on unrelated SSE frames (the
  // old `useDiscoverFeed()` array got a new reference ~4×/s and re-rendered
  // the whole trade page). Effects that need the full list read
  // `discoverFeedStore.getSnapshot()` imperatively instead.
  const currentFeedCoin = useDiscoverCoin(
    effectiveMint ? tokenCardKey({ id: effectiveMint }) : 'mint:',
  );
  const trackedWallets = useTrackedWalletsContext();
  const walletBalance = useWalletBalanceContext();
  // Presence beats for the viewers chip: only while this pane is the
  // visible surface (hidden persistent panes are not viewers).
  useTradePresence(tradeMint, !paneHidden);
  const tradeStream = useTradeStream(tradeMint ?? null, { paused: paneHidden });
  // Single source of the multi-wallet token-balance fan-out for this
  // page. Owned here (not inside TradePanel + InstantTradeBox) so the
  // two surfaces share ONE snapshot instead of each running its own
  // poll loop when the instant box is open.
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  const isMultiWalletTrade = multiSelectedWalletAccountIds.length >= 2;
  const multiTokenBalance = useMultiWalletTokenBalance(
    tradeMint ?? null,
    // Hidden persistent pane → empty ids: tears down the per-wallet balance
    // SSE streams + the 250ms tick (the empty-ids branch already cleans up);
    // reveal re-runs the effect with an immediate tick. Sell hints are read
    // at order time only, so no stale sum can leak into a submission.
    isMultiWalletTrade && !paneHidden ? multiSelectedWalletAccountIds : [],
  );
  useEffect(() => scheduleDeferredNavigationPrefetch(() => prefetchView('discover')), []);
  useEffect(() => {
    setSelectedMint(mint);
  }, [mint, setSelectedMint]);
  useLayoutEffect(() => {
    setInstantTradeOpen(readInstantTradeOpen());
  }, [setInstantTradeOpen]);
  // Hydrate the persisted chart/table split after mount. SSR + first
  // client render use the store default (empty → engine weights) so the
  // markup matches; this runs pre-paint, no visible flash. Mirrors Discover.
  useLayoutEffect(() => {
    hydrateLayout();
  }, [hydrateLayout]);
  const mintFromDiscover = useMemo(
    () =>
      Boolean(
        effectiveMint &&
        (isRememberedLiveTokenMint(effectiveMint) ||
          // A coin previously opened in this session (resolved to a real, non-stub
          // snapshot) stays "known" for 30 min, so a return visit keeps
          // `hydrateIdentity` stable and reads the warm snapshot cache key instead
          // of flipping it and paying a cold refetch.
          isEstablishedTokenMint(effectiveMint) ||
          // Per-coin store lookup ≡ the old `feed.some(coin.id === mint)`.
          currentFeedCoin != null),
      ),
    [currentFeedCoin, effectiveMint],
  );
  // Sticky "known mint" signal. `mintFromDiscover` is time-boxed (a 2-min sessionStorage
  // TTL + current-feed membership), so on its own it flips back to false for a known
  // graduated/ripening token after ~2 minutes — which would wrongly re-enable auto-backfill
  // + identity hydration for a mint we already have cached. Pin known-ness once established
  // (from discover now, or once the snapshot resolves to a real non-stub state below) for
  // the lifetime of viewing this mint, so backfill only ever fires for genuinely
  // unknown/cold mints. Reset only when the viewed mint changes.
  // `stubDemoted` is the escape hatch for a WRONG known-ness: a live-token
  // sighting (e.g. a tracked-wallet trade re-stubbing an idle coin) marks the
  // mint known, but known-ness disables exactly the two mechanisms that can
  // populate a metadata-less stub — identity hydration and auto-backfill.
  // When the snapshot resolves to a stub we demote (effect below), and the
  // demotion must stick: without this flag the render-phase latch would
  // re-promote on the very next render while the 2-min live-token TTL holds.
  const knownMintRef = useRef<{ mint: string | null; known: boolean; stubDemoted: boolean }>({
    mint: null,
    known: false,
    stubDemoted: false,
  });
  if (knownMintRef.current.mint !== effectiveMint) {
    knownMintRef.current = { mint: effectiveMint, known: mintFromDiscover, stubDemoted: false };
  } else if (mintFromDiscover && !knownMintRef.current.stubDemoted) {
    knownMintRef.current.known = true;
  }
  const isKnownMint = knownMintRef.current.known;
  // Must match `useTokenSnapshot`'s `hydrateIdentity` below so the live stream's
  // setQueryData writes to the same snapshot query key the page reads.
  const hydrateSnapshotIdentity = !isKnownMint;
  const selectedTokenStream = useSelectedTokenStream(
    tradeMint ?? null,
    hydrateSnapshotIdentity,
    paneHidden,
  );
  // Healthy = connected, not syncing, and watermark-fresh (a violated
  // watermark forces a reconnect, flipping this false). While healthy the
  // snapshot interval polls the lite body — the stream owns trades/candles.
  const snapshotStreamHealthy = selectedTokenStream.connected && !selectedTokenStream.syncing;
  const { snapshot: rawSnapshot, loading, error, backfillStatus } = useTokenSnapshot(
    effectiveMint,
    paneHidden ? 0 : TOKEN_SNAPSHOT_POLL_MS,
    {
      backfillMode: isKnownMint ? 'disabled' : 'auto',
      autoBackfillDelayMs: DIRECT_UNKNOWN_BACKFILL_DELAY_MS,
      hydrateIdentity: !isKnownMint,
      streamHealthy: snapshotStreamHealthy,
      // snapshot_lite frames riding the stream demote the lite poll to
      // repair-only (old servers never emit them -> flag stays false and
      // the 5s lite poll continues unchanged).
      liteViaStream: selectedTokenStream.liteViaStream,
    },
  );
  // SINGLE gating point for the keepPreviousData-across-mints hazard: every
  // consumer below reads this mint-gated snapshot, so on a fast token-to-token
  // nav the previous mint's snapshot can never seed the new mint's backfill
  // latch, candle hydration, header, or trade rows. The same-mint
  // `hydrateIdentity` flip still benefits from keepPreviousData (the cached
  // payload's mint matches, so it passes the gate unchanged).
  const snapshot = snapshotMatchesMint(rawSnapshot, effectiveMint);
  // Previous mint's data is still the cached placeholder → the new mint's
  // fetch is effectively in flight, even if react-query reports success.
  const snapshotIsStalePlaceholder = rawSnapshot != null && snapshot == null;
  // Once the snapshot resolves to a real (non-stub) state, treat the mint as known for the
  // rest of this view so a later live-token TTL flip can't re-trigger backfill/hydration.
  useEffect(() => {
    if (knownMintRef.current.mint !== effectiveMint) return;
    const resolvedKnown = snapshot?.stateKind === 'live'
      || snapshot?.stateKind === 'backfilled'
      || Boolean(snapshot?.graduatedAtMs);
    if (resolvedKnown) {
      knownMintRef.current.known = true;
      knownMintRef.current.stubDemoted = false;
      // Persist across navigations so the next visit to this mint is "known" on
      // mount (stable hydrateIdentity → warm cache key → instant return).
      if (effectiveMint) rememberEstablishedTokenMint(effectiveMint);
    } else if (snapshot != null && isStubSnapshot(snapshot) && knownMintRef.current.known) {
      // The warm-path assumption was wrong: the engine only holds a
      // metadata-less stub for this "known" mint. Demote so hydrateIdentity
      // + auto-backfill re-arm on the next render (the page re-renders
      // continuously on stream ticks); the flag above keeps the live-token
      // TTL from re-promoting until the snapshot genuinely resolves.
      knownMintRef.current.known = false;
      knownMintRef.current.stubDemoted = true;
    }
  }, [effectiveMint, snapshot]);
  const activeQuotePriceLamportsPerBaseUnit = useMemo(
    () => priceFromActiveQuote(tradeStream.tokenBalanceInfo?.quote ?? null),
    [tradeStream.tokenBalanceInfo?.quote],
  );
  // `loadingToken` only needs to know whether a live quote EXISTS, not its value. Keying it
  // off the raw price would re-allocate `loadingToken` on every quote tick (every 2s, 250ms
  // while an order is in-flight) — and since `loadingToken` feeds the `adapted` memo, that
  // would rebuild the full ~5k-candle array + `series.setData` on each tick while holding a
  // position. A boolean only flips once, so the candle pipeline stays put.
  const hasActiveQuote = activeQuotePriceLamportsPerBaseUnit != null;
  // Stabilize the hint's *identity*. `tokenHintForMint` allocates a fresh object each
  // call, so without this `liveTokenHint` changed reference on every render — cascading
  // into `loadingToken`, the `adapted` memo (re-running `adaptSnapshot`), and the full
  // candle pipeline (`series.setData` of up to ~5k candles) on EVERY render. Combined
  // with the per-trade SSE + the discover hint-event storm, that pinned the main thread
  // and froze the page on graduated/ripening mints. Returning the previous reference when
  // the *content* is unchanged makes the pipeline recompute only when the snapshot
  // actually changes. Only the current mint's feed entry matters (the old full-feed
  // `find` could only match it), so the per-coin subscription is behavior-identical.
  const liveTokenHintRef = useRef<{ sig: string; value: TradeTokenHint | null }>({ sig: '', value: null });
  const liveTokenHint = useMemo(() => {
    void tokenHintVersion; // bump forces a re-read of the persisted navigation hint
    const candidate = tokenHintForMint(
      tradeMint,
      currentFeedCoin && currentFeedCoin.id === tradeMint ? [currentFeedCoin] : [],
    );
    const sig = candidate ? JSON.stringify(candidate) : '';
    if (liveTokenHintRef.current.sig === sig) {
      return liveTokenHintRef.current.value;
    }
    liveTokenHintRef.current = { sig, value: candidate };
    return candidate;
  }, [tradeMint, currentFeedCoin, tokenHintVersion]);
  const sourceSection = liveTokenHint?.sourceSection ?? null;
  const currentNewPairHotOnly = useMemo(
    () =>
      Boolean(
        effectiveMint &&
        currentFeedCoin
        && currentFeedCoin.graduated !== true
        && currentFeedCoin.graduatedAtMs == null
        && !isRipeningLamports(currentFeedCoin.realSolLamports),
      ),
    [currentFeedCoin, effectiveMint],
  );
  const historyHydrationOptions = useMemo(() => {
    const forceHydrate = sourceSection === 'almost-graduated' || sourceSection === 'graduated';
    return {
      forceHydrate,
      hotOnlyNewPair: !forceHydrate && (sourceSection === 'new-pairs' || (sourceSection == null && currentNewPairHotOnly)),
    };
  }, [currentNewPairHotOnly, sourceSection]);
  const holderPageIndex = tablePagination.mint === tradeMint ? tablePagination.holderPageIndex : 0;
  const topTraderPageIndex =
    tablePagination.mint === tradeMint ? tablePagination.topTraderPageIndex : 0;
  const devPageIndex = tablePagination.mint === tradeMint ? tablePagination.devPageIndex : 0;
  // The masked reads above make a foreign mint's state READ as page 0, but
  // the state itself survives token A → B → A (the pane never unmounts), so
  // returning to A would silently reopen its old page — possibly past the
  // now-shrunk table. Clear in place the moment the viewed mint changes
  // (render-phase keyed reset, same idiom as knownMintRef above).
  if (tablePagination.mint !== undefined && tablePagination.mint !== tradeMint) {
    setTablePagination({
      mint: undefined,
      holderPageIndex: 0,
      topTraderPageIndex: 0,
      devPageIndex: 0,
    });
  }
  // Selected table tab (reported by TradesTable): only the visible table
  // polls at panel cadence — an unselected Holders/Top-Traders tab keeps
  // its cached rows and refreshes within one poll of being opened.
  const [tableTab, setTableTab] = useState<string>('trades');
  // TRACKED filter (Holders tab): show only the user's tracked wallets.
  // Persisted preference like the LISTEN view — hydrated post-mount so the
  // first client render matches the server HTML.
  const [trackedOnly, setTrackedOnly] = useState(false);
  useEffect(() => {
    setTrackedOnly(readTrackedHoldersPref());
  }, []);
  const toggleTrackedOnly = useCallback(() => {
    const next = !trackedOnly;
    setTrackedOnly(next);
    writeTrackedHoldersPref(next);
  }, [trackedOnly]);
  // LISTEN card view (reported by TradesTable) — the tracked fan-out only
  // runs while the standard holders table is the visible surface.
  const [listenViewOn, setListenViewOn] = useState(false);
  useEffect(() => {
    const bumpVersion = () => {
      metricCount('tradePageHintReactions');
      setTokenHintVersion((version) => version + 1);
    };
    // Only react to a hint event for the mint we're actually viewing. The
    // Discover feed dispatches identity-change events for unrelated coins;
    // reacting to all of them re-ran this page's memos dozens of times/sec.
    const onHintEvent = (event: Event) => {
      if (shouldHandleTokenHintEvent((event as CustomEvent).detail, tradeMint)) bumpVersion();
    };
    // `storage` only fires for changes from OTHER tabs (rare); keep it as a
    // cross-tab refresh but it never contributes to the same-tab event storm.
    window.addEventListener(TOKEN_HINT_EVENT, onHintEvent);
    window.addEventListener('storage', bumpVersion);
    return () => {
      window.removeEventListener(TOKEN_HINT_EVENT, onHintEvent);
      window.removeEventListener('storage', bumpVersion);
    };
  }, [tradeMint]);
  const loadingToken = useMemo<MockToken>(() => {
    const symbol = liveTokenHint?.symbol || shortMint(tradeMint) || 'Live';
    const name = liveTokenHint?.name || symbol;
    // Built from real navigation-hint fields only; every unknown is an honest
    // empty/zero (no leaked mock age/platform/source/score/txns/agent).
    return {
      mintAddress: tradeMint ?? '',
      symbol,
      ticker: symbol,
      name,
      mintShort: shortMint(tradeMint) || symbol,
      imageUrl: liveTokenHint?.imageUrl ?? '',
      imageFallbackUrl: liveTokenHint?.imageFallbackUrl ?? null,
      twitterUrl: liveTokenHint?.twitterUrl ?? null,
      telegramUrl: liveTokenHint?.telegramUrl ?? null,
      websiteUrl: liveTokenHint?.websiteUrl ?? null,
      ageLabel: '',
      price: hasActiveQuote ? 'Live quote' : '—',
      liquidity: hasActiveQuote ? 'Live quote' : '—',
      marketCap: liveTokenHint?.marketCap ?? '—',
      ath: '—',
      platform: '',
      source: '',
      txns: liveTokenHint?.txns ?? 0,
      score: 0,
      hasWebsite: Boolean(liveTokenHint?.websiteUrl),
      hasLink: Boolean(
        liveTokenHint?.twitterUrl || liveTokenHint?.telegramUrl || liveTokenHint?.websiteUrl,
      ),
      hasAgent: false,
      isMayhem: liveTokenHint?.kinds?.includes('mayhem') ?? false,
      isCashback: liveTokenHint?.kinds?.includes('cashback') ?? false,
    };
  }, [hasActiveQuote, liveTokenHint, tradeMint]);
  const liveSnapshotComplete = snapshot?.stateKind === 'live' || snapshot?.stateKind === 'stub';
  // A graduated coin's full trade history lives in cold storage: its hot
  // `recent_trades` ring is only the post-restart/post-eviction tail (the bonding
  // curve is done; ongoing AMM trades are merged from the live stream below). Gate
  // cold-history hydration on graduation too, not just `backfilled`, otherwise a
  // rehydrated graduated coin (stateKind `live`) shows only trades since it was
  // re-marked. Mirrors `shouldHydrateLatestCandleHistory`'s graduation branch.
  // LATCH the cold-history gate one-way per mint (mirrors `useCandleHistory`'s
  // `hydrateLatchRef`). `graduated`/`stateKind` oscillate between the 1s REST poll and the
  // live SSE merge mid-rehydration; without the latch a transient `false` would flip
  // `usesHistoricalBackfill` off, empty `historyTrades`, and reset the table to the small
  // snapshot tail — the "only the last few rows" flash. Once eligible, stay eligible.
  const backfillLatchRef = useRef<{ mint: string | null; latched: boolean }>({
    mint: tradeMint ?? null,
    latched: shouldUseHistoricalTradeBackfill(snapshot, historyHydrationOptions),
  });
  backfillLatchRef.current = latchHistoricalTradeBackfill(
    backfillLatchRef.current,
    tradeMint ?? null,
    shouldUseHistoricalTradeBackfill(snapshot, historyHydrationOptions),
  );
  const usesHistoricalBackfill = backfillLatchRef.current.latched;
  // Key ONLY on stable fields: mint + the one-way backfill status (null → pending →
  // complete). The previous key folded in `stateKind` (oscillates REST↔SSE) and
  // `backfillStatus.tradesDecoded` (a counter that ticks on EVERY decoded trade) — either
  // churned the query key, aborting the in-flight 7-day fetch and (without
  // `keepPreviousData`) blanking the table to the snapshot tail on every live trade.
  const historyRefreshKey = snapshot
    ? `${snapshot.mint}:${backfillStatus?.status ?? ''}`
    : null;
  const historyTrades = useHistoryTrades(tradeMint, historyRefreshKey, undefined, {
    enabled: usesHistoricalBackfill,
  });
  // Hidden persistent pane → dormant: pause these polls exactly like the
  // snapshot poll above; cached rows still render instantly on reveal.
  const streamHolderVersion = selectedTokenStream.holderVersion;
  const topHolders = useTopHolders(tradeMint, 1, !paneHidden, streamHolderVersion);
  const pagedHolders = useTopHolders(
    tradeMint,
    holderPageIndex + 1,
    // On page one this instance shares the always-on page-1 query above
    // (same key), which already owns freshness — leaving it active too made
    // every version bump cancel/refetch the same query twice. Inactive still
    // renders the shared cached rows (`enabled` stays true inside the hook).
    !paneHidden && tableTab === 'holders' && holderPageIndex > 0,
    streamHolderVersion,
  );
  // TRACKED filter source: page 1 rides the always-on query above; deeper
  // pages fan out inside the hook only while the tracked view is visible.
  // An empty tracked list disables the filter outright (never an empty
  // table because the user un-tracked their last wallet mid-view).
  const trackedFilterAvailable = trackedWallets.addressSet.size > 0;
  const trackedFilterOn = trackedOnly && trackedFilterAvailable;
  const trackedHolders = useTrackedHolders(
    tradeMint,
    !paneHidden && tableTab === 'holders' && trackedFilterOn && !listenViewOn,
    topHolders,
    trackedWallets.addressSet,
  );
  const topTraders = useTopTraders(
    tradeMint,
    topTraderPageIndex + 1,
    !paneHidden && tableTab === 'topTraders',
    streamHolderVersion,
  );
  const walletClasses = useWalletClasses(tradeMint, snapshot?.createdAtMs ?? null, !paneHidden);
  const selectedCandle =
    selectedCandleRaw && selectedCandleRaw.mint === tradeMint ? selectedCandleRaw : null;
  const candleTrades = useCandleTrades(
    tradeMint,
    selectedCandle,
    snapshot ? `${snapshot.tradeCount}:${snapshot.lastTradeAtMs ?? ''}` : null,
  );
  const snapshotTradeRows = useMemo<TokenTrade[]>(() => snapshotLiveTrades(snapshot), [snapshot]);
  const chartTradeRows = useMemo<TokenTrade[]>(
    () => mergeLiveTrades(snapshotTradeRows, selectedTokenStream.liveTrades),
    [selectedTokenStream.liveTrades, snapshotTradeRows],
  );
  // Token creator (dev): mint-gated snapshot only, so a fast token-to-token
  // nav can never attribute the previous coin's dev to the new mint. This is
  // what makes dev tracking AUTOMATIC per mint — the tape below already
  // carries every trade, and the snapshot names the creator.
  const creatorAddress =
    snapshot && typeof snapshot.creator === 'string' && snapshot.creator.length > 0
      ? snapshot.creator
      : null;
  // Dev Tokens tab: the creator's deploys from the ingestion catalog,
  // uncapped — paged at 100 per page like holders/top traders. Called
  // unconditionally (the observer keeps the tab badge's cached rows
  // mounted); only the poll/heal is gated on the tab being visible.
  const devTokens = useDevTokens(
    creatorAddress,
    devPageIndex,
    !paneHidden && tableTab === 'dev',
  );
  // Orders tab: ALL of the user's advanced (DCA/limit) orders, page-mint
  // rows sorted first. One mount fetch feeds the tab badge; the 5s poll
  // runs only while the tab is selected (same gating as holders/top
  // traders above); adv- SSE events force an immediate refetch inside
  // the hook.
  const advancedOrders = useAdvancedOrders(
    tradeMint ?? null,
    !paneHidden && tableTab === 'orders',
  );
  const { data: me } = useMe();
  const myWalletKey = useMemo(
    () =>
      me && !me.reauth_required
        ? me.wallets.map((wallet) => wallet.wallet_pubkey).join(',')
        : '',
    [me],
  );
  // COMPLETE per-wallet history on this mint for every bubble identity
  // (dev + the viewer's wallets + bubble-enabled tracked wallets) from the
  // trader-ordered mirror. This is the consistency anchor: the trades-table
  // page and the hot tape are bounded slices that differ by coin type
  // (new pair vs ripening vs graduated), so bubbles seeded from them missed
  // older trades — most visibly the dev's initial buy. The live tape is
  // unioned on top of this for sub-second freshness.
  // Classified wallets (snipers first — they are fewer and higher signal —
  // then bundlers) fill the remaining bubble budget below. Their raw source
  // (`useWalletClasses`) polls every 2.5s on young coins, and every newly
  // classified wallet used to re-key `useMintWalletTrades` — a full
  // multi-chunk wallet-trades refetch every ~2.5s during a launch's hottest
  // window. The classified contribution therefore commits through a
  // leading-edge throttle: first classification lands immediately, further
  // enrichment batches at most once per commit window. Dev/self/tracked
  // wallets stay un-throttled (rare, high-priority changes).
  const classifiedWalletsKey = useMemo(() => {
    const wallets: string[] = [];
    for (const [wallet, cls] of Object.entries(walletClasses)) {
      if (cls === 'sniper') wallets.push(wallet);
    }
    for (const [wallet, cls] of Object.entries(walletClasses)) {
      if (cls === 'bundler') wallets.push(wallet);
    }
    return wallets.join(',');
  }, [walletClasses]);
  const [committedClassifiedKey, setCommittedClassifiedKey] = useState('');
  const latestClassifiedKeyRef = useRef(classifiedWalletsKey);
  latestClassifiedKeyRef.current = classifiedWalletsKey;
  const classifiedCommitRef = useRef<{
    mint: string | null;
    committed: string;
    lastAtMs: number;
    timer: number | null;
  }>({ mint: null, committed: '', lastAtMs: 0, timer: null });
  useEffect(() => {
    const state = classifiedCommitRef.current;
    const mintKey = tradeMint ?? null;
    if (state.mint !== mintKey) {
      // Mint switch: drop any pending commit and seed the new mint's
      // classified set immediately (leading edge).
      state.mint = mintKey;
      if (state.timer != null) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
      state.committed = latestClassifiedKeyRef.current;
      state.lastAtMs = state.committed.length > 0 ? Date.now() : 0;
      setCommittedClassifiedKey(state.committed);
      return;
    }
    if (state.timer != null) return; // pending commit reads the latest ref
    if (latestClassifiedKeyRef.current === state.committed) return;
    const waitMs = Math.max(
      0,
      state.lastAtMs + BUBBLE_CLASSIFIED_COMMIT_MIN_MS - Date.now(),
    );
    state.timer = window.setTimeout(() => {
      state.timer = null;
      state.committed = latestClassifiedKeyRef.current;
      state.lastAtMs = Date.now();
      setCommittedClassifiedKey(state.committed);
    }, waitMs);
  }, [classifiedWalletsKey, tradeMint]);
  useEffect(() => () => {
    const state = classifiedCommitRef.current;
    if (state.timer != null) window.clearTimeout(state.timer);
  }, []);
  const bubbleHistoryWalletsKey = useMemo(() => {
    // Priority order under the cap: the dev and the viewer's own wallets
    // must NEVER be displaced by a large tracked set — cap first in
    // priority order, THEN sort for a stable query key.
    const wallets = new Set<string>();
    if (creatorAddress) wallets.add(creatorAddress);
    if (myWalletKey.length > 0) {
      for (const wallet of myWalletKey.split(',')) wallets.add(wallet);
    }
    for (const wallet of trackedWallets.bubbleAddressSet) {
      if (wallets.size >= MINT_WALLET_TRADES_MAX_WALLETS) break;
      wallets.add(wallet);
    }
    if (committedClassifiedKey.length > 0) {
      for (const wallet of committedClassifiedKey.split(',')) {
        if (wallets.size >= MINT_WALLET_TRADES_MAX_WALLETS) break;
        wallets.add(wallet);
      }
    }
    return [...wallets].slice(0, MINT_WALLET_TRADES_MAX_WALLETS).sort().join(',');
  }, [committedClassifiedKey, creatorAddress, myWalletKey, trackedWallets.bubbleAddressSet]);
  const walletHistoryEvents = useMintWalletTrades(tradeMint ?? null, bubbleHistoryWalletsKey, !paneHidden);
  const myWalletSet = useMemo(
    () => new Set(myWalletKey.length > 0 ? myWalletKey.split(',') : []),
    [myWalletKey],
  );
  // The tape slice the dev/self/sniper/bundler bubble memos below actually
  // read: one cheap O(rows) relevance filter per flush, identity-stabilized.
  // Without this every memo body rebuilt its Map over history ∪ tape on
  // EVERY live flush (the tape array's identity churns per frame) even when
  // no bubble-relevant wallet traded — pure wasted work on busy mints.
  const bubbleTapeRows = useStableKeyedArray(useMemo<TokenTrade[]>(() => {
    if (!tradeMint) return EMPTY_TOKEN_TRADES;
    return chartTradeRows.filter(
      (trade) =>
        trade.user === creatorAddress
        || myWalletSet.has(trade.user)
        || walletClasses[trade.user] === 'sniper'
        || walletClasses[trade.user] === 'bundler',
    );
  }, [chartTradeRows, creatorAddress, myWalletSet, tradeMint, walletClasses]), tapeTradeKey);
  // Dev buy/sell chart bubbles: the creator's complete history on this mint
  // plus the live tape on top — no wallet tracking involved.
  // `useStableEventArray` (here and on every bubble stream below) keeps the
  // PREVIOUS array while the (signature:wallet) key-set is unchanged, so
  // the per-trade tape identity churn doesn't rebuild the chart's marker
  // model when no bubble-relevant trade actually arrived.
  const devChartEvents = useStableEventArray(useMemo<WalletActivityEvent[]>(() => {
    if (!tradeMint || !creatorAddress) return [];
    const bySignature = new Map<string, WalletActivityEvent>();
    for (const event of walletHistoryEvents) {
      if (event.wallet === creatorAddress) bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const trade of bubbleTapeRows) {
      if (trade.user !== creatorAddress) continue;
      bySignature.set(`${trade.signature}:${trade.user}`, tradeToWalletEvent(trade, tradeMint));
    }
    return Array.from(bySignature.values());
  }, [bubbleTapeRows, creatorAddress, tradeMint, walletHistoryEvents]));
  // The signed-in user's OWN trades on this mint (all their wallets),
  // rendered as accent-ringed B/S chart bubbles. Same derivation as the
  // dev bubbles above.
  const selfChartEvents = useStableEventArray(useMemo<WalletActivityEvent[]>(() => {
    if (!tradeMint || myWalletKey.length === 0) return [];
    const mine = new Set(myWalletKey.split(','));
    const bySignature = new Map<string, WalletActivityEvent>();
    for (const event of walletHistoryEvents) {
      if (mine.has(event.wallet)) bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const trade of bubbleTapeRows) {
      if (!mine.has(trade.user)) continue;
      bySignature.set(`${trade.signature}:${trade.user}`, tradeToWalletEvent(trade, tradeMint));
    }
    return Array.from(bySignature.values());
  }, [bubbleTapeRows, myWalletKey, tradeMint, walletHistoryEvents]));

  // Sniper/bundler buy/sell chart bubbles: classified wallets' complete
  // history on this mint plus the live tape on top — same derivation as
  // the dev/self bubbles above. Dev/self/tracked classes win visual
  // priority downstream, so a dev who also sniped stays a dev bubble.
  const sniperChartEvents = useStableEventArray(useMemo<WalletActivityEvent[]>(() => {
    if (!tradeMint) return [];
    const bySignature = new Map<string, WalletActivityEvent>();
    for (const event of walletHistoryEvents) {
      if (walletClasses[event.wallet] === 'sniper') bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const trade of bubbleTapeRows) {
      if (walletClasses[trade.user] !== 'sniper') continue;
      bySignature.set(`${trade.signature}:${trade.user}`, tradeToWalletEvent(trade, tradeMint));
    }
    return Array.from(bySignature.values());
  }, [bubbleTapeRows, tradeMint, walletClasses, walletHistoryEvents]));
  const bundlerChartEvents = useStableEventArray(useMemo<WalletActivityEvent[]>(() => {
    if (!tradeMint) return [];
    const bySignature = new Map<string, WalletActivityEvent>();
    for (const event of walletHistoryEvents) {
      if (walletClasses[event.wallet] === 'bundler') bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const trade of bubbleTapeRows) {
      if (walletClasses[trade.user] !== 'bundler') continue;
      bySignature.set(`${trade.signature}:${trade.user}`, tradeToWalletEvent(trade, tradeMint));
    }
    return Array.from(bySignature.values());
  }, [bubbleTapeRows, tradeMint, walletClasses, walletHistoryEvents]));

  // Carry the last good SOL price across snapshot frames. A frame with a
  // missing/zero `solUsd` (REST poll racing an ingestion restart, transient
  // Pyth gap) would otherwise reprice every USD conversion — including the
  // whole candle series — to zero for that frame. SOL price is global, so
  // carrying it across mints is sound. Declared BEFORE the chart scale and
  // avg entry/exit math so every consumer sees the guarded price.
  const lastGoodSolUsdRef = useRef<number | null>(null);
  if (snapshot && Number.isFinite(snapshot.solUsd) && snapshot.solUsd > 0) {
    lastGoodSolUsdRef.current = snapshot.solUsd;
  }
  const effectiveSolUsd =
    snapshot && Number.isFinite(snapshot.solUsd) && snapshot.solUsd > 0
      ? snapshot.solUsd
      : lastGoodSolUsdRef.current;
  const chartSnapshot = useMemo(() => {
    if (!snapshot) return snapshot;
    if (effectiveSolUsd == null || snapshot.solUsd === effectiveSolUsd) return snapshot;
    return { ...snapshot, solUsd: effectiveSolUsd };
  }, [effectiveSolUsd, snapshot]);
  // Single latched SOL/USD rate for the trade tape (#14). The tape's row cache
  // now serves on EXACT rate match, so every row must be adapted at ONE shared
  // rate that advances only on a >=0.1% cumulative move — Pyth wobble never
  // trips it, and a real move rebuilds all rows once. Latch effectiveSolUsd
  // (the last-good price), never raw snapshot.solUsd which can be 0 on a bad
  // frame; per-row latches let equivalent rows disagree by ~0.2%.
  const tapeSolUsdRef = useRef<number | null>(null);
  if (
    effectiveSolUsd != null && effectiveSolUsd > 0
    && (tapeSolUsdRef.current == null || Math.abs(effectiveSolUsd / tapeSolUsdRef.current - 1) >= 0.001)
  ) {
    tapeSolUsdRef.current = effectiveSolUsd;
  }
  const tapeSolUsd = tapeSolUsdRef.current;

  // ── Chart display prefs (toolbar toggles) ──────────────────────────
  const chartUnit = useChartPrefsStore((s) => s.unit);
  const chartMode = useChartPrefsStore((s) => s.mode);
  const hideAllBubbles = useChartPrefsStore((s) => s.hideBubbles);
  // USD-market-cap → displayed-scale multiplier. SOL divides by the SOL
  // price; Price divides by the token supply (base units are 6dp). A
  // missing factor degrades to 1 (USD/MarketCap) rather than blanking.
  const rawChartValueScale = useMemo(() => {
    const unitFactor =
      chartUnit === 'SOL' && effectiveSolUsd != null && effectiveSolUsd > 0
        ? 1 / effectiveSolUsd
        : 1;
    const supplyTokens = Number(snapshot?.totalSupplyBaseUnits ?? '0') / 1e6;
    const modeFactor =
      chartMode === 'Price' && Number.isFinite(supplyTokens) && supplyTokens > 0
        ? 1 / supplyTokens
        : 1;
    return unitFactor * modeFactor;
  }, [chartMode, chartUnit, effectiveSolUsd, snapshot]);
  // Latch the scale against sub-0.1% moves. Every distinct scale value
  // forces the chart to rescale the WHOLE series (full setData of up to
  // ~5k bars) instead of the O(1) last-bar fast path, and in SOL display
  // 1/solUsd wobbles on every Pyth tick (1–2×/s). Unit/mode toggles and
  // real SOL moves blow past the tolerance and reprice immediately.
  // Key the latch by mint + unit + mode (#13): PersistentTradePane renders
  // <TradePage> WITHOUT a key, so refs survive mint swaps. An unkeyed latch let
  // a prior mint's supply scale (or prior unit/mode) — when within 0.1% of the
  // new one — persist and alter the new series' first candle. A mint/unit/mode
  // switch already triggers a full rescale/setData, so resetting here is free.
  const chartScaleKey = `${tradeMint ?? ''}:${chartUnit}:${chartMode}`;
  const latchedChartScaleRef = useRef<{ key: string; value: number | null }>({ key: chartScaleKey, value: null });
  if (latchedChartScaleRef.current.key !== chartScaleKey) {
    latchedChartScaleRef.current = { key: chartScaleKey, value: null };
  }
  const latchedChartScale = latchedChartScaleRef.current.value;
  const chartValueScale =
    latchedChartScale != null
    && Math.abs(rawChartValueScale / latchedChartScale - 1) < 0.001
      ? latchedChartScale
      : rawChartValueScale;
  latchedChartScaleRef.current.value = chartValueScale;

  // Average entry/exit levels (USD-MC scale) from the viewer's complete
  // trade record on this mint — the chart's slim dotted lines.
  const { avgEntryUsdMc, avgExitUsdMc } = useMemo(() => {
    const none = { avgEntryUsdMc: null, avgExitUsdMc: null };
    if (selfChartEvents.length === 0 || !snapshot) return none;
    const solUsd = effectiveSolUsd ?? snapshot.solUsd;
    const supplyBase = Number(snapshot.totalSupplyBaseUnits);
    if (
      !Number.isFinite(solUsd) || solUsd <= 0
      || !Number.isFinite(supplyBase) || supplyBase <= 0
    ) {
      return none;
    }
    let buySol = 0;
    let buyTok = 0;
    let sellSol = 0;
    let sellTok = 0;
    for (const event of selfChartEvents) {
      const sol = Number(event.solLamports);
      const tok = Number(event.tokens);
      if (!Number.isFinite(sol) || !Number.isFinite(tok) || tok <= 0 || sol <= 0) continue;
      if (event.isBuy) {
        buySol += sol;
        buyTok += tok;
      } else {
        sellSol += sol;
        sellTok += tok;
      }
    }
    // ratio = lamports per base unit → same scaling the candles use.
    const toUsdMc = (ratio: number) => (ratio * supplyBase * solUsd) / 1e9;
    return {
      avgEntryUsdMc: buyTok > 0 ? toUsdMc(buySol / buyTok) : null,
      avgExitUsdMc: sellTok > 0 ? toUsdMc(sellSol / sellTok) : null,
    };
  }, [effectiveSolUsd, selfChartEvents, snapshot]);

  // Chart alerts: armed here (right-click menu) into the GLOBAL store
  // with the coin's identity attached, so they keep watching after the
  // user navigates away (ChartAlertsWatcher covers off-page mints and
  // owns the rich clickable toast). The current coin's live 1s snapshot
  // is the fast trigger path.
  const armChartAlert = useChartAlertsStore((s) => s.arm);
  const disarmChartAlerts = useChartAlertsStore((s) => s.disarm);
  const allChartAlerts = useChartAlertsStore((s) => s.alerts);
  const chartAlerts = useMemo(
    () => allChartAlerts.filter((alert) => alert.mint === tradeMint),
    [allChartAlerts, tradeMint],
  );
  const chartAlertTicker = snapshot?.symbol?.trim()
    ? `$${snapshot.symbol.trim().replace(/^\$/, '')}`
    : tradeMint
      ? `${tradeMint.slice(0, 4)}…`
      : '—';
  const onSetChartAlert = useCallback(
    (usdMc: number, direction: 'above' | 'below') => {
      if (!tradeMint) return;
      armChartAlert({
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mint: tradeMint,
        ticker: chartAlertTicker,
        imageUrl: ingestionTokenImageUrl(tradeMint),
        usdMc,
        direction,
      });
      // Past the watcher's connection cap, older-armed coins silently fall
      // back to a mount-time seed check only — there is no armed-alerts
      // panel, so the arm toast is where the overflow gets surfaced.
      const armedMintCount = new Set(
        useChartAlertsStore.getState().alerts.map((alert) => alert.mint),
      ).size;
      toast('Alert armed', {
        description:
          armedMintCount > MAX_ALERT_STREAMS
            ? `${chartAlertTicker} — armed, but ${armedMintCount} coins have alerts; only the ${MAX_ALERT_STREAMS} most recently armed are watched live.`
            : `${chartAlertTicker} — fires when market cap crosses ${direction} ${compactUsd(usdMc, '$0')}`,
      });
    },
    [armChartAlert, chartAlertTicker, tradeMint],
  );
  const liveMcUsd = snapshot?.marketCapUsd ?? null;
  useEffect(() => {
    if (
      !tradeMint
      || liveMcUsd == null
      || !Number.isFinite(liveMcUsd)
      || chartAlerts.length === 0
    ) {
      return;
    }
    fireCrossedChartAlerts(tradeMint, liveMcUsd, chartAlerts, disarmChartAlerts);
  }, [chartAlerts, disarmChartAlerts, liveMcUsd, tradeMint]);


  const adapted = useMemo(() => {
    if (!RUST_API_ENABLED || !chartSnapshot) {
      return {
        token: loadingToken,
        vol: EMPTY_VOL,
        ohlc: EMPTY_OHLC,
        trades: EMPTY_TRADES,
        pnl: EMPTY_PNL,
        candles: undefined,
        isStub: false,
      };
    }
    // Thread the tape's latched rate so adaptTrades stamps the shared row
    // cache at the SAME solUsd the displayedTrades memo reads it with —
    // adapting here at the raw per-frame rate thrashed the exact-match cache
    // into a full-tape rebuild every snapshot frame (finding #14).
    const next = adaptSnapshot(chartSnapshot, Date.now(), candlePlan.resolution, tapeSolUsd ?? undefined);
    return {
      ...next,
      token: applyTokenHint(next.token, liveTokenHint),
    };
  }, [chartSnapshot, liveTokenHint, loadingToken, candlePlan.resolution, tapeSolUsd]);
  // Quickbuy/prewarm wire: keep the focused mint hot on the backend service
  // for as long as the trade page is mounted — shaves ~150ms BC +
  // ~150ms cashback off the very first buy after page load, not just
  // buys 2+. Reads the JWT synchronously from the Clerk session
  // mirror instead of awaiting getToken() on every tick.
  //
  // Declared after `adapted` so it can flag graduated tokens: a
  // graduated token's trade page must warm the AMM path, not the
  // bonding curve.
  const tradeMintGraduated = adapted.token.graduated === true;

  // Pre-bond: the pending migration level (USD-MC) for the chart's dotted
  // line. The pump curve completes at a FIXED market cap in SOL terms,
  // derived from the canonical curve seeds — 30 virtual SOL × 1.073B
  // virtual tokens (constant product), 793.1M tokens for sale, so the
  // final spot price × 1B supply ≈ 410.88 SOL — which is why the USD
  // level moves as the live SOL price moves. Quantized to $100 so
  // per-tick SOL drift doesn't churn the chart's price-line rebuild.
  // Null once graduated: the dotted line disappears and the M bubble
  // takes over. Mayhem coins never migrate via the classic curve (their
  // curve PDA is a complete=1 tombstone; they trade pool-style from
  // birth), so the classic threshold would be a lie — no line for them.
  const migrationUsdMc = useMemo(() => {
    if (tradeMintGraduated || adapted.token.isMayhem) return null;
    if (effectiveSolUsd == null || !Number.isFinite(effectiveSolUsd) || effectiveSolUsd <= 0) {
      return null;
    }
    const MIGRATION_MC_SOL = ((30 * 1_073_000_000) / 279_900_000 / 279_900_000) * 1_000_000_000;
    return Math.round((MIGRATION_MC_SOL * effectiveSolUsd) / 100) * 100;
  }, [adapted.token.isMayhem, effectiveSolUsd, tradeMintGraduated]);
  useEffect(() => {
    if (!tradeMint) return;
    // Hidden persistent pane: stop the server-side quote polling exactly as
    // leaving the page used to (TTL stops it within ~1.5s); reveal re-runs
    // this effect and re-warms immediately.
    if (paneHidden) return;
    const fire = (immediate = false): void => {
      // A hidden tab shouldn't keep the server polling this mint; the
      // visibilitychange handler below re-warms the instant we're back.
      if (typeof document !== 'undefined' && document.hidden) return;
      const session = getClerkSession();
      if (session.isSignedIn !== true) return;
      prewarmMints([tradeMint], session.token, {
        graduatedMints: tradeMintGraduated ? [tradeMint] : [],
        ...(immediate ? { immediate: true } : {}),
      });
    };
    // Initial warm (mount and paneHidden→visible re-run) skips the
    // 250ms coalesce: the server cache is cold after any gap, and a
    // click can land well inside that window.
    fire(true);
    // Heartbeat: server-side ActiveQuoteCache TTL is 1500ms, so we
    // re-touch every 3000ms to keep the focused trade mint actively
    // polled (server TTL 5s — 2s margin for a dropped beat). When the
    // user leaves the trade page this interval is torn down and the
    // server stops polling within ~5s. Quote freshness is unaffected:
    // the server's 33ms refresh cadence while warm is a separate knob.
    const timer = window.setInterval(() => fire(), 3_000);
    const onVisibilityChange = (): void => {
      if (!document.hidden) fire(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tradeMint, tradeMintGraduated, paneHidden]);
  const candleHistory = useCandleHistory({
    mint: tradeMint,
    timeframe: candlePlan.resolution,
    seed: adapted.candles ?? [],
    liveCandles: selectedTokenStream.liveCandles,
    hydrateLatest: shouldHydrateLatestCandleHistory(snapshot, historyHydrationOptions),
    solUsd: effectiveSolUsd,
    totalSupplyBaseUnits: snapshot?.totalSupplyBaseUnits ?? null,
    // Stream resyncs (reconnect after an outage) are explicit recovery
    // moments: the settled append-only base rebuilds so gap-repaired
    // middle windows can render (insertions are otherwise ignored).
    rebuildSignal: selectedTokenStream.resyncCount,
    // Truly-cold token (genesis backfill ran for this open) — segments the
    // chart-load beacon's physics-bound population from the main one.
    coldBackfill: backfillStatus != null,
  });

  // Display candles: native timeframes pass through (same identity, the
  // chart keeps its O(1) update fast path); aggregated timeframes fold
  // the fetched base series into display buckets — incrementally: the base
  // identity churns per live candle event, so a full re-fold here was the
  // one O(all candles)-per-tick recompute left on busy mints.
  const candleAggregatorRef = useRef<ReturnType<typeof createCandleAggregator> | null>(null);
  if (candleAggregatorRef.current === null) {
    candleAggregatorRef.current = createCandleAggregator();
  }
  const displayCandles = useMemo(
    () => candleAggregatorRef.current!(candleHistory.candles, timeframe),
    [candleHistory.candles, timeframe],
  );
  // Chart rebuild signal: stream resyncs AND settled-rate epoch advances
  // (#12). A rate advance re-adapts settled bars with unchanged shape, which
  // PriceChart's shape-only fast paths (scaledCandles prefix reuse, the
  // series update fence) would otherwise swallow — leaving every bar but the
  // tip painted at the old rate. The multiplier keeps the counters
  // collision-free (a simultaneous resync + rate bump can never cancel out).
  const chartRebuildEpoch =
    selectedTokenStream.resyncCount * 1_000_000 + candleHistory.rateEpoch;
  // The O/H/L/C strip must describe the candle actually plotted: on
  // aggregated timeframes the native-resolution ohlc would show a
  // different (smaller) candle than the visible tip bar.
  const displayOhlc = useMemo(() => {
    if (candlePlan.group === 1) return adapted.ohlc;
    const last = displayCandles[displayCandles.length - 1];
    if (!last) return adapted.ohlc;
    const change = last.close - last.open;
    return {
      o: last.open,
      h: last.high,
      l: last.low,
      c: last.close,
      change,
      changePct: last.open > 0 ? (change / last.open) * 100 : 0,
    };
  }, [adapted.ohlc, candlePlan.group, displayCandles]);
  const displayedTrades = useMemo(() => {
    if (!snapshot) return adapted.trades;
    if (!selectedCandle) {
      // Hydration is strictly ADDITIVE: only replace the snapshot/hot tail once
      // the cold history actually has rows. A force-hydrated coin whose cold
      // history is still loading OR genuinely empty (a fresh coin reached without
      // a New-Pairs context) keeps showing its live hot tail instead of flashing
      // an empty table — so we never regress below the pre-hydration behavior.
      const historyRows =
        usesHistoricalBackfill && historyTrades.trades.length > 0
          ? historyTrades.trades
          : snapshotTradeRows;
      // Live overlay merges into the NEWEST page only: history pages are
      // newest-first offset windows, so folding live rows into page 2+ both
      // repeats page-1 rows and grows the page past its size, displacing the
      // historical rows the user paged to see.
      const onNewestPage = !usesHistoricalBackfill || historyTrades.pageIndex === 0;
      const defaultRows = onNewestPage
        ? mergeLiveTrades(historyRows, selectedTokenStream.liveTrades)
        : historyRows;
      return historyRows
        ? adaptTokenTrades(
            defaultRows,
            {
              totalSupplyBaseUnits: snapshot.totalSupplyBaseUnits,
              solUsd: tapeSolUsd ?? snapshot.solUsd,
            },
            Date.now(),
          )
        : adapted.trades;
    }
    return adaptTokenTrades(
      candleTrades.trades,
      {
        totalSupplyBaseUnits: snapshot.totalSupplyBaseUnits,
        solUsd: tapeSolUsd ?? snapshot.solUsd,
      },
      Date.now(),
    );
  }, [
    adapted.trades,
    candleTrades.trades,
    historyTrades.trades,
    historyTrades.pageIndex,
    selectedCandle,
    selectedTokenStream.liveTrades,
    snapshot,
    snapshotTradeRows,
    tapeSolUsd,
    usesHistoricalBackfill,
  ]);
  const tradePagination = useMemo(() => {
    if (selectedCandle || !snapshot || !usesHistoricalBackfill) return null;
    return {
      pageIndex: historyTrades.pageIndex,
      pageSize: historyTrades.pageSize,
      total: historyTrades.total,
      loading: historyTrades.loading,
      error: historyTrades.error,
      hasNext: historyTrades.hasNext,
      hasPrev: historyTrades.hasPrev,
      onNext: historyTrades.nextPage,
      onPrev: historyTrades.prevPage,
    };
  }, [
    historyTrades.error,
    historyTrades.hasNext,
    historyTrades.hasPrev,
    historyTrades.loading,
    historyTrades.nextPage,
    historyTrades.pageIndex,
    historyTrades.pageSize,
    historyTrades.prevPage,
    historyTrades.total,
    selectedCandle,
    snapshot,
    usesHistoricalBackfill,
  ]);
  const nextHolderPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: (state.mint === tradeMint ? state.holderPageIndex : 0) + 1,
      topTraderPageIndex: state.mint === tradeMint ? state.topTraderPageIndex : 0,
      devPageIndex: state.mint === tradeMint ? state.devPageIndex : 0,
    }));
  }, [tradeMint]);
  const prevHolderPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: Math.max(0, (state.mint === tradeMint ? state.holderPageIndex : 0) - 1),
      topTraderPageIndex: state.mint === tradeMint ? state.topTraderPageIndex : 0,
      devPageIndex: state.mint === tradeMint ? state.devPageIndex : 0,
    }));
  }, [tradeMint]);
  const nextTopTraderPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: state.mint === tradeMint ? state.holderPageIndex : 0,
      topTraderPageIndex: (state.mint === tradeMint ? state.topTraderPageIndex : 0) + 1,
      devPageIndex: state.mint === tradeMint ? state.devPageIndex : 0,
    }));
  }, [tradeMint]);
  const prevTopTraderPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: state.mint === tradeMint ? state.holderPageIndex : 0,
      topTraderPageIndex: Math.max(
        0,
        (state.mint === tradeMint ? state.topTraderPageIndex : 0) - 1,
      ),
      devPageIndex: state.mint === tradeMint ? state.devPageIndex : 0,
    }));
  }, [tradeMint]);
  const nextDevPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: state.mint === tradeMint ? state.holderPageIndex : 0,
      topTraderPageIndex: state.mint === tradeMint ? state.topTraderPageIndex : 0,
      devPageIndex: (state.mint === tradeMint ? state.devPageIndex : 0) + 1,
    }));
  }, [tradeMint]);
  const prevDevPage = useCallback(() => {
    setTablePagination((state) => ({
      mint: tradeMint,
      holderPageIndex: state.mint === tradeMint ? state.holderPageIndex : 0,
      topTraderPageIndex: state.mint === tradeMint ? state.topTraderPageIndex : 0,
      devPageIndex: Math.max(0, (state.mint === tradeMint ? state.devPageIndex : 0) - 1),
    }));
  }, [tradeMint]);
  const holderPagination = useMemo(() => {
    const totalPages = pagedHolders.totalPages;
    return {
      pageIndex: holderPageIndex,
      pageSize: pagedHolders.pageSize,
      total: pagedHolders.total,
      loading: pagedHolders.loading,
      error: pagedHolders.error,
      hasNext:
        totalPages == null
          ? pagedHolders.holders.length >= pagedHolders.pageSize
          : holderPageIndex + 1 < totalPages,
      hasPrev: holderPageIndex > 0,
      onNext: nextHolderPage,
      onPrev: prevHolderPage,
    };
  }, [
    holderPageIndex,
    nextHolderPage,
    pagedHolders.error,
    pagedHolders.holders.length,
    pagedHolders.loading,
    pagedHolders.pageSize,
    pagedHolders.total,
    pagedHolders.totalPages,
    prevHolderPage,
  ]);
  const topTraderPagination = useMemo(() => {
    const totalPages = topTraders.totalPages;
    return {
      pageIndex: topTraderPageIndex,
      pageSize: topTraders.pageSize,
      total: topTraders.total,
      loading: topTraders.loading,
      error: topTraders.error,
      hasNext:
        totalPages == null
          ? topTraders.traders.length >= topTraders.pageSize
          : topTraderPageIndex + 1 < totalPages,
      hasPrev: topTraderPageIndex > 0,
      onNext: nextTopTraderPage,
      onPrev: prevTopTraderPage,
    };
  }, [
    nextTopTraderPage,
    prevTopTraderPage,
    topTraderPageIndex,
    topTraders.error,
    topTraders.loading,
    topTraders.pageSize,
    topTraders.total,
    topTraders.totalPages,
    topTraders.traders.length,
  ]);
  const devTokensPagination = useMemo(() => {
    const totalPages = devTokens.totalPages;
    // No pagination chrome for the common one-page dev.
    if (totalPages != null && totalPages <= 1 && devPageIndex === 0) return null;
    return {
      pageIndex: devPageIndex,
      pageSize: DEV_TOKENS_PAGE_SIZE,
      total: devTokens.total,
      loading: devTokens.loading,
      error: devTokens.error,
      hasNext:
        totalPages == null
          ? devTokens.tokens.length >= DEV_TOKENS_PAGE_SIZE
          : devPageIndex + 1 < totalPages,
      hasPrev: devPageIndex > 0,
      onNext: nextDevPage,
      onPrev: prevDevPage,
    };
  }, [
    devPageIndex,
    devTokens.error,
    devTokens.loading,
    devTokens.tokens.length,
    devTokens.total,
    devTokens.totalPages,
    nextDevPage,
    prevDevPage,
  ]);
  const tradeFilter = useMemo(() => {
    if (!selectedCandle) return null;
    return {
      timeframe: selectedCandle.timeframe,
      bucketStartSec: selectedCandle.bucketStartSec,
      count: candleTrades.trades.length,
      loading: candleTrades.loading,
      error: candleTrades.error,
      onClear: () => setSelectedCandleRaw(null),
    };
  }, [candleTrades.error, candleTrades.loading, candleTrades.trades.length, selectedCandle]);
  // Genuine cold first paint: no snapshot in cache/persistence/prewarm and still loading
  // (not an error) — or the cache only holds the PREVIOUS mint's snapshot (fast nav),
  // which must paint as loading, never as the old mint's data under the new URL.
  const chartLoading = !snapshot && (loading || snapshotIsStalePlaceholder);
  const emptyChartMessage =
    candleHistory.candles.length === 0 && !chartLoading && snapshot
      ? liveSnapshotComplete
        ? 'Waiting for live candles in this timeframe.'
        : 'No candles for this timeframe yet.'
      : null;
  const emptyTradesMessage = selectedCandle
    ? liveSnapshotComplete
      ? 'No live trades in this candle.'
      : 'No transactions decoded in this candle.'
    : snapshot
      ? liveSnapshotComplete
        ? 'Waiting for live trades.'
        : 'No trades loaded yet.'
      : null;

  // Coin calls for THIS mint from the viewer's alpha feed (same event-driven
  // cache the Discover lane uses — SSE-pushed calls appear on the chart the
  // moment they commit). Rendered by PriceChart as clickable thesis bubbles
  // anchored at (call time, MC at call).
  const alphaFeed = useAlphaFeed();
  // Wallets with bubbles toggled off also mute their owner's chart THESIS
  // bubbles — best-effort: a slugless caller's feed label IS the viewer's
  // tracked-wallet label (verbatim), so matching on it covers the common
  // case; slugged callers keep their slug and are unaffected.
  const thesisMutedLabels = useMemo(() => {
    const set = new Set<string>();
    for (const wallet of trackedWallets.wallets) {
      if (wallet.alertsOnBubble !== false) continue;
      const label = wallet.label?.trim();
      if (label) set.add(label);
    }
    return set;
  }, [trackedWallets.wallets]);
  const chartCoinCalls = useMemo<ChartCoinCall[]>(() => {
    if (!tradeMint) return EMPTY_CHART_COIN_CALLS;
    const result = alphaFeed.data;
    const calls = result && result.kind === 'ok' ? result.data : [];
    const out: ChartCoinCall[] = [];
    for (const call of calls) {
      if (call.mint !== tradeMint) continue;
      if (thesisMutedLabels.has(call.callerLabel)) continue;
      const createdAtMs = Date.parse(call.createdAt);
      if (!Number.isFinite(createdAtMs)) continue;
      out.push({
        id: call.id,
        callerLabel: call.callerLabel,
        thesis: call.thesis,
        createdAtMs,
        // Chart y anchor: exact numeric when the call carried it; old rows
        // degrade to parsing the compact display string.
        marketCapUsd: call.token.marketCapUsd ?? parseCompactUsd(call.token.marketCap),
        marketCapLabel: call.token.marketCap,
        editedAt: call.editedAt,
      });
    }
    return out.length > 0 ? out : EMPTY_CHART_COIN_CALLS;
  }, [alphaFeed.data, thesisMutedLabels, tradeMint]);
  const persistedWalletActivity = useTrackerWalletActivityForMint(
    tradeMint,
    trackedWallets.bubbleAddressSet,
  );
  const walletLabelByAddress = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const wallet of trackedWallets.wallets) {
      labels[wallet.address] = displayName(wallet);
    }
    return labels;
  }, [trackedWallets.wallets]);
  const walletEmojiByAddress = useMemo(() => {
    const emojis: Record<string, string> = {};
    for (const wallet of trackedWallets.wallets) {
      if (wallet.emoji) emojis[wallet.address] = wallet.emoji;
    }
    return emojis;
  }, [trackedWallets.wallets]);
  const trackedWalletLabelByAddress = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const wallet of trackedWallets.wallets) {
      labels[wallet.address] = displayNameWithEmoji(wallet);
    }
    return labels;
  }, [trackedWallets.wallets]);
  // Status badge text. Only one badge at a time; precedence:
  // not_found > other error > loading > stub.
  let statusBadge: string | null = null;
  const backfillBadge = usesHistoricalBackfill
    ? formatBackfillStatus(backfillStatus, historyTrades.loading, historyTrades.total)
    : null;
  if (RUST_API_ENABLED && effectiveMint) {
    if (error === 'backfilling' && !snapshot) {
      statusBadge = usesHistoricalBackfill
        ? (backfillBadge ?? 'backfilling unknown mint')
        : 'loading…';
    } else if (error === 'backfill_failed' && !snapshot) statusBadge = 'backfill failed';
    else if (error === 'not_found' && !snapshot) statusBadge = 'token not found';
    else if (error && !snapshot) statusBadge = 'connection issue';
    else if ((loading || snapshotIsStalePlaceholder) && !snapshot) statusBadge = 'loading…';
    else if (snapshot?.stateKind === 'stub') statusBadge = 'warming up';
    // No badge for metadataReady=false: ~20% of fresh coins fail their first
    // IPFS metadata fetch (propagation lag), so the "metadata pending" badge
    // was mostly noise that cluttered the header while the token itself is
    // fully tradable. The image/socials still hydrate in place when the
    // fetch lands; placeholder-name filtering is unaffected.
    else if (adapted.isStub) statusBadge = 'warming up';
  }
  const priceLamportsPerBaseUnit =
    snapshot && Number(snapshot.priceLamports_den) > 0
      ? Number(snapshot.priceLamports_num) / Number(snapshot.priceLamports_den)
      : (activeQuotePriceLamportsPerBaseUnit ?? 0);
  // Stable identity (inlines updateInstantTradeOpen): a per-render function
  // here would defeat PriceChart's React.memo on every root render.
  const toggleInstantTrade = useCallback(() => {
    if (instantTradeOpen) {
      setInstantTradeOpen(false);
      writeInstantTradeOpen(false);
      return;
    }
    setInstantTradeAnchor(chartSectionRef.current?.getBoundingClientRect() ?? null);
    setInstantTradeOpen(true);
    writeInstantTradeOpen(true);
  }, [instantTradeOpen, setInstantTradeOpen]);
  const handleTimeframeChange = useCallback(
    (next: ChartTimeframe) => {
      setTimeframe(next);
      setSelectedCandleRaw(null);
    },
    [setTimeframe],
  );
  const handleCandleClick = useCallback(
    (bucketStartSec: number) => {
      // Aggregated display timeframes (5s/4h/12h/1d) have no native
      // candle-trades bucket server-side — candle-click filtering is a
      // native-resolution feature; ignore clicks rather than fetch a
      // wrong (base-sized) span.
      if (candlePlan.group !== 1) return;
      setSelectedCandleRaw((current) =>
        current != null &&
        current.mint === tradeMint &&
        current.timeframe === timeframe &&
        current.bucketStartSec === bucketStartSec
          ? null
          : { mint: tradeMint, timeframe, bucketStartSec },
      );
    },
    [candlePlan.group, timeframe, tradeMint],
  );

  function updateInstantTradeOpen(open: boolean) {
    setInstantTradeOpen(open);
    writeInstantTradeOpen(open);
  }

  // Layout regions defined once, then arranged two ways:
  //   lg+   : viewport-locked. Left column = chart (top) + trades table
  //           (bottom) in a vertical PanelStack — the connected, drag-
  //           resizable pair. Right rail = trade panel (top) + analytics
  //           (bottom), FIXED — it does not move when the chart/table
  //           divider is dragged.
  //   < lg  : everything stacks full-width and the page scrolls; resize is
  //           a desktop-only affordance.
  const chartSection = (
    <section
      ref={chartSectionRef}
      className="panel flex min-h-[var(--chart-h-min)] min-w-0 flex-col overflow-hidden lg:h-full lg:min-h-0"
    >
      <ChartToolbar timeframe={timeframe} onTimeframeChange={handleTimeframeChange} />
      <TradeChartWithBubbles
        tradeMint={tradeMint}
        allAddressSet={trackedWallets.addressSet}
        bubbleAddressSet={trackedWallets.bubbleAddressSet}
        chartTradeRows={chartTradeRows}
        walletHistoryEvents={walletHistoryEvents}
        persistedWalletActivityEvents={persistedWalletActivity.events}
        hideAllBubbles={hideAllBubbles}
        token={adapted.token}
        ohlc={displayOhlc}
        candles={displayCandles}
        rebuildEpoch={chartRebuildEpoch}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        onInstantTradeClick={toggleInstantTrade}
        instantTradeOpen={instantTradeOpen}
        isStub={adapted.isStub}
        devActivityEvents={hideAllBubbles ? EMPTY_CHART_EVENTS : devChartEvents}
        selfActivityEvents={hideAllBubbles ? EMPTY_CHART_EVENTS : selfChartEvents}
        sniperActivityEvents={hideAllBubbles ? EMPTY_CHART_EVENTS : sniperChartEvents}
        bundlerActivityEvents={hideAllBubbles ? EMPTY_CHART_EVENTS : bundlerChartEvents}
        // Guarded SOL price: a transient zero/NaN Pyth gap must not blank
        // the bubble hover's USD figures (the rest of the page already
        // reads the guarded value).
        solUsd={effectiveSolUsd}
        totalSupplyBaseUnits={snapshot?.totalSupplyBaseUnits ?? null}
        graduatedAtMs={hideAllBubbles ? null : (snapshot?.graduatedAtMs ?? null)}
        coinCalls={hideAllBubbles ? EMPTY_CHART_COIN_CALLS : chartCoinCalls}
        valueScale={chartValueScale}
        displayUnit={chartUnit}
        displayMode={chartMode}
        avgEntryUsdMc={avgEntryUsdMc}
        avgExitUsdMc={avgExitUsdMc}
        migrationUsdMc={migrationUsdMc}
        alerts={chartAlerts}
        onSetAlert={onSetChartAlert}
        recentTrades={chartTradeRows}
        walletLabelByAddress={walletLabelByAddress}
        walletEmojiByAddress={walletEmojiByAddress}
        selectedCandle={selectedCandle}
        onCandleClick={handleCandleClick}
        onNeedOlderCandles={candleHistory.loadOlder}
        hasMoreOlderCandles={candleHistory.hasMoreOlder}
        loadingOlderCandles={candleHistory.loadingOlder}
        emptyMessage={emptyChartMessage}
        loading={chartLoading}
      />
    </section>
  );

  const tableSection = (
    <div className="flex min-h-[var(--table-min-h)] min-w-0 flex-col lg:h-full lg:min-h-0">
      <TradesTable
        mintKey={tradeMint ?? ''}
        trades={displayedTrades}
        filter={tradeFilter}
        pagination={tradePagination}
        onActiveTabChange={setTableTab}
        onListenViewChange={setListenViewOn}
        holders={pagedHolders.holders}
        holdersLoading={pagedHolders.loading}
        holdersError={pagedHolders.error}
        holderPagination={holderPagination}
        trackedOnly={trackedFilterOn}
        trackedFilterAvailable={trackedFilterAvailable}
        onToggleTrackedOnly={toggleTrackedOnly}
        trackedHolders={trackedHolders.holders}
        trackedHoldersLoading={trackedHolders.loading}
        trackedHoldersError={trackedHolders.error}
        topTraders={topTraders.traders}
        topTradersLoading={topTraders.loading}
        topTradersError={topTraders.error}
        topTraderPagination={topTraderPagination}
        trackedWalletLabels={trackedWalletLabelByAddress}
        walletClasses={walletClasses}
        creatorAddress={creatorAddress}
        devTokens={devTokens.tokens}
        devTokensStats={devTokens.stats}
        devTokensTotal={devTokens.total}
        devTokensPagination={devTokensPagination}
        // No creator on a LOADED snapshot = the catalog genuinely doesn't
        // know this coin's dev (pre-ingestion mint) — say so instead of
        // spinning forever on a query that can never run.
        devTokensLoading={creatorAddress !== null ? devTokens.loading : snapshot == null}
        devTokensError={
          creatorAddress === null && snapshot != null ? 'creator unknown' : devTokens.error
        }
        advancedOrders={advancedOrders}
        pageTokenSymbol={adapted.token.ticker}
        emptyMessage={emptyTradesMessage}
      />
    </div>
  );

  const tradePanelSection = (
    <TradePanel
      token={adapted.token}
      pnl={adapted.pnl}
      mint={tradeMint}
      priceLamportsPerBaseUnit={priceLamportsPerBaseUnit}
      stream={tradeStream}
      multiTokenBalance={multiTokenBalance}
    />
  );

  const analyticsSection = (
    <AnalyticsPanel
      token={adapted.token}
      holders={topHolders.holders}
      holdersLoading={topHolders.loading}
      holdersError={topHolders.error}
      trackedWalletLabels={trackedWalletLabelByAddress}
    />
  );

  const leftColumnPanels: StackPanel[] = [
    { id: 'chart', sizing: 'flex', weight: CHART_WEIGHT, content: chartSection },
    { id: 'table', sizing: 'flex', weight: TABLE_WEIGHT, content: tableSection },
  ];

  const header = (
    <>
      {statusBadge || (usesHistoricalBackfill && snapshot && backfillBadge) ? (
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge ? <StatusBadge label={statusBadge} /> : null}
          {usesHistoricalBackfill && snapshot && backfillBadge ? (
            <StatusBadge label={backfillBadge} />
          ) : null}
        </div>
      ) : null}
      <div className="shrink-0">
        <TokenHeaderBar token={adapted.token} vol={adapted.vol} callDisabled={adapted.isStub} />
      </div>
    </>
  );

  return (
    <>
      {/* Owns the tracked-wallet toast/feed SSE subscriptions + toast
          side effects so a trade event re-renders only that subtree,
          never the trade-page root (mirrors DiscoverWalletActivity). */}
      <TradeWalletActivity
        trackedWallets={trackedWallets}
        tradeMint={tradeMint}
        tokenTicker={adapted.token.ticker}
        tokenName={adapted.token.name}
        hasSnapshot={snapshot != null}
        tokenHintVersion={tokenHintVersion}
      />

      {isLgUp ? (
        <main
          className="mx-auto flex h-[var(--h-app-content)] w-full max-w-[min(2400px,100%)] flex-col gap-[var(--gap-page)] overflow-hidden px-[var(--section-pad-x)] py-[var(--section-pad-y)]"
          style={{
            // Docks snapped ON THE TRADE PAGE reserve their width here
            // (trade-context CSS vars, written directly by the dock drag
            // layer — resizes never re-render this page). Discover's own
            // snap state uses different vars and never squeezes this page.
            paddingLeft: 'calc(var(--section-pad-x) + var(--dock-left-w-trade, 0px))',
            paddingRight: 'calc(var(--section-pad-x) + var(--dock-right-w-trade, 0px))',
            transition: 'padding 200ms ease',
          }}
        >
          {header}
          {/* Content row: resizable left column (chart + table) + fixed
              right rail (trade panel + analytics). Dragging the chart/table
              divider never resizes the rail. */}
          <div className="flex min-h-0 flex-1 gap-[var(--gap-page)]">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PanelStack
                axis="vertical"
                panels={leftColumnPanels}
                sizes={layoutSizes}
                onSizesChange={setLayoutSizes}
                handleSize={12}
                className="min-h-0 flex-1"
              />
            </div>
            {/* Trade panel sizes to its content; Analytics takes all
                remaining rail height so the extra space on tall screens
                goes to the holder list instead of leaving a void under
                the trade form. `shrink` (NOT shrink-0, NOT max-h-full)
                is what bounds the panel on this viewport-locked layout:
                the Adv./Limit forms grow as previews fill in, and the
                overflowing wrapper must SHRINK to the rail height so its
                post-flex main size is DEFINITE — the aside's `h-full`
                then resolves against it and the tab body's internal
                scroll container (flex-1 min-h-0) absorbs the overflow.
                (A max-height clamp does NOT work here: the wrapper's
                height stays `auto`, percentage heights inside resolve
                to content size, and the aside's tail — the submit CTA —
                paints past the clamp, clipped and unreachable.)
                Market-tab behavior is unchanged: analytics is flex-1
                with basis 0, so it never forces the panel to shrink
                below its content size — shrinking only happens when the
                panel alone exceeds the rail. */}
            <RailColumn className="gap-[var(--gap-page)]">
              <div className="flex min-h-0 shrink overflow-hidden">{tradePanelSection}</div>
              <div className="flex min-h-0 flex-1">{analyticsSection}</div>
            </RailColumn>
          </div>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-[min(2400px,100%)] flex-col gap-[var(--gap-page)] px-[var(--section-pad-x)] py-[var(--section-pad-y)]">
          {header}
          {chartSection}
          {tradePanelSection}
          {tableSection}
          {analyticsSection}
        </main>
      )}
      {instantTradeOpen ? (
        <InstantTradeBox
          token={adapted.token}
          mint={tradeMint}
          priceLamportsPerBaseUnit={priceLamportsPerBaseUnit}
          initialAnchor={instantTradeAnchor}
          stream={tradeStream}
          walletBalance={walletBalance}
          multiTokenBalance={multiTokenBalance}
          onClose={() => updateInstantTradeOpen(false)}
        />
      ) : null}
    </>
  );
}

type PriceChartProps = ComponentProps<typeof PriceChart>;

interface TradeChartWithBubblesProps extends Omit<PriceChartProps, 'walletActivityEvents'> {
  tradeMint: string | undefined;
  /** Full tracked set — the shared stream's subscription key. */
  allAddressSet: ReadonlySet<string>;
  bubbleAddressSet: ReadonlySet<string>;
  chartTradeRows: TokenTrade[];
  walletHistoryEvents: WalletActivityEvent[];
  persistedWalletActivityEvents: WalletActivityEvent[];
  hideAllBubbles: boolean;
}

/**
 * Hosts the bubble-set wallet-activity subscription next to its only
 * consumer (PriceChart's `walletActivityEvents` prop), so a tracked-wallet
 * trade event re-renders this subtree — never the TradePage root. The
 * toast/feed subscriptions live in TradeWalletActivity for the same reason;
 * this one cannot join them there because it feeds a chart prop.
 */
function TradeChartWithBubbles({
  tradeMint,
  allAddressSet,
  bubbleAddressSet,
  chartTradeRows,
  walletHistoryEvents,
  persistedWalletActivityEvents,
  hideAllBubbles,
  ...chartProps
}: TradeChartWithBubblesProps) {
  // Subscribe the SUPERSET key (shares one EventSource with every other
  // consumer on the page); `only` narrows renders to bubble wallets.
  const { events: bubbleWalletActivityEvents } = useWalletActivity(allAddressSet, {
    only: bubbleAddressSet,
  });
  // Stable identity while the mint-filtered content is unchanged, so a
  // bubble-set wallet event on ANOTHER mint doesn't re-render PriceChart
  // through the walletActivityEvents prop chain.
  const liveCurrentWalletEvents = useStableEventArray(useMemo(() => {
    if (!tradeMint) return [];
    return bubbleWalletActivityEvents.filter(
      (event) => event.mint === tradeMint && bubbleAddressSet.has(event.wallet),
    );
  }, [bubbleWalletActivityEvents, bubbleAddressSet, tradeMint]));
  // Tracked-wallet slice of the tape, identity-stabilized: the heavy
  // union+sort memo below re-ran on EVERY live flush (the tape's identity
  // churns per frame) even when no tracked wallet traded — now a per-flush
  // O(rows) filter proves that and the body is skipped.
  const trackedTapeRows = useStableKeyedArray(useMemo<TokenTrade[]>(() => {
    if (!tradeMint) return EMPTY_TOKEN_TRADES;
    return chartTradeRows.filter((trade) => bubbleAddressSet.has(trade.user));
  }, [bubbleAddressSet, chartTradeRows, tradeMint]), tapeTradeKey);
  const chartWalletEvents = useStableEventArray(useMemo(() => {
    if (!tradeMint) return [];
    const bySignature = new Map<string, WalletActivityEvent>();
    // Complete mirror history first, then the bounded/live sources on top —
    // same union order as the dev/self bubbles so every coin type renders
    // the same record.
    for (const event of walletHistoryEvents) {
      if (!bubbleAddressSet.has(event.wallet)) continue;
      bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const trade of trackedTapeRows) {
      if (!bubbleAddressSet.has(trade.user)) continue;
      bySignature.set(`${trade.signature}:${trade.user}`, tradeToWalletEvent(trade, tradeMint));
    }
    for (const event of liveCurrentWalletEvents) {
      if (!bubbleAddressSet.has(event.wallet)) continue;
      bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    for (const event of persistedWalletActivityEvents) {
      if (!bubbleAddressSet.has(event.wallet)) continue;
      bySignature.set(`${event.signature}:${event.wallet}`, event);
    }
    return Array.from(bySignature.values()).sort((a, b) => {
      const aTime = a.blockTimeMs ?? a.receivedAtMs;
      const bTime = b.blockTimeMs ?? b.receivedAtMs;
      return bTime - aTime;
    });
  }, [
    bubbleAddressSet,
    trackedTapeRows,
    liveCurrentWalletEvents,
    persistedWalletActivityEvents,
    tradeMint,
    walletHistoryEvents,
  ]));
  return (
    <PriceChart
      {...chartProps}
      walletActivityEvents={hideAllBubbles ? EMPTY_CHART_EVENTS : chartWalletEvents}
    />
  );
}

function readInstantTradeOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INSTANT_TRADE_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeInstantTradeOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSTANT_TRADE_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    // Non-persistent browser contexts still keep the React state.
  }
}

function formatBackfillStatus(
  status: BackfillStatus | null,
  historyLoading: boolean,
  historyTotal: number | null,
): string | null {
  if (!status || status.status === 'idle') return null;
  if (status.status === 'queued') return 'backfill queued';
  // The identity phase lasts well under a second; flashing "loading metadata"
  // for it just makes the header jitter. The transactions phase below is the
  // first state worth surfacing.
  if (status.status === 'metadata') return null;
  if (status.status === 'transactions') {
    const decoded = status.tradesDecoded > 0 ? `, ${status.tradesDecoded} txs decoded` : '';
    return `backfilling 7d txs${decoded}`;
  }
  if (status.status === 'failed')
    return status.lastError ? `backfill failed: ${status.lastError}` : 'backfill failed';
  if (historyLoading)
    return historyTotal == null ? 'loading 7d txs' : `loading 7d txs (${historyTotal})`;
  // Backfill done: drop the persistent "N txs loaded" badge — it lingers in
  // the header row and wastes vertical space in the locked viewport. The
  // transient loading/backfilling states above still show while in progress.
  return null;
}

function priceFromActiveQuote(quote: TradeSellQuoteInfo | null): number | null {
  if (!quote) return null;
  const numerator =
    quote.venue === 'bonding_curve' ? Number(quote.vsr) : Number(quote.poolQuoteReserves);
  const denominator =
    quote.venue === 'bonding_curve' ? Number(quote.vtr) : Number(quote.poolBaseReserves);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function snapshotLiveTrades(
  snapshot: { tradeHistory?: TokenTrade[]; recentTrades: TokenTrade[] } | null,
): TokenTrade[] {
  if (!snapshot) return [];
  return snapshot.tradeHistory && snapshot.tradeHistory.length > 0
    ? snapshot.tradeHistory
    : snapshot.recentTrades;
}

interface TradeTokenHint {
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  imageFallbackUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
  marketCap: string | null;
  txns: number | null;
  kinds: string[] | null;
  sourceSection: TokenNavigationSourceSection | null;
  /** Quote mint base58 (USDC pairs). Absent/null = SOL pair. Lets the
   *  spend-currency resolver pick USDC before the snapshot lands —
   *  without it a graduated USDC pair briefly resolved to the SOL
   *  fallback (wrong notice + wrong order sizing on a fast click). */
  quoteMint: string | null;
}

function tokenHintForMint(
  mint: string | undefined,
  livePairs: Array<{
    id?: string | null;
    name: string;
    ticker: string;
    /* Optional since the feed row's own fields became optional: a hint is a
       best-effort carry of what the list already knew, so an absent field
       simply carries nothing rather than blocking the hint. */
    imageUrl?: string;
    imageFallbackUrl?: string | null;
    links?: { twitter?: string | null; telegram?: string | null; website?: string | null };
    kinds?: string[] | null;
    realSolLamports?: string | null;
    graduated?: boolean;
    graduatedAtMs?: number | null;
    marketCap?: string;
    txns?: number;
    quoteMint?: string | null;
  }>,
): TradeTokenHint | null {
  if (!mint) return null;
  const live = livePairs.find((coin) => coin.id === mint);
  if (live) {
    return {
      name: live.name || null,
      symbol: live.ticker.replace(/^\$/, '') || null,
      imageUrl: live.imageUrl || null,
      imageFallbackUrl: live.imageFallbackUrl ?? null,
      twitterUrl: live.links?.twitter ?? null,
      telegramUrl: live.links?.telegram ?? null,
      websiteUrl: live.links?.website ?? null,
      marketCap: live.marketCap || null,
      txns: live.txns ?? null,
      kinds: live.kinds ?? null,
      // Current live reserve/graduation flags must beat a stale source hint:
      // a mint first clicked from New Pairs can later become Ripening/Graduated,
      // and it must then switch to the full-history path.
      sourceSection: live.graduated || live.graduatedAtMs != null
        ? 'graduated'
        : isRipeningLamports(live.realSolLamports)
          ? 'almost-graduated'
          : readTokenNavigationHint(mint)?.sourceSection ?? 'new-pairs',
      quoteMint: live.quoteMint ?? readTokenNavigationHint(mint)?.quoteMint ?? null,
    };
  }
  const hint = readTokenNavigationHint(mint);
  return hint
    ? {
        name: hint.name ?? null,
        symbol: hint.symbol ?? null,
        imageUrl: hint.imageUrl ?? null,
        imageFallbackUrl: hint.imageFallbackUrl ?? null,
        twitterUrl: hint.twitterUrl ?? null,
        telegramUrl: hint.telegramUrl ?? null,
        websiteUrl: hint.websiteUrl ?? null,
        marketCap: hint.marketCap ?? null,
        txns: hint.txns ?? null,
        kinds: hint.kinds ?? null,
        sourceSection: hint.sourceSection ?? null,
        quoteMint: hint.quoteMint ?? null,
      }
    : null;
}

function isRipeningLamports(realSolLamports: string | null | undefined): boolean {
  if (realSolLamports == null) return false;
  const value = Number(realSolLamports);
  return Number.isFinite(value) && value >= 70_000_000_000;
}

function applyTokenHint(token: MockToken, hint: TradeTokenHint | null): MockToken {
  if (!hint) return token;
  const symbolLooksMissing =
    token.symbol === 'Loading' || token.symbol === 'UNKNOWN' || token.symbol === token.mintAddress;
  const nameLooksMissing =
    token.name === 'Loading metadata' ||
    token.name === 'Metadata pending' ||
    token.name === 'Metadata unavailable' ||
    token.name === 'UNKNOWN' ||
    token.name === token.mintAddress;
  const imageLooksMissing = token.imageUrl.startsWith('data:image/svg+xml');
  return {
    ...token,
    symbol: symbolLooksMissing && hint.symbol ? hint.symbol : token.symbol,
    ticker: symbolLooksMissing && hint.symbol ? hint.symbol : token.ticker,
    name: nameLooksMissing && hint.name ? hint.name : token.name,
    imageUrl:
      imageLooksMissing && hint.imageUrl ? hint.imageUrl : token.imageUrl || hint.imageUrl || '',
    imageFallbackUrl: token.imageFallbackUrl ?? hint.imageFallbackUrl ?? hint.imageUrl ?? null,
    twitterUrl: token.twitterUrl ?? hint.twitterUrl,
    telegramUrl: token.telegramUrl ?? hint.telegramUrl,
    websiteUrl: token.websiteUrl ?? hint.websiteUrl,
    marketCap: token.marketCap === 'Loading' && hint.marketCap ? hint.marketCap : token.marketCap,
    txns: token.txns || hint.txns || 0,
    hasWebsite: token.hasWebsite || Boolean(hint.websiteUrl),
    hasLink: token.hasLink || Boolean(hint.twitterUrl || hint.telegramUrl || hint.websiteUrl),
    isMayhem: token.isMayhem || hint.kinds?.includes('mayhem') === true,
    isCashback: token.isCashback || hint.kinds?.includes('cashback') === true,
    // Graduation marker fallback: the snapshot adapter is the primary source,
    // but a graduated-sourced hint can arrive before the snapshot does — the
    // flag rides every order submit and arms the engine's stale-quote backstop.
    graduated: token.graduated === true || hint.sourceSection === 'graduated' || undefined,
    // Quote-mint fallback (USDC pairs): the snapshot is authoritative, but a
    // hint-sourced quote mint keeps the spend-currency resolver correct in
    // the pre-snapshot window (graduated + missing quoteMint = the SOL
    // fallback that mis-routed USDC-pair orders).
    quoteMint: token.quoteMint ?? hint.quoteMint ?? null,
  };
}

function shortMint(mint: string | undefined): string {
  if (!mint) return '';
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function scheduleDeferredNavigationPrefetch(work: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(work, { timeout: 1_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 300);
  return () => window.clearTimeout(handle);
}

import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  createChart,
  createTextWatermark,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type Time,
} from 'lightweight-charts';
import { useChartPrefsStore } from '@/lib/state/chart-prefs-store';
import {
  backdropCss,
  paintToRgba,
  type CandleStyle,
  type ChartLineStyle,
} from '@/lib/state/chart-style';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { WalletChartBubbles, type WalletBubble ,
  ANCHOR_GAP_PX,
  BUBBLE_RADIUS,
  STACK_STEP_PX,
  candleAtTime,
  highAtTime,
} from './walletChartBubbles';
import { findMarkerCandleTime } from './markerAnchoring';
import { StatusBadge } from '@/components/listen/primitives';
import { Bolt } from '@/components/listen/icons/Icons';
import { useTheme } from '@/components/listen/theme/useTheme';
import { compactAge } from '@/lib/format';
import { pageZoom } from '@/lib/page-zoom';
import { ThesisText } from '@/components/discover/ThesisText';
import type { MockToken, OHLCSnapshot } from './mockTrade';
import type { TokenTrade } from './types';
import {
  QUICK_TIMEFRAMES,
  type ChartTimeframe,
} from './timeframes';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';

/** One coin call to render as a thesis bubble on the chart. */
export interface ChartCoinCall {
  id: string;
  callerLabel: string;
  thesis: string;
  createdAtMs: number;
  /** Numeric USD MC at call time — the bubble's y anchor on the MC-scaled
   *  chart. Null pins the bubble to the top strip instead. */
  marketCapUsd: number | null;
  /** Display string for the popover ("$12.4K"); null renders an em dash. */
  marketCapLabel: string | null;
  /** Set when the caller rewrote their thesis — popover "edited" marker. */
  editedAt: string | null;
}

interface Props {
  token: MockToken;
  ohlc: OHLCSnapshot;
  timeframe: ChartTimeframe;
  /** Footer quick-toggle handler; both selectors drive one selection. */
  onTimeframeChange?: (timeframe: ChartTimeframe) => void;
  /** Bumped by stream resyncs: the settled candle base was rebuilt with
   *  possibly identical shape but different VALUES — the series fast
   *  path must not absorb it. */
  rebuildEpoch?: number;
  onInstantTradeClick?: () => void;
  instantTradeOpen?: boolean;
  /**
   * 7D-1: real candle series sourced from backend `TokenSnapshot`.
   * When present and non-empty, the chart calls `series.setData`
   * with these instead of the synthetic mock series. Mock markers
   * are also cleared (they were positioned at mock-candle indices
   * and have no meaning on real data; real markers ship later).
   */
  candles?: CandlestickData<Time>[];
  /** Tracked-wallet buy/sell events for the active mint. */
  walletActivityEvents?: WalletActivityEvent[];
  /** Token-creator (dev) trades for the active mint — automatic for every
   *  coin (derived from the trade tape + the snapshot's creator, no user
   *  tracking). Rendered as gold-ringed DB/DS bubbles. */
  devActivityEvents?: WalletActivityEvent[];
  /** The signed-in user's OWN trades on this mint (their wallet pubkeys
   *  matched against the tape). Rendered as accent-ringed B/S bubbles. */
  selfActivityEvents?: WalletActivityEvent[];
  /** Classified sniper wallets' trades — crosshair bubbles. */
  sniperActivityEvents?: WalletActivityEvent[];
  /** Classified bundler wallets' trades — package bubbles. */
  bundlerActivityEvents?: WalletActivityEvent[];
  /** Pricing context for bubble hover stats (avg buy/sell as USD MC,
   *  supply-held %). Missing values degrade those lines gracefully. */
  solUsd?: number | null;
  totalSupplyBaseUnits?: string | null;
  /** Graduation moment (ms) — renders the single amber "M" marker on the
   *  candle where the coin graduated. Absent/null = no marker. */
  graduatedAtMs?: number | null;
  /** Coin calls for the active mint (viewer's alpha feed) — rendered as
   *  clickable thesis bubbles anchored at (call time, MC at call). */
  coinCalls?: ChartCoinCall[];
  /** Snapshot trades let wallet markers align to backend's candle clock. */
  recentTrades?: TokenTrade[];
  /** Creator-fee claims: a wallet took its money out. Rendered as the
   *  green wallet disc — the rarest mark on the pane. */
  claimActivityEvents?: WalletActivityEvent[];
  /** Display labels for tracked wallet addresses. */
  walletLabelByAddress?: Record<string, string>;
  /** Imported emoji metadata for tracked wallet addresses. */
  walletEmojiByAddress?: Record<string, string>;
  selectedCandle?: { timeframe: ChartTimeframe; bucketStartSec: number } | null;
  onCandleClick?: (bucketStartSec: number) => void;
  onNeedOlderCandles?: () => void;
  hasMoreOlderCandles?: boolean;
  loadingOlderCandles?: boolean;
  emptyMessage?: string | null;
  /**
   * `true` only for the genuine cold first paint of a never-seen mint (no cached,
   * persisted, prewarmed, or previous snapshot). Renders a subtle shimmer skeleton
   * instead of a spinner/blank so the rare uncached open degrades gracefully. Cached or
   * prewarmed coins never set this — they paint candles straight away.
   */
  loading?: boolean;
  /**
   * 7D-1: `true` when the underlying snapshot is a stub (CREATE
   * not yet landed). Renders a small muted "warming up" pill in
   * the OHLC readout strip so users know the data is incomplete.
   */
  isStub?: boolean;
  /**
   * Multiplier from the canonical USD-market-cap scale (what `candles`
   * and every y anchor arrive in) to the DISPLAYED scale — the
   * USD/SOL × MarketCap/Price toolbar toggles. 1 = USD market cap.
   */
  valueScale?: number;
  /** Axis/readout formatting hints for the displayed scale. `NATIVE` (the
   *  EVM mount's non-USD bases) prints bare figures — no `$` prefix, no
   *  ` SOL` suffix; the mount labels the unit beside the chart. Type-only
   *  addition: it rides the existing "neither USD nor SOL" formatting path. */
  displayUnit?: 'USD' | 'SOL' | 'NATIVE';
  displayMode?: 'MarketCap' | 'Price';
  /** The viewer's average entry (buys) in USD-MC scale — dotted line. */
  avgEntryUsdMc?: number | null;
  /** The viewer's average exit (sells) in USD-MC scale — dotted line. */
  avgExitUsdMc?: number | null;
  /** Armed price alerts (USD-MC scale) — dotted amber lines. */
  alerts?: ReadonlyArray<ChartAlert>;
  /** Pre-bond only: the pending migration level in USD-MC scale — dotted
   *  line at the MC where the curve completes. Moves with the live SOL
   *  price (the graduation threshold is fixed in SOL terms); null once
   *  the coin graduates, at which point the M bubble takes over. */
  migrationUsdMc?: number | null;
  /** Arm an alert at the right-clicked level (USD-MC scale). */
  onSetAlert?: (usdMc: number, direction: 'above' | 'below') => void;
}

/** One armed chart alert (client-side, session-scoped). */
export interface ChartAlert {
  id: string;
  usdMc: number;
  direction: 'above' | 'below';
}


/**
 * Axis/readout number formatting across every display scale the
 * toolbar can select: market caps (K/M/B) down to per-token prices
 * (sub-cent significant digits in Price mode).
 */
function fmtK(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.01) return v.toFixed(4);
  if (abs > 0) return v.toPrecision(3);
  return '0.00';
}

function scheduleChartRemoval(chart: IChartApi): void {
  const remove = () => chart.remove();
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(remove, { timeout: 500 });
    return;
  }
  window.setTimeout(remove, 0);
}

/**
 * 7E visible-range guardrail. Scrolls the latest logical bar into
 * view only when it would be off-screen — typically:
 *
 *   - first data load (no range set yet)
 *   - mint switch (totally new candle set; old visible window is
 *     out of bounds for the new data)
 *   - user panned far from "now" and a new bucket arrived
 *
 * Within a single coin's natural growth (1 new bucket every tick),
 * lightweight-charts' default `shiftVisibleRangeOnNewBar: true`
 * keeps the latest bar in view automatically; we don't fight that.
 *
 * We intentionally avoid `setVisibleRange` here. Lightweight Charts
 * clamps time ranges to available data, so sparse fresh mints with
 * only one or two bars can get stretched across the viewport. A
 * bounded logical window keeps fresh mints readable without leaving
 * most of the chart empty.
 */
const LEFT_EDGE_LOAD_THRESHOLD = 24;
const EMPTY_WALLET_ACTIVITY_EVENTS: WalletActivityEvent[] = [];
const EMPTY_COIN_CALLS: ChartCoinCall[] = [];
const EMPTY_CHART_ALERTS: ChartAlert[] = [];
const EMPTY_SCALED_CANDLES: CandlestickData<Time>[] = [];
const EMPTY_THESIS_MARKERS: ThesisMarker[] = [];
const EMPTY_RECENT_TRADES: TokenTrade[] = [];
const EMPTY_WALLET_LABELS: Record<string, string> = {};
const EMPTY_WALLET_EMOJIS: Record<string, string> = {};
const EMPTY_CANDLE_TIMES: number[] = [];

/*
 * ── HOW MANY CANDLES ARE ON SCREEN ───────────────────────────────────
 *
 * THIS is the zoom, not `barSpacing`. `setVisibleLogicalRange` below
 * pins a bar COUNT into the pane, and lightweight-charts then divides
 * the width by it — so whatever spacing the options ask for is
 * overwritten the moment a range is set. Changing the spacing table
 * alone does nothing, which is worth knowing before touching it.
 *
 * It was 96 bars (120 on 1s). In a chart column about 435px wide that
 * is four and a half pixels a candle: a two pixel body with a one pixel
 * wick, which reads as a hairy line rather than as candles.
 *
 * 56 (72 on 1s) puts a candle at roughly eight pixels — a six pixel
 * body against a thin wick, clearly up or down at a glance. Fewer bars
 * on screen is the price, and it is the right one: the reason to look
 * at a chart of the last few minutes is to see the individual moves.
 */
function visibleLogicalBars(dataLength: number, timeframe: ChartTimeframe): number {
  if (dataLength <= 0) return 0;
  if (dataLength < 24) return 32;
  const steadyWindow = timeframe === '1s' ? 72 : 56;
  if (dataLength < steadyWindow) {
    return dataLength + TIMEFRAME_OPTIONS[timeframe].rightOffset + 8;
  }
  return steadyWindow;
}

function ensureLatestLogicalWindow(
  chart: IChartApi,
  data: CandlestickData<Time>[] | undefined,
  timeframe: ChartTimeframe,
  force = false,
): void {
  if (!data || data.length === 0) return;
  const ts = chart.timeScale();
  const range = ts.getVisibleLogicalRange();
  const latestIndex = data.length - 1;
  // Scroll when:
  //   - no logical range is set yet (first load),
  //   - latest candle is past either edge (mint switch or stale
  //     user pan), or
  //   - caller forces a reset on timeframe changes.
  const needsScroll =
    force || range == null || latestIndex > Number(range.to) || latestIndex < Number(range.from);
  if (!needsScroll) return;
  const options = TIMEFRAME_OPTIONS[timeframe];
  const visibleBars = visibleLogicalBars(data.length, timeframe);
  if (visibleBars <= 0) return;
  const to = latestIndex + options.rightOffset;
  ts.applyOptions(options);
  ts.setVisibleLogicalRange({
    from: to - visibleBars,
    to,
  });
}

/*
 * ── SPACED SO A CANDLE HAS A BODY ────────────────────────────────────
 *
 * A FLOOR, not the zoom. `visibleLogicalBars` above sets how many
 * candles are on screen and that wins wherever a logical range is
 * applied; these values only decide the spacing before the first range
 * lands and while a fresh mint has too few bars to fill a window.
 *
 * Kept in step with the bar count so the two agree: about eight pixels
 * a candle, which is a body you can read against a thin wick.
 */
const TIMEFRAME_OPTIONS: Record<
  ChartTimeframe,
  { barSpacing: number; rightOffset: number; secondsVisible: boolean }
> = {
  '1s': { barSpacing: 7, rightOffset: 12, secondsVisible: true },
  '5s': { barSpacing: 7, rightOffset: 12, secondsVisible: true },
  '1m': { barSpacing: 7, rightOffset: 12, secondsVisible: true },
  '5m': { barSpacing: 7.5, rightOffset: 10, secondsVisible: false },
  '15m': { barSpacing: 8, rightOffset: 8, secondsVisible: false },
  '1h': { barSpacing: 8.5, rightOffset: 6, secondsVisible: false },
  '4h': { barSpacing: 8.5, rightOffset: 6, secondsVisible: false },
  '12h': { barSpacing: 9, rightOffset: 5, secondsVisible: false },
  '1d': { barSpacing: 9, rightOffset: 5, secondsVisible: false },
};

interface PriceRange {
  from: number;
  to: number;
}

/** Per-wallet raw trade sums (+ parsed supply) for the hover card. USD
 *  conversion happens at tooltip-build time with the CURRENT SOL price, so
 *  the marker model never depends on the wobbling Pyth float. */
export interface WalletMarkerHoverStats {
  buySol: number;
  buyTok: number;
  sellSol: number;
  sellTok: number;
  supply: number;
  /** Trade-derived current position as % of total supply. */
  heldPct: number | null;
}

interface WalletMarkerHoverEntry {
  side: 'Buy' | 'Sell';
  walletLabel: string;
  walletEmoji?: string;
  /** Which class this is, so the card can draw the class's own mark. */
  kind?: BubbleKind;
  /** Click target: clicking this entry's bubble opens the wallet dossier.
   *  Null for synthetic markers (graduation) — those consume the click. */
  wallet: string | null;
  signature: string;
  color: string;
  /** This trade's size in SOL. */
  amountSol: number;
  /** The wallet's raw buy/sell sums on this mint — the tooltip derives the
   *  avg USD-MC columns (same convention as the holders/top-traders
   *  tables) from these at hover time. Null degrades those lines. */
  stats: WalletMarkerHoverStats | null;
  /** Set on a creator-fee claim — renders the one line tooltip, not the
   *  trade card: a claim has no side, no market cap and no position. */
  claim?: boolean;
  /** Set on the graduation marker's entry — renders the special
   *  "Graduated" row (time + MC at the anchor candle) instead of the
   *  buy/sell trade row. */
  graduation?: { timeMs: number; timeSec: number };
}

/** Hover entry with the USD figures resolved — the rendered tooltip rows. */
type WalletMarkerTooltipEntry = WalletMarkerHoverEntry & {
  avgBuyUsdMc: number | null;
  avgSellUsdMc: number | null;
  heldPct: number | null;
};

// Exported for tests (pure): converts one hover entry's raw sums into the
// tooltip's avg-USD-MC figures with the SOL price current at hover time —
// ≤ MAX_TOOLTIP_ROWS rows per build, so hover-time conversion is trivial.
export function tooltipUsdFigures(
  stats: WalletMarkerHoverStats | null,
  solUsd: number | null,
): { avgBuyUsdMc: number | null; avgSellUsdMc: number | null; heldPct: number | null } {
  if (!stats) return { avgBuyUsdMc: null, avgSellUsdMc: null, heldPct: null };
  const priced = solUsd != null && Number.isFinite(solUsd) && solUsd > 0;
  // ratio = lamports per base unit -> USD market cap, mirroring the
  // holders/top-traders "avg" columns.
  const toUsdMc = (sol: number, tok: number) =>
    priced && tok > 0 ? ((sol / tok) * stats.supply * (solUsd as number)) / 1e9 : null;
  return {
    avgBuyUsdMc: toUsdMc(stats.buySol, stats.buyTok),
    avgSellUsdMc: toUsdMc(stats.sellSol, stats.sellTok),
    heldPct: stats.heldPct,
  };
}

/** Hover payload for one candle bucket, capped at build time so a
 *  sniper/bundler pile-up never carries hundreds of tooltip rows. */
interface WalletMarkerBucketHover {
  /** The candle this bucket sits on — the key the open-bucket state uses. */
  timeSec: number;
  /** First MAX_TOOLTIP_ROWS entries in bubble-priority order. */
  entries: WalletMarkerHoverEntry[];
  /** TRUE bucket size — drives the hover band height (via the rendered
   *  stack cap) and the tooltip's "+N more" line. */
  totalCount: number;
}

interface WalletMarkerModel {
  bubbles: WalletBubble[];
  hoverByTime: Map<number, WalletMarkerBucketHover>;
  /** `hoverByTime`'s keys in ascending order — the hover/click hit-test's
   *  binary-search index, so pointer events cost O(log buckets) instead of
   *  walking every bucket on data-heavy mints. */
  bucketTimes: number[];
}

/** A coin call snapped onto a loaded candle bucket, ready to position. */
interface ThesisMarker {
  call: ChartCoinCall;
  /** Candle bucket the call time snapped to (chart x anchor). */
  timeSec: number;
  /** Same-bucket calls stack upward instead of overlapping. */
  stackIndex: number;
}

function toLineStyle(style: ChartLineStyle): LineStyle {
  return style === 'solid'
    ? LineStyle.Solid
    : style === 'dotted'
      ? LineStyle.Dotted
      : LineStyle.Dashed;
}

/**
 * Resolve the studio's candle model into lightweight-charts series
 * options. Body = fill; border and wick each match the body, use their
 * own paint, or hide; hollowUp swaps the up body for a transparent fill
 * with a forced up border (classic hollow candles).
 */
function candleSeriesOptions(candle: CandleStyle): Record<string, unknown> {
  const upBody = candle.hollowUp ? 'transparent' : paintToRgba(candle.upBody);
  const downBody = paintToRgba(candle.downBody);

  // Border: hollowUp forces an up border so a transparent body still reads.
  const borderOn = candle.borderMode !== 'none' || candle.hollowUp;
  const upBorder =
    candle.borderMode === 'custom' ? paintToRgba(candle.upBorder) : paintToRgba(candle.upBody);
  const downBorder =
    candle.borderMode === 'custom' ? paintToRgba(candle.downBorder) : paintToRgba(candle.downBody);

  // Wick: match body, custom, or hidden.
  const wickOn = candle.wickMode !== 'none';
  const upWick = candle.wickMode === 'custom' ? paintToRgba(candle.upWick) : paintToRgba(candle.upBody);
  const downWick =
    candle.wickMode === 'custom' ? paintToRgba(candle.downWick) : paintToRgba(candle.downBody);

  return {
    upColor: upBody,
    downColor: downBody,
    borderVisible: borderOn,
    borderUpColor: upBorder,
    borderDownColor: downBorder,
    wickVisible: wickOn,
    wickUpColor: upWick,
    wickDownColor: downWick,
  };
}

function dataPriceRange(data: CandlestickData<Time>[] | undefined): PriceRange | null {
  if (!data || data.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const candle of data) {
    min = Math.min(min, candle.low);
    max = Math.max(max, candle.high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 1);
    return { from: min - pad, to: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { from: min - pad, to: max + pad };
}

/* White, with black type — see MAX_BUBBLES_PER_BUCKET. */
const AGGREGATE_BUBBLE_FILL = '#ffffff';

/*
 * The two fills that are not a side.
 *
 * Every class used to be told apart by a 1.5px ring in its own colour —
 * gold for the dev, cyan for you, red for a sniper, violet for a
 * bundler. Six hues outlining a 20px disc that is already green or pink,
 * eight of them stacked over one candle: the discs read as outlined
 * stickers, and the outline was the loudest thing in the pane. The
 * LABEL carries the class now and nothing is stroked.
 *
 * These two remain because they are the only marks on the chart that are
 * neither a buy nor a sell: the amber graduation "M", and the neutral
 * grey "+N" that stands in for a stack too deep to draw.
 */
const MIGRATION_BUBBLE_FILL = '#f5a524';

/** Bubble identity priority when one signature appears in several sources.
 *  Dev/self/tracked reflect explicit identity or user intent, so they beat
 *  the engine's sniper/bundler classification for the same trade. The
 *  one-per-mint graduation marker outranks everything. */
type BubbleKind = 'migration' | 'claim' | 'dev' | 'self' | 'tracked' | 'sniper' | 'bundler';
const BUBBLE_KIND_RANK: Record<BubbleKind, number> = {
  migration: 0,
  /* A claim is a one-per-wallet event and the rarest thing on the pane,
     so it sits directly under the graduation mark. */
  claim: 1,
  dev: 2,
  self: 3,
  tracked: 4,
  sniper: 5,
  bundler: 6,
};

/**
 * The card's one line of context: at what market cap, and how long ago.
 *
 * The candle a trade anchors to carries both — `candles` is the
 * canonical USD market cap series, so its close IS the market cap, and
 * its time is when. Nothing here needs the trade's own timestamp, which
 * the hover entry does not carry anyway.
 */
/**
 * The mark on the card's face.
 *
 * It used to be an emoji standing in for each class — a chef's hat for
 * the dev, a target for a sniper, a cardboard box for a bundler. Those
 * were placeholders, and the app has real artwork for two of them: the
 * dev icon and the insider mark. The rest of the classes are already
 * told by two letters on the disc, so the card says the same thing.
 */
function MarkerArt({ entry }: { entry: WalletMarkerHoverEntry }): ReactElement {
  if (entry.kind === 'dev') {
    return <img src="/assets/dev_icon.svg" alt="" width={12} height={12} draggable={false} />;
  }
  if (entry.kind === 'bundler') {
    return (
      <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden>
        <path d="M12 2C16.9706 2 21 6.02944 21 11V18.5C21 20.433 19.433 22 17.5 22C16.3001 22 15.2413 21.3962 14.6107 20.476C14.0976 21.3857 13.1205 22 12 22C10.8795 22 9.9024 21.3857 9.38728 20.4754C8.75869 21.3962 7.69985 22 6.5 22C4.63144 22 3.10487 20.5357 3.00518 18.692L3 18.5V11C3 6.02944 7.02944 2 12 2ZM12 4C8.21455 4 5.1309 7.00478 5.00406 10.7593L5 11L4.99927 18.4461L5.00226 18.584C5.04504 19.3751 5.70251 20 6.5 20C6.95179 20 7.36652 19.8007 7.64704 19.4648L7.73545 19.3478C8.57033 18.1248 10.3985 18.2016 11.1279 19.4904C11.3053 19.8038 11.6345 20 12 20C12.3651 20 12.6933 19.8044 12.8687 19.4934C13.5692 18.2516 15.2898 18.1317 16.1636 19.2151L16.2606 19.3455C16.5401 19.7534 16.9976 20 17.5 20C18.2797 20 18.9204 19.4051 18.9931 18.6445L19 18.5V11C19 7.13401 15.866 4 12 4ZM12 12C13.1046 12 14 13.1193 14 14.5C14 15.8807 13.1046 17 12 17C10.8954 17 10 15.8807 10 14.5C10 13.1193 10.8954 12 12 12ZM9.5 8C10.3284 8 11 8.67157 11 9.5C11 10.3284 10.3284 11 9.5 11C8.67157 11 8 10.3284 8 9.5C8 8.67157 8.67157 8 9.5 8ZM14.5 8C15.3284 8 16 8.67157 16 9.5C16 10.3284 15.3284 11 14.5 11C13.6716 11 13 10.3284 13 9.5C13 8.67157 13.6716 8 14.5 8Z" />
      </svg>
    );
  }
  if (entry.walletEmoji) return <>{entry.walletEmoji}</>;
  if (entry.graduation) return <>M</>;
  const two = entry.kind === 'sniper' ? 'S' : entry.kind === 'self' ? '' : null;
  return <>{two !== null ? `${two}${entry.side === 'Buy' ? 'B' : 'S'}` : entry.side === 'Buy' ? 'B' : 'S'}</>;
}

/** A tracked wallet's disc letter: the first letter of the name the
 *  reader gave it, or of its address when it has no name. */
function initialOf(label: string | undefined, wallet: string): string {
  const source = (label ?? wallet).trim();
  return (source[0] ?? '?').toUpperCase();
}

function markerWhen(timeSec: number, candles: CandlestickData<Time>[] | null | undefined): string {
  const ago = compactAge(Math.max(0, Date.now() - timeSec * 1000));
  const mc = candles ? candleAtTime(candles, timeSec)?.close : undefined;
  const at = mc != null && Number.isFinite(mc) && mc > 0 ? `$${fmtK(mc)} MC` : null;
  return [at, `${ago} ago`].filter(Boolean).join(', ');
}

/*
 * ── ONE DISC PER CANDLE ──────────────────────────────────────────────
 *
 * They used to stack: up to eight discs towering above a single candle,
 * and on a ≥1m timeframe with snipers and bundlers landing in the same
 * two seconds, eight was the common case rather than the exception. A
 * column of coloured circles is not a chart annotation, it is a wall,
 * and it covered the candles it was annotating.
 *
 * So there is a floor. Up to FIVE trades on a candle draw their own
 * discs; past that the candle draws ONE WHITE DISC carrying the count.
 * White because it is the only mark on the pane that is not a side and
 * not a class — it says "several things happened here" and nothing else,
 * and pressing it unpacks the candle.
 *
 * The floor matters: a `+2` over a candle holding two trades hides two
 * marks to save one, which is worse than the pile it was meant to
 * prevent. Five is where a stack starts being a wall.
 */
const MAX_BUBBLES_PER_BUCKET = 5;
/** How tall an unpacked candle is allowed to get. */
const MAX_OPEN_BUBBLES = 8;
/** Tooltip row cap per bucket; overflow renders one quiet "+N more" line. */
const MAX_TOOLTIP_ROWS = 12;

/** Per-wallet trade sums for the hover card, from the SAME event streams
 *  the bubbles render (so hover math always matches what is on screen).
 *  Streams overlap by signature — the union dedupes before summing. */
function bubbleWalletStats(
  streams: WalletActivityEvent[][],
  totalSupplyBaseUnits: string | null,
): Map<string, WalletMarkerHoverStats> {
  const out = new Map<string, WalletMarkerHoverStats>();
  const supply = Number(totalSupplyBaseUnits ?? '0');
  if (!Number.isFinite(supply) || supply <= 0) return out;
  const byWallet = new Map<
    string,
    { seen: Set<string>; buySol: number; buyTok: number; sellSol: number; sellTok: number }
  >();
  for (const stream of streams) {
    for (const event of stream) {
      let acc = byWallet.get(event.wallet);
      if (!acc) {
        acc = { seen: new Set(), buySol: 0, buyTok: 0, sellSol: 0, sellTok: 0 };
        byWallet.set(event.wallet, acc);
      }
      if (acc.seen.has(event.signature)) continue;
      acc.seen.add(event.signature);
      const sol = Number(event.solLamports);
      const tok = Number(event.tokens);
      if (!Number.isFinite(sol) || !Number.isFinite(tok) || tok <= 0) continue;
      if (event.isBuy) {
        acc.buySol += sol;
        acc.buyTok += tok;
      } else {
        acc.sellSol += sol;
        acc.sellTok += tok;
      }
    }
  }
  for (const [wallet, acc] of byWallet) {
    out.set(wallet, {
      buySol: acc.buySol,
      buyTok: acc.buyTok,
      sellSol: acc.sellSol,
      sellTok: acc.sellTok,
      supply,
      heldPct: Math.max(0, ((acc.buyTok - acc.sellTok) / supply) * 100),
    });
  }
  return out;
}

// Exported for tests (pure): the same-bucket stack/tooltip caps have no
// other seam that avoids a DOM/chart harness.
export function buildWalletTradeMarkerModel(
  events: WalletActivityEvent[],
  devEvents: WalletActivityEvent[],
  selfEvents: WalletActivityEvent[],
  claimEvents: WalletActivityEvent[],
  sniperEvents: WalletActivityEvent[],
  bundlerEvents: WalletActivityEvent[],
  timeframe: ChartTimeframe,
  candleTimes: number[],
  recentTradeBySignature: Map<string, TokenTrade>,
  walletLabelByAddress: Record<string, string>,
  walletEmojiByAddress: Record<string, string>,
  totalSupplyBaseUnits: string | null,
  graduatedAtMs: number | null,
  /** The candle the reader has unpacked, if any. */
  openBucketSec: number | null,
): WalletMarkerModel {
  if (
    candleTimes.length === 0 ||
    (events.length === 0 &&
      devEvents.length === 0 &&
      selfEvents.length === 0 &&
      claimEvents.length === 0 &&
      sniperEvents.length === 0 &&
      bundlerEvents.length === 0 &&
      graduatedAtMs == null)
  ) {
    return { bubbles: [], hoverByTime: new Map(), bucketTimes: [] };
  }
  const statsByWallet = bubbleWalletStats(
    [devEvents, selfEvents, claimEvents, events, sniperEvents, bundlerEvents],
    totalSupplyBaseUnits,
  );
  const entries: {
    event: WalletActivityEvent;
    timeSec: number;
    kind: BubbleKind;
    hover: WalletMarkerHoverEntry;
  }[] = [];
  // A signature can appear in several sources (the dev might be tracked;
  // the user might track their own wallet) — highest identity wins.
  const seenSignatures = new Set<string>();
  const push = (event: WalletActivityEvent, kind: BubbleKind) => {
    // One tx can carry several wallets' trades (bundles) — dedupe per
    // (signature, wallet), or every co-bundled trade after the first
    // silently vanishes from the chart.
    const seenKey = `${event.signature}:${event.wallet}`;
    if (seenSignatures.has(seenKey)) return;
    const trade = recentTradeBySignature.get(event.signature);
    const eventMs = trade
      ? trade.blockTimeSec == null
        ? trade.arrivedAtMs
        : trade.blockTimeSec * 1_000
      : (event.blockTimeMs ?? event.receivedAtMs);
    const timeSec = findMarkerCandleTime(eventMs, timeframe, candleTimes);
    if (timeSec == null) return;
    seenSignatures.add(seenKey);
    /* The classes carry their own MARK on the card (see `markerArt`),
       not a stand-in emoji — a chef's hat for the dev and a cardboard box
       for a bundler were placeholders that outlived their placeholder. */
    const emoji =
      kind === 'dev' || kind === 'sniper' || kind === 'bundler'
        ? undefined
        : kind === 'self'
              ? undefined
              : walletEmojiByAddress[event.wallet];
    entries.push({
      event,
      timeSec,
      kind,
      hover: {
        kind,
        side: event.isBuy ? 'Buy' : 'Sell',
        claim: kind === 'claim',
        walletLabel:
          kind === 'claim'
            ? shortWallet(event.wallet)
            : kind === 'dev'
            ? 'Dev (creator)'
            : kind === 'self'
              ? 'You'
              : kind === 'sniper'
                ? `Sniper ${shortWallet(event.wallet)}`
                : kind === 'bundler'
                  ? `Bundler ${shortWallet(event.wallet)}`
                  : (walletLabelByAddress[event.wallet] ?? shortWallet(event.wallet)),
        walletEmoji: emoji,
        wallet: event.wallet,
        signature: event.signature,
        color: event.isBuy ? '#22c77e' : '#f0567a',
        amountSol: Number(event.solLamports) / 1e9,
        stats: statsByWallet.get(event.wallet) ?? null,
      },
    });
  };
  // Graduation "M" marker: exactly one per mint, anchored like every
  // other bubble so it survives timeframe switches, paging and resyncs
  // (older-than-history graduations pin to the left edge and slide into
  // place when that history pages in).
  if (graduatedAtMs != null) {
    const timeSec = findMarkerCandleTime(graduatedAtMs, timeframe, candleTimes);
    if (timeSec != null) {
      entries.push({
        event: {
          signature: 'graduation',
          slot: 0,
          blockTimeMs: graduatedAtMs,
          wallet: '',
          mint: '',
          isBuy: true,
          solLamports: '0',
          tokens: '0',
          venue: 'bonding_curve',
          receivedAtMs: graduatedAtMs,
        },
        timeSec,
        kind: 'migration',
        hover: {
          side: 'Buy',
          walletLabel: 'Graduated',
          wallet: null,
          signature: 'graduation',
          color: MIGRATION_BUBBLE_FILL,
          amountSol: 0,
          stats: null,
          graduation: { timeMs: graduatedAtMs, timeSec },
        },
      });
    }
  }
  for (const event of claimEvents) push(event, 'claim');
  for (const event of devEvents) push(event, 'dev');
  for (const event of selfEvents) push(event, 'self');
  for (const event of events) push(event, 'tracked');
  for (const event of sniperEvents) push(event, 'sniper');
  for (const event of bundlerEvents) push(event, 'bundler');
  const sorted = entries.sort((a, b) => {
    const timeDiff = a.timeSec - b.timeSec;
    if (timeDiff !== 0) return timeDiff;
    const rankDiff = BUBBLE_KIND_RANK[a.kind] - BUBBLE_KIND_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    if (a.event.isBuy !== b.event.isBuy) return a.event.isBuy ? -1 : 1;
    const walletDiff = a.event.wallet.localeCompare(b.event.wallet);
    if (walletDiff !== 0) return walletDiff;
    return a.event.signature.localeCompare(b.event.signature);
  });
  const hoverByTime = new Map<number, WalletMarkerBucketHover>();
  // `sorted` is ascending by timeSec, so pushing per bucket run keeps the
  // hit-test's binary-search index sorted for free.
  const bucketTimes: number[] = [];
  const bubbles: WalletBubble[] = [];
  // `sorted` orders by timeSec first, so each bucket is one contiguous run.
  let start = 0;
  while (start < sorted.length) {
    const timeSec = sorted[start]!.timeSec;
    let end = start;
    while (end < sorted.length && sorted[end]!.timeSec === timeSec) end += 1;
    const bucketCount = end - start;
    // Hover payload capped at build time (first rows + true total) so a
    // pile-up bucket never drags hundreds of rows through state/render.
    const hoverEntries: WalletMarkerHoverEntry[] = [];
    const hoverEnd = Math.min(end, start + MAX_TOOLTIP_ROWS);
    for (let i = start; i < hoverEnd; i += 1) hoverEntries.push(sorted[i]!.hover);
    hoverByTime.set(timeSec, { timeSec, entries: hoverEntries, totalCount: bucketCount });
    bucketTimes.push(timeSec);
    /* One trade on this candle draws its own bubble; more than one
       draws the white count disc instead of any of them — unless the
       reader has pressed that disc, in which case the candle unpacks and
       draws its trades, capped so a two hundred trade candle cannot
       build a wall to the top of the pane. */
    const opened = timeSec === openBucketSec;
    const overflows = bucketCount > MAX_BUBBLES_PER_BUCKET && !opened;
    const renderEnd = overflows ? start : Math.min(end, start + MAX_OPEN_BUBBLES);
    for (let i = start; i < renderEnd; i += 1) {
      const entry = sorted[i]!;
      const stackIndex = i - start;
      if (entry.kind === 'migration') {
        // Graduation: amber "M" disc, rank 0 so it sits closest to the candle.
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: true,
          label: 'M',
          isEmoji: false,
          fillColor: MIGRATION_BUBBLE_FILL,
        });
        continue;
      }
      if (entry.kind === 'dev') {
        // The dev, in the side's own colour, said by the letters.
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: entry.event.isBuy,
          label: entry.event.isBuy ? 'DB' : 'DS',
          isEmoji: false,
        });
        continue;
      }
      if (entry.kind === 'self') {
        /* The plain B and S are YOURS, and nobody else's. Every other
           class carries two letters or a mark, so the bare letter is
           free to mean the one wallet the reader owns. */
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: entry.event.isBuy,
          label: entry.event.isBuy ? 'B' : 'S',
          isEmoji: false,
        });
        continue;
      }
      if (entry.kind === 'sniper') {
        /* SB / SS, the shape the dev's DB / DS already uses — the target
           emoji it replaces was the only glyph on the pane that carried
           its own colour, and it read as decoration rather than as a
           class the chart had decided something about. */
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: entry.event.isBuy,
          label: entry.event.isBuy ? 'SB' : 'SS',
          isEmoji: false,
        });
        continue;
      }
      if (entry.kind === 'bundler') {
        /* The app's own insider mark, drawn into the disc. */
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: entry.event.isBuy,
          label: '',
          isEmoji: false,
          icon: 'insider',
        });
        continue;
      }
      if (entry.kind === 'claim') {
        /* A claim is money arriving, never leaving, so it is always the
           buy green — the wallet mark is what says it was a claim and
           not a purchase. */
        bubbles.push({
          timeSec: entry.timeSec,
          stackIndex,
          isBuy: true,
          label: '',
          isEmoji: false,
          icon: 'wallet',
        });
        continue;
      }
      const emoji = walletEmojiByAddress[entry.event.wallet];
      bubbles.push({
        timeSec: entry.timeSec,
        stackIndex,
        isBuy: entry.event.isBuy,
        /*
         * An emoji fills the disc when the wallet has one. Without one it
         * takes the FIRST LETTER OF ITS NAME — `W` for whale one — not a
         * class code. `TB`/`TS` was a code for a thing the reader named
         * themselves: they know who that wallet is, they just cannot read
         * a two letter abbreviation for "tracked".
         *
         * The bare B and S are not available here — those are the
         * reader's own trades and nobody else's.
         */
        label: emoji ?? initialOf(walletLabelByAddress[entry.event.wallet], entry.event.wallet),
        isEmoji: Boolean(emoji),
      });
    }
    if (overflows) {
      /* The white count disc, and it is the ONLY thing this bucket
         draws: with the cap at 1, `renderEnd` above is `start`, so the
         loop contributed nothing for an overflowing candle. (Clearing
         `bubbles` here would have wiped every earlier bucket too — the
         array accumulates across the whole series.) */
      bubbles.push({
        timeSec,
        stackIndex: 0,
        isBuy: true,
        label: `${bucketCount}+`,
        isEmoji: false,
        fillColor: AGGREGATE_BUBBLE_FILL,
      });
    }
    start = end;
  }
  return { bubbles, hoverByTime, bucketTimes };
}

/** Identity of the candle series currently pushed to lightweight-charts, used to decide
 *  whether the next render can use an O(1) `series.update` or must do a full `setData`. */
interface CandleSeriesSig {
  timeframe: ChartTimeframe;
  /** Stream-resync rebuild epoch: a bump rewrites settled bar VALUES
   *  without changing series shape, so it must force the setData path. */
  rebuildEpoch: number;
  firstTime: number;
  lastTime: number;
  length: number;
  lastBar: CandlestickData<Time>;
  prevTailTime: number | null;
  /** The bar behind the tip as last pushed. Like the tip it is still
   *  mutable, so a same-shape pass must diff it and re-push a revision —
   *  `series.update(lastBar)` alone would silently drop it. */
  prevTailBar: CandlestickData<Time> | null;
  /** Display scale the pushed bars were multiplied by. A scale flip
   *  (USD/SOL or MC/Price toggle) rewrites EVERY bar, so the fast
   *  last-bar path must never absorb it. */
  scale: number;
}

function sameBar(a: CandlestickData<Time>, b: CandlestickData<Time>): boolean {
  return Number(a.time) === Number(b.time)
    && a.open === b.open
    && a.high === b.high
    && a.low === b.low
    && a.close === b.close;
}

/** Previous display-scale pass, kept so the next one can prove the candles
 *  array only mutated/appended at the tail and reuse the scaled prefix.
 *  Same signature fields as CandleSeriesSig: rebuilds and scale flips
 *  rewrite VALUES without changing shape, so they must force a full remap. */
export interface ScaledCandlesCache {
  mint: string;
  timeframe: ChartTimeframe;
  rebuildEpoch: number;
  scale: number;
  firstTime: number;
  lastTime: number;
  length: number;
  /** UNSCALED tail bar — the append-one boundary check (spike fence). */
  lastBar: CandlestickData<Time>;
  prevTailTime: number | null;
  scaled: CandlestickData<Time>[];
}

// Exported for tests (pure): the prefix-reuse guards have no other seam
// that avoids a DOM/chart harness. Settled bars are write-once (append-only
// invariant), so when only the tail mutated/appended the previous scaled
// prefix is reused and only the bars that were still MUTABLE in the previous
// pass (the tip plus the bar behind it) are re-scaled — identical floats ×
// the identical scale is bit-identical to a full remap. Any other shape
// (prepend, drop, rebuild, scale flip, token/timeframe switch) falls
// through to the full map, mirroring the series fast path below.
export function scaleCandlesForDisplay(
  candles: CandlestickData<Time>[],
  valueScale: number,
  mint: string,
  timeframe: ChartTimeframe,
  rebuildEpoch: number,
  prev: ScaledCandlesCache | null,
): ScaledCandlesCache {
  const len = candles.length;
  const firstTime = Number(candles[0]!.time);
  const lastTime = Number(candles[len - 1]!.time);
  const lastBar = candles[len - 1]!;
  const prevTailTime = len >= 2 ? Number(candles[len - 2]!.time) : null;
  const scaleBar = (candle: CandlestickData<Time>): CandlestickData<Time> => ({
    ...candle,
    open: candle.open * valueScale,
    high: candle.high * valueScale,
    low: candle.low * valueScale,
    close: candle.close * valueScale,
  });
  const stable = prev != null
    && prev.mint === mint
    && prev.timeframe === timeframe
    && prev.rebuildEpoch === rebuildEpoch
    && prev.scale === valueScale
    && prev.length > 0
    && len >= 2
    && firstTime === prev.firstTime;
  const canMutateLast = stable
    && len === prev!.length
    && lastTime === prev!.lastTime
    && prev!.prevTailTime === prevTailTime;
  const canAppendOne = stable
    && len === prev!.length + 1
    && lastTime > prev!.lastTime
    && Number(candles[len - 2]!.time) === prev!.lastTime
    && sameBar(candles[len - 2]!, prev!.lastBar); // prev tail survived unchanged (spike fence)
  // Reuse only bars that were already SETTLED in the previous pass: the prev
  // tail two bars (tip + the bar behind it) were still mutable, so after an
  // append the bar now at len-3 (prev len-2) may carry a same-pass revision
  // — it must be re-scaled, never served from the stale prefix.
  const settledPrefixLen = canMutateLast || canAppendOne ? Math.max(0, prev!.length - 2) : 0;
  const scaled = canMutateLast || canAppendOne
    ? [...prev!.scaled.slice(0, settledPrefixLen), ...candles.slice(settledPrefixLen).map(scaleBar)]
    : candles.map(scaleBar);
  return {
    mint,
    timeframe,
    rebuildEpoch,
    scale: valueScale,
    firstTime,
    lastTime,
    length: len,
    lastBar,
    prevTailTime,
    scaled,
  };
}

/** Bubble-hover SOL amount: sub-0.01 keeps 4dp, otherwise 2dp/compact. */
function formatBubbleSol(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  const abs = Math.abs(amount);
  if (abs >= 1_000) return fmtK(amount);
  if (abs >= 0.01) return amount.toFixed(2);
  return amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function shortWallet(wallet: string): string {
  if (wallet.length <= 9) return wallet;
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

/** Graduation hover time: date + time — graduations can be days old. */
function formatGraduationTime(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return String(ms);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatCandleTime(bucketStartSec: number): string {
  const date = new Date(bucketStartSec * 1_000);
  if (!Number.isFinite(date.getTime())) return String(bucketStartSec);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Memoized like TradesTable/AnalyticsPanel: every prop from TradePage is
// identity-stabilized upstream (useMemo / useCallback / primitives), so the
// heaviest child on the page skips renders triggered by chart-irrelevant
// state (balance-poll ticks, toast churn, other mints' wallet activity).
export const PriceChart = memo(function PriceChart({
  token,
  ohlc,
  timeframe,
  onTimeframeChange,
  rebuildEpoch = 0,
  onInstantTradeClick,
  instantTradeOpen,
  candles,
  walletActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  devActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  selfActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  claimActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  sniperActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  bundlerActivityEvents = EMPTY_WALLET_ACTIVITY_EVENTS,
  solUsd = null,
  totalSupplyBaseUnits = null,
  graduatedAtMs = null,
  coinCalls = EMPTY_COIN_CALLS,
  recentTrades = EMPTY_RECENT_TRADES,
  walletLabelByAddress = EMPTY_WALLET_LABELS,
  walletEmojiByAddress = EMPTY_WALLET_EMOJIS,
  selectedCandle = null,
  onCandleClick,
  onNeedOlderCandles,
  hasMoreOlderCandles = false,
  loadingOlderCandles = false,
  emptyMessage = null,
  loading = false,
  isStub,
  valueScale = 1,
  displayUnit = 'USD',
  displayMode = 'MarketCap',
  avgEntryUsdMc = null,
  avgExitUsdMc = null,
  alerts = EMPTY_CHART_ALERTS,
  migrationUsdMc = null,
  onSetAlert,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const walletBubblesRef = useRef<WalletChartBubbles | null>(null);
  // Live ref the bubble primitive reads its y anchors from (candle highs).
  const chartCandlesRef = useRef<CandlestickData<Time>[]>([]);
  const dataRangeRef = useRef<PriceRange | null>(null);
  const seriesSigRef = useRef<CandleSeriesSig | null>(null);
  const autoFollowRef = useRef(true);
  const tokenMintRef = useRef(token.mintAddress);
  /* Programmatic range mutations (setData, timeframe reset, auto button) fire
     the library's range-change callback asynchronously — sometimes on the
     NEXT frame. The old boolean-cleared-on-setTimeout(0) raced that delivery,
     so the chart's own mutation was misread as a user pan, auto-follow
     silently latched off, and the next history prepend left the viewport
     stranded deep in the past (the "chart opens scrolled way left" bug).
     A deadline tolerates late delivery deterministically. */
  const suppressRangeChangeUntilRef = useRef(0);
  const walletMarkerHoverByTimeRef = useRef<Map<number, WalletMarkerBucketHover>>(new Map());
  // Ascending bucket times paired with the hover map — the hit-test's
  // binary-search index (see hitTestBubbleStack).
  const walletMarkerBucketTimesRef = useRef<number[]>([]);
  const onCandleClickRef = useRef<Props['onCandleClick']>(onCandleClick);
  const onNeedOlderCandlesRef = useRef<Props['onNeedOlderCandles']>(onNeedOlderCandles);
  const hasMoreOlderCandlesRef = useRef(hasMoreOlderCandles);
  const loadingOlderCandlesRef = useRef(loadingOlderCandles);
  const [logScale, setLogScale] = useState(false);
  /** The one trade the pointer is on. */
  const [markerCard, setMarkerCard] = useState<{
    x: number;
    y: number;
    at: string;
    entry: WalletMarkerTooltipEntry;
  } | null>(null);
  /*
   * ── CLICKING THE COUNT OPENS THE CANDLE ──────────────────────────
   *
   * A candle with several trades draws one white `N+` disc. Pressing it
   * unpacks that candle into its own discs, stacked; pressing anywhere
   * else packs it back. Only one candle is ever open, so the pane never
   * grows two walls at once.
   */
  const [openBucketSec, setOpenBucketSec] = useState<number | null>(null);
  /* Pulled from theme so chart axis labels track the active mono font. */
  const { mono } = useTheme();
  // Markers depend on the *set of bucket times*, never on OHLCV. A pure last-bar mutation
  // (the dominant live-trade event) leaves the time-set unchanged, so key `candleTimes` off
  // the cheap endpoints+length signature and reuse the array — avoiding a ~5k-element
  // map+sort (and a full marker rebuild) on every trade. `candles` is already ascending, so
  // no sort is needed.
  const candleTimesKey = candles && candles.length > 0
    ? `${Number(candles[0].time)}:${Number(candles[candles.length - 1].time)}:${candles.length}`
    : 'empty';
  const candleTimes = useMemo(
    () => (candles && candles.length > 0 ? candles.map((candle) => Number(candle.time)) : EMPTY_CANDLE_TIMES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candleTimesKey],
  );
  // Candles arrive in USD-market-cap scale; multiply into the displayed
  // scale once here so every consumer (series data, bubble y anchors via
  // chartCandlesRef, wheel-zoom price range) agrees with the axis.
  // Incremental: `candles` identity churns per canonical candle event, so
  // a naive full remap re-allocated up to ~5k bars every ~400ms in SOL and
  // Price modes; the cache reuses the scaled prefix on tail-only changes.
  const scaledCacheRef = useRef<ScaledCandlesCache | null>(null);
  const scaledCandles = useMemo<CandlestickData<Time>[]>(() => {
    if (!candles || candles.length === 0) {
      scaledCacheRef.current = null;
      return EMPTY_SCALED_CANDLES;
    }
    if (valueScale === 1) {
      scaledCacheRef.current = null;
      return candles;
    }
    const cache = scaleCandlesForDisplay(
      candles,
      valueScale,
      token.mintAddress,
      timeframe,
      rebuildEpoch,
      scaledCacheRef.current,
    );
    scaledCacheRef.current = cache;
    return cache.scaled;
  }, [candles, valueScale, token.mintAddress, timeframe, rebuildEpoch]);
  const valueScaleRef = useRef(valueScale);
  valueScaleRef.current = valueScale;
  // SOL price rides a ref, never the marker-model memo deps: it only feeds
  // the hover card's USD figures (converted at tooltip-build time), and as
  // a memo dep the wobbling Pyth float rebuilt the whole model + repainted
  // the pane on every snapshot frame with zero visual change.
  const solUsdRef = useRef(solUsd);
  solUsdRef.current = solUsd;
  /* The chart's handlers are bound once, so the open candle and the
     candle series reach them through refs rather than the closure. */
  const openBucketSecRef = useRef<number | null>(null);
  openBucketSecRef.current = openBucketSec;
  const candlesForCardRef = useRef(candles);
  candlesForCardRef.current = candles;
  const recentTradeBySignature = useMemo(
    () => new Map(recentTrades.map((trade) => [trade.signature, trade])),
    [recentTrades],
  );
  // The tape map is consulted only at model-build time, so it rides a ref
  // instead of the memo deps: the tape's identity churns on EVERY SSE
  // trade, and any trade that can move a bubble also changes one of the
  // event streams' key-sets (same wallet), which rebuilds the model with
  // the then-current map. Non-bubble trades change neither.
  const recentTradeBySignatureRef = useRef(recentTradeBySignature);
  recentTradeBySignatureRef.current = recentTradeBySignature;
  const walletTradeMarkerModel = useMemo(
    () =>
      buildWalletTradeMarkerModel(
        walletActivityEvents,
        devActivityEvents,
        selfActivityEvents,
        claimActivityEvents,
        sniperActivityEvents,
        bundlerActivityEvents,
        timeframe,
        candleTimes,
        recentTradeBySignatureRef.current,
        walletLabelByAddress,
        walletEmojiByAddress,
        totalSupplyBaseUnits,
        graduatedAtMs,
        openBucketSec,
      ),
    [
      candleTimes,
      devActivityEvents,
      selfActivityEvents,
      claimActivityEvents,
      sniperActivityEvents,
      bundlerActivityEvents,
      timeframe,
      walletActivityEvents,
      walletLabelByAddress,
      walletEmojiByAddress,
      totalSupplyBaseUnits,
      graduatedAtMs,
      openBucketSec,
    ],
  );

  useEffect(() => {
    walletMarkerHoverByTimeRef.current = walletTradeMarkerModel.hoverByTime;
    walletMarkerBucketTimesRef.current = walletTradeMarkerModel.bucketTimes;
    if (walletTradeMarkerModel.hoverByTime.size === 0) {
      setMarkerCard(null);
      setOpenBucketSec(null);
    }
  }, [walletTradeMarkerModel.hoverByTime, walletTradeMarkerModel.bucketTimes]);

  /* ── Thesis bubbles (coin calls) ─────────────────────────────────
     Calls snap to a loaded candle bucket exactly like wallet markers;
     a call whose time falls outside the loaded history stays hidden
     until the user scrolls that history in. Same-bucket calls stack. */
  const thesisMarkers = useMemo(() => {
    if (coinCalls.length === 0 || candleTimes.length === 0) return EMPTY_THESIS_MARKERS;
    // Oldest-first so stacking order is deterministic across renders.
    const sorted = [...coinCalls].sort(
      (a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id),
    );
    const countByTime = new Map<number, number>();
    const out: ThesisMarker[] = [];
    for (const call of sorted) {
      const timeSec = findMarkerCandleTime(call.createdAtMs, timeframe, candleTimes);
      if (timeSec == null) continue;
      const stackIndex = countByTime.get(timeSec) ?? 0;
      countByTime.set(timeSec, stackIndex + 1);
      out.push({ call, timeSec, stackIndex });
    }
    return out;
  }, [coinCalls, candleTimes, timeframe]);
  const thesisMarkersRef = useRef(thesisMarkers);
  const thesisPillRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const thesisPopoverRef = useRef<HTMLDivElement | null>(null);
  const [openThesisId, setOpenThesisId] = useState<string | null>(null);
  const openThesisIdRef = useRef<string | null>(null);
  openThesisIdRef.current = openThesisId;
  /** Wakes the thesis position loop (set by the loop effect below). */
  const thesisActivityRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    thesisMarkersRef.current = thesisMarkers;
    // A call that left the model (mint switch, feed churn) must not leave
    // a detached popover behind.
    if (openThesisIdRef.current && !thesisMarkers.some((m) => m.call.id === openThesisIdRef.current)) {
      setOpenThesisId(null);
    }
    // New/changed markers need (re)positioning even on an otherwise-idle
    // chart — wake the position loop.
    thesisActivityRef.current?.();
  }, [thesisMarkers]);

  /* Position loop: pill (and popover) transforms are written imperatively
     per animation frame WHILE THE CHART CAN MOVE. Event subscriptions alone
     can't drive the writes — price-scale autoscale moves the y anchor with
     NO lightweight-charts event, and `shiftVisibleRangeOnNewBar` moves x on
     every live bucket — but every movement has an observable TRIGGER: a
     visible-range change (pan/zoom/kinetic/new bar), a data update
     (autoscale), a pointer interaction (price-axis drag), a container
     resize, or a marker/popover state change. Each trigger arms a short
     activity window; the loop runs at rAF cadence inside the window and
     fully idles otherwise (a perpetual rAF forced frame scheduling for the
     whole session on any coin with an alpha call). Writes stay diffed via a
     WeakMap keyed on the ELEMENT, so a remounted pill/popover (new object,
     no cache entry) is always written — no per-frame cache eviction. */
  const hasThesisMarkers = thesisMarkers.length > 0;
  useEffect(() => {
    if (!hasThesisMarkers) return undefined;
    const THESIS_ACTIVE_WINDOW_MS = 500;
    let raf = 0;
    let activeUntil = 0;
    let subscribedChart: typeof chartRef.current = null;
    const lastWritten = new WeakMap<HTMLElement, string>();
    function markActive(): void {
      activeUntil = performance.now() + THESIS_ACTIVE_WINDOW_MS;
      if (raf === 0) raf = requestAnimationFrame(step);
    }
    function step(): void {
      raf = 0;
      if (performance.now() > activeUntil) return; // idle until the next trigger
      raf = requestAnimationFrame(step);
      const chart = chartRef.current;
      const series = seriesRef.current;
      const container = containerRef.current;
      if (!chart || !series || !container) return;
      // Lazy range subscription: the chart instance may not exist on the
      // effect's first run (or is recreated); attach once it does. Range
      // changes then cover pan, zoom, kinetic momentum and new-bar shifts.
      if (subscribedChart !== chart) {
        try {
          subscribedChart?.timeScale().unsubscribeVisibleTimeRangeChange(markActive);
        } catch { /* stale instance already disposed */ }
        chart.timeScale().subscribeVisibleTimeRangeChange(markActive);
        subscribedChart = chart;
      }
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return; // hidden pane: nothing to place
      let openAnchor: { x: number; y: number } | null = null;
      for (const marker of thesisMarkersRef.current) {
        const el = thesisPillRefs.current.get(marker.call.id);
        if (!el) continue;
        const x = chart.timeScale().timeToCoordinate(marker.timeSec as Time);
        let css: string | null = null;
        if (x != null && x >= 0 && x <= width && height > 60) {
          const rawY =
            marker.call.marketCapUsd != null
              ? series.priceToCoordinate(marker.call.marketCapUsd * valueScaleRef.current)
              : null;
          // Clamp inside the pane (below the OHLC strip, above the axis) so
          // an off-scale anchor still shows a reachable pill.
          const anchorY = Math.min(Math.max(rawY ?? 34, 34), height - 24)
            - marker.stackIndex * 26;
          // Pill hangs ABOVE the anchor point; the CSS stem drops back to it.
          css = `translate(${Math.round(x)}px, ${Math.round(anchorY - 9)}px) translate(-50%, -100%)`;
          if (marker.call.id === openThesisIdRef.current) {
            openAnchor = { x, y: anchorY };
          }
        }
        const next = css ?? 'none';
        if (lastWritten.get(el) !== next) {
          lastWritten.set(el, next);
          if (css == null) {
            el.style.display = 'none';
          } else {
            el.style.display = '';
            el.style.transform = css;
          }
        }
        const expanded = marker.call.id === openThesisIdRef.current ? 'true' : 'false';
        if (el.getAttribute('aria-expanded') !== expanded) el.setAttribute('aria-expanded', expanded);
      }
      // Popover cache is keyed on the element too: a closed popover
      // unmounts, and the reopened one is a fresh element with no cache
      // entry — the transform write can never be skipped on remount.
      const pop = thesisPopoverRef.current;
      if (pop) {
        if (openAnchor == null) {
          if (pop.style.display !== 'none') {
            pop.style.display = 'none';
            lastWritten.delete(pop);
          }
        } else {
          const popW = pop.offsetWidth || 264;
          const popH = pop.offsetHeight || 150;
          const px = Math.min(Math.max(openAnchor.x, popW / 2 + 6), Math.max(width - popW / 2 - 6, popW / 2 + 6));
          // Below the anchor when it fits, else flipped above the pill.
          const below = openAnchor.y + 10;
          const py = below + popH > height - 6 ? Math.max(openAnchor.y - 44 - popH, 6) : below;
          const css = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, 0)`;
          if (lastWritten.get(pop) !== css) {
            lastWritten.set(pop, css);
            pop.style.display = '';
            pop.style.transform = css;
          }
        }
      }
    }
    // Movement triggers beyond the range subscription (attached lazily in
    // step): pointer interactions cover price-axis drags and wheel zooms
    // (which change the y mapping with no range event), the resize observer
    // covers pane/layout resizes, and the ref hands marker/popover state
    // effects (and the data effect — autoscale moves y on new data with no
    // event) a way to wake the loop.
    const container = containerRef.current;
    const onPointer = () => markActive();
    container?.addEventListener('pointerdown', onPointer, { passive: true });
    container?.addEventListener('pointermove', onPointer, { passive: true });
    container?.addEventListener('wheel', onPointer, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => markActive())
      : null;
    if (container && resizeObserver) resizeObserver.observe(container);
    thesisActivityRef.current = markActive;
    markActive();
    return () => {
      thesisActivityRef.current = null;
      if (raf !== 0) cancelAnimationFrame(raf);
      try {
        subscribedChart?.timeScale().unsubscribeVisibleTimeRangeChange(markActive);
      } catch { /* chart already disposed */ }
      container?.removeEventListener('pointerdown', onPointer);
      container?.removeEventListener('pointermove', onPointer);
      container?.removeEventListener('wheel', onPointer);
      resizeObserver?.disconnect();
    };
  }, [hasThesisMarkers]);

  /* Click-away + Escape close for the thesis popover. */
  useEffect(() => {
    // Open/close changes pill aria-expanded + popover placement — wake the
    // position loop (a keyboard close has no pointer event to arm it).
    thesisActivityRef.current?.();
    if (openThesisId == null) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (thesisPopoverRef.current?.contains(target)) return;
      for (const el of thesisPillRefs.current.values()) {
        if (el?.contains(target)) return;
      }
      setOpenThesisId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenThesisId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openThesisId]);

  const openThesisMarker =
    openThesisId != null
      ? thesisMarkers.find((m) => m.call.id === openThesisId) ?? null
      : null;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#a8aeba',
        fontFamily: mono.stack,
        fontSize: 11,
        attributionLogo: false,
      },
      /* 0.03 was a grid you had to look for to find. The board's own
         hairline is 0.09 against black, and a chart is the one surface
         where the ruling is doing real work — it is how a candle's
         height is read at all. */
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.09)' },
        horzLines: { color: 'rgba(255,255,255,0.09)' },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.14)',
        timeVisible: true,
        secondsVisible: true,
        // 7E: fixed candle width + right padding so a sparse fresh
        // mint (~6-14 1s bars) doesn't get stretched across the
        // viewport. With `barSpacing: 8` and a typical 800-1500px
        // chart width, ~100-180 logical bars fit; sparse data
        // clusters near the right edge with empty space to its
        // left, exactly matching the Axiom-like dense-tape feel.
        /* 4, down from 8. At 8 a fresh mint filled the pane with about
           twenty enormous candles and you had to zoom out before the
           shape of the move was readable at all. Half the width fits
           roughly twice the tape, which is the view you actually open
           the chart to see. */
        barSpacing: 7,
        rightOffset: 12,
        // Default `shiftVisibleRangeOnNewBar: true` keeps the
        // latest bar in view as new buckets arrive.
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.14)', mode: 0 },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      /* White, not cyan. The crosshair is a measuring line — it says
         where the pointer is, not what anything is worth — and a
         saturated hue there reads as a value on a surface where every
         other colour means up or down. */
      crosshair: {
        mode: 0,
        vertLine: {
          color: 'rgba(255,255,255,0.55)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#101318',
        },
        horzLine: {
          color: 'rgba(255,255,255,0.55)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#101318',
        },
      },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c77e',
      downColor: '#f0567a',
      wickUpColor: '#22c77e',
      wickDownColor: '#f0567a',
      borderVisible: false,
      priceFormat: {
        type: 'custom',
        minMove: 0.01,
        formatter: (p: number) => fmtK(p),
      },
    });
    // Tracked-wallet trade bubbles: custom primitive (emoji centered
    // inside a green/red disc) — the built-in series markers can only
    // put text NEXT to a shape.
    const walletBubbles = new WalletChartBubbles(chartCandlesRef);
    series.attachPrimitive(walletBubbles);

    // 7E: removed `chart.timeScale().fitContent()` — the fixed
    // `barSpacing` + `rightOffset` combo plus the post-setData
    // visible-range adjustment in the data effect below give a
    // consistent layout for both mock and sparse-real series. A
    // global `fitContent` here would scale bars to fill the
    // viewport, which is exactly what we don't want for fresh
    // mints with only ~6-14 candles.

    chartRef.current = chart;
    seriesRef.current = series;
    walletBubblesRef.current = walletBubbles;

    const handleVisibleRangeChange = (logicalRange: { from: number; to: number } | null) => {
      // History paging is not a user gesture: it must fire even during
      // the post-setData suppression window, otherwise the initial page
      // of a short-history coin never triggers the older-candles load.
      if (
        logicalRange &&
        logicalRange.from <= LEFT_EDGE_LOAD_THRESHOLD &&
        hasMoreOlderCandlesRef.current &&
        !loadingOlderCandlesRef.current
      ) {
        onNeedOlderCandlesRef.current?.();
      }
      // Only the auto-follow latch belongs behind the suppression: the
      // programmatic range change must not read as the user scrolling.
      if (performance.now() < suppressRangeChangeUntilRef.current) return;
      autoFollowRef.current = false;
    };
    // Bubble hover is a GEOMETRIC hit-test against the rendered discs
    // (x within the disc radius of the bucket's coordinate, y inside the
    // stack's band), not the library's bar-time snap: `param.time` only
    // resolves inside a bar's ~8px logical column, which made a 20px
    // bubble need pixel-perfect cursor placement (live repro).
    const BUBBLE_HIT_SLACK_PX = 6;
    // Shared by hover and click: which bucket's rendered stack is under
    // the cursor, and which disc within it (stackIndex 0 = closest to the
    // candle). Bubbles are drawn with centers at
    // anchorY - ANCHOR_GAP_PX - BUBBLE_RADIUS - i * STACK_STEP_PX.
    const hitTestBubbleStack = (point: {
      x: number;
      y: number;
    }): { bucket: WalletMarkerBucketHover; stackIndex: number } | null => {
      const hover = walletMarkerHoverByTimeRef.current;
      if (hover.size === 0) return null;
      const timeScale = chart.timeScale();
      const candles = chartCandlesRef.current;
      // Only buckets whose x-coordinate lands within the hit radius can
      // ever pass the dx check below, and coordinate is monotonic in
      // bucket time (index-linear) — so binary-search the sorted bucket
      // times with timeToCoordinate as the comparator instead of walking
      // every bucket per pointer event. coordinateToTime is deliberately
      // NOT used: it nulls in the whitespace beyond the first/last bar,
      // exactly where edge buckets must still hit-test. Bucket times
      // always exist as chart points, so their coordinates never null
      // (null only when the series is empty — then no bucket can hit).
      const bucketTimes = walletMarkerBucketTimesRef.current;
      const maxDx = BUBBLE_RADIUS + BUBBLE_HIT_SLACK_PX;
      let searchLo = 0;
      let searchHi = bucketTimes.length;
      while (searchLo < searchHi) {
        const mid = (searchLo + searchHi) >> 1;
        const midX = timeScale.timeToCoordinate(bucketTimes[mid]! as Time);
        if (midX !== null && midX >= point.x - maxDx) searchHi = mid;
        else searchLo = mid + 1;
      }
      const from = searchLo;
      searchHi = bucketTimes.length;
      while (searchLo < searchHi) {
        const mid = (searchLo + searchHi) >> 1;
        const midX = timeScale.timeToCoordinate(bucketTimes[mid]! as Time);
        if (midX !== null && midX <= point.x + maxDx) searchLo = mid + 1;
        else searchHi = mid;
      }
      const to = searchLo;
      let best: { bucket: WalletMarkerBucketHover; stackIndex: number; dist: number } | null =
        null;
      for (let i = from; i < to; i += 1) {
        const timeSec = bucketTimes[i]!;
        const bucket = hover.get(timeSec);
        if (!bucket || bucket.totalCount === 0) continue;
        const x = timeScale.timeToCoordinate(timeSec as Time);
        if (x === null) continue;
        const dx = Math.abs(x - point.x);
        if (dx > BUBBLE_RADIUS + BUBBLE_HIT_SLACK_PX) continue;
        const high = highAtTime(candles, timeSec);
        if (high === null) continue;
        const anchorY = series.priceToCoordinate(high);
        if (anchorY === null) continue;
        // Band height tracks the RENDERED stack, which is capped — an
        // overflowing bucket draws at most MAX_BUBBLES_PER_BUCKET discs.
        const renderedCount = Math.min(bucket.totalCount, MAX_BUBBLES_PER_BUCKET);
        const bottom = anchorY - ANCHOR_GAP_PX + BUBBLE_HIT_SLACK_PX;
        const top =
          anchorY -
          ANCHOR_GAP_PX -
          2 * BUBBLE_RADIUS -
          (renderedCount - 1) * STACK_STEP_PX -
          BUBBLE_HIT_SLACK_PX;
        if (point.y < top || point.y > bottom) continue;
        const firstCenterY = anchorY - ANCHOR_GAP_PX - BUBBLE_RADIUS;
        const stackIndex = Math.min(
          renderedCount - 1,
          Math.max(0, Math.round((firstCenterY - point.y) / STACK_STEP_PX)),
        );
        if (!best || dx < best.dist) best = { bucket, stackIndex, dist: dx };
      }
      return best ? { bucket: best.bucket, stackIndex: best.stackIndex } : null;
    };
    const handleCrosshairMove = (
      param: Parameters<IChartApi['subscribeCrosshairMove']>[0] extends (arg: infer P) => void
        ? P
        : never,
    ) => {
      const point = param.point;
      const host = containerRef.current;
      if (!point) {
        walletBubblesRef.current?.setHovered(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        if (host) host.style.cursor = '';
        setMarkerCard(null);
        return;
      }
      /* The primitive owns where each disc landed, so it does the
         lighting and tells us whether one is under the pointer — that
         same answer is the cursor. */
      /* The disc's own centre, not the pointer's — see `setHovered`. */
      const disc = walletBubblesRef.current?.setHovered(point.x, point.y) ?? null;
      if (host) host.style.cursor = disc ? 'pointer' : '';
      /*
       * ── THE CARD BELONGS TO A DISC ─────────────────────────────
       *
       * `hitTestBubbleStack` answers by BAND — the column of pixels a
       * candle's stack occupies — so it says yes in the gaps between
       * discs too. The card then fell back to the crosshair for its
       * position, and that is why it slid around under the pointer.
       *
       * No disc under the cursor, no card. The anchor is then always a
       * disc's own centre, so the card is nailed to the mark and cannot
       * move until the pointer is on a different one.
       */
      if (!disc) {
        setMarkerCard(null);
        return;
      }
      const hit = hitTestBubbleStack(point);
      if (!hit) {
        setMarkerCard(null);
        return;
      }
      /* A packed candle draws the white count and nothing else — there
         is no single trade under the pointer to describe, so nothing is
         said until it is opened. */
      const packed = hit.bucket.totalCount > MAX_BUBBLES_PER_BUCKET && !openBucketSecRef.current;
      const entry = packed ? null : hit.bucket.entries[hit.stackIndex];
      if (!entry) {
        setMarkerCard(null);
        return;
      }
      // USD figures resolve here with the SOL price current at hover
      // time, so the model never rebuilds on a Pyth wobble.
      const solUsdNow = solUsdRef.current;
      /*
       * The card is placed, not just offset. A bubble near the bottom of
       * the pane put the card half under the footer, and one near the
       * right edge put it under the price axis — both are common, since
       * bubbles sit on the candles and the candles fill the pane.
       */
      const box = containerRef.current;
      const paneW = box?.clientWidth ?? 0;
      const paneH = box?.clientHeight ?? 0;
      /*
       * ── ONE COORDINATE SPACE ───────────────────────────────────
       *
       * The cards render INSIDE the `ui-scale-exempt` pane, alongside
       * the canvas and the thesis bubbles, so a crosshair coordinate is
       * a card coordinate and there is nothing to convert.
       *
       * They used to sit outside it. That wrapper runs at the app's UI
       * zoom while the chart pane deliberately cancels it — the chart
       * needs pixel-exact hit testing — so every anchor arrived 18%
       * further right and down than the mark it belonged to, which grew
       * with distance from the top left corner and looked like a tuning
       * problem rather than a unit mismatch.
       */
      const claim = entry.claim === true;
      const CARD_W = 178;
      const CARD_H = 118;
      const anchor = disc;
      /*
       * The claim's line ENDS ON ITS OWN BUBBLE. Its trailing disc is
       * drawn at the same size and colour as the mark on the chart, so
       * placing that disc over the bubble makes the sentence read out of
       * the mark itself rather than float beside it — which is how every
       * other terminal does this, and why the first attempt at 16px of
       * clearance looked thrown across the pane.
       *
       * `DISC_INSET` is that disc's centre measured from the pill's right
       * edge: 5px of padding plus half of a 20px disc.
       */
      /*
       * ── THE CARD HANGS OFF THE MARK ────────────────────────────
       *
       * Two things were putting daylight between them. The gap was
       * measured from the disc's CENTRE, so `radius + 4` left four
       * pixels of clearance and looked like more; and the card was
       * CENTRED on the disc, which pushed its whole body up and away so
       * that the nearest corner was the only thing anywhere near the
       * mark.
       *
       * Now it touches: one pixel off the disc's edge, and its top edge
       * level with the disc's top, so the corner sits on the mark and
       * the card reads as coming out of it.
       */
      const GAP = BUBBLE_RADIUS + 1;
      /*
       * The claim pill is placed AT the bubble and pulled back by its own
       * width in CSS (`translate(calc(-100% + 15px), -50%)`), so its
       * trailing disc lands exactly on the mark. Measuring the width here
       * would mean guessing it — the sentence changes with the amount and
       * the wallet, and a guess of 208 put the disc forty pixels wide of
       * the bubble.
       */
      const x =
        (claim
          ? anchor.x
          : paneW > 0 && anchor.x + GAP + CARD_W > paneW - 6
            ? Math.max(6, anchor.x - GAP - CARD_W)
            : anchor.x + GAP);
      const y =
        (claim
          ? anchor.y
          : Math.min(
              Math.max(6, anchor.y - BUBBLE_RADIUS),
              Math.max(6, paneH - CARD_H - 6),
            ));
      setMarkerCard({
        x,
        y,
        at: markerWhen(hit.bucket.timeSec, candlesForCardRef.current),
        entry: { ...entry, ...tooltipUsdFigures(entry.stats, solUsdNow) },
      });
    };
    const handleClick = (
      param: Parameters<IChartApi['subscribeClick']>[0] extends (arg: infer P) => void ? P : never,
    ) => {
      /*
       * A packed candle's white count OPENS that candle. An individual
       * disc opens its wallet's dossier. A click anywhere else on the
       * pane packs whatever was open back up, so the pane returns to one
       * mark per candle without hunting for the disc again.
       */
      const point = param.point;
      if (point) {
        const hit = hitTestBubbleStack(point);
        if (hit) {
          const { bucket, stackIndex } = hit;
          const packed = bucket.totalCount > MAX_BUBBLES_PER_BUCKET && openBucketSecRef.current !== bucket.timeSec;
          if (packed) {
            setOpenBucketSec(bucket.timeSec);
            setMarkerCard(null);
            return;
          }
          const wallet = bucket.entries[stackIndex]?.wallet ?? null;
          if (wallet) openWalletProfile(wallet);
          return;
        }
        setOpenBucketSec(null);
      }
      if (typeof param.time !== 'number') return;
      onCandleClickRef.current?.(param.time);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleClick);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.unsubscribeClick(handleClick);
      try {
        series.detachPrimitive(walletBubbles);
      } catch {
        // chart may already be tearing down
      }
      chartRef.current = null;
      seriesRef.current = null;
      walletBubblesRef.current = null;
      scheduleChartRemoval(chart);
    };
    /* `mono.stack` is read on first creation; subsequent theme changes are
       applied through the dedicated effect below. Listing it here would
       tear down + rebuild the chart on every theme switch. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onCandleClickRef.current = onCandleClick;
  }, [onCandleClick]);

  useEffect(() => {
    onNeedOlderCandlesRef.current = onNeedOlderCandles;
    hasMoreOlderCandlesRef.current = hasMoreOlderCandles;
    loadingOlderCandlesRef.current = loadingOlderCandles;
  }, [hasMoreOlderCandles, loadingOlderCandles, onNeedOlderCandles]);

  useEffect(() => {
    const el = containerRef.current;
    const chart = chartRef.current;
    if (!el || !chart) return;

    // rAF-coalesced: wheel fires 30-100+/sec and each setVisibleRange forces
    // a synchronous relayout+repaint, so applying per event burned several
    // full repaints per displayed frame on busy mints. Factors accumulate
    // multiplicatively and apply ONCE per frame — the exact zoom a burst of
    // sequential applications would have produced, painted on the same
    // vsync it would have appeared on anyway (no added latency).
    let pendingFactor = 1;
    let rafId: number | null = null;
    const applyPendingZoom = () => {
      rafId = null;
      const factor = pendingFactor;
      pendingFactor = 1;
      if (factor === 1) return;
      const priceScale = chart.priceScale('right');
      const current = priceScale.getVisibleRange() ?? dataRangeRef.current;
      if (!current) return;

      const center = (current.from + current.to) / 2;
      const rawSpan = current.to - current.from;
      if (!Number.isFinite(rawSpan) || rawSpan <= 0) return;
      // Clamp RELATIVE to the range's own magnitude: absolute floors
      // (span>=1, 1e-6) exploded Price-mode charts whose whole range is
      // ~1e-7 into a flat line at the first wheel tick.
      const minSpan = Math.max(Math.abs(center) * 1e-6, Number.MIN_VALUE);
      const nextSpan = Math.max(rawSpan * factor, minSpan);
      priceScale.setAutoScale(false);
      priceScale.setVisibleRange({
        from: center - nextSpan / 2,
        to: center + nextSpan / 2,
      });
    };

    const onWheel = (event: WheelEvent) => {
      const priceScale = chart.priceScale('right');
      const rect = el.getBoundingClientRect();
      const priceScaleWidth = priceScale.width();
      const onRightPriceScale =
        priceScaleWidth > 0 && event.clientX >= rect.right - priceScaleWidth;
      if (!onRightPriceScale) return;

      event.preventDefault();
      pendingFactor *= event.deltaY < 0 ? 0.85 : 1.15;
      if (rafId === null) rafId = window.requestAnimationFrame(applyPendingZoom);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  /**
   * 7D-1 / 7E: feed real backend candles whenever the prop changes.
   * When `candles` is present, swap the series data
   * and clear the mock-aligned markers (their indices don't map
   * to real bucket timestamps). An empty array is a real loaded
   * empty state; only `undefined` falls back to mocks during initial
   * loading / errors / flag-off mode.
   *
   * 7E: visible-range strategy. We deliberately do NOT call
   * `fitContent` (which stretches a tiny dataset across the whole
   * viewport — exactly the bug we fixed in 7E). Instead:
   *
   *   - A bounded logical window prevents sparse fresh mints from
   *     being shoved into a tiny cluster at the far right.
   *   - On mint/timeframe changes we force the latest window. Within
   *     a single coin, the library's default
   *     `shiftVisibleRangeOnNewBar` keeps the newest bar in view as
   *     buckets land — no need to fight the user's pan/zoom.
   */
  useEffect(() => {
    // Data changes move the thesis pills' anchors (new bars shift x, and
    // autoscale re-maps y with no chart event) — wake the position loop.
    thesisActivityRef.current?.();
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    // Real data only — no synthetic/mock fallback. Until candles exist the
    // series is genuinely empty and the chart shows its loading/empty overlay
    // (driven by `emptyMessage`), never fabricated bars.
    const data = scaledCandles;
    // Keep the bubble primitive's y-anchor source current on every path
    // (fast last-bar mutation AND full setData).
    chartCandlesRef.current = data;
    const len = data.length;
    const prev = seriesSigRef.current;
    const tokenChanged = tokenMintRef.current !== token.mintAddress;
    const firstTime = len > 0 ? Number(data[0].time) : Number.NaN;
    const lastTime = len > 0 ? Number(data[len - 1].time) : Number.NaN;
    const lastBar = len > 0 ? data[len - 1] : null;
    const prevTailTime = len >= 2 ? Number(data[len - 2].time) : null;
    const prevTailBar = len >= 2 ? data[len - 2] : null;

    // Fast path: the live-trade common case is a same-bucket OHLCV mutation or a single
    // new bucket appended at the tail. Both can be applied with an O(1) `series.update`
    // instead of rebuilding up to ~5k bars with `series.setData` on every trade. Every
    // other shape — mint switch, timeframe switch, `loadOlder` prepend, out-of-order, the
    // retroactive spike-filter dropping a bar, first paint — must fall back to `setData`.
    const stable = prev != null
      && !tokenChanged
      && prev.timeframe === timeframe
      && prev.rebuildEpoch === rebuildEpoch
      && prev.scale === valueScale
      && prev.length > 0
      && len > 0
      && firstTime === prev.firstTime;
    const canMutateLast = stable
      && len === prev!.length
      && lastTime === prev!.lastTime
      && prev!.prevTailTime === prevTailTime;
    const canAppendOne = stable
      && len === prev!.length + 1
      && lastTime > prev!.lastTime
      && Number(data[len - 2].time) === prev!.lastTime
      && sameBar(data[len - 2], prev!.lastBar); // prev tail survived unchanged (spike fence)

    if ((canMutateLast || canAppendOne) && lastBar != null) {
      // The fences only prove the SHAPE held: the previous pass left TWO
      // mutable bars (its tip + the bar behind it, e.g. a canonical bar
      // replacing its provisional values in the same pass), and
      // `series.update(lastBar)` alone would drop a revision of the second
      // one until the next full setData. canAppendOne's sameBar fence covers
      // prev's tip (now data[len-2]); the OTHER mutable bar — prev's len-2,
      // sitting at data[len-2] on mutate-last and data[len-3] on append-one
      // — is diffed against prev.prevTailBar here and re-pushed if revised.
      const revisedIdx = canMutateLast ? len - 2 : len - 3;
      const revisedCandidate = revisedIdx >= 0 ? data[revisedIdx] : null;
      const revisedPrevTail =
        revisedCandidate != null
        && prev!.prevTailBar != null
        && Number(revisedCandidate.time) === Number(prev!.prevTailBar.time)
        && !sameBar(revisedCandidate, prev!.prevTailBar)
          ? revisedCandidate
          : null;
      if (revisedPrevTail != null) series.update(revisedPrevTail, true);
      series.update(lastBar);
      // O(1) price-range widening (the range is only a wheel-zoom fallback, so monotonic
      // widening is fine); a full rescan happens on the setData branch.
      const low = revisedPrevTail == null
        ? lastBar.low
        : Math.min(lastBar.low, revisedPrevTail.low);
      const high = revisedPrevTail == null
        ? lastBar.high
        : Math.max(lastBar.high, revisedPrevTail.high);
      const range = dataRangeRef.current;
      dataRangeRef.current = range != null
        ? { from: Math.min(range.from, low), to: Math.max(range.to, high) }
        : dataPriceRange(data);
      // autoFollow is handled by the chart's `shiftVisibleRangeOnNewBar`; deliberately do
      // not touch the visible range here so a panned user isn't yanked back.
    } else {
      if (tokenChanged) {
        tokenMintRef.current = token.mintAddress;
        autoFollowRef.current = true;
        // Every mint starts auto-positioned (operator feedback 7/7): a
        // manual price-axis drag or the gutter wheel-zoom disables
        // autoScale, and without this reset the PREVIOUS coin's price
        // range carries over — a 1M-mcap range on a 5k-mcap coin puts
        // the tape off-screen until the user repositions by hand.
        // Within one coin the user's manual scale still sticks.
        chart.priceScale('right').setAutoScale(true);
      }
      // Was the viewport showing the live edge of the PREVIOUS series?
      // Captured before setData: a prepend (history page landing under an
      // open chart) shifts every logical index right, so an unmoved range
      // suddenly addresses old candles. A user parked at the live edge must
      // be re-anchored after a prepend; a user who deliberately panned left
      // (loadOlder scrollback) must not be yanked.
      const prevVisibleRange = chart.timeScale().getVisibleLogicalRange();
      const wasAtLiveEdge =
        prev != null && prevVisibleRange != null && Number(prevVisibleRange.to) >= prev.length - 1;
      const prependedOlder =
        prev != null && len > 0 && prev.length > 0 && firstTime < prev.firstTime;
      suppressRangeChangeUntilRef.current = performance.now() + 150;
      dataRangeRef.current = len > 0 ? dataPriceRange(data) : null;
      // Navigation-latency marker: first real candles drawn for this mint
      // (fresh mount or mint switch). performance.mark is ~free and gives the
      // perf harness + prod devtools a precise "chart usable" timestamp.
      if (len > 0 && (prev == null || tokenChanged)) {
        performance.mark('trade:chart-first-data', { detail: { mint: token.mintAddress } });
      }
      series.setData(data);
      if (prependedOlder && wasAtLiveEdge) {
        // Full history arrived while watching the live edge: this is still
        // "following", even if a raced range-change event cleared the flag.
        autoFollowRef.current = true;
      }
      if (autoFollowRef.current) {
        // Prepends preserve the user's zoom: only a token change forces
        // the default window (forcing on live-edge prepends snapped a
        // zoomed-out viewer back to the default span).
        ensureLatestLogicalWindow(chart, data, timeframe, tokenChanged);
      }
    }

    seriesSigRef.current = len === 0 || lastBar == null
      ? null
      : {
          timeframe,
          rebuildEpoch,
          firstTime,
          lastTime,
          length: len,
          lastBar,
          prevTailTime,
          prevTailBar,
          scale: valueScale,
        };
  }, [scaledCandles, timeframe, token.mintAddress, valueScale, rebuildEpoch]);

  // `walletTradeMarkerModel.bubbles` is reference-stable unless the model actually
  // recomputed (its memo only re-runs when the candle time-set or events change), so keying
  // the effect on it alone — not on `candles` — avoids re-pushing identical bubbles on every
  // trade. The model already returns `[]` when there are no candle times.
  useEffect(() => {
    walletBubblesRef.current?.setBubbles(walletTradeMarkerModel.bubbles);
  }, [walletTradeMarkerModel.bubbles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    autoFollowRef.current = true;
    suppressRangeChangeUntilRef.current = performance.now() + 150;
    chart.timeScale().applyOptions(TIMEFRAME_OPTIONS[timeframe]);
    ensureLatestLogicalWindow(chart, scaledCandles, timeframe, true);
    // This effect is deliberately keyed only by timeframe. Regular
    // polling/data updates must not re-enable auto-follow after the
    // user has intentionally panned or zoomed away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      rightPriceScale: {
        mode: logScale ? 1 : 0,
        borderColor: 'rgba(255,255,255,0.06)',
      },
    });
  }, [logScale]);

  /* Re-apply font on theme change. Cheap operation — no chart rebuild. */
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({ layout: { fontFamily: mono.stack } });
  }, [mono.stack]);

  /* ── Canvas customization (chart settings dialog) ────────────────
     Every knob maps to a lightweight-charts applyOptions call, so
     edits preview live behind the dialog. */
  const chartStyle = useChartPrefsStore((s) => s.style);
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const { background, grid, crosshair, candle, axisText } = chartStyle;

    // Background: 'none' keeps the canvas transparent so the CSS backdrop
    // layer (patterns / theme) shows through; solid + gradient paint the
    // canvas itself.
    const bg =
      background.mode === 'solid'
        ? { type: ColorType.Solid, color: paintToRgba(background.solid) }
        : background.mode === 'gradient'
          ? {
              type: ColorType.VerticalGradient,
              topColor: paintToRgba(background.gradientTop),
              bottomColor: paintToRgba(background.gradientBottom),
            }
          : { type: ColorType.Solid, color: 'transparent' };

    const crosshairLineStyle = toLineStyle(crosshair.style);
    chart.applyOptions({
      layout: {
        background: bg,
        textColor: paintToRgba(axisText),
      },
      grid: {
        vertLines: {
          visible: grid.mode === 'both' || grid.mode === 'vert',
          color: paintToRgba(grid.vert),
          style: toLineStyle(grid.style),
        },
        horzLines: {
          visible: grid.mode === 'both' || grid.mode === 'horz',
          color: paintToRgba(grid.horz),
          style: toLineStyle(grid.style),
        },
      },
      crosshair: {
        vertLine: { color: paintToRgba(crosshair.paint), style: crosshairLineStyle },
        horzLine: { color: paintToRgba(crosshair.paint), style: crosshairLineStyle },
      },
    });

    series.applyOptions(candleSeriesOptions(candle));
  }, [chartStyle]);

  /* Pattern backdrop: a static CSS/SVG layer behind the transparent
     canvas (see chart-style.backdropCss). Zero per-frame cost — it never
     touches the render loop. Only meaningful when the canvas is 'none'
     (transparent); solid/gradient backgrounds paint over it, which is the
     expected precedence. */
  const backdrop = useMemo(() => backdropCss(chartStyle.backdrop), [chartStyle.backdrop]);

  /* Axis precision must track the displayed scale: Price mode plots
     sub-cent values, and the default 0.01 minMove would collapse every
     axis label onto the same rounded step. */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions({
      priceFormat: {
        type: 'custom',
        minMove: displayMode === 'Price' ? 1e-9 : 0.01,
        formatter: (p: number) => fmtK(p),
      },
    });
  }, [displayMode]);

  /* Ticker watermark behind the candles (settings toggle). */
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    watermarkRef.current?.detach();
    watermarkRef.current = null;
    const wm = chartStyle.watermark;
    if (!wm.show) return;
    const pane = chart.panes()[0];
    if (!pane) return;
    watermarkRef.current = createTextWatermark(pane, {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [
        {
          text: token.ticker,
          color: paintToRgba(wm.paint),
          fontSize: wm.size,
          fontStyle: 'bold',
        },
      ],
    });
    return () => {
      watermarkRef.current?.detach();
      watermarkRef.current = null;
    };
  }, [chartStyle.watermark, token.ticker]);

  /* ── Dotted reference lines: avg entry / avg exit / armed alerts ──
     Slim dotted horizontal price lines on the candle series. The levels
     drift on every snapshot tick while holding a position (avg entry/exit
     are re-derived with the live SOL price upstream), so the lines are kept
     alive across passes and MOVED with `applyOptions`; create/remove only
     happens when a line enters or leaves the wanted set. Levels arrive in
     USD-MC scale and are multiplied into the displayed scale here. */
  const refLinesRef = useRef<{
    series: ISeriesApi<'Candlestick', Time> | null;
    lines: Map<string, IPriceLine>;
  }>({ series: null, lines: new Map() });
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const store = refLinesRef.current;
    if (store.series !== series) {
      // Fresh series instance (remount): stale handles belong to the removed
      // chart — drop them so every wanted line is recreated on this one.
      store.lines.clear();
      store.series = series;
    }
    const lines = store.lines;
    const wanted = new Map<string, { price: number; color: string; title: string }>();
    const want = (key: string, usdMc: number, color: string, title: string) => {
      const price = usdMc * valueScale;
      if (!Number.isFinite(price) || price <= 0) return;
      wanted.set(key, { price, color, title });
    };
    if (avgEntryUsdMc != null) want('avg-entry', avgEntryUsdMc, '#22c77e', 'avg entry');
    if (avgExitUsdMc != null) want('avg-exit', avgExitUsdMc, '#f0567a', 'avg exit');
    // Pre-bond: the pending migration level (amber, same family as the
    // graduation M bubble that replaces it). Null once graduated.
    if (migrationUsdMc != null) want('migration', migrationUsdMc, '#f5a524', 'migration');
    for (const alert of alerts) {
      want(`alert:${alert.id}`, alert.usdMc, '#f3c709', alert.direction === 'above' ? 'alert ↑' : 'alert ↓');
    }
    for (const [key, line] of lines) {
      if (!wanted.has(key)) {
        series.removePriceLine(line);
        lines.delete(key);
      }
    }
    for (const [key, spec] of wanted) {
      const existing = lines.get(key);
      if (existing != null) {
        if (existing.options().price !== spec.price) {
          existing.applyOptions({ price: spec.price });
        }
        continue;
      }
      lines.set(
        key,
        series.createPriceLine({
          price: spec.price,
          color: spec.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: spec.title,
        }),
      );
    }
  }, [alerts, avgEntryUsdMc, avgExitUsdMc, migrationUsdMc, valueScale]);

  /* ── Right-click context menu ────────────────────────────────────
     TradingView-style: reset view, alert at the clicked level, copy
     the value under the cursor, bubble toggle, settings. */
  const hideBubblesPref = useChartPrefsStore((s) => s.hideBubbles);
  const setHideBubblesPref = useChartPrefsStore((s) => s.setHideBubbles);
  const setSettingsOpen = useChartPrefsStore((s) => s.setSettingsOpen);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    usdMc: number | null;
  } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const series = seriesRef.current;
    const container = containerRef.current;
    let usdMc: number | null = null;
    if (series && container) {
      const rect = container.getBoundingClientRect();
      const price = series.coordinateToPrice(e.clientY - rect.top);
      if (price != null && Number.isFinite(Number(price)) && valueScale > 0) {
        usdMc = Number(price) / valueScale;
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, usdMc });
  };

  /** Reset pan/zoom to the latest window + re-enable autoscale — the
   *  "auto" footer button and the context menu's "Reset chart view". */
  const resetChartView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    autoFollowRef.current = true;
    suppressRangeChangeUntilRef.current = performance.now() + 150;
    chart.priceScale('right').setAutoScale(true);
    ensureLatestLogicalWindow(chart, scaledCandles, timeframe, true);
  };

  /** "$1.97M MC" / "0.000197 SOL" — the value under the cursor in the
   *  displayed unit/mode, for menu labels and clipboard. */
  const formatDisplayValue = (usdMc: number): string => {
    const v = fmtK(usdMc * valueScale);
    const prefix = displayUnit === 'USD' ? '$' : '';
    const suffix = `${displayUnit === 'SOL' ? ' SOL' : ''}${displayMode === 'MarketCap' ? ' MC' : ''}`;
    return `${prefix}${v}${suffix}`;
  };

  const lastCloseUsdMc =
    candles && candles.length > 0 ? candles[candles.length - 1]!.close : null;

  const changeColor = ohlc.change >= 0 ? 'var(--up)' : 'var(--down)';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* OHLC readout */}
      <div
        className="t-num-xs pointer-events-none absolute left-3 right-3 top-2 z-10 flex items-center gap-3"
        style={{ color: 'var(--ink-2)' }}
      >
        <OhlcCell label="O" value={fmtK(ohlc.o * valueScale)} />
        <OhlcCell label="H" value={fmtK(ohlc.h * valueScale)} />
        <OhlcCell label="L" value={fmtK(ohlc.l * valueScale)} />
        <OhlcCell label="C" value={fmtK(ohlc.c * valueScale)} />
        <span style={{ color: changeColor }}>
          {fmtK(ohlc.change * valueScale)} ({ohlc.changePct >= 0 ? '+' : ''}
          {ohlc.changePct.toFixed(2)}%)
        </span>
        {isStub ? <StatusBadge label="warming up" className="pointer-events-auto" /> : null}
      </div>

      {/* ui-scale-exempt: lightweight-charts mixes zoom-scaled mouse
          coordinates with unscaled clientWidth sizing, so the low-DPI UI
          scale skews its crosshair/hit-testing and softens the canvas.
          Inverse zoom (net 1) keeps the chart pane pixel-exact; the thesis
          bubble overlay lives inside the same pane so it shares the chart's
          coordinate space. No-op at scale 1 (all high-DPI screens). */}
      <div className="ui-scale-exempt relative min-h-0 flex-1" onContextMenu={handleContextMenu}>
        {/* Pattern backdrop — behind the transparent chart canvas. Pure
            CSS/SVG tiling, no per-frame cost; the canvas draws over it.
            `pointer-events: none` so chart interaction is untouched. */}
        {backdrop ? (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: backdrop.backgroundImage,
              backgroundSize: backdrop.backgroundSize,
              backgroundRepeat: 'repeat',
              pointerEvents: 'none',
            }}
          />
        ) : null}
        <div ref={containerRef} className="absolute inset-0" />

      {/*
          * ── ONE TRADE, NOT A LIST ─────────────────────────────────────
          *
          * What stood here was a "Wallet trades" panel: up to twelve rows
          * of side, amount, wallet, avg buy, avg sell and holds, in mono,
          * at 10px, thrown up whenever the pointer crossed a busy candle.
          * Every row but one was a trade nobody asked about.
          *
          * The stack is gone (one disc per candle, the white count for the
          * rest), so hovering a disc is a question about ONE trade and
          * this answers that one: who, how much, at what market cap, how
          * long ago, and where they stand on the position.
          */}
        {markerCard?.entry.claim ? (
          /* A claim is one sentence, so it gets one line — not a card with
             a side chip, a market cap and three empty position columns. */
          <div className="mk-claim" style={{ left: markerCard.x, top: markerCard.y }}>
            <b>{markerCard.entry.walletLabel}</b>
            claimed {formatBubbleSol(markerCard.entry.amountSol)} SOL
            <u>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2" />
                <path d="M16 12h5M16 16h5" />
              </svg>
            </u>
          </div>
        ) : markerCard ? (
          <div className="mk" style={{ left: markerCard.x, top: markerCard.y }}>
            <div className="mk-head">
              <span
                className="mk-face"
                style={{ background: markerCard.entry.color, color: '#0b0d11' }}
              >
                <MarkerArt entry={markerCard.entry} />
              </span>
              <span className="mk-name">{markerCard.entry.walletLabel}</span>
            </div>

            <div className="mk-amt" style={{ color: markerCard.entry.color }}>
              {markerCard.entry.graduation ? 'Graduated' : `${formatBubbleSol(markerCard.entry.amountSol)} SOL`}
            </div>

            <div className="mk-when">
              {markerCard.entry.graduation ? null : (
                <span
                  className="mk-side"
                  style={{
                    color: markerCard.entry.color,
                    background: `color-mix(in srgb, ${markerCard.entry.color} 16%, transparent)`,
                  }}
                >
                  {markerCard.entry.side}
                </span>
              )}
              <i>{markerCard.at}</i>
            </div>

            {markerCard.entry.graduation ? null : (
              <div className="mk-pnl">
                <span>
                  <b>Avg buy</b>
                  <s>{markerCard.entry.avgBuyUsdMc != null ? `$${fmtK(markerCard.entry.avgBuyUsdMc)}` : '—'}</s>
                </span>
                <span>
                  <b>Avg sell</b>
                  <s>{markerCard.entry.avgSellUsdMc != null ? `$${fmtK(markerCard.entry.avgSellUsdMc)}` : '—'}</s>
                </span>
                <span>
                  <b>Holds</b>
                  <s>
                    {markerCard.entry.heldPct != null
                      ? `${markerCard.entry.heldPct >= 10 ? markerCard.entry.heldPct.toFixed(1) : markerCard.entry.heldPct.toFixed(2)}%`
                      : '—'}
                  </s>
                </span>
              </div>
            )}
          </div>
        ) : null}
        {/* Thesis bubbles — coin-call markers. Sibling overlay (never inside
            the chart's own DOM) so lightweight-charts' pointer handling and
            autoSize observer are untouched; the rAF loop above writes each
            pill's transform. Initial display:none avoids a one-frame flash
            at (0,0) before the first positioning pass. */}
        {hasThesisMarkers ? (
          <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden" aria-hidden={false}>
            {thesisMarkers.map((marker) => (
              <button
                key={marker.call.id}
                ref={(el) => {
                  if (el) thesisPillRefs.current.set(marker.call.id, el);
                  else thesisPillRefs.current.delete(marker.call.id);
                }}
                type="button"
                className="thesis-bubble pointer-events-auto"
                style={{ display: 'none' }}
                aria-label={`Thesis by ${marker.call.callerLabel}`}
                onClick={() =>
                  setOpenThesisId((current) =>
                    current === marker.call.id ? null : marker.call.id,
                  )
                }
              >
                <MegaphoneGlyph />
                thesis by @{marker.call.callerLabel}
              </button>
            ))}
            {openThesisMarker ? (
              <div
                ref={thesisPopoverRef}
                className="thesis-popover pointer-events-auto z-[13]"
                style={{ display: 'none' }}
                role="dialog"
                aria-label={`Thesis by ${openThesisMarker.call.callerLabel}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[9px] uppercase truncate"
                    style={{
                      color: 'var(--accent-primary)',
                      letterSpacing: '0.14em',
                      fontWeight: 700,
                    }}
                  >
                    thesis by @{openThesisMarker.call.callerLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="Close thesis"
                    onClick={() => setOpenThesisId(null)}
                    className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded"
                    style={{ color: 'var(--ink-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
                <p
                  className="mt-1.5 mb-0 text-[12px] leading-[1.45] break-words"
                  style={{ fontFamily: 'var(--display)', fontStyle: 'italic', color: 'var(--ink-1)' }}
                >
                  {/* x.com links render as inline TWEET chips. */}
                  <ThesisText text={openThesisMarker.call.thesis} />
                </p>
                <div
                  className="mt-2 flex items-center justify-between gap-2 text-[10px] tabular-nums"
                  style={{ color: 'var(--ink-3)' }}
                >
                  <span>
                    MC at call{' '}
                    <span style={{ color: 'var(--up)', fontWeight: 600 }}>
                      {openThesisMarker.call.marketCapLabel ?? '—'}
                    </span>
                  </span>
                  <span title={new Date(openThesisMarker.call.createdAtMs).toLocaleString()}>
                    {compactAge(Math.max(0, Date.now() - openThesisMarker.call.createdAtMs))} ago
                    {openThesisMarker.call.editedAt != null ? (
                      <span style={{ fontStyle: 'italic' }}> · edited</span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {contextMenu ? (
        <ChartContextMenuView
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              key: 'reset',
              label: 'Reset chart view',
              onClick: () => {
                resetChartView();
                setContextMenu(null);
              },
            },
            ...(contextMenu.usdMc != null && onSetAlert
              ? [
                  {
                    key: 'alert',
                    label: `Alert ${
                      lastCloseUsdMc != null && contextMenu.usdMc >= lastCloseUsdMc
                        ? 'Above'
                        : 'Below'
                    } @ ${formatDisplayValue(contextMenu.usdMc)}`,
                    onClick: () => {
                      onSetAlert(
                        contextMenu.usdMc!,
                        lastCloseUsdMc != null && contextMenu.usdMc! >= lastCloseUsdMc
                          ? 'above'
                          : 'below',
                      );
                      setContextMenu(null);
                    },
                  },
                ]
              : []),
            ...(contextMenu.usdMc != null
              ? [
                  {
                    key: 'copy',
                    label: `Copy price ${fmtK(contextMenu.usdMc * valueScale)}`,
                    onClick: () => {
                      void navigator.clipboard
                        .writeText(formatDisplayValue(contextMenu.usdMc!))
                        .catch(() => undefined);
                      setContextMenu(null);
                    },
                  },
                ]
              : []),
            {
              key: 'bubbles',
              label: hideBubblesPref ? 'Show all bubbles' : 'Hide all bubbles',
              onClick: () => {
                setHideBubblesPref(!hideBubblesPref);
                setContextMenu(null);
              },
            },
            {
              key: 'settings',
              label: 'Settings…',
              onClick: () => {
                setSettingsOpen(true);
                setContextMenu(null);
              },
            },
          ]}
        />
      ) : null}
      {selectedCandle ? (
        <div
          className="pointer-events-none absolute left-3 top-8 z-10 rounded-[var(--r-md)] px-2 py-1 text-[10px]"
          style={{
            color: 'var(--ink-1)',
            background: 'var(--tooltip-bg)',
            border: '1px solid var(--tooltip-border)',
            fontFamily: 'var(--mono)',
            letterSpacing: '0.04em',
          }}
        >
          filtered {selectedCandle.timeframe} candle{' '}
          {formatCandleTime(selectedCandle.bucketStartSec)}
        </div>
      ) : null}
      {loading ? (
        <ChartLoadingSkeleton />
      ) : emptyMessage ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r-xl)] px-4 py-3 text-center"
          style={{
            color: 'var(--ink-2)',
            background: 'var(--tooltip-bg)',
            border: '1px solid var(--tooltip-border)',
            boxShadow: 'var(--tooltip-shadow)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            lineHeight: '16px',
          }}
        >
          {emptyMessage}
        </div>
      ) : null}
      {/* Bottom row — range pills + log/auto + attribution */}
      <div className="tc-foot">
        <div className="flex items-center gap-1">
          {/* Quick timeframe toggles, synced with the toolbar popup: one
              shared selection drives candles, markers and the axis. An
              off-preset pick from the popup joins as a fifth active pill. */}
          {(QUICK_TIMEFRAMES.includes(timeframe)
            ? QUICK_TIMEFRAMES
            : [...QUICK_TIMEFRAMES, timeframe]
          ).map((tf) => (
            <button
              key={tf}
              type="button"
              className="tc-tfq"
              data-on={timeframe === tf ? '' : undefined}
              onClick={() => onTimeframeChange?.(tf)}
            >
              {tf}
            </button>
          ))}
          <i className="tc-div" aria-hidden />

          {/* The page's own toggle, not an accent CTA. It opens a panel;
              it does not place an order, and a glowing gradient pill said
              otherwise louder than the buy button does. */}
          <button
            type="button"
            className="tc-btn"
            data-on={instantTradeOpen ? '' : undefined}
            onClick={onInstantTradeClick}
            aria-pressed={instantTradeOpen}
          >
            <Bolt />
            Instant Trade
          </button>
        </div>

        <div className="tc-gap" />

        <span className="tc-clock"><ClockReadout /></span>

        <button
          type="button"
          className="tc-foot-b"
          data-on={logScale ? '' : undefined}
          onClick={() => setLogScale((v) => !v)}
        >
          log
        </button>
        <button type="button" className="tc-foot-b" onClick={resetChartView}>
          auto
        </button>

        <i className="tc-div" aria-hidden />

        <a
          className="tc-attr"
          href="https://www.tradingview.com"
          target="_blank"
          rel="noreferrer"
        >
          TradingView
        </a>
      </div>
    </div>
  );
});

/** Same megaphone mark as the trade header's Call button, pill-sized. */
function MegaphoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent-primary)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 10, height: 10, display: 'block', flexShrink: 0 }}
      aria-hidden
    >
      <path d="M3 11l14-6v14L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
    </svg>
  );
}

function OhlcCell({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: 'var(--ink-3)' }}>{label} </span>
      <span style={{ color: 'var(--ink-1)' }}>{value}</span>
    </span>
  );
}

/**
 * Subtle shimmer placeholder for the genuine cold first paint (a never-seen mint with no
 * cached/persisted/prewarmed snapshot). A row of faux candle bars at low opacity reads as
 * "chart is arriving" without the jarring spinner/blank the design replaced. Static bar
 * heights keep it deterministic (no layout jitter, SSR-stable); `animate-pulse` carries
 * the motion.
 */
const SKELETON_BAR_HEIGHTS = [38, 52, 30, 64, 46, 58, 34, 70, 48, 60, 40, 56, 32, 66, 44, 54];

function ChartLoadingSkeleton() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-end gap-[2%] px-4 pb-8 pt-10 animate-pulse"
      style={{ opacity: 0.5 }}
      aria-hidden
    >
      {SKELETON_BAR_HEIGHTS.map((height, index) => (
        <div
          key={index}
          className="flex-1 rounded-[2px]"
          style={{ height: `${height}%`, background: 'var(--ink-3)', opacity: 0.18 }}
        />
      ))}
    </div>
  );
}

function ClockReadout() {
  const [label, setLabel] = useState('00:00:00 (UTC+0)');

  useEffect(() => {
    const tick = () => {
      const offset = -new Date().getTimezoneOffset() / 60;
      const sign = offset >= 0 ? '+' : '';
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      setLabel(`${time} (UTC${sign}${offset})`);
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return <>{label}</>;
}

/**
 * Fixed-position right-click menu (TradingView-style). Rendered at the
 * cursor, clamped inside the viewport; the window listeners in
 * PriceChart close it on outside mousedown / wheel / Escape.
 *
 * Portaled to `document.body`: the chart column sits inside a
 * transformed panel stack, which would re-anchor `position: fixed`
 * (and its viewport cursor coordinates) to the panel instead of the
 * screen.
 */
function ChartContextMenuView(props: {
  x: number;
  y: number;
  items: ReadonlyArray<{ key: string; label: string; onClick: () => void }>;
}): React.ReactElement {
  const menuWidth = 240;
  const itemHeight = 34;
  // clientX/Y and innerWidth/Height are physical px, but fixed left/top are
  // multiplied by the page zoom — divide so the menu opens under the cursor.
  const z = pageZoom();
  const left = Math.min(props.x / z, Math.max(0, window.innerWidth / z - menuWidth - 8));
  const top = Math.min(
    props.y / z,
    Math.max(0, window.innerHeight / z - props.items.length * itemHeight - 16),
  );
  return createPortal(
    <div
      role="menu"
      data-testid="chart-context-menu"
      className="fixed z-50 py-1"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left,
        top,
        width: menuWidth,
        background: 'var(--surface-1)',
        border: '1px solid var(--hairline-2)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-modal)',
      }}
    >
      {props.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onClick={item.onClick}
          className="block w-full px-4 text-left text-[12px]"
          style={{
            height: 34,
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-0)',
            cursor: 'pointer',
            fontFamily: 'var(--sans)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--chip-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Pure transforms from backend `TokenSnapshot` → existing trade-page
 * mock-shaped props (`MockToken`, `VolSnapshot`, `OHLCSnapshot`,
 * `MockTrade[]`, `MockPnL`).
 *
 * No React, no fetch, no I/O. Every input is read off the snapshot
 * or its computed numbers; outputs are pre-formatted display strings
 * to match the existing render contract.
 *
 * Phase 7C scope: `MockToken` / `VolSnapshot` / `OHLCSnapshot` /
 * `MockTrade[]` are derived from the snapshot. `MockPnL` stays at
 * zeros (no per-user wallet integration yet — see the plan's
 * "explicitly deferred" list).
 */

import type { CandlestickData, Time } from 'lightweight-charts';
import {
  compactAge,
  compactNumber,
  compactUsd,
  formatPriceUsd,
  lamportsStringToNumber,
  lamportsToUsd,
  normalizeMediaUrl,
  truncateMint,
} from '@/lib/format';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import type {
  MockPnL,
  MockToken,
  MockTrade,
  OHLCSnapshot,
  VolSnapshot,
} from './mockTrade';
import {
  isStubSnapshot,
  type CandleResolution,
  type SnapshotCandle,
  type TokenSnapshot,
  type TokenTrade,
} from './types';

const LAMPORTS_PER_SOL = 1_000_000_000;
const METADATA_PENDING_LABEL = 'Metadata pending';
const MISSING_TOKEN_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2296%22 height=%2296%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2214%22 fill=%22%2311161f%22/%3E%3Ccircle cx=%2248%22 cy=%2248%22 r=%2223%22 fill=%22none%22 stroke=%22%2338e1ff%22 stroke-opacity=%22.45%22 stroke-width=%222%22/%3E%3Cpath d=%22M48 27v42M27 48h42%22 stroke=%22%2338e1ff%22 stroke-opacity=%22.55%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';
const CHART_MAX_ABS_VALUE = 90_071_992_547_409.91;
const OUTLIER_MIN_CANDLES = 5;
const ISOLATED_SPIKE_MULTIPLIER = 100;
const ISOLATED_SPIKE_REJOIN_MULTIPLIER = 10;
const OUTLIER_NEIGHBOR_WINDOW = 4;
const OUTLIER_MAX_RUN = 4;

/** Top-level adapter — `(snapshot, nowMs) → page props`. */
export interface AdaptedTradeProps {
  token: MockToken;
  vol: VolSnapshot;
  ohlc: OHLCSnapshot;
  trades: MockTrade[];
  pnl: MockPnL;
  /**
   * 7D-1 addition: candle series for `<PriceChart>`. Empty when the
   * snapshot has no candles in the selected timeframe bucket.
   * Values are USD market cap per bucket, on the same scale as
   * `ohlc.{o,h,l,c}` so the chart's `fmtK` formatter and the OHLC
   * readout agree on units.
   */
  candles: CandlestickData<Time>[];
  /** True when the snapshot is a stub (CREATE not landed yet). */
  isStub: boolean;
}

export function adaptSnapshot(
  snap: TokenSnapshot,
  nowMs: number,
  timeframe: CandleResolution = '1s',
  tapeSolUsd?: number,
): AdaptedTradeProps {
  return {
    token: adaptToken(snap, nowMs),
    vol: adaptVol(snap),
    ohlc: adaptOhlc(snap, timeframe),
    trades: adaptTrades(snap, nowMs, tapeSolUsd),
    pnl: adaptPnl(),
    candles: adaptCandles(snap, timeframe),
    isStub: isStubSnapshot(snap),
  };
}

// ── Token header ─────────────────────────────────────────────────

export function adaptToken(snap: TokenSnapshot, nowMs: number): MockToken {
  const stub = isStubSnapshot(snap);
  const symbol = cleanTokenIdentity(snap.symbol, snap.mint) ?? (stub ? 'Loading' : truncateMint(snap.mint));
  const name = cleanTokenIdentity(snap.name, snap.mint) ?? (stub ? METADATA_PENDING_LABEL : 'Metadata unavailable');
  const ticker = symbol.startsWith('$') ? symbol : symbol;

  const liquidityUsd = liquidityUsdFromSnapshot(snap);
  const athUsd = maxCandleHighUsd(snap) ?? snap.marketCapUsd;
  const twitterUrl = normalizeSocialUrl(snap.metadata?.twitter, 'twitter');
  const telegramUrl = normalizeSocialUrl(snap.metadata?.telegram, 'telegram');
  const websiteUrl = normalizeWebsiteUrl(snap.metadata?.website);

  const hasLink = Boolean(twitterUrl || telegramUrl || websiteUrl);
  const sourceImageUrl = normalizeMediaUrl(snap.metadata?.image);
  const proxyImageUrl = ingestionTokenImageUrl(snap.mint);

  return {
    mintAddress: snap.mint,
    symbol,
    ticker,
    name,
    imageUrl: sourceImageUrl ?? proxyImageUrl ?? fallbackImage(),
    imageFallbackUrl: sourceImageUrl ? proxyImageUrl : null,
    twitterUrl,
    telegramUrl,
    websiteUrl,
    ageLabel: compactAge(Math.max(0, nowMs - snap.createdAtMs)),
    price: formatPriceUsd(snap.priceUsdPerToken, '$0'),
    liquidity: compactUsd(liquidityUsd, '$0'),
    marketCap: compactUsd(snap.marketCapUsd, stub ? 'new' : '$0'),
    marketCapUsd:
      Number.isFinite(snap.marketCapUsd) && snap.marketCapUsd > 0 ? snap.marketCapUsd : null,
    ath: compactUsd(athUsd, stub ? 'new' : '$0'),
    platform: snap.variant === 'create_v2' ? 'Pump V2' : 'Pump V1',
    source: 'chain-indexer',
    mintShort: truncateMint(snap.mint),
    txns: snap.tradeCount,
    score: scoreFromSnapshot(snap),
    // Venue marker for the order path: every trade-page submit forwards
    // `token.graduated` so the engine's stale-quote backstop can fire for
    // AMM (post-graduation) tokens. Without this every trade-page order
    // omitted it. `graduatedAtMs` implies graduation even when the hot
    // state's boolean momentarily lags.
    graduated: snap.graduated === true || snap.graduatedAtMs != null,
    graduatedAtMs: snap.graduatedAtMs,
    quoteMint: snap.quoteMint ?? null,
    solUsd: Number.isFinite(snap.solUsd) && snap.solUsd > 0 ? snap.solUsd : null,
    hasWebsite: Boolean(websiteUrl),
    hasLink,
    hasAgent: false,
    isMayhem: snap.isMayhem,
    isCashback: snap.isCashback,
  };
}

function cleanTokenIdentity(value: string | null | undefined, mint: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === mint || trimmed === truncateMint(mint)) return null;
  return trimmed;
}

// ── 5-minute volume snapshot ─────────────────────────────────────

export function adaptVol(snap: TokenSnapshot): VolSnapshot {
  // Per-side USD volume is derived from the recent-trades window
  // (it's the only place the snapshot carries a per-trade `isBuy`
  // breakdown). Falls back to a single-bucket display when the
  // window is empty.
  const { buyUsd, sellUsd } = sideVolumeUsd(snap.recentTrades, snap.solUsd);
  const totalUsd = snap.vol5mUsd > 0 ? snap.vol5mUsd : buyUsd + sellUsd;
  const net = buyUsd - sellUsd;
  return {
    window: '5m',
    vol: compactUsd(totalUsd, '$0'),
    buys: { count: snap.buyCount, amount: compactUsd(buyUsd, '$0') },
    sells: { count: snap.sellCount, amount: compactUsd(sellUsd, '$0') },
    netVol: net >= 0 ? `+${compactUsd(net, '$0')}` : `-${compactUsd(-net, '$0')}`,
  };
}

function sideVolumeUsd(
  trades: TokenTrade[],
  solUsd: number,
): { buyUsd: number; sellUsd: number } {
  let buyUsd = 0;
  let sellUsd = 0;
  for (const t of trades) {
    const usd = lamportsToUsd(t.solLamports, solUsd) ?? 0;
    if (t.isBuy) buyUsd += usd;
    else sellUsd += usd;
  }
  return { buyUsd, sellUsd };
}

// ── OHLC card numbers (for `<TokenHeaderBar>` and `<PriceChart>` overlays) ──

export function adaptOhlc(
  snap: TokenSnapshot,
  timeframe: CandleResolution = '1s',
): OHLCSnapshot {
  // Use the exact selected resolution so the overlay describes the
  // latest visible real candle in the plotted series.
  const selected = selectCandleBuckets(snap, timeframe);
  const candle = selected ? latestCandle(toSortedCandles(selected.buckets, snap)) : null;
  if (candle) {
    const change = candle.close - candle.open;
    const changePct = candle.open > 0 ? (change / candle.open) * 100 : 0;
    return { o: candle.open, h: candle.high, l: candle.low, c: candle.close, change, changePct };
  }
  const c = safeChartValue(snap.marketCapUsd) ?? 0;
  return { o: c, h: c, l: c, c, change: 0, changePct: 0 };
}

// ── Candle series for the chart (7D-1) ──────────────────────────

/**
 * Convert the snapshot's candle buckets into a `CandlestickData[]`
 * the chart can `setData` directly. Each candle's open/high/low/
 * close is rendered as **USD market cap at that moment** — same
 * scale as `adaptOhlc` so the chart axis and the OHLC readout agree.
 *
 * The selected timeframe is exact: `1s`, `1m`, `5m`, `15m`, or `1h`.
 * The execution engine stores canonical buckets for each one, so the UI
 * does not aggregate or repair real candle highs/lows.
 *
 * The engine stores buckets sparsely — only intervals where a trade
 * actually happened. The frontend preserves that shape. Quiet time
 * does not print synthetic candles; the next buy/sell simply resumes
 * the tape at its own timestamp.
 *
 * Output is sorted ascending by `time` — `lightweight-charts`
 * requires monotonic time keys and will throw on out-of-order rows.
 */
export function adaptCandles(
  snap: TokenSnapshot,
  timeframe: CandleResolution = '1s',
): CandlestickData<Time>[] {
  const selected = selectCandleBuckets(snap, timeframe);
  if (!selected) return [];
  return adaptSnapshotCandleBuckets(selected.buckets, snap);
}

export function adaptSnapshotCandleBuckets(
  buckets: SnapshotCandle[],
  context: { solUsd: number; totalSupplyBaseUnits: string },
): CandlestickData<Time>[] {
  return toSortedCandles(buckets, context);
}

function selectCandleBuckets(
  snap: TokenSnapshot,
  timeframe: CandleResolution,
): { resolution: CandleResolution; buckets: SnapshotCandle[] } | null {
  const buckets = pickFirstNonEmpty(snap.candles[timeframe]);
  return buckets ? { resolution: timeframe, buckets } : null;
}

function latestCandle(candles: CandlestickData<Time>[] | undefined): CandlestickData<Time> | null {
  if (!candles || candles.length === 0) return null;
  return candles.reduce((latest, candle) => (
    Number(candle.time) > Number(latest.time) ? candle : latest
  ), candles[0]!);
}

function toSortedCandles(
  buckets: SnapshotCandle[],
  context: { solUsd: number; totalSupplyBaseUnits: string },
): CandlestickData<Time>[] {
  const supply = context.totalSupplyBaseUnits;
  const solUsd = context.solUsd;
  // Parse the (per-token constant) supply once per pass, not 4× per bucket —
  // each parse is a regex test + a BigInt allocation (lamportsStringToNumber).
  const supplyBaseUnits = lamportsStringToNumber(supply);
  const out = buckets.flatMap((bucket) => {
    const candle = bucketToCandle(bucket, solUsd, supply, supplyBaseUnits);
    return candle ? [candle] : [];
  });
  out.sort((a, b) => Number(a.time) - Number(b.time));
  return dropIsolatedSpikeCandles(out);
}

function pickFirstNonEmpty<T>(arr: T[] | undefined): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined;
}

// Bucket objects are parse-fresh JSON, never mutated, and reused by identity
// across merges (only the ~3 tip buckets are new per candles event), so the
// conversion is a pure function of (bucket, solUsd, supply) — memoize it per
// bucket object. Hits validate both pricing inputs so a repriced pass (solUsd
// tick) never serves stale values; null (dropped bucket) results are cached
// too. Downstream never mutates candle objects (spike drop filters,
// bridging and the append-only renderer are copy-on-write), so sharing one
// object across passes is safe.
const bucketCandleCache = new WeakMap<SnapshotCandle, {
  solUsd: number;
  supply: string;
  candle: CandlestickData<Time> | null;
}>();

function bucketToCandle(
  b: SnapshotCandle,
  solUsd: number,
  totalSupplyBaseUnits: string,
  supplyBaseUnits: number | null,
): CandlestickData<Time> | null {
  const cached = bucketCandleCache.get(b);
  if (cached && cached.solUsd === solUsd && cached.supply === totalSupplyBaseUnits) {
    return cached.candle;
  }
  const open = marketCapUsdFromParsedRatio(b.open_num, b.open_den, solUsd, supplyBaseUnits);
  const high = marketCapUsdFromParsedRatio(b.high_num, b.high_den, solUsd, supplyBaseUnits);
  const low = marketCapUsdFromParsedRatio(b.low_num, b.low_den, solUsd, supplyBaseUnits);
  const close = marketCapUsdFromParsedRatio(b.close_num, b.close_den, solUsd, supplyBaseUnits);
  const candle = candleFromComponents(b, open, high, low, close);
  bucketCandleCache.set(b, { solUsd, supply: totalSupplyBaseUnits, candle });
  return candle;
}

function candleFromComponents(
  b: SnapshotCandle,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
): CandlestickData<Time> | null {
  // A component that FAILED to convert (zero denominator, unparseable, bad
  // solUsd) is null — drop the bucket rather than fabricate a value. The old
  // behavior coerced failures to 0, which either minted a fake wick-to-zero
  // (low=0 passes the OHLC sanity gate) or tripped the gate and silently
  // punched a hole in the series. A genuine zero PRICE (num=0, den>0 —
  // pre-repair zero-priced history rows) still converts to 0 and renders.
  if (open == null || high == null || low == null || close == null) return null;
  if (!isChartOhlc(open, high, low, close)) return null;
  // backend emits `bucketStartSec` (seconds-since-epoch i64) per
  // `#[serde(rename = "bucketStartSec")]` on
  // an internal routine.
  // `lightweight-charts`'s `UTCTimestamp` is also seconds-since-epoch
  // (a branded `number`), so a direct cast is safe.
  return {
    time: b.bucketStartSec as Time,
    open,
    high,
    low,
    close,
  };
}

/**
 * `(num/den) * total_supply_base_units * solUsd / LAMPORTS_PER_SOL`
 *
 * The ratio is lamports-per-base-unit. Multiplying by total supply
 * (in base units) gives total lamports of market cap; dividing by
 * LAMPORTS_PER_SOL converts to SOL; multiplying by `solUsd` gives
 * USD. Same scaling backend uses internally for `marketCapUsd`, just
 * applied per-bucket.
 */
function marketCapUsdFromRatio(
  num: string,
  den: string,
  solUsd: number,
  totalSupplyBaseUnits: string,
): number | null {
  return marketCapUsdFromParsedRatio(num, den, solUsd, lamportsStringToNumber(totalSupplyBaseUnits));
}

/// Supply-parse-hoisted variant: candle passes parse the per-token-constant
/// supply string once (see `toSortedCandles`) instead of once per component.
function marketCapUsdFromParsedRatio(
  num: string,
  den: string,
  solUsd: number,
  supplyBaseUnits: number | null,
): number | null {
  const n = lamportsStringToNumber(num);
  const d = lamportsStringToNumber(den);
  // `null` = conversion FAILED (callers must not chart it); a real zero price
  // (n === 0 with a valid denominator) still returns 0. `solUsd <= 0` is a
  // failure: multiplying by a missing/zero SOL price repriced entire series
  // to zero during ingestion restarts.
  if (n == null || d == null || supplyBaseUnits == null || d === 0
    || !Number.isFinite(solUsd) || solUsd <= 0) {
    return null;
  }
  return ((n / d) * supplyBaseUnits * solUsd) / LAMPORTS_PER_SOL;
}

function safeChartValue(value: number): number | null {
  return Number.isFinite(value) && Math.abs(value) <= CHART_MAX_ABS_VALUE ? value : null;
}

function isChartOhlc(open: number, high: number, low: number, close: number): boolean {
  return [open, high, low, close].every((value) => safeChartValue(value) != null)
    && high >= Math.max(open, low, close)
    && low <= Math.min(open, high, close);
}

export function dropIsolatedSpikeCandles(candles: CandlestickData<Time>[]): CandlestickData<Time>[] {
  if (candles.length < OUTLIER_MIN_CANDLES) return candles;
  const globalBaseline = median(candles.map(candleBodyMid).filter((value) => value > 0));
  if (globalBaseline == null || globalBaseline <= 0) return candles;
  const candidates = candles.map((candle, index) => {
    const localBaseline = localBodyBaseline(candles, index) ?? globalBaseline;
    const baseline = Math.max(localBaseline, globalBaseline * 0.25);
    if (baseline <= 0) return false;
    return candle.high / baseline >= ISOLATED_SPIKE_MULTIPLIER
      || candle.high / globalBaseline >= ISOLATED_SPIKE_MULTIPLIER;
  });
  const drop = new Set<number>();
  for (let start = 0; start < candidates.length; start += 1) {
    if (!candidates[start]) continue;
    let end = start;
    while (end + 1 < candidates.length && candidates[end + 1]) end += 1;

    const runLength = end - start + 1;
    const runHigh = Math.max(...candles.slice(start, end + 1).map((candle) => candle.high));
    const prevBody = nearestBodyHigh(candles, start, -1, candidates);
    const nextBody = nearestBodyHigh(candles, end, 1, candidates);
    const neighborMax = Math.max(prevBody ?? 0, nextBody ?? 0);
    if (
      runLength <= OUTLIER_MAX_RUN
      && prevBody != null
      && nextBody != null
      && neighborMax > 0
      && neighborMax * ISOLATED_SPIKE_REJOIN_MULTIPLIER < runHigh
    ) {
      for (let index = start; index <= end; index += 1) drop.add(index);
    }
    start = end;
  }
  return candles.filter((_, index) => !drop.has(index));
}

/**
 * Final render-side enforcement of the candle-continuity invariant: for every
 * adjacent pair of REAL candles, `next.open === prev.close`. Upstream paths
 * that can still self-open a candle (engine restart amnesia before
 * rehydration, heal/backfill replay seams, slot-estimate misses) produce a
 * visible "teleport" bar; rather than depending on every producer being
 * perfect, the chart bridges the open to the previous close and widens
 * high/low to keep OHLC sane. Close values are never modified, so bridging
 * never compounds: each candle still ends exactly where the data says.
 * Data-level repair (audits/backfills) remains the durable fix — this makes
 * rendering independent of it.
 */
export function bridgeCandleOpens(candles: CandlestickData<Time>[]): CandlestickData<Time>[] {
  if (candles.length < 2) return candles;
  let out: CandlestickData<Time>[] | null = null;
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]!.close;
    const candle = candles[i]!;
    if (candle.open === prevClose) continue;
    if (out === null) out = candles.slice();
    out[i] = {
      ...candle,
      open: prevClose,
      high: Math.max(candle.high, prevClose),
      low: Math.min(candle.low, prevClose),
    };
  }
  return out ?? candles;
}

function localBodyBaseline(candles: CandlestickData<Time>[], index: number): number | null {
  const values: number[] = [];
  for (let offset = 1; offset <= OUTLIER_NEIGHBOR_WINDOW; offset += 1) {
    const prev = candles[index - offset];
    const next = candles[index + offset];
    if (prev) values.push(candleBodyMid(prev));
    if (next) values.push(candleBodyMid(next));
  }
  return median(values.filter((value) => value > 0));
}

function nearestBodyHigh(
  candles: CandlestickData<Time>[],
  index: number,
  direction: -1 | 1,
  skip?: boolean[],
): number | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < candles.length;
    cursor += direction
  ) {
    if (skip?.[cursor]) continue;
    const candle = candles[cursor];
    if (!candle) continue;
    const bodyHigh = Math.max(candle.open, candle.close);
    if (bodyHigh > 0) return bodyHigh;
  }
  return null;
}

function candleBodyMid(candle: CandlestickData<Time>): number {
  return (Math.max(candle.open, candle.close) + Math.min(candle.open, candle.close)) / 2;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo == null || hi == null ? null : (lo + hi) / 2;
}

// Deriving the header ATH re-ran a full sort+spike-filter pass over EVERY
// resolution's candle history — five extra passes per adapted snapshot, just
// to re-produce a label that only moves when candle data moves. Key the
// result on the `snap.candles` record identity: react-query's structural
// sharing preserves it across polls whose candle content is unchanged, and
// repeat adaptSnapshot runs reuse the same snapshot object outright. A hit
// at a different solUsd rescales from the originally computed basis instead
// of re-running the passes — solUsd multiplies every candle by the same
// positive factor and the spike filter's decisions are ratio-based, so the
// max-high bucket is unchanged. Always rescaling from the ORIGINAL basis
// means wobble sequences never compound float error.
const athUsdCache = new WeakMap<TokenSnapshot['candles'], {
  solUsd: number;
  supply: string;
  athUsd: number | null;
}>();

function maxCandleHighUsd(snap: TokenSnapshot): number | null {
  const solUsdValid = Number.isFinite(snap.solUsd) && snap.solUsd > 0;
  if (solUsdValid) {
    const cached = athUsdCache.get(snap.candles);
    if (cached && cached.supply === snap.totalSupplyBaseUnits) {
      return cached.athUsd == null || cached.solUsd === snap.solUsd
        ? cached.athUsd
        : cached.athUsd * (snap.solUsd / cached.solUsd);
    }
  }
  let max: number | null = null;
  for (const buckets of Object.values(snap.candles)) {
    if (!buckets) continue;
    for (const candle of toSortedCandles(buckets, snap)) {
      if (safeChartValue(candle.high) != null && (max == null || candle.high > max)) {
        max = candle.high;
      }
    }
  }
  // An invalid solUsd drops every bucket (see marketCapUsdFromParsedRatio);
  // caching that null would mask the real ATH once the price feed recovers.
  if (solUsdValid) {
    athUsdCache.set(snap.candles, {
      solUsd: snap.solUsd,
      supply: snap.totalSupplyBaseUnits,
      athUsd: max,
    });
  }
  return max;
}

// ── Recent trades table ──────────────────────────────────────────

export interface TradeAdaptContext {
  totalSupplyBaseUnits: string;
  solUsd: number;
}

export function adaptTrades(snap: TokenSnapshot, nowMs: number, tapeSolUsd?: number): MockTrade[] {
  return adaptTokenTrades(snapshotTradeRows(snap), {
    totalSupplyBaseUnits: snap.totalSupplyBaseUnits,
    // The row cache below serves on EXACT solUsd match, so every caller that
    // maps the same TokenTrade objects must adapt at the ONE shared latched
    // rate (TradePage tapeSolUsd). Falling back to the raw per-frame snapshot
    // rate here while the tape used the latch made the two callers alternate
    // cache stamps — a full-tape rebuild + row identity churn per frame.
    solUsd: tapeSolUsd ?? snap.solUsd,
  }, nowMs);
}

function snapshotTradeRows(snap: TokenSnapshot): TokenTrade[] {
  return snap.tradeHistory && snap.tradeHistory.length > 0
    ? snap.tradeHistory
    : snap.recentTrades;
}

// Adapted-row identity cache, keyed on the source TokenTrade object (wire
// trades are parsed once and identity-stable across live flushes; snapshot
// polls mint fresh sources ~5s apart). Hits validate both pricing inputs so
// a repriced pass never serves stale USD figures. The solUsd check is now
// EXACT: the caller threads a SINGLE shared latched rate through `context`
// (TradePage tapeSolUsd) that advances only on >=0.1% cumulative moves, so
// steady-state Pyth wobble no longer changes the input and the memoized Row
// is preserved — while a latch advance rebuilds every row once, at one
// consistent price. Per-row latches let two equivalent rows built at
// different oracle prints disagree by ~0.2% (finding #14). Serving a row with
// an OLDER ageBaseMs baseline is exact: the age column renders via
// liveAgeSec/tradeTimeMs, which reconstruct the same arrival instant from
// any baseline. Stable row identity is what lets the tape's memoized Row
// skip reconciling ~250 unchanged rows on every live flush.
const tradeRowCache = new WeakMap<TokenTrade, {
  solUsd: number;
  supply: string;
  row: MockTrade;
}>();

export function adaptTokenTrades(
  trades: TokenTrade[],
  context: TradeAdaptContext,
  nowMs: number,
): MockTrade[] {
  const totalSupply = lamportsStringToNumber(context.totalSupplyBaseUnits);
  const baseNowSec = Math.floor(nowMs / 1_000);
  const ageBaseMs = baseNowSec * 1_000;
  return trades.map((t) => {
    const cached = tradeRowCache.get(t);
    if (cached && cached.solUsd === context.solUsd && cached.supply === context.totalSupplyBaseUnits) {
      return cached.row;
    }
    const arrivedSec = Math.floor(t.arrivedAtMs / 1_000);
    const ageSec = Math.max(0, baseNowSec - arrivedSec);
    const solLamports = lamportsStringToNumber(t.solLamports) ?? 0;
    const totalSol = solLamports / LAMPORTS_PER_SOL;
    const tokenAmt = lamportsStringToNumber(t.tokenBaseUnits) ?? 0;
    const supplyPct =
      totalSupply && totalSupply > 0
        ? `${((tokenAmt / totalSupply) * 100).toFixed(2)}%`
        : '-';
    const supplyHeld = formatSupplyHeld(t.traderPostTokenBaseUnits, totalSupply);
    const mcUsd =
      lamportsToUsd(t.marketCapLamports ?? '', context.solUsd)
      ?? marketCapUsdFromRatio(t.vsr, t.vtr, context.solUsd, context.totalSupplyBaseUnits);
    const row: MockTrade = {
      id: tradeId(t),
      arrivedAtMs: t.arrivedAtMs,
      ageBaseMs,
      ageSec,
      age: formatAgeSec(ageSec),
      type: t.isBuy ? 'Buy' : 'Sell',
      mc: compactUsd(mcUsd, '$0'),
      totalSol: totalSol.toFixed(3),
      supplyPct,
      supplyHeld,
      trader: truncateMint(t.user),
      traderAddress: t.user,
      signature: t.signature,
      badge: 1,
    };
    tradeRowCache.set(t, { solUsd: context.solUsd, supply: context.totalSupplyBaseUnits, row });
    return row;
  });
}

/// Supply Held: the trader's wallet total for this mint right after the trade
/// (stamped server-side from the tx's postTokenBalances), as % of supply.
/// "-" = unstamped row (persisted before the field shipped); "0%" = the exact
/// sold-everything case; "<0.01%" = nonzero dust below display precision.
function formatSupplyHeld(
  postBaseUnits: string | undefined,
  totalSupply: number | null,
): string {
  if (postBaseUnits === undefined || !totalSupply || totalSupply <= 0) return '-';
  const post = lamportsStringToNumber(postBaseUnits);
  if (post == null) return '-';
  if (post === 0) return '0%';
  const pct = (post / totalSupply) * 100;
  if (pct < 0.005) return '<0.01%';
  return `${pct.toFixed(2)}%`;
}

function formatAgeSec(ageSec: number): string {
  return compactAge(ageSec * 1_000);
}

function tradeId(t: TokenTrade): string {
  return [
    t.signature,
    t.arrivedAtMs,
    t.user,
    t.isBuy ? 'b' : 's',
    t.solLamports,
    t.tokenBaseUnits,
  ].join(':');
}

// ── PnL placeholder ──────────────────────────────────────────────

export function adaptPnl(): MockPnL {
  // No wallet integration in 7C; per-user PnL is explicitly deferred.
  return {
    bought: '0',
    sold: '0',
    holding: '0',
    pnl: '+0 (+0%)',
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function liquidityUsdFromSnapshot(snap: TokenSnapshot): number | null {
  // Same convention as the search page's server-side `card_liquidity_usd`:
  // bonding-curve tokens show the VIRTUAL SOL reserves (the depth a seller
  // trades against — a fresh curve reads ~30 SOL ≈ $5K, not $0); graduated
  // tokens show the AMM pool's real quote side × 2 (both sides).
  const graduated = snap.graduated === true || snap.graduatedAtMs != null;
  const lamports = graduated
    ? (lamportsStringToNumber(snap.realSolLamports) ?? 0) * 2
    : (lamportsStringToNumber(snap.vsr) ?? 0);
  if (lamports <= 0) {
    return snap.vol5mUsd > 0 ? snap.vol5mUsd : null;
  }
  return (lamports * snap.solUsd) / LAMPORTS_PER_SOL;
}

/**
 * [REDACTED FOR EXPORT] The 0-9.9 score shown on the Trade header is the same
 * proprietary blend used by Discover, so both are omitted from this
 * export. The placeholder keeps the range and the call sites intact.
 */
function scoreFromSnapshot(snap: TokenSnapshot): number {
  void snap;
  return 5;
}

function fallbackImage(): string {
  return MISSING_TOKEN_IMAGE;
}

export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  return normalizeHttpUrl(raw);
}

export function normalizeSocialUrl(
  raw: string | null | undefined,
  kind: 'twitter' | 'telegram',
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const http = normalizeHttpUrl(trimmed);
  if (http) return http;

  const handle = trimmed
    .replace(/^@/, '')
    .replace(/^twitter\.com\//i, '')
    .replace(/^x\.com\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^telegram\.me\//i, '')
    .split(/[/?#]/, 1)[0]
    ?.trim();
  if (!handle || !/^[A-Za-z0-9_]{1,64}$/.test(handle)) return null;
  return kind === 'twitter'
    ? `https://x.com/${handle}`
    : `https://t.me/${handle}`;
}

function normalizeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Re-export for places (e.g. tests) that want the helper without
// pulling in the whole adapter.
export { compactNumber };

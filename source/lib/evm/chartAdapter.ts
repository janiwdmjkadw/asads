/**
 * EVM → Solana-chart data adapter (phase 1 of the trade-page unification).
 *
 * The Solana trade page's chart stack (`PriceChart` + `timeframes.ts`
 * aggregation + the append-only renderer + the provisional tip) consumes
 * `CandlestickData<Time>[]` in ONE numeric basis per mount. This module turns
 * the EVM wire shapes — `GET /evm/candles` num/den ratio rows and the
 * `/evm/trades` + SSE trade tape — into exactly that, so the EVM page can
 * mount the REAL chart instead of the static SVG fork.
 *
 * ## The basis (what a plotted value MEANS)
 *
 * The wire ships prices as exact ratios: `quote base units / token base
 * units`, two decimal strings, because neither word fits a double
 * (the backend source). The Solana chart plots floats. The one sanctioned
 * crossing is PIXEL GEOMETRY (see `money.ts::ratioToPlotValue`): a chart
 * coordinate is a float no matter what we do, so the ratio may become one for
 * plotting — and NOTHING RENDERED AS TEXT outside the chart's own axis may
 * come from these numbers.
 *
 * Four bases exist, resolved in preference order by `resolveEvmChartBasis`:
 *
 * 1. **`usd-mc`** — USD market cap per bucket, the Solana chart's native
 *    scale. Available when the money leg is the chain's own coin, the wire
 *    served a USD oracle basis it judged fresh (it OMITS the USD fields and
 *    stamps `usdUnavailableReason` when the oracle is absent or stale — the
 *    freshness gate is the producer's, not re-derived here), and
 *    `totalSupply` arrived. `value = (num/den) × supplyBaseUnits × nativeUsd
 *    / 10^18` — the same arithmetic as Solana's `marketCapUsdFromRatio` with
 *    `10^18` where Solana has `LAMPORTS_PER_SOL`. Token decimals cancel out
 *    of this product entirely, so an assumed scale cannot skew it.
 * 2. **`usd-price`** — USD per WHOLE token, when the oracle basis is fresh
 *    but no supply arrived (no market cap without a denominator).
 * 3. **`native-price`** — native (BNB/ETH) per whole token, when the quote is
 *    native but the oracle basis is absent or stale. Falling back rather than
 *    reusing a stale rate is the absent-is-not-zero doctrine applied to a
 *    conversion factor: a USD level computed from a rate the producer refused
 *    to serve would be a fabricated measurement.
 * 4. **`quote-ratio`** — the raw base-unit ratio, unscaled, when the money
 *    leg is NOT the chain's coin (a stock-quoted Pons market). The wire
 *    carries no decimals for the quote token, so no absolute level is honest;
 *    the SHAPE survives (an unknown positive scale factor is monotone), which
 *    is why the series still plots. The mount is responsible for labelling
 *    the level as unscaled (`quoteUnitsWithheldText('chart')` already exists
 *    for this).
 *
 * ## `canonicalThroughSec` (the settle watermark)
 *
 * Solana's chart settles a bucket only once a CANONICAL successor proves it
 * complete; provisional (client-synthesized) buckets never settle anything.
 * The EVM read API serves only server-derived buckets and carries NO explicit
 * finalized/fold watermark on the candle response, so the conservative
 * boundary is **the newest bucket the server returned**: everything strictly
 * older is settleable, the newest bucket is the mutable canonical tip (it may
 * still be forming server-side), and anything ahead of it exists only as the
 * client-synthesized provisional tip. Reorg recomputes arrive as whole-series
 * refetches (the page bumps its refetch epoch on `reverted`/`stage` frames),
 * which is the rebuild signal the append-only renderer keys on.
 *
 * Pure functions, no React, no I/O.
 */

import type { CandlestickData, Time } from 'lightweight-charts';
import { parseWire } from './money';
import type { EvmCandleRow } from './tradeApi';
import type { EvmTapeEntry } from './tape';

/** Native-asset decimals; BNB and ETH are both 18 (`money.ts`). */
const NATIVE_DECIMALS = 18;

/**
 * Fixed-point scale for the ratio → float crossing. `ratioToPlotValue` uses
 * 10^12, which floors a Solana-scale supply's per-base-unit price (≈1e-13 at
 * a sub-$1K market cap) to nothing; 10^24 keeps every ratio a real market can
 * produce while the division still happens exactly in BigInt.
 */
const RATIO_SCALE_DIGITS = 24n;
const RATIO_SCALE = 10n ** RATIO_SCALE_DIGITS;
const RATIO_SCALE_NUMBER = 1e24;

/** Guard rail shared with the Solana adapter (`snapshotAdapter.ts`). */
const CHART_MAX_ABS_VALUE = 90_071_992_547_409.91;

export type EvmChartBasisKind = 'usd-mc' | 'usd-price' | 'native-price' | 'quote-ratio';

export interface EvmChartBasis {
  kind: EvmChartBasisKind;
  /**
   * Float multiplier applied to the raw base-unit ratio (`num/den`,
   * `cost/amount`) to reach the plotted value. GEOMETRY ONLY — see the
   * module header.
   */
  factor: number;
  /** What `PriceChart` should call the axis values. */
  displayMode: 'MarketCap' | 'Price';
  /** `USD` prints `$`; `NATIVE` prints bare figures — the mount labels them. */
  displayUnit: 'USD' | 'NATIVE';
}

export interface EvmChartBasisInput {
  /** Is the market's money leg the chain's own coin? (`view.quote.isNative`) */
  quoteIsNative: boolean;
  /**
   * The wire's own refusal to serve USD (`usdUnavailableReason`). Non-null —
   * including `native_usd_absent_or_stale` — means the producer judged its
   * oracle basis unusable, and this adapter does not overrule it.
   */
  usdUnavailableReason?: string | null;
  /** Oracle rate, nano-USD (1e-9) per whole native token (`nativeUsdNano`). */
  nativeUsdNano?: string | null;
  /** Token base units (`totalSupply`). Needed for the market-cap basis. */
  totalSupply?: string | null;
  /**
   * The scale token figures are RENDERED at — `view.tokenDecimals`, i.e. the
   * measured value or the disclosed 18 assumption. A read surface at a
   * disclosed assumption is still worth reading (the page's decimals note
   * covers it); only the `usd-price`/`native-price` bases consume it, and the
   * market-cap basis is immune (decimals cancel).
   */
  tokenDecimals: number;
}

/**
 * Decide the strongest basis the wire actually supports. Never fabricates:
 * a stale oracle falls back to native, an unscalable quote token falls back
 * to the bare ratio.
 */
export function resolveEvmChartBasis(input: EvmChartBasisInput): EvmChartBasis {
  if (!input.quoteIsNative) {
    return { kind: 'quote-ratio', factor: 1, displayMode: 'Price', displayUnit: 'NATIVE' };
  }
  const nativeUsd = wireToGeometryFloat(input.nativeUsdNano, 9);
  const usdOk =
    input.usdUnavailableReason == null && nativeUsd !== null && nativeUsd > 0;
  if (usdOk) {
    const supplyBaseUnits = wireToGeometryFloat(input.totalSupply, 0);
    if (supplyBaseUnits !== null && supplyBaseUnits > 0) {
      return {
        kind: 'usd-mc',
        factor: (supplyBaseUnits * nativeUsd) / 10 ** NATIVE_DECIMALS,
        displayMode: 'MarketCap',
        displayUnit: 'USD',
      };
    }
    return {
      kind: 'usd-price',
      factor: nativeUsd * 10 ** (input.tokenDecimals - NATIVE_DECIMALS),
      displayMode: 'Price',
      displayUnit: 'USD',
    };
  }
  return {
    kind: 'native-price',
    factor: 10 ** (input.tokenDecimals - NATIVE_DECIMALS),
    displayMode: 'Price',
    displayUnit: 'NATIVE',
  };
}

/**
 * Convert `GET /evm/candles` rows into the chart series, ascending by time.
 *
 * Doctrine carried over from the SVG chart it replaces:
 * - **A bucket missing any price component is a GAP, not a zero** — skipped,
 *   never drawn at 0 (`candleFromComponents` applies the same rule on
 *   Solana). Callers can size the gap as `rows.length - out.length`.
 * - **A genuinely zero price (num=0, den>0) still renders as 0.**
 * - **`needsRecompute` buckets are KEPT** — the server serves the stale
 *   candle on purpose (blanking destroys the evidence a recompute is owed);
 *   the mount surfaces the series-level `stale` flag beside the chart.
 */
export function adaptEvmCandles(
  rows: readonly EvmCandleRow[],
  basis: EvmChartBasis,
): CandlestickData<Time>[] {
  const out: CandlestickData<Time>[] = [];
  for (const row of rows) {
    const open = componentValue(row.openNum, row.openDen, basis.factor);
    const high = componentValue(row.highNum, row.highDen, basis.factor);
    const low = componentValue(row.lowNum, row.lowDen, basis.factor);
    const close = componentValue(row.closeNum, row.closeDen, basis.factor);
    if (open === null || high === null || low === null || close === null) continue;
    if (!isChartOhlc(open, high, low, close)) continue;
    out.push({ time: row.bucketStartSec as Time, open, high, low, close });
  }
  out.sort((a, b) => Number(a.time) - Number(b.time));
  return out;
}

/**
 * The settle watermark for `renderAppendOnly` / `applyProvisionalTip` —
 * the newest canonical bucket time, or `-Infinity` for an empty series.
 * See the module header for why the newest SERVED bucket is the boundary.
 */
export function evmCanonicalThroughSec(candles: readonly CandlestickData<Time>[]): number {
  return candles.length > 0
    ? Number(candles[candles.length - 1]!.time)
    : Number.NEGATIVE_INFINITY;
}

/**
 * Synthesize the PROVISIONAL tip from the trade tape — the Solana pattern:
 * the chart tip between candle refetches is client-built from trades, and it
 * never settles anything (`applyProvisionalTip` merges it into the canonical
 * tip on equal bucket keys and appends it ahead; the append-only renderer
 * keeps everything at/&ge; the watermark mutable).
 *
 * Each trade's price is the exact `cost / amount` base-unit ratio — the same
 * family as the candle `num/den` ratios, so the same basis factor applies.
 *
 * Rules:
 * - Only trades bucketing AT or AHEAD of `canonicalThroughSec` contribute;
 *   older trades are already inside canonical buckets.
 * - A trade with no block time (`occurredAtMs: null`) cannot be bucketed and
 *   is skipped — unknown-time is not now-time.
 * - A zero or unparseable ratio is skipped: a zero-priced tape row must not
 *   drag the live tip to zero (absent ≠ zero, applied to the tip).
 * - Within a bucket trades fold in chain order (time, then the canonical
 *   position triple, then feed seq): open = first, close = last, high/low =
 *   extremes.
 */
export function synthesizeEvmTipCandles(
  entries: readonly EvmTapeEntry[],
  stepSec: number,
  canonicalThroughSec: number,
  basis: EvmChartBasis,
): CandlestickData<Time>[] {
  if (entries.length === 0 || !Number.isFinite(stepSec) || stepSec <= 0) return [];
  const usable: Array<{ entry: EvmTapeEntry; sec: number; value: number }> = [];
  for (const entry of entries) {
    if (entry.occurredAtMs === null) continue;
    const bucketSec = Math.floor(entry.occurredAtMs / 1_000 / stepSec) * stepSec;
    if (bucketSec < canonicalThroughSec) continue;
    const ratio = ratioToChartFloat(entry.cost, entry.amount);
    if (ratio === null || ratio <= 0) continue;
    const value = ratio * basis.factor;
    if (!Number.isFinite(value) || Math.abs(value) > CHART_MAX_ABS_VALUE) continue;
    usable.push({ entry, sec: bucketSec, value });
  }
  if (usable.length === 0) return [];
  usable.sort((a, b) => compareTapeChainOrder(a.entry, b.entry));
  const out: CandlestickData<Time>[] = [];
  for (const { sec, value } of usable) {
    const current = out[out.length - 1];
    if (current === undefined || Number(current.time) !== sec) {
      out.push({ time: sec as Time, open: value, high: value, low: value, close: value });
      continue;
    }
    current.high = Math.max(current.high, value);
    current.low = Math.min(current.low, value);
    current.close = value;
  }
  return out;
}

/** Ascending chain order: block time, then the canonical triple, then seq. */
function compareTapeChainOrder(left: EvmTapeEntry, right: EvmTapeEntry): number {
  const timeDiff = (left.occurredAtMs ?? 0) - (right.occurredAtMs ?? 0);
  if (timeDiff !== 0) return timeDiff;
  if (left.position !== null && right.position !== null) {
    return (
      left.position.blockNumber - right.position.blockNumber ||
      left.position.txIndex - right.position.txIndex ||
      left.position.logIndex - right.position.logIndex
    );
  }
  return (left.seq ?? 0) - (right.seq ?? 0);
}

/** One OHLC component: ratio × basis factor, or `null` (gap, not zero). */
function componentValue(
  num: string | undefined,
  den: string | undefined,
  factor: number,
): number | null {
  const ratio = ratioToChartFloat(num, den);
  if (ratio === null) return null;
  const value = ratio * factor;
  return Number.isFinite(value) ? value : null;
}

/**
 * A base-unit price ratio as a float — chart geometry's copy of
 * `money.ts::ratioToPlotValue`, at 10^24 fixed-point instead of 10^12 (see
 * `RATIO_SCALE_DIGITS`). Same contract otherwise: `null` for an absent or
 * malformed pair or a zero denominator; a genuine zero price (num=0, den>0)
 * returns 0; a non-zero ratio the scale cannot express returns `null`, never
 * a fabricated 0 the chart happily draws.
 */
export function ratioToChartFloat(
  num: string | null | undefined,
  den: string | null | undefined,
): number | null {
  const numerator = parseWire(num ?? null);
  const denominator = parseWire(den ?? null);
  if (numerator === null || denominator === null || denominator === 0n) return null;
  if (numerator === 0n) return 0;
  const fixed = (numerator * RATIO_SCALE) / denominator;
  if (fixed === 0n) return null;
  const value = Number(fixed) / RATIO_SCALE_NUMBER;
  return Number.isFinite(value) ? value : null;
}

/**
 * A wire integer at `decimals` scale as a float — for BASIS FACTORS ONLY
 * (the geometry exemption, module header). Every rendered figure keeps
 * coming from the BigInt formatters in `money.ts`. Whole part divides in
 * BigInt so supply-scale words keep their leading digits exactly.
 */
function wireToGeometryFloat(
  raw: string | null | undefined,
  decimals: number,
): number | null {
  const value = parseWire(raw ?? null);
  if (value === null) return null;
  const scale = 10n ** BigInt(decimals);
  const scaled = Number(value / scale) + Number(value % scale) / Number(scale);
  return Number.isFinite(scaled) ? scaled : null;
}

/** Same OHLC sanity gate the Solana adapter applies (`isChartOhlc`). */
function isChartOhlc(open: number, high: number, low: number, close: number): boolean {
  return (
    [open, high, low, close].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= CHART_MAX_ABS_VALUE,
    )
    && high >= Math.max(open, low, close)
    && low <= Math.min(open, high, close)
  );
}

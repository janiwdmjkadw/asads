import type { CandlestickData, Time } from 'lightweight-charts';
import type { CandleResolution } from './types';

// Chart display timeframes. The server streams/serves five native candle
// resolutions; the four extended timeframes (5s, 4h, 12h, 1d) are
// client-side aggregations of a native base — `timeframeFetchPlan` maps a
// display timeframe to (base resolution, group size), and
// `aggregateCandles` folds fetched base candles into display buckets.
// This keeps live streaming, history paging and prewarming entirely on
// the existing native pipelines.

export const CHART_TIMEFRAMES = [
  '1s',
  '5s',
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '12h',
  '1d',
] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

/** The chart footer's quick-toggle subset (the toolbar popup has all). */
export const QUICK_TIMEFRAMES: readonly ChartTimeframe[] = ['1s', '5m', '1h', '4h'];

export function chartTimeframeSeconds(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case '1s':
      return 1;
    case '5s':
      return 5;
    case '1m':
      return 60;
    case '5m':
      return 5 * 60;
    case '15m':
      return 15 * 60;
    case '1h':
      return 60 * 60;
    case '4h':
      return 4 * 60 * 60;
    case '12h':
      return 12 * 60 * 60;
    case '1d':
      return 24 * 60 * 60;
  }
}

export interface TimeframeFetchPlan {
  /** Native resolution fetched/streamed from the server. */
  resolution: CandleResolution;
  /** Base buckets folded into one display bucket (1 = native). */
  group: number;
}

export function timeframeFetchPlan(timeframe: ChartTimeframe): TimeframeFetchPlan {
  switch (timeframe) {
    case '5s':
      return { resolution: '1s', group: 5 };
    case '4h':
      return { resolution: '1h', group: 4 };
    case '12h':
      return { resolution: '1h', group: 12 };
    case '1d':
      return { resolution: '1h', group: 24 };
    default:
      return { resolution: timeframe, group: 1 };
  }
}

/**
 * Fold ascending base candles into display buckets: open of the first,
 * close of the last, high/low extremes; bucket time floors to the display
 * size so live tip updates keep mutating the final bucket in place.
 * Native timeframes pass through untouched (same array identity — the
 * chart's O(1) `series.update` fast path stays intact).
 */
export function aggregateCandles(
  candles: CandlestickData<Time>[],
  timeframe: ChartTimeframe,
): CandlestickData<Time>[] {
  const { group } = timeframeFetchPlan(timeframe);
  if (group === 1 || candles.length === 0) return candles;
  return foldFrom(candles, chartTimeframeSeconds(timeframe), 0).out;
}

/** The fold core: aggregates `candles[startIdx..]` into display buckets and
 *  reports the input index where the final (still-open) bucket began — the
 *  incremental aggregator's resume point. */
function foldFrom(
  candles: CandlestickData<Time>[],
  size: number,
  startIdx: number,
): { out: CandlestickData<Time>[]; lastBucketStartIdx: number } {
  const out: CandlestickData<Time>[] = [];
  let current: CandlestickData<Time> | null = null;
  let currentBucket = Number.NaN;
  let lastBucketStartIdx = startIdx;
  for (let i = startIdx; i < candles.length; i += 1) {
    const candle = candles[i]!;
    const bucket = Math.floor(Number(candle.time) / size) * size;
    if (current == null || bucket !== currentBucket) {
      current = {
        time: bucket as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
      currentBucket = bucket;
      lastBucketStartIdx = i;
      out.push(current);
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
  }
  return { out, lastBucketStartIdx };
}

interface CandleAggregatorCache {
  timeframe: ChartTimeframe;
  input: CandlestickData<Time>[];
  output: CandlestickData<Time>[];
  /** Index into `input` where the final output bucket's fold began. */
  lastBucketStartIdx: number;
}

/**
 * Incremental `aggregateCandles`: the base series' identity churns on every
 * live candle event (~2-3×/sec on a busy mint), but between events only the
 * tail changes — the settled base is append-only and closed candle objects
 * are identity-shared across passes. Re-folding the whole array per tick was
 * O(all candles) of pure re-derivation; this reuses the previous fold's
 * CLOSED display buckets when the input prefix is identity-identical (an
 * exact proof — repriced/rebuilt/prepended series fail it and take the full
 * fold) and re-folds only from where the final bucket began.
 *
 * One aggregator per chart instance (call the factory in a ref) — the cache
 * is single-slot, so sharing it across charts would thrash.
 */
export function createCandleAggregator(): (
  candles: CandlestickData<Time>[],
  timeframe: ChartTimeframe,
) => CandlestickData<Time>[] {
  let cache: CandleAggregatorCache | null = null;
  return (candles, timeframe) => {
    const { group } = timeframeFetchPlan(timeframe);
    if (group === 1 || candles.length === 0) {
      cache = null;
      return candles;
    }
    if (cache && cache.timeframe === timeframe && cache.input === candles) {
      return cache.output;
    }
    const size = chartTimeframeSeconds(timeframe);
    if (cache && cache.timeframe === timeframe) {
      const boundary = cache.lastBucketStartIdx;
      // Tail reuse is sound iff (a) every input candle the closed buckets
      // were folded from is the SAME object, and (b) the new boundary candle
      // does not fall back INTO the last closed bucket (it opened a fresh
      // bucket in the cached fold, but its object may have been replaced).
      if (candles.length > boundary && prefixShared(candles, cache.input, boundary)) {
        const lastClosed = cache.output.length >= 2 ? Number(cache.output[cache.output.length - 2]!.time) : null;
        const boundaryBucket = Math.floor(Number(candles[boundary]!.time) / size) * size;
        if (lastClosed === null || boundaryBucket !== lastClosed) {
          const tail = foldFrom(candles, size, boundary);
          const output = cache.output.slice(0, cache.output.length - 1).concat(tail.out);
          cache = { timeframe, input: candles, output, lastBucketStartIdx: tail.lastBucketStartIdx };
          return output;
        }
      }
    }
    const full = foldFrom(candles, size, 0);
    cache = { timeframe, input: candles, output: full.out, lastBucketStartIdx: full.lastBucketStartIdx };
    return full.out;
  };
}

/** Identity-equality of the first `count` elements — the exact (and cheap:
 *  pointer compares) proof that the closed buckets' source data is unchanged. */
function prefixShared(
  a: CandlestickData<Time>[],
  b: CandlestickData<Time>[],
  count: number,
): boolean {
  if (a.length < count || b.length < count) return false;
  for (let i = 0; i < count; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

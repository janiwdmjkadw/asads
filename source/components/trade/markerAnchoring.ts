import { chartTimeframeSeconds, type ChartTimeframe } from './timeframes';

/**
 * Chart-marker candle anchoring (wallet bubbles, thesis bubbles, the
 * graduation marker): snap an event timestamp onto a LOADED candle so
 * the marker NEVER silently vanishes.
 *
 * Rule: exact bucket match → containing candle → otherwise the nearest
 * loaded candle AT-OR-BEFORE the event's bucket (standard floor
 * anchoring — sparse-candle mints have gaps between buckets, and the
 * old ±tolerance approach dropped in-range markers there). Events
 * OUTSIDE the loaded window clamp to the nearest edge candle: newer →
 * the last candle (clock-skew guard), older → the FIRST candle. The
 * older-edge clamp is what keeps sniper/bundler/dev LAUNCH buys (and
 * the graduation M) visible on fine timeframes — the initial history
 * fetch is 1,500 candles (25 minutes at 1s), so a coin's slot-1-4 buys
 * fall outside the window minutes after launch and previously dropped
 * outright (live repro Jul 7 2026). A clamped marker's hover still
 * shows the true timestamp, and it slides to its exact bucket when
 * scrollback pages that history in (the marker model rebuilds whenever
 * the candle time-set changes). Null only when NO candles are loaded.
 */
export function findMarkerCandleTime(
  eventMs: number,
  timeframe: ChartTimeframe,
  candleTimes: number[],
): number | null {
  if (candleTimes.length === 0) return null;
  const bucketStartSec = bucketStartSeconds(eventMs, timeframe);
  // Older than loaded history: pin to the left edge until paged in.
  if (bucketStartSec < candleTimes[0]!) return candleTimes[0]!;
  // Binary search: greatest loaded candle time <= the event's bucket.
  // Covers exact matches, events inside a candle's span, gap events
  // (snap to the candle before the gap) and future clamping in one pass.
  let lo = 0;
  let hi = candleTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candleTimes[mid]! <= bucketStartSec) lo = mid;
    else hi = mid - 1;
  }
  return candleTimes[lo]!;
}

export function bucketStartSeconds(ms: number, timeframe: ChartTimeframe): number {
  const seconds = Math.floor(ms / 1_000);
  const size = chartTimeframeSeconds(timeframe);
  return Math.floor(seconds / size) * size;
}

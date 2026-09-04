/**
 * Candles → a discover-card sparkline.
 *
 * Pure geometry and pure selection; no React, no fetch. The rules that matter
 * are all here rather than in the component, because they are claims about
 * data rather than about pixels:
 *
 * - **A bucket with no price is a GAP, not a zero.** the backend source
 *   omits `closeNum`/`closeDen` together when the bucket's price is undefined,
 *   and drawing a 0 there produces a cliff to the floor and back — a chart
 *   that shows a crash that did not happen. Priceless buckets are skipped and
 *   the line joins the buckets either side of them.
 * - **A stale bucket is drawn, and the caller is told.** `needsRecompute`
 *   means a reorg invalidated it and the recompute has not landed. Hiding it
 *   destroys the evidence that a recompute is owed; the series reports
 *   staleness so the render can degrade visibly.
 * - **Fewer than two priced buckets is NOT a flat line.** One point has no
 *   trend, and a horizontal line asserts one. That case returns `null` and the
 *   card renders nothing at all.
 * - **The float is pixel geometry only.** `ratioToPlotValue` divides in BigInt
 *   fixed-point first and is documented as never feeding text. Nothing here
 *   returns a number to be displayed.
 */

import type { EvmCandleRow, EvmCandleSeries } from './tradeApi';
import { ratioToPlotValue } from './money';

/** Buckets drawn. A card sparkline is ~64px wide; more points is mud. */
export const SPARKLINE_POINTS = 48;

export interface EvmSparkline {
  /** Plot values, oldest → newest. Length >= 2 by construction. */
  readonly values: readonly number[];
  /** True when the newest priced bucket closed at or above the oldest. */
  readonly up: boolean;
  /** True when ANY drawn bucket is awaiting a post-reorg recompute. */
  readonly stale: boolean;
}

/**
 * Select the drawable tail of a candle series.
 *
 * `null` when there is nothing honest to draw — no series, or fewer than two
 * buckets that actually carry a price.
 */
export function toSparkline(series: EvmCandleSeries | null | undefined): EvmSparkline | null {
  if (series === null || series === undefined) return null;
  const rows = series.candles;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  /* Oldest → newest by bucket start. The wire's own order is not relied on:
     a chart drawn in the wrong direction is a chart that says the opposite of
     the truth, and the sort is O(n log n) on at most a thousand rows. */
  const ordered = [...rows].sort((left, right) => left.bucketStartSec - right.bucketStartSec);
  const values: number[] = [];
  let stale = false;
  for (const row of ordered.slice(-SPARKLINE_POINTS)) {
    const value = closeValue(row);
    // A priceless bucket contributes NOTHING — not a zero, not a repeat of
    // the previous close (which would invent a flat segment nobody measured).
    if (value === null) continue;
    values.push(value);
    if (row.needsRecompute) stale = true;
  }
  if (values.length < 2) return null;
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  return { values, up: last >= first, stale: stale || series.stale === true };
}

function closeValue(row: EvmCandleRow): number | null {
  const value = ratioToPlotValue(row.closeNum, row.closeDen);
  // A non-finite or non-positive price is not a price. `<= 0` cannot happen on
  // a real ratio of unsigned integers, so reaching it means the bucket is
  // malformed and drawing it would move the whole y-scale.
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * An SVG polyline `points` string for a sparkline in a `width` × `height` box.
 *
 * The y-scale is the series' own min/max, not zero-based: a card sparkline is
 * a SHAPE, and zero-basing a token that moved 2% renders every one of them as
 * the same flat line. A perfectly flat series (min === max) is drawn on the
 * vertical centre rather than dividing by zero.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  padding = 1,
): string {
  if (values.length < 2) return '';
  let min = values[0] as number;
  let max = min;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const innerH = Math.max(height - padding * 2, 0);
  const stepX = width / (values.length - 1);
  const out: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    const ratio = span === 0 ? 0.5 : (value - min) / span;
    const x = i * stepX;
    // SVG y grows downward; a higher price must sit higher on screen.
    const y = padding + (1 - ratio) * innerH;
    out.push(`${round(x)},${round(y)}`);
  }
  return out.join(' ');
}

/** Two decimals is sub-pixel at these sizes and keeps the markup small. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

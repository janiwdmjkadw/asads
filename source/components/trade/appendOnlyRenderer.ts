import type { CandlestickData, Time } from 'lightweight-charts';
import { bridgeCandleOpens, dropIsolatedSpikeCandles } from './snapshotAdapter';

/**
 * APPEND-ONLY RENDERER — the chart's render-stability invariant, enforced by
 * construction rather than by masking.
 *
 * Earlier approaches froze the INPUT series but still re-ran the spike
 * filter + open-bridge over the whole array every render; both passes are
 * context-sensitive to the moving tip, so borderline decisions near the live
 * edge oscillated and visibly re-formed bars that looked finished (the
 * artifact that survived every data-lineage fix). Here, each bar is rendered
 * EXACTLY ONCE — at the moment its successor appears — using only
 * already-settled context, and is then immutable for the session:
 *
 *   - settled bars never change value, never shift, never disappear
 *   - later corrections to settled buckets are ignored mid-session
 *     (full truth renders on the next mount/refetch)
 *   - only the forming tip is mutable
 *
 * The settled base rebuilds only when `stableKey` changes (mint/timeframe
 * switch, stream resync) or when the merged window's base extends OLDER
 * (history landing / loadOlder prepend) — explicit gestures, never live
 * ticks.
 *
 * Pure module: state in, state out. The hook owns the ref; everything here
 * is unit-testable without React.
 */
export interface AppendOnlyState {
  key: string;
  /** First bucket time of the settled base (rebuild detector). */
  baseTime: number | null;
  /** Settled, immutable bars (post filter + bridge). */
  bars: CandlestickData<Time>[];
  /** Newest settled bucket time; buckets at/below it are write-once-done. */
  settledThrough: number;
}

/** Settled-bar junk guard: a bar whose high is wildly off the last settled
 *  close (>=100x either direction) is junk (failed denominator / bad
 *  payload), not market action — skipped so one bad bucket cannot distort
 *  the chain. Decided ONCE per bar against stable context, so it can never
 *  oscillate. */
export const SETTLED_SPIKE_RATIO = 100;

export function emptyAppendOnlyState(key: string): AppendOnlyState {
  return {
    key,
    baseTime: null,
    bars: [],
    settledThrough: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Advance the renderer with the latest merged series and return the bars to
 * draw. Mutates `state` in place (the hook holds it in a ref); the RETURNED
 * array is always a fresh copy, safe to hand to the chart.
 *
 * `canonicalThroughSec` is the newest CANONICAL bucket time in `merged`.
 * A bucket may only settle once a canonical successor proves it complete —
 * a PROVISIONAL successor (the client-synthesized live tip) proves nothing,
 * so buckets at/beyond the canonical watermark stay in a small mutable zone
 * rendered fresh each pass (canonical tip + provisional extension), never
 * stored. With the default (+Infinity, no provisional feed) the mutable zone
 * is exactly the single newest bucket — the pre-provisional behavior.
 */
export function renderAppendOnly(
  state: AppendOnlyState,
  merged: CandlestickData<Time>[],
  stableKey: string,
  canonicalThroughSec: number = Number.POSITIVE_INFINITY,
): { state: AppendOnlyState; bars: CandlestickData<Time>[] } {
  if (merged.length === 0) {
    const next = state.key !== stableKey ? emptyAppendOnlyState(stableKey) : state;
    return { state: next, bars: [...next.bars] };
  }

  let current = state;
  const baseTime = Number(merged[0]!.time);
  const tipTime = Number(merged[merged.length - 1]!.time);
  // Nothing at/beyond the canonical watermark may settle; the newest bucket
  // never settles regardless (it has no successor at all).
  const settleBelow = Math.min(canonicalThroughSec, tipTime);
  // Rebuild ONLY on key change or when the base extends OLDER. The window's
  // start ADVANCING is normal live operation (overlay pruning) and must not
  // rebuild — that would feed the moving tip back into settled decisions,
  // recreating the oscillation this renderer exists to kill.
  if (current.key !== stableKey || current.baseTime === null || baseTime < current.baseTime) {
    // Deterministic settled base: filter + bridge over settled data only —
    // the mutable zone is excluded so its motion can never influence settled
    // decisions.
    const settledInput = merged.filter((candle) => Number(candle.time) < settleBelow);
    current = {
      key: stableKey,
      baseTime,
      bars: bridgeCandleOpens(dropIsolatedSpikeCandles(settledInput)),
      // Watermark from the INPUT (not the filtered output): a bar the
      // windowed filter dropped stays dropped — it must not re-enter via
      // the per-append path.
      settledThrough: settledInput.length > 0
        ? Number(settledInput[settledInput.length - 1]!.time)
        : Number.NEGATIVE_INFINITY,
    };
  }

  // Settle every bucket strictly between the watermark and the mutable zone:
  // bridged from the last settled close, junk-guarded, then immutable.
  for (const candle of merged) {
    const time = Number(candle.time);
    if (time <= current.settledThrough || time >= settleBelow) continue;
    appendSettledBar(current.bars, candle);
    current.settledThrough = time;
  }

  // The mutable zone (canonical tip + any provisional successors) rides on
  // top, bridged in sequence but never stored — free to change value or
  // disappear until canonical data settles it.
  const bars = [...current.bars];
  for (const candle of merged) {
    if (Number(candle.time) <= current.settledThrough) continue;
    const prev = bars[bars.length - 1];
    bars.push(prev ? bridgeFromPrev(prev, candle) : candle);
  }
  return { state: current, bars };
}

/** Append `candle` as a settled bar: junk-guarded, bridged, immutable. */
export function appendSettledBar(
  bars: CandlestickData<Time>[],
  candle: CandlestickData<Time>,
): void {
  const prev = bars[bars.length - 1];
  if (prev !== undefined && prev.close > 0) {
    const ratio = candle.high / prev.close;
    if (ratio >= SETTLED_SPIKE_RATIO || ratio <= 1 / SETTLED_SPIKE_RATIO) {
      return; // junk bucket; the next bar bridges across it
    }
  }
  bars.push(prev ? bridgeFromPrev(prev, candle) : candle);
}

/** Chain `candle`'s open from the previous rendered close (widening
 *  high/low to keep OHLC sane). Single-append form of `bridgeCandleOpens`. */
export function bridgeFromPrev(
  prev: CandlestickData<Time>,
  candle: CandlestickData<Time>,
): CandlestickData<Time> {
  if (candle.open === prev.close) return candle;
  return {
    ...candle,
    open: prev.close,
    high: Math.max(candle.high, prev.close),
    low: Math.min(candle.low, prev.close),
  };
}

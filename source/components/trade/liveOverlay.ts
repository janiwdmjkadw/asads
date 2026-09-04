import type { SnapshotCandle, TokenTrade } from './types';

const DEFAULT_LIVE_TRADE_LIMIT = 250;

// Trade objects are parse-fresh JSON and never mutated, so the key is a
// pure function of the object identity — cache it instead of rebuilding the
// 8-field string per merge pass (the sort comparator's tie-break rebuilds
// it too, so an uncached key was constructed several times per row per merge).
const tradeKeyCache = new WeakMap<TokenTrade, string>();

export function tokenTradeKey(trade: TokenTrade): string {
  const cached = tradeKeyCache.get(trade);
  if (cached !== undefined) return cached;
  const orderKey = trade.orderKey
    ? [
      trade.orderKey.slot,
      trade.orderKey.txIndex,
      trade.orderKey.ixIndex,
      trade.orderKey.logIndex,
      trade.orderKey.eventIndex,
    ].join(':')
    : '';
  const key = [
    trade.signature,
    trade.slot,
    trade.user,
    trade.isBuy ? 'b' : 's',
    trade.solLamports,
    trade.tokenBaseUnits,
    trade.arrivedAtMs,
    orderKey,
  ].join(':');
  tradeKeyCache.set(trade, key);
  return key;
}

export function mergeLiveTrades(
  base: readonly TokenTrade[],
  incoming: TokenTrade | readonly TokenTrade[],
  limit = DEFAULT_LIVE_TRADE_LIMIT,
): TokenTrade[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_LIVE_TRADE_LIMIT;
  if (cappedLimit === 0) return [];
  // Single-trade fast path — the per-SSE-message shape. Assumes `base` is
  // prior mergeLiveTrades output (sorted newest-first, deduped, capped),
  // which holds for the sole single-trade caller (the live-trade handler);
  // array callers merge arbitrary row sets (snapshot/history bases with no
  // sort guarantee) and stay on Map+sort.
  if (!Array.isArray(incoming)) {
    // `Array.isArray` narrows readonly arrays only in the positive branch.
    return mergeSingleLiveTrade(base, incoming as TokenTrade, cappedLimit);
  }
  const nextTrades: readonly TokenTrade[] = incoming;
  const byKey = new Map<string, TokenTrade>();
  for (const trade of base) byKey.set(tokenTradeKey(trade), trade);
  for (const trade of nextTrades) byKey.set(tokenTradeKey(trade), trade);
  return [...byKey.values()]
    .sort(compareTradesNewestFirst)
    .slice(0, cappedLimit);
}

function mergeSingleLiveTrade(
  base: readonly TokenTrade[],
  trade: TokenTrade,
  cappedLimit: number,
): TokenTrade[] {
  const key = tokenTradeKey(trade);
  for (let index = 0; index < base.length; index += 1) {
    if (tokenTradeKey(base[index]!) === key) {
      // Map.set overwrite semantics: the incoming object wins. Every
      // comparator field is embedded in the key, so its sort position is
      // exactly the replaced row's.
      const replaced = base.slice();
      replaced[index] = trade;
      return replaced.length > cappedLimit ? replaced.slice(0, cappedLimit) : replaced;
    }
  }
  // New key: binary-insert into the sorted base. Distinct keys never compare
  // equal (the comparator tie-breaks on the key), so the position is unique.
  let lo = 0;
  let hi = base.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareTradesNewestFirst(base[mid]!, trade) <= 0) lo = mid + 1;
    else hi = mid;
  }
  const inserted = base.slice();
  inserted.splice(lo, 0, trade);
  return inserted.length > cappedLimit ? inserted.slice(0, cappedLimit) : inserted;
}

export function mergeSnapshotCandleBuckets(
  base: readonly SnapshotCandle[],
  incoming: readonly SnapshotCandle[],
): SnapshotCandle[] {
  if (base.length === 0) return [...incoming].sort(compareCandlesAscending);
  if (incoming.length === 0) return [...base].sort(compareCandlesAscending);
  const byKey = new Map<string, SnapshotCandle>();
  for (const candle of base) byKey.set(snapshotCandleKey(candle), candle);
  for (const candle of incoming) byKey.set(snapshotCandleKey(candle), candle);
  return [...byKey.values()].sort(compareCandlesAscending);
}

export function snapshotCandleKey(candle: SnapshotCandle): string {
  return `${candle.resolution}:${candle.bucketStartSec}`;
}

const RESOLUTION_SECONDS: Record<string, number> = {
  '1s': 1,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
};

/** Forming bucket + two just-settled buckets per resolution. */
export const LIVE_OVERLAY_KEEP_BUCKETS = 3;

/**
 * Trim a live candle overlay to the recent edge it exists to supply: per
 * resolution, the forming bucket plus `keepBuckets - 1` just-settled ones.
 *
 * The overlay's job is ONLY the live tip — closed history is owned by the
 * server's candle pages (settled canonical block-time buckets). Live SSE
 * candles are PROVISIONAL (arrival-time bucketing), and the chart's merge
 * lets the overlay win on equal bucket keys; an overlay that accumulates
 * for a whole session therefore permanently overrides settled history with
 * stale provisional values (mis-bucketed or mis-priced bars that vanish on
 * refresh) and grows without bound. Pruning cedes everything behind the
 * tip back to the server series.
 */
export function pruneSnapshotCandleBuckets(
  candles: readonly SnapshotCandle[],
  keepBuckets: number = LIVE_OVERLAY_KEEP_BUCKETS,
): SnapshotCandle[] {
  if (candles.length === 0) return [];
  const keep = Math.max(1, Math.floor(keepBuckets));
  const maxByResolution = new Map<string, number>();
  for (const candle of candles) {
    const max = maxByResolution.get(candle.resolution);
    if (max == null || candle.bucketStartSec > max) {
      maxByResolution.set(candle.resolution, candle.bucketStartSec);
    }
  }
  return candles.filter((candle) => {
    const resolutionSec = RESOLUTION_SECONDS[candle.resolution] ?? 1;
    const max = maxByResolution.get(candle.resolution) ?? candle.bucketStartSec;
    return candle.bucketStartSec >= max - (keep - 1) * resolutionSec;
  });
}

function compareCandlesAscending(left: SnapshotCandle, right: SnapshotCandle): number {
  const timeDiff = left.bucketStartSec - right.bucketStartSec;
  if (timeDiff !== 0) return timeDiff;
  return left.resolution.localeCompare(right.resolution);
}

function compareTradesNewestFirst(left: TokenTrade, right: TokenTrade): number {
  const arrivedDiff = right.arrivedAtMs - left.arrivedAtMs;
  if (arrivedDiff !== 0) return arrivedDiff;
  const slotDiff = right.slot - left.slot;
  if (slotDiff !== 0) return slotDiff;
  // Same-ms same-slot trades: the on-chain order key (tx/ix/log/event
  // index) is the true intra-slot order — signature-lexical put a burst's
  // trades in alphabetical, not execution, order on the tape.
  if (left.orderKey && right.orderKey) {
    const orderDiff = (right.orderKey.txIndex - left.orderKey.txIndex)
      || (right.orderKey.ixIndex - left.orderKey.ixIndex)
      || (right.orderKey.logIndex - left.orderKey.logIndex)
      || (right.orderKey.eventIndex - left.orderKey.eventIndex);
    if (orderDiff !== 0) return orderDiff;
  }
  // Final tie-break stays on the full key: every comparator input is
  // embedded in it, which the single-trade binary-insert relies on.
  return tokenTradeKey(left).localeCompare(tokenTradeKey(right));
}

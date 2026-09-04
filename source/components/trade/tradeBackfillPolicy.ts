import type { TokenSnapshot } from './types';
import {
  RIPENING_HISTORY_HYDRATION_MIN_REAL_SOL_LAMPORTS,
  type HistoryHydrationOptions,
} from './candleHistoryPolicy';

/**
 * Whether the trades table should hydrate the FULL cold history for this snapshot rather
 * than the bounded hot `recent_trades` tail. True for explicitly-backfilled coins and for
 * graduated coins — a graduated coin's hot ring is only the post-eviction tail, so its full
 * history lives in cold storage (merged with the live SSE stream on top). Mirrors
 * `shouldHydrateLatestCandleHistory`'s graduation branch.
 *
 * Pure so it can be unit-tested. The caller LATCHES the result one-way per mint (see
 * {@link latchHistoricalTradeBackfill}): `graduated`/`stateKind` oscillate between the 1s
 * REST poll and the live SSE merge mid-rehydration, so once a coin is eligible it must STAY
 * eligible — otherwise a transient `false` resets the table to the snapshot tail (the "only
 * the last few rows" flash that bit the candle chart).
 */
export function shouldUseHistoricalTradeBackfill(
  snapshot:
    | (Pick<TokenSnapshot, 'stateKind' | 'graduated' | 'graduatedAtMs'> & {
      realSolLamports?: string | null;
    })
    | null
    | undefined,
  options: HistoryHydrationOptions = {},
): boolean {
  if (!snapshot) return false;
  if (options.forceHydrate) return true;
  return (
    snapshot.stateKind === 'backfilled'
    || snapshot.graduated === true
    || snapshot.graduatedAtMs != null
    || isRipening(snapshot.realSolLamports)
    || (!options.hotOnlyNewPair && snapshot.stateKind === 'live')
  );
}

function isRipening(realSolLamports: string | null | undefined): boolean {
  if (realSolLamports == null) return false;
  const value = Number(realSolLamports);
  return Number.isFinite(value) && value >= RIPENING_HISTORY_HYDRATION_MIN_REAL_SOL_LAMPORTS;
}

/**
 * Gate a snapshot to the mint the page is actually viewing. The snapshot
 * query uses `keepPreviousData`, which spans MINT changes: on a fast
 * token-to-token navigation the cached value still belongs to the PREVIOUS
 * mint for a beat. Every consumer that derives per-mint decisions (backfill
 * latches, candle hydration, header/trade rows) must read through this gate
 * so the previous mint's data never seeds the new mint — while the same-mint
 * `hydrateIdentity` key flip keeps its keep-previous-data benefit.
 */
export function snapshotMatchesMint<T extends { mint: string }>(
  snapshot: T | null | undefined,
  mint: string | null | undefined,
): T | null {
  return snapshot != null && mint != null && snapshot.mint === mint ? snapshot : null;
}

export interface HistoricalTradeBackfillLatch {
  mint: string | null;
  latched: boolean;
}

/**
 * One-way latch for the historical-trade-backfill decision, keyed on mint. Returns the next
 * latch state given the previous one, the current mint, and the current raw eligibility:
 *
 * - mint changed → reset to the current raw eligibility (a fresh decision for the new mint).
 * - same mint, raw eligibility true → latch true (and never go back).
 * - same mint, raw eligibility false → keep the previous (possibly already-latched) value.
 *
 * This makes the gate monotonic per mint so a snapshot flip-flop can't blank the table.
 */
export function latchHistoricalTradeBackfill(
  prev: HistoricalTradeBackfillLatch,
  mint: string | null,
  rawEligible: boolean,
): HistoricalTradeBackfillLatch {
  if (prev.mint !== mint) return { mint, latched: rawEligible };
  if (rawEligible) return { mint, latched: true };
  return prev;
}

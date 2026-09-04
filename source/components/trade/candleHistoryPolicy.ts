import type { TokenSnapshot } from './types';

export const RIPENING_HISTORY_HYDRATION_MIN_REAL_SOL_LAMPORTS = 70_000_000_000;

export interface HistoryHydrationOptions {
  /** Explicit source says this token lives on a history-backed surface. */
  forceHydrate?: boolean;
  /** Explicit source says this is the fresh New Pairs hot-only path. */
  hotOnlyNewPair?: boolean;
}

export function shouldHydrateLatestCandleHistory(
  snapshot:
    | (Pick<TokenSnapshot, 'stateKind' | 'graduated' | 'graduatedAtMs'> & {
      realSolLamports?: string | null;
    })
    | null
    | undefined,
  options: HistoryHydrationOptions = {},
): boolean {
  // forceHydrate is an explicit navigation-source signal (graduated /
  // almost-graduated surfaces), so it must not wait for the snapshot: on a
  // cold full-page load the 1,500-candle latest fetch dispatches in
  // parallel with the snapshot instead of serializing behind its RTT.
  // Without it, a null snapshot stays on the hot-only path.
  if (options.forceHydrate) return true;
  if (!snapshot) return false;
  if (snapshot.stateKind === 'backfilled') return true;
  if (snapshot.graduated || snapshot.graduatedAtMs != null) return true;
  if (isRipening(snapshot.realSolLamports)) return true;
  if (options.hotOnlyNewPair) return false;
  if (snapshot.stateKind !== 'live') return false;
  return true;
}

function isRipening(realSolLamports: string | null | undefined): boolean {
  if (realSolLamports == null) return false;
  const value = Number(realSolLamports);
  return Number.isFinite(value) && value >= RIPENING_HISTORY_HYDRATION_MIN_REAL_SOL_LAMPORTS;
}

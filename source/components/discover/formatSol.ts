const LAMPORTS_PER_SOL = 1_000_000_000;

/** Lamport string → SOL, or null when the wire value isn't an integer. */
export function solFromLamports(lamports: string): number | null {
  let n: number;
  try {
    n = Number(BigInt(lamports)) / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
  return Number.isFinite(n) ? n : null;
}

/**
 * Terse SOL ladder for the ledger feed — the figure ONLY, because the
 * unit is carried by the Solana glyph beside it (never the word "SOL").
 *
 * Ladder: ≥100 → 0dp, ≥10 → 1dp, ≥1 → 2dp, <1 → 2 significant figures.
 * Digits stay inside a fixed tabular column at every magnitude, which is
 * what makes the column readable as a size ranking.
 */
export function formatSolTerse(lamports: string): string {
  const n = solFromLamports(lamports);
  if (n === null) return '?';
  if (n <= 0) return '0';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return String(parseFloat(n.toPrecision(2)));
}

/** Spoken form — the unit a screen reader (and `title`) still needs. */
export function solSpoken(lamports: string): string {
  return `${formatSolTerse(lamports)} SOL`;
}

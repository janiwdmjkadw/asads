/**
 * Discover's market-cap ink ladder, in ONE place.
 *
 * The thresholds were only ever declared inside `marketCapColorForSection`
 * (CoinCard's 'graduated' branch); the wallet-activity ledger needs the
 * same three steps for its MC column, so the ladder moved here and both
 * call sites read it. A graduated card and a ledger row therefore paint an
 * $86K token identically — which is the point of the owner's note.
 *
 * A cap we cannot state honestly (null / non-finite) takes the body ink;
 * the ledger additionally renders the em-dash for that case.
 */
export function marketCapTone(marketCapUsd: number | null | undefined): string {
  if (typeof marketCapUsd !== 'number' || !Number.isFinite(marketCapUsd)) return 'var(--ink-2)';
  if (marketCapUsd >= 85_000) return 'var(--up)';
  if (marketCapUsd >= 30_000) return 'var(--hold)';
  return 'var(--ink-2)';
}

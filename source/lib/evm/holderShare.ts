/**
 * Supply-share arithmetic for the holders panel — BigInt only.
 *
 * Both inputs are already on the trade page: a holder's `balance` and the
 * wire's `totalSupply`, and both are TOKEN BASE UNITS at the same scale — so
 * the scale cancels and no `decimals` value is needed, measured or otherwise.
 * That is what makes this a pure client-side derivation rather than a new
 * measurement.
 *
 * Doctrine:
 * - **Absent is never zero.** No supply on the wire → no share (`null`),
 *   never `0%`. An unreadable balance → `null` for that row.
 * - **A floored measurement is not an exact zero.** A real balance whose
 *   share floors to 0 bps renders as `<0.01%`, never `0.00%`.
 * - **Inconsistent data is refused, not clamped.** A balance above the
 *   supply, or a top-10 sum past 100%, is a page contradicting itself; a bar
 *   drawn from it would present the contradiction as a measurement.
 */

const BASE_UNITS = /^[0-9]+$/;

/** Share in basis points, floored. `null` when it cannot be computed. */
export function holderShareBps(
  balance: string | null | undefined,
  totalSupply: string | null | undefined,
): number | null {
  if (typeof balance !== 'string' || typeof totalSupply !== 'string') return null;
  if (!BASE_UNITS.test(balance) || !BASE_UNITS.test(totalSupply)) return null;
  const supply = BigInt(totalSupply);
  if (supply === 0n) return null;
  const held = BigInt(balance);
  // More than 100% of supply is not a share, it is a contradiction between
  // two reads. Refused rather than clamped: a clamped "100%" would be a
  // confident statement built on data we know is wrong.
  if (held > supply) return null;
  // Bounded by 10_000, so the Number conversion is exact.
  return Number((held * 10_000n) / supply);
}

/** `12.34%`, or `<0.01%` when the floor ate a real balance. */
export function shareBpsText(bps: number): string {
  if (bps === 0) return '<0.01%';
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `${whole}.${String(frac).padStart(2, '0')}%`;
}

/** One holder's share as display text, or `null` when it cannot be said. */
export function holderShareText(
  balance: string | null | undefined,
  totalSupply: string | null | undefined,
): string | null {
  const bps = holderShareBps(balance, totalSupply);
  return bps === null ? null : shareBpsText(bps);
}

export interface TopHoldersDistribution {
  /** Up to the first ten holders, in the order the page ranked them. */
  segments: ReadonlyArray<{ address: string; bps: number }>;
  /** Sum of the segment shares, in basis points. */
  totalBps: number;
}

/**
 * The top-10 distribution, or `null` when it cannot be computed honestly.
 *
 * ALL-OR-NOTHING on purpose: one unreadable balance poisons the whole bar,
 * because a bar drawn without it understates concentration — the single
 * figure this widget exists to state — while looking complete.
 */
export function topHoldersDistribution(
  holders: ReadonlyArray<{ address: string; balance: string }>,
  totalSupply: string | null | undefined,
): TopHoldersDistribution | null {
  if (typeof totalSupply !== 'string') return null;
  const top = holders.slice(0, 10);
  if (top.length === 0) return null;
  const segments: Array<{ address: string; bps: number }> = [];
  let totalBps = 0;
  for (const holder of top) {
    const bps = holderShareBps(holder.balance, totalSupply);
    if (bps === null) return null;
    segments.push({ address: holder.address, bps });
    totalBps += bps;
  }
  // Ten wallets holding more than the supply is the same contradiction as
  // one wallet doing it. Refuse the whole figure.
  if (totalBps > 10_000) return null;
  return { segments, totalBps };
}

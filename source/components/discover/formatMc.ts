/** The MC column's "no honest figure" mark — the same em-dash the ledger
 *  already uses for an unknown ticker, so the row has one vocabulary for
 *  "we don't know". */
export const MC_UNKNOWN = '—';

/**
 * Compact at-trade market cap for the ledger's MC column: `"86K"`,
 * `"1.2M"`, `"44.8M"`.
 *
 * BARE — no `$` sigil. The column is headed MC and its neighbours carry
 * their own units (the Solana glyph on the amount), so the currency mark
 * is noise the row does not need.
 *
 * One decimal at most (the column is ~46px and must not compete with the
 * amount), a bare `.0` trimmed, and three digits max at every magnitude —
 * `100K`+ drops the decimal entirely.
 *
 * `lib/format.compactUsd` is deliberately NOT reused: its 2-decimal ladder
 * is wider (`"$1.23M"`), and its "first decimal is 0 ⇒ round to integer"
 * rule turns 2.05M into `"$2M"` — dropping a digit the column has room for.
 *
 * Null / non-finite / non-positive render as {@link MC_UNKNOWN}, never `0`.
 */
export function formatMcCompact(mc: number | null | undefined): string {
  if (mc == null || !Number.isFinite(mc) || mc <= 0) return MC_UNKNOWN;
  if (mc >= 1e9) return tier(mc / 1e9, 'B');
  if (mc >= 1e6) return tier(mc / 1e6, 'M');
  if (mc >= 1e3) return tier(mc / 1e3, 'K');
  return `${roundHalfUp(mc, 0)}`;
}

const NEXT_TIER = { K: 'M', M: 'B', B: null } as const;

function tier(scaled: number, suffix: 'K' | 'M' | 'B'): string {
  const rounded = roundHalfUp(scaled, scaled >= 100 ? 0 : 1);
  // Rounded across the top of its own tier (999_960 ⇒ "999.96K" ⇒ 1000K).
  // Promote rather than print a four-digit prefix.
  const next = NEXT_TIER[suffix];
  if (rounded >= 1000 && next !== null) return `1${next}`;
  // Number#toString already drops a trailing ".0" (86.0 ⇒ "86").
  return `${rounded}${suffix}`;
}

/**
 * Half-up rounding on the DECIMAL value rather than on its binary float.
 * `2.05 * 10` is `20.499999999999996`, so a naive `Math.round` renders
 * 2.05M as "$2M"; trimming the representation error first gives "$2.1M".
 */
function roundHalfUp(value: number, decimals: 0 | 1): number {
  const factor = decimals === 1 ? 10 : 1;
  return Math.round(Number((value * factor).toPrecision(12))) / factor;
}

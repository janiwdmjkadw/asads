/**
 * Slice "Portfolio Spot tab": display formatters.
 *
 * Used by every Spot UI component so a single place owns the
 * USD / amount / time formatting. Pure, deterministic, never throws.
 */

/**
 * Grouped digits. `(8966.3).toFixed(2)` is `8966.30`, and a four figure
 * dollar amount with no separator is the single most common way a money
 * column stops being readable — it was printing `$8966.30` next to
 * `$19,862.40`, which do not even look like the same kind of number.
 */
function grouped(abs: number, dp: number): string {
  return abs.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/**
 * ONE set of thresholds for money, used by both of the compact
 * formatters below: millions at 1M, thousands at 10K, grouped digits
 * under that.
 *
 * They disagreed before — `formatUsd` cut over to K at 10,000 and
 * `formatSignedUsd` at 1,000 — so the same $8,966 was `$8,966.30` in
 * the holdings column and `$8.97K` in the figure above it.
 */
function money(abs: number): string {
  if (abs >= 1_000_000) return `$${grouped(abs / 1_000_000, 2)}M`;
  if (abs >= 10_000) return `$${grouped(abs / 1_000, 1)}K`;
  if (abs >= 1) return `$${grouped(abs, 2)}`;
  if (abs >= 0.01) return `$${abs.toFixed(3)}`;
  if (abs > 0) return `$${abs.toFixed(6)}`;
  return '$0.00';
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  /* A true minus, not a hyphen: it is the width of a digit, so a
     negative figure still lines up in a tabular column. */
  return `${value < 0 ? '−' : ''}${money(Math.abs(value))}`;
}

export function formatUsdFull(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value < 0 ? '−' : ''}$${grouped(Math.abs(value), 2)}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatSignedUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${money(Math.abs(value))}`;
}

/**
 * Signed, and never abbreviated. For the figures directly under the
 * hero total, where `+$12.5K` beside `$48,206.14` reads as a different
 * class of number — the reader is comparing them, so they are set the
 * same way.
 */
export function formatSignedUsdFull(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}$${grouped(Math.abs(value), 2)}`;
}

export function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000_000) return `${sign}${grouped(abs / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${sign}${grouped(abs / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${sign}${grouped(abs / 1_000, 2)}K`;
  /* Two places, not three. A token balance is read against a dollar
     column set to two, and `94.200` beside `$19,862.40` reads as a
     figure of different precision rather than a different unit. */
  if (abs >= 1) return `${sign}${grouped(abs, 2)}`;
  if (abs >= 0.001) return `${sign}${abs.toFixed(5)}`;
  if (abs > 0) return `${sign}${abs.toExponential(2)}`;
  return '0';
}

export function truncateMint(mint: string): string {
  if (mint.length <= 13) return mint;
  return `${mint.slice(0, 5)}…${mint.slice(-7)}`;
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Returns a vivid rgba color interpolating red → neutral → green by
 * PnL percent. Used to color treemap tiles. `null` returns a soft
 * neutral.
 *
 * Three-stop interpolation (red → neutral grey → green) gives the
 * gradient extra "punch" near zero — small PnL movements aren't
 * washed out into a single muddy color the way a two-stop lerp does.
 * Intensity scales with magnitude so a +20% tile is unmistakably
 * brighter than a +2% tile.
 */
export function pnlColor(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) {
    return 'rgba(138, 149, 145, 0.22)';
  }
  const clamped = Math.max(-25, Math.min(25, pct));
  if (clamped === 0) return 'rgba(138, 149, 145, 0.24)';
  /*
   * The ends of the ramp are the page's own pair, not the black
   * theme's: `--up` #0f6d5f (15, 109, 95) and `--down` #b4482e
   * (180, 72, 46). It used to run to a cyan green and a hot pink,
   * which over paper came out as a highlighter tile — the alphas were
   * mixed to glow on black.
   *
   * The neutral end of each side is a muted version of the same hue
   * rather than a grey, so a tile near zero still says which way it
   * is leaning.
   */
  if (clamped > 0) {
    const t = Math.min(1, clamped / 25);
    const r = Math.round(90 + (15 - 90) * t);
    const g = Math.round(150 + (109 - 150) * t);
    const b = Math.round(135 + (95 - 135) * t);
    // Alpha climbs with magnitude so big winners pop.
    const alpha = 0.32 + 0.32 * t;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }
  const t = Math.min(1, Math.abs(clamped) / 25);
  const r = Math.round(196 + (180 - 196) * t);
  const g = Math.round(120 + (72 - 120) * t);
  const b = Math.round(100 + (46 - 100) * t);
  const alpha = 0.32 + 0.32 * t;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

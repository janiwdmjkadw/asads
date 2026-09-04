import { formatUsdAmount } from '@/lib/format';
import type { TokenHolder } from './types';

// Slice "Listen holders": pure shaping/formatting for the Holders tab's
// Listen card view. Kept out of ListenHolders.tsx so the rules are
// unit-testable without a DOM (see WalletCountButton.test.ts precedent).

/** Standard pump launch supply — the fallback when the top-holders page
 *  hasn't loaded yet and total supply can't be derived. */
export const PUMP_DEFAULT_SUPPLY_UI = 1_000_000_000;

/**
 * Total supply (UI units, 6-decimal mint) derived from any regular
 * top-holder row: `amount / (supplyPct / 100)`. The holders endpoint
 * reports both per row, so the first well-formed row pins the answer.
 */
export function deriveTotalSupplyUi(holders: readonly TokenHolder[]): number | null {
  for (const holder of holders) {
    if (!Number.isFinite(holder.supplyPct) || holder.supplyPct <= 0) continue;
    if (!/^\d+$/.test(holder.amountBaseUnits)) continue;
    // 6 decimals is the pump mint convention — formatBaseUnits in
    // TradesTable.tsx bakes in the same 1e6 assumption.
    const amountUi = Number(holder.amountBaseUnits) / 1_000_000;
    if (!Number.isFinite(amountUi) || amountUi <= 0) continue;
    const total = amountUi / (holder.supplyPct / 100);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return null;
}

/** Supply % held. Falls back to the standard 1B pump supply; null when the
 *  balance (or supply) can't support a meaningful percentage. */
export function supplyPctOf(tokensUi: number, totalSupplyUi: number | null): number | null {
  const total = totalSupplyUi ?? PUMP_DEFAULT_SUPPLY_UI;
  if (!Number.isFinite(tokensUi) || tokensUi <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  return (tokensUi / total) * 100;
}

/** Mirrors the holders table's formatPct ladder; null → em dash. */
export function formatSupplyPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return '—';
  if (pct < 0.001) return '<0.001%';
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

/** `+12.4%` / `-3.2%`; ≥100 drops the decimal. Null → em dash. Rounds
 *  first: anything that would display as zero renders an unsigned "0.0%"
 *  (never "-0.0%"). */
export function formatSignedPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.05) return '0.0%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
}

/** `+$1.2K` / `-$340` via the repo's compact USD ladder. Null/0 → em dash
 *  (a zero PnL on a transferred-in bag must not read as break-even). */
export function formatSignedUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '—';
  return `${value > 0 ? '+' : ''}${formatUsdAmount(value, '—')}`;
}

export type PnlTone = 'up' | 'down' | 'flat';

/**
 * The one-line PnL readout under the held value: "+12.4% · +$1.2K".
 * Renders whichever halves exist; text is null when neither does (the card
 * then shows a quiet em dash instead of a fake break-even).
 *
 * `tone` is the single color authority for the line: it follows the SAME
 * value the text leads with (pct when displayed, else the non-zero usd),
 * after display rounding — a pct that renders "0.0%" is 'flat', and a
 * negative pct is never painted up just because usd is 0.
 */
export function pnlLine(
  pnlPct: number | null,
  pnlUsd: number | null,
): { text: string | null; tone: PnlTone } {
  const hasPct = pnlPct != null && Number.isFinite(pnlPct);
  const hasUsd = pnlUsd != null && Number.isFinite(pnlUsd) && pnlUsd !== 0;
  const pct = hasPct ? formatSignedPct(pnlPct) : null;
  const usd = hasUsd ? formatSignedUsd(pnlUsd) : null;
  const text = pct !== null && usd !== null ? `${pct} · ${usd}` : (pct ?? usd);
  let tone: PnlTone = 'flat';
  if (hasPct) {
    // Mirror formatSignedPct's rounding: |pct| < 0.05 displays "0.0%".
    tone = Math.abs(pnlPct) < 0.05 ? 'flat' : pnlPct > 0 ? 'up' : 'down';
  } else if (hasUsd) {
    tone = pnlUsd > 0 ? 'up' : 'down';
  }
  return { text, tone };
}

/** Avg entry rendered as a market cap (price × supply) — matches how the
 *  trades table displays entries as MC. */
export function entryMarketCapUsd(
  avgEntryPriceUsd: number | null,
  totalSupplyUi: number | null,
): number | null {
  if (avgEntryPriceUsd == null || !Number.isFinite(avgEntryPriceUsd) || avgEntryPriceUsd <= 0) {
    return null;
  }
  const supply = totalSupplyUi ?? PUMP_DEFAULT_SUPPLY_UI;
  if (!Number.isFinite(supply) || supply <= 0) return null;
  return avgEntryPriceUsd * supply;
}

/** Same fixed confetti as the Frens surfaces (kept local by convention —
 *  FrenProfileModal carries its own copy too). */
const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

/** Deterministic identity color: this fren always signs in this color. */
export function identityColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return CONFETTI[((hash % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

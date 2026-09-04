import type { MockPnL } from './mockTrade';
import type { TradeLedgerView } from './useTradeLedger';
import { formatSolCompact } from '@/lib/format';

/**
 * Shared formatter for the BOUGHT / SOLD / HOLDING / PNL strip, used by
 * both the TradePanel and the InstantTradeBox so the math lives in one
 * place. All-in basis: BOUGHT/SOLD are everything that left / came back to
 * the wallet (fees, tip, rent included) - the SAME basis as the position
 * bar's cost basis, so the two surfaces agree. HOLDING = netTokens x live
 * price; PNL = SOLD + HOLDING - BOUGHT.
 *
 * Values are rendered COMPACT (no " SOL" suffix, subscript-zero notation
 * for tiny amounts) so the four cells stay tight and never overflow; the
 * unit is implied by the strip. Returns null when the coin was never
 * traded on the selected wallets.
 */

function formatSignedPct(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%';
  const abs = Math.abs(value);
  // Drop the decimal once it's noise (|%| >= 10) to keep the cell tight.
  return `${value < 0 ? '-' : '+'}${abs.toFixed(abs >= 10 ? 0 : 1)}%`;
}

export function ledgerToPnl(
  ledger: TradeLedgerView | null,
  priceLamportsPerBaseUnit: number,
): MockPnL | null {
  if (!ledger) return null;
  const bought = Number(ledger.boughtLamports);
  const sold = Number(ledger.soldLamports);
  const netTokens = Math.max(0, Number(ledger.netTokens));
  // Never traded here -> let the caller show its empty placeholder.
  if (bought <= 0 && sold <= 0 && netTokens <= 0) return null;
  const holding = netTokens * priceLamportsPerBaseUnit;
  // All-in cash flow: ties out exactly and matches the position bar's basis.
  const pnlLamports = sold + holding - bought;
  const pnlPct = bought > 0 ? (pnlLamports / bought) * 100 : null;
  const pnlAmount =
    pnlLamports > 0
      ? `+${formatSolCompact(pnlLamports / 1e9)}`
      : formatSolCompact(pnlLamports / 1e9);
  const pctPart = pnlPct === null ? '' : ` (${formatSignedPct(pnlPct)})`;
  return {
    bought: formatSolCompact(bought / 1e9),
    sold: formatSolCompact(sold / 1e9),
    holding: formatSolCompact(holding / 1e9),
    pnl: `${pnlAmount}${pctPart}`,
  };
}

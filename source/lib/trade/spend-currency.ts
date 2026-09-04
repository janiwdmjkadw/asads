import type { TradeQuoteMode } from '@/lib/state/trade-store';

/**
 * Effective spend-currency resolution for USDC pump.fun pair support.
 *
 * Single source of truth for "which currency does an order spend?":
 *
 *   - USDC pair → ALWAYS spends USDC, regardless of the global mode
 *     (pair-native rule; the curve settles in USDC).
 *   - SOL pair + SOL mode → spends SOL (legacy behavior, untouched).
 *   - SOL pair + USDC mode → spends USDC via the engine's CROSS-QUOTE
 *     path on BOTH venues (atomic USDC↔SOL Raydium swap leg + the
 *     curve/AMM ix). Buys submit `amount_usdc_micro` +
 *     `spend_currency: 'usdc'`; sells keep their usual sizing fields
 *     and add `spend_currency: 'usdc'` so the engine appends the
 *     SOL→USDC proceeds swap. Marked `crossQuote: true` so submit
 *     sites know to attach the sell marker.
 */

/** Circle USDC mint (mainnet). */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export type SpendCurrency = 'sol' | 'usdc';

export interface SpendCurrencyResolution {
  readonly currency: SpendCurrency;
  /**
   * True for the USDC-mode-on-a-SOL-pair cells (bonding curve AND
   * graduated): orders route through the engine's cross-quote path
   * (USDC spend on buys, SOL→USDC proceeds swap on sells). False on
   * native USDC pairs — those settle in USDC without a swap leg.
   */
  readonly crossQuote: boolean;
  /**
   * Always false since the AMM cross-quote slice shipped — kept so the
   * notice render sites stay type-compatible while they're removed.
   */
  readonly crossQuoteFallback: boolean;
}

/** True when the token's quote mint is USDC (absent = SOL pair). */
export function isUsdcPair(quoteMint?: string | null): boolean {
  return quoteMint === USDC_MINT;
}

export function resolveSpendCurrency(
  mode: TradeQuoteMode,
  quoteMint?: string | null,
  graduated = false,
): SpendCurrencyResolution {
  void graduated; // venue no longer changes the spend currency
  if (isUsdcPair(quoteMint)) {
    return { currency: 'usdc', crossQuote: false, crossQuoteFallback: false };
  }
  if (mode === 'usdc') {
    return { currency: 'usdc', crossQuote: true, crossQuoteFallback: false };
  }
  return { currency: 'sol', crossQuote: false, crossQuoteFallback: false };
}

/**
 * Integer micro-USDC (6dp) as a decimal string from a typed dollar
 * amount. Mirrors `solToLamportsDecimalString`'s fixed-decimal +
 * BigInt path so the 5-6th decimal never round-trips imprecisely and
 * huge inputs can't make `BigInt` throw mid-submit.
 */
export function usdToUsdcMicroDecimalString(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0';
  const [whole, frac = ''] = usd.toFixed(6).split('.');
  const padded = frac.padEnd(6, '0').slice(0, 6);
  try {
    return (BigInt(whole ?? '0') * 1_000_000n + BigInt(padded || '0')).toString(10);
  } catch {
    return '0';
  }
}

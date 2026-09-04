import type { TradeSellQuoteInfo } from './useTradeStream';

export function pctOfBaseUnits(baseUnits: string | undefined, pct: number): string {
  if (!baseUnits || !Number.isFinite(pct) || pct <= 0) return '0';
  try {
    const raw = BigInt(baseUnits);
    if (raw <= 0n) return '0';
    const out = (raw * BigInt(Math.floor(pct))) / 100n;
    return out > 0n ? out.toString() : '0';
  } catch {
    return '0';
  }
}

export function estimateSellLamports(
  tokensIn: string,
  quote: TradeSellQuoteInfo | null | undefined,
  fallbackPriceLamportsPerBaseUnit: number,
): number {
  const amount = safeBigInt(tokensIn);
  if (amount <= 0n) return 0;

  if (quote?.venue === 'bonding_curve') {
    const vsr = safeBigInt(quote.vsr);
    const vtr = safeBigInt(quote.vtr);
    if (vsr > 0n && vtr > 0n) {
      const newVtr = vtr + amount;
      const newVsr = (vsr * vtr) / newVtr;
      if (newVsr < vsr) return Number(((vsr - newVsr) * 99n) / 100n);
    }
  }

  if (quote?.venue === 'pump_amm') {
    const base = safeBigInt(quote.poolBaseReserves);
    const quoteReserve = safeBigInt(quote.poolQuoteReserves);
    if (base > 0n && quoteReserve > 0n) {
      const newBase = base + amount;
      const newQuote = (base * quoteReserve) / newBase;
      // PumpSwap fees (~0.30%: 20bps LP + 5bps protocol + 5bps creator) come
      // out of the quote side — mirror the bonding-curve branch's haircut so
      // "Est. receive" doesn't overstate AMM sells.
      if (newQuote < quoteReserve) return Number(((quoteReserve - newQuote) * 997n) / 1000n);
    }
  }

  if (!fallbackPriceLamportsPerBaseUnit) return 0;
  return Math.max(0, Number(tokensIn)) * fallbackPriceLamportsPerBaseUnit;
}

/**
 * Estimated tokens received for a SOL spend (buy-side mirror of
 * `estimateSellLamports`): constant-product output with the venue's fee
 * haircut applied to the SOL going IN — ~1% on the bonding curve, ~0.30%
 * on PumpSwap — falling back to a flat spot-price divide when no quote is
 * available. Display-only (chip/CTA previews); garbage or zero inputs
 * return 0n.
 */
export function estimateBuyTokens(
  lamportsIn: string,
  quote: TradeSellQuoteInfo | null | undefined,
  fallbackPriceLamportsPerBaseUnit: number,
): bigint {
  const amount = safeBigInt(lamportsIn);
  if (amount <= 0n) return 0n;

  if (quote?.venue === 'bonding_curve') {
    const vsr = safeBigInt(quote.vsr);
    const vtr = safeBigInt(quote.vtr);
    if (vsr > 0n && vtr > 0n) {
      const inEff = (amount * 99n) / 100n;
      const out = vtr - (vsr * vtr) / (vsr + inEff);
      return out > 0n ? out : 0n;
    }
  }

  if (quote?.venue === 'pump_amm') {
    const base = safeBigInt(quote.poolBaseReserves);
    const quoteReserve = safeBigInt(quote.poolQuoteReserves);
    if (base > 0n && quoteReserve > 0n) {
      const inEff = (amount * 997n) / 1000n;
      const out = base - (base * quoteReserve) / (quoteReserve + inEff);
      return out > 0n ? out : 0n;
    }
  }

  if (!fallbackPriceLamportsPerBaseUnit || fallbackPriceLamportsPerBaseUnit <= 0) return 0n;
  const approx = Math.floor(Number(lamportsIn) / fallbackPriceLamportsPerBaseUnit);
  if (!Number.isFinite(approx) || approx <= 0) return 0n;
  return BigInt(approx);
}

export function formatSolFromLamports(lamports: number, frac = 4): string {
  if (!Number.isFinite(lamports) || lamports === 0) return '0 SOL';
  const sol = lamports / 1e9;
  if (Math.abs(sol) < 0.0001) return `${sol.toExponential(2)} SOL`;
  return `${sol.toFixed(frac)} SOL`;
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

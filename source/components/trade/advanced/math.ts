/**
 * Advanced-orders (DCA / limit) pure math + validation helpers.
 *
 * All base-unit conversions are string/bigint — no floating point ever
 * touches a wire amount. Decimals are per-mint (SOL 9, USDC 6, SPL
 * holdings carry `decimals` from /portfolio/spot).
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;
/** Pump-fun style page mints are 6-decimals (same assumption TradePanel
 *  bakes into its base-unit math). */
export const PAGE_MINT_DECIMALS = 6;

/** Rent + tx-fee headroom left behind by the SOL MAX button (0.01 SOL). */
export const SOL_MAX_HEADROOM_LAMPORTS = 10_000_000n;

export const DEFAULT_SUBORDERS = 10;
export const MIN_SUBORDERS = 1;
export const MAX_SUBORDERS = 500;

/** Fallback slippage when no preset is reachable: 15% = 1500 bps. */
export const FALLBACK_SLIPPAGE_BPS = 1_500;

/**
 * Display-only platform fee rate (bps). Matches the api referral
 * economics default (`platform_fee_bps`, see lib/api/referral.ts) —
 * the engine's fail-closed fee verifier is authoritative at execution.
 */
export const PLATFORM_FEE_BPS = 100;

export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export const DURATION_UNITS: ReadonlyArray<DurationUnit> = [
  'seconds',
  'minutes',
  'hours',
  'days',
];

const DURATION_UNIT_SECONDS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

/** Whole seconds for a duration value + unit; null on garbage input. */
export function durationToSeconds(value: string, unit: DurationUnit): number | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = Math.floor(n * DURATION_UNIT_SECONDS[unit]);
  return seconds >= 1 ? seconds : null;
}

const BASE58_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Basic base58 mint-address shape check (paste-CA input). */
export function isLikelyMintAddress(value: string): boolean {
  return BASE58_MINT_REGEX.test(value.trim());
}

/**
 * Plain decimal string → integer base units for a mint with `decimals`.
 * Fractional digits beyond `decimals` are truncated (never rounded up —
 * an allocate amount must not exceed what the user typed). Returns null
 * on anything that is not a plain positive decimal.
 */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0');
  try {
    const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac === '' ? '0' : frac);
    return units;
  } catch {
    return null;
  }
}

/** Integer base units → human decimal string (trailing zeros trimmed). */
export function formatBaseUnits(
  units: bigint,
  decimals: number,
  maxFractionDigits: number = decimals,
): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  let frac = (abs % divisor).toString().padStart(decimals, '0').slice(0, maxFractionDigits);
  frac = frac.replace(/0+$/, '');
  const body = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

/**
 * Per-suborder sizing: base = floor(total/count); the FINAL suborder
 * carries the remainder so the schedule spends exactly `total`.
 * 10 SOL over 10 suborders → 1 SOL each; 10 SOL over 3 → 3.33.. + 3.33..
 * + 3.33..4.
 */
export function perSuborderBaseUnits(
  total: bigint,
  count: number,
): { base: bigint; last: bigint } | null {
  if (!Number.isInteger(count) || count < 1 || total <= 0n) return null;
  const n = BigInt(count);
  const base = total / n;
  const last = total - base * (n - 1n);
  return { base, last };
}

/** Whole-second interval between suborders: floor(duration/count). */
export function intervalSeconds(durationSeconds: number, count: number): number | null {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1) return null;
  if (!Number.isInteger(count) || count < 1) return null;
  const interval = Math.floor(durationSeconds / count);
  return interval >= 1 ? interval : null;
}

/** SOL MAX spend: full balance minus the fee/rent headroom, floored at 0. */
export function solMaxSpendableLamports(balanceLamports: bigint): bigint {
  const spendable = balanceLamports - SOL_MAX_HEADROOM_LAMPORTS;
  return spendable > 0n ? spendable : 0n;
}

/**
 * Positive decimal-string parser for USD fields (price floor/ceiling,
 * limit trigger). Returns the normalized decimal string for the wire
 * (strings end-to-end — floats never touch these), or null when the
 * input is not a plain positive decimal.
 */
export function parseUsdDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const cleanWhole = whole.replace(/^0+(?=\d)/, '');
  const cleanFrac = frac.replace(/0+$/, '');
  if (/^0*$/.test(cleanWhole) && cleanFrac === '') return null; // zero
  return cleanFrac.length > 0 ? `${cleanWhole}.${cleanFrac}` : cleanWhole;
}

/** Compare two normalized positive decimal strings: -1 | 0 | 1. */
export function compareUsdDecimals(a: string, b: string): -1 | 0 | 1 {
  const [aw = '0', af = ''] = a.split('.');
  const [bw = '0', bf = ''] = b.split('.');
  const fracLen = Math.max(af.length, bf.length);
  const ai = BigInt(aw + af.padEnd(fracLen, '0'));
  const bi = BigInt(bw + bf.padEnd(fracLen, '0'));
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

/** Slippage percent string ("15", "0.5") → bps int, or null if invalid. */
export function slippagePctToBps(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return Math.round(pct * 100);
}

export interface RecurringFormInput {
  readonly amountBaseUnits: bigint | null;
  /** Wallet balance in base units; null = unknown (skip the balance check). */
  readonly balanceBaseUnits: bigint | null;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly suborders: number | null;
  readonly durationSeconds: number | null;
  readonly slippageBps: number | null;
  /** Normalized decimal strings (parseUsdDecimal) or null when empty. */
  readonly priceFloorUsd: string | null;
  readonly priceCeilingUsd: string | null;
}

/** First blocking problem with a recurring (DCA) form, or null when valid. */
export function validateRecurringForm(input: RecurringFormInput): string | null {
  if (input.amountBaseUnits === null || input.amountBaseUnits <= 0n) {
    return 'Enter a positive allocate amount.';
  }
  if (input.balanceBaseUnits !== null && input.amountBaseUnits > input.balanceBaseUnits) {
    return 'Amount exceeds wallet balance.';
  }
  if (input.inputMint === input.outputMint) {
    return 'Allocate and To Buy must be different tokens.';
  }
  if (
    input.suborders === null ||
    !Number.isInteger(input.suborders) ||
    input.suborders < MIN_SUBORDERS ||
    input.suborders > MAX_SUBORDERS
  ) {
    return `Suborders must be a whole number between ${MIN_SUBORDERS} and ${MAX_SUBORDERS}.`;
  }
  if (input.durationSeconds === null || input.durationSeconds < 1) {
    return 'Enter a positive duration.';
  }
  if (intervalSeconds(input.durationSeconds, input.suborders) === null) {
    return 'Interval below 1s — reduce suborders or extend the duration.';
  }
  if (input.slippageBps === null) {
    return 'Enter a slippage between 0 and 100%.';
  }
  if (
    input.priceFloorUsd !== null &&
    input.priceCeilingUsd !== null &&
    compareUsdDecimals(input.priceFloorUsd, input.priceCeilingUsd) >= 0
  ) {
    return 'Price range min must be below max.';
  }
  return null;
}

export interface LimitFormInput {
  readonly amountBaseUnits: bigint | null;
  readonly balanceBaseUnits: bigint | null;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly slippageBps: number | null;
  /** Normalized decimal string (parseUsdDecimal) or null when empty/bad. */
  readonly triggerValueUsd: string | null;
}

/** First blocking problem with a limit form, or null when valid. */
export function validateLimitForm(input: LimitFormInput): string | null {
  if (input.amountBaseUnits === null || input.amountBaseUnits <= 0n) {
    return 'Enter a positive amount.';
  }
  if (input.balanceBaseUnits !== null && input.amountBaseUnits > input.balanceBaseUnits) {
    return 'Amount exceeds wallet balance.';
  }
  if (input.inputMint === input.outputMint) {
    return 'Pay and Receive must be different tokens.';
  }
  if (input.triggerValueUsd === null) {
    return 'Enter a positive trigger value in USD.';
  }
  if (input.slippageBps === null) {
    return 'Enter a slippage between 0 and 100%.';
  }
  return null;
}

/** "1h 40m", "90s", "2d 4h" — compact interval/duration display. */
export function formatDurationShort(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 1) return '0s';
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s}s`;
  if (s < 3_600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  if (s < 86_400) {
    const h = Math.floor(s / 3_600);
    const rem = Math.floor((s % 3_600) / 60);
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(s / 86_400);
  const rem = Math.floor((s % 86_400) / 3_600);
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

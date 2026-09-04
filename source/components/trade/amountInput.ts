/**
 * Pure parsing/validation for the trade-amount text input.
 *
 * `Number()` is NOT a safe parser for money: it coerces hex ("0x10" →
 * 16), scientific notation ("1e5" → 100000), "Infinity", and
 * whitespace — so a typo could silently submit a wildly different SOL
 * amount. These helpers whitelist plain decimal strings only.
 */

/**
 * Keystroke whitelist for the amount field: optional integer part, one
 * optional dot, at most 9 fractional digits (lamports precision).
 * Allows transient states while typing ("", ".", "0.").
 * Mirrors the TransferModal amount-field filter.
 */
export const AMOUNT_INPUT_PATTERN = /^\d*\.?\d{0,9}$/;

export function isAllowedAmountInput(value: string): boolean {
  return AMOUNT_INPUT_PATTERN.test(value);
}

/**
 * Upper bound on a submitted amount. SOL total supply is < 1e9, so any
 * larger value is a typo — and values around 1e21 overflow
 * `toFixed(9)` into scientific notation, which makes the lamports
 * serializer's `BigInt()` throw mid-submit.
 */
export const MAX_TRADE_AMOUNT = 1_000_000_000;

/**
 * Parse a submitted amount string into a number, or `null` when the
 * string is not a plain bounded decimal. Returns `0` for empty-ish but
 * well-formed inputs ("", "0", "0.0", ".") so the caller can apply its
 * own positivity rule (sell-percent mode legitimately submits with an
 * empty amount field).
 */
export function parseTradeAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!AMOUNT_INPUT_PATTERN.test(trimmed)) return null;
  if (trimmed === '' || trimmed === '.') return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  if (num > MAX_TRADE_AMOUNT) return null;
  return num;
}

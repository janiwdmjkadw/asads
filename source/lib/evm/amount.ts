/**
 * User-typed amounts → integer base units, BigInt only.
 *
 * This is the INPUT half of `money.ts` (which is the output half), and it is
 * a separate module because the failure modes are different. Formatting a
 * wrong number renders a wrong figure; parsing a wrong number SPENDS a wrong
 * amount. So every rule here is deliberately strict and every rejection is
 * named — the panel shows the reason rather than silently coercing.
 *
 * THE RULE, same as everywhere else on this surface: **no amount ever becomes
 * a JS number.** `Number('0.1') * 1e18` is `100000000000000000` only by luck;
 * `Number('0.3') * 1e18` is `299999999999999970`. A trader typing `0.3 BNB`
 * must spend exactly 3×10^17 wei, so the conversion is done by string
 * surgery and `BigInt`, never by arithmetic on a double.
 *
 * Over-precision is REFUSED, not truncated. Typing 19 fractional digits of
 * BNB is not a rounding question — it means the user believes something about
 * the amount that the chain cannot honour, and silently dropping the tail is
 * how a "why did it spend a different number" bug is born.
 */

/** Why a typed amount could not become base units. Rendered verbatim. */
export type AmountParseFailure =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string };

export type AmountParseResult =
  | { kind: 'ok'; baseUnits: bigint }
  | AmountParseFailure;

/** Optional leading digits, optional single point, optional trailing digits. */
const DECIMAL_INPUT = /^(\d*)(?:\.(\d*))?$/;

/**
 * Parse a user-typed decimal amount into integer base units at `decimals`.
 *
 * Accepts `1`, `1.5`, `.5`, `1.` and surrounding whitespace. Refuses signs,
 * exponents, thousands separators, any non-digit, and a fractional part
 * longer than `decimals`.
 */
export function parseDecimalAmount(text: string, decimals: number): AmountParseResult {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    // A malformed scale is a wire/config fault, not a user error, and
    // guessing 18 here would spend the wrong amount by orders of magnitude.
    return { kind: 'invalid', reason: 'Token scale is unknown, so this amount cannot be sized.' };
  }
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  const match = DECIMAL_INPUT.exec(trimmed);
  if (match === null) {
    return { kind: 'invalid', reason: 'Digits and one decimal point only.' };
  }
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return { kind: 'empty' };
  if (fraction.length > decimals) {
    return {
      kind: 'invalid',
      reason: `At most ${decimals} decimal places (this chain's smallest unit).`,
    };
  }
  const padded = fraction.padEnd(decimals, '0');
  const digits = `${whole === '' ? '0' : whole}${padded}`;
  let baseUnits: bigint;
  try {
    baseUnits = BigInt(digits);
  } catch {
    return { kind: 'invalid', reason: 'Amount is not a number.' };
  }
  if (baseUnits === 0n) {
    // Distinct from `empty`: the user typed something, and a zero-value
    // order is refused by the engine anyway. Saying so here is faster and
    // more honest than a round trip.
    return { kind: 'invalid', reason: 'Amount must be greater than zero.' };
  }
  return { kind: 'ok', baseUnits };
}

/**
 * Base units → an EXACT decimal string suitable for putting back in the
 * input box.
 *
 * Unlike `formatBigIntUnits` this never truncates and never renders a bound:
 * the value it produces must re-parse to the identical BigInt, because the
 * percent presets write it into the field the user then submits. A "<0.0001"
 * in an input box would be re-parsed as garbage.
 */
export function baseUnitsToInputText(value: bigint, decimals: number): string {
  if (value < 0n) return '0';
  if (decimals <= 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/**
 * `value * bps / 10_000`, floored — the slippage floor and the fee share both
 * use it.
 *
 * Floored on purpose: every caller here computes a MINIMUM the user will
 * accept, and rounding a minimum up is the direction that makes a legitimate
 * fill revert.
 */
export function applyBps(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) return 0n;
  return (value * BigInt(bps)) / 10_000n;
}

/**
 * A percentage OF a balance, floored, clamped to the balance.
 *
 * Used by the sell presets (25/50/100%). 100% returns the balance exactly —
 * derived rather than special-cased, since `balance * 10_000 / 10_000` is
 * exact in integer arithmetic.
 */
export function percentOf(balance: bigint, bps: number): bigint {
  if (balance <= 0n) return 0n;
  const share = applyBps(balance, bps);
  return share > balance ? balance : share;
}

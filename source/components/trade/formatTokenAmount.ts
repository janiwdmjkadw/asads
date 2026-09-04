/**
 * Shared DISPLAY formatter for token amounts given decimal base-unit
 * strings (6dp mints). Replaces the per-panel whole-token flooring
 * helpers, which rendered any sub-1-token balance as "0" even when the
 * wallet demonstrably held dust-plus amounts:
 *
 *   - below the display epsilon (0.01 token) → "0" (true dust)
 *   - sub-1-token → two decimals ("0.42")
 *   - whole tokens → K/M compaction matching the existing helpers
 *
 * Display only — sizing paths keep exact base units.
 */

const BASE_UNITS_PER_TOKEN = 1_000_000n;
/** 0.01 token at 6 decimals — matches MIN_DISPLAY_SELLABLE_BASE_UNITS. */
const DUST_BASE_UNITS = 10_000n;

export function formatTokenAmount(baseUnits: string): string {
  let raw: bigint;
  try {
    raw = BigInt(baseUnits);
  } catch {
    return '0';
  }
  if (raw < DUST_BASE_UNITS) return '0';
  if (raw < BASE_UNITS_PER_TOKEN) {
    return (Number(raw) / 1e6).toFixed(2);
  }
  const whole = raw / BASE_UNITS_PER_TOKEN;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1_000_000).toFixed(2)}M`;
  if (whole >= 1_000n) return `${Number(whole) / 1_000}K`;
  return whole.toString();
}

/**
 * Display formatters used across Discover and Trade.
 *
 * These functions live here (not in `useLiveNewPairs.ts` or
 * `mockTrade.ts`) so the new Trade-page snapshot adapter can reuse
 * them without touching the existing hook. The Discover hook still
 * has its own copies inline; consolidating those is a minor cleanup
 * for a follow-up slice.
 *
 * All functions are pure, deterministic, and never throw.
 */

/**
 * Compact-currency display: `1234567 -> "$1.2M"`, `1234 -> "$1.2K"`,
 * `42 -> "$42"`. Returns `fallback` when the value is null,
 * non-finite, or non-positive (matches the existing Discover hook
 * convention of showing "$0" or "new" instead of "$NaN").
 *
 * Trailing `.0` is trimmed (`5_000 -> "$5K"`, not `"$5.0K"`) and
 * values that round up across a tier boundary promote to the next
 * tier (`999_950 -> "$1M"`, not `"$1000.0K"`). See `compactNumber()`.
 */
export function compactUsd(
  value: number | null | undefined,
  fallback: string,
): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  const scaled = compactScale(value);
  return scaled === null ? `$${Math.round(value)}` : `$${scaled}`;
}

/**
 * Compact integer-style display: `1234 -> "1.2K"`, `5000 -> "5K"`,
 * `999_999 -> "1M"`, `2_500_000 -> "2.5M"`. Always non-negative;
 * trims trailing `.0` from tier values and promotes a value whose
 * rounded display rolls over to "1000" up to the next tier so the
 * card never has to show `"1000.0K"`.
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const scaled = compactScale(value);
  return scaled ?? String(Math.round(value));
}

/**
 * WHOLE compact-currency: never a decimal — `83_400 -> "$83K"`,
 * `8_890 -> "$9K"`, `2_050 -> "$2K"`. For CoinCard's V stat ("V should
 * never have decimals"), whose width was pushing the stats divider
 * left into the card's text side. Sub-$1K keeps exact dollars ("$472").
 */
export function compactUsdWhole(
  value: number | null | undefined,
  fallback: string,
): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  const scaled = compactScale(value, 0);
  return scaled === null ? `$${Math.round(value)}` : `$${scaled}`;
}

/** COARSE `compactNumber` (max 1 decimal): `8_890 -> "8.9K"`,
 *  `12_340 -> "12K"`. CoinCard's TX stat — one decimal is allowed
 *  there, just not the third significant digit. */
export function compactNumberCoarse(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const scaled = compactScale(value, 1);
  return scaled ?? String(Math.round(value));
}

/* Internal — pick the right tier (K / M / B), round to 1 decimal,
 * trim trailing `.0`, and promote the value to the next tier when its
 * rounded display rolls over to `1000`. Returns `null` for values
 * below 1000 so callers can decide how to render the residue (e.g.
 * with or without a currency prefix). */
const COMPACT_TIERS = [
  { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000,     divisor: 1_000_000,     suffix: 'M' },
  { threshold: 1_000,         divisor: 1_000,         suffix: 'K' },
] as const;

function compactScale(value: number, maxDecimals: 0 | 1 | 2 = 2): string | null {
  for (let i = 0; i < COMPACT_TIERS.length; i += 1) {
    const tier = COMPACT_TIERS[i]!;
    if (value < tier.threshold) continue;
    const scaled = value / tier.divisor;
    /* Three significant digits at every magnitude — the visible prefix
       is always 3 digits wide, with the decimal place sliding to match:

         scaled <  10        ⇒ 2 decimals:  "1.23K", "9.99M"
         10 ≤ scaled <  100  ⇒ 1 decimal:   "10.5K", "99.9M"
         100 ≤ scaled        ⇒ 0 decimals:  "100K",  "999K"

       `maxDecimals` swaps in a shorter ladder for the coarse/whole
       variants — 1 ⇒ two significant digits ("1.2K" / "12K" / "100K"),
       0 ⇒ whole tier values only ("1K" / "12K" / "100K").

       …with two refinements on top:

       1. Trailing zeros stripped via `Number(...).toString()` so
          `5.00` reads as `5`, `10.50` as `10.5`. Without this the
          card would show `5.00K` and look mid-load.

       2. In the 2-decimal branch, if the FIRST decimal place is `0`
          (e.g. `3.04`, `1.05`), the second decimal is noise and the
          value reads cleaner as an integer (`3K`, `1K`). Values
          where the first decimal carries information stay precise
          (`3.5K`, `9.99K`). */
    const decimals =
      maxDecimals === 2
        ? scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
        : maxDecimals === 1
          ? scaled >= 10 ? 0 : 1
          : 0;
    let raw = scaled.toFixed(decimals);
    if (decimals === 2 && raw.split('.')[1]?.[0] === '0') {
      raw = Math.round(scaled).toString();
    }
    const rendered = Number(raw).toString();
    if (rendered === '1000' && i > 0) {
      /* Rolled over the top of this tier (e.g. `Math.round(999.5) =
         1000` in the 0-decimal branch, or `(99.95).toFixed(1) =
         "100.0"` near the 10-99 → 100+ boundary then bumping past
         999). Promote to the next tier rather than display "1000K". */
      const upper = COMPACT_TIERS[i - 1]!;
      return `1${upper.suffix}`;
    }
    return `${rendered}${tier.suffix}`;
  }
  return null;
}

/**
 * Format a sub-cent USD price using subscript notation for the
 * leading zeros, mirroring the mock convention `"$0.0₅2"` (read
 * "$0.000052"). For prices `>= 0.01`, uses fixed-point with up to
 * four significant digits.
 *
 * Returns `fallback` when the price is null/non-finite/zero.
 */
export function formatPriceUsd(
  value: number | null | undefined,
  fallback = '$0',
): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  // Sub-cent: count leading zeros after the decimal.
  // e.g. 0.000052 → "0.000052" → leading zeros after "." = 4.
  const str = value.toExponential(2); // e.g. "5.20e-5"
  const match = /^(\d(?:\.\d+)?)e-(\d+)$/.exec(str);
  if (!match) return `$${value.toPrecision(2)}`;
  const mantissa = match[1] ?? '0';
  const exponentRaw = match[2] ?? '0';
  const exponent = Number.parseInt(exponentRaw, 10);
  // Number of zeros immediately after the decimal point = exponent - 1.
  const zeros = Math.max(0, exponent - 1);
  // Strip the leading "5." → "5" (or "5.2" → "52" without the dot).
  const sig = mantissa.replace('.', '');
  // Trim trailing zeros for a tight display.
  const sigTrimmed = sig.replace(/0+$/, '') || '0';
  return `$0.0${toSubscript(zeros)}${sigTrimmed}`;
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
function toSubscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? d)
    .join('');
}

function trimTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * Compact SOL amount for tight cells (no " SOL" suffix). Mirrors
 * `formatPriceUsd`'s subscript convention for tiny values, e.g.
 * `0.0₅2` reads `0.000052`. Signed (negative keeps `-`; positives are
 * bare — callers add `+` if they want it). Zero/non-finite → `fallback`.
 */
export function formatSolCompact(value: number, fallback = '0'): string {
  if (!Number.isFinite(value) || value === 0) return fallback;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1) return `${sign}${trimTrailingZeros(abs.toFixed(3))}`;
  if (abs >= 0.001) return `${sign}${trimTrailingZeros(abs.toFixed(4))}`;
  const str = abs.toExponential(2); // e.g. "5.20e-5"
  const match = /^(\d(?:\.\d+)?)e-(\d+)$/.exec(str);
  if (!match) return `${sign}${abs.toPrecision(2)}`;
  const exponent = Number.parseInt(match[2] ?? '0', 10);
  const zeros = Math.max(0, exponent - 1);
  const sig = (match[1] ?? '0').replace('.', '').replace(/0+$/, '') || '0';
  return `${sign}0.0${toSubscript(zeros)}${sig}`;
}

/**
 * Display a USD amount with the codebase's compact conventions:
 * `12.34 -> "$12.34"`, `5 -> "$5"`, `1234.5 -> "$1.23K"` (compact tier
 * above 1000, mirroring `compactUsd`), `0.004 -> "$0.004"`. Negative
 * keeps `-` before the `$`. Zero / non-finite → `fallback`.
 */
export function formatUsdAmount(value: number, fallback = '$0'): string {
  if (!Number.isFinite(value) || value === 0) return fallback;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000) return `${sign}${compactUsd(abs, fallback)}`;
  if (abs >= 0.01) return `${sign}$${trimTrailingZeros(abs.toFixed(2))}`;
  return `${sign}$${trimTrailingZeros(abs.toFixed(4))}`;
}

/**
 * micro-USDC (6dp integer, the wire unit of `usdc_trade` settings and
 * `amount_usdc_micro` order fields) → "$12.34"-style display. Accepts
 * the bigint/string forms the wire carries; unparseable input falls to
 * `fallback`.
 */
export function formatUsdcMicro(
  micro: bigint | number | string,
  fallback = '$0',
): string {
  let value: number;
  if (typeof micro === 'bigint') {
    value = Number(micro) / 1_000_000;
  } else if (typeof micro === 'number') {
    value = micro / 1_000_000;
  } else {
    if (!/^-?\d+$/.test(micro)) return fallback;
    try {
      value = Number(BigInt(micro)) / 1_000_000;
    } catch {
      return fallback;
    }
  }
  return formatUsdAmount(value, fallback);
}

/**
 * `truncateMint("HQoLTkfFM88geuCgfe2uYVG8VG5YL1LYxQLC5nUepump")` →
 * `"HQoLT…nUepump"`. Lossy — only used as a fallback display.
 */
export function truncateMint(mint: string): string {
  if (mint.length <= 13) return mint;
  return `${mint.slice(0, 5)}…${mint.slice(-7)}`;
}

/**
 * Single-unit age ladder: `75_000 -> "1m"`, `3_700_000 -> "1h"`, then
 * `d` / `w` / `y` for older tokens (a 20-month-old coin reads "1y", not
 * "600d"). Used by header bars, the Discover hook, and token search.
 */
export function compactAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Parse a stringified `bigint` (lamports / token base units) into a
 * `number` clamped at `Number.MAX_SAFE_INTEGER`. Sufficient for
 * display purposes; never used for accounting math.
 *
 * Returns `null` for empty strings or unparseable input.
 */
export function lamportsStringToNumber(value: string): number | null {
  if (!value) return null;
  // Accept only digit strings; discard scientific notation / negatives.
  if (!/^\d+$/.test(value)) return null;
  // Use BigInt to avoid precision loss for large values, then clamp
  // before returning a Number.
  const big = BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(big);
}

/** `lamports * solUsd / 1e9` as a Number. Returns `null` on parse fail. */
export function lamportsToUsd(lamports: string, solUsd: number): number | null {
  const n = lamportsStringToNumber(lamports);
  if (n == null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  return (n * solUsd) / 1_000_000_000;
}

const IPFS_GATEWAY = 'https://ipfs.io';

// CIDv0 (`Qm…`, base58, 46 chars) and CIDv1 (`bafy…` / `bafk…`, base32, ~59 chars).
// Loose detection — defers strict validation to the gateway, which 404s on bad CIDs.
const BARE_CID_RE = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})$/;

/**
 * Normalize a media URL coming off chain or off pump.fun's CDN so
 * the browser can actually load it as an `<img src>`. Handles:
 *
 * * existing `http(s)://…` URLs → passthrough
 * * `data:` URLs → passthrough
 * * `ipfs://CID[/path]` → `<gateway>/ipfs/CID[/path]`
 * * bare CID (`Qm…` v0 or `baf…` v1) → `<gateway>/ipfs/CID`
 * * empty / nullish → `null` (caller decides on a placeholder)
 *
 * Anything else (random non-URL strings, accidental hostnames) is
 * returned `null` — better to fall through to a placeholder image
 * than feed `<img src="bafkrei…">` to the browser, where Chrome
 * tries the bare CID as a hostname and crashes the network with
 * `ERR_SSL_PROTOCOL_ERROR`.
 */
export function normalizeMediaUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('ipfs://')) {
    const tail = trimmed.slice('ipfs://'.length).replace(/^\/+/, '');
    if (tail.length === 0) return null;
    return `${IPFS_GATEWAY}/ipfs/${tail}`;
  }
  if (BARE_CID_RE.test(trimmed)) {
    return `${IPFS_GATEWAY}/ipfs/${trimmed}`;
  }
  return null;
}

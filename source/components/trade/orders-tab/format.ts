/**
 * Orders-tab pure helpers: status chips, countdowns, bigint-safe amount
 * formatting and list ordering for `AdvancedOrderView` rows. Everything
 * here is side-effect free and unit-tested (format.test.ts); no float
 * ever touches a wire amount — base-unit compaction is exact integer
 * arithmetic end to end (see `formatTokenBaseUnits`), and the only
 * remaining `number` path is `compactUsdFromDecimal`, whose input is a
 * USD decimal string rather than a count of base units.
 */

import {
  PAGE_MINT_DECIMALS,
  SOL_DECIMALS,
  SOL_MINT,
  USDC_DECIMALS,
  USDC_MINT,
  type DurationUnit,
} from '../advanced/math';
import type {
  AdvancedOrderChain,
  AdvancedOrderStatus,
  AdvancedOrderView,
} from '@/lib/api/advanced-orders';

/** Open = still schedulable (counts toward the tab badge). */
export function isOpenAdvancedStatus(status: AdvancedOrderStatus): boolean {
  return (
    status === 'active' ||
    status === 'paused_user' ||
    status === 'paused_price' ||
    status === 'paused_auth' ||
    status === 'paused_funds'
  );
}

export type AdvancedStatusTone = 'up' | 'hold' | 'down' | 'muted';

export interface AdvancedStatusChip {
  readonly label: string;
  readonly tone: AdvancedStatusTone;
}

export function advancedStatusChip(status: AdvancedOrderStatus): AdvancedStatusChip {
  switch (status) {
    case 'active':
      return { label: 'Active', tone: 'up' };
    case 'paused_user':
      return { label: 'Paused', tone: 'hold' };
    case 'paused_price':
      return { label: 'Paused – price out of range', tone: 'hold' };
    case 'paused_funds':
      return { label: 'Paused – funds', tone: 'hold' };
    case 'paused_auth':
      return { label: 'Paused – reauth needed', tone: 'down' };
    case 'completed':
      return { label: 'Completed', tone: 'muted' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' };
    case 'failed':
      return { label: 'Failed', tone: 'down' };
  }
}

/** ISO timestamp → epoch ms, or null on garbage. */
export function parseIsoMs(iso: string | null): number | null {
  if (iso === null || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Live next-run countdown: `mm:ss` under an hour, `h:mm:ss` above.
 * Negative remainders clamp to `00:00` (the worker is about to fire).
 */
export function formatCountdown(msRemaining: number): string {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1_000));
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Decimals for a mint, from the SOLANA mint-family conventions only.
 *
 * CHAIN-AWARE, and it refuses off Solana. The fallback is
 * `PAGE_MINT_DECIMALS` (6, the pump-fun convention), which on an EVM asset is
 * a 10^12 display error on an 18-decimals token with nothing on screen
 * dissenting — the same class of error `lib/evm/sizing.ts` refuses to make.
 * There is no EVM equivalent of "the page mint's family default": an EVM
 * asset's scale is either MEASURED (`AdvancedOrderView.input_token.decimals`,
 * the page's own `measuredTokenDecimals`, or the quote's) or unknown, so
 * `null` is the only honest answer here and callers must render the absence.
 *
 * This used to be reachable off Solana and was harmless only by accident:
 * every live call site happened to be behind a `chain === 'solana'` guard.
 * The guard is now in the function, where it cannot be forgotten.
 */
export function decimalsForMint(mint: string, chain: AdvancedOrderChain): number | null {
  if (chain !== 'solana') return null;
  if (mint === SOL_MINT) return SOL_DECIMALS;
  if (mint === USDC_MINT) return USDC_DECIMALS;
  return PAGE_MINT_DECIMALS;
}

/** Symbols knowable without any lookup — SOL / USDC sentinels only. */
export function knownSymbolForMint(mint: string): string | null {
  if (mint === SOL_MINT) return 'SOL';
  if (mint === USDC_MINT) return 'USDC';
  return null;
}

export function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/** Signed decimal integer string → abs bigint, or null on garbage. */
export function parseAbsBaseUnits(decimal: string): bigint | null {
  const s = decimal.startsWith('-') ? decimal.slice(1) : decimal;
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function trimFixed(n: number, digits: number): string {
  const fixed = n.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Display-only compaction (`1.2M`, `3.4K`, `0.98`). */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimFixed(n / 1e9, 2)}B`;
  if (abs >= 1e6) return `${trimFixed(n / 1e6, 2)}M`;
  if (abs >= 1e3) return `${trimFixed(n / 1e3, 2)}K`;
  if (abs >= 1) return trimFixed(n, 2);
  if (abs >= 0.01) return trimFixed(n, 4);
  return trimFixed(n, 8);
}

/**
 * The domain a scale may be stated in. Mirrors `lib/evm/sizing.ts`'s
 * `isSizeableScale`: a value outside it is a wire fault, not a scale, and
 * `10n ** BigInt(x)` would throw (negative / fractional) or hang the tab
 * (absurdly large) rather than render.
 */
function isRenderableScale(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36;
}

/**
 * `numerator / denominator`, rounded HALF-UP to `digits` decimal places, with
 * trailing zeros trimmed — the exact-integer twin of `trimFixed`.
 *
 * Both arguments are non-negative (callers pass an absolute value and a power
 * of ten), so there is no sign to carry and the truncating `/` is a floor.
 */
function divideRounded(numerator: bigint, denominator: bigint, digits: number): string {
  const shift = 10n ** BigInt(digits);
  // +denominator before the halved divide is the round-half-up: it adds
  // exactly 0.5 of the last kept digit before truncation.
  const scaled = (numerator * shift * 2n + denominator) / (denominator * 2n);
  const whole = (scaled / shift).toString();
  const frac = (scaled % shift).toString().padStart(digits, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/**
 * Base-unit amount string (possibly signed) → compact human amount.
 *
 * ALL BIGINT. This used to be `compactNumber(Number(formatBaseUnits(...)))`,
 * which pushed a count of base units through a JS double before compacting
 * it — the one float left on the EVM money surface. An 18-decimals balance
 * passes 2^53 at 0.01 tokens, so the double was carrying a rounded reading of
 * the number it was about to compact. Display-only and compacted to 2–8
 * digits, so nothing wrong was ever likely to SHOW; that is an argument for
 * the bound being small, not for the float being right.
 *
 * The buckets, the digit counts and the trailing-zero trimming are the same
 * as [`compactNumber`]'s (which stays, for the USD decimal strings that are
 * genuinely floats on the wire), and the bucket is chosen BEFORE rounding
 * exactly as it is there — so `999.999` still compacts to `1000`, not `1K`.
 */
export function formatTokenBaseUnits(baseUnits: string, decimals: number): string {
  const abs = parseAbsBaseUnits(baseUnits);
  if (abs === null || !isRenderableScale(decimals)) return '?';
  const scale = 10n ** BigInt(decimals);
  if (abs >= 1_000_000_000n * scale) return `${divideRounded(abs, 1_000_000_000n * scale, 2)}B`;
  if (abs >= 1_000_000n * scale) return `${divideRounded(abs, 1_000_000n * scale, 2)}M`;
  if (abs >= 1_000n * scale) return `${divideRounded(abs, 1_000n * scale, 2)}K`;
  if (abs >= scale) return divideRounded(abs, scale, 2);
  // `abs * 100n >= scale` rather than `abs >= scale / 100n`: the division
  // floors, and at decimals < 2 there is no integer hundredth to compare to.
  if (abs * 100n >= scale) return divideRounded(abs, scale, 4);
  return divideRounded(abs, scale, 8);
}

export function formatSolLamportsString(lamports: string): string {
  return formatTokenBaseUnits(lamports, SOL_DECIMALS);
}

/**
 * Toast copy for an automated suborder fill:
 *   buy  → "0.98 SOL → 1.2M SYM"
 *   sell → "1.2M SYM → 0.98 SOL"
 * `solDelta`/`tokenDelta` are the signed wire strings off the SSE fill
 * payload; the traded token side is assumed 6-decimals (page-mint
 * convention — same assumption the trade panel bakes in).
 */
export function formatAutomatedFillAmounts(
  side: 'buy' | 'sell',
  solDeltaLamports: string,
  tokenDelta: string,
  ticker: string,
): string {
  const sol = `${formatSolLamportsString(solDeltaLamports)} SOL`;
  const tok = `${formatTokenBaseUnits(tokenDelta, PAGE_MINT_DECIMALS)} ${ticker}`;
  return side === 'buy' ? `${sol} → ${tok}` : `${tok} → ${sol}`;
}

/** USD decimal string (wire format) → `$2M` style display. */
export function compactUsdFromDecimal(decimalStr: string | null): string {
  if (decimalStr === null || decimalStr === '') return '—';
  const n = Number(decimalStr);
  if (!Number.isFinite(n)) return `$${decimalStr}`;
  return `$${compactNumber(n)}`;
}

/** Limit-order trigger condition, e.g. "mcap ≤ $2M". */
export function triggerConditionLabel(
  order: Pick<AdvancedOrderView, 'price_basis' | 'trigger_cmp' | 'trigger_value_usd'>,
): string {
  const basis = order.price_basis === 'market_cap_usd' ? 'mcap' : 'price';
  const cmp = order.trigger_cmp === 'gte' ? '≥' : '≤';
  return `${basis} ${cmp} ${compactUsdFromDecimal(order.trigger_value_usd)}`;
}

/**
 * "1.2/4 SOL" spent-of-total line under the rounds counter.
 *
 * An EVM order whose input asset carries no measured `decimals` has no scale
 * to render at — `decimalsForMint` refuses off Solana — and this says so
 * rather than printing a figure at a guessed one. Same words the row itself
 * uses (`OrdersTabBody.decimalsForOrderAsset` → 'amount unavailable'), so the
 * two surfaces cannot disagree about what an absent scale looks like.
 */
export function recurringSpentLabel(
  order: Pick<
    AdvancedOrderView,
    'chain' | 'input_mint' | 'input_token' | 'input_spent_base_units' | 'total_input_base_units'
  >,
  inputSymbol: string,
): string {
  const decimals = order.input_token?.decimals ?? decimalsForMint(order.input_mint, order.chain);
  if (decimals === null) return 'amount unavailable';
  const spent = formatTokenBaseUnits(order.input_spent_base_units, decimals);
  const total = formatTokenBaseUnits(order.total_input_base_units, decimals);
  return `${spent}/${total} ${inputSymbol}`;
}

export function progressFraction(executed: number, total: number): number {
  if (!Number.isFinite(executed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, executed / total));
}

/**
 * Orders-tab ordering: open orders touching the current page mint first,
 * then other open orders, terminal (completed/cancelled/failed) last;
 * newest-created first within each group.
 */
export function sortAdvancedOrders(
  orders: ReadonlyArray<AdvancedOrderView>,
  pageMint: string | null,
): AdvancedOrderView[] {
  return Array.from(orders).sort((a, b) => {
    const rankA = orderRank(a, pageMint);
    const rankB = orderRank(b, pageMint);
    if (rankA !== rankB) return rankA - rankB;
    return (parseIsoMs(b.created_at) ?? 0) - (parseIsoMs(a.created_at) ?? 0);
  });
}

function orderRank(order: AdvancedOrderView, pageMint: string | null): number {
  if (!isOpenAdvancedStatus(order.status)) return 2;
  const touchesPage =
    pageMint !== null &&
    pageMint !== '' &&
    (order.input_mint === pageMint || order.output_mint === pageMint);
  return touchesPage ? 0 : 1;
}

/** Whole seconds → the largest exact duration unit (edit-modal prefill). */
export function bestDurationFit(totalSeconds: number): { value: string; unit: DurationUnit } {
  if (totalSeconds >= 86_400 && totalSeconds % 86_400 === 0) {
    return { value: String(totalSeconds / 86_400), unit: 'days' };
  }
  if (totalSeconds >= 3_600 && totalSeconds % 3_600 === 0) {
    return { value: String(totalSeconds / 3_600), unit: 'hours' };
  }
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
    return { value: String(totalSeconds / 60), unit: 'minutes' };
  }
  return { value: String(Math.max(1, Math.floor(totalSeconds))), unit: 'seconds' };
}

/**
 * BigInt-strict money formatting for every EVM surface.
 *
 * ONE rule, and it is the reason this module exists instead of a `Number()`
 * at each call site: **no EVM money value ever becomes a JS number.** These
 * are `u128`/`u256` base-unit integers on the wire as decimal strings, and
 * 2^53 is reached by 0.01 BNB (10^16 wei). A `Number()` conversion still
 * renders — just wrong — which is the worst failure mode for a figure a
 * trader acts on.
 *
 * Second rule, inherited from the wire: **absent is not zero.** Every
 * function here returns `null` for absent or malformed input so the caller
 * renders an em dash. Substituting `0` asserts a measurement nobody made.
 *
 * DECIMALS ARE AN ASSUMPTION ONLY WHERE NOTHING MEASURED ONE. Every formatter
 * that scales a token figure now takes `decimals` as a parameter; the constant
 * is the DEFAULT, applied when — and only when — the source served no scale.
 * `GET /api/v1/portfolio/evm` and `GET /api/v1/evm/trade/token-balance` both
 * read `decimals()` off the contract and report `null` rather than guessing,
 * and the discover / trade-header wire NOW CARRIES ONE TOO —
 * the backend source emits `decimals` whenever the identity
 * resolver measured it, and never defaults it to 18. So the assumption below
 * applies only to a token whose decimals are genuinely absent, and
 * [`EVM_TOKEN_DECIMALS_NOTE`] is shown only for those (see
 * `EvmCardView.tokenDecimalsAssumed`). That default is correct for four.meme
 * (its factory mints 18-decimal ERC-20s) and for Pons, and it is why the field
 * is a named constant with this comment rather than an inline `18`: the day a
 * venue mints a 6-decimal token whose scale we could not read, every
 * token-denominated figure on these pages is off by 10^12 and the only way to
 * notice is to have written down that we assumed.
 */

/** Native-asset decimals. BNB and ETH are both 18; no wave-1 chain differs. */
export const EVM_NATIVE_DECIMALS = 18;

/**
 * Assumed ERC-20 decimals for venue tokens. NOT served by the wire — see the
 * module header. four.meme's factory and Pons both mint 18-decimal tokens.
 */
export const EVM_TOKEN_DECIMALS = 18;

/**
 * The decimals assumption, in the words a user reads — not a source comment.
 *
 * The module header names the assumption for whoever edits this file. That is
 * not the same as DISCLOSING it, and everywhere else on the EVM trade surface
 * an unmeasured figure says so on the page: a partial history renders "counts
 * are unavailable rather than zero", a graduated curve says its reserves
 * stopped being a measurement, a wallet missing from a capped holder list is
 * "not in the top N" rather than a zero balance. A token-denominated number
 * scaled by a GUESSED exponent is the same class of claim, and it was the one
 * left unstated: if a venue ever mints a token at other than
 * `EVM_TOKEN_DECIMALS`, every token figure on the page is off by a power of
 * ten with nothing on screen admitting it could be.
 *
 * Rendered by the trade page's stats section, beside the other provenance
 * notes. The real fix is a `decimals` field on the ingestion wire — see the
 * cross-scope ask — at which point this constant and its render go away
 * together.
 */
export const EVM_TOKEN_DECIMALS_NOTE =
  `Token amounts assume ${EVM_TOKEN_DECIMALS} decimals. No decimals were reported ` +
  `for THIS token, so token-denominated figures on this page ` +
  `(reserves, balances, tape amounts, per-wallet flow) are scaled by that ` +
  `assumption rather than by a measured value. Native amounts and prices ` +
  `quoted in the chain's own asset are unaffected.`;

/**
 * Micro-USD (1e-6) and atto-USD (1e-18) are the two USD scales the wire uses.
 *
 * Two scales rather than one because a memecoin's per-token price is routinely
 * below a millionth of a dollar, and micro-USD floors every one of those to a
 * measured-looking zero — the structural-zero bug in a currency unit. So a
 * market cap or a volume travels in micro and a per-token price travels in
 * atto (the backend source).
 */
export const USD_MICRO_DECIMALS = 6;
export const USD_ATTO_DECIMALS = 18;
/** Nano-USD (1e-9) is the scale the native-asset ORACLE RATE travels in
 *  (`nativeUsdNano`). Not a market figure — the basis every USD figure on the
 *  surface was computed from. */
export const USD_NANO_DECIMALS = 9;

/** Digits-only, no sign, no whitespace, no exponent. */
const UNSIGNED_INTEGER = /^\d+$/;
/** As above, with an optional leading `-`. Realized PnL is genuinely signed. */
const SIGNED_INTEGER = /^-?\d+$/;

/**
 * Parse a wire decimal string as an exact integer.
 *
 * Strict BEFORE `BigInt`, because `BigInt` is not strict enough on its own:
 * `BigInt('')` is `0n` and `BigInt(' 1 ')` is `1n`, so a try/catch alone
 * renders an empty or padded field as a measured zero — the exact
 * structurally-zero failure this module exists to prevent.
 */
export function parseWire(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Parse a wire decimal string that may be NEGATIVE.
 *
 * Separate from [`parseWire`] rather than a relaxation of it, because almost
 * every figure on this surface is a quantity that cannot be negative and a
 * parser that quietly accepts `-1` for a reserve is a parser that will one day
 * render a negative pool. Only genuinely-signed fields — realized PnL, a fill's
 * native delta — use this one.
 */
export function parseWireSigned(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !SIGNED_INTEGER.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Render a base-unit integer at `decimals` scale, truncating (never
 * rounding) to `maximumFractionDigits`.
 *
 * Truncation is deliberate: rounding 0.99996 BNB up to "1" overstates a
 * balance, and every figure here is one a user compares against their own
 * wallet.
 */
export function formatUnits(
  raw: string | null | undefined,
  decimals: number,
  maximumFractionDigits = 4,
): string | null {
  const value = parseWire(raw);
  if (value === null) return null;
  return formatBigIntUnits(value, decimals, maximumFractionDigits);
}

/** As [`formatUnits`], for a value already parsed. */
export function formatBigIntUnits(
  value: bigint,
  decimals: number,
  maximumFractionDigits = 4,
): string {
  /* Sign is stripped and re-applied around the magnitude. BigInt division
     truncates toward zero and `%` keeps the sign, so `-1n % 10n` is `-1n` and
     padding it as a fraction produces `-0.-1`. Every figure below is derived
     from the ABSOLUTE value, which also keeps the sub-unit bound honest for a
     small loss (`-<0.0001`, not `0`). */
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, '');
  const sign = negative ? '-' : '';
  const wholeText = groupThousands(whole.toString());
  if (fractionText.length > 0) return `${sign}${wholeText}.${fractionText}`;
  // A NON-ZERO value that truncates to nothing at this precision must not
  // render as a flat "0". 1 wei is not zero BNB, and a balance panel that
  // says 0 for a non-empty wallet is the same false claim as a structural
  // zero — just produced by the formatter instead of the wire.
  if (whole === 0n && magnitude > 0n && maximumFractionDigits > 0) {
    return `${sign}<0.${'0'.repeat(maximumFractionDigits - 1)}1`;
  }
  return `${sign}${wholeText}`;
}

/** Native-denominated amount (BNB/ETH). */
export function formatNative(
  raw: string | null | undefined,
  maximumFractionDigits = 4,
): string | null {
  return formatUnits(raw, EVM_NATIVE_DECIMALS, maximumFractionDigits);
}

/**
 * Token-denominated amount.
 *
 * `decimals` is now a PARAMETER, defaulting to the assumption. Where a
 * measured scale exists (`GET /api/v1/portfolio/evm` reads `decimals()` off
 * the contract; the discover wire will carry it once the market layer is
 * wired) the caller passes it and the assumption never applies. See the module
 * header for why the default is not simply trusted.
 */
export function formatToken(
  raw: string | null | undefined,
  maximumFractionDigits = 2,
  decimals: number = EVM_TOKEN_DECIMALS,
): string | null {
  return formatUnits(raw, decimals, maximumFractionDigits);
}

/**
 * A whole-dollar-scale USD figure from a micro-USD (1e-6) integer string.
 *
 * `null` for absent or malformed input, exactly like every other formatter
 * here — the caller renders the explicit unknown with its reason. There is no
 * branch that invents a dollar figure from a native amount; converting one
 * requires a native/USD rate and the absence of that rate is precisely what
 * `usdUnavailableReason` reports.
 */
export function formatMicroUsd(
  raw: string | null | undefined,
  maximumFractionDigits = 2,
): string | null {
  const text = formatUnits(raw, USD_MICRO_DECIMALS, maximumFractionDigits);
  return text === null ? null : `$${text}`;
}

/**
 * A micro-USD integer as the COMPACT string the discover card's MC and V
 * slots speak (`31K`, `1.2M`) — no currency sign, because the Solana rows
 * beside it carry none and the slot's label is the unit.
 *
 * A sub-dollar figure keeps two decimals instead of compacting to `0`: a
 * $0.40 market cap is a real (and telling) measurement, and the whole point of
 * these slots is that a zero there reads as *this token is dead*.
 */
export function formatMicroUsdCompact(raw: string | null | undefined): string | null {
  return formatUsdCompact(raw, USD_MICRO_DECIMALS);
}

/**
 * The SAME compact slot, from an atto-USD (1e-18) integer string.
 *
 * the backend source publishes market cap and volume in atto FIRST and omits the micro
 * twin exactly where micro would floor a real measurement to `"0"`
 * (`floors_a_measurement`). A reader that only knows micro therefore renders
 * "unknown" for precisely the windows the wire took care to preserve — the
 * structural-zero bug, fixed on the wire and reintroduced at the reader. Every
 * USD slot must try atto before micro.
 */
export function formatAttoUsdCompact(raw: string | null | undefined): string | null {
  return formatUsdCompact(raw, USD_ATTO_DECIMALS);
}

/**
 * A scaled-USD integer string as a JS number of DOLLARS — for COMPARISON ONLY.
 *
 * THE ONLY LEGITIMATE USE IS A FILTER BOUND. Every rendered figure on this
 * surface comes from the BigInt formatters above and must keep coming from
 * them: this function is the single, named boundary where a money integer is
 * allowed to become a float, and it exists because the discover filters compare
 * against bounds the user typed (`parseShorthandUsd` yields a `number`). Feeding
 * its result into a render, a size, or an order would reintroduce exactly the
 * rounding this module was written to prevent.
 *
 * `null` — never `0` — when the input is absent or not a wire integer, so an
 * unmeasured figure stays unmeasured all the way into `passesRange`.
 *
 * The whole part is divided in BigInt and only the sub-dollar remainder is ever
 * converted, so a trillion-dollar cap keeps every dollar digit exactly; only
 * cents beyond a double's reach are lost, and no filter bound resolves there.
 */
export function usdScaledToNumber(
  raw: string | null | undefined,
  decimals: number,
): number | null {
  const value = parseWire(raw);
  if (value === null) return null;
  const scale = 10n ** BigInt(decimals);
  const dollars = Number(value / scale) + Number(value % scale) / Number(scale);
  return Number.isFinite(dollars) ? dollars : null;
}

/**
 * The oracle's own native/USD rate, from a nano-USD (1e-9) integer string.
 *
 * Two decimals: this is a rate a user reads to check our arithmetic
 * ("BNB at $612.40"), not a figure they trade on.
 */
export function formatNanoUsdRate(raw: string | null | undefined): string | null {
  const text = formatUnits(raw, USD_NANO_DECIMALS, 2);
  return text === null ? null : `$${text}`;
}

/**
 * A wei-denominated native amount as a compact USD figure, priced at the
 * oracle's own nano-USD rate — the tape's per-row dollar leg.
 *
 * The caller gates on the PRODUCER's freshness verdict (`usdUnavailableReason`
 * absent) before passing a rate; this function only does the arithmetic, and
 * it does all of it in BigInt: wei (1e-18 native) × nano-USD-per-native
 * (1e-9) is 1e-27 USD, ÷ 1e9 lands on the atto-USD scale the compact
 * formatter already speaks. `null` for an absent or malformed leg — absent is
 * never zero, and there is no branch that invents a rate.
 */
export function formatWeiUsd(
  costWei: string | null | undefined,
  nativeUsdNano: string | null | undefined,
): string | null {
  const wei = parseWire(costWei);
  const rate = parseWire(nativeUsdNano);
  if (wei === null || rate === null || rate === 0n) return null;
  const attoUsd = (wei * rate) / 10n ** BigInt(USD_NANO_DECIMALS);
  const compact = formatUsdCompact(attoUsd.toString(), USD_ATTO_DECIMALS);
  return compact === null ? null : `$${compact}`;
}

/** Shared body of the compact USD slots. `decimals` is the wire's scale. */
function formatUsdCompact(raw: string | null | undefined, decimals: number): string | null {
  const value = parseWire(raw);
  if (value === null) return null;
  const dollars = value / 10n ** BigInt(decimals);
  if (dollars === 0n && value > 0n) {
    return formatBigIntUnits(value, decimals, 2);
  }
  return compactBigInt(dollars);
}

/**
 * A per-token USD price from an atto-USD (1e-18) integer string.
 *
 * Rendered at high precision because the values that need atto in the first
 * place are the ones micro would floor to zero: a token at 4e-11 USD is a real
 * price and `$0.00` is not a rounding of it.
 */
export function formatAttoUsdPrice(
  raw: string | null | undefined,
  significantDigits = 4,
): string | null {
  const value = parseWire(raw);
  if (value === null) return null;
  if (value === 0n) return '$0';
  const text = formatBigIntUnits(value, USD_ATTO_DECIMALS, USD_ATTO_DECIMALS);
  return `$${trimToSignificant(text, significantDigits)}`;
}

/**
 * Compact a token amount as `1.2M` / `845K`.
 *
 * The magnitude is chosen from the BigInt's DIGIT COUNT, and only the small
 * already-scaled remainder is ever divided — a supply-scale `u256` never
 * touches a float even transiently.
 */
export function formatTokenCompact(
  raw: string | null | undefined,
  decimals: number = EVM_TOKEN_DECIMALS,
): string | null {
  const value = parseWire(raw);
  if (value === null) return null;
  const whole = value / 10n ** BigInt(decimals);
  // A NON-ZERO balance below one whole token must not compact to a flat "0".
  // `compactBigInt` works on the already-divided whole part, so it cannot see
  // the remainder — routing sub-unit values back through the scaled formatter
  // is what keeps the `<0.0001` bound (and the honest `0.5`) instead of a
  // fabricated zero. Every caller of this function renders a figure a trader
  // reads as a quantity: holder balances, tape amounts, per-wallet token
  // flow, and the curve's token reserve, where a "0" reads as an empty pool.
  if (whole === 0n && value > 0n) {
    return formatBigIntUnits(value, decimals, 4);
  }
  return compactBigInt(whole);
}

/** Compact a plain (already unscaled) integer count. */
export function compactBigInt(whole: bigint): string {
  const digits = whole.toString();
  if (digits.length <= 3) return digits;
  const units: readonly [number, string][] = [
    [12, 'T'],
    [9, 'B'],
    [6, 'M'],
    [3, 'K'],
  ];
  for (const [exponent, suffix] of units) {
    if (digits.length > exponent) {
      const scaled = formatBigIntUnits(whole, exponent, 1);
      return `${scaled}${suffix}`;
    }
  }
  return groupThousands(digits);
}

/**
 * A price, from the wire's `<field>Num` / `<field>Den` pair.
 *
 * The wire ships a RATIO, not a scalar, because `native_wei /
 * token_base_units` has no exact machine representation at 18 decimals and
 * both words routinely exceed 2^53 (the backend source). The division
 * happens here, in fixed-point BigInt arithmetic, at
 * `PRICE_PRECISION` digits — so the rendered price is exact to the digit we
 * show rather than exact to whatever a double happened to hold.
 *
 * The ratio is native-per-token in BASE UNITS, so it must be rescaled by
 * `10^(tokenDecimals - nativeDecimals)` to read as "BNB per whole token".
 * Both are 18 today, which makes the factor 1 — written out anyway so the
 * day they differ is a one-line change and not a silent 10^12 error.
 *
 * **`tokenDecimals` HAS NO DEFAULT, and that is the point.** It used to fall
 * back to [`EVM_TOKEN_DECIMALS`], so a call site that simply forgot the
 * argument compiled, rendered, and was wrong by `10^(18 - d)` on every token
 * whose scale is not 18 — silently, because the omission and the deliberate
 * assumption are the same three characters. `EvmCandleChart` was exactly that:
 * its header figure ignored a MEASURED scale while the price 20 pixels above
 * it honoured one, and nothing on screen disagreed. A caller that genuinely
 * means the assumption passes [`EVM_TOKEN_DECIMALS`] by name, which is a thing
 * a reviewer can see; forgetting is now a compile error.
 */
const PRICE_PRECISION = 12;

export function formatPrice(
  num: string | null | undefined,
  den: string | null | undefined,
  significantDigits = 6,
  tokenDecimals: number,
): string | null {
  return formatQuotePrice(
    num,
    den,
    significantDigits,
    tokenDecimals,
    EVM_NATIVE_DECIMALS,
  );
}

/** Exact quote-token base-unit ratio rendered per whole launched token. */
export function formatQuotePrice(
  num: string | null | undefined,
  den: string | null | undefined,
  significantDigits: number,
  tokenDecimals: number,
  quoteDecimals: number,
): string | null {
  const numerator = parseWire(num);
  const denominator = parseWire(den);
  if (numerator === null || denominator === null) return null;
  // A zero denominator is UNDEFINED, not zero and not infinity. The wire
  // should never emit one; if it does, an em dash is the honest render.
  if (denominator === 0n) return null;

  const scale = 10n ** BigInt(PRICE_PRECISION);
  const decimalsFactor = tokenDecimals - quoteDecimals;
  let scaledNum = numerator * scale;
  let scaledDen = denominator;
  if (decimalsFactor > 0) {
    scaledNum *= 10n ** BigInt(decimalsFactor);
  } else if (decimalsFactor < 0) {
    scaledDen *= 10n ** BigInt(-decimalsFactor);
  }
  const fixed = scaledNum / scaledDen;
  if (fixed === 0n) {
    // Non-zero but below what PRICE_PRECISION can express. Saying "0" would
    // claim the token is free; "<0.000000000001" is the true statement.
    return `<0.${'0'.repeat(PRICE_PRECISION - 1)}1`;
  }
  return trimToSignificant(
    formatBigIntUnits(fixed, PRICE_PRECISION, PRICE_PRECISION),
    significantDigits,
  );
}

/**
 * Price implied by a curve's reserves — `reserveNative / reserveToken`.
 *
 * Both absent (a token whose curve no trade has proved yet, or a graduated
 * token whose curve stopped being the market) yields `null`, never a price
 * of zero. That distinction is the whole reserve doctrine in
 * the backend source, carried into the render.
 */
export function formatReservePrice(
  reserveNative: string | null | undefined,
  reserveToken: string | null | undefined,
  /** Required, for the reason spelled out on [`formatPrice`]. */
  tokenDecimals: number,
): string | null {
  return formatPrice(reserveNative, reserveToken, 6, tokenDecimals);
}

export function formatQuoteReservePrice(
  reserveQuote: string | null | undefined,
  reserveToken: string | null | undefined,
  tokenDecimals: number,
  quoteDecimals: number,
): string | null {
  return formatQuotePrice(reserveQuote, reserveToken, 6, tokenDecimals, quoteDecimals);
}

/**
 * A price ratio as a float — **for PIXEL GEOMETRY ONLY.**
 *
 * This is the one place an EVM money value becomes a JS number, and it is
 * allowed for exactly one reason: an SVG coordinate is a float no matter what
 * we do, and a chart axis that is exact to 2^-52 is indistinguishable from
 * one that is exact to the pixel. **Nothing rendered as TEXT may come from
 * here** — every displayed figure goes through [`formatPrice`], which is
 * BigInt fixed-point. If you find yourself passing this to a `toFixed`, you
 * have reintroduced the precision bug this module exists to prevent.
 *
 * The division is done in BigInt at [`PRICE_PRECISION`] digits first, so the
 * float is built from an already-bounded fixed-point integer rather than from
 * two 256-bit words neither of which is representable.
 */
export function ratioToPlotValue(
  num: string | null | undefined,
  den: string | null | undefined,
): number | null {
  const numerator = parseWire(num);
  const denominator = parseWire(den);
  if (numerator === null || denominator === null || denominator === 0n) return null;
  const scale = 10n ** BigInt(PRICE_PRECISION);
  const fixed = (numerator * scale) / denominator;
  // A REAL price that floors to zero at this precision is BELOW what the plot
  // scale can express — absent, never a 0 the chart happily draws. Returning
  // it made every candle of a sub-1e-12 token (an 18-decimal token on a
  // ~1e15 supply is one) plot at 0, so the series rendered as a flat line
  // pinned to the axis while the header beside it correctly read
  // `<0.000000000001`. Nothing on screen said the geometry was fabricated,
  // and `EvmCandleChart`'s own `pricelessBuckets` counter read 0 because a
  // zero is not a null. `sparkline.ts` already omits these (`value > 0`);
  // this makes the two agree.
  if (fixed === 0n) return null;
  const value = Number(fixed) / Number(scale);
  return Number.isFinite(value) ? value : null;
}

/** Keep at most `digits` significant digits, without ever using a float. */
function trimToSignificant(text: string, digits: number): string {
  const [wholeRaw = '0', fractionRaw = ''] = text.split('.');
  const whole = wholeRaw.replace(/,/g, '');
  if (whole !== '0') {
    const remaining = Math.max(digits - whole.length, 0);
    const fraction = fractionRaw.slice(0, remaining).replace(/0+$/, '');
    return fraction.length > 0 ? `${wholeRaw}.${fraction}` : wholeRaw;
  }
  // Leading zeros after the point are not significant.
  const leadingZeros = /^0*/.exec(fractionRaw)?.[0].length ?? 0;
  const fraction = fractionRaw.slice(0, leadingZeros + digits).replace(/0+$/, '');
  return fraction.length > 0 ? `0.${fraction}` : '0';
}

/** `1234567` → `1,234,567`. String-only; no locale, no float. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Human age from a millisecond epoch, or `null` when the source did not
 * report one.
 *
 * `the ingestion service` omits a timestamp when the block carried none usable, and
 * omits it rather than sending the epoch — so `null` here means "unknown
 * age", never "created in 1970".
 */
export function formatAge(fromMs: number | null | undefined, nowMs: number): string | null {
  if (typeof fromMs !== 'number' || !Number.isFinite(fromMs) || fromMs <= 0) return null;
  const deltaSec = Math.floor((nowMs - fromMs) / 1000);
  if (deltaSec < 0) return 'now';
  if (deltaSec < 60) return `${deltaSec}s`;
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

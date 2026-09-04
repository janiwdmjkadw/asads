/**
 * Client-side order ESTIMATE for the EVM trade panel.
 *
 * WHAT THIS IS NOT. It is not a quote from the engine. `the backend service`
 * owns the binding `minAmountOut` — it reads the venue's live reserves at
 * compose time and the verifier re-checks the ABI word against the intent
 * before anything is signed. There is no browser-reachable quote endpoint,
 * and inventing one client-side would put a number in front of a trader that
 * nothing downstream is bound by.
 *
 * WHAT IT IS. The arithmetic a user would do themselves with the price
 * already on the page: `amount ÷ price`, at the last indexed price, with the
 * slippage floor their own setting implies. It is labelled as an estimate at
 * every render site, and it explicitly EXCLUDES price impact and venue fees —
 * both of which move the result against the user, so the estimate is an upper
 * bound on what they receive, never a flattering one.
 *
 * Every value is `bigint`. The inputs are 256-bit reserve words; a `Number`
 * anywhere in here reintroduces exactly the precision failure the rest of
 * this directory exists to prevent.
 */

import { applyBps } from './amount';
import { parseWire } from './money';

/** The two exact ratios a page can price against, in preference order. */
export interface EvmPriceRatio {
  /** Native (wei) per `den` token base units. */
  readonly num: bigint;
  readonly den: bigint;
  /** Where the ratio came from, rendered so the user can judge it. */
  readonly source: 'last trade' | 'curve price' | 'pair reserves';
}

/** The fixed point four.meme's price word carries — `10^18`. */
const CURVE_PRICE_WORD_DEN = 10n ** 18n;

/**
 * Pick the price to estimate against.
 *
 * The last observed trade beats everything: it is what the market actually
 * paid. Returns `null` when nothing else can be justified — an unpriced token
 * gets NO estimate, not a zero one and not a wrong one.
 *
 * **THE FALLBACK IS BASIS-DEPENDENT, and reading it wrong was a ~480x error
 * on the buy button.** `reserveNative`/`reserveToken` are two different things
 * depending on `reserveBasis`:
 *
 * - `curve` — they are the curve's CUMULATIVE quote raised and its REMAINING
 *   offers. **Not reserves, and their ratio is not a price.** The producer
 *   forbids the derivation outright (the backend source:
 *   "Do not derive a price from `reserve_native / reserve_token` on a `Curve`
 *   basis. Use `curve_price_word`.") and measured the gap live on BSC —
 *   1.2e-11 against a true 5.7e-9 (the backend source). Priced from
 *   `funds/offers`, a 0.1 BNB buy estimated ~8.3 B tokens where the engine
 *   would deliver ~17.5 M. The venue's own word is `curvePriceWord`, and it
 *   is the only curve price this page may show.
 * - `amm_pair` — real pair balances, so the ratio IS a constant-product price.
 * - anything else (`concentrated_virtual`, or a frame that predates the
 *   field) — no ratio these two words support. Absent.
 */
export function pickPriceRatio(
  lastTrade: { cost?: string | null; amount?: string | null } | null,
  reserves: {
    native?: string | null;
    token?: string | null;
    basis?:
      | 'curve'
      | 'amm_pair'
      | 'pancake_v2'
      | 'pancake_v3'
      | 'uniswap_v2'
      | 'uniswap_v3'
      | 'uniswap_v4'
      | 'pancake_infinity_cl'
      | 'flap_curve'
      | 'concentrated_virtual'
      | null;
    curvePriceWord?: string | null;
  },
): EvmPriceRatio | null {
  const tradeNum = parseWire(lastTrade?.cost);
  const tradeDen = parseWire(lastTrade?.amount);
  if (tradeNum !== null && tradeDen !== null && tradeDen > 0n && tradeNum > 0n) {
    return { num: tradeNum, den: tradeDen, source: 'last trade' };
  }
  if (reserves.basis === 'curve') {
    const word = parseWire(reserves.curvePriceWord);
    // No fallback to `funds/offers` here. An estimate that is three orders of
    // magnitude out is worse than no estimate, because the panel labels it.
    return word !== null && word > 0n
      ? { num: word, den: CURVE_PRICE_WORD_DEN, source: 'curve price' }
      : null;
  }
  if (
    reserves.basis !== 'amm_pair'
    && reserves.basis !== 'pancake_v2'
    && reserves.basis !== 'uniswap_v2'
  ) return null;
  const reserveNum = parseWire(reserves.native);
  const reserveDen = parseWire(reserves.token);
  if (reserveNum !== null && reserveDen !== null && reserveDen > 0n && reserveNum > 0n) {
    return { num: reserveNum, den: reserveDen, source: 'pair reserves' };
  }
  return null;
}

export interface EvmOrderEstimate {
  /** Base units of the asset the user receives. */
  readonly receive: bigint;
  /** `receive` after the user's own slippage tolerance. */
  readonly minimum: bigint;
  readonly source: EvmPriceRatio['source'];
}

/**
 * Estimate a BUY: spend `nativeWei`, receive token base units.
 *
 * `tokens = nativeWei × den ÷ num`, i.e. divide by the native-per-token
 * price. Integer division floors, which is the conservative direction.
 */
export function estimateBuy(
  nativeWei: bigint,
  price: EvmPriceRatio,
  slippageBps: number,
): EvmOrderEstimate | null {
  if (nativeWei <= 0n || price.num <= 0n || price.den <= 0n) return null;
  const receive = (nativeWei * price.den) / price.num;
  // A spend too small to buy one base unit at this price is NOT "0 tokens
  // received" — it is an order that cannot be filled, and saying "0" reads
  // as a measured outcome. Absent instead.
  if (receive <= 0n) return null;
  return {
    receive,
    minimum: receive - applyBps(receive, slippageBps),
    source: price.source,
  };
}

/** Estimate a SELL: give `tokenBaseUnits`, receive native wei. */
export function estimateSell(
  tokenBaseUnits: bigint,
  price: EvmPriceRatio,
  slippageBps: number,
): EvmOrderEstimate | null {
  if (tokenBaseUnits <= 0n || price.num <= 0n || price.den <= 0n) return null;
  const receive = (tokenBaseUnits * price.num) / price.den;
  if (receive <= 0n) return null;
  return {
    receive,
    minimum: receive - applyBps(receive, slippageBps),
    source: price.source,
  };
}

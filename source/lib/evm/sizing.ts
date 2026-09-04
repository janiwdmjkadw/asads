/**
 * WHICH SCALE SIZES AN ORDER — the one decision on the EVM trade surface where
 * a wrong exponent spends the wrong amount of real money.
 *
 * `lib/evm/amount.ts` converts text to base units at a scale it is GIVEN;
 * `lib/evm/money.ts` renders base units at a scale it is given. Neither of
 * them chooses the scale. This module does, and it is separate from both
 * because choosing wrong has a different consequence from formatting wrong: a
 * misformatted figure is a misread, a mis-scaled order is a mis-spend that the
 * user never sees fail. It looks like it worked.
 *
 * THE RULE: **an unknown scale is never 18.**
 *
 * `EVM_TOKEN_DECIMALS = 18` is a legitimate DEFAULT for rendering — a figure
 * shown at a disclosed assumption is still worth showing, and the trade page
 * discloses it (`EVM_TOKEN_DECIMALS_NOTE`, gated on
 * `EvmCardView.tokenDecimalsAssumed`). It is NOT a legitimate default for
 * sizing. Decimals are not universally 18: verified live on BSC, DOGE is 8 and
 * TLM is 4. A sell sized against an assumed 18 on a 6-decimal token is wrong by
 * 10^12, and nothing on screen says so — the order is simply for the wrong
 * amount.
 *
 * So a sell whose scale nobody measured is REFUSED here, and the refusal
 * carries its reason. That is the posture the api already took for the same
 * cause: `sell_percent_bps` is rejected on EVM because sizing a percentage
 * needs real decimals plus a live balance, and it would rather refuse than
 * guess.
 *
 * A BUY IS UNAFFECTED BY THE TOKEN'S SCALE, and that is a fact about the wire,
 * not an exemption: the order body's only amount field is `native_in_wei`, wei
 * of the chain's own asset, and every wave-1 chain's native asset is 18
 * decimals (`EVM_NATIVE_DECIMALS`). A buy never touches the token's scale to
 * be SIZED. It touches it only to DISPLAY the estimated tokens received, which
 * is a render decision the panel makes separately.
 *
 * It is NOT unaffected by the QUOTE's scale, which this module used to assume
 * away — see `resolveOrderScale`. A market quoted in a stock token is not
 * denominated in wei of anything this wire can express.
 *
 * THE SECOND HALF OF THE SAME RULE: **an unmeasured balance is never a
 * number.** A percentage preset multiplies a balance, so a balance that is a
 * clamped lower bound mis-sizes exactly like a guessed scale does, and
 * `resolveSellBalance` refuses it the same way.
 */

import { EVM_NATIVE_DECIMALS } from './money';
import type { EvmHolderPage, EvmReadResult } from './tradeApi';

/**
 * The scale an order amount is denominated in, or the refusal to name one.
 *
 * Deliberately not `number | null`: a nullable number invites `?? 18` at the
 * call site, which is the exact bug. An `unknown` variant carries the sentence
 * the panel shows instead, so refusing is as easy as guessing.
 */
export type OrderScale =
  | { readonly kind: 'known'; readonly decimals: number }
  | { readonly kind: 'unknown'; readonly why: string };

/**
 * The domain `parseDecimalAmount` accepts. A measured value outside it is a
 * wire fault, and it resolves to `unknown` rather than to the default — an
 * absurd scale is not evidence for 18.
 */
function isSizeableScale(decimals: number | null): decimals is number {
  return decimals !== null
    && Number.isInteger(decimals)
    && decimals >= 0
    && decimals <= 36;
}

export interface TokenScaleInput {
  /**
   * The MEASURED value, or `null` — never the render-time fallback.
   * `EvmCardView.measuredTokenDecimals` is that field;
   * `EvmCardView.tokenDecimals` is NOT, and passing it here reintroduces the
   * bug this module exists to prevent.
   */
  readonly measuredTokenDecimals: number | null;
  /** The wire's reason the scale is absent (`identityAbsent.decimals`). */
  readonly decimalsAbsentText?: string | null;
  /** Ticker of the chain's own asset, for the buy-is-unaffected clause. */
  readonly nativeSymbol: string;
}

/**
 * The TOKEN's scale — what one base unit of this token means as a quantity.
 *
 * Used for sizing a sell and for rendering any token-denominated figure in the
 * order panel. The refusal sentence is written to be true at every one of
 * those sites, because a scale that is unknown is unknown for all of them.
 */
export function resolveTokenScale(input: TokenScaleInput): OrderScale {
  if (isSizeableScale(input.measuredTokenDecimals)) {
    return { kind: 'known', decimals: input.measuredTokenDecimals };
  }
  const reason =
    typeof input.decimalsAbsentText === 'string' && input.decimalsAbsentText.length > 0
      ? ` — ${input.decimalsAbsentText}`
      : '';
  return {
    kind: 'unknown',
    why:
      `This token's decimals have not been measured${reason}. A token amount is a `
      + 'count of base units, so with no scale there is no saying what quantity a '
      + 'number here stands for: a sell cannot be sized, and the tokens a buy would '
      + 'receive cannot be shown. Sizing either against a guessed scale could be '
      + 'wrong by many orders of magnitude with no error appearing. Buying itself '
      + `is unaffected — it is denominated in ${input.nativeSymbol}, the chain's own coin.`,
  };
}

/**
 * Resolve the scale that SIZES one side of one order.
 *
 * A sell defers to the token's own scale and is refused when there is none.
 *
 * A buy is sizeable **only when the market's money leg really is the chain's
 * own coin**, which is `quoteIsNative` and is required here rather than
 * optional. The module header's "buys are unconditionally sizeable" was true
 * of the TOKEN's scale and silently false of the QUOTE's: the order body's
 * only amount field is `native_in_wei`, so the figure a user types is read as
 * wei of the native asset — but roughly half of live Pons v2 launches are
 * quoted in Robinhood STOCK tokens (NVDA, SPY), and on those markets the money
 * leg is that token, not ETH. `18` is then a guess about the quote token's
 * decimals, and the wire carries no decimals for the quote leg at all
 * (the backend source sends `quoteToken`, an address, and nothing else), so there is
 * nothing to rescale from. That is the same shape as an unmeasured token
 * scale and it gets the same answer: refuse, and say why.
 */
export function resolveOrderScale(
  input: TokenScaleInput & {
    readonly side: 'buy' | 'sell';
    /**
     * Whether this market's money leg is the chain's own coin
     * (`EvmCardView.quote.isNative`). Required, and never defaulted to `true`:
     * silence about the denomination must not be read as ETH.
     */
    readonly quoteIsNative: boolean;
    /** Measured quote-token scale. Required for a non-native buy. */
    readonly quoteDecimals?: number | null;
    /** Display name only; never used as identity. */
    readonly quoteSymbol?: string | null;
  },
): OrderScale {
  if (input.side === 'sell') return resolveTokenScale(input);
  if (input.quoteIsNative) return { kind: 'known', decimals: EVM_NATIVE_DECIMALS };
  const quoteDecimals = input.quoteDecimals ?? null;
  if (isSizeableScale(quoteDecimals)) {
    return { kind: 'known', decimals: quoteDecimals };
  }
  return {
    kind: 'unknown',
    why:
      "This market's money leg is not "
      + `${input.nativeSymbol}, so an amount here is not a count of `
      + `${input.nativeSymbol}; it is a count of ${input.quoteSymbol ?? 'the quote token'} base `
      + 'units, whose decimals have not been measured. The order wire accepts '
      + 'the exact quote asset, but there is no safe scale to send it at. Sizing one at '
      + 'an assumed 18 could be wrong by many orders of magnitude with no '
      + 'error appearing.',
  };
}

/**
 * What the panel may treat as the seller's balance of this token.
 *
 * Same posture as [`resolveTokenScale`], for the other half of the same
 * arithmetic. A percentage preset is `balance * bps / 10_000`, so it is only
 * as true as the balance — and a holder page can hand back a number that is
 * NOT a measurement of one:
 *
 * - **A PARTIAL page's balances are FLOORS.** the backend source folds
 *   transfers from wherever our cursor started, and every debit against a
 *   wallet funded before that clamps at zero (`underflows_clamped` counts
 *   them; a live run clamped 6,493 of 7,098). So the row's `balance` is a
 *   lower bound, not the position. "100%" of a lower bound is not 100% of
 *   anything the user holds — it can be 5% of it — and the order goes out
 *   labelled as the whole position with nothing on screen dissenting.
 * - **Absence from a capped page is not a zero balance**, and a failed read
 *   is not a zero balance either.
 *
 * Returns the panel's `EvmTokenBalance` shape structurally, so the trade page
 * can hand the result straight to `EvmTradePanel` without this leaf module
 * importing a component.
 */
export type OrderBalance =
  | { readonly kind: 'known'; readonly baseUnits: string }
  | { readonly kind: 'unknown'; readonly why: string };

export function resolveSellBalance(input: {
  /** The wallet the panel is pointed at, or `null` if none is selected. */
  readonly wallet: string | null;
  /** The holder read, or `null` while it is still in flight. */
  readonly holders: EvmReadResult<EvmHolderPage> | null;
}): OrderBalance {
  if (input.wallet === null) {
    return { kind: 'unknown', why: 'No wallet selected yet.' };
  }
  if (input.holders === null) {
    return { kind: 'unknown', why: 'Holder balances are still loading.' };
  }
  if (input.holders.kind !== 'ok') {
    return {
      kind: 'unknown',
      why: 'The holder read failed, so your balance of this token is unknown.',
    };
  }
  const page = input.holders.value;
  if (page.partial) {
    // BEFORE the row lookup, because finding the row is exactly the case that
    // goes wrong: an absent row was already refused, and a PRESENT row on a
    // partial page is the one that quietly sizes an order off a floor.
    return {
      kind: 'unknown',
      why:
        'This token’s transfer history is partial, so the balances on this '
        + 'page are LOWER BOUNDS rather than measurements — every debit '
        + 'against a wallet funded before the indexer started clamps to zero. '
        + 'A percentage of a lower bound is not the percentage you asked for, '
        + 'so the presets are unavailable. Type an amount instead.',
    };
  }
  const row = page.holders.find(
    (entry) => entry.address.toLowerCase() === input.wallet?.toLowerCase(),
  );
  if (row !== undefined) return { kind: 'known', baseUnits: row.balance };
  return {
    kind: 'unknown',
    // NOT "you hold zero". The list is capped and absence from it is absence
    // of evidence.
    why: page.truncated
      ? `Your wallet is not in the top ${page.count} holders, so this read does not carry its balance.`
      : 'The indexer has not observed this wallet holding this token.',
  };
}

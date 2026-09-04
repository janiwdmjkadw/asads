/**
 * Pure presentation rules for the discover card.
 *
 * WHY A SEPARATE MODULE. These are the card's decisions — may this row offer a
 * one-click buy, what colour is its market cap, what does an absent figure say
 * about itself — and every one of them is a pure function of data. They lived
 * in `CoinCard.tsx`, which is a client component that imports Clerk, the trade
 * store, prewarm and the wallet selector. Under bun's ESM linker that graph
 * cannot even LOAD (`@clerk/nextjs` does not expose `useClerk` from its ESM
 * entry), so `CoinCard.test.ts` has been failing to load for as long as it has
 * existed and the rules it covers were effectively untested.
 *
 * Moving them here makes them testable without a DOM, without Clerk, and
 * without a render — which matters most for `quickbuyIsEnabled`, because that
 * one decides whether a control that SPENDS REAL MONEY appears.
 *
 * Nothing here may import a React hook, a store, or a component.
 */

import type { QuickBuySectionId } from '@/lib/state/trade-store';
/* Pure function, no hook/store/component — safe under this module's rule. */
import { marketCapTone } from './mcTone';
import { depthUnavailableText, quoteBasisDisclosure, type ChainBinding } from './chainBinding';
import type { MockCoin } from './mockCoins';

/**
 * May this card offer a one-click SOL-denominated buy?
 *
 * The two conjuncts that are NOT about the amount are the ones that matter:
 * - `sectionId !== null` — no section means no `quickBuyAmountsBySection` slot
 *   and no active-preset override to resolve.
 * - `!isChainBound` — a bound row's spend is denominated in the chain's own
 *   asset, and every amount we hold is a number of SOL. Enabling this for a
 *   BSC row would post a Solana order for a token that is not on Solana, at an
 *   amount the user chose for a different currency.
 */
export function quickbuyIsEnabled(input: {
  hasMint: boolean;
  sectionId: QuickBuySectionId | null;
  isChainBound: boolean;
  pairIsUsdc: boolean;
  hasQuickBuyAmount: boolean;
}): boolean {
  if (!input.hasMint) return false;
  if (input.sectionId === null) return false;
  if (input.isChainBound) return false;
  // Unchanged from the original: a USDC pair sizes from the server-defaulted
  // micro-USDC preset and needs no per-section setup.
  return input.pairIsUsdc || input.hasQuickBuyAmount;
}

export function marketCapColorForSection(
  coin: Pick<MockCoin, 'marketCapUsd' | 'bondingProgressPct'>,
  sectionId: QuickBuySectionId | null,
): string {
  /* No section means no Solana bonding/market-cap thresholds to compare
     against. Those thresholds encode pump.fun's graduation economics, which
     say nothing about a four.meme curve — colouring by them would be a
     confident signal derived from the wrong market. Neutral ink instead. */
  if (sectionId === null) return 'var(--ink-2)';

  /* The ladder itself lives in `./mcTone`, so the wallet-activity ledger's
     MC column paints from the same three steps and an $86K token reads
     identically on a graduated card and a ledger row. These thresholds were
     inline here until that column needed them; do not re-inline them. */
  if (sectionId === 'graduated') return marketCapTone(coin.marketCapUsd);

  if (sectionId === 'new-pairs' || sectionId === 'almost-graduated') {
    const progress = coin.bondingProgressPct;
    if (typeof progress !== 'number' || !Number.isFinite(progress)) return 'var(--up)';
    if (progress >= 80) return 'var(--down)';
    if (progress >= 50) return 'var(--hold)';
    return 'var(--up)';
  }

  return 'var(--up)';
}

/**
 * Why a market cap is unavailable for this row, in the user's words.
 *
 * Ordered most-specific-first: an underivable pool is a different situation
 * from a missing USD rate, and telling a user "no dollar rate" when the real
 * answer is "we cannot read this pool's depth" sends them to wait for
 * something that will never arrive.
 */
export function marketCapUnknownReason(
  binding: ChainBinding | undefined,
  nativeText?: string | null,
  nativeSymbol?: string | null,
): string {
  if (binding === undefined) {
    return 'Market cap is not available for this token yet.';
  }
  /* WE MEASURED IT, in the chain's own asset — only the dollar conversion is
     missing. Checked BEFORE the depth and quote reasons because it is a
     stronger statement than either: those explain why a figure is unknown, and
     this one says the figure is known and states it. Mirrors
     `volumeUnknownReason`, which has always had this branch; the market-cap
     slot did not, so a stale oracle erased a real BNB cap into "unknown". */
  if (typeof nativeText === 'string' && typeof nativeSymbol === 'string') {
    return (
      `${nativeText} ${nativeSymbol} market cap. No USD rate is published for `
      + 'this chain here, so this is not converted to dollars.'
    );
  }
  const depthReason = depthUnavailableText(binding.depthStatus);
  if (depthReason !== null) return depthReason;
  const quoteReason = quoteBasisDisclosure(binding.quote);
  if (quoteReason !== null) {
    return `${quoteReason} A dollar market cap would require that asset’s rate, which is not published here.`;
  }
  return (
    `No USD rate is published for ${binding.nativeSymbol} on this surface, so a `
    + 'dollar market cap cannot be computed. Showing a zero would read as a dead '
    + 'token, which is a different and false claim.'
  );
}

/** Why a USD volume is unavailable. */
export function volumeUnknownReason(
  binding: ChainBinding | undefined,
  nativeText: string | null | undefined,
  nativeSymbol: string | null | undefined,
): string {
  if (binding === undefined) {
    return 'Volume is not available for this token yet.';
  }
  if (typeof nativeText === 'string' && typeof nativeSymbol === 'string') {
    // We MEASURED the volume; only the dollar conversion is missing. Say the
    // number rather than hiding a real measurement behind "unknown".
    return (
      `${nativeText} ${nativeSymbol} traded. No USD rate is published for this `
      + 'chain here, so this is not converted to dollars.'
    );
  }
  const depthReason = depthUnavailableText(binding.depthStatus);
  if (depthReason !== null) return depthReason;
  return 'Volume has not been observed for this token.';
}

/** Why a trade count is unavailable, or why the one shown is a lower bound. */
export function txnsQualifier(countsArePartial: boolean | undefined, known: boolean): string {
  if (!known) {
    return (
      'Trade count is unknown: this token was first observed part-way through '
      + 'its life, so the trades before that were never indexed. A zero would '
      + 'assert it never traded.'
    );
  }
  return countsArePartial === true
    ? 'At least this many — history before this token was first observed was never indexed, so the true count is higher.'
    : '';
}

/**
 * What an UNSCORED card's big dash says about itself.
 *
 * The dash itself is not in question — `0.0` is the worst possible reading and
 * would libel a token nobody scored, so an absent score has always rendered as
 * a mark rather than a number. What this decides is the sentence behind it.
 *
 * It used to be one hardcoded generic: *the score is computed from signals this
 * chain does not publish*. That was a guess about the cause, and by the time
 * chain-bound rows arrived it was the WRONG guess — `the ingestion service` computes
 * the same score Solana does, and REFUSES it in named cases: a market quoted
 * in a stock token (scoring its volume against a native formula would be wrong
 * by the whole exchange rate), a tape observed part-way through, a volume
 * window that was not fully seen. Each calls for a different response from the
 * reader, each is on the row, and collapsing them into "this chain does not
 * publish it" states something false about all three.
 *
 * The generic survives ONLY as the fallback for a row carrying no reason —
 * and it no longer blames the chain for it.
 */
export function scoreUnknownReason(reason: string | undefined): string {
  return (
    reason
    ?? 'This token is not scored. The score is computed from signals that are unavailable for it, so it is unknown rather than zero.'
  );
}

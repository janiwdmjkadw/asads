/**
 * What a discover card needs to know about the chain it came from.
 *
 * ONE optional field on `MockCoin` (`chainBinding`) rather than a dozen
 * EVM-shaped ones, so the Solana row shape is untouched: absent binding ==
 * Solana, which is exactly what every Solana producer already emits.
 *
 * WHY THIS EXISTS AT ALL. The card used to be able to assume four things that
 * are only true on Solana: that money is denominated in SOL and convertible to
 * USD, that a mint is a base58 string, that `/trade/<id>` is the destination,
 * and that a number on the wire is a number we measured. Every one of those is
 * false somewhere on the EVM surface, and the failure mode is silent — a
 * Robinhood-chain token quoted in NVDA renders its reserves as if they were
 * ETH and misprices by the whole NVDA/ETH rate. So the divergences travel WITH
 * the row instead of being re-derived (or assumed) at each render site.
 *
 * Everything here is display-ready text or a closed vocabulary. No money value
 * is a JS number: the wei/base-unit figures were narrowed by `lib/evm/money.ts`
 * (BigInt-only) before they got here.
 */

import type { EvmTradeBlockedReason } from '@/lib/evm/discoverAdapter';

/**
 * Can this token's depth be derived, and if not, why not?
 *
 * Mirrors an internal backend type, whose whole
 * point is that this is a THREE-way answer and not "are reserves present".
 * A brand-new four.meme curve token is perfectly quotable before its first
 * trade — the curve is the market and its state is on chain — while a
 * concentrated-liquidity pool's in-range depth is not the book at all.
 * Collapsing those to one "no reserves" state is how 4,840 Robinhood trades
 * shipped claiming to be tradeable with the depth withheld on every one.
 */
export type DepthStatus =
  | 'awaiting_first_observation'
  | 'measured'
  | 'not_derivable_concentrated'
  | 'venue_not_indexed'
  | 'four_meme_v1_unsupported'
  | 'four_meme_v1_buy_only'
  | 'awaiting_external_pool'
  | 'crowd_auction_active'
  | 'onchain_quoter';

/** Is a quote constructible from what we know? */
export function depthIsQuotable(status: DepthStatus): boolean {
  return status === 'awaiting_first_observation'
    || status === 'measured'
    || status === 'onchain_quoter';
}

/**
 * Why depth is unavailable, in the words a user reads. `null` exactly when
 * the depth is quotable.
 *
 * These are deliberately not one generic "unavailable": a user deciding
 * whether to wait or to leave needs to know whether we are early or blind.
 */
export function depthUnavailableText(status: DepthStatus): string | null {
  switch (status) {
    case 'awaiting_first_observation':
    case 'measured':
    case 'onchain_quoter':
      return null;
    case 'not_derivable_concentrated':
      return (
        'Depth is not derivable for this pool. Its liquidity is concentrated, ' +
        'so the in-range amount is not the whole book and any implied reserve ' +
        'figure could overstate real depth by an unbounded factor. Price and ' +
        'market cap are therefore unknown rather than estimated.'
      );
    case 'venue_not_indexed':
      return (
        'The venue that launched this token is not indexed here, so its market ' +
        'is unknown. We hold the token’s identity and none of its depth.'
      );
    case 'four_meme_v1_unsupported':
      return 'This legacy four.meme market has no verified execution route.';
    case 'four_meme_v1_buy_only':
      return 'This legacy four.meme market has only a verified buy route; sell depth is unavailable.';
    case 'awaiting_external_pool':
      return 'The launch completed, but its external pool has not been proven on chain yet.';
    case 'crowd_auction_active':
      return 'The Crowd auction is still active; its post-auction pool is not the market yet.';
    default:
      // A future wire vocabulary must degrade to "we cannot say", never to a
      // raw enum token rendered at a user.
      return 'Depth is unavailable for this token.';
  }
}

/**
 * What the money leg of this market is denominated in.
 *
 * Mirrors the backend source. `token` is the one that matters: 31% of
 * live Pons v2 launches are quoted in Robinhood STOCK tokens (NVDA, SPY), not
 * in the chain's native asset, and a figure named "native" is only truthfully
 * named when `isNative` is true.
 */
export interface QuoteDenomination {
  /** Closed wire vocabulary. */
  readonly kind: 'native' | 'wrapped_native' | 'token' | 'unknown';
  /**
   * TRUE only when amounts really are wei of the chain's own asset. Absence of
   * evidence is not evidence of ETH, so an unknown quote asset is `false`.
   */
  readonly isNative: boolean;
  /** The quote token's contract address, when it has one. */
  readonly address: string | null;
  /** Measured quote-leg scale, or null. A token quote never inherits the
   * chain's native 18-decimal scale. */
  readonly decimals?: number | null;
  /**
   * Ticker to render beside an amount — `BNB`, `ETH`, or the quote token's
   * own symbol. `null` when we do not know what the numbers are denominated
   * in, which is the case that must never silently render as the native unit.
   */
  readonly unitSymbol: string | null;
}

/** The unit label for an amount, or the explicit unknown. */
export function quoteUnitLabel(quote: QuoteDenomination): string | null {
  return quote.unitSymbol;
}

/**
 * Disclosure for a market that is NOT quoted in the chain's native asset.
 * `null` when it is native (nothing to disclose).
 *
 * Rendered, not just logged: the brief's rule is that the price basis must be
 * disclosed and never silently assumed to be ETH.
 */
export function quoteBasisDisclosure(quote: QuoteDenomination): string | null {
  switch (quote.kind) {
    case 'native':
    case 'wrapped_native':
      return null;
    case 'token':
      return (
        `Priced in ${quote.unitSymbol ?? 'another token'}, not in the chain’s ` +
        'native asset. Figures on this row are denominated in that asset and are ' +
        'not comparable to native-quoted tokens without its rate.'
      );
    case 'unknown':
      return (
        'The asset this market is priced in is unknown, so the figures below ' +
        'cannot be read as native amounts.'
      );
    default:
      return null;
  }
}

/**
 * Chain-specific facts that ride along with a discover row.
 *
 * Absent on every Solana row. Present on every non-Solana row, including the
 * fields whose absence is itself the information.
 */
export interface ChainBinding {
  /** Storage tag: `bsc`, `robinhood_chain`, `base`, `ethereum`. */
  readonly chain: string;
  /** The token's contract address, lowercase hex. */
  readonly address: string;
  /**
   * Destination for this row. Explicit because `hrefForToken` builds the
   * single-segment Solana shape and an EVM token needs `/trade/<slug>/<addr>`
   * — a bare address is not routable, the same address exists on four chains.
   */
  readonly href: string;
  /** The chain's own asset ticker (`BNB`, `ETH`). */
  readonly nativeSymbol: string;
  readonly depthStatus: DepthStatus;
  readonly quote: QuoteDenomination;
  /** Exact ingestion execution discriminator. Never inferred from fee/tick. */
  readonly marketVenue: string | null;
  /**
   * Provenance of the reserve/price figures, fit to render. `null` when no
   * reserves were served — which is when there is nothing to qualify.
   */
  readonly reserveBasisText: string | null;
  /**
   * TRUE while token-denominated figures are scaled by an ASSUMED decimals
   * exponent rather than a measured one. Carried so the render can say so:
   * a figure off by a power of ten with nothing on screen admitting it could
   * be is the same class of claim as a structural zero.
   */
  readonly tokenDecimalsAssumed: boolean;
  /** The decimals actually used to scale token figures. */
  readonly tokenDecimals: number;
  /**
   * Lifecycle stage, as the chain's launchpad defines it. Solana's equivalent
   * is `graduated` plus bonding progress; the EVM lifecycle has four states
   * and the middle two are not expressible as a percentage.
   */
  readonly stage: 'new' | 'ripening' | 'migrating' | 'graduated';
  readonly buyable: boolean;
  readonly sellable: boolean;
  /** Why trading is unavailable right now, or `null`. */
  readonly tradeBlockedReason: ChainTradeBlockedReason | null;
  readonly buyBlockedReason: ChainTradeBlockedReason | null;
  readonly sellBlockedReason: ChainTradeBlockedReason | null;
}

/** Producer reasons plus conservative client-only fallbacks for old frames. */
export type ChainTradeBlockedReason =
  | EvmTradeBlockedReason
  | 'depth_unknown'
  | 'capability_unknown';

/** Is this row a non-Solana row? */
export function isChainBound(binding: ChainBinding | undefined): binding is ChainBinding {
  return binding !== undefined;
}

/**
 * Human copy for a blocked trade control.
 *
 * A dead button with no explanation reads as breakage, and each of these is a
 * genuinely different situation for the user: wait a moment, wait for tooling,
 * or leave.
 */
export function tradeBlockedText(reason: ChainTradeBlockedReason): string {
  switch (reason) {
    case 'migrating':
      return 'Liquidity is migrating to the AMM. Both sides are paused until the pool is live.';
    case 'quote_unknown':
      return 'Trading is unavailable because this market quote asset has not been identified, so an order cannot be sized safely.';
    case 'quote_not_native':
      return 'Trading is unavailable because this market is quoted in another token, while execution currently supports native-asset markets only.';
    case 'four_meme_v1_unsupported':
      return 'Trading is unavailable because this is legacy four.meme V1 launch history, which the execution engine does not support.';
    case 'four_meme_x_mode_unsupported':
      return 'Trading is unavailable because this four.meme launch uses X Mode, which the execution engine does not support.';
    case 'four_meme_tax_token_unsupported':
      return 'Trading is unavailable because this token applies transfer taxes, so the execution engine cannot guarantee the requested amount.';
    case 'four_meme_v1_sell_unsupported':
      return 'Selling is unavailable because this legacy four.meme V1 market has no verified sell route. Buying remains available.';
    case 'pons_v2_execution_unsupported':
      return 'Trading is unavailable because this Pons V2 launch has no supported execution route.';
    case 'depth_unknown':
    case 'depth_not_derivable_concentrated':
      return 'Trading is unavailable because this pool’s depth cannot be derived, so no honest quote can be built.';
    case 'venue_not_indexed':
      return 'Trading is unavailable because this token’s venue is not indexed here.';
    case 'pools_trade_awaiting_pool':
      return 'Trading is unavailable because this pools.trade launch has not yet proved its external pool on chain.';
    case 'pools_trade_crowd_auction_active':
      return 'Trading is unavailable while the pools.trade Crowd auction is active; the post-auction pool is not the market yet.';
    case 'pools_trade_crowd_migration_failed':
      return 'Trading is unavailable because this pools.trade Crowd launch failed to migrate after its funds and reserved tokens were recovered. There is no executable post-auction pool.';
    case 'portal_execution_unsupported':
    case 'flap_capability_unproven':
      return 'Trading is unavailable because this Flap launch has not proved an exact executable capability.';
    case 'flap_robinhood_v4_unsupported':
      return 'Trading is unavailable because this Robinhood Chain Flap launch uses the unsupported Uniswap V4 migration route.';
    case 'flap_curve_route_unsupported':
      return 'Trading is unavailable because this Flap curve route is not supported by the execution engine.';
    case 'flap_lifecycle_unsupported':
      return 'Trading is unavailable because this Flap lifecycle state has no verified execution route.';
    case 'flap_graduation_proof_missing':
      return 'Trading is unavailable because this Flap launch is missing the on-chain proof for its graduated market.';
    case 'flap_graduation_proof_invalid':
      return 'Trading is unavailable because this Flap launch’s graduated-market proof is invalid.';
    case 'flap_graduated_route_unsupported':
      return 'Trading is unavailable because this Flap graduated market uses an unsupported execution route.';
    case 'capability_unknown':
      return 'Trading is unavailable because the market reported an execution capability this client does not recognize.';
    default:
      return 'Trading is unavailable.';
  }
}

/** Compact visible label; the full actionable explanation remains in `tradeBlockedText`. */
export function tradeBlockedLabel(reason: ChainTradeBlockedReason): string {
  switch (reason) {
    case 'migrating':
      return 'MIGRATING';
    case 'four_meme_v1_unsupported':
      return 'LEGACY V1';
    case 'four_meme_v1_sell_unsupported':
      return 'NO SELL';
    case 'pons_v2_execution_unsupported':
      return 'PONS V2 UNSUPPORTED';
    case 'pools_trade_awaiting_pool':
      return 'AWAITING POOL';
    case 'pools_trade_crowd_auction_active':
      return 'AUCTION ACTIVE';
    case 'pools_trade_crowd_migration_failed':
      return 'MIGRATION FAILED';
    case 'flap_robinhood_v4_unsupported':
      return 'V4 UNSUPPORTED';
    case 'flap_graduation_proof_missing':
      return 'NO PROOF';
    case 'flap_graduation_proof_invalid':
      return 'INVALID PROOF';
    case 'portal_execution_unsupported':
    case 'flap_capability_unproven':
    case 'flap_curve_route_unsupported':
    case 'flap_lifecycle_unsupported':
    case 'flap_graduated_route_unsupported':
    case 'four_meme_x_mode_unsupported':
    case 'four_meme_tax_token_unsupported':
    case 'capability_unknown':
      return 'UNSUPPORTED';
    case 'venue_not_indexed':
      return 'NO VENUE';
    case 'quote_unknown':
    case 'quote_not_native':
    case 'depth_not_derivable_concentrated':
    case 'depth_unknown':
    default:
      return 'NO QUOTE';
  }
}

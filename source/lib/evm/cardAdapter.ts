/**
 * EVM lane card -> the shared discover row (`MockCoin`).
 *
 * THIS IS THE FILE THAT ENDS THE SECOND CARD. The terminal used to carry two
 * hand-maintained card components — `CoinCard` for Solana and `EvmCoinCard`
 * for everything else — and the reason given was sound at the time: the
 * Solana card required `imageUrl`, `marketCap`, `txns`, `score` and `volume`,
 * so feeding it an EVM token meant passing zeros, and "$0 market cap" reads as
 * *this token is dead*, not as *unknown*. That was a refusal to lie, and it
 * was right.
 *
 * The fix is on the DATA side, not the component side. `MockCoin` now makes
 * those five fields optional and the card renders each absence as a deliberate
 * unknown that says why. So this adapter's whole job is to be honest about
 * which fields it can fill, and to leave the rest genuinely absent — never
 * zero, never an empty string, never a fabricated dollar figure.
 *
 * RULES ENFORCED HERE
 * - **Absent is never zero.** Every optional wire field maps to `undefined`,
 *   so no downstream `??` can substitute a measured-looking value.
 * - **No money value passes through a JS number.** Every figure arrives as a
 *   decimal string and is narrowed by `./money.ts` (BigInt-only) — wei and
 *   18-decimal base units both exceed 2^53 routinely.
 * - **No USD figure is invented, and no measured figure is hidden.**
 *   `marketCap` and `volume` are the card's USD slots. They carry the wire's
 *   OWN dollar figures when a rate was published and stay absent when it was
 *   not — never a conversion computed here. The inverse trap is just as real:
 *   when the dollar figure is absent the NATIVE one still travels
 *   (`volumeNativeText`, `marketCapNativeText`) with its unit label, because
 *   rendering `unknown` over a measurement we are holding is its own false
 *   claim. A dollar number nobody computed is worse than no dollar number;
 *   `unknown` where we know the answer is worse than saying it in BNB.
 * - **A partial count is a lower bound, and says so.** `countsArePartial`
 *   drives the card's "≥" qualifier.
 */

import type { MockCoin } from '@/components/discover/mockCoins';
import type { ChainBinding } from '@/components/discover/chainBinding';
import { depthIsQuotable } from '@/components/discover/chainBinding';
import { nativeSymbolForChain, resolvePriceDisplay } from './discoverAdapter';
import type { EvmLaneCard } from './laneState';
import { EVM_TOKEN_DECIMALS, formatAge, formatPrice } from './money';

/**
 * Why trading is unavailable for this row, in the ChainBinding vocabulary.
 *
 * Ordered by what the user can do about it. `migrating` resolves on its own in
 * seconds-to-minutes (four.meme's keeper-async gap) and is worth waiting out;
 * the depth reasons do not resolve by waiting, and telling someone "migrating"
 * when the truth is "we cannot read this pool" sends them to wait forever.
 */
export function evmTradeBlockedReason(card: EvmLaneCard): ChainBinding['tradeBlockedReason'] {
  if (card.tradeBlockedReason !== null) return card.tradeBlockedReason;
  if (card.depthStatus === 'venue_not_indexed') return 'venue_not_indexed';
  if (card.depthStatus === 'not_derivable_concentrated') return 'depth_unknown';
  /* `tradeable` is the fold's own composite (lifecycle allows it AND depth is
     knowable). If it says no and nothing above explained why, the honest
     generic is that we cannot build a quote — not silence, and not an
     enabled button. */
  if (!card.tradeable) return 'depth_unknown';
  return null;
}

function evmSideBlockedReason(
  card: EvmLaneCard,
  side: 'buy' | 'sell',
): ChainBinding['buyBlockedReason'] {
  const tradeable = side === 'buy' ? card.buyable : card.sellable;
  const reason = side === 'buy' ? card.buyBlockedReason : card.sellBlockedReason;
  if (reason !== null && reason !== undefined) return reason;
  if (tradeable ?? card.tradeable) return null;
  return evmTradeBlockedReason(card) ?? 'capability_unknown';
}

/**
 * The chain provenance that rides with the row.
 *
 * Exported separately from `toDiscoverRow` because the trade page needs the
 * same disclosures (price basis, depth status, decimals assumption) and two
 * derivations of one truth is the drift this whole change exists to stop.
 */
export function toChainBinding(card: EvmLaneCard): ChainBinding {
  return {
    chain: card.chain,
    address: card.address,
    href: card.href,
    nativeSymbol: nativeSymbolForChain(card.chain),
    depthStatus: card.depthStatus,
    quote: card.quote,
    marketVenue: card.marketVenue ?? null,
    reserveBasisText: card.reserveBasisText,
    /* NO LONGER HARDCODED TRUE. The row carries whichever scale it was
       actually rendered at, and says whether that scale was measured. The
       enrichment call site has landed, so `decimals` now arrives for any token
       whose scale the identity resolver could read — and this being a fact
       ABOUT THE ROW rather than a constant is what lets the disclosure
       disappear for that card alone while staying up for its neighbours that
       still lack one. A blanket `true` could not express that, and a blanket
       `false` would have been the lie. */
    /* `!== false`, not a bare read: a row from a producer that has not been
       taught this field yet must default to ASSUMED. Defaulting to "measured"
       would silently drop the disclosure from every such row, which is the one
       direction that cannot be recovered from by looking at the screen. */
    tokenDecimalsAssumed: card.tokenDecimalsAssumed !== false,
    tokenDecimals:
      typeof card.tokenDecimals === 'number' && Number.isInteger(card.tokenDecimals)
        ? card.tokenDecimals
        : EVM_TOKEN_DECIMALS,
    stage: card.stage,
    buyable: card.buyable ?? card.tradeable,
    sellable: card.sellable ?? card.tradeable,
    tradeBlockedReason: evmTradeBlockedReason(card),
    buyBlockedReason: evmSideBlockedReason(card, 'buy'),
    sellBlockedReason: evmSideBlockedReason(card, 'sell'),
  };
}

/**
 * Adapt one EVM lane card into the shared discover row.
 *
 * `nowMs` is passed in (not read from `Date.now()`) so a whole lane renders
 * its ages against ONE clock — otherwise cards a few milliseconds apart
 * disagree about "now" and the column jitters.
 */
export function toDiscoverRow(card: EvmLaneCard, nowMs: number): MockCoin {
  const binding = toChainBinding(card);

  /* The last TRADE price when we watched one land, otherwise the wire's own
     derived price, otherwise the curve's implied price — resolved by the ONE
     shared chain, which the trade page now calls too. All three are exact
     BigInt ratios; none is ever fabricated, and each is `null` when its inputs
     are absent rather than 0. See `resolvePriceDisplay` for the ordering and
     for why the two surfaces must not each spell it out. */
  /* THE LIVE LEG IS GATED HERE and not upstream, because this is the only
     place it is computed. `toCardView` gates `wirePriceText` and
     `curvePriceText` on the quote actually being native, but the live price is
     built from a trade THIS module watched land (`lastPriceNum`/`lastPriceDen`
     are a fill's `cost`/`amount`), so the gate does not reach it. Leaving it
     ungated would have defeated the other two entirely: `resolvePriceDisplay`
     prefers the live leg, and a stock-quoted token with any recent trade — the
     common case, since a traded token is what lands in a lane — would have
     kept showing a price scaled by an assumed 18-decimal quote while its
     card's other two price sources were correctly withheld. */
  const { text: priceText, sourceText: priceSourceText } = resolvePriceDisplay({
    livePriceText: binding.quote.isNative
      ? formatPrice(card.lastPriceNum, card.lastPriceDen, 6, binding.tokenDecimals)
      : null,
    wirePriceText: card.wirePriceText,
    curvePriceText: card.curvePriceText,
    priceBasisText: card.priceBasisText,
    reserveBasisText: card.reserveBasisText,
  });

  /* A price we cannot justify must not be shown at all. Depth that is not
     derivable means any implied price could be wrong by an unbounded factor
     (concentrated liquidity), and an unindexed venue means we hold identity
     and no market. Both must read as unknown, not as a number. */
  const priceIsShowable = depthIsQuotable(card.depthStatus);

  const age = formatAge(card.firstSeenAtMs, nowMs);

  return {
    /* CHAIN-QUALIFIED. The same address exists on four EVM chains, so a bare
       address as a React key or a store key merges two different tokens into
       one row. */
    id: card.id,
    creator: card.creator,
    ticker: card.ticker,
    name: card.name,
    /* No social handle is served for EVM tokens. The card omits the handle row
       entirely unless it starts with '@' (a REAL account), so an empty string
       collapses the row rather than rendering a fake one. */
    handle: '',
    /* THE RESOLVED IMAGE when the wire carries one, absent when it does not —
       and absent means `useResolvedTokenImage` paints the synthetic
       placeholder, a mark that is visibly not artwork and can never be a
       mis-attributed logo. Never an empty string: `''` is a URL the <img>
       would try to load, which is a broken-image icon rather than a
       placeholder. `null` → `undefined` for the same reason. */
    imageUrl: card.imageUrl ?? undefined,
    platforms: [],

    ageLabel: age ?? '—',
    /* `ageMs` feeds the discover FILTERS, which compare numbers. Absent when
       unobserved: a filter must not match "0ms old" on a token whose age we
       never saw. */
    ageMs: card.firstSeenAtMs === null ? undefined : Math.max(0, nowMs - card.firstSeenAtMs),
    createdAtMs: card.firstSeenAtMs,

    points: 0,
    views: '',
    followers: '',

    /* THE USD SLOTS. Filled from the wire's OWN dollar figures — atto-USD
       integers (micro where atto is absent) computed upstream against a Pyth
       BNB/ETH snapshot — and left genuinely absent when the wire served none.
       What is NOT here, and must never be, is a conversion: there is no
       `nativeAmount * someRate` anywhere in this adapter, because the missing
       rate is exactly what `usdUnavailableText` reports. A stock-quoted Pons
       token reports `quote_not_native` and stays absent even when the oracle
       IS fresh — its money leg is NVDA, not ETH. */
    marketCap: card.marketCapUsdText ?? undefined,
    volume: card.volumeUsdText ?? undefined,

    /* THE NUMERIC TWINS — for the discover FILTERS, which compare numbers and
       cannot read `4.8K`. Same wire integers, same atto-then-micro precedence
       as the two texts above (`marketCapUsdValue` / `volumeUsdValue` are
       derived beside them in `toCardView`), so a row can never filter as one
       figure and render as another.

       WHY THIS IS NOT THE FABRICATION THIS FILE EXISTS TO PREVENT: there is
       still no conversion here. A figure the wire did not serve stays
       `undefined` — never `0` — so `passesRange` sees an UNKNOWN metric and
       applies its documented rule (an active bound excludes what it cannot
       prove), rather than seeing a token measured at nothing. The stock-quoted
       Pons markets are the case that makes the difference visible: they report
       `quote_not_native`, carry no USD at all, and must be absent from a
       market-cap filter rather than pinned at its floor.

       `volumeUsd` and not `volume24hUsd`: the PRODUCER is authoritative about
       which window it measured, and it measured five minutes.
       the backend source derives `volumeUsdAtto` /
       `volumeUsdMicro` from `state.volume_native_5m(view.as_of_unix_sec)` —
       the column Solana fills from `vol5m` — and omits both keys when that
       window was not observed. Nothing on this wire measures a day.

       So the 24h slot stays ABSENT rather than carrying this figure. Occupying
       it is a 24h claim nothing here made, and it is the slot the row filter
       PREFERS (`discoverFilters.metricValue`: `volume24hUsd ?? volumeUsd`), so
       an EVM row would answer a volume bound as though five minutes were a
       day while a Solana row beside it answered with a genuine 24h figure.
       The 5m slot is that filter's own documented fallback, so the bound still
       has a number to compare — one whose window the row states correctly. */
    marketCapUsd: card.marketCapUsdValue ?? undefined,
    volumeUsd: card.volumeUsdValue ?? undefined,
    volume24hUsd: undefined,

    /* WHAT WE DO HAVE: the native figures, and the unit they are in.

       `marketCapNativeText` was parsed by `toCardView` and then dropped here,
       so a card whose USD oracle was stale rendered `unknown` for its market
       cap while holding a perfectly good BNB one. Volume never had that bug —
       it has always carried its native fallback — and the asymmetry was the
       whole defect. Both are `?? undefined` so an absent figure stays absent
       rather than becoming a rendered `null`. */
    volumeNativeText: card.volumeNativeText,
    marketCapNativeText: card.marketCapNativeText ?? undefined,
    nativeUnitSymbol: binding.quote.unitSymbol,
    /* The basis for whatever dollar figures the two slots above carry. Absent
       when the wire served no rate — which is exactly when both USD slots are
       absent too, so there is nothing to qualify. */
    usdBasisText: card.nativeUsdBasisText ?? undefined,
    priceText: priceIsShowable ? priceText : null,
    priceSourceText: priceIsShowable ? priceSourceText : null,

    /* Counts are OMITTED by the wire when history is partial, and that
       omission is the information — a `0` would assert "never traded". */
    txns: card.tradeCount ?? undefined,
    buyTxns: card.buyCount,
    sellTxns: card.sellCount,
    countsArePartial: !card.historyComplete,
    /* Holder count is served by the trade-page read, not the discover lane.
       Absent here rather than derived from txns: the Solana card estimates
       holders as `txns / 40`, which is a pump.fun-shaped guess with no
       meaning on a four.meme curve. */
    holderCount: undefined,

    /* THE SCORE. This slot used to be hard-`undefined` under the note "the
       score is a composite of Solana-only signals" — which stopped being true
       when `the ingestion service` grew an internal routine, Solana's arithmetic
       term for term, computed ONCE on the producer. The figure has been on the
       wire and thrown away here since.

       `?? undefined` and not `?? 0`: the original judgement survives intact.
       `0` is the worst possible reading and `null` means unscored, and the two
       look identical on screen while meaning opposite things. What is new is
       that an unscored row no longer has to be silent about it — see
       `scoreUnavailableReason` below. */
    score: card.score ?? undefined,
    /* WHY it is unscored, so the dash is a refusal a user can read rather than
       a blank. The producer NEVER omits both: a card either carries a score or
       carries a reason it has none (the backend source), which is
       what makes rendering the refusal safe to rely on. */
    scoreUnavailableReason: card.scoreUnavailableText ?? undefined,

    /* THE SECURITY ROW — dev / sniper / bundler share of supply.
       `EvmCardView` already refused to invent these; the mapping was simply
       never written, so a measured share was parsed and dropped one step short
       of the card.

       `?? undefined` is load-bearing on exactly this row. An omitted share
       means the classification never ran, and a `0%` dev share is a positive
       claim that the creator holds nothing — a fabricated all-clear on a
       security field. The producer omits the keys for precisely that reason;
       substituting a zero here would undo it at the last hop.

       `insiderHoldingsPct` stays absent: the EVM signal fold publishes no
       insider class, and deriving one from the three that exist would be a
       measurement nobody made. */
    devHoldingsPct: card.devHoldingsPct ?? undefined,
    sniperHoldingsPct: card.sniperHoldingsPct ?? undefined,
    bundlerHoldingsPct: card.bundlerHoldingsPct ?? undefined,
    holdingsUnavailableReason: card.holdingsUnavailableText ?? undefined,
    holdingsQualifier: card.holdingsQualifierText ?? undefined,

    /* THE CROWN BADGE'S NUMBERS, carried BY THE ROW. Solana resolves its tally
       from a query against the Solana creator endpoint; that endpoint knows
       nothing about a `0x` address, so an EVM row routed through it spends a
       request to learn nothing and then renders the nothing. The fold already
       counted this creator's launches and migrations and ships them on the
       card — never as a fabricated `{0, 0}`, which is the shape that once read
       a serial rugger as a first-time dev. */
    creatorStats: card.creatorStats ?? undefined,

    graduated: card.stage === 'graduated',
    /* THE GRADUATION STAMP. Feeds the Graduated lane's ordering, which until
       the wire carried this could only rank by how recently a token TRADED.
       `?? undefined` — a token hydrated already-graduated witnessed no
       graduation and has no stamp, and 0 would date it to 1970. */
    graduatedAtMs: card.graduatedAtMs ?? undefined,
    lastTradeAtMs: card.lastTradeAtMs,

    /* Bonding progress is a pump.fun percentage against a fixed SOL target.
       four.meme's curve has different economics and the wire publishes no
       comparable percentage, so the graduation ring renders its faint track
       only — an invented percentage would be a confident progress claim. */
    bondingProgressPct: undefined,
    bondingProgressBucket: undefined,

    chainBinding: binding,
    ...(card.launchpad === null || card.launchVariant === null
      ? {}
      : {
          evmLaunchpad: card.launchpad,
          evmLaunchVariant: card.launchVariant,
          evmLaunchProfile: card.launchProfile,
        }),
  };
}

/** Adapt a whole lane against one shared clock. */
export function toDiscoverRows(cards: readonly EvmLaneCard[], nowMs: number): MockCoin[] {
  return cards.map((card) => toDiscoverRow(card, nowMs));
}

/** Native symbol for a chain, re-exported so callers need one import. */
export { nativeSymbolForChain };

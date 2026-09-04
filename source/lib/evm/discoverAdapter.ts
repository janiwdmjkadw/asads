/**
 * EVM discover-card adapter (guide WP-313, terminal side).
 *
 * Maps an `the ingestion service` discover card onto a normalized view shape.
 *
 * IT NOW FEEDS THE SHARED `CoinCard`, via `lib/evm/cardAdapter.ts`. The
 * previous version of this comment explained why it could not: that component
 * required `imageUrl`, `marketCap`, `txns`, `score` and `volume`, so the only
 * way through was zeros, and "$0 market cap" reads as *this token is dead*
 * rather than *unknown*. The objection was correct and it has been answered on
 * the DATA side — those fields are optional now and each absence renders as a
 * deliberate unknown that states its reason. There is exactly one card
 * component again; see `cardAdapter.ts` for what this row can and cannot fill.
 *
 * Invariants:
 * - **Absent is not zero.** The wire OMITS counts for a token with partial
 *   history (`historyComplete: false`). This adapter must carry that through
 *   as `null`, never `0` — the card renders `null` as "—" and `0` as a real
 *   measured zero, which is a different and false claim (plan §6.4).
 * - **Money stays a string until it is displayed.** Wire values are `u128`
 *   wei decimal strings; `Number()` on one silently loses precision above
 *   2^53. Only the display formatter narrows, and only after dividing by the
 *   chain's decimals.
 * - **The card id carries the chain.** `bsc:0x…`, not `0x…`. The same address
 *   exists on four EVM chains, so a bare address as a React key or a store
 *   key collides across chains — the §4.5 collision arriving in the client.
 */

import type { DepthStatus, QuoteDenomination } from '@/components/discover/chainBinding';
import { nativeSymbolForChain, tradePageHref } from './chains';
import {
  EVM_NATIVE_DECIMALS,
  EVM_TOKEN_DECIMALS,
  USD_ATTO_DECIMALS,
  USD_MICRO_DECIMALS,
  formatAttoUsdCompact,
  formatAttoUsdPrice,
  formatMicroUsdCompact,
  formatNanoUsdRate,
  formatNative,
  formatQuotePrice,
  formatQuoteReservePrice,
  formatTokenCompact,
  formatUnits,
  usdScaledToNumber,
} from './money';
import {
  isCanonicalUnsigned,
  readBoundedSigned,
  readBoundedUnsigned,
  readEvmWireVersion,
  readWideUnsigned,
  type EvmWireVersion,
} from './wireInteger';

/** Closed producer vocabulary for why a card is not executable. */
export type EvmTradeBlockedReason =
  | 'migrating'
  | 'quote_unknown'
  | 'quote_not_native'
  | 'four_meme_v1_unsupported'
  | 'four_meme_x_mode_unsupported'
  | 'four_meme_tax_token_unsupported'
  | 'depth_not_derivable_concentrated'
  | 'venue_not_indexed'
  | 'four_meme_v1_sell_unsupported'
  | 'pons_v2_execution_unsupported'
  | 'pools_trade_awaiting_pool'
  | 'pools_trade_crowd_auction_active'
  | 'pools_trade_crowd_migration_failed'
  | 'portal_execution_unsupported'
  | 'flap_capability_unproven'
  | 'flap_robinhood_v4_unsupported'
  | 'flap_curve_route_unsupported'
  | 'flap_lifecycle_unsupported'
  | 'flap_graduation_proof_missing'
  | 'flap_graduation_proof_invalid'
  | 'flap_graduated_route_unsupported';

const EVM_TRADE_BLOCKED_REASONS = new Set<EvmTradeBlockedReason>([
  'migrating',
  'quote_unknown',
  'quote_not_native',
  'four_meme_v1_unsupported',
  'four_meme_x_mode_unsupported',
  'four_meme_tax_token_unsupported',
  'depth_not_derivable_concentrated',
  'venue_not_indexed',
  'four_meme_v1_sell_unsupported',
  'pons_v2_execution_unsupported',
  'pools_trade_awaiting_pool',
  'pools_trade_crowd_auction_active',
  'pools_trade_crowd_migration_failed',
  'portal_execution_unsupported',
  'flap_capability_unproven',
  'flap_robinhood_v4_unsupported',
  'flap_curve_route_unsupported',
  'flap_lifecycle_unsupported',
  'flap_graduation_proof_missing',
  'flap_graduation_proof_invalid',
  'flap_graduated_route_unsupported',
]);

export type EvmMarketVenue =
  | 'flap_portal'
  | 'open_four_v12'
  | 'pancake_v2'
  | 'pancake_v3'
  | 'pancake_infinity_cl'
  | 'uniswap_v2'
  | 'uniswap_v3'
  | 'flap_uniswap_v4'
  | 'pools_trade_tick25'
  | 'pools_trade_tick60'
  | 'pools_trade_crowd_tick50';

/** Lifecycle-stable launch origin. Distinct from the executable market venue. */
export type EvmLaunchpad = 'four_meme' | 'flap' | 'pons' | 'pools_trade';

/** Lifecycle-stable launch generation. Never inferred from the current AMM. */
export type EvmLaunchVariant =
  | 'v1'
  | 'tm2'
  | 'open_four_v12'
  | 'portal'
  | 'v2'
  | 'instant_tick25'
  | 'instant_tick60'
  | 'crowd_tick50';

export interface EvmLaunchQuotePosture {
  readonly kind: 'native' | 'wrapped_native' | 'erc20';
  readonly address?: string;
  readonly decimals?: number;
  readonly symbol?: string;
}

/** Strictly validated launch-time descriptor; optional only for legacy rows. */
export interface EvmLaunchProfile {
  readonly generation: EvmLaunchVariant;
  readonly mode?: string;
  readonly quotePosture: EvmLaunchQuotePosture;
  readonly tokenVersion?: number;
  readonly migratorType?: number;
  readonly taxMode?: 'none' | 'symmetric' | 'asymmetric';
  readonly buyTaxBps?: number;
  readonly sellTaxBps?: number;
  readonly creatorType?: number;
  readonly feePlanEnabled?: boolean;
  readonly feeSetting?: string;
  readonly extraFee?: string;
  readonly maxRaising?: string;
  readonly presetId?: string;
  readonly flags?: string;
  readonly phase?: 'created' | 'curve' | 'migrate_pending' | 'migrated' | 'terminal' | 'sold_out';
  readonly tickSpacing?: 25 | 50 | 60;
}

const EVM_LAUNCHPADS = new Set<EvmLaunchpad>([
  'four_meme',
  'flap',
  'pons',
  'pools_trade',
]);

const EVM_LAUNCH_VARIANTS = new Set<EvmLaunchVariant>([
  'v1',
  'tm2',
  'open_four_v12',
  'portal',
  'v2',
  'instant_tick25',
  'instant_tick60',
  'crowd_tick50',
]);

const EVM_MARKET_VENUES = new Set<EvmMarketVenue>([
  'flap_portal',
  'open_four_v12',
  'pancake_v2',
  'pancake_v3',
  'pancake_infinity_cl',
  'uniswap_v2',
  'uniswap_v3',
  'flap_uniswap_v4',
  'pools_trade_tick25',
  'pools_trade_tick60',
  'pools_trade_crowd_tick50',
]);

export function isEvmTradeBlockedReason(value: unknown): value is EvmTradeBlockedReason {
  return typeof value === 'string' && EVM_TRADE_BLOCKED_REASONS.has(value as EvmTradeBlockedReason);
}

/** Required nullable producer field. Unknown or absent capability fails decoding closed. */
export function isEvmTradeBlockedReasonWire(
  value: unknown,
): value is EvmTradeBlockedReason | null {
  return value === null || isEvmTradeBlockedReason(value);
}

/** The wire shape the backend source emits. */
export interface EvmDiscoverCard {
  v: string;
  chain: string;
  address: string;
  stage: 'new' | 'ripening' | 'migrating' | 'graduated';
  tradeable: boolean;
  /** Required on V2; optional only while decoding legacy V1 frames. */
  buyable?: boolean;
  /** Required on V2; optional only while decoding legacy V1 frames. */
  sellable?: boolean;
  /** Required on the live wire; optional here only for old-frame tolerance. */
  tradeBlockedReason?: EvmTradeBlockedReason | null;
  /** Required on V2; optional only while decoding legacy V1 frames. */
  buyBlockedReason?: EvmTradeBlockedReason | null;
  /** Required on V2; optional only while decoding legacy V1 frames. */
  sellBlockedReason?: EvmTradeBlockedReason | null;
  name?: string;
  symbol?: string;
  creator?: string;
  /**
   * Absent until a trade has proved the curve, and absent again once the
   * token graduates. NOT optional-for-convenience: a `"0"` here would read as
   * an empty pool, so the wire omits what it has not measured.
   */
  reserveNative?: string;
  reserveToken?: string;
  /**
   * WHAT THE RESERVE NUMBERS ACTUALLY ARE. Emitted by
   * the backend source, and dropped on the floor by the
   * terminal until now — so a launchpad curve, a real constant-product AMM
   * pair and a derived figure all rendered under one identical "Reserve"
   * label, which are three different claims about how tradeable a number is.
   *
   * Present exactly when the reserves are (same `if let Some` guard), so it
   * can distinguish curve from AMM but CANNOT flag a withheld concentrated
   * pool — that case has no reserves at all and therefore no basis either.
   * `concentrated_virtual` is consequently unreachable on today's wire and is
   * carried here only so it does not become an unhandled string the day the
   * fold starts publishing it.
   */
  reserveBasis?:
    | 'curve'
    | 'amm_pair'
    | 'pancake_v2'
    | 'pancake_v3'
    | 'uniswap_v2'
    | 'uniswap_v3'
    | 'uniswap_v4'
    | 'pancake_infinity_cl'
    | 'flap_curve'
    | 'concentrated_virtual';
  /** Exact ingestion execution discriminator; never reconstructed from pool parameters. */
  marketVenue?: EvmMarketVenue;
  /** Explicit launch origin; optional only while older wire versions omit it. */
  launchpad?: EvmLaunchpad;
  /** Closed generation paired with `launchpad`; both are present or absent. */
  launchVariant?: EvmLaunchVariant;
  /** Exact launch-time facts; absent only when legacy durable facts are incomplete. */
  launchProfile?: EvmLaunchProfile;
  /** Exact graduated market provenance. All-or-nothing by venue. */
  poolAddress?: string;
  poolFactory?: string;
  poolId?: string;
  poolManager?: string;
  poolVault?: string;
  poolCurrency0?: string;
  poolCurrency1?: string;
  poolHooks?: string;
  poolFeeTier?: number;
  poolTickSpacing?: number;
  launchFactory?: string;
  launchEntry?: string;
  launchMode?: 'instant' | 'crowd';
  /**
   * **THE PRICE, on a `curve` basis** — four.meme's own marginal price word,
   * quote wei per token BASE UNIT, scaled by `10^18`
   * (the backend source).
   *
   * The wire has published this since the pricing rework and the terminal read
   * `reserveNative / reserveToken` instead, which on this basis is cumulative
   * funds over remaining offers — a ratio measured ~480x low against this word
   * on the same live BSC event. Decimal STRING; ABSENT until a curve trade has
   * been folded, and absent is not a price.
   */
  curvePriceWord?: string;
  /**
   * Whether depth is KNOWN, UNMEASURED-BUT-KNOWABLE, or UNKNOWABLE.
   * the backend source has emitted this since the depth rework
   * and the terminal dropped it on the floor, which meant a Robinhood
   * concentrated pool — whose in-range liquidity is NOT the book — was
   * indistinguishable from a four.meme curve that simply has not traded yet.
   * Those are opposite situations: one will never be quotable here, the other
   * is quotable right now.
   *
   * Optional only for wire-version tolerance; the live wire always sends it.
   */
  depthStatus?: DepthStatus;
  /**
   * WHAT the money leg is denominated in. Absent while unknown, and
   * `quoteIsNative` is then false — absence of evidence is not evidence of
   * ETH. 31% of live Pons v2 launches are quoted in Robinhood STOCK tokens
   * (NVDA, SPY); reading their figures as native misprices by the whole
   * NVDA/ETH rate.
   */
  quoteAsset?: 'native' | 'wrapped_native' | 'token';
  /** The quote token's contract address; absent for the native coin. */
  quoteToken?: string;
  /** Measured scale of the quote leg. Omitted for token quotes until the
   * quote token's own metadata resolves; never defaulted to 18. */
  quoteDecimals?: number;
  /** Exact quote ticker. Currently emitted only for the native asset. */
  quoteSymbol?: string;
  /**
   * THE guard on the two `*Native` fields: they are only truthfully named
   * when this is true. Required on the wire, so a missing value here is a
   * malformed frame and is treated as NOT native.
   */
  quoteIsNative?: boolean;
  /** Generic quote-leg values. These remain raw base-unit strings when the
   * quote scale is absent, so consumers can retain them without formatting. */
  reserveQuoteBaseUnits?: string;
  priceQuoteNum?: string;
  priceQuoteDen?: string;
  marketCapQuoteBaseUnits?: string;
  historyComplete: boolean;
  /** Absent when history is partial. */
  tradeCount?: number;
  buyCount?: number;
  sellCount?: number;
  volumeNative?: string;
  lastBlockNumber: number;
  /**
   * BLOCK time (SECONDS) of the block the indexer's fold ADMITTED this token
   * at — the card's age on a COLD load, which previously existed only for
   * tokens the client happened to watch launch live. `historyComplete` says
   * which fact it is: `true` and this is the CREATION block's time; `false`
   * and it is merely the first block the fold observed the token in, an
   * upper bound on its age.
   *
   * ABSENT when the admission block carried no usable header timestamp —
   * never 0 (renders as a 1970 launch) and never a wall clock (dates an
   * un-headered launch as the freshest token on the chain, the exact defect
   * `laneState.ts::frameToAction` documents). Emitted by
   * an internal backend type as `firstSeenSec`.
   */
  firstSeenSec?: number;

  /* ---------------------------------------------------------------- */
  /* The MARKET half, emitted by the backend source.       */
  /*                                                                    */
  /* THIS BLOCK USED TO SAY NONE OF IT ARRIVES. That was true while     */
  /* the backend source called the plain builders; the enriched pair is      */
  /* wired now and the identity/pricing providers are spawned. The api  */
  /* proxy relays these bytes OPAQUELY — no parse, no schema, no        */
  /* allowlist — so nothing upstream filters a field out.               */
  /*                                                                    */
  /* The consequence for anyone debugging a blank figure: if a value is */
  /* missing at render, the defect is TERMINAL-SIDE. Two separate       */
  /* audits have now checked the producer first and found it clean, and */
  /* every defect this file was fixed for was a field that arrived here */
  /* and was discarded — a name the parser spelled differently, or a    */
  /* parsed value no component ever read. Check this file and its       */
  /* consumers before looking upstream.                                 */
  /*                                                                    */
  /* Each field stays OPTIONAL: absence is still meaningful (an         */
  /* unresolved identity, a stale oracle) and still renders a           */
  /* deliberate unknown rather than a zero.                             */
  /* ---------------------------------------------------------------- */

  /** Set (`"price_underivable"`) when no price could be derived at all; every
   *  other market field is then absent. */
  marketDataUnavailableReason?: string;
  /** Price ratio, native wei per token BASE UNIT. Both or neither. */
  priceNativeNum?: string;
  priceNativeDen?: string;
  /** How the price was obtained: executed trade, reserves, sqrt price, curve. */
  priceBasis?: 'executed_trade' | 'reserves' | 'sqrt_price_x96' | 'four_meme_curve';
  /** Market cap in native wei. Needs BOTH `decimals` and `totalSupply`. */
  marketCapNative?: string;
  /** Resolved token image URI, already normalized (IPFS/Arweave/dead gateways
   *  rewritten upstream). Absent means no image was resolvable — NOT a broken
   *  URL to render. */
  imageUrl?: string;
  /**
   * MEASURED ERC-20 decimals. A JSON number, and the one bare number on the
   * card that is safe as such (a `u8`). Never defaulted to 18 upstream — its
   * absence is reported in `identityAbsent.decimals` instead — so its presence
   * here is what flips `tokenDecimalsAssumed` to false.
   */
  decimals?: number;
  /** Total supply in token base units. */
  totalSupply?: string;
  /** Per-identity-field reason for absence: `reverted`, `unimplemented`,
   *  `undecodable`, `empty`, `unavailable`. */
  identityAbsent?: Record<string, string>;
  /**
   * Why no USD figure is served. `quote_not_native` is the stock-quoted
   * (NVDA/SPY) Pons case — a native/USD rate cannot price a market whose money
   * leg is a stock token. `native_usd_absent_or_stale` is the oracle gap.
   */
  usdUnavailableReason?: string;
  /**
   * ATTO-USD (1e-18) — the figure of RECORD for the two compact USD slots.
   *
   * the backend source emits these first and omits the micro twin below exactly where
   * micro would floor a real measurement to `"0"` (`floors_a_measurement`), so
   * a reader that knows only micro renders "unknown" for precisely the small
   * windows the wire took care to preserve. Always try atto first.
   */
  marketCapUsdAtto?: string;
  volumeUsdAtto?: string;
  /** Micro-USD (1e-6). Present only when the quote leg is native AND a fresh
   *  Pyth snapshot exists — AND only where it does not floor the measurement
   *  away; see the atto pair above. */
  marketCapUsdMicro?: string;
  volumeUsdMicro?: string;
  /** Atto-USD (1e-18) per WHOLE token — micro would floor a memecoin to zero. */
  priceUsdAtto?: string;
  /** Nano-USD (1e-9) per 1 native token, and the oracle's own publish time. */
  nativeUsdNano?: string;
  nativeUsdPublishTimeSec?: number;
  nativeUsdPair?: string;

  /**
   * MOMENTUM SCORE in TENTHS (`72` = 7.2), and the wire's own display string
   * beside it. Both emitted by the backend source, which is the
   * single production caller of an internal routine — the arithmetic is
   * Solana's, term for term, but computed once on the producer instead of in
   * three duplicated client copies.
   *
   * Tenths is the figure of RECORD: an integer, so the rounding is explicit
   * rather than a property of float formatting.
   */
  scoreTenths?: number;
  score?: string;
  /**
   * WHY there is no score — and this field is the whole reason the score is
   * safe to render. the backend source REFUSES a score it cannot compute rather than
   * manufacturing Solana's fabricated `5.0` floor, so an absent score always
   * arrives with one of a closed vocabulary of reasons:
   * `no_trades_observed`, `partial_history`, `quote_not_native`,
   * `no_native_usd_rate`, `volume_window_unmeasured`.
   */
  scoreUnavailableReason?: string;

  /**
   * THE CROWN BADGE'S OWN NUMBERS: how many tokens this creator launched and
   * how many graduated, straight from the fold. Both present or both absent —
   * the backend source never emits a fabricated `{0, 0}`, which
   * is exactly the Solana bug that read *a serial rugger with 40 launches as a
   * first-time dev*.
   */
  creatorCreated?: number;
  creatorMigrated?: number;
  /** Why no creator tally is served: `no_creator_known`, `lookup_failed`,
   *  `impossible_count`. */
  creatorRecordUnavailableReason?: string;

  /** The security row. Absent when no signal fold was consulted at all. */
  security?: EvmSecurityWire;

  /**
   * BLOCK time (SECONDS) of the graduation this fold witnessed — the Graduated
   * lane's sort key. OMITTED, never 0 and never now, for a token hydrated
   * already-graduated: the lane must sort that as unknown rather than as the
   * newest or oldest graduation on the chain.
   */
  graduatedAtSec?: number;
}

/**
 * The wire's `security` object (the backend source).
 *
 * EVERY SHARE IS OMITTED RATHER THAN ZEROED when it was not measured, and the
 * rule is sharper here than anywhere else on the card. Solana's own bug
 * history on this row is a STICKY 0% that read as "the dev sold" when it meant
 * "we never knew", and a `0%` sniper share is a positive claim of SAFETY about
 * a token nobody looked at. So a consumer must treat an absent `devBps` as
 * unknown and never as clean — see `holdingsUnavailableText`.
 */
export interface EvmSecurityWire {
  /** Top-holder concentration in basis points of supply. Fails independently
   *  of the class shares, so an unanchored token still publishes it. */
  topHolderBps?: number;
  /** Class shares in basis points of supply. Each is absent unless measured. */
  devBps?: number;
  sniperBps?: number;
  bundlerBps?: number;
  /**
   * Why the three shares above are absent: `unanchored` (no creation event
   * was decoded, so there is no block to measure a first-buy against — and it
   * is NOT repaired by a later backfill), `supply_unknown` (`totalSupply()`
   * has not resolved, and a percentage of an unknown denominator is not a
   * percentage), or `holders_partial` (the holder ledger is not authoritative,
   * so an unseen wallet's balance would read as zero).
   */
  classesUnavailableReason?: string;
  /** The creator bought in its own creation block, so it is counted in the
   *  sniper bucket AS WELL AS the dev one — the two are not disjoint. */
  devSniped?: boolean;
  /** The wallet cap was hit, so every share above is a LOWER BOUND. */
  classesTruncated?: boolean;
  /** Base-unit counts at the token's own scale, as decimal strings. */
  mintedAfterLaunch?: string;
  burned?: string;
}

export interface EvmDiscoverLane {
  v: string;
  chain: string;
  stage: EvmDiscoverCard['stage'];
  /** Cards actually returned — a BOUNDED observation, capped server-side. */
  count: number;
  /** Cards the lane holds before the cap. `count` alone cannot say this. */
  total: number;
  /** True when `total > count`, i.e. this lane is a slice, not the whole. */
  truncated: boolean;
  cards: EvmDiscoverCard[];
  /**
   * Cards this lane served that could not be decoded, and were DROPPED.
   *
   * A card the terminal cannot read is a missing ROW, never a blank board.
   * This parse used to refuse the whole snapshot on the first bad card, so a
   * single field whose wire type the validator disagreed with rendered every
   * lane on every chain as "feed unavailable" — an all-or-nothing rule that
   * turns a one-card producer change into a total outage.
   *
   * Counted rather than silent: a dropped row is otherwise indistinguishable
   * from a token the producer never served. `count` is left as the SERVER's
   * claim about what it sent, so `count - cards.length` is this number.
   */
  cardsRejected: number;
}

const EVM_DISCOVER_STAGES = new Set<EvmDiscoverCard['stage']>([
  'new',
  'ripening',
  'migrating',
  'graduated',
]);
const EVM_DISCOVER_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_DISCOVER_HASH = /^0x[0-9a-fA-F]{64}$/;

const CARD_WIDE_FIELDS = [
  'tradeCount',
  'buyCount',
  'sellCount',
  'lastBlockNumber',
  'firstSeenSec',
  'nativeUsdPublishTimeSec',
  'creatorCreated',
  'creatorMigrated',
  'graduatedAtSec',
] as const;

const CARD_DECIMAL_FIELDS = [
  'reserveQuoteBaseUnits',
  'reserveNative',
  'reserveToken',
  'curvePriceWord',
  'priceQuoteNum',
  'priceQuoteDen',
  'priceNativeNum',
  'priceNativeDen',
  'marketCapQuoteBaseUnits',
  'marketCapNative',
  'totalSupply',
  'marketCapUsdAtto',
  'volumeUsdAtto',
  'marketCapUsdMicro',
  'volumeUsdMicro',
  'priceUsdAtto',
  'nativeUsdNano',
] as const;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export interface EvmLaunchOption {
  readonly launchpad: EvmLaunchpad;
  readonly launchVariant: EvmLaunchVariant;
  readonly label: string;
  readonly modeLabel: string;
}

const BSC_LAUNCH_OPTIONS = [
  { launchpad: 'four_meme', launchVariant: 'v1', label: 'Four.meme', modeLabel: 'V1' },
  { launchpad: 'four_meme', launchVariant: 'tm2', label: 'Four.meme', modeLabel: 'TM2' },
  {
    launchpad: 'four_meme',
    launchVariant: 'open_four_v12',
    label: 'Four.meme',
    modeLabel: 'OpenFour V12',
  },
  { launchpad: 'flap', launchVariant: 'portal', label: 'Flap', modeLabel: 'Portal' },
] as const satisfies readonly EvmLaunchOption[];

const ROBINHOOD_LAUNCH_OPTIONS = [
  { launchpad: 'flap', launchVariant: 'portal', label: 'Flap', modeLabel: 'Portal' },
  { launchpad: 'pons', launchVariant: 'v1', label: 'Pons', modeLabel: 'V1' },
  { launchpad: 'pons', launchVariant: 'v2', label: 'Pons', modeLabel: 'V2' },
  {
    launchpad: 'pools_trade',
    launchVariant: 'instant_tick25',
    label: 'pools.trade',
    modeLabel: 'Instant 25',
  },
  {
    launchpad: 'pools_trade',
    launchVariant: 'instant_tick60',
    label: 'pools.trade',
    modeLabel: 'Instant 60',
  },
  {
    launchpad: 'pools_trade',
    launchVariant: 'crowd_tick50',
    label: 'pools.trade',
    modeLabel: 'Crowd 50',
  },
] as const satisfies readonly EvmLaunchOption[];

/** Every exact launch identity the selected chain can legally emit. */
export function evmLaunchOptionsForChain(chain: string): readonly EvmLaunchOption[] {
  if (chain === 'bsc') return BSC_LAUNCH_OPTIONS;
  if (chain === 'robinhood_chain') return ROBINHOOD_LAUNCH_OPTIONS;
  return [];
}

export function evmLaunchOption(
  chain: string,
  launchpad: EvmLaunchpad,
  launchVariant: EvmLaunchVariant,
): EvmLaunchOption | null {
  return evmLaunchOptionsForChain(chain).find(
    (option) => option.launchpad === launchpad && option.launchVariant === launchVariant,
  ) ?? null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parseLaunchQuotePosture(
  value: unknown,
  chain: string,
): EvmLaunchQuotePosture | null {
  const raw = record(value);
  if (raw === null || typeof raw['kind'] !== 'string') return null;
  const kind = raw['kind'];
  const decimals = readBoundedUnsigned(raw['decimals'], 36);
  const symbol = raw['symbol'];
  if (symbol !== undefined && (
    typeof symbol !== 'string' || symbol.trim().length === 0 || symbol.length > 32
  )) return null;
  if (kind === 'native') {
    if (
      !hasOnlyKeys(raw, ['kind', 'decimals', 'symbol'])
      || decimals !== EVM_NATIVE_DECIMALS
      || symbol !== nativeSymbolForChain(chain)
    ) return null;
    return { kind, decimals, symbol };
  }
  if (kind !== 'wrapped_native' && kind !== 'erc20') return null;
  if (!hasOnlyKeys(raw, ['kind', 'address', 'decimals', 'symbol'])) return null;
  const address = raw['address'];
  if (typeof address !== 'string' || !EVM_DISCOVER_ADDRESS.test(address)) return null;
  if (kind === 'wrapped_native' && decimals !== EVM_NATIVE_DECIMALS) return null;
  if (kind === 'erc20' && raw['decimals'] !== undefined && decimals === null) return null;
  return {
    kind,
    address: address.toLowerCase(),
    ...(decimals === null ? {} : { decimals }),
    ...(typeof symbol === 'string' ? { symbol } : {}),
  };
}

function parseLaunchProfile(
  value: unknown,
  chain: string,
  launchpad: EvmLaunchpad,
  launchVariant: EvmLaunchVariant,
): EvmLaunchProfile | null {
  const raw = record(value);
  if (raw === null || raw['generation'] !== launchVariant) return null;
  const quotePosture = parseLaunchQuotePosture(raw['quotePosture'], chain);
  if (quotePosture === null) return null;
  const common = { generation: launchVariant, quotePosture };
  if (launchpad === 'four_meme' && launchVariant === 'v1') {
    if (
      !hasOnlyKeys(raw, ['generation', 'mode', 'quotePosture'])
      || raw['mode'] !== 'legacy_curve'
    ) return null;
    return { ...common, mode: 'legacy_curve' };
  }
  if (launchpad === 'four_meme' && launchVariant === 'tm2') {
    const creatorType = readBoundedUnsigned(raw['creatorType'], 255);
    if (
      !hasOnlyKeys(raw, [
        'generation', 'mode', 'creatorType', 'feePlanEnabled', 'feeSetting',
        'extraFee', 'maxRaising', 'quotePosture',
      ])
      || (raw['mode'] !== 'classic' && raw['mode'] !== 'x')
      || creatorType === null
      || typeof raw['feePlanEnabled'] !== 'boolean'
      || !isCanonicalUnsigned(raw['feeSetting'])
      || !isCanonicalUnsigned(raw['extraFee'])
      || !isCanonicalUnsigned(raw['maxRaising'])
    ) return null;
    return {
      ...common,
      mode: raw['mode'],
      creatorType,
      feePlanEnabled: raw['feePlanEnabled'],
      feeSetting: raw['feeSetting'],
      extraFee: raw['extraFee'],
      maxRaising: raw['maxRaising'],
    };
  }
  if (launchpad === 'four_meme' && launchVariant === 'open_four_v12') {
    const phases = new Set([
      'created', 'curve', 'migrate_pending', 'migrated', 'terminal', 'sold_out',
    ]);
    if (
      !hasOnlyKeys(raw, [
        'generation', 'mode', 'presetId', 'flags', 'phase', 'quotePosture',
      ])
      || raw['mode'] !== 'open_four_v12'
      || !isCanonicalUnsigned(raw['presetId'])
      || !isCanonicalUnsigned(raw['flags'])
      || typeof raw['phase'] !== 'string'
      || !phases.has(raw['phase'])
    ) return null;
    return {
      ...common,
      mode: 'open_four_v12',
      presetId: raw['presetId'],
      flags: raw['flags'],
      phase: raw['phase'] as EvmLaunchProfile['phase'],
    };
  }
  if (launchpad === 'flap' && launchVariant === 'portal') {
    const tokenVersion = readBoundedUnsigned(raw['tokenVersion'], 255);
    const migratorType = readBoundedUnsigned(raw['migratorType'], 255);
    const buyTaxBps = readBoundedUnsigned(raw['buyTaxBps'], 10_000);
    const sellTaxBps = readBoundedUnsigned(raw['sellTaxBps'], 10_000);
    const expectedTaxMode = buyTaxBps === 0 && sellTaxBps === 0
      ? 'none'
      : buyTaxBps === sellTaxBps
        ? 'symmetric'
        : 'asymmetric';
    if (
      !hasOnlyKeys(raw, [
        'generation', 'mode', 'tokenVersion', 'migratorType', 'taxMode',
        'buyTaxBps', 'sellTaxBps', 'quotePosture',
      ])
      || raw['mode'] !== 'portal'
      || tokenVersion === null
      || migratorType === null
      || buyTaxBps === null
      || sellTaxBps === null
      || raw['taxMode'] !== expectedTaxMode
    ) return null;
    return {
      ...common,
      mode: 'portal',
      tokenVersion,
      migratorType,
      taxMode: expectedTaxMode,
      buyTaxBps,
      sellTaxBps,
    };
  }
  if (launchpad === 'pons' && (launchVariant === 'v1' || launchVariant === 'v2')) {
    if (!hasOnlyKeys(raw, ['generation', 'quotePosture'])) return null;
    return common;
  }
  if (launchpad === 'pools_trade') {
    const expected = launchVariant === 'instant_tick25'
      ? { mode: 'instant', tickSpacing: 25 as const }
      : launchVariant === 'instant_tick60'
        ? { mode: 'instant', tickSpacing: 60 as const }
        : launchVariant === 'crowd_tick50'
          ? { mode: 'crowd', tickSpacing: 50 as const }
          : null;
    if (
      expected === null
      || !hasOnlyKeys(raw, ['generation', 'mode', 'tickSpacing', 'quotePosture'])
      || raw['mode'] !== expected.mode
      || raw['tickSpacing'] !== expected.tickSpacing
    ) return null;
    return { ...common, mode: expected.mode, tickSpacing: expected.tickSpacing };
  }
  return null;
}

function launchProfileMatchesQuote(
  profile: EvmLaunchProfile,
  quoteAsset: unknown,
  quoteToken: unknown,
  quoteDecimals: unknown,
  quoteSymbol: unknown,
): boolean {
  const quote = profile.quotePosture;
  const assetMatches = quote.kind === 'native'
    ? quoteAsset === 'native' && quoteToken === undefined
    : quote.kind === 'wrapped_native'
      ? quoteAsset === 'wrapped_native' && quoteToken === quote.address
      : quoteAsset === 'token' && quoteToken === quote.address;
  return assetMatches
    && (quote.decimals === undefined || quote.decimals === quoteDecimals)
    && (quote.symbol === undefined || quote.symbol === quoteSymbol);
}

/**
 * Decode the producer's aggregate and per-side execution capability as one
 * indivisible tuple. A mixed cache/frame must not turn one nullable reason
 * into an enabled money control. V1 predates the side fields, so only a V1
 * frame with all four fields absent inherits the aggregate capability.
 */
function normalizeSideCapability(
  raw: Record<string, unknown>,
  version: EvmWireVersion,
): {
  buyable: boolean;
  sellable: boolean;
  buyBlockedReason: EvmTradeBlockedReason | null;
  sellBlockedReason: EvmTradeBlockedReason | null;
} | null {
  const tradeable = raw['tradeable'];
  const tradeBlockedReason = raw['tradeBlockedReason'];
  if (typeof tradeable !== 'boolean' || !isEvmTradeBlockedReasonWire(tradeBlockedReason)) {
    return null;
  }

  const sideFields = [
    raw['buyable'],
    raw['sellable'],
    raw['buyBlockedReason'],
    raw['sellBlockedReason'],
  ];
  if (sideFields.every((value) => value === undefined)) {
    if (version !== '1') return null;
    return {
      buyable: tradeable,
      sellable: tradeable,
      buyBlockedReason: tradeBlockedReason,
      sellBlockedReason: tradeBlockedReason,
    };
  }

  const buyable = raw['buyable'];
  const sellable = raw['sellable'];
  const buyBlockedReason = raw['buyBlockedReason'];
  const sellBlockedReason = raw['sellBlockedReason'];
  if (
    typeof buyable !== 'boolean'
    || typeof sellable !== 'boolean'
    || !isEvmTradeBlockedReasonWire(buyBlockedReason)
    || !isEvmTradeBlockedReasonWire(sellBlockedReason)
    || buyable !== (buyBlockedReason === null)
    || sellable !== (sellBlockedReason === null)
    || tradeable !== (buyable && sellable)
    || tradeBlockedReason !== (buyBlockedReason ?? sellBlockedReason)
  ) {
    return null;
  }
  return { buyable, sellable, buyBlockedReason, sellBlockedReason };
}

function normalizeDiscoverCard(
  raw: Record<string, unknown>,
  version: EvmWireVersion,
): EvmDiscoverCard | null {
  const normalized: Record<string, unknown> = { ...raw };
  const sideCapability = normalizeSideCapability(raw, version);
  if (sideCapability === null) return null;
  Object.assign(normalized, sideCapability);
  for (const field of CARD_WIDE_FIELDS) {
    if (!hasOwn(raw, field)) continue;
    const parsed = readWideUnsigned(raw[field], version);
    if (parsed === null) return null;
    normalized[field] = parsed;
  }
  for (const field of CARD_DECIMAL_FIELDS) {
    if (hasOwn(raw, field) && !isCanonicalUnsigned(raw[field])) return null;
  }
  for (const [field, maximum] of [
    ['decimals', 255],
    ['quoteDecimals', 36],
    ['scoreTenths', 1_000],
    ['topHolderBps', 10_000],
    ['devBps', 10_000],
    ['sniperBps', 10_000],
    ['bundlerBps', 10_000],
    ['poolFeeTier', 0x00ff_ffff],
  ] as const) {
    if (!hasOwn(raw, field)) continue;
    const parsed = readBoundedUnsigned(raw[field], maximum);
    if (parsed === null) return null;
    normalized[field] = parsed;
  }
  if (hasOwn(raw, 'poolTickSpacing')) {
    const spacing = readBoundedSigned(raw['poolTickSpacing'], 1, 0x007f_ffff);
    if (spacing === null) return null;
    normalized['poolTickSpacing'] = spacing;
  }

  const quoteAsset = raw['quoteAsset'];
  const creator = raw['creator'];
  const quoteToken = raw['quoteToken'];
  const quoteIsNative = raw['quoteIsNative'];
  const quoteDecimals = normalized['quoteDecimals'];
  const quoteSymbol = raw['quoteSymbol'];
  if (creator !== undefined && (
    typeof creator !== 'string' || !EVM_DISCOVER_ADDRESS.test(creator)
  )) {
    return null;
  }
  if (typeof quoteIsNative !== 'boolean') return null;
  if (
    quoteAsset !== undefined &&
    quoteAsset !== 'native' &&
    quoteAsset !== 'wrapped_native' &&
    quoteAsset !== 'token'
  ) {
    return null;
  }
  if (quoteToken !== undefined && (
    typeof quoteToken !== 'string' || !EVM_DISCOVER_ADDRESS.test(quoteToken)
  )) {
    return null;
  }
  if (quoteSymbol !== undefined && (
    typeof quoteSymbol !== 'string'
    || quoteSymbol.trim().length === 0
    || quoteSymbol.length > 32
  )) {
    return null;
  }
  const quoteIdentityValid =
    quoteAsset === undefined
      ? quoteIsNative === false &&
        quoteToken === undefined &&
        quoteDecimals === undefined &&
        quoteSymbol === undefined
      : quoteAsset === 'native'
        ? quoteIsNative === true &&
          quoteToken === undefined &&
          quoteDecimals === EVM_NATIVE_DECIMALS &&
          typeof quoteSymbol === 'string'
        : quoteAsset === 'wrapped_native'
          ? quoteIsNative === true &&
            typeof quoteToken === 'string' &&
            quoteDecimals === EVM_NATIVE_DECIMALS &&
            (quoteSymbol === undefined || typeof quoteSymbol === 'string')
          : quoteIsNative === false &&
            typeof quoteToken === 'string' &&
            ((quoteDecimals === undefined && quoteSymbol === undefined) ||
              (typeof quoteDecimals === 'number' && typeof quoteSymbol === 'string'));
  if (!quoteIdentityValid) return null;
  const genericQuoteFields = [
    'reserveQuoteBaseUnits',
    'priceQuoteNum',
    'priceQuoteDen',
    'marketCapQuoteBaseUnits',
  ] as const;
  if (quoteAsset === undefined && genericQuoteFields.some((field) => hasOwn(raw, field))) {
    return null;
  }
  if (hasOwn(raw, 'priceQuoteNum') !== hasOwn(raw, 'priceQuoteDen')) return null;
  if (raw['priceQuoteDen'] === '0') return null;
  // Native aliases and USD values are emitted only when denomination proves
  // they really are native. A token-quoted base-unit count must never regain
  // a BNB/ETH label through an old alias.
  if (!quoteIsNative && [
    'reserveNative',
    'priceNativeNum',
    'priceNativeDen',
    'marketCapNative',
    'volumeNative',
    'marketCapUsdAtto',
    'volumeUsdAtto',
    'marketCapUsdMicro',
    'volumeUsdMicro',
    'priceUsdAtto',
  ].some((field) => hasOwn(raw, field))) {
    return null;
  }
  if (quoteIsNative && (
    (hasOwn(raw, 'reserveQuoteBaseUnits') && hasOwn(raw, 'reserveNative')
      && raw['reserveQuoteBaseUnits'] !== raw['reserveNative'])
    || (hasOwn(raw, 'priceQuoteNum') && hasOwn(raw, 'priceNativeNum')
      && raw['priceQuoteNum'] !== raw['priceNativeNum'])
    || (hasOwn(raw, 'priceQuoteDen') && hasOwn(raw, 'priceNativeDen')
      && raw['priceQuoteDen'] !== raw['priceNativeDen'])
    || (hasOwn(raw, 'marketCapQuoteBaseUnits') && hasOwn(raw, 'marketCapNative')
      && raw['marketCapQuoteBaseUnits'] !== raw['marketCapNative'])
  )) {
    return null;
  }

  const historyComplete = raw['historyComplete'];
  const counts = ['tradeCount', 'buyCount', 'sellCount'] as const;
  if (historyComplete === true) {
    if (counts.some((field) => !hasOwn(normalized, field))) return null;
    const tradeCount = normalized['tradeCount'] as number;
    const buyCount = normalized['buyCount'] as number;
    const sellCount = normalized['sellCount'] as number;
    if (buyCount + sellCount !== tradeCount) return null;
  } else if (counts.some((field) => hasOwn(raw, field))) {
    return null;
  }

  const reason = normalized['tradeBlockedReason'];
  if ((normalized['tradeable'] === true) !== (reason === null)) return null;
  const depthStatus = raw['depthStatus'];
  if (
    depthStatus !== undefined
    && depthStatus !== 'awaiting_first_observation'
    && depthStatus !== 'measured'
    && depthStatus !== 'not_derivable_concentrated'
    && depthStatus !== 'venue_not_indexed'
    && depthStatus !== 'four_meme_v1_unsupported'
    && depthStatus !== 'four_meme_v1_buy_only'
    && depthStatus !== 'awaiting_external_pool'
    && depthStatus !== 'crowd_auction_active'
    && depthStatus !== 'onchain_quoter'
  ) return null;

  const basis = raw['reserveBasis'];
  const marketVenue = raw['marketVenue'];
  if (
    marketVenue !== undefined
    && (typeof marketVenue !== 'string' || !EVM_MARKET_VENUES.has(marketVenue as EvmMarketVenue))
  ) return null;
  const launchpad = raw['launchpad'];
  const launchVariant = raw['launchVariant'];
  const launchProfile = raw['launchProfile'];
  const hasLaunchIdentity = launchpad !== undefined || launchVariant !== undefined;
  if (
    hasLaunchIdentity
    && (
      typeof launchpad !== 'string'
      || !EVM_LAUNCHPADS.has(launchpad as EvmLaunchpad)
      || typeof launchVariant !== 'string'
      || !EVM_LAUNCH_VARIANTS.has(launchVariant as EvmLaunchVariant)
      || evmLaunchOption(
        raw['chain'] as string,
        launchpad as EvmLaunchpad,
        launchVariant as EvmLaunchVariant,
      ) === null
    )
  ) return null;
  if (!hasLaunchIdentity && launchProfile !== undefined) return null;
  const parsedLaunchProfile = launchProfile === undefined
    ? undefined
    : parseLaunchProfile(
      launchProfile,
      raw['chain'] as string,
      launchpad as EvmLaunchpad,
      launchVariant as EvmLaunchVariant,
    );
  if (launchProfile !== undefined) {
    if (parsedLaunchProfile === null || parsedLaunchProfile === undefined) return null;
    if (!launchProfileMatchesQuote(
      parsedLaunchProfile,
      quoteAsset,
      typeof quoteToken === 'string' ? quoteToken.toLowerCase() : quoteToken,
      quoteDecimals,
      quoteSymbol,
    )) return null;
  }
  const allowedBasis = basis === undefined
    || basis === 'curve'
    || basis === 'amm_pair'
    || basis === 'pancake_v2'
    || basis === 'pancake_v3'
    || basis === 'uniswap_v2'
    || basis === 'uniswap_v3'
    || basis === 'uniswap_v4'
    || basis === 'pancake_infinity_cl'
    || basis === 'flap_curve'
    || basis === 'concentrated_virtual';
  if (!allowedBasis) return null;
  const poolAddress = raw['poolAddress'];
  const poolFactory = raw['poolFactory'];
  const hasPoolIdentity = typeof poolAddress === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolAddress)
    && typeof poolFactory === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolFactory);
  const poolId = raw['poolId'];
  const poolManager = raw['poolManager'];
  const poolVault = raw['poolVault'];
  const poolCurrency0 = raw['poolCurrency0'];
  const poolCurrency1 = raw['poolCurrency1'];
  const poolHooks = raw['poolHooks'];
  const launchFactory = raw['launchFactory'];
  const launchEntry = raw['launchEntry'];
  const launchMode = raw['launchMode'];
  const hasV4Identity = typeof poolId === 'string'
    && EVM_DISCOVER_HASH.test(poolId)
    && typeof poolManager === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolManager)
    && typeof poolCurrency0 === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolCurrency0)
    && typeof poolCurrency1 === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolCurrency1)
    && typeof poolHooks === 'string'
    && EVM_DISCOVER_ADDRESS.test(poolHooks)
    && typeof launchFactory === 'string'
    && EVM_DISCOVER_ADDRESS.test(launchFactory);
  const hasPoolAddressFields = hasOwn(raw, 'poolAddress') || hasOwn(raw, 'poolFactory');
  const hasV4Fields = [
    'poolId',
    'poolManager',
    'poolVault',
    'poolCurrency0',
    'poolCurrency1',
    'poolHooks',
    'launchEntry',
    'launchMode',
  ].some((field) => hasOwn(raw, field));
  if (basis === 'pancake_v2' || basis === 'uniswap_v2') {
    if (!hasPoolIdentity || hasOwn(raw, 'poolFeeTier') || hasOwn(raw, 'poolTickSpacing')) {
      return null;
    }
    if (marketVenue !== basis || hasV4Fields) return null;
  } else if (basis === 'pancake_v3' || basis === 'uniswap_v3') {
    if (!hasPoolIdentity || !hasOwn(raw, 'poolFeeTier') || !hasOwn(raw, 'poolTickSpacing')) {
      return null;
    }
    if (marketVenue !== basis || hasV4Fields) return null;
  } else if (basis === 'uniswap_v4') {
    if (
      !hasV4Identity
      || hasPoolAddressFields
      || !hasOwn(raw, 'poolFeeTier')
      || !hasOwn(raw, 'poolTickSpacing')
      || (launchMode !== 'instant' && launchMode !== 'crowd')
      || typeof launchEntry !== 'string'
      || !EVM_DISCOVER_ADDRESS.test(launchEntry)
      || (
        marketVenue !== 'flap_uniswap_v4'
        && marketVenue !== 'pools_trade_tick25'
        && marketVenue !== 'pools_trade_tick60'
        && marketVenue !== 'pools_trade_crowd_tick50'
      )
    ) return null;
    if (
      (marketVenue === 'pools_trade_tick25'
        && (normalized['poolFeeTier'] !== 2_500 || normalized['poolTickSpacing'] !== 25 || launchMode !== 'instant'))
      || (marketVenue === 'pools_trade_tick60'
        && (normalized['poolFeeTier'] !== 2_500 || normalized['poolTickSpacing'] !== 60 || launchMode !== 'instant'))
      || (marketVenue === 'pools_trade_crowd_tick50'
        && (normalized['poolFeeTier'] !== 2_500 || normalized['poolTickSpacing'] !== 50 || launchMode !== 'crowd'))
    ) return null;
  } else if (basis === 'pancake_infinity_cl') {
    if (
      !hasV4Identity
      || hasPoolAddressFields
      || !hasOwn(raw, 'poolFeeTier')
      || !hasOwn(raw, 'poolTickSpacing')
      || typeof poolVault !== 'string'
      || !EVM_DISCOVER_ADDRESS.test(poolVault)
      || marketVenue !== 'pancake_infinity_cl'
      || hasOwn(raw, 'launchEntry')
      || hasOwn(raw, 'launchMode')
    ) return null;
  } else if (
    hasPoolAddressFields
    || hasV4Fields
    || hasOwn(raw, 'poolFeeTier')
    || hasOwn(raw, 'poolTickSpacing')
  ) {
    return null;
  }

  return {
    ...(normalized as unknown as EvmDiscoverCard),
    address: (raw['address'] as string).toLowerCase(),
    ...(typeof creator === 'string' ? { creator: creator.toLowerCase() } : {}),
    ...(typeof quoteToken === 'string' ? { quoteToken: quoteToken.toLowerCase() } : {}),
    ...(typeof poolAddress === 'string' ? { poolAddress: poolAddress.toLowerCase() } : {}),
    ...(typeof poolFactory === 'string' ? { poolFactory: poolFactory.toLowerCase() } : {}),
    ...(typeof poolId === 'string' ? { poolId: poolId.toLowerCase() } : {}),
    ...(typeof poolManager === 'string' ? { poolManager: poolManager.toLowerCase() } : {}),
    ...(typeof poolVault === 'string' ? { poolVault: poolVault.toLowerCase() } : {}),
    ...(typeof poolCurrency0 === 'string' ? { poolCurrency0: poolCurrency0.toLowerCase() } : {}),
    ...(typeof poolCurrency1 === 'string' ? { poolCurrency1: poolCurrency1.toLowerCase() } : {}),
    ...(typeof poolHooks === 'string' ? { poolHooks: poolHooks.toLowerCase() } : {}),
    ...(typeof launchFactory === 'string' ? { launchFactory: launchFactory.toLowerCase() } : {}),
    ...(typeof launchEntry === 'string' ? { launchEntry: launchEntry.toLowerCase() } : {}),
    ...(parsedLaunchProfile === undefined || parsedLaunchProfile === null
      ? {}
      : { launchProfile: parsedLaunchProfile }),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Strictly decode one standalone Discover card from a subject-bound API. */
export function parseEvmDiscoverCard(
  value: unknown,
  expectedChain: string,
): EvmDiscoverCard | null {
  const raw = record(value);
  if (raw === null) return null;
  const version = readEvmWireVersion(raw['v']);
  if (
    version === null
    || raw['chain'] !== expectedChain
    || typeof raw['address'] !== 'string'
    || !EVM_DISCOVER_ADDRESS.test(raw['address'])
    || typeof raw['stage'] !== 'string'
    || !EVM_DISCOVER_STAGES.has(raw['stage'] as EvmDiscoverCard['stage'])
    || typeof raw['tradeable'] !== 'boolean'
    || !isEvmTradeBlockedReasonWire(raw['tradeBlockedReason'])
    || typeof raw['historyComplete'] !== 'boolean'
  ) {
    return null;
  }
  return normalizeDiscoverCard(raw, version);
}

/**
 * Decode one chain's authoritative Discover snapshot.
 *
 * The body repeats chain identity on every lane and card. A proxy or cache
 * mix-up must fail the refresh, never install another chain's cards under the
 * current tab. Addresses are normalized before they become store keys so
 * checksum case cannot create two identities for one contract.
 *
 * PARTIAL, NOT ALL-OR-NOTHING. An undecodable card is dropped and counted
 * (`EvmDiscoverLane.cardsRejected`); only an undecodable ENVELOPE — wrong lane
 * arity, a foreign or duplicated lane, a lane whose counts contradict its own
 * array, an unknown or mixed wire version — returns `null` and makes the read
 * a failure. `null` still means UNREADABLE, and a lane that decoded to zero
 * cards still means EMPTY; those two must never converge.
 */
export function parseEvmDiscoverSnapshot(
  value: unknown,
  expectedChain: string,
): EvmDiscoverLane[] | null {
  if (!Array.isArray(value) || value.length !== EVM_DISCOVER_STAGES.size) return null;
  const parsed: EvmDiscoverLane[] = [];
  const seenStages = new Set<EvmDiscoverCard['stage']>();
  let snapshotVersion: EvmWireVersion | null = null;
  for (const rawLane of value) {
    const lane = record(rawLane);
    if (lane === null || !Array.isArray(lane['cards'])) return null;
    const version = readEvmWireVersion(lane['v']);
    if (version === null || (snapshotVersion !== null && version !== snapshotVersion)) return null;
    snapshotVersion = version;
    const stage = lane['stage'];
    const count = readBoundedUnsigned(lane['count'], 100_000);
    const total = readWideUnsigned(lane['total'], version);
    const truncated = lane['truncated'];
    if (
      lane['chain'] !== expectedChain
      || typeof stage !== 'string'
      || !EVM_DISCOVER_STAGES.has(stage as EvmDiscoverCard['stage'])
      || seenStages.has(stage as EvmDiscoverCard['stage'])
      || count === null
      || total === null
      || total < count
      || typeof truncated !== 'boolean'
      || truncated !== (total > count)
      || count !== lane['cards'].length
    ) {
      return null;
    }
    seenStages.add(stage as EvmDiscoverCard['stage']);

    // EVERY CHECK BELOW IS CARD-LEVEL, so its failure is card-level: drop the
    // row, count it, keep the lane. Only the ENVELOPE checks above may refuse
    // the board, because a lane whose arity, chain or wire version is wrong
    // describes no cards at all — one bad card describes exactly one.
    const cards: EvmDiscoverCard[] = [];
    let cardsRejected = 0;
    for (const rawCard of lane['cards']) {
      const card = record(rawCard);
      if (
        card === null
        || card['v'] !== version
        || card['chain'] !== expectedChain
        || card['stage'] !== stage
        || typeof card['address'] !== 'string'
        || !EVM_DISCOVER_ADDRESS.test(card['address'])
        || typeof card['tradeable'] !== 'boolean'
        || !isEvmTradeBlockedReasonWire(card['tradeBlockedReason'])
        || typeof card['historyComplete'] !== 'boolean'
      ) {
        cardsRejected += 1;
        continue;
      }
      const normalized = normalizeDiscoverCard(card, version);
      if (normalized === null) {
        cardsRejected += 1;
        continue;
      }
      cards.push(normalized);
    }
    parsed.push({
      ...(lane as unknown as EvmDiscoverLane),
      count,
      total,
      cards,
      cardsRejected,
    });
  }
  return seenStages.size === EVM_DISCOVER_STAGES.size ? parsed : null;
}

/**
 * Chain-qualified card key. `bsc:0x…`.
 *
 * This is the React key, the store key and the trade-link segment source. A
 * bare address collides across the four EVM chains that share an address
 * space, which is the §4.5 collision arriving in the client — two different
 * tokens rendering as one row.
 */
export function evmCardKey(card: Pick<EvmDiscoverCard, 'chain' | 'address'>): string {
  return `${card.chain}:${card.address}`;
}

/**
 * The chain vocabulary now lives in `lib/evm/chains.ts` — a leaf module both
 * this file and `components/listen/navigation.ts` can import without a cycle.
 * Re-exported here because every existing call site imports these three from
 * `discoverAdapter`, and moving a definition is not a reason to touch fifty
 * import lines.
 */
export { chainSlug, nativeSymbolForChain, storageTagForSlug } from './chains';

/**
 * Trade-page href for a card.
 *
 * Delegates to the ONE href builder. It used to spell the two-segment shape
 * itself while `hrefForToken` spelled the single-segment one, so the terminal
 * had two functions that both claimed to know where a token lives — and only
 * one of them could express a chain.
 */
export function evmTradeHref(card: Pick<EvmDiscoverCard, 'chain' | 'address'>): string {
  return tradePageHref(card.address, card.chain);
}

/**
 * The wire shape an internal backend type emits: a
 * discover card plus the two trade-page extras. `tradeBlockedReason` is
 * explicit on the wire (not just derivable from `stage`) and `lastBlockHash`
 * exists for reorg checks once a stream consumer lands.
 */
export interface EvmTradeHeader extends EvmDiscoverCard {
  tradeBlockedReason: EvmTradeBlockedReason | null;
  buyable: boolean;
  sellable: boolean;
  buyBlockedReason: EvmTradeBlockedReason | null;
  sellBlockedReason: EvmTradeBlockedReason | null;
  lastBlockHash: string;
  /** Canonical read watermark. Required on V2, optional only during V1 rollout. */
  asOf?: {
    blockNumber: number;
    blockTimeMs?: number;
    servedAtMs: number;
  };
}

const EVM_BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Strictly decode and normalize one trade-header response. */
export function parseEvmTradeHeader(value: unknown): EvmTradeHeader | null {
  const raw = record(value);
  if (raw === null) return null;
  const version = readEvmWireVersion(raw['v']);
  if (
    version === null
    || typeof raw['chain'] !== 'string'
    || typeof raw['address'] !== 'string'
    || !EVM_DISCOVER_ADDRESS.test(raw['address'])
    || typeof raw['stage'] !== 'string'
    || !EVM_DISCOVER_STAGES.has(raw['stage'] as EvmDiscoverCard['stage'])
    || typeof raw['tradeable'] !== 'boolean'
    || !isEvmTradeBlockedReasonWire(raw['tradeBlockedReason'])
    || typeof raw['historyComplete'] !== 'boolean'
    || typeof raw['lastBlockHash'] !== 'string'
    || !EVM_BLOCK_HASH.test(raw['lastBlockHash'])
  ) {
    return null;
  }
  const card = normalizeDiscoverCard(raw, version);
  if (card === null) return null;

  const rawAsOf = record(raw['asOf']);
  if (rawAsOf === null) {
    return version === '1'
      ? {
          ...card,
          tradeBlockedReason: raw['tradeBlockedReason'] as EvmTradeBlockedReason | null,
          buyable: card.buyable ?? false,
          sellable: card.sellable ?? false,
          buyBlockedReason: card.buyBlockedReason ?? null,
          sellBlockedReason: card.sellBlockedReason ?? null,
          lastBlockHash: raw['lastBlockHash'].toLowerCase(),
        }
      : null;
  }
  const blockNumber = readWideUnsigned(rawAsOf['blockNumber'], version);
  const servedAtMs = readWideUnsigned(rawAsOf['servedAtMs'], version);
  let blockTimeMs: number | undefined;
  if (hasOwn(rawAsOf, 'blockTimeMs')) {
    const parsed = readWideUnsigned(rawAsOf['blockTimeMs'], version);
    if (parsed === null) return null;
    blockTimeMs = parsed;
  }
  if (
    blockNumber === null
    || servedAtMs === null
    || blockNumber < card.lastBlockNumber
    || (blockTimeMs !== undefined && blockTimeMs > servedAtMs)
  ) {
    return null;
  }
  return {
    ...card,
    tradeBlockedReason: raw['tradeBlockedReason'] as EvmTradeBlockedReason | null,
    buyable: card.buyable ?? false,
    sellable: card.sellable ?? false,
    buyBlockedReason: card.buyBlockedReason ?? null,
    sellBlockedReason: card.sellBlockedReason ?? null,
    lastBlockHash: raw['lastBlockHash'].toLowerCase(),
    asOf: {
      blockNumber,
      ...(blockTimeMs === undefined ? {} : { blockTimeMs }),
      servedAtMs,
    },
  };
}

/**
 * Format a wei-scale decimal string for display.
 *
 * Thin alias over `lib/evm/money.ts::formatNative`, kept because it is the
 * spelling every existing call site and test uses. The strictness lives
 * there now: one BigInt-only formatter for every EVM surface, so a second
 * one cannot drift into accepting `''` (which `BigInt` turns into a
 * measured `0`).
 */
export function formatNativeAmount(
  wei: string | undefined,
  maximumFractionDigits = 4,
): string | null {
  return formatNative(wei, maximumFractionDigits);
}

/** Card fields the renderer needs. A subset of `MockCoin`. */
export interface EvmCardView {
  id: string;
  ticker: string;
  name: string;
  handle: string;
  creator?: string;
  graduated: boolean;
  tradeable: boolean;
  buyable: boolean;
  sellable: boolean;
  stage: EvmDiscoverCard['stage'];
  chain: string;
  address: string;
  href: string;
  /** null when history is partial — the card renders "—", never 0. */
  tradeCount: number | null;
  buyCount: number | null;
  sellCount: number | null;
  volumeNativeText: string | null;
  reserveNativeText: string | null;
  reserveTokenText: string | null;
  /**
   * Curve price in NATIVE per whole token, exact to the rendered digit —
   * `reserveNative / reserveToken` in BigInt fixed-point.
   *
   * `null` whenever either reserve is absent, which is the common case and
   * the point: the `new` lane is made of tokens no trade has priced, and a
   * graduated token's curve stopped being the market. A "0" here would read
   * as a free token.
   */
  curvePriceText: string | null;
  historyComplete: boolean;
  /** Why trading is unavailable, or null. */
  tradeBlockedReason: EvmTradeBlockedReason | null;
  /** Requested-side capability; aggregate `tradeable` must not mask buy-only venues. */
  buyBlockedReason: EvmTradeBlockedReason | null;
  sellBlockedReason: EvmTradeBlockedReason | null;
  /**
   * Provenance of `reserveNativeText` / `reserveTokenText` / `curvePriceText`,
   * as a phrase fit to render beside them. `null` when no reserves were
   * served — which is when there is nothing to qualify.
   */
  reserveBasisText: string | null;
  /**
   * Depth provenance. Defaults to `measured` ONLY when reserves are actually
   * present; an old wire frame with no `depthStatus` and no reserves resolves
   * to `awaiting_first_observation`, never to a claim we can quote it.
   */
  depthStatus: DepthStatus;
  /** Exact ingestion execution discriminator; null when the wire has none. */
  marketVenue: EvmMarketVenue | null;
  /** Exact lifecycle-stable launch identity; both are null together. */
  launchpad: EvmLaunchpad | null;
  launchVariant: EvmLaunchVariant | null;
  /** Exact launch-time descriptor, null only for legacy-incomplete facts. */
  launchProfile: EvmLaunchProfile | null;
  /** Denomination of every `*Native` figure on this row. */
  quote: QuoteDenomination;

  /* --- the market half; all `null` until the enrichment call site lands --- */

  /** Resolved token image, or `null` — never a guessed or broken URL. */
  imageUrl: string | null;
  /** The scale token figures on this row were rendered at. */
  tokenDecimals: number;
  /** TRUE while `tokenDecimals` is the module default rather than a measured
   *  value. Flips to false the moment the wire carries `decimals`. */
  tokenDecimalsAssumed: boolean;
  /**
   * The MEASURED scale, or `null` — the same fact as the pair above with no
   * way to read it wrong.
   *
   * `tokenDecimals` is safe for RENDERING (a figure at a disclosed assumption
   * is still worth showing) and unsafe for SIZING an order, and the only thing
   * separating those two uses is remembering to consult a second boolean. An
   * order-sizing call site that forgets reads 18 and mis-sizes by a power of
   * ten with nothing on screen admitting it. This field cannot be misread:
   * there is no number here unless something measured one.
   */
  measuredTokenDecimals: number | null;
  /**
   * WHY `decimals` is absent, in the words a user reads — `null` when it is
   * present. From the wire's `identityAbsent.decimals`.
   *
   * A contract that REVERTED on `decimals()` is a different situation from one
   * nobody has read yet: the first will not improve by waiting, the second
   * will. Both render as the same missing scale without this.
   */
  tokenDecimalsAbsentText: string | null;
  /**
   * Every absent identity field with its reason, as one sentence — `null` when
   * the identity resolved completely.
   *
   * The wire has always carried `identityAbsent` and nothing read it, so an
   * unnamed token rendered as a shortened address with no account of itself.
   * That is the same defect class as a bare em dash: not a missing value but
   * the missing REASON for it.
   */
  identityAbsentSummary: string | null;
  /**
   * Total supply in whole tokens, compact. Parsed from the wire's
   * `totalSupply`, which was typed here and never read.
   *
   * Scaled by `tokenDecimals`, so it carries the same disclosed assumption as
   * the other token-denominated figures on the row when nothing measured a
   * scale — it is a figure to READ, not one to size an order from.
   */
  totalSupplyText: string | null;
  /** Last/derived price in native per whole token, from the wire's own ratio.
   *  Distinct from `curvePriceText`, which is implied by reserves. */
  wirePriceText: string | null;
  /** Where `wirePriceText` came from, fit to render. */
  priceBasisText: string | null;
  /** Market cap in the chain's native asset. */
  marketCapNativeText: string | null;
  /** Market cap and 24h volume in REAL dollars — present only when the wire
   *  served a Pyth-backed rate. Never derived here from a native figure. */
  marketCapUsdText: string | null;
  volumeUsdText: string | null;
  /**
   * THE SAME TWO FIGURES AS NUMBERS, for the discover FILTERS and nothing else.
   *
   * The filters compare a row's metric against a bound the user typed, which is
   * a `number`; the compact texts above are lossy (`4.8K`) and cannot be
   * compared. So each text gets a numeric twin derived from the SAME wire
   * integer with the SAME atto-then-micro precedence — one source, so a row can
   * never filter as one figure and render as another.
   *
   * `null` — never `0` — exactly when its text is `null`. That is what keeps a
   * stock-quoted market (`quote_not_native`, no USD at all) out of the filter
   * as an UNKNOWN rather than as a token worth nothing.
   */
  marketCapUsdValue: number | null;
  volumeUsdValue: number | null;
  priceUsdText: string | null;
  /**
   * THE AUDIT TRAIL FOR EVERY USD FIGURE ON THIS ROW: which pair the rate came
   * from, what the rate was, and when the oracle published it.
   *
   * The wire has always carried all three (`nativeUsdNano`,
   * `nativeUsdPublishTimeSec`, `nativeUsdPair`) and the terminal parsed none
   * of them, so a dollar figure arrived with no way for a user to see what it
   * was computed from. A USD number whose basis cannot be inspected is one the
   * reader has to take on faith — and a rate published four minutes ago is a
   * different claim from one published four hours ago.
   *
   * `null` when the wire served no rate, which is exactly when there is no USD
   * figure to qualify.
   */
  nativeUsdBasisText: string | null;
  /** Why there is no dollar figure, in the words a user reads. `null` when
   *  there IS one. */
  usdUnavailableText: string | null;
  /** Why there is no market data at all (`price_underivable`), or `null`. */
  marketDataUnavailableText: string | null;
  /**
   * WHY the `*Native` figures above are absent on a market whose money leg is
   * not the chain's own coin — `null` when they are present.
   *
   * `marketCapNative`, `volumeNative` and `reserveNative` are counts of QUOTE
   * base units, and `formatNative` renders base units at 18. That is right for
   * ETH/BNB and wrong for a Pons v2 launch quoted in a Robinhood stock token,
   * where the words count NVDA base units — the backend source says so in as many
   * words. A rescale is not available to fix it: the wire carries the quote
   * token's ADDRESS and no decimals for it anywhere. So the figures are
   * omitted with this reason rather than rendered at a scale nobody verified,
   * which is the same answer `usdUnavailableText` already gives for the same
   * cause one unit over.
   */
  quoteUnitsUnavailableText: string | null;

  /* --- the SIGNAL half: score, security shares, creator tally ------------ *
   *
   * All three arrive on the wire today and every one of them was measured,
   * shipped and then discarded here. They are restored under the SAME rule as
   * every figure above: a value is `null` only when the producer omitted it,
   * and each carries its own reason text so a refusal renders as a refusal
   * rather than as a blank or a zero. */

  /**
   * MOMENTUM SCORE on the 0–10 scale the card renders, or `null`.
   *
   * Derived from `scoreTenths` (integer) rather than parsing the wire's
   * display string: the string is what the producer would render, and two
   * parses of one figure is the drift this file exists to stop. `null` is
   * UNSCORED — never `0`, which is the worst possible reading and would libel
   * a token nobody scored.
   */
  score: number | null;
  /**
   * WHY there is no score, in the words a user reads. `null` when there IS
   * one.
   *
   * This is the field that makes the refusal legible. the backend source declines to
   * score a stock-quoted market because its volume leg counts NVDA base units
   * and the native formula would be wrong by the whole NVDA/ETH rate — a
   * deliberate refusal, and rendering it as an unexplained dash presents a
   * decision as an outage.
   */
  scoreUnavailableText: string | null;

  /**
   * DEV / SNIPER / BUNDLER share of supply as whole-percent floats, or `null`.
   *
   * `null` MEANS UNKNOWN AND MUST NEVER BECOME `0`. A `0% dev` printed about a
   * token whose classes were never anchored is a fabricated all-clear on a
   * security field — the exact defect the producer fixed by omitting these
   * keys, and re-introducing it at the renderer would undo that.
   *
   * There is no `insiderHoldingsPct` twin: the EVM signal fold publishes no
   * insider class, and inventing one from the three that exist would be a
   * measurement nobody made.
   */
  devHoldingsPct: number | null;
  sniperHoldingsPct: number | null;
  bundlerHoldingsPct: number | null;
  /** Top-holder concentration as a whole-percent float, or `null`. Fails
   *  INDEPENDENTLY of the three shares above — an unanchored token still has
   *  one, which is why it is not gated on `holdingsUnavailableText`. */
  topHolderPct: number | null;
  /**
   * WHY the three shares are absent, in the words a user reads — `null` when
   * they are present. Distinguishes the reason that never resolves
   * (`unanchored`, `holders_partial`) from the one that resolves the moment a
   * call answers (`supply_unknown`), because telling an operator to wait for
   * something that is not coming is its own defect.
   */
  holdingsUnavailableText: string | null;
  /** Appended qualifiers on the shares when they are present: the dev also
   *  counts in the sniper bucket, and/or the wallet cap made them lower
   *  bounds. `null` when neither applies. */
  holdingsQualifierText: string | null;

  /**
   * THE CREATOR TALLY behind the crown badge, or `null` when the fold has no
   * record. Never `{created: 0, migrated: 0}` — the producer refuses to serve
   * that shape precisely so no consumer can render an unestablished record as
   * a clean first launch.
   */
  creatorStats: { created: number; migrated: number } | null;
  /** Why there is no creator tally, in the words a user reads. `null` when
   *  there is one, and also `null` when the wire claimed nothing at all. */
  creatorRecordUnavailableText: string | null;

  /**
   * WHEN this token graduated, in ms, or `null` — the Graduated lane's sort
   * key. `null` for a token hydrated already-graduated, and the lane sorts
   * that as unknown rather than as 1970.
   */
  graduatedAtMs: number | null;
}

/**
 * Human phrasing for the wire's `usdUnavailableReason`.
 *
 * The stock-quoted case is called out by name rather than folded into a
 * generic "no rate": a Pons token quoted in NVDA has a perfectly good price,
 * it is simply not a price in ETH, and telling the user "USD unavailable" with
 * no reason invites them to read the native figure as dollars.
 */
export function usdUnavailableText(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'quote_not_native':
      return (
        'No dollar figure: this market is priced in another token, not in the ' +
        'chain’s native asset, so a native/USD rate cannot value it.'
      );
    case 'native_usd_absent_or_stale':
      return (
        'No dollar figure: the native-asset USD rate is missing or too old to ' +
        'use. The native amounts beside it are unaffected.'
      );
    default:
      return 'No dollar figure is available for this token.';
  }
}

/**
 * Human phrasing for one entry of the wire's `identityAbsent` map.
 *
 * The producer records WHY each identity field is missing — `reverted`,
 * `unimplemented`, `undecodable`, `empty`, `unavailable` — and the terminal
 * threw the whole map away, so every unresolved name, symbol and scale
 * rendered as an unexplained blank.
 *
 * The distinction earns its keep on `decimals` in particular. `unavailable`
 * means nobody has called the contract yet and a reload may well fix it;
 * `reverted` and `unimplemented` mean the contract itself will never answer,
 * so the scale is permanently unknown and no amount of waiting changes it.
 * The order panel refuses to size a sell in either case, but a user deciding
 * whether to wait or give up needs to know which one they are looking at.
 *
 * An UNRECOGNISED reason is quoted verbatim rather than dropped: a future
 * producer adding a sixth code should show the user something true and
 * slightly awkward, not silently nothing.
 */
export function identityAbsentReasonText(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'reverted':
      return 'the contract call reverted';
    case 'unimplemented':
      return 'the contract does not implement it';
    case 'undecodable':
      return 'the contract answered with something we could not decode';
    case 'empty':
      return 'the contract returned an empty value';
    case 'unavailable':
      return 'it has not been read yet';
    default:
      return `the indexer reported “${reason}”`;
  }
}

/** Field order for the summary. Fixed, so the sentence is stable to diff. */
const IDENTITY_FIELDS: readonly string[] = ['name', 'symbol', 'decimals'];

/**
 * Every absent identity field and its reason, as one renderable sentence.
 *
 * `null` when nothing is absent — a disclosure that fires when there is
 * nothing to disclose trains the reader to skip it, which costs exactly the
 * rows where it matters.
 */
export function identityAbsentSummaryText(
  absent: Record<string, string> | undefined,
): string | null {
  if (absent === undefined) return null;
  const parts: string[] = [];
  // The known fields first, in a fixed order, then anything else the producer
  // reported — so a new field surfaces instead of being filtered out here.
  const keys = [
    ...IDENTITY_FIELDS.filter((field) => Object.hasOwn(absent, field)),
    ...Object.keys(absent).filter((field) => !IDENTITY_FIELDS.includes(field)),
  ];
  for (const field of keys) {
    const text = identityAbsentReasonText(absent[field]);
    if (text !== null) parts.push(`${field} (${text})`);
  }
  if (parts.length === 0) return null;
  return `The indexer could not read this token's ${parts.join(', ')}.`;
}

/**
 * The native/USD rate a row's dollar figures were computed from, as a line fit
 * to render beside them.
 *
 * `null` when no rate was served — there is then no USD figure either, and
 * `usdUnavailableText` is the thing to show instead.
 *
 * The publish time is rendered as an absolute UTC instant rather than "4m ago"
 * on purpose: this string is built once per card from wire data, so a relative
 * age would be frozen at parse time and grow silently wrong on a page left
 * open. `nativeUsdPublishTimeSec` is SECONDS; treating it as milliseconds puts
 * the rate in 1970, which is the one failure mode that would make the
 * disclosure worse than nothing.
 */
export function nativeUsdBasisText(
  card: Pick<EvmDiscoverCard, 'nativeUsdNano' | 'nativeUsdPublishTimeSec' | 'nativeUsdPair'>,
): string | null {
  const rate = formatNanoUsdRate(card.nativeUsdNano);
  if (rate === null) return null;
  const pair =
    typeof card.nativeUsdPair === 'string' && card.nativeUsdPair.length > 0
      ? card.nativeUsdPair
      : null;
  const seconds = card.nativeUsdPublishTimeSec;
  /* An unusable timestamp drops the CLAUSE, never the whole disclosure: the
     rate itself is still the basis and is still worth showing. `> 0` because
     the wire omits a time it does not have rather than sending the epoch. */
  const publishedAt =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toISOString().replace('.000', '')
      : null;
  const source = pair === null ? 'the native-asset USD rate' : pair;
  return publishedAt === null
    ? `USD figures use ${source} at ${rate} per native token.`
    : `USD figures use ${source} at ${rate} per native token, published ${publishedAt}.`;
}

/**
 * THE ONE price-resolution chain, shared by the discover card and the trade
 * page.
 *
 * It is shared because the two had DIFFERENT chains and that was the bug: the
 * card tried live -> wire -> curve, the trade page tried live -> curve and
 * skipped the wire's own price entirely. A graduated token therefore showed no
 * price at all on its trade page — its curve reserves are absent by design
 * (the curve stopped being the market) and the tape can be empty on first
 * paint, while `priceNativeNum`/`priceNativeDen` sat parsed and unread in the
 * header response. Two derivations of one truth is exactly the drift the
 * chain-binding work exists to stop, so there is now one.
 *
 * Ordered by IMMEDIACY, not by confidence: a trade we watched land is newer
 * than anything the snapshot carried, and the snapshot's price is in turn newer
 * than a ratio we derived ourselves from reserves.
 *
 * Every input is `string | null | undefined` and every absent one is skipped —
 * `undefined` and `null` are two spellings of the same absence, and a `!==
 * null` test on a card that predates a field would attribute a curve-derived
 * price to the indexer. No branch here can produce a "0": the formatters
 * upstream return `null` rather than flooring, and a price of zero would claim
 * the token is free.
 */
export function resolvePriceDisplay(input: {
  livePriceText?: string | null;
  wirePriceText?: string | null;
  curvePriceText?: string | null;
  priceBasisText?: string | null;
  reserveBasisText?: string | null;
}): { text: string | null; sourceText: string | null } {
  const live = input.livePriceText ?? null;
  const wire = input.wirePriceText ?? null;
  const curve = input.curvePriceText ?? null;
  const text = live ?? wire ?? curve;
  if (text === null) return { text: null, sourceText: null };
  const sourceText =
    live !== null
      ? 'last observed trade'
      : wire !== null
        ? (input.priceBasisText ?? 'the indexer’s derived price')
        : (input.reserveBasisText ?? 'curve reserves');
  return { text, sourceText };
}

/** Human phrasing for the wire's `priceBasis`. */
export function priceBasisText(basis: EvmDiscoverCard['priceBasis']): string | null {
  switch (basis) {
    case 'executed_trade':
      return 'last executed trade';
    case 'reserves':
      return 'pool reserves';
    case 'sqrt_price_x96':
      return 'the pool’s current tick';
    case 'four_meme_curve':
      return 'the launchpad bonding curve';
    default:
      return null;
  }
}

/**
 * Human phrasing for a reserve basis.
 *
 * A `switch` rather than a lookup object on purpose: an unrecognised basis
 * from a future wire version must fall to `null` (say nothing) instead of
 * resolving up a prototype chain or rendering a raw enum token at a user.
 */
export function reserveBasisText(basis: EvmDiscoverCard['reserveBasis']): string | null {
  switch (basis) {
    case 'curve':
      return 'from the launchpad bonding curve';
    case 'amm_pair':
      return 'from the AMM pair’s real balances';
    case 'pancake_v2':
      return 'from the launchpad-verified Pancake V2 pair’s real balances';
    case 'pancake_v3':
      return 'from the launchpad-verified Pancake V3 pool and on-chain quoter';
    case 'uniswap_v2':
      return 'from the launchpad-verified Uniswap V2 pairâ€™s real balances';
    case 'uniswap_v3':
      return 'from the launchpad-verified Uniswap V3 pool and on-chain quoter';
    case 'uniswap_v4':
      return 'from the launchpad-verified Uniswap V4 pool and on-chain quoter';
    case 'pancake_infinity_cl':
      return 'from the launchpad-verified Pancake Infinity pool and on-chain quoter';
    case 'flap_curve':
      return 'from the Flap launch portal curve';
    case 'concentrated_virtual':
      // Derived from a concentrated-liquidity position rather than measured.
      // In-range depth is not the book, so it is qualified loudly.
      return 'derived from in-range concentrated liquidity — not the full book';
    default:
      return null;
  }
}

/**
 * Adapt one wire card into the view shape.
 *
 * Every optional wire field becomes an explicit `null`, so a downstream
 * `??` cannot silently substitute a zero.
 */
/**
 * Resolve the row's depth status, tolerating a wire frame that predates the
 * field.
 *
 * The fallback is deliberately the CONSERVATIVE one in each direction:
 * reserves present means we measured something; reserves absent means we are
 * early, not that we are blind. Guessing `not_derivable_concentrated` from
 * absent reserves would mark every brand-new curve token permanently
 * unquotable, and guessing `measured` from absent reserves is the claim that
 * shipped 4,840 Robinhood trades as tradeable with no depth behind them.
 */
export function resolveDepthStatus(card: EvmDiscoverCard): DepthStatus {
  const wire = card.depthStatus;
  if (
    wire === 'awaiting_first_observation' ||
    wire === 'measured' ||
    wire === 'not_derivable_concentrated' ||
    wire === 'venue_not_indexed' ||
    wire === 'four_meme_v1_unsupported' ||
    wire === 'four_meme_v1_buy_only' ||
    wire === 'awaiting_external_pool' ||
    wire === 'crowd_auction_active' ||
    wire === 'onchain_quoter'
  ) {
    return wire;
  }
  return card.reserveNative !== undefined && card.reserveToken !== undefined
    ? 'measured'
    : 'awaiting_first_observation';
}

/**
 * Resolve what this row's amounts are denominated in.
 *
 * `quoteIsNative !== true` is the test, not `=== false`: a frame that omits
 * the flag is a frame that has not told us it is native, and the whole point
 * of the field is that silence must not be read as ETH.
 */
export function resolveQuote(card: EvmDiscoverCard, nativeSymbol: string): QuoteDenomination {
  const isNative = card.quoteIsNative === true;
  const kind =
    card.quoteAsset === 'native' ||
    card.quoteAsset === 'wrapped_native' ||
    card.quoteAsset === 'token'
      ? card.quoteAsset
      : 'unknown';
  return {
    kind,
    isNative,
    address: card.quoteToken ?? null,
    decimals: isInDomainScale(card.quoteDecimals) ? card.quoteDecimals : null,
    /* The unit label is the chain's own ticker ONLY when the amounts really
       are native. For a stock-quoted Pons launch we know the pair token's
       address but not its symbol (the wire carries no symbol for the quote
       leg), so the honest label is a shortened address rather than a
       confident "ETH" — and `null` when we know nothing at all, which stops
       every downstream render from printing a unit it cannot justify. */
    unitSymbol: isNative
      ? card.quoteSymbol ?? nativeSymbol
      : card.quoteSymbol
        ?? (card.quoteToken !== undefined ? shortenAddress(card.quoteToken) : null),
  };
}

/**
 * The ERC-20 scales this module will render at — the same domain
 * `sizing.ts::isSizeableScale` accepts, held here because the render path
 * reaches `10n ** BigInt(decimals)` and a negative exponent THROWS.
 */
function isInDomainScale(decimals: unknown): decimals is number {
  return (
    typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36
  );
}

/**
 * The scale four.meme's own price word is fixed-pointed at — `10^18`, pinned
 * live on BSC (an internal backend type).
 */
const CURVE_PRICE_WORD_DEN = '1000000000000000000';

/**
 * Human phrasing for the wire's `scoreUnavailableReason`.
 *
 * Every branch says what the refusal IS, because each one calls for a
 * different response: `no_trades_observed` resolves on the first trade,
 * `quote_not_native` never resolves for that market, and `partial_history`
 * resolves only if the fold ever backfills. Collapsing them into one "not
 * scored" is what made Solana's fabricated `5.0` floor look reasonable.
 *
 * An UNKNOWN reason still returns a sentence. A producer that grows a sixth
 * variant must not degrade this to a silent blank — the one direction that
 * cannot be recovered from by looking at the screen.
 */
export function scoreUnavailableText(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'no_trades_observed':
      return 'Not scored: no trade has been observed for this token yet, so there is no momentum to measure.';
    case 'partial_history':
      return 'Not scored: this token was first observed part-way through its life, so its buy ratio would be a ratio of an arbitrary slice rather than of the whole tape.';
    case 'quote_not_native':
      return 'Not scored: this market is priced in another token, not in the chain’s native asset. Its volume is a count of that token’s base units, and scoring it against a native formula would be wrong by the whole exchange rate.';
    case 'no_native_usd_rate':
      return 'Not scored: no fresh native/USD rate was available, so the volume term of the score could not be evaluated.';
    case 'volume_window_unmeasured':
      return 'Not scored: the 5-minute volume window was not fully observed, and a score missing its volume term is not comparable with any other token’s.';
    default:
      return 'Not scored: the indexer declined to score this token and gave a reason this terminal does not recognise.';
  }
}

/**
 * Human phrasing for the wire's `security.classesUnavailableReason`.
 *
 * The three cases must stay distinct on screen. `supply_unknown` resolves the
 * moment `totalSupply()` answers; `unanchored` and `holders_partial` do not
 * resolve at all — the first because anchoring after the fact would make the
 * classification run and be WRONG, the second because holders are on no tape
 * to rebuild from. Printing the first for the second tells a user to wait for
 * something that is not coming.
 */
export function holdingsUnavailableText(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'unanchored':
      return 'Dev, sniper and bundler shares are unknown: no creation event was decoded for this token, so there is no launch block to measure a first buy against. This does not improve with time.';
    case 'supply_unknown':
      return 'Dev, sniper and bundler shares are unknown: this token’s total supply has not resolved, and a percentage of an unknown denominator is not a percentage.';
    case 'holders_partial':
      return 'Dev, sniper and bundler shares are unknown: the holder ledger for this token is not authoritative, so an unseen wallet’s balance would read as zero and every share would understate.';
    default:
      return 'Dev, sniper and bundler shares are unknown, for a reason this terminal does not recognise. They are unmeasured, not zero.';
  }
}

/**
 * Human phrasing for the wire's `creatorRecordUnavailableReason`.
 *
 * `impossible_count` is a producer-side contradiction (more migrations than
 * launches) and is surfaced rather than swallowed: a tally that cannot be true
 * is evidence of a defect, and hiding it behind the same blank as "we have not
 * looked" is how it stays unfixed.
 */
export function creatorRecordUnavailableText(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'no_creator_known':
      return 'No launch history: this token’s creator could not be identified.';
    case 'lookup_failed':
      return 'No launch history: the creator tally could not be read. It is unknown, not zero.';
    case 'impossible_count':
      return 'No launch history: the creator tally the indexer returned was self-contradictory and was rejected rather than rendered.';
    default:
      return 'No launch history for this creator, for a reason this terminal does not recognise. It is unknown, not zero.';
  }
}

/** Basis points of supply as a whole-percent float, or `null`. */
function pctFromBps(bps: number | undefined): number | null {
  /* An absent share stays absent. A `?? 0` here is the fabricated all-clear
     the producer omits these keys to prevent, and it would land on the one
     row of the card where a wrong zero reads as a safety guarantee. */
  return typeof bps === 'number' && Number.isFinite(bps) && bps >= 0 ? bps / 100 : null;
}

/** Whole non-negative integer, or `null`. Counts only; never coerced. */
function wholeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The creator tally, or `null`.
 *
 * BOTH halves must be present and whole. A wire that sent one of the two is
 * malformed, and rendering `?/3` — or worse, `0/3` — invents the half it did
 * not receive on a badge whose entire job is to say how many of this dev's
 * launches survived.
 */
function creatorStatsFromWire(card: EvmDiscoverCard): { created: number; migrated: number } | null {
  const created = wholeCount(card.creatorCreated);
  const migrated = wholeCount(card.creatorMigrated);
  return created === null || migrated === null ? null : { created, migrated };
}

/**
 * Qualifiers that ride WITH the shares when they are present.
 *
 * `devSniped` matters because the dev and sniper buckets are deliberately NOT
 * disjoint (Axiom parity) — without it a reader sums two overlapping figures.
 * `classesTruncated` matters because the wallet cap makes every share a LOWER
 * bound, and a bounded observation presented as a measurement is the same
 * defect class as a structural zero.
 */
function holdingsQualifierText(security: EvmSecurityWire | undefined): string | null {
  if (security === undefined) return null;
  const parts: string[] = [];
  if (security.devSniped === true) {
    parts.push(
      'The creator bought in its own launch block, so it is counted in the sniper share as well as the dev share — the two overlap.',
    );
  }
  if (security.classesTruncated === true) {
    parts.push('The wallet cap was reached, so every share here is a lower bound.');
  }
  return parts.length === 0 ? null : parts.join(' ');
}

export function toCardView(card: EvmDiscoverCard): EvmCardView {
  const symbol = card.symbol ?? '';
  const name = card.name ?? '';
  const depthStatus = resolveDepthStatus(card);
  const quote = resolveQuote(card, nativeSymbolForChain(card.chain));
  /* A MEASURED scale when the wire carries one, the module assumption when it
     does not — and the flag says which, so a figure scaled by a guess is never
     silently indistinguishable from one scaled by a measurement.
     `Number.isInteger` rather than a truthiness check: `decimals: 0` is a real
     and legal ERC-20 scale (a whole-unit token), and `?? `-style handling
     would send it back to 18 and misprice by 10^18. */
  /* …and the scale must also be IN DOMAIN. `Number.isInteger` alone admits
     `-1`, which reaches `10n ** BigInt(-1)` inside `formatBigIntUnits` and
     THROWS `RangeError: Negative exponent is not allowed` — during render, so
     it takes the whole page down rather than one figure. It also admits
     `1000`, which renders a supply of 1,000,000 as "<0.0001" while
     `tokenDecimalsAssumed` says false, i.e. an absurd figure presented as
     MEASURED. Same domain `sizing.ts::isSizeableScale` already enforces; an
     out-of-domain wire value is a fault, not evidence for 18. */
  const wireDecimals = isInDomainScale(card.decimals) ? card.decimals : null;
  const tokenDecimals = wireDecimals ?? EVM_TOKEN_DECIMALS;
  /* THE GUARD ON EVERY `*Native` FIGURE BELOW. `formatNative` renders base
     units at 18 decimals, which is a statement about the chain's own coin —
     and `marketCapNative` / `volumeNative` / `reserveNative` are counts of
     QUOTE base units, not native wei, whenever the money leg is a token.
     Roughly half of live Pons v2 launches are quoted in Robinhood stock
     tokens; the backend source states the hazard outright ("this
     token's `volumeNative` is a count of NVDA base units").

     There is no rescale available: the wire carries `quoteToken` (an address)
     and no decimals for it. Rendering the words at 18 anyway would misstate a
     market cap by the whole NVDA/ETH rate AND by whatever the quote token's
     real scale is. Omission with a named reason is the only honest branch —
     the same one `usdUnavailableText` already takes for `quote_not_native`. */
  const quoteIsNative = quote.isNative;
  const quoteDecimals = quote.decimals ?? null;
  const priceQuoteNum = card.priceQuoteNum ?? (quoteIsNative ? card.priceNativeNum : undefined);
  const priceQuoteDen = card.priceQuoteDen ?? (quoteIsNative ? card.priceNativeDen : undefined);
  const reserveQuote = card.reserveQuoteBaseUnits
    ?? (quoteIsNative ? card.reserveNative : undefined);
  const marketCapQuote = card.marketCapQuoteBaseUnits
    ?? (quoteIsNative ? card.marketCapNative : undefined);
  /* AND THE SAME GUARD ON EVERY PRICE. A price is the case that looks like it
     survives — "0.0004 per NVDA" reads as an honest relabelling of "0.0004
     ETH", so the tempting fix here is to swap the unit and keep the number.
     It is not. Both price words are a ratio of QUOTE base units to TOKEN base
     units, and `formatPrice` turns that into a per-whole-token figure by
     scaling with `10^(tokenDecimals - EVM_NATIVE_DECIMALS)` — where the `18`
     it subtracts is the QUOTE's scale, not the chain's. On a stock-quoted
     market that 18 is a guess about a token whose decimals the wire never
     sends, so the rendered price is wrong by `10^(18 - quoteDecimals)`: a
     6-decimal quote misprices by a factor of a trillion. Labelling that
     number "per NVDA" would make a fabricated figure look verified, which is
     strictly worse than the em dash. The unit is recoverable; the SCALE is
     not, and a price needs both. */
  return {
    depthStatus,
    quote,
    imageUrl: typeof card.imageUrl === 'string' && card.imageUrl.length > 0 ? card.imageUrl : null,
    tokenDecimals,
    tokenDecimalsAssumed: wireDecimals === null,
    measuredTokenDecimals: wireDecimals,
    tokenDecimalsAbsentText: identityAbsentReasonText(card.identityAbsent?.decimals),
    identityAbsentSummary: identityAbsentSummaryText(card.identityAbsent),
    totalSupplyText: formatTokenCompact(card.totalSupply, tokenDecimals),
    wirePriceText: quoteDecimals === null
      ? null
      : formatQuotePrice(priceQuoteNum, priceQuoteDen, 6, tokenDecimals, quoteDecimals),
    priceBasisText: priceBasisText(card.priceBasis),
    marketCapNativeText: quoteDecimals === null
      ? null
      : formatUnits(marketCapQuote, quoteDecimals, 4),
    /* USD passes through the BigInt micro/atto formatters or it is absent.
       There is deliberately no `?? nativeTimesSomeRate` branch anywhere in
       this file: the rate's absence is the thing being reported.

       ATTO FIRST, micro as the fallback. The wire OMITS the micro twin
       precisely where micro would floor a real figure to "0"
       (the backend source), so reading micro alone renders
       "unknown" for exactly the sub-$0.000001 caps and first-fill volume
       windows the wire went out of its way to preserve. Preferring the more
       precise unit is the same rule as absent-is-not-zero, one unit down. */
    marketCapUsdText:
      formatAttoUsdCompact(card.marketCapUsdAtto) ?? formatMicroUsdCompact(card.marketCapUsdMicro),
    volumeUsdText:
      formatAttoUsdCompact(card.volumeUsdAtto) ?? formatMicroUsdCompact(card.volumeUsdMicro),
    /* SAME inputs, SAME precedence, one step later — see the field docs. The
       only float on this surface, and it exists so a filter bound has something
       to compare against. */
    marketCapUsdValue:
      usdScaledToNumber(card.marketCapUsdAtto, USD_ATTO_DECIMALS) ??
      usdScaledToNumber(card.marketCapUsdMicro, USD_MICRO_DECIMALS),
    volumeUsdValue:
      usdScaledToNumber(card.volumeUsdAtto, USD_ATTO_DECIMALS) ??
      usdScaledToNumber(card.volumeUsdMicro, USD_MICRO_DECIMALS),
    priceUsdText: formatAttoUsdPrice(card.priceUsdAtto),
    nativeUsdBasisText: nativeUsdBasisText(card),
    usdUnavailableText: usdUnavailableText(card.usdUnavailableReason),
    marketDataUnavailableText:
      card.marketDataUnavailableReason === 'price_underivable'
        ? 'No price could be derived for this token, so its market figures are unknown.'
        : (card.marketDataUnavailableReason ?? null) === null
          ? null
          : 'Market data is unavailable for this token.',
    id: evmCardKey(card),
    // Fall back to a shortened address rather than an empty label: an
    // unnamed token is real (we saw it at the cursor before its create),
    // and a blank row is unclickable-looking.
    ticker: symbol.length > 0 ? symbol : shortenAddress(card.address),
    name: name.length > 0 ? name : shortenAddress(card.address),
    handle: '',
    creator: card.creator,
    graduated: card.stage === 'graduated',
    tradeable: card.tradeable,
    buyable: card.buyable ?? card.tradeable,
    sellable: card.sellable ?? card.tradeable,
    stage: card.stage,
    chain: card.chain,
    address: card.address,
    href: evmTradeHref(card),
    // ABSENT stays null. `?? 0` here would be the structurally-zero bug.
    tradeCount: card.tradeCount ?? null,
    buyCount: card.buyCount ?? null,
    sellCount: card.sellCount ?? null,
    volumeNativeText: quoteIsNative ? formatNative(card.volumeNative) : null,
    reserveNativeText: quoteDecimals === null
      ? null
      : formatUnits(reserveQuote, quoteDecimals, 4),
    reserveTokenText: formatTokenCompact(card.reserveToken, tokenDecimals),
    /* THE CURVE'S PRICE IS THE VENUE'S OWN WORD, NEVER `funds / offers`.
       On a `curve` basis those two are not constant-product reserves —
       `reserveNative` is the curve's CUMULATIVE quote raised and
       `reserveToken` its REMAINING offers. Their ratio reads ~480x low
       against the venue's marginal price on the same live BSC event
       (the backend source: 1.2e-11 vs 5.7e-9), and
       the producer forbids the derivation in as many words
       (the backend source: "Do not derive a price from
       `reserve_native / reserve_token` on a `Curve` basis. Use
       `curve_price_word`."). The wire has published `curvePriceWord` for
       exactly this and nothing here read it.

       An `amm_pair` basis IS real pair balances, so the ratio is a price
       there. `concentrated_virtual` is neither, and gets nothing. */
    curvePriceText: quoteDecimals === null
      ? null
      : card.reserveBasis === 'curve'
        ? formatQuotePrice(
            card.curvePriceWord,
            CURVE_PRICE_WORD_DEN,
            6,
            tokenDecimals,
            quoteDecimals,
          )
        : card.reserveBasis === 'amm_pair'
            || card.reserveBasis === 'pancake_v2'
            || card.reserveBasis === 'uniswap_v2'
          ? formatQuoteReservePrice(
              reserveQuote,
              card.reserveToken,
              tokenDecimals,
              quoteDecimals,
            )
          : // A frame that predates `reserveBasis` cannot be priced from these
            // two words without knowing which of the two meanings they carry.
            null,
    historyComplete: card.historyComplete,
    tradeBlockedReason:
      card.tradeBlockedReason ?? (card.stage === 'migrating' ? 'migrating' : null),
    buyBlockedReason:
      card.buyBlockedReason !== undefined
        ? card.buyBlockedReason
        : card.stage === 'migrating' ? 'migrating' : card.tradeBlockedReason ?? null,
    sellBlockedReason:
      card.sellBlockedReason !== undefined
        ? card.sellBlockedReason
        : card.stage === 'migrating' ? 'migrating' : card.tradeBlockedReason ?? null,
    reserveBasisText: reserveBasisText(card.reserveBasis),
    marketVenue: card.marketVenue ?? null,
    launchpad: card.launchpad ?? null,
    launchVariant: card.launchVariant ?? null,
    launchProfile: card.launchProfile ?? null,
    quoteUnitsUnavailableText: quoteDecimals !== null
      ? null
      : `This market’s money leg is ${
          quote.unitSymbol ?? 'a token this indexer could not name'
        }, not ${nativeSymbolForChain(card.chain)}. Its reserve and market cap are counts of that token’s base units and its price is a ratio against them, but the indexer has not measured its decimals — so there is no safe scale at which to show them. They remain unavailable rather than being rendered as ${nativeSymbolForChain(card.chain)}. The launched-token side, trade sizes, and counts remain measured in their own units.`,

    /* THE SCORE, from TENTHS. `Number.isInteger` and not a truthiness check:
       `scoreTenths: 0` is a legitimate score of 0.0 — a token whose every
       observed trade was a sell — and it is a MEASUREMENT, entirely unlike the
       absence one field over. Coercing it away would hide the worst reading on
       the card behind the same dash that means "we did not look". */
    score:
      typeof card.scoreTenths === 'number' && Number.isInteger(card.scoreTenths)
        ? card.scoreTenths / 10
        : null,
    scoreUnavailableText: scoreUnavailableText(card.scoreUnavailableReason),

    /* THE SECURITY SHARES. Each is independently absent, and `0` here is a
       measurement (the dev really did exit) rather than an absence — the same
       distinction the score makes one field up, on the row where getting it
       backwards manufactures a safety claim. */
    devHoldingsPct: pctFromBps(card.security?.devBps),
    sniperHoldingsPct: pctFromBps(card.security?.sniperBps),
    bundlerHoldingsPct: pctFromBps(card.security?.bundlerBps),
    topHolderPct: pctFromBps(card.security?.topHolderBps),
    holdingsUnavailableText: holdingsUnavailableText(card.security?.classesUnavailableReason),
    holdingsQualifierText: holdingsQualifierText(card.security),

    creatorStats: creatorStatsFromWire(card),
    creatorRecordUnavailableText: creatorRecordUnavailableText(card.creatorRecordUnavailableReason),

    /* SECONDS on the wire, and the wire OMITS rather than zeroes — the `> 0`
       guard is for a corrupted or pre-contract frame and degrades to ABSENT,
       never to the epoch. Same rule `firstSeenMsFromWire` applies to the
       admission stamp, for the same reason: 1970 is a sort position, and an
       unknown graduation must not be given one. */
    graduatedAtMs:
      typeof card.graduatedAtSec === 'number' &&
      Number.isFinite(card.graduatedAtSec) &&
      card.graduatedAtSec > 0
        ? card.graduatedAtSec * 1000
        : null,
  };
}

function shortenAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

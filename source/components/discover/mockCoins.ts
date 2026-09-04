import type { ChainBinding } from './chainBinding';

import type {
  EvmLaunchpad,
  EvmLaunchProfile,
  EvmLaunchVariant,
} from '@/lib/evm/discoverAdapter';

export type Platform = 'x' | 'yt' | 'cb';

/**
 * Canonical "mode" the launching contract is configured in. The four
 * modes are mutually exclusive at the pump.fun smart-contract layer
 * — a token is configured for AT MOST ONE of these. The card surfaces
 * the active mode as a single icon in `MetaRow`.
 */
export type CoinMode = 'mayhem' | 'agent' | 'cashback' | 'charity';

/**
 * @deprecated Legacy multi-kind tag set. The mode portion has moved
 * to `MockCoin.mode` (mutex single value), and the `'github'` member
 * is now detected from `links.website` URL patterns in MetaRow's
 * secondary-link slot. Kept on the type for one transition release
 * so cached payloads from the previous version still validate; new
 * code should read `MockCoin.mode` and `MockCoin.links` instead.
 */
export type CoinKind = 'mayhem' | 'agent' | 'cashback' | 'charity' | 'github';

export interface CoinLinks {
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
}

/** One creator-fee shareholder (pfee sharing_config entry). `bps` is
 *  basis points of the creator-fee stream (10000 = 100%). */
export interface FeeShareRecipient {
  pubkey: string;
  bps: number;
}

export interface MockCoin {
  /** Stable identifier across renders. Live mints use the mint pubkey;
   *  static mocks fall back to the ticker. */
  id?: string;
  creator?: string;
  ticker: string;
  name: string;
  handle: string;
  /**
   * Token artwork. OPTIONAL because it is genuinely unknown for some rows —
   * a chain whose indexer serves no image URL has no artwork to fetch, and
   * `useResolvedTokenImage` already resolves absence to
   * `TOKEN_IMAGE_PLACEHOLDER` (a visibly synthetic mark), which is the
   * deliberate unknown state rather than a broken `<img>` or a
   * mis-attributed logo. Every Solana producer sets this, so nothing about
   * the Solana render changes.
   */
  imageUrl?: string;
  imageFallbackUrl?: string | null;
  /**
   * Higher-resolution artwork for the hover-zoom preview only. The
   * `imageUrl` above is intentionally a small thumbnail (fast list
   * render); when a token has a larger CDN/source rendition we point
   * the ~192px preview at it so enlarging never upscales a thumbnail.
   * Absent = the preview reuses `imageUrl`.
   */
  imagePreviewUrl?: string | null;
  platforms: Platform[];
  ageLabel: string;
  ageMs?: number;
  createdAtMs?: number | null;
  points: number;
  views: string;
  /** Display volume string: trailing-24h USD volume (falls back to the 5m
   *  window while the backend's 24h seed is pending).
   *
   *  OPTIONAL: a USD figure requires a USD rate for the chain's asset, and
   *  where no rate is published there is no honest dollar number to print.
   *  Absent renders the deliberate unknown; `volumeNativeText` below carries
   *  the figure we DO have, with its unit. Never substitute `$0` — that reads
   *  as "nothing traded", which is a different and false claim. */
  volume?: string;
  /**
   * Display market-cap string. OPTIONAL for the same reason as `volume`, plus
   * one more: market cap is price x supply, and where depth is not derivable
   * (a concentrated pool whose in-range liquidity is not the book) there is no
   * price to multiply. "$0 market cap" reads as *this token is dead*; unknown
   * must read as *unknown*.
   */
  marketCap?: string;
  /**
   * The figure denominated in the CHAIN'S OWN asset, pre-formatted, with
   * `nativeUnitSymbol` as its label. This is what a surface renders when no
   * USD rate exists — a real measurement in a stated unit beats a fabricated
   * dollar figure, and beats an em dash where we actually know the number.
   */
  volumeNativeText?: string | null;
  /**
   * MARKET CAP in the chain's own asset, pre-formatted, sharing
   * `nativeUnitSymbol` as its label. The exact counterpart of
   * `volumeNativeText`, and it was the missing one: the volume slot has always
   * fallen back to its native figure while the market-cap slot rendered
   * `unknown` even when a real BNB cap was in hand — the USD oracle going
   * stale erased a measurement we were holding.
   */
  marketCapNativeText?: string | null;
  /** Unit for `volumeNativeText` / `marketCapNativeText` (`BNB`, `ETH`). Never
   *  assumed — see `chainBinding.quote`, which is where a non-native quote is
   *  disclosed. */
  nativeUnitSymbol?: string | null;
  /**
   * What the row's USD figures were computed from: the oracle pair, its rate,
   * and its publish time. Rendered as the title on the USD slots so a dollar
   * figure's basis is inspectable rather than taken on faith. `null`/absent
   * whenever there is no USD figure to qualify.
   */
  usdBasisText?: string | null;
  /** Pre-formatted last/implied price with `nativeUnitSymbol` as its unit. */
  priceText?: string | null;
  /** Where `priceText` came from, fit to render ("last trade", "curve reserves"). */
  priceSourceText?: string | null;
  /** Raw USD market cap from live backend, used for sorting live sections. */
  marketCapUsd?: number | null;
  /** Raw USD 5m volume from live backend, used for client-side row filters
   *  and scoring (the `volume` string above is display-only / lossy). */
  volumeUsd?: number | null;
  /** Raw USD trailing-24h volume from live backend; null while the
   *  backend's 24h window awaits its cold seed. */
  volume24hUsd?: number | null;
  /** Raw bonding-curve reserves from ingestion. String-encoded to preserve
   *  values above JS's safe integer range. */
  vsr?: string | null;
  vtr?: string | null;
  realSolLamports?: string | null;
  realTokenBaseUnits?: string | null;
  totalSupplyBaseUnits?: string | null;
  /** Derived real SOL reserve/progress helper for filters/future display. */
  realSol?: number | null;
  bondingProgressPct?: number | null;
  /**
   * `bondingProgressPct` quantized into 8 octants (0-8). Drives the
   * graduation border on the card. Quantizing means the value only
   * changes when progress crosses a 12.5% boundary, so the border
   * (which reads ONLY this field) never jitters per tick and adds no
   * re-renders beyond the market-cap ticks the card already does.
   * `null` = reserves not yet known (render the faint track only).
   */
  bondingProgressBucket?: number | null;
  /** Pair quote mint (base58); absent/null = SOL pair, USDC mint = USDC pair. */
  quoteMint?: string | null;
  /** True after pump.fun migration/CompleteEvent. */
  graduated?: boolean;
  /** Bond/migration completion timestamp in ms, when available. */
  graduatedAtMs?: number | null;
  /** Last live trade timestamp in ms, when available. */
  lastTradeAtMs?: number | null;
  /** Holder-metrics row (% of total supply, 0-100). Null/absent until
   *  the backend hydrates the mint — the row renders an em dash. */
  devHoldingsPct?: number | null;
  /** Slot-0 buyers' current holdings (creator excluded). */
  sniperHoldingsPct?: number | null;
  /** Slot +1/+2 buyers' current holdings. */
  bundlerHoldingsPct?: number | null;
  /** Never-bought holders (transferred-in supply). */
  insiderHoldingsPct?: number | null;
  /** Live viewers of this token's trade page (presence). Absent/null =
   *  unknown or zero — the card hides the chip. */
  viewers?: number | null;
  /**
   * WHY the four percentages above are absent, as a sentence to render — and
   * the field that keeps their absence from reading as an all-clear.
   *
   * A `—` in the holdings row is ambiguous between "nobody has hydrated this
   * mint yet" and "this token was never anchored, so no share of it can be
   * measured at all". The second is a permanent property of the token and is
   * the thing a user is looking at that row to learn. Absent on Solana rows,
   * which have only the first case.
   */
  holdingsUnavailableReason?: string;
  /** Qualifiers that ride WITH present shares: overlapping buckets, or a
   *  wallet cap that makes them lower bounds. Absent when neither applies. */
  holdingsQualifier?: string;
  /**
   * The composite 0-10 signal rendered as the big number on the card.
   * OPTIONAL: on a Solana row it is always computed; on a chain-bound row the
   * producer REFUSES it whenever its inputs would not support it, and a `0`
   * would be the WORST possible score rather than "not scored" — the two look
   * identical on screen and mean opposite things.
   */
  score?: number;
  /**
   * WHY there is no score, as a sentence to render. Absent when there IS one.
   *
   * The refusal is a decision, not an outage: `the ingestion service` declines to score
   * a stock-quoted market because scoring its NVDA-denominated volume against
   * a native formula would be wrong by the whole exchange rate. Rendering that
   * as an unexplained dash presents a deliberate refusal as a gap.
   */
  scoreUnavailableReason?: string;
  /**
   * The creator's launch tally, when the ROW carries it.
   *
   * Solana rows do not: their crown badge resolves the tally from a
   * `useCreatorCoinStats` query against the Solana creator endpoint. A
   * chain-bound row's tally rides on the card itself and must be used from
   * there — the Solana endpoint knows nothing about a `0x` address, so
   * querying it would spend a request to learn nothing and then render the
   * nothing.
   */
  creatorStats?: { created: number; migrated: number };
  followers: string;
  /**
   * Trade count. OPTIONAL because a token admitted mid-life has a PARTIAL
   * history: its indexer never saw the earlier trades, so any count is a
   * lower bound, and `0` would assert "never traded". See
   * `countsArePartial` — a partial count must not render as authoritative.
   */
  txns?: number;
  /** Buy/sell split, when the source distinguishes them. */
  buyTxns?: number | null;
  sellTxns?: number | null;
  /**
   * TRUE when this row's counts (`txns`, `buyTxns`, `sellTxns`,
   * `holderCount`) are known to be lower bounds because history before
   * first-observation was never indexed. The render must qualify them
   * rather than present them as measurements.
   */
  countsArePartial?: boolean;
  /** Dev-buy amount in SOL, when the backend rich decode found it. */
  devBuySol?: number | null;
  /** Feature flags rendered in the compact meta row as colored icons. */
  holderCount?: number;
  hasWebsite?: boolean;
  hasLink?: boolean;
  hasAgent?: boolean;
  /** Enriched metadata links. When present, card link logos open these directly. */
  links?: CoinLinks;
  /**
   * Active mutex mode (see `CoinMode`). Renders as a single tinted
   * icon in `MetaRow`'s mode slot. Absent = no mode badge.
   */
  mode?: CoinMode;
  /**
   * @deprecated Use `mode` for mutex modes and detect github via
   * `links.website` URL patterns. Still read by older cached
   * payloads; the live-data adapter populates both for one release.
   */
  kinds?: CoinKind[];
  /**
   * Creator fee-sharing config (pfee program), streamed live from
   * ingestion. `feeShareLocked === true` renders the pie-chart badge
   * in MetaRow with the fee-authority hover card. Absent/null = no
   * sharing config observed for this mint.
   */
  feeShareRecipients?: FeeShareRecipient[] | null;
  feeShareLocked?: boolean | null;
  feeShareAuthority?: string | null;
  /**
   * Chain provenance for a NON-Solana row. Absent on every Solana row, which
   * is why this is the only field the Solana producers had to learn about:
   * `undefined` means exactly what it meant before this field existed.
   *
   * See `./chainBinding.ts` for what rides here and why each piece cannot be
   * re-derived at the render site.
   */
  chainBinding?: ChainBinding;
  /** Exact lifecycle-stable EVM launch identity; absent on Solana. */
  evmLaunchpad?: EvmLaunchpad;
  evmLaunchVariant?: EvmLaunchVariant;
  evmLaunchProfile?: EvmLaunchProfile | null;
}

/* Fixtures request a 256px square so the hover-zoom preview (~192px)
   stays crisp; the 68px card thumbnail downscales it cleanly. Live
   data overrides this with real thumb + high-res preview URLs. */
const img = (seed: string) => `https://picsum.photos/seed/${seed}/256/256`;

export interface AlphaCoin {
  ticker: string;
  name: string;
  handle: string;
  imageUrl: string;
  ageLabel: string;
  marketCap: string;
  volume: string;
  holders: string;
  description: string;
  /** 0-10 flame score, same scale as MockCoin.score */
  score: number;
  followers: string;
  txns: number;
  /** Numeric USD market cap when the call was posted — the immutable
   *  baseline for the since-call % readout. Null when unknown. */
  callMarketCapUsd?: number | null;
  /** Live MC performance since the call, in percent (+34 = +34%).
   *  Null until the live stats poll lands (see useAlphaLiveStats). */
  sinceCallPct?: number | null;
  /** Live venue markers from the stats poll — routes quickbuy correctly
   *  (never bonding-curve once graduated; USDC spend on USDC pairs). */
  graduated?: boolean;
  quoteMint?: string | null;
  /** Social links from the live token metadata (stats poll) — drives the
   *  same MetaRow twitter/telegram/website icons the other rows show. */
  links?: CoinLinks;
  /** Every distinct caller of this mint, EARLIEST first. */
  callers?: string[];
  /** THIS card's call id — the edit pencil targets it. */
  callId?: string;
  /** True when the VIEWER posted this card's call — shows the pencil. */
  isMine?: boolean;
  /** True when this card's thesis was rewritten — "edited" marker. */
  edited?: boolean;
  /** 1-based position of this card's call among the mint's calls
   *  (oldest = 1). Every call renders its OWN card; cards after the
   *  first show a `#N` marker whose hover names the first caller. */
  callSequence?: number;
  /** The FIRST (earliest) call's context — set only on later calls
   *  (callSequence > 1) so the marker tooltip can attribute it. */
  firstCall?: {
    caller: string;
    ageLabel: string;
    marketCap: string | null;
  } | null;
}

// The alpha lane renders LIVE coin calls only (lib/api/alpha-calls.ts); its
// former mock fixtures are gone so fabricated theses can never sit next to
// real calls. The AlphaCoin interface above remains the card's data shape.

export const trendingCoins: MockCoin[] = [
  {
    ticker: '$PEPE', name: 'Pepe AI', handle: '@pepeai', imageUrl: img('pepe'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '4m', points: 8.2, views: '18K',
    volume: '92', marketCap: '31K', score: 9.1, followers: '4.2K', txns: 89,
  },
  {
    ticker: '$WOJAK', name: 'Wojak', handle: '@wojakcoin', imageUrl: img('wojak'),
    platforms: ['x', 'yt'], ageLabel: '7m', points: 7.6, views: '12K',
    volume: '88', marketCap: '33K', score: 8.4, followers: '3.1K', txns: 142,
  },
  {
    ticker: '$DOGE', name: 'Doge', handle: '@dogecoin', imageUrl: img('doge'),
    platforms: ['x', 'cb'], ageLabel: '2h', points: 7.1, views: '84K',
    volume: '214', marketCap: '1.2M', score: 7.2, followers: '2.1M', txns: 1204,
  },
  {
    ticker: '$BONK', name: 'Bonk', handle: '@bonkco', imageUrl: img('bonk'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '3h', points: 8.8, views: '210K',
    volume: '412', marketCap: '4.8M', score: 9.3, followers: '612K', txns: 3104,
  },
  {
    ticker: '$MOON', name: 'Moon Launch', handle: '@moonlaunch', imageUrl: img('moon'),
    platforms: ['x'], ageLabel: '1h', points: 6.4, views: '9K',
    volume: '41', marketCap: '22K', score: 6.8, followers: '812', txns: 67,
  },
  {
    ticker: '$HYPE', name: 'Hyperion', handle: '@hypepf', imageUrl: img('hype'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '14m', points: 8.0, views: '23K',
    volume: '128', marketCap: '96K', score: 8.3, followers: '5.2K', txns: 321,
  },
  {
    ticker: '$CAT', name: 'Cat God', handle: '@catgodpf', imageUrl: img('cat'),
    platforms: ['x'], ageLabel: '22m', points: 7.2, views: '8.1K',
    volume: '54', marketCap: '42K', score: 7.5, followers: '1.6K', txns: 142,
  },
];

export const newCoins: MockCoin[] = [
  {
    ticker: '$AGENT', name: 'Agent DAO', handle: '@agentdao', imageUrl: img('agent'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '35s', points: 9.0, views: '2.1K',
    volume: '12', marketCap: '18K', score: 8.9, followers: '512', txns: 41,
  },
  {
    ticker: '$BANANA', name: 'Banana Fi', handle: '@bananafi', imageUrl: img('banana'),
    platforms: ['x'], ageLabel: '1m', points: 7.2, views: '4.4K',
    volume: '22', marketCap: '71K', score: 7.5, followers: '1.1K', txns: 88,
  },
  {
    ticker: '$FLARE', name: 'Flare OS', handle: '@flareos', imageUrl: img('flare'),
    platforms: ['x', 'cb'], ageLabel: '4m', points: 8.0, views: '6.8K',
    volume: '31', marketCap: '42K', score: 8.1, followers: '2.4K', txns: 119,
  },
  {
    ticker: '$MONKE', name: 'Monke Sol', handle: '@monkesol', imageUrl: img('monke'),
    platforms: ['x', 'yt'], ageLabel: '6m', points: 7.4, views: '11K',
    volume: '48', marketCap: '23K', score: 7.9, followers: '1.9K', txns: 201,
  },
  {
    ticker: '$NOVA', name: 'Nova Proto', handle: '@novaproto', imageUrl: img('nova'),
    platforms: ['x', 'cb'], ageLabel: '2m', points: 8.3, views: '3.2K',
    volume: '18', marketCap: '34K', score: 8.2, followers: '622', txns: 58,
  },
  {
    ticker: '$ECHO', name: 'Echo Chamber', handle: '@echopf', imageUrl: img('echo'),
    platforms: ['x', 'yt'], ageLabel: '8m', points: 6.8, views: '7.4K',
    volume: '26', marketCap: '18K', score: 7.0, followers: '988', txns: 104,
  },
  {
    ticker: '$OBELISK', name: 'Obelisk', handle: '@obeliskpf', imageUrl: img('obelisk'),
    platforms: ['x'], ageLabel: '3m', points: 7.9, views: '2.8K',
    volume: '14', marketCap: '28K', score: 8.0, followers: '446', txns: 72,
  },
];

export const graduatingCoins: MockCoin[] = [
  /* ─── STRESS TEST FIXTURE ───────────────────────────────────────────
     ONE worst-case-everything card so the full overflow envelope is
     visible at a glance. Combines every stress vector simultaneously:

       text    long ticker (15 chars), long name (40 chars), long
               handle (23 chars -> 12-char truncation), multi-unit age
               label (compactAge collapses "99d 23h" -> "99d").
       right   max-plausible right-column values at the widest format
               the 3-sig-fig compact rule actually produces — `99.9M`
               (5 chars). The previous `999.9M` was a 4-sig-fig string
               that bypassed the rule and looked out-of-band on the
               deployed page; under the rule, 999.9M would round-up to
               1B anyway since `Math.round(999.9) = 1000`.
       icon    IconRow at its max compacted width. Under the 3-sig-
               fig compact rule the widest possible display is 5 chars
               (e.g. "99.9K" / "9.99K"); triple-digit prefixes shed
               their decimal ("999K") and four-digit values promote
               into the next tier. Driven by `holderCount: 99_900`
               (explicit) and `txns: 399_600` so viewers = txns/4 =
               99_900 also compacts to "99.9K".
       slots   MetaRow at its widest: age + twitter + secondary link
               (telegram wins over website) + mode (mayhem here, the
               flashiest mutex mode) + locked fee-share pie badge.

     Placed at the head of `graduatingCoins` so it always appears as
     the leading card in the Almost Graduated row when live data is
     absent. Remove the whole block (single-card) when done. */
  {
    ticker: '$VERYLONGTICKER',
    name: 'An Extremely Long Token Name For Testing',
    handle: '@verylonghandlenametest',
    imageUrl: img('stress-all'),
    platforms: ['x', 'yt', 'cb'],
    ageLabel: '99d 23h',
    points: 9.9,
    views: '999K',
    volume: '99.9M',
    marketCap: '99.9M',
    score: 9.9,
    followers: '1.51K',
    txns: 399600,
    holderCount: 99900,
    hasWebsite: true,
    hasLink: true,
    hasAgent: true,
    links: { twitter: '#', telegram: '#', website: '#' },
    mode: 'mayhem',
    feeShareLocked: true,
    feeShareAuthority: 'GeBJ6mDQqYdzbdJBSLE99Z7ivbMoTKGZWdSCUZ2LDuwR',
    feeShareRecipients: [
      { pubkey: 'GV6UbAgLJLnfLYFtnAeuLbUqLmxbDDLUNfhbkzADdC52', bps: 7_500 },
      { pubkey: 'GeBJ6mDQqYdzbdJBSLE99Z7ivbMoTKGZWdSCUZ2LDuwR', bps: 2_500 },
    ],
  },
  /* ─── END STRESS TEST FIXTURE ──────────────────────────────────── */
  {
    ticker: '$CHAD', name: 'Chad Coin', handle: '@chadcoin', imageUrl: img('chad'),
    platforms: ['x', 'cb'], ageLabel: '2h', points: 7.8, views: '22K',
    volume: '72', marketCap: '118K', score: 7.8, followers: '3.6K', txns: 412,
  },
  {
    ticker: '$TURBO', name: 'Turbo Sol', handle: '@turbosol', imageUrl: img('turbo'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '4h', points: 8.6, views: '68K',
    volume: '141', marketCap: '240K', score: 9.0, followers: '11K', txns: 892,
  },
  {
    ticker: '$SNEK', name: 'Snek Coin', handle: '@snekcoin', imageUrl: img('snek'),
    platforms: ['x'], ageLabel: '3h', points: 6.2, views: '8K',
    volume: '33', marketCap: '88K', score: 6.4, followers: '844', txns: 144,
  },
  {
    ticker: '$LUNA', name: 'Luna Proto', handle: '@lunaproto', imageUrl: img('luna'),
    platforms: ['x', 'yt'], ageLabel: '5h', points: 8.1, views: '31K',
    volume: '98', marketCap: '156K', score: 8.2, followers: '5.3K', txns: 488,
  },
  {
    ticker: '$VELA', name: 'the sails', handle: '@velasol', imageUrl: img('vela'),
    platforms: ['x', 'cb'], ageLabel: '2h', points: 7.4, views: '18K',
    volume: '84', marketCap: '102K', score: 7.6, followers: '3.2K', txns: 366,
  },
  {
    ticker: '$NEBULA', name: 'dust drift', handle: '@nebulapf', imageUrl: img('nebula'),
    platforms: ['x', 'yt'], ageLabel: '1h 38m', points: 8.4, views: '38K',
    volume: '119', marketCap: '198K', score: 8.5, followers: '8.1K', txns: 512,
  },
  {
    ticker: '$HALLEY', name: 'periodic comet', handle: '@halleypf', imageUrl: img('halley'),
    platforms: ['x', 'cb'], ageLabel: '5h 31m', points: 7.0, views: '22K',
    volume: '66', marketCap: '180K', score: 7.2, followers: '2.8K', txns: 297,
  },
];

export const migratedCoins: MockCoin[] = [
  {
    ticker: '$GIGA', name: 'Giga Chad', handle: '@gigachad', imageUrl: img('giga'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '1d', points: 8.5, views: '120K',
    volume: '1.2K', marketCap: '3.4M', score: 8.8, followers: '42K', txns: 4120,
  },
  {
    ticker: '$SOL', name: 'Solana', handle: '@solana', imageUrl: img('sol'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '9h', points: 8.5, views: '44K',
    volume: '188', marketCap: '310K', score: 8.6, followers: '4.6K', txns: 622,
  },
  {
    ticker: '$MOON', name: 'Moon Launch', handle: '@moonlaunch2', imageUrl: img('moon2'),
    platforms: ['x'], ageLabel: '2d', points: 7.1, views: '68K',
    volume: '412', marketCap: '820K', score: 7.4, followers: '8.1K', txns: 2104,
  },
  {
    ticker: '$KEPLER', name: 'Second Earth', handle: '@keplerpf', imageUrl: img('kepler'),
    platforms: ['x', 'cb'], ageLabel: '6h', points: 8.9, views: '94K',
    volume: '612', marketCap: '1.1M', score: 9.0, followers: '22K', txns: 3340,
  },
  {
    ticker: '$ORION', name: 'Dust Drift', handle: '@orionpf', imageUrl: img('orion'),
    platforms: ['x', 'yt'], ageLabel: '14h', points: 7.6, views: '52K',
    volume: '268', marketCap: '420K', score: 7.8, followers: '9.4K', txns: 1480,
  },
  {
    ticker: '$PEGASUS', name: 'the winged', handle: '@pegasuspf', imageUrl: img('pegasus'),
    platforms: ['x', 'yt', 'cb'], ageLabel: '1d 4h', points: 8.2, views: '88K',
    volume: '487', marketCap: '680K', score: 8.3, followers: '14K', txns: 2280,
  },
  {
    ticker: '$ANDROMEDA', name: 'Andromeda', handle: '@andrompf', imageUrl: img('andromeda'),
    platforms: ['x', 'cb'], ageLabel: '18h', points: 7.9, views: '62K',
    volume: '324', marketCap: '510K', score: 8.0, followers: '11K', txns: 1710,
  },
];

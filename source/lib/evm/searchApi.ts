/**
 * `GET /api/v1/evm/search?q=&chain=&limit=` — finding an EVM token by ticker
 * or name, not just by a full 0x address.
 *
 * WHAT THIS CLOSES. The search modal could match an EVM token only when the
 * user pasted its complete 40-hex address, because the Solana `/api/search`
 * index contains no EVM tokens and there was nothing else to ask. Typing
 * `PONS` returned an empty modal. The api has since grown a real EVM search
 * (`api/src/routes/evm/search.ts`), fed by a the database catalog plus each
 * chain's live discover lane, so a ticker resolves now.
 *
 * TWO THINGS ON THE WIRE MATTER HERE AND ARE HANDLED, NOT ASSUMED AWAY:
 *
 *  - **`live: false` is not "no result".** The api serves catalog hits for
 *    tokens the live indexer does not currently hold, with
 *    `liveUnavailableReason` saying which of four situations it is. Those rows
 *    are real and routable — the token exists and its trade page will do its
 *    own read — so they are kept and the reason is carried through for the
 *    render. Dropping them would hide every token that has aged out of the
 *    lanes.
 *  - **The route deliberately has no response schema** (so upstream card
 *    fields pass through un-stripped as the indexer gains them). That means
 *    nothing validates the body but this parser, and it is therefore strict:
 *    an item without a `chain` and a well-formed `address` is not a search
 *    result, it is a row that would render a link to nowhere.
 *
 * There is no USD in this envelope by design — `statsAvailable` is always
 * `false` with `statsUnavailableReason: "evm_usd_aggregates_absent"` — so
 * nothing here can be presented as a dollar-ranked result.
 */

import {
  chainSlug,
  EVM_TRADE_SERVED_SLUGS,
  storageTagForSlug,
  tradePageHref,
} from './chains';

/* `0[xX]`, not `0x`: EIP-55 checksum casing is a DISPLAY vocabulary and some
   producers upper-case the whole string. The prefix is not part of the
   address, so rejecting on its case would drop a perfectly valid token. */
const EVM_ADDRESS_RE = /^0[xX][0-9a-fA-F]{40}$/;
const EVM_SEARCH_SERVED_CHAINS = new Set(
  EVM_TRADE_SERVED_SLUGS.map((slug) => storageTagForSlug(slug)).filter(
    (chain): chain is string => chain !== null,
  ),
);

/** Why a catalog hit is not currently in the live lanes. */
export type EvmLiveUnavailableReason =
  | 'chain_not_configured'
  | 'upstream_chain_misrouted'
  | 'unknown_to_upstream'
  | 'upstream_unavailable';

export interface EvmSearchItem {
  /** Chain-qualified key: `bsc:0x…`. Never a bare address — the same address
   *  is a different token on each chain. */
  readonly id: string;
  readonly chain: string;
  /** Lowercase 0x. */
  readonly address: string;
  readonly name: string | null;
  readonly symbol: string | null;
  /** Chain-qualified trade-page destination. */
  readonly href: string;
  /** What matched: the address itself, the live identity, or the catalog. */
  readonly matchKind: string | null;
  /** Is this token currently held by the live indexer? */
  readonly live: boolean;
  readonly liveUnavailableReason: string | null;
  /** Age in ms when the catalog knew a real creation time. `null`, never 0. */
  readonly ageMs: number | null;
  /** Exact live denomination facts. Null on catalog-only hits and whenever
   * the producer has not proved the field. */
  readonly quoteAsset: 'native' | 'wrapped_native' | 'token' | null;
  readonly quoteToken: string | null;
  readonly quoteIsNative: boolean | null;
  readonly quoteDecimals: number | null;
  readonly quoteSymbol: string | null;
  /** Raw generic quote values. Retained without formatting when the quote
   * scale is unknown (notably stock-token quotes). */
  readonly reserveQuoteBaseUnits: string | null;
  readonly marketCapQuoteBaseUnits: string | null;
}

export interface EvmSearchResult {
  readonly items: ReadonlyArray<EvmSearchItem>;
  /** True when some chain could not be consulted — the result set is a
   *  subset and the UI may say so rather than implying "no such token". */
  readonly partial: boolean;
  readonly truncated: boolean;
  /**
   * The api sets this when the upstream body contained a bare JSON number
   * beyond 17 significant digits, i.e. a figure that has ALREADY lost
   * precision by the time it reaches us. Carried so a surface that renders
   * such a figure can refuse to.
   */
  readonly precisionRisk: boolean;
}

const EMPTY: EvmSearchResult = {
  items: [],
  partial: false,
  truncated: false,
  precisionRisk: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function unsignedString(value: unknown): string | null {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
}

/** Pure parser, exported so the branch table is exercised without `fetch`. */
export function parseEvmSearchResponse(body: unknown): EvmSearchResult {
  if (!isObject(body)) return EMPTY;
  const rawItems = body['items'];
  if (!Array.isArray(rawItems)) return EMPTY;
  const items: EvmSearchItem[] = [];
  for (const raw of rawItems) {
    if (!isObject(raw)) continue;
    const chain = nonEmptyString(raw['chain']);
    const addressRaw = nonEmptyString(raw['address']);
    if (chain === null || addressRaw === null) continue;
    // A search result is an invitation to navigate, so it may name only a
    // chain whose trade page is actually served. Accepting an arbitrary
    // non-empty tag builds a clickable `/trade/<tag>/<address>` row that the
    // route must reject as an unknown chain. This also prevents a future
    // catalog row for an unlaunched chain from leaking into the BSC/Robinhood
    // product surface before that chain has an end-to-end trade path.
    if (!EVM_SEARCH_SERVED_CHAINS.has(chain)) continue;
    if (!EVM_ADDRESS_RE.test(addressRaw)) continue;
    const address = addressRaw.toLowerCase();
    const ageMs = raw['ageMs'];
    const quoteAssetRaw = raw['quoteAsset'];
    const quoteAsset =
      quoteAssetRaw === 'native' ||
      quoteAssetRaw === 'wrapped_native' ||
      quoteAssetRaw === 'token'
        ? quoteAssetRaw
        : null;
    const quoteTokenRaw = raw['quoteToken'];
    const quoteToken =
      typeof quoteTokenRaw === 'string' && EVM_ADDRESS_RE.test(quoteTokenRaw)
        ? quoteTokenRaw.toLowerCase()
        : null;
    const quoteIsNative =
      typeof raw['quoteIsNative'] === 'boolean' ? raw['quoteIsNative'] : null;
    const quoteDecimalsRaw = raw['quoteDecimals'];
    const quoteDecimals =
      typeof quoteDecimalsRaw === 'number' &&
      Number.isInteger(quoteDecimalsRaw) &&
      quoteDecimalsRaw >= 0 &&
      quoteDecimalsRaw <= 36
        ? quoteDecimalsRaw
        : null;
    const quoteSymbolRaw = nonEmptyString(raw['quoteSymbol']);
    const reportedQuoteSymbol = quoteSymbolRaw !== null && quoteSymbolRaw.length <= 32
      ? quoteSymbolRaw
      : null;
    const nativeSymbolRaw = nonEmptyString(raw['nativeSymbol']);
    const reportedNativeSymbol = nativeSymbolRaw !== null && nativeSymbolRaw.length <= 32
      ? nativeSymbolRaw
      : null;
    const expectedNativeSymbol = chain === 'bsc' ? 'BNB' : 'ETH';
    const expectedWrappedNative = chain === 'bsc'
      ? '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
      : '0x4200000000000000000000000000000000000006';
    const quoteSymbol = quoteIsNative === true
      ? reportedQuoteSymbol ?? reportedNativeSymbol
      : reportedQuoteSymbol;
    const hasQuoteFields = [
      'quoteAsset',
      'quoteToken',
      'quoteIsNative',
      'quoteDecimals',
      'quoteSymbol',
      'nativeSymbol',
      'reserveQuoteBaseUnits',
      'marketCapQuoteBaseUnits',
    ].some((field) => Object.prototype.hasOwnProperty.call(raw, field));
    const quoteIdentityValid =
      !hasQuoteFields ||
      (quoteIsNative !== null && (
        quoteAsset === null
          ? quoteIsNative === false && quoteToken === null && quoteDecimals === null
            && quoteSymbol === null
          : quoteAsset === 'native'
            ? quoteIsNative === true && quoteToken === null && quoteDecimals === 18
              && quoteSymbol === expectedNativeSymbol
            : quoteAsset === 'wrapped_native'
              ? quoteIsNative === true && quoteToken === expectedWrappedNative
                && quoteDecimals === 18
                && (quoteSymbol === null || quoteSymbol === expectedNativeSymbol)
              : quoteIsNative === false && quoteToken !== null
                && ((quoteDecimals === null && quoteSymbol === null)
                  || (quoteDecimals !== null && quoteSymbol !== null))
      ));
    const reserveQuote = raw['reserveQuoteBaseUnits'];
    const marketCapQuote = raw['marketCapQuoteBaseUnits'];
    if (
      !quoteIdentityValid ||
      (Object.prototype.hasOwnProperty.call(raw, 'quoteDecimals') && quoteDecimals === null) ||
      (Object.prototype.hasOwnProperty.call(raw, 'quoteSymbol') && reportedQuoteSymbol === null) ||
      (Object.prototype.hasOwnProperty.call(raw, 'nativeSymbol') && reportedNativeSymbol === null) ||
      (reserveQuote !== undefined && unsignedString(reserveQuote) === null) ||
      (marketCapQuote !== undefined && unsignedString(marketCapQuote) === null)
    ) {
      continue;
    }
    items.push({
      id: `${chain}:${address}`,
      chain,
      address,
      name: nonEmptyString(raw['name']),
      symbol: nonEmptyString(raw['symbol']),
      href: tradePageHref(address, chain),
      matchKind: nonEmptyString(raw['matchKind']),
      live: raw['live'] === true,
      liveUnavailableReason: nonEmptyString(raw['liveUnavailableReason']),
      // A non-finite or negative age is not an age. `0` would claim the token
      // was created this millisecond.
      ageMs:
        typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs > 0 ? ageMs : null,
      quoteAsset,
      quoteToken,
      quoteIsNative,
      quoteDecimals,
      quoteSymbol,
      reserveQuoteBaseUnits: unsignedString(reserveQuote),
      marketCapQuoteBaseUnits: unsignedString(marketCapQuote),
    });
  }
  return {
    items,
    partial: body['partial'] === true,
    truncated: body['truncated'] === true,
    precisionRisk: body['precisionRisk'] === true,
  };
}

/** Human phrasing for `liveUnavailableReason`. `null` when the token IS live. */
export function evmLiveUnavailableText(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'chain_not_configured':
      return 'This chain is not configured here, so only catalog details are shown.';
    case 'upstream_chain_misrouted':
      return 'The indexer for this chain answered for a different chain, so its live state is not shown.';
    case 'unknown_to_upstream':
      return 'The live indexer does not currently hold this token — its details come from the catalog.';
    case 'upstream_unavailable':
      return 'The live indexer is unreachable, so these details come from the catalog and may be stale.';
    default:
      return 'Live details are unavailable for this token; what is shown comes from the catalog.';
  }
}

/**
 * URL for the EVM search.
 *
 * `chain` is omitted deliberately when the caller has no preference: the api
 * then searches BOTH wave-1 chains and returns a row per chain that matched.
 * Sending a chain the user did not choose would hide the other one's token
 * entirely, which is the same class of error as guessing a chain for a pasted
 * address.
 */
export function evmSearchUrl(query: string, limit: number, chain?: string | null): string {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (typeof chain === 'string' && chain.length > 0) params.set('chain', chain);
  return `/api/v1/evm/search?${params.toString()}`;
}

/** Display label for a search row. Falls back to a short address, never ''. */
export function evmSearchLabel(item: EvmSearchItem): string {
  if (item.symbol !== null) return item.symbol;
  if (item.name !== null) return item.name;
  return `${item.address.slice(0, 6)}…${item.address.slice(-4)}`;
}

/** `BSC` / `ROBINHOOD` — the slug upper-cased, for a chain chip. */
export function evmSearchChainLabel(chain: string): string {
  return chainSlug(chain).toUpperCase();
}

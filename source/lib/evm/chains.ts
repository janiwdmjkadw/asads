/**
 * The chain vocabulary, in ONE place.
 *
 * Three vocabularies exist and they are deliberately not the same strings:
 *
 *  - **storage tag** — what the indexer, the api and every wire frame key on
 *    (`solana`, `bsc`, `robinhood_chain`, `base`, `ethereum`).
 *  - **URL slug** — what a human reads in an address bar (`sol`, `bsc`,
 *    `robinhood`, `base`, `eth`). Shorter, and `robinhood_chain` in a URL is
 *    ugly enough that people retype it wrong.
 *  - **native symbol** — the chain's own asset ticker (`SOL`, `BNB`, `ETH`).
 *
 * They used to be converted in three files (`discoverAdapter.ts`,
 * `components/listen/navigation.ts`, and inline in two route components) and
 * the trade-page href was built by two different functions. That is exactly
 * the drift that produces a link to the right address on the wrong chain —
 * the §4.5 address collision arriving as a routing bug. So the conversions,
 * the href builder AND the discover chain-selection vocabulary live here, and
 * everything else imports them.
 *
 * This module is a LEAF: it imports nothing. `discoverAdapter.ts` re-exports
 * the three conversions for back-compat, and `navigation.ts` imports the href
 * builder — neither can import the other without a cycle, which is why the
 * shared truth had to move down here rather than into either of them.
 */

/** Storage tag for the Solana surface. */
export const SOLANA_CHAIN = 'solana';

/**
 * URL slug for a storage tag.
 *
 * A tag with no special spelling returns itself (`bsc`, `base`), which is why
 * this is a `switch` with a default rather than a lookup table: an unknown tag
 * must round-trip unchanged instead of resolving to `undefined` and producing
 * a `/trade/undefined/0x…` link.
 */
export function chainSlug(storageTag: string): string {
  switch (storageTag) {
    case 'solana':
      return 'sol';
    case 'ethereum':
      return 'eth';
    case 'robinhood_chain':
      return 'robinhood';
    default:
      // bsc and base spell the same either way.
      return storageTag;
  }
}

/**
 * Storage tag for a URL slug — the inverse of {@link chainSlug}.
 *
 * Returns `null` for an unknown slug: a typo'd chain segment in a URL is a
 * 404, never a guessed chain. (Guessing would look the address up on the
 * WRONG chain — the §4.5 collision as a routing bug.)
 */
export function storageTagForSlug(slug: string): string | null {
  switch (slug) {
    case 'sol':
      return 'solana';
    case 'eth':
      return 'ethereum';
    case 'robinhood':
      return 'robinhood_chain';
    case 'bsc':
    case 'base':
      return slug;
    default:
      return null;
  }
}

/** Native-asset ticker for a chain storage tag (trade-panel denomination). */
export function nativeSymbolForChain(storageTag: string): string {
  switch (storageTag) {
    case 'solana':
      return 'SOL';
    case 'bsc':
      return 'BNB';
    case 'ethereum':
    case 'base':
    case 'robinhood_chain':
      return 'ETH';
    default:
      // Unreachable behind the route's slug gate; still honest if reached.
      return storageTag.toUpperCase();
  }
}

/**
 * Is this value the Solana surface?
 *
 * Accepts BOTH vocabularies (`solana` and `sol`) plus the absent/empty case,
 * because callers reach this from three directions: a `ChainBinding.chain`
 * (storage tag), a URL segment (slug), and a plain optional argument that is
 * simply not set on the ~100% of call sites that are Solana-only. All three
 * must resolve to the historical single-segment `/trade/<mint>` href, byte for
 * byte — anything else silently re-routes the live Solana surface.
 */
export function isSolanaChain(chain: string | null | undefined): boolean {
  return (
    chain === undefined
    || chain === null
    || chain === ''
    || chain === SOLANA_CHAIN
    || chain === 'sol'
  );
}

/**
 * THE trade-page href builder, for every chain.
 *
 * Solana keeps the single-segment shape it has always had. Every other chain
 * gets `/trade/<slug>/<address>`, which is the two-segment route
 * `app/(terminal)/trade/[mint]/[address]` claims — a bare address is not
 * routable because the same address exists on four chains.
 *
 * `encodeURIComponent` on the address is identity for a `0x…` hex string and
 * for base58, so this produces the exact bytes the previous two builders did.
 * It is kept because the value is not validated here and a stray `/` or `?`
 * must not be able to escape its segment.
 */
export function tradePageHref(address: string, chain?: string | null): string {
  if (isSolanaChain(chain)) return `/trade/${encodeURIComponent(address)}`;
  // `isSolanaChain` has already excluded null/undefined/'', so the narrowing
  // is a fact rather than an assertion — but TS cannot see through a boolean
  // helper, so the check is restated instead of asserted away.
  const slug = chainSlug(typeof chain === 'string' ? chain : '');
  return `/trade/${encodeURIComponent(slug)}/${encodeURIComponent(address)}`;
}

/* ------------------------------------------------------------------ */
/* EVM trade route (two-segment /trade/<slug>/<0xaddress>)             */
/* ------------------------------------------------------------------ */

/**
 * Chains the EVM trade page can actually serve today (wave 1), as URL slugs.
 *
 * ONE list, imported by both the route component (which renders the honest
 * invalid page for everything else) and the persistent EVM trade pane (which
 * claims exactly these paths). Two copies of this set is how a pane goes
 * inert on a path the route believes it owns — a blank page with no error.
 */
export const EVM_TRADE_SERVED_SLUGS = ['bsc', 'robinhood'] as const;

const EVM_TRADE_PATH = /^\/trade\/([^/]+)\/([^/]+)$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface EvmTradeSubject {
  /** STORAGE tag (`bsc`, `robinhood_chain`) — what every read keys on. */
  chain: string;
  /** Lowercased 0x address — the form the fold keys tokens on. */
  address: string;
}

/**
 * The persistent EVM trade pane's matcher — the two-segment twin of
 * `PersistentTradePane.mintFromPathname`.
 *
 * Accepts EXACTLY the paths the pane serves: a served slug plus a
 * well-formed EVM address. Everything else — the Solana single-segment
 * shape, `/trade/proposals/<id>`, an unserved slug (`eth`, `sol`), a
 * malformed address — returns `null` so the route component keeps owning
 * its redirect and invalid-link pages. Refusal, not lookup: a typo must
 * never activate a pane that would fetch on the wrong chain.
 */
export function parseEvmTradePath(pathname: string | null): EvmTradeSubject | null {
  const match = EVM_TRADE_PATH.exec(pathname ?? '');
  if (!match) return null;
  let slug: string;
  let address: string;
  try {
    slug = decodeURIComponent(match[1]);
    address = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!(EVM_TRADE_SERVED_SLUGS as readonly string[]).includes(slug)) return null;
  if (!EVM_ADDRESS.test(address)) return null;
  const chain = storageTagForSlug(slug);
  if (chain === null) return null;
  return { chain, address: address.toLowerCase() };
}

/* ------------------------------------------------------------------ */
/* Discover chain selection                                            */
/* ------------------------------------------------------------------ */

/**
 * The chains the discover surface offers, by STORAGE tag.
 *
 * `sol` used to be spelled as a slug here while its two neighbours were
 * spelled as storage tags — one array holding two vocabularies, which is how
 * `robinhood` and `robinhood_chain` both ended up in flight. Storage tags
 * throughout; the URL form is derived with {@link chainSlug} at the edge.
 */
export const DISCOVER_CHAINS = [
  { tag: 'solana', label: 'SOL' },
  { tag: 'bsc', label: 'BSC' },
  { tag: 'robinhood_chain', label: 'ROBINHOOD' },
] as const;

export type DiscoverChainTag = (typeof DISCOVER_CHAINS)[number]['tag'];

/** The chain a user sees when they have never chosen one. */
export const DEFAULT_DISCOVER_CHAIN: DiscoverChainTag = 'solana';

/** localStorage key for the remembered selection. Versioned so a vocabulary
 *  change is a new key rather than a value nobody can parse. */
export const DISCOVER_CHAIN_STORAGE_KEY = 'discover:chain:v1';

/** The query parameter that makes a discover link shareable. */
export const DISCOVER_CHAIN_PARAM = 'chain';

/**
 * Resolve a chain from any string a URL, a localStorage value or a legacy
 * link might carry.
 *
 * Accepts BOTH vocabularies on purpose. `/discover/evm?chain=robinhood_chain`
 * is a link that has been shipped and may be bookmarked; `/discover?chain=
 * robinhood` is the shape links are minted in now. Both must land on the same
 * lane rather than one of them silently falling back to Solana.
 *
 * `null` for anything unrecognised — a typo must not look like "this chain
 * has no coins", and it must not be persisted either.
 */
export function parseDiscoverChain(raw: string | null | undefined): DiscoverChainTag | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;
  const asTag = DISCOVER_CHAINS.find((entry) => entry.tag === trimmed);
  if (asTag !== undefined) return asTag.tag;
  const fromSlug = storageTagForSlug(trimmed);
  const asSlug = DISCOVER_CHAINS.find((entry) => entry.tag === fromSlug);
  return asSlug?.tag ?? null;
}

/**
 * Resolve the selection from the two inputs that can carry it, in priority
 * order: the URL first, then what the user last chose.
 *
 * The URL WINS, always. A shared or bookmarked link names a chain explicitly,
 * and letting a local preference override it is how one user opens another
 * user's link and sees a different board — the failure the whole reconcile
 * exists to fix. The stored value only answers the case where the URL says
 * nothing.
 */
export function resolveDiscoverChain(
  urlValue: string | null | undefined,
  storedValue: string | null | undefined,
): DiscoverChainTag {
  return (
    parseDiscoverChain(urlValue)
    ?? parseDiscoverChain(storedValue)
    ?? DEFAULT_DISCOVER_CHAIN
  );
}

/**
 * The search string for a discover URL carrying `chain`, given the CURRENT
 * search string.
 *
 * Solana emits NO parameter rather than `?chain=sol`. Existing Solana links
 * are `/discover` with a bare path, every one of them already shared and
 * bookmarked, and a canonical URL that suddenly grows a query string is a new
 * URL for the same page. Other parameters on the URL are preserved and their
 * order is untouched — this is called on every switch and a reordering
 * history entry is a diff nobody asked for.
 *
 * Returns a string beginning with `?`, or `''` when no parameters remain.
 */
export function discoverSearchWithChain(
  currentSearch: string,
  chain: DiscoverChainTag,
): string {
  const params = new URLSearchParams(currentSearch);
  if (chain === DEFAULT_DISCOVER_CHAIN) {
    params.delete(DISCOVER_CHAIN_PARAM);
  } else {
    params.set(DISCOVER_CHAIN_PARAM, chainSlug(chain));
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** A shareable discover href for one chain. */
export function discoverHrefForChain(chain: DiscoverChainTag): string {
  return `/discover${discoverSearchWithChain('', chain)}`;
}

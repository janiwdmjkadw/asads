import { parseEvmDiscoverCard, type EvmDiscoverCard } from './discoverAdapter';
import { evmCreatorTokensUrl } from './readApi';
import { readBoundedUnsigned, readEvmWireVersion } from './wireInteger';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CREATOR_PAGE_LIMIT = 100;

export interface EvmCreatorTokensPage {
  readonly chain: string;
  readonly creator: string;
  readonly items: readonly EvmDiscoverCard[];
  readonly nextCursor: string | null;
}

export type EvmCreatorTokensResult =
  | { readonly kind: 'ok'; readonly page: EvmCreatorTokensPage }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly status: number | null };

/** Replace drops reorg tombstones; append deduplicates a moving cursor seam. */
export function mergeEvmCreatorTokens(
  current: readonly EvmDiscoverCard[],
  page: readonly EvmDiscoverCard[],
  mode: 'replace' | 'append',
): readonly EvmDiscoverCard[] {
  if (mode === 'replace') return page;
  const merged = [...current];
  const seen = new Set(current.map((card) => `${card.chain}:${card.address}`));
  for (const card of page) {
    const key = `${card.chain}:${card.address}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(card);
    }
  }
  return merged;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Decode one creator page. Every row must prove that it is the requested
 * chain's active canonical state; a partial page is refused as a whole.
 */
export function parseEvmCreatorTokensPage(
  value: unknown,
  expectedChain: string,
  expectedCreator: string,
): EvmCreatorTokensPage | null {
  const page = object(value);
  const creator = expectedCreator.toLowerCase();
  const version = page === null ? null : readEvmWireVersion(page['v']);
  if (
    page === null
    || version === null
    || !EVM_ADDRESS.test(creator)
    || page['chain'] !== expectedChain
    || page['creator'] !== creator
    || !Array.isArray(page['items'])
    || page['items'].length > CREATOR_PAGE_LIMIT
    || readBoundedUnsigned(page['count'], CREATOR_PAGE_LIMIT) !== page['items'].length
    || typeof page['hasMore'] !== 'boolean'
  ) {
    return null;
  }

  const items: EvmDiscoverCard[] = [];
  const keys = new Set<string>();
  let previous: readonly [number, string] | null = null;
  for (const rawValue of page['items']) {
    const raw = object(rawValue);
    const card = parseEvmDiscoverCard(rawValue, expectedChain);
    if (
      raw === null
      || card === null
      || raw['v'] !== version
      || card.creator !== creator
      || raw['key'] !== `${expectedChain}:${card.address}`
      || raw['active'] !== true
      || raw['canonical'] !== true
      || raw['finality'] !== 'canonical'
      || keys.has(`${expectedChain}:${card.address}`)
    ) {
      return null;
    }
    keys.add(`${expectedChain}:${card.address}`);
    const tuple = [card.firstSeenSec ?? 0, card.address] as const;
    if (
      previous !== null
      && (tuple[0] > previous[0] || (tuple[0] === previous[0] && tuple[1] >= previous[1]))
    ) {
      return null;
    }
    previous = tuple;
    items.push(card);
  }

  const nextCursor = page['nextCursor'];
  if (page['hasMore']) {
    const last = items.at(-1);
    const expectedCursor = last === undefined
      ? null
      : `${last.firstSeenSec ?? 0}:${last.address}`;
    if (typeof nextCursor !== 'string' || nextCursor !== expectedCursor) return null;
  } else if (nextCursor !== undefined) {
    return null;
  }

  return {
    chain: expectedChain,
    creator,
    items,
    nextCursor: page['hasMore'] ? nextCursor as string : null,
  };
}

export async function fetchEvmCreatorTokens(args: {
  apiBase: string;
  chain: string;
  creator: string;
  cursor?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<EvmCreatorTokensResult> {
  const creator = args.creator.toLowerCase();
  if (!EVM_ADDRESS.test(creator)) return { kind: 'error', status: null };
  const doFetch = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await doFetch(
      evmCreatorTokensUrl(
        args.apiBase,
        args.chain,
        creator,
        CREATOR_PAGE_LIMIT,
        args.cursor,
      ),
      { cache: 'no-store', signal: args.signal },
    );
  } catch {
    return { kind: 'error', status: null };
  }
  if (response.status === 503) return { kind: 'unavailable' };
  if (!response.ok) return { kind: 'error', status: response.status };
  try {
    const page = parseEvmCreatorTokensPage(await response.json(), args.chain, creator);
    return page === null ? { kind: 'error', status: response.status } : { kind: 'ok', page };
  } catch {
    return { kind: 'error', status: response.status };
  }
}

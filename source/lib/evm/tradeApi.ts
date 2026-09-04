/**
 * Wire types + fetchers for the EVM trade page's derived reads.
 *
 * Every shape here was read off the backend source, not guessed,
 * and the awkward parts of those shapes are load-bearing:
 *
 * - **Prices are RATIOS, in two fields.** `openNum`/`openDen`, and so on.
 *   `native_wei / token_base_units` has no exact machine representation at 18
 *   decimals and both words exceed 2^53, so the wire refuses to collapse them
 *   — and so does this module. An undefined price is ABSENT, never 0: a zero
 *   open renders as a crash to nothing.
 * - **`holderCount` is `null` when the fold's history is partial**, and
 *   `observedHolders` is a LOWER BOUND named so nobody mistakes it for the
 *   count. Rendering the observed figure as the count would present a
 *   measurement we did not make.
 * - **A leaderboard can be UNRANKED.** When a 256-bit total overflows there is
 *   no total order over those wallets, and the server says so
 *   (`ranked: false` + a reason) rather than answering an empty board, which
 *   would claim nobody traded. The type is a union so a caller cannot read
 *   `traders: []` without first asking whether it was rankable.
 * - **`needsRecompute` / `stale` mean a reorg invalidated a bucket and the
 *   recompute has not landed.** The stale candle is served on purpose —
 *   blanking destroys the evidence that a recompute is owed — so the client
 *   must DEGRADE VISIBLY rather than either hiding it or trusting it.
 */

import {
  evmCandlesUrl,
  evmHoldersUrl,
  evmTopTradersUrl,
  evmTradesUrl,
  type EvmResolution,
} from './readApi';
import {
  EVM_TAPE_TIERS,
  parseTapePage,
  TAPE_PAGE_LIMIT,
  type EvmTapePage,
  type EvmTapeTier,
} from './tape';
import {
  isCanonicalUnsigned,
  readBoundedUnsigned,
  readEvmWireVersion,
  readWideUnsigned,
  type EvmWireVersion,
} from './wireInteger';

/**
 * WHICH TIER ANSWERED a derived read (the backend source).
 *
 * The same closed vocabulary the tape already parses, reused rather than
 * re-spelled: it is one enum on the server and a second copy would drift.
 * `unavailable` is the member that must never render as absence — the server
 * stamps it when NOBODY could answer (a the analytics store timeout, or a cold reader
 * that is not configured), and `stamp` forces `historyComplete: false` +
 * `stale: true` alongside it precisely so a client can tell.
 */
export type EvmReadTier = EvmTapeTier;

/**
 * Read the tier off a parsed page, or `null`.
 *
 * `null` for an unrecognized value rather than a cast: an unknown tier is a
 * wire-shape change, not a fifth kind of emptiness to guess at. It is also
 * `null` for an OLD server that does not stamp one, which is why every render
 * branch treats `null` as "the server did not say" and never as `fold`.
 */
export function readTier(value: unknown): EvmReadTier | null {
  return typeof value === 'string'
    && (EVM_TAPE_TIERS as readonly string[]).includes(value)
    ? (value as EvmReadTier)
    : null;
}

/** One OHLCV bucket (the backend source). */
export interface EvmCandleRow {
  bucketStartSec: number;
  openNum?: string;
  openDen?: string;
  highNum?: string;
  highDen?: string;
  lowNum?: string;
  lowDen?: string;
  closeNum?: string;
  closeDen?: string;
  volumeNative: string;
  tradeCount: number;
  lastBlockNumber: number;
  /** A reorg invalidated this bucket; the recompute has not landed. */
  needsRecompute: boolean;
}

export interface EvmCandleSeries {
  v: string;
  chain: string;
  address: string;
  resolution: string;
  count: number;
  /** Buckets held BEFORE the cap — `count` alone cannot say this. */
  total: number;
  truncated: boolean;
  /** True when ANY bucket is stale; surfaced at the top, not only per row. */
  stale: boolean;
  candles: EvmCandleRow[];
}

export interface EvmHolderRow {
  address: string;
  /** Token base units, decimal string. */
  balance: string;
  firstSeenBlock: number;
  lastBlockNumber: number;
}

export interface EvmHolderPage {
  v: string;
  chain: string;
  address: string;
  /** `null` when the fold did not see every transfer since creation. */
  holderCount: number | null;
  partial: boolean;
  /** Wallets actually seen — a LOWER BOUND, never the count. */
  observedHolders: number;
  count: number;
  truncated: boolean;
  holders: EvmHolderRow[];
  /* --------------------------------------------------------------------- */
  /* THE PROVENANCE HALF. the backend source has emitted all four since  */
  /* the holder rework and this module typed none of them, so an             */
  /* `unavailable` read — nobody could answer — arrived indistinguishable    */
  /* from a measured empty page and rendered as "at least 0". The server     */
  /* distinguishes four states; a client that parses one of them prints one  */
  /* sentence for all four.                                                  */
  /*                                                                        */
  /* All optional for wire-version tolerance. Absent means the server did    */
  /* not say, which is its own state and is never rounded to a default.      */
  /* --------------------------------------------------------------------- */
  /**
   * WHY the set is not authoritative — `unknown_token`, `partial_history`,
   * `awaiting_recompute` (the backend source). `partial:
   * true` alone collapses three situations that want different responses: a
   * token we have never heard of, a cold start whose balances are floors, and
   * a reorg's damage that nothing can rebuild.
   */
  partialReason?: string | null;
  /** Was every transfer since creation observed? Raw, and NOT the same fact
   *  as `partial` — that one also folds in a pending recompute. */
  historyComplete?: boolean;
  /**
   * Debits clamped at zero because the wallet was funded before our cursor —
   * the SIZE of the corruption, not just its existence. A clamped balance is
   * otherwise indistinguishable on the wire from a wallet that sold out. A
   * live run clamped 6,493 of 7,098 folded transfers.
   */
  underflowsClamped?: number;
  /** Which tier answered. Parse it with `readTier`. */
  tier?: string;
}

export interface EvmTraderRow {
  trader: string;
  boughtNative: string;
  soldNative: string;
  tokensIn: string;
  tokensOut: string;
  buyCount: number;
  sellCount: number;
  /** Omitted when the derived arithmetic REFUSED (checked add overflowed). */
  tradeCount?: number;
  volumeNative?: string;
  firstSeenBlock: number;
  lastSeenBlock: number;
  /** Omitted when the block carried no usable timestamp — never the epoch. */
  firstSeenSec?: number;
  lastSeenSec?: number;
}

export type EvmTraderBoard =
  | {
      v: string;
      chain: string;
      address: string;
      ranked: true;
      count: number;
      total: number;
      truncated: boolean;
      /** False = a ranking of the trades we SAW, not of the token. */
      historyComplete: boolean;
      /**
       * WHY the ranking is not authoritative — `unknown_token`,
       * `partial_history`, `awaiting_recompute`
       * (the backend source, and the backend source
       * for the durable tier). The SAME closed vocabulary the holder page
       * carries, spelled the same way on purpose, so both panels parse one
       * enum rather than two spellings of one state.
       *
       * `historyComplete: false` alone collapses three situations that reward
       * different responses: a token this indexer has never heard of, a board
       * built from a tape that started mid-life (which waiting cannot fix),
       * and a reorg's damage awaiting a repair (which waiting can). Optional
       * for wire-version tolerance — absent means the server did not say, and
       * that is never rounded to a default.
       */
      partialReason?: string | null;
      traders: EvmTraderRow[];
      /**
       * Which tier answered. Parse it with `readTier`.
       *
       * `unavailable` is a RANKED, EMPTY board — the backend source
       * builds one from an empty leaderboard — so the `ranked` discriminant
       * cannot catch it and the panel printed "No trades observed for this
       * token yet" over a the analytics store timeout.
       */
      tier?: string;
    }
  | {
      v: string;
      chain: string;
      address: string;
      ranked: false;
      reason: string;
      traders: [];
      tier?: string;
    };

/** Outcome of one derived read. Four states, none mistakable for another. */
export type EvmReadResult<T> =
  | { kind: 'ok'; value: T }
  /** The server answered 404 — unknown ON THIS CHAIN. */
  | { kind: 'not-found' }
  /** Transport or upstream fault. Says NOTHING about the token. */
  | { kind: 'error'; status: number | null };

/**
 * Read one derived endpoint into the four-state result.
 *
 * The decoder is REQUIRED, not a nicety. Without it a 200 carrying anything at
 * all was cast straight to `T` and handed to a panel that immediately maps
 * over an array field — so an error envelope, a proxy's HTML, or a wire-shape
 * change throws inside render and takes the whole trade page down. A render
 * throw is the least honest failure available here: it destroys the loaded
 * panels beside it and reports nothing. A shape that does not check is an
 * `error`, which the panel already knows how to say out loud.
 */
async function readJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  decode: (value: unknown) => T | null,
  signal?: AbortSignal,
): Promise<EvmReadResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  } catch {
    return { kind: 'error', status: null };
  }
  if (response.status === 404) return { kind: 'not-found' };
  if (!response.ok) return { kind: 'error', status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A 200 with an unparseable body is an ERROR, not an empty result. An
    // empty result would render as "this token has no holders".
    return { kind: 'error', status: response.status };
  }
  const value = decode(body);
  if (value === null) return { kind: 'error', status: response.status };
  return { kind: 'ok', value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Does a decoded EVM read belong to the subject that was requested?
 *
 * EVM addresses are case-insensitive, but chains are not interchangeable: the
 * same address can exist on both served chains. A valid-looking 200 for the
 * wrong subject is therefore an error, never data we may paint under the
 * current route.
 */
export function responseMatchesEvmSubject(
  value: unknown,
  chain: string,
  address: string,
): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const responseChain = value['chain'];
  const responseAddress = value['address'];
  return (
    responseChain === chain
    && typeof responseAddress === 'string'
    && responseAddress.toLowerCase() === address.toLowerCase()
  );
}

/** Only the fields the renderers dereference are required. */
function isCandleSeries(
  value: unknown,
): value is Record<string, unknown> & { candles: unknown[] } {
  return isObject(value) && Array.isArray(value['candles']);
}

function isHolderPage(
  value: unknown,
): value is Record<string, unknown> & { holders: unknown[] } {
  return isObject(value) && Array.isArray(value['holders']);
}

function isTraderBoard(
  value: unknown,
): value is Record<string, unknown> & { ranked: boolean; traders: unknown[] } {
  // `ranked` is the discriminant the panel branches on BEFORE touching
  // `traders`, so it has to be a real boolean — `undefined` would fall into
  // the unranked branch and render a server error as "could not be ranked".
  return isObject(value)
    && typeof value['ranked'] === 'boolean'
    && Array.isArray(value['traders']);
}

const CANDLE_PAGE_CAP = 1_000;
const RANKED_PAGE_CAP = 200;

function readPageVersion(value: Record<string, unknown>): EvmWireVersion | null {
  return readEvmWireVersion(value['v']);
}

function readWideField(
  value: Record<string, unknown>,
  field: string,
  version: EvmWireVersion,
): number | null {
  return readWideUnsigned(value[field], version);
}

function optionalWideField(
  value: Record<string, unknown>,
  field: string,
  version: EvmWireVersion,
): number | undefined | null {
  return value[field] === undefined
    ? undefined
    : readWideUnsigned(value[field], version);
}

function optionalString(value: unknown): string | undefined | null {
  return value === undefined || value === null
    ? value
    : typeof value === 'string'
      ? value
      : null;
}

function optionalTier(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return readTier(value) ?? null;
}

function priceFields(
  row: Record<string, unknown>,
): Pick<EvmCandleRow,
  | 'openNum' | 'openDen'
  | 'highNum' | 'highDen'
  | 'lowNum' | 'lowDen'
  | 'closeNum' | 'closeDen'> | null {
  const result: Record<string, string> = {};
  let present = 0;
  for (const prefix of ['open', 'high', 'low', 'close'] as const) {
    const num = row[`${prefix}Num`];
    const den = row[`${prefix}Den`];
    if (num === undefined && den === undefined) continue;
    if (!isCanonicalUnsigned(num) || !isCanonicalUnsigned(den) || den === '0') return null;
    result[`${prefix}Num`] = num;
    result[`${prefix}Den`] = den;
    present += 1;
  }
  if (present !== 0 && present !== 4) return null;
  return result;
}

function parseCandleRow(
  value: unknown,
  version: EvmWireVersion,
): EvmCandleRow | null {
  if (!isObject(value)) return null;
  const bucketStartSec = readWideField(value, 'bucketStartSec', version);
  const tradeCount = readWideField(value, 'tradeCount', version);
  const lastBlockNumber = readWideField(value, 'lastBlockNumber', version);
  const prices = priceFields(value);
  if (
    bucketStartSec === null
    || tradeCount === null
    || lastBlockNumber === null
    || prices === null
    || !isCanonicalUnsigned(value['volumeNative'])
    || typeof value['needsRecompute'] !== 'boolean'
  ) return null;
  return {
    bucketStartSec,
    ...prices,
    volumeNative: value['volumeNative'],
    tradeCount,
    lastBlockNumber,
    needsRecompute: value['needsRecompute'],
  };
}

function parseCandleSeries(value: unknown): EvmCandleSeries | null {
  if (!isCandleSeries(value)) return null;
  const version = readPageVersion(value);
  const count = readBoundedUnsigned(value['count'], CANDLE_PAGE_CAP);
  if (
    version === null
    || count === null
    || typeof value['chain'] !== 'string'
    || typeof value['address'] !== 'string'
    || typeof value['resolution'] !== 'string'
    || typeof value['truncated'] !== 'boolean'
    || typeof value['stale'] !== 'boolean'
  ) return null;
  const total = readWideField(value, 'total', version);
  if (total === null || total < count || count !== value['candles'].length) return null;
  const candles: EvmCandleRow[] = [];
  let previousStart = -1;
  for (const raw of value['candles']) {
    const row = parseCandleRow(raw, version);
    if (row === null || row.bucketStartSec <= previousStart) return null;
    previousStart = row.bucketStartSec;
    candles.push(row);
  }
  if (
    value['truncated'] !== (total > count)
    || value['stale'] !== candles.some((row) => row.needsRecompute)
  ) return null;
  return {
    v: version,
    chain: value['chain'],
    address: value['address'],
    resolution: value['resolution'],
    count,
    total,
    truncated: value['truncated'],
    stale: value['stale'],
    candles,
  };
}

function parseHolderRow(
  value: unknown,
  version: EvmWireVersion,
): EvmHolderRow | null {
  if (!isObject(value) || typeof value['address'] !== 'string') return null;
  const firstSeenBlock = readWideField(value, 'firstSeenBlock', version);
  const lastBlockNumber = readWideField(value, 'lastBlockNumber', version);
  if (
    firstSeenBlock === null
    || lastBlockNumber === null
    || firstSeenBlock > lastBlockNumber
    || !isCanonicalUnsigned(value['balance'])
  ) return null;
  return {
    address: value['address'],
    balance: value['balance'],
    firstSeenBlock,
    lastBlockNumber,
  };
}

function parseHolderPage(value: unknown): EvmHolderPage | null {
  if (!isHolderPage(value)) return null;
  const version = readPageVersion(value);
  const count = readBoundedUnsigned(value['count'], RANKED_PAGE_CAP);
  if (
    version === null
    || count === null
    || typeof value['chain'] !== 'string'
    || typeof value['address'] !== 'string'
    || typeof value['partial'] !== 'boolean'
    || typeof value['truncated'] !== 'boolean'
    || typeof value['historyComplete'] !== 'boolean'
  ) return null;
  const holderCount = value['holderCount'] === null
    ? null
    : readWideField(value, 'holderCount', version);
  const observedHolders = readWideField(value, 'observedHolders', version);
  const underflowsClamped = readWideField(value, 'underflowsClamped', version);
  const partialReason = optionalString(value['partialReason']);
  const tier = optionalTier(value['tier']);
  if (
    (holderCount === null && value['holderCount'] !== null)
    || observedHolders === null
    || underflowsClamped === null
    || (partialReason === null && value['partialReason'] !== null)
    || tier === null
    || count !== value['holders'].length
    || observedHolders < count
    || value['partial'] !== (holderCount === null)
    || value['truncated'] !== (observedHolders > count)
    || (holderCount !== null && holderCount !== observedHolders)
  ) return null;
  const holders: EvmHolderRow[] = [];
  const seen = new Set<string>();
  for (const raw of value['holders']) {
    const row = parseHolderRow(raw, version);
    if (row === null) return null;
    const key = row.address.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    holders.push(row);
  }
  return {
    v: version,
    chain: value['chain'],
    address: value['address'],
    holderCount,
    partial: value['partial'],
    observedHolders,
    count,
    truncated: value['truncated'],
    holders,
    partialReason,
    historyComplete: value['historyComplete'],
    underflowsClamped,
    tier,
  };
}

function parseTraderRow(
  value: unknown,
  version: EvmWireVersion,
): EvmTraderRow | null {
  if (!isObject(value) || typeof value['trader'] !== 'string') return null;
  const boughtNative = value['boughtNative'];
  const soldNative = value['soldNative'];
  const tokensIn = value['tokensIn'];
  const tokensOut = value['tokensOut'];
  if (
    !isCanonicalUnsigned(boughtNative)
    || !isCanonicalUnsigned(soldNative)
    || !isCanonicalUnsigned(tokensIn)
    || !isCanonicalUnsigned(tokensOut)
  ) return null;
  const buyCount = readWideField(value, 'buyCount', version);
  const sellCount = readWideField(value, 'sellCount', version);
  const tradeCount = optionalWideField(value, 'tradeCount', version);
  const firstSeenBlock = readWideField(value, 'firstSeenBlock', version);
  const lastSeenBlock = readWideField(value, 'lastSeenBlock', version);
  const firstSeenSec = optionalWideField(value, 'firstSeenSec', version);
  const lastSeenSec = optionalWideField(value, 'lastSeenSec', version);
  if (
    buyCount === null
    || sellCount === null
    || tradeCount === null
    || firstSeenBlock === null
    || lastSeenBlock === null
    || firstSeenSec === null
    || lastSeenSec === null
    || firstSeenBlock > lastSeenBlock
    || (firstSeenSec === undefined) !== (lastSeenSec === undefined)
    || (firstSeenSec !== undefined && lastSeenSec !== undefined && firstSeenSec > lastSeenSec)
    || (
      tradeCount !== undefined
      && BigInt(tradeCount) !== BigInt(buyCount) + BigInt(sellCount)
    )
  ) return null;
  const volumeNative = value['volumeNative'];
  if (volumeNative !== undefined && !isCanonicalUnsigned(volumeNative)) return null;
  if (
    typeof volumeNative === 'string'
    && BigInt(volumeNative) !== BigInt(boughtNative) + BigInt(soldNative)
  ) return null;
  return {
    trader: value['trader'],
    boughtNative,
    soldNative,
    tokensIn,
    tokensOut,
    buyCount,
    sellCount,
    tradeCount,
    volumeNative,
    firstSeenBlock,
    lastSeenBlock,
    firstSeenSec,
    lastSeenSec,
  };
}

function parseTraderBoard(value: unknown): EvmTraderBoard | null {
  if (!isTraderBoard(value)) return null;
  if (
    typeof value['chain'] !== 'string'
    || typeof value['address'] !== 'string'
    || !Array.isArray(value['traders'])
  ) return null;
  const version = readPageVersion(value);
  const tier = optionalTier(value['tier']);
  if (version === null || tier === null) return null;
  if (!value['ranked']) {
    return typeof value['reason'] === 'string' && value['reason'].length > 0
      && value['traders'].length === 0
      ? {
          v: version,
          chain: value['chain'],
          address: value['address'],
          ranked: false,
          reason: value['reason'],
          traders: [],
          tier,
        }
      : null;
  }
  const count = readBoundedUnsigned(value['count'], RANKED_PAGE_CAP);
  const total = readWideField(value, 'total', version);
  const partialReason = optionalString(value['partialReason']);
  if (
    count === null
    || total === null
    || total < count
    || count !== value['traders'].length
    || typeof value['truncated'] !== 'boolean'
    || value['truncated'] !== (total > count)
    || typeof value['historyComplete'] !== 'boolean'
    || (partialReason === null && value['partialReason'] !== null)
  ) return null;
  const traders: EvmTraderRow[] = [];
  const seen = new Set<string>();
  for (const raw of value['traders']) {
    const row = parseTraderRow(raw, version);
    if (row === null) return null;
    const key = row.trader.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    traders.push(row);
  }
  return {
    v: version,
    chain: value['chain'],
    address: value['address'],
    ranked: true,
    count,
    total,
    truncated: value['truncated'],
    historyComplete: value['historyComplete'],
    partialReason,
    traders,
    tier,
  };
}

export interface EvmReadArgs {
  apiBase: string;
  chain: string;
  address: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function boundFetch(fetchImpl?: typeof fetch): typeof fetch {
  // Detaching `globalThis.fetch` from its receiver throws "Illegal
  // invocation" in the browser — the WebIDL binding requires `this` to be
  // the global. Same trap the discover lanes hit.
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

export function fetchEvmCandles(
  args: EvmReadArgs & { resolution: EvmResolution },
): Promise<EvmReadResult<EvmCandleSeries>> {
  return readJson<EvmCandleSeries>(
    evmCandlesUrl(args.apiBase, args.chain, args.address, args.resolution),
    boundFetch(args.fetchImpl),
    (value) => {
      const series = parseCandleSeries(value);
      return series !== null
        && responseMatchesEvmSubject(series, args.chain, args.address)
        && series.resolution === args.resolution
        ? series
        : null;
    },
    args.signal,
  );
}

export function fetchEvmHolders(
  args: EvmReadArgs & { limit?: number },
): Promise<EvmReadResult<EvmHolderPage>> {
  return readJson<EvmHolderPage>(
    evmHoldersUrl(args.apiBase, args.chain, args.address, args.limit),
    boundFetch(args.fetchImpl),
    (value) => {
      const page = parseHolderPage(value);
      return page !== null && responseMatchesEvmSubject(page, args.chain, args.address)
        ? page
        : null;
    },
    args.signal,
  );
}

export function fetchEvmTopTraders(
  args: EvmReadArgs & { limit?: number },
): Promise<EvmReadResult<EvmTraderBoard>> {
  return readJson<EvmTraderBoard>(
    evmTopTradersUrl(args.apiBase, args.chain, args.address, args.limit),
    boundFetch(args.fetchImpl),
    (value) => {
      const board = parseTraderBoard(value);
      return board !== null && responseMatchesEvmSubject(board, args.chain, args.address)
        ? board
        : null;
    },
    args.signal,
  );
}

/**
 * Outcome of the public trade-tape read.
 *
 * Its own union rather than `EvmReadResult<EvmTapePage>` because of the 404.
 * Every other read here answers 404 for "unknown on this chain", but
 * `/evm/trades` is documented never to 404 — the backend source answers an
 * explicitly `unavailable` page instead, precisely so a token nobody could
 * look up is not confused with a token nobody has traded. So a 404 reaching
 * this client cannot be a statement about the token; it means the ROUTE is not
 * there. That used to be the un-registered api proxy hop; the api registers it
 * now (see `evmTradesUrl`), so what remains is VERSION SKEW on either hop —
 * enumerated on the render branch in `EvmTradePage.tsx`. Folding it into
 * `not-found` would print "this indexer does not know this token" over a
 * missing deployment.
 */
export type EvmTapeResult =
  | { kind: 'ok'; value: EvmTapePage }
  /** The endpoint is not reachable at this URL. Says nothing about the token. */
  | { kind: 'route-missing' }
  | { kind: 'error'; status: number | null };

/**
 * Read one token's public trade tape.
 *
 * A 200 whose body does not parse as a tape page is an ERROR, not an empty
 * tape — the same rule the other reads apply, and it matters more here because
 * an empty tape is a claim about a token's whole trading life.
 */
export async function fetchEvmTrades(
  args: EvmReadArgs & { limit?: number },
): Promise<EvmTapeResult> {
  const url = evmTradesUrl(
    args.apiBase,
    args.chain,
    args.address,
    args.limit ?? TAPE_PAGE_LIMIT,
  );
  let response: Response;
  try {
    response = await boundFetch(args.fetchImpl)(url, {
      signal: args.signal,
      headers: { accept: 'application/json' },
    });
  } catch {
    return { kind: 'error', status: null };
  }
  if (response.status === 404) return { kind: 'route-missing' };
  if (!response.ok) return { kind: 'error', status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'error', status: response.status };
  }
  if (!responseMatchesEvmSubject(body, args.chain, args.address)) {
    return { kind: 'error', status: response.status };
  }
  const page = parseTapePage(body);
  return page === null
    ? { kind: 'error', status: response.status }
    : { kind: 'ok', value: page };
}

/**
 * A candle's close as a decimal-string ratio, or `null`.
 *
 * Exists so callers never reach into the `<field>Num`/`<field>Den` pair by
 * hand and half-check it — a present numerator with an absent denominator is
 * not a price, and treating it as one divides by an implicit 1.
 */
export function candleClose(row: EvmCandleRow): { num: string; den: string } | null {
  return row.closeNum !== undefined && row.closeDen !== undefined
    ? { num: row.closeNum, den: row.closeDen }
    : null;
}

/* ------------------------------------------------------------------------ */
/* PRESENTATION OF THE FOUR STATES.                                          */
/*                                                                           */
/* Pure, and here rather than inline in the panels, because the distinction   */
/* between "we measured none" and "nobody answered" is the substance and it   */
/* does not need a DOM to be wrong. Each function returns the SENTENCE, so    */
/* a panel cannot accidentally print the empty one over an unanswered read.   */
/* ------------------------------------------------------------------------ */

/** How a holder count may be presented — three readings, none interchangeable. */
export type HolderCountReading =
  /** Nobody answered. Not a count, not a bound, not zero. */
  | { readonly kind: 'unavailable' }
  /** The fold saw every transfer; this IS the number. */
  | { readonly kind: 'exact'; readonly count: number }
  /** Wallets seen over a partial history — a floor, labelled as one. */
  | { readonly kind: 'lower-bound'; readonly observed: number };

/**
 * Read a holder page's count into the only three claims it can support.
 *
 * The `unavailable` branch is the whole point. the backend source
 * answers a page whose `observedHolders` is 0 because nothing was observed —
 * no tier answered — and the panel rendered that as "at least 0", a sentence
 * that reads as a measured fact about a token that may have thousands of
 * holders and simply timed out of the analytics store.
 */
export function readHolderCount(page: EvmHolderPage): HolderCountReading {
  if (readTier(page.tier) === 'unavailable') return { kind: 'unavailable' };
  return page.holderCount !== null
    ? { kind: 'exact', count: page.holderCount }
    : { kind: 'lower-bound', observed: page.observedHolders };
}

/**
 * The sentence a holder page with NO ROWS is entitled to.
 *
 * `null` when the page has rows, so a caller cannot print it over a list.
 */
export function holdersEmptyText(page: EvmHolderPage): string | null {
  if (page.holders.length > 0) return null;
  switch (readTier(page.tier)) {
    case 'unavailable':
      return 'No tier could answer for this token’s holders, so they are unknown, not absent. The indexer’s resident memory did not hold it and the durable store did not respond — this token may have many holders.';
    case 'cold_empty':
      return 'The durable store was asked and holds no holder balances for this token.';
    default:
      return page.partial
        ? 'No holder balances observed yet on the partial history.'
        : 'No holders recorded for this token.';
  }
}

/**
 * Why this holder set is not authoritative, in the words a user reads.
 *
 * One sentence per INDEPENDENT fact, because they fail independently:
 * `partialReason` says what went wrong, `underflowsClamped` sizes how much of
 * the damage actually landed. A cold start that clamped nothing and one that
 * clamped 91% of its debits are the same `partial: true` and very different
 * pages.
 *
 * AND IT COMPOSES WITH THE TIER RATHER THAN FIGHTING IT — the same guard, in
 * the same place, as `traderProvenanceNotes`. the backend source
 * — nobody answered — builds a page from `HolderProvenance::unknown_token()`
 * and so arrives stamped `tier: "unavailable"` carrying `partialReason:
 * "unknown_token"`, reusing the holder vocabulary rather than minting a fourth
 * word. Printed literally, that says "this indexer has no record of this
 * token" directly above `holdersEmptyText`'s "this token may have many
 * holders" — the failed read asserting the very fact the sentence beside it
 * refuses to assert. On that tier the reason is a placeholder for "nobody
 * answered", not a claim, so the empty sentence owns the explanation alone.
 *
 * The guard is the TIER's and sits BEFORE the switch, not inside the
 * `unknown_token` case: an unavailable page also carries `partial: true`, so a
 * guard placed in the case would fall through to the default branch and print
 * the generic partial sentence over the same failed read.
 */
export function holderProvenanceNotes(page: EvmHolderPage): string[] {
  // Nobody answered. `holdersEmptyText` says so; see above.
  if (readTier(page.tier) === 'unavailable') return [];
  const notes: string[] = [];
  switch (page.partialReason) {
    case 'unknown_token':
      notes.push(
        'This indexer has no record of this token, so its holders are unknown rather than none.',
      );
      break;
    case 'awaiting_recompute':
      // NOT the trader sentence, and deliberately so. On the leaderboard a
      // reorg's damage is the ONE reason that rewards patience — the repair
      // worker rebuilds boards from the canonical trade tape. Holders have no
      // such tape: the backend source queues only candle and board keys,
      // the backend source documents holders as "the honest unrepairable
      // case", and an internal routine has no production caller. The old
      // wording here — "nothing can rebuild them until it does" — promised a
      // recompute that never lands, which is the same manufactured
      // reassurance this module exists to refuse.
      notes.push(
        'A reorg invalidated this holder set, so these balances are not current. Transfers are on no tape and there is no undo journal, so nothing can rebuild them: unlike the leaderboard, a reorged holder set is not repaired today, and waiting will not fix it.',
      );
      break;
    case 'partial_history':
      notes.push(
        'Partial history: this token was first observed after some of its transfers, so the holder count is unavailable rather than zero and the balances below are LOWER BOUNDS, not measurements.',
      );
      break;
    default:
      // No reason on the wire. Say only what `partial` itself supports.
      if (page.partial) {
        notes.push(
          'Partial history: the holder count is unavailable rather than zero. The wallets below are the ones we have seen.',
        );
      }
      break;
  }
  const clamped = page.underflowsClamped ?? 0;
  if (clamped > 0) {
    notes.push(
      `${clamped} debit${clamped === 1 ? '' : 's'} clamped at zero on this token because the wallet was funded before the indexer started, so at least that many balances below are understated.`,
    );
  }
  return notes;
}

/**
 * The sentence a leaderboard with NO ROWS is entitled to.
 *
 * `null` when it has rows. The `unavailable` tier is a RANKED empty board
 * (the backend source), so `ranked` alone cannot catch it —
 * which is exactly how a failed read came to render as "No trades observed
 * for this token yet".
 */
export function tradersEmptyText(board: EvmTraderBoard): string | null {
  if (board.traders.length > 0) return null;
  switch (readTier(board.tier)) {
    case 'unavailable':
      return 'No tier could answer for this token’s traders, so they are unknown, not absent. The indexer’s resident memory did not hold it and the durable store did not respond — this token may be trading heavily right now.';
    case 'cold_empty':
      return 'The durable store was asked and holds no trades for this token in its 60-day retention window.';
    default:
      return 'The indexer holds no trades for this token.';
  }
}

/**
 * Why this leaderboard is not authoritative, in the words a user reads.
 *
 * The trader half of `holderProvenanceNotes`, and deliberately the same shape:
 * the server spells the reason with the same three words on both endpoints
 * (the backend source / `holder_page`), so the two panels must not grow
 * two vocabularies for it.
 *
 * THE DISTINCTION IS THE POINT, because only one of the three rewards
 * patience. `awaiting_recompute` is a reorg's damage awaiting a repair that
 * has not landed — it can resolve. `partial_history` is a board built from a
 * tape that started mid-life — the missing trades were never on any tape, so
 * waiting cannot complete it. `unknown_token` is not a statement about
 * trading at all.
 *
 * AND IT COMPOSES WITH THE TIER RATHER THAN FIGHTING IT.
 * the backend source — nobody answered — builds a RANKED,
 * EMPTY board stamped `tier: "unavailable"` and reuses `unknown_token` as its
 * reason rather than minting a fourth word. Printed literally, that would say
 * "this indexer has no record of this token" directly above
 * `tradersEmptyText`'s "this token may be trading heavily right now" — the
 * failed read asserting the very fact the sentence beside it refuses to
 * assert. On that tier the reason is a placeholder, not a claim, so the empty
 * sentence owns the explanation alone.
 */
export function traderProvenanceNotes(board: EvmTraderBoard): string[] {
  // An unranked board is not a partial board — no total order exists over
  // these wallets, which the panel says in its own branch. Nothing here.
  if (!board.ranked) return [];
  // Nobody answered. `tradersEmptyText` says so; see above.
  if (readTier(board.tier) === 'unavailable') return [];
  switch (board.partialReason) {
    case 'unknown_token':
      return [
        'This indexer has no record of this token, so its traders are unknown rather than none.',
      ];
    case 'awaiting_recompute':
      return [
        'A reorg invalidated this leaderboard and the recompute has not landed, so this ranking is not current. It is expected to resolve once the repair runs.',
      ];
    case 'partial_history':
      return [
        'Partial history: this token was first observed after some of its trades, so this ranks the trades we saw, not the token. Those earlier trades are on no tape, so waiting will not complete it.',
      ];
    default:
      // No reason on the wire — an older server. Say only what
      // `historyComplete` itself supports, without naming a cause for it.
      return board.historyComplete
        ? []
        : [
            'Ranked over the trades we observed, not over the token’s full history — this token was first seen at the cursor.',
          ];
  }
}

/* ------------------------------------------------------------------------ */
/* THE STOCK-QUOTED MARKET, SAID ONCE.                                       */
/*                                                                           */
/* A market whose money leg is not the chain's own coin withholds a figure   */
/* in four places at once: the stats block's three quote-denominated words,   */
/* the chart's price level, the tape's cost column and the leaderboard's two  */
/* money columns. Every one of those omissions is real and each loses         */
/* something DIFFERENT, so all four are still disclosed.                      */
/*                                                                           */
/* What they must not do is each re-derive the SAME premise — "this market    */
/* is quoted in <token> and the indexer publishes no decimals for it". Three  */
/* of them did, at full sentence length, inside about 1,400px. Read top to    */
/* bottom the page stopped reading as one explained absence and started       */
/* reading as four separate faults, which is the opposite of what the         */
/* disclosures are for.                                                       */
/*                                                                           */
/* So the PREMISE is stated once, in the stats block                          */
/* (`discoverAdapter.ts::quoteUnitsUnavailableText` — it names the quote      */
/* token, names the missing decimals, and says which side of the market is    */
/* unaffected), and the three panels below say only their own CONSEQUENCE:    */
/* what is missing, that it was withheld rather than lost, and what survives  */
/* beside it. Shorter, not emptier — a reader who lands mid-page still learns  */
/* a number is absent on purpose.                                             */
/*                                                                           */
/* One function over a closed surface rather than three constants, for the    */
/* same reason `holderProvenanceNotes` and `traderProvenanceNotes` are twins  */
/* in one module: the three lines are a family and a panel that grew its own  */
/* wording would put the redundancy straight back.                            */
/* ------------------------------------------------------------------------ */

/** Which panel is explaining its own missing figure. */
export type QuoteUnitsSurface = 'chart' | 'tape' | 'traders';

/**
 * The consequence line for one panel on a market quoted in a token whose
 * scale the wire does not carry.
 *
 * Deliberately names NO token and NO cause — the stats block above owns both.
 * "withheld rather than shown at a scale nobody measured" is the load-bearing
 * clause: it is what separates a figure we declined to fabricate from a figure
 * that simply failed to arrive.
 */
export function quoteUnitsWithheldText(surface: QuoteUnitsSurface): string {
  switch (surface) {
    case 'chart':
      // Lower-cased and unterminated: this one renders inline in the chart
      // header, beside the price it is standing in for.
      return 'price level unavailable — withheld rather than drawn at a scale nobody measured; the shape of the series is unaffected';
    case 'tape':
      return 'What each trade paid is unavailable — withheld rather than shown at a scale nobody measured. Side, token size and timing are unaffected.';
    case 'traders':
      return 'Bought and sold are unavailable — withheld rather than shown at a scale nobody measured. The ranking and the token columns are unaffected.';
  }
}

/**
 * What `droppedOlder` means on THIS page, said in the tier's own terms.
 *
 * The server sends one field for two different quantities and cannot be
 * changed from here. On the resident tier it is an internal routine — trades
 * the in-memory ring has pushed out at its cap SINCE THE PROCESS BOOTED
 * (the backend source). On the cold tier it is `total - rows.len()` — store
 * rows beyond this page (the backend source). A single sentence printed for both
 * reads "10 older trades are not in this page" when the true gap is 4,811.
 *
 * So each tier gets its own sentence, and a tier the server did not stamp
 * gets one that admits the count is tier-relative rather than naming a total
 * it cannot support.
 */
export function droppedOlderText(
  droppedOlder: string | null,
  tier: EvmReadTier | null,
): string | null {
  if (droppedOlder === null) return null;
  switch (tier) {
    case 'fold':
      return `Live window: ${droppedOlder} trades have been pushed out of the indexer’s in-memory ring since it started, and are not counted against this token’s full history — older trades may exist beyond them in the durable store.`;
    case 'cold':
    case 'cold_empty':
      return `Partial history: the durable store holds ${droppedOlder} more trades for this token than this page carries.`;
    default:
      return `Partial history: ${droppedOlder} older trades are not in this page. This count is relative to whichever tier answered and is not a total for the token.`;
  }
}

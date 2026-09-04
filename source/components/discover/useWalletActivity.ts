import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { rememberLiveTokenMint } from '@/components/listen/navigation';
import { subscribeStreamGeneration } from '@/lib/state/stream-generation';

export interface WalletActivityEvent {
  /** Solana tx signature — also used as a stable React key. */
  signature:    string;
  /** Slot the trade landed in. 0 if unknown. */
  slot:         number;
  /** Block time (ms since epoch), null when not yet propagated. */
  blockTimeMs:  number | null;
  /** Tracked wallet that performed the trade. */
  wallet:       string;
  /** Pump.fun mint that was traded. */
  mint:         string;
  /** True for buys (token delta positive), false for sells. */
  isBuy:        boolean;
  /** Absolute SOL delta on the wallet, in lamports (string-encoded bigint). */
  solLamports:  string;
  /** Absolute token delta in raw base units (string-encoded bigint). */
  tokens:       string;
  /** 'bonding_curve' or 'amm' depending on which program touched the tx. */
  venue:        'bonding_curve' | 'amm';
  /** Wallet's post-trade balance for the mint (raw base units). Null when
   *  unknown (persister-backfilled events carry no balance) — consumers
   *  must treat missing as unknown, never as zero. */
  postTokens?:  string | null;
  /** Post-trade spot market cap in lamports (string-encoded bigint),
   *  computed server-side from the tx's own pool state — exact, unlike
   *  the sol/token ratio, which bundles fees/tips/rent. Null when the
   *  server could not compute it honestly (and on rows persisted before
   *  the field existed) — consumers fall back to the ratio heuristic. */
  mcLamports?:  string | null;
  /** Local arrival timestamp, set on receive. */
  receivedAtMs: number;
  /** True when the frame arrived in a fresh connection's backfill window —
   *  the server replays recent persisted trades on every connect, and those
   *  arrive with receivedAtMs = now, defeating arrival-freshness gates.
   *  Feed/history consumers render replayed events normally; toast/sound
   *  consumers MUST skip them (a cold Discover load used to replay the last
   *  few trades as loud live toasts). */
  replayed?: boolean;
}

interface RawWalletActivityEvent {
  signature?:    string;
  slot?:         number;
  blockTimeMs?:  number | null;
  wallet?:       string;
  mint?:         string;
  isBuy?:        boolean;
  solLamports?:  string;
  tokens?:       string;
  postTokens?:   string;
  mcLamports?:   string;
  venue?:        string;
}

interface Options {
  /** Maximum events to retain in the rolling buffer. Defaults to 400. */
  maxEvents?: number;
  /**
   * Dormant mode (hidden persistent pane): hold the shared stream + rolling
   * buffer open — this consumer's ref may be the only thing keeping the
   * connection alive — but suppress the per-event React notification so the
   * hidden subtree never re-renders per trade. Flipping back resubscribes
   * and re-reads the buffer, so reveal is lossless.
   */
  dormant?: boolean;
  /** Side effect per event suppressed by `dormant` (e.g. the wallet chime). */
  onDormantEvent?: (event: WalletActivityEvent) => void;
  /**
   * Client-side wallet filter. The SUBSCRIPTION key stays `wallets`
   * (the superset), so every consumer on a page shares ONE EventSource,
   * one server backfill and one buffer; `only` narrows what this
   * consumer sees and reacts to. Events outside the set neither wake
   * React nor fire `onDormantEvent`. This is what keeps N alert-flag
   * variants (feed/toast/bubble) from minting N streams — flag toggles
   * change the filter, never the connection.
   */
  only?: ReadonlySet<string>;
}

/**
 * Above this URL length the stream is opened through a POST'd
 * subscription id instead of inline wallets — which costs a FULL EXTRA
 * ROUND TRIP before the EventSource is even created, on every cold boot
 * and every reconnect. At the old 1500 the crossover was ~33 wallets, so
 * ordinary tracker users paid it. the edge accepts a request line up to its
 * `large_client_header_buffers` size (default 4 8k, and terminal-alpha.conf
 * does not override it), so 6000 stays far inside the limit while covering
 * ~130 wallets inline. Beyond that the subscription POST still applies.
 */
const INLINE_WALLETS_URL_LIMIT = 6_000;
const WALLET_ACTIVITY_SESSION_CACHE_PREFIX = 'discover:wallet-activity:last-events:session:v1:';
const WALLET_ACTIVITY_LOCAL_CACHE_PREFIX = 'discover:wallet-activity:last-events:local:v1:';
/**
 * Render-cache lifetime. This was 10 minutes, which meant the cache only
 * ever survived a reload — the ordinary cold boot (come back later in the
 * day, open the terminal) always found it expired and the feed sat EMPTY
 * until the wallet list, the SSE connect and the server backfill had all
 * completed. A day covers "yesterday's session", and stale rows are
 * self-evident because every row renders its own age.
 */
const WALLET_ACTIVITY_CACHE_TTL_MS = 24 * 60 * 60_000;
const WALLET_ACTIVITY_CACHE_FLUSH_DELAY_MS = 2_000;
/**
 * Events persisted per wallet-set. The in-memory buffer holds 400, but a
 * cold boot only needs enough to paint the feed before the live stream
 * takes over — and the blob is written to BOTH storages, under a TTL now
 * 144x longer, so keeping all 400 (~100KB each) would crowd the quota for
 * no visible gain.
 */
const WALLET_ACTIVITY_CACHE_MAX_EVENTS = 120;
/** The shared buffer now interleaves ALL tracked wallets (consumers
 *  filter with `only`), so a narrow consumer sees fewer post-filter
 *  rows per buffered event. 400 × ~250B ≈ 100KB — cheaper than the
 *  2-4 per-set buffers this replaced. */
const DEFAULT_MAX_EVENTS = 400;
const RECONNECT_DELAY_MS = 1_500;
const RECONNECT_DELAY_MAX_MS = 12_000;
/** Keep a zero-ref stream alive briefly so a discover↔trade navigation
 *  reuses the connection + buffer instead of thrashing connect/teardown. */
const TEARDOWN_LINGER_MS = 5_000;
/** Frames arriving this soon after a connection opened are the server's
 *  history backfill (~30 persisted trades replayed on every connect) —
 *  marked `replayed` so toast/sound consumers skip them. The replay burst
 *  lands well inside a second; the margin covers a slow first flush. */
const CONNECT_REPLAY_GRACE_MS = 2_500;

const EMPTY_EVENTS: WalletActivityEvent[] = [];

/**
 * Module-level, ref-counted SSE client (same pattern as
 * `usePositionsStream`). ONE EventSource per wallet-set key is shared
 * across every consumer of that set, so a page calling the hook several
 * times with the same wallets opens exactly one connection and parses
 * each frame once. Consumers subscribe via `useSyncExternalStore`, so a
 * trade event re-renders only the components reading the events — not
 * whatever page root happens to host the hook's former useState.
 */
interface StreamEntry {
  readonly walletKey: string;
  readonly walletList: string[];
  /** Newest-first rolling buffer shared by every consumer of this key. */
  events: WalletActivityEvent[];
  /** Largest `maxEvents` any consumer asked for; bounds the buffer. */
  bufferCap: number;
  seenEventKeys: Set<string>;
  stream: EventSource | null;
  /** Guards against double-connect while `connect()` awaits its URL. */
  connecting: boolean;
  refCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Consecutive failed connects — drives exponential reconnect backoff. */
  reconnectAttempts: number;
  /** Pending deferred teardown after the last consumer unsubscribed. */
  lingerTimer: ReturnType<typeof setTimeout> | null;
  /** Aborts an in-flight subscription POST on teardown. */
  connectAbort: AbortController | null;
  /** When the CURRENT EventSource was opened — frames arriving within
   *  CONNECT_REPLAY_GRACE_MS of this are backfill (see `replayed`). */
  connectionEpochMs: number;
  cacheFlushHandle: ReturnType<typeof setTimeout> | null;
  /** Bumped on teardown so an in-flight async connect() aborts cleanly. */
  generation: number;
  /** Called per appended event; React consumers ignore the payload. */
  readonly listeners: Set<(event: WalletActivityEvent) => void>;
}

const entries = new Map<string, StreamEntry>();

// Bfcache restore: a `pageshow persisted` restore leaves every
// EventSource the page held closed, but no React effect re-runs for
// this module-level singleton — the feed would silently freeze until a
// remount. The stream-generation store bumps once per restore; force a
// reconnect for every entry that still has consumers.
if (typeof window !== 'undefined') {
  subscribeStreamGeneration(() => {
    for (const [key, entry] of entries) {
      if (entry.refCount <= 0) continue;
      entry.stream?.close();
      entry.stream = null;
      if (entry.reconnectTimer !== null) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      entry.reconnectAttempts = 0;
      if (!entry.connecting) void connect(key);
    }
  });
}

function notify(entry: StreamEntry, event: WalletActivityEvent): void {
  for (const listener of entry.listeners) listener(event);
}

// Trailing-throttle the render cache write off the SSE hot path
// (same pattern as useDiscoverFeedIngestion's cache flush).
function scheduleCacheFlush(entry: StreamEntry): void {
  if (entry.cacheFlushHandle !== null) return;
  entry.cacheFlushHandle = setTimeout(() => {
    entry.cacheFlushHandle = null;
    writeCachedWalletActivityEvents(entry.walletKey, entry.events);
  }, WALLET_ACTIVITY_CACHE_FLUSH_DELAY_MS);
}

function append(entry: StreamEntry, raw: RawWalletActivityEvent): void {
  const normalized = normalize(raw);
  if (!normalized) return;
  // Backfill marking: everything inside the first moments of a connection
  // is the server's history replay, not a live trade. A genuinely live
  // trade landing in this window is still buffered/rendered — it just
  // doesn't toast/ring, which is the correct trade-off vs re-ringing the
  // last N historical trades on every cold load / reconnect.
  const event: WalletActivityEvent =
    Date.now() - entry.connectionEpochMs < CONNECT_REPLAY_GRACE_MS
      ? { ...normalized, replayed: true }
      : normalized;
  const eventKey = `${event.signature}:${event.wallet}`;
  if (entry.seenEventKeys.has(eventKey)) return;
  entry.seenEventKeys.add(eventKey);
  // A live (non-replayed) event IS this mint trading through the ingestion
  // pipeline right now, so the engine holds hot state for it. Marking it
  // live-seen lets a click on the row/toast take the trade page's warm
  // "known mint" path (instant honest paint) instead of the cold
  // unknown-mint path, whose em-dash placeholders read as mock data.
  // Memory-only write — storage flush is batched off this hot path.
  if (!event.replayed) rememberLiveTokenMint(event.mint);
  const next = [event, ...entry.events];
  if (next.length > entry.bufferCap) next.length = entry.bufferCap;
  entry.events = next;
  scheduleCacheFlush(entry);
  // Garbage-collect dedupe set when it grows large.
  if (entry.seenEventKeys.size > entry.bufferCap * 4) {
    entry.seenEventKeys = new Set([...entry.seenEventKeys].slice(-entry.bufferCap * 2));
  }
  notify(entry, event);
}

function scheduleReconnect(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.refCount <= 0 || entry.reconnectTimer !== null) return;
  // Exponential backoff (1.5s → 12s cap) so a persistent upstream failure
  // doesn't open/close sockets in a tight loop and starve the connection
  // budget the order POST shares (matches wallet-balance-stream's pattern).
  // Jittered (0.5-1.0x): a server restart must not synchronize the
  // reconnect herd (same idiom as the Discover feed hooks).
  const delay = Math.round(
    Math.min(
      RECONNECT_DELAY_MS * 2 ** Math.min(entry.reconnectAttempts, 4),
      RECONNECT_DELAY_MAX_MS,
    ) * (0.5 + Math.random() * 0.5),
  );
  entry.reconnectAttempts += 1;
  entry.reconnectTimer = setTimeout(() => {
    const current = entries.get(key);
    if (current) current.reconnectTimer = null;
    void connect(key);
  }, delay);
}

async function connect(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry || entry.refCount <= 0 || entry.connecting) return;
  const generation = entry.generation;
  entry.connecting = true;
  entry.stream?.close();
  entry.stream = null;
  const abort = new AbortController();
  entry.connectAbort = abort;
  let streamUrl: string | null;
  try {
    streamUrl = await walletActivityStreamUrl(entry.walletList, entry.walletKey, abort.signal);
  } catch {
    if (entries.get(key) === entry && entry.generation === generation) {
      entry.connecting = false;
      entry.connectAbort = null;
      scheduleReconnect(key);
    }
    return;
  }
  if (entries.get(key) !== entry || entry.generation !== generation) {
    // Torn-down/superseded entry: clear the latch anyway so a stale
    // reference can never read as permanently "connecting".
    entry.connecting = false;
    return;
  }
  entry.connecting = false;
  entry.connectAbort = null;
  if (entry.refCount <= 0 || !streamUrl) return;
  const next = new EventSource(streamUrl);
  entry.stream = next;
  entry.connectionEpochMs = Date.now();
  next.onopen = () => {
    const current = entries.get(key);
    if (current && current.stream === next) current.reconnectAttempts = 0;
  };
  next.addEventListener('trade', (event) => {
    const current = entries.get(key);
    if (!current || current.stream !== next) return;
    try {
      append(current, JSON.parse((event as MessageEvent).data) as RawWalletActivityEvent);
    } catch {
      // Ignore malformed SSE frames / heartbeats.
    }
  });
  next.onerror = () => {
    next.close();
    const current = entries.get(key);
    if (current && current.stream === next) {
      current.stream = null;
      scheduleReconnect(key);
    }
  };
}

function teardown(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.generation += 1;
  if (entry.reconnectTimer !== null) clearTimeout(entry.reconnectTimer);
  if (entry.lingerTimer !== null) clearTimeout(entry.lingerTimer);
  entry.connectAbort?.abort();
  if (entry.cacheFlushHandle !== null) {
    clearTimeout(entry.cacheFlushHandle);
    writeCachedWalletActivityEvents(entry.walletKey, entry.events);
  }
  entry.stream?.close();
  entries.delete(key);
}

/**
 * Wallet-set churn (e.g. the tracker's DB merge adding a wallet moments
 * after mount) mints a NEW walletKey, so the persisted render cache
 * misses and the feed used to go blank until the new connection's
 * server backfill landed. The OLD set's entry is still alive (the
 * teardown linger holds it for a few seconds), so seed from the
 * sibling with the most overlapping events instead. Seeds are marked
 * `replayed` so toast/sound consumers never re-ring them.
 */
function seedFromSiblingEntries(walletKey: string, maxEvents: number): WalletActivityEvent[] {
  const walletSet = new Set(walletKey.split(','));
  let best: WalletActivityEvent[] = EMPTY_EVENTS;
  for (const sibling of entries.values()) {
    if (sibling.walletKey === walletKey || sibling.events.length === 0) continue;
    const candidate = sibling.events.filter((event) => walletSet.has(event.wallet));
    if (candidate.length > best.length) best = candidate;
  }
  if (best.length === 0) return EMPTY_EVENTS;
  const marked = best.map((event) => (event.replayed === true ? event : { ...event, replayed: true }));
  return marked.length > maxEvents ? marked.slice(0, maxEvents) : marked;
}

function acquire(
  walletKey: string,
  maxEvents: number,
  listener: (event: WalletActivityEvent) => void,
): () => void {
  let entry = entries.get(walletKey);
  if (!entry) {
    let cached = readCachedWalletActivityEvents(walletKey, maxEvents);
    if (cached.length === 0) cached = seedFromSiblingEntries(walletKey, maxEvents);
    entry = {
      walletKey,
      walletList: walletKey.split(','),
      events: cached.length > 0 ? cached : EMPTY_EVENTS,
      bufferCap: maxEvents,
      seenEventKeys: new Set(cached.map((event) => `${event.signature}:${event.wallet}`)),
      stream: null,
      connecting: false,
      refCount: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
      lingerTimer: null,
      connectAbort: null,
      connectionEpochMs: 0,
      cacheFlushHandle: null,
      generation: 0,
      listeners: new Set(),
    };
    entries.set(walletKey, entry);
  }
  if (entry.lingerTimer !== null) {
    clearTimeout(entry.lingerTimer);
    entry.lingerTimer = null;
  }
  entry.bufferCap = Math.max(entry.bufferCap, maxEvents);
  entry.listeners.add(listener);
  entry.refCount += 1;
  if (entry.stream === null && entry.reconnectTimer === null && !entry.connecting) {
    void connect(walletKey);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(walletKey);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount <= 0 && current.lingerTimer === null) {
      // Defer teardown so a quick page transition that re-subscribes the
      // same wallet set reuses the live connection + buffer.
      current.lingerTimer = setTimeout(() => {
        const latest = entries.get(walletKey);
        if (!latest) return;
        latest.lingerTimer = null;
        if (latest.refCount <= 0) teardown(walletKey);
      }, TEARDOWN_LINGER_MS);
    }
  };
}

/**
 * SSE-backed feed of pump.fun trades performed by tracked wallets.
 *
 * Re-subscribes (and the shared client reconnects) whenever the wallet
 * set changes, so adding/removing wallets in the tracker popover takes
 * effect on the very next trade. The returned `events` array is
 * newest-first, capped at `maxEvents`.
 */
export function useWalletActivity(wallets: ReadonlySet<string>, options: Options = {}): {
  events: WalletActivityEvent[];
} {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const dormant = options.dormant === true;
  // Ref'd so a new callback identity never forces a resubscribe.
  const onDormantEventRef = useRef(options.onDormantEvent);
  onDormantEventRef.current = options.onDormantEvent;
  const only = options.only;
  const onlyRef = useRef(only);
  onlyRef.current = only;
  const walletKey = useMemo(() => [...wallets].sort().join(','), [wallets]);
  // Membership key (not set identity) so a same-content Set rebuild
  // never invalidates the snapshot or forces a resubscribe.
  const onlyKey = useMemo(() => (only ? [...only].sort().join(',') : null), [only]);

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (walletKey.length === 0 || !isIngestionApiConfigured()) return () => {};
      // The per-event gate reads `onlyRef` so a filter change costs
      // nothing; events from muted wallets neither wake React nor fire
      // the dormant side effect.
      return acquire(walletKey, maxEvents, (event) => {
        const filter = onlyRef.current;
        if (filter && !filter.has(event.wallet)) return;
        if (dormant) {
          // Dormant: keep the ref (stream + rolling buffer stay alive)
          // but do NOT wake React per event; the dormancy flip swaps
          // this subscribe function, and the resubscribe re-reads the
          // buffer synchronously.
          onDormantEventRef.current?.(event);
          return;
        }
        onChange();
      });
    },
    [walletKey, maxEvents, dormant],
  );
  // `useSyncExternalStore` requires a referentially-stable snapshot, so
  // the filtered view is cached per (buffer identity, filter membership).
  const snapshotCache = useRef<{
    raw: WalletActivityEvent[] | null;
    onlyKey: string | null;
    out: WalletActivityEvent[];
  }>({ raw: null, onlyKey: null, out: EMPTY_EVENTS });
  const getSnapshot = useCallback((): WalletActivityEvent[] => {
    if (walletKey.length === 0) return EMPTY_EVENTS;
    const raw = entries.get(walletKey)?.events ?? EMPTY_EVENTS;
    const cache = snapshotCache.current;
    if (cache.raw === raw && cache.onlyKey === onlyKey) return cache.out;
    const filter = onlyRef.current;
    cache.raw = raw;
    cache.onlyKey = onlyKey;
    cache.out = filter ? raw.filter((event) => filter.has(event.wallet)) : raw;
    return cache.out;
  }, [walletKey, onlyKey]);
  const allEvents = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_EVENTS);
  const events = useMemo(
    () => (allEvents.length > maxEvents ? allEvents.slice(0, maxEvents) : allEvents),
    [allEvents, maxEvents],
  );
  return { events };
}

/** Test-only: tear down all shared streams + clear state between tests. */
export function _resetWalletActivityForTests(): void {
  for (const key of [...entries.keys()]) teardown(key);
}

async function walletActivityStreamUrl(
  wallets: string[],
  walletKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const inlineUrl = ingestionApiUrl(`/api/wallet-activity/stream?wallets=${encodeURIComponent(walletKey)}`);
  if (!inlineUrl) return null;
  if (inlineUrl.length <= INLINE_WALLETS_URL_LIMIT) return inlineUrl;

  const subscriptionUrl = ingestionApiUrl('/api/wallet-activity/subscription');
  if (!subscriptionUrl) return null;
  // A hung subscription POST would wedge the entry's `connecting` flag
  // forever (no reconnect is scheduled while connecting) — bound it so a
  // stall becomes a thrown error → scheduleReconnect path.
  const timeout = AbortSignal.timeout(10_000);
  const resp = await fetch(subscriptionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallets }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!resp.ok) throw new Error(`wallet_activity_subscription_${resp.status}`);
  const body = (await resp.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('wallet_activity_subscription_missing_id');
  }
  return ingestionApiUrl(`/api/wallet-activity/stream?session=${encodeURIComponent(body.id)}`);
}

/**
 * Address-poisoning floor (the "transfer scam" gate). Scam activity —
 * unpaid transfer receipts, delegate drains, dusting — reaches the feed as
 * events whose SOL value is zero or dust: the producer's decode rules
 * gate NEW events, but the last-30 DB backfill replays historical rows
 * written before those rules existed, and the producer process ships on
 * its own cadence. This client gate is the belt-and-braces choke point
 * every surface (tracker feed, discover dock, toasts, trade page) reads
 * through, so scam rows can never render regardless of which side lags.
 * Real trades below 0.001 SOL are indistinguishable-from-dust noise for a
 * tracking surface and are dropped with them.
 */
export const MIN_ACTIVITY_SOL_LAMPORTS = 1_000_000n; // 0.001 SOL

/** True when the string-encoded lamports value is below the poisoning
 *  floor (or malformed — unparseable never renders as a trade). */
export function isDustActivityLamports(solLamports: string): boolean {
  try {
    return BigInt(solLamports) < MIN_ACTIVITY_SOL_LAMPORTS;
  } catch {
    return true;
  }
}

function normalize(raw: RawWalletActivityEvent): WalletActivityEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.signature !== 'string' || !raw.signature) return null;
  if (typeof raw.wallet !== 'string' || !raw.wallet) return null;
  if (typeof raw.mint !== 'string' || !raw.mint) return null;
  if (typeof raw.isBuy !== 'boolean') return null;
  if (isDustActivityLamports(typeof raw.solLamports === 'string' ? raw.solLamports : '0')) {
    return null;
  }
  const venue = raw.venue === 'amm' ? 'amm' : 'bonding_curve';
  return {
    signature:    raw.signature,
    slot:         typeof raw.slot === 'number' ? raw.slot : 0,
    blockTimeMs:  typeof raw.blockTimeMs === 'number' ? raw.blockTimeMs : null,
    wallet:       raw.wallet,
    mint:         raw.mint,
    isBuy:        raw.isBuy,
    solLamports:  typeof raw.solLamports === 'string' ? raw.solLamports : '0',
    tokens:       typeof raw.tokens === 'string' ? raw.tokens : '0',
    postTokens:   typeof raw.postTokens === 'string' ? raw.postTokens : null,
    mcLamports:   typeof raw.mcLamports === 'string' ? raw.mcLamports : null,
    venue,
    receivedAtMs: Date.now(),
  };
}

function readCachedWalletActivityEvents(walletKey: string, maxEvents: number): WalletActivityEvent[] {
  if (typeof window === 'undefined' || walletKey.length === 0) return [];
  const local = readCachedWalletActivityEventsFromStorage(
    () => window.localStorage,
    walletActivityCacheKey(WALLET_ACTIVITY_LOCAL_CACHE_PREFIX, walletKey),
    maxEvents,
  );
  if (local.length > 0) return local;
  return readCachedWalletActivityEventsFromStorage(
    () => window.sessionStorage,
    walletActivityCacheKey(WALLET_ACTIVITY_SESSION_CACHE_PREFIX, walletKey),
    maxEvents,
  );
}

/**
 * Sweep expired render-cache blobs. Every historical wallet-set key
 * (each add/remove used to mint one) left an orphaned ~200-event JSON
 * blob that nothing removed — the TTL was only enforced on a read of
 * that exact key. Runs once per entry creation (rare), O(storage keys).
 */
function sweepExpiredWalletActivityCaches(): void {
  if (typeof window === 'undefined') return;
  for (const storage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = storage();
      const stale: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (
          key === null ||
          (!key.startsWith(WALLET_ACTIVITY_LOCAL_CACHE_PREFIX) &&
            !key.startsWith(WALLET_ACTIVITY_SESSION_CACHE_PREFIX))
        ) {
          continue;
        }
        try {
          const parsed = JSON.parse(store.getItem(key) ?? '') as { savedAtMs?: unknown };
          if (
            typeof parsed.savedAtMs !== 'number' ||
            Date.now() - parsed.savedAtMs > WALLET_ACTIVITY_CACHE_TTL_MS
          ) {
            stale.push(key);
          }
        } catch {
          stale.push(key);
        }
      }
      for (const key of stale) store.removeItem(key);
    } catch {
      // Storage unavailable (private mode) — nothing to sweep.
    }
  }
}

function writeCachedWalletActivityEvents(walletKey: string, events: readonly WalletActivityEvent[]): void {
  if (typeof window === 'undefined' || walletKey.length === 0 || events.length === 0) return;
  const payload = JSON.stringify({
    savedAtMs: Date.now(),
    walletKey,
    events: events.length > WALLET_ACTIVITY_CACHE_MAX_EVENTS
      ? events.slice(0, WALLET_ACTIVITY_CACHE_MAX_EVENTS)
      : events,
  });
  try {
    window.localStorage.setItem(walletActivityCacheKey(WALLET_ACTIVITY_LOCAL_CACHE_PREFIX, walletKey), payload);
  } catch {
    // Best-effort render cache only.
  }
  try {
    window.sessionStorage.setItem(walletActivityCacheKey(WALLET_ACTIVITY_SESSION_CACHE_PREFIX, walletKey), payload);
  } catch {
    // Best-effort render cache only.
  }
}

function readCachedWalletActivityEventsFromStorage(
  storageFactory: () => Storage,
  key: string,
  maxEvents: number,
): WalletActivityEvent[] {
  try {
    const storage = storageFactory();
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { savedAtMs?: unknown; events?: unknown };
    if (
      typeof parsed.savedAtMs !== 'number'
      || Date.now() - parsed.savedAtMs > WALLET_ACTIVITY_CACHE_TTL_MS
    ) {
      storage.removeItem(key);
      return [];
    }
    if (!Array.isArray(parsed.events)) return [];
    return parsed.events
      .filter(isCachedWalletActivityEvent)
      .slice(0, maxEvents)
      // Storage events are history by definition — mark them `replayed` so
      // toast/sound consumers can never re-ring them, even on a boot that
      // lands within the freshness gates' age windows (close + reopen the
      // tab within seconds of a live trade used to re-toast it).
      .map((event) => (event.replayed === true ? event : { ...event, replayed: true }));
  } catch {
    return [];
  }
}

function isCachedWalletActivityEvent(value: unknown): value is WalletActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<WalletActivityEvent>;
  return typeof event.signature === 'string'
    && typeof event.slot === 'number'
    && (typeof event.blockTimeMs === 'number' || event.blockTimeMs === null)
    && typeof event.wallet === 'string'
    && typeof event.mint === 'string'
    && typeof event.isBuy === 'boolean'
    && typeof event.solLamports === 'string'
    && typeof event.tokens === 'string'
    && (typeof event.postTokens === 'string' || event.postTokens === null || event.postTokens === undefined)
    && (typeof event.mcLamports === 'string' || event.mcLamports === null || event.mcLamports === undefined)
    && (event.venue === 'bonding_curve' || event.venue === 'amm')
    && typeof event.receivedAtMs === 'number'
    // Cached blobs written before the poisoning floor existed can carry
    // scam rows — re-apply the gate on the way out of storage.
    && !isDustActivityLamports(event.solLamports);
}

function walletActivityCacheKey(prefix: string, walletKey: string): string {
  return `${prefix}${fnv1a(walletKey)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

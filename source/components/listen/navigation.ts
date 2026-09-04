import {
  TERMINAL_NAVIGATE_EVENT,
  TERMINAL_PREFETCH_EVENT,
  type TerminalHrefDetail,
} from '@/lib/navigation-events';
import { metricBytes, metricCount } from '@/lib/dev/hotPathMetrics';
import { isSolanaChain, tradePageHref } from '@/lib/evm/chains';

export type NavTab = 'discover' | 'tracker' | 'portfolio' | 'rewards' | 'frens' | 'chat' | 'agent-wallet' | 'conditionals';
export type View = 'discover' | 'tracker' | 'trade' | 'portfolio' | 'rewards' | 'frens' | 'chat' | 'agent-wallet' | 'conditionals';
export type TokenNavigationSourceSection = 'alpha' | 'new-pairs' | 'almost-graduated' | 'graduated';

export interface TokenNavigationHint {
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  imageFallbackUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  websiteUrl?: string | null;
  marketCap?: string | null;
  txns?: number | null;
  kinds?: string[] | null;
  sourceSection?: TokenNavigationSourceSection | null;
  /** Quote mint base58 for non-SOL pairs (USDC). Absent/null = SOL pair.
   *  Carried so the trade page resolves the spend currency correctly
   *  BEFORE the snapshot lands (a graduated hint without it briefly
   *  mis-resolved USDC pairs to the SOL fallback). */
  quoteMint?: string | null;
}

const LIVE_TOKEN_KEY = 'trade:live-token-mints:v1';
const LIVE_TOKEN_TTL_MS = 2 * 60_000;
const HINT_KEY_PREFIX = 'trade:token-hint:';
/** Trailing throttle for the batched sessionStorage flush. */
const FLUSH_DELAY_MS = 2_000;
const RECENT_MINTS_LIMIT = 500;

interface LiveTokenEntry {
  mint: string;
  seenAtMs: number;
}

/**
 * Same-tab runtime caches. These — NOT sessionStorage — are the source of
 * truth for live token hints / recently-seen mints while the tab is open.
 * The Discover SSE loop touches only memory; storage is an optional cache
 * flushed off the hot path (throttle + page-lifecycle) purely so a reload
 * or direct `/trade/:mint` link still has a hint to paint.
 */
const tokenHintMemory = new Map<string, TokenNavigationHint>();
const liveTokenSeenAt = new Map<string, number>();
/** Hard cap on the in-memory hint cache so a long session over a churning
 *  feed can't grow it without bound. Eviction is insertion-order LRU-ish:
 *  `setTokenHintMemory` re-inserts on write, so the oldest entry is the
 *  least-recently-written mint. */
const TOKEN_HINT_MEMORY_LIMIT = 2_000;

function setTokenHintMemory(mint: string, hint: TokenNavigationHint): void {
  tokenHintMissMemory.delete(mint);
  tokenHintMemory.delete(mint);
  tokenHintMemory.set(mint, hint);
  if (tokenHintMemory.size > TOKEN_HINT_MEMORY_LIMIT) {
    const oldest = tokenHintMemory.keys().next().value;
    if (oldest !== undefined) tokenHintMemory.delete(oldest);
  }
}

/** Bounded negative cache: mints known to have NO hint in memory OR storage.
 *  Feeds full of unknown mints call `readTokenNavigationHint` per row per
 *  render — without this every miss re-hits sessionStorage + JSON.parse.
 *  Any hint write (`setTokenHintMemory`) removes the mint again. */
const tokenHintMissMemory = new Set<string>();
const TOKEN_HINT_MISS_LIMIT = 2_000;

function rememberTokenHintMiss(mint: string): void {
  tokenHintMissMemory.delete(mint);
  tokenHintMissMemory.add(mint);
  if (tokenHintMissMemory.size > TOKEN_HINT_MISS_LIMIT) {
    const oldest = tokenHintMissMemory.values().next().value;
    if (oldest !== undefined) tokenHintMissMemory.delete(oldest);
  }
}
const dirtyHintMints = new Set<string>();
let recentMintsDirty = false;
let flushHandle: ReturnType<typeof setTimeout> | null = null;
let lifecycleFlushRegistered = false;

/** Tab -> view destination, or null if no page exists yet. */
export const TAB_VIEWS: Record<NavTab, View | null> = {
  discover: 'discover',
  tracker: 'tracker',
  portfolio: 'portfolio',
  rewards: 'rewards',
  frens: 'frens',
  chat: 'chat',
  'agent-wallet': 'agent-wallet',
  conditionals: 'conditionals',
};

/** Reverse: view -> the tab that should appear active on that page. */
export const VIEW_ACTIVE_TAB: Record<View, NavTab | null> = {
  discover: 'discover',
  tracker: 'tracker',
  trade: null,
  portfolio: 'portfolio',
  rewards: 'rewards',
  frens: 'frens',
  chat: 'chat',
  // The agent wallet lives in Portfolio → Wallets now, so Portfolio is
  // the tab that lights up for it. There is no separate agent-wallet tab.
  'agent-wallet': 'portfolio',
  conditionals: 'conditionals',
};

export const NAVIGATE_EVENT = 'listen:navigate';
export const TOKEN_HINT_EVENT = 'trade:token-hint-updated';

export function navigateToView(view: View): void {
  if (typeof window === 'undefined') return;
  const href = hrefForView(view);
  navigateToHref(href);
}

export function prefetchView(view: View, options: { warm?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  prefetchHref(hrefForView(view), options);
}

export function activeTabForTerminalPathname(pathname: string | null): NavTab | null {
  if (pathname === '/tracker' || pathname?.startsWith('/tracker/')) return 'tracker';
  if (pathname === '/trade' || pathname?.startsWith('/trade/')) return null;
  if (pathname === '/portfolio' || pathname?.startsWith('/portfolio/')) return 'portfolio';
  if (pathname === '/rewards' || pathname?.startsWith('/rewards/')) return 'rewards';
  if (pathname === '/frens' || pathname?.startsWith('/frens/')) return 'frens';
  /* The full page chat. The route is `/agent` — the page was built
     before the tab was, and its files, its store keys and its API paths
     all say `agent` — so the tab is the word the product uses and the
     route is the word the code does. */
  if (pathname === '/agent' || pathname?.startsWith('/agent/')) return 'chat';
  // Retired route; it 307s to the Portfolio deep link, and Portfolio is
  // the honest active tab for the frame the redirect renders.
  if (pathname === '/agent-wallet' || pathname?.startsWith('/agent-wallet/')) return 'portfolio';
  if (pathname === '/conditionals' || pathname?.startsWith('/conditionals/')) return 'conditionals';
  return 'discover';
}

/**
 * Route to a token's trade page.
 *
 * `chain` absent (or Solana) takes the full Solana path: hint memory, the
 * persisted hint write, the recent-mint list, prewarm. A NON-Solana chain
 * takes none of it and routes through the bridge alone — every one of those
 * caches is keyed by mint and a 0x address is not one, so writing a "token
 * hint" for a BSC address would poison the Solana hint store with an entry no
 * Solana page can ever match. That is the same reasoning
 * `navigateToTerminalHref` was extracted for; this is it applied one level up,
 * so callers with a chain in hand do not each have to know the rule.
 */
export function navigateToToken(
  mint: string,
  hint?: TokenNavigationHint,
  chain?: string | null,
): void {
  if (typeof window === 'undefined') return;
  if (!mint) return;
  if (!isSolanaChain(chain)) {
    navigateToTerminalHref(hrefForToken(mint, chain));
    return;
  }
  // Navigation-latency marker: card click accepted → routing begins.
  performance.mark('nav:token', { detail: { mint } });
  if (hint != null) {
    // Synchronous click handoff: record + persist the clicked token's
    // identity BEFORE routing so Trade opens instantly with no
    // metadata/network wait, and a hard navigation / reload still resolves
    // it from storage. This is the one path that writes storage on the
    // critical path -- a single token, once, on an explicit user action.
    //
    // MERGE with anything already known, field-wise: partial hints (a
    // wallet-activity row or toast knows only symbol + art) must not
    // null-clobber a full record a Discover card wrote earlier — losing
    // `quoteMint` mis-resolves USDC pairs to the SOL fallback in the
    // pre-snapshot window, and losing `sourceSection` picks the wrong
    // candle-history policy (same regression class the monotonic rule in
    // rememberTokenNavigationHint exists to prevent).
    const normalized = mergeTokenHints(readTokenNavigationHint(mint), normalizeTokenHint(hint));
    setTokenHintMemory(mint, normalized);
    liveTokenSeenAt.set(mint, Date.now());
    persistHint(mint, normalized);
    persistRecentMints();
    recentMintsDirty = false;
    dirtyHintMints.delete(mint);
    dispatchTokenHintEvent(mint);
  }
  const href = hrefForToken(mint);
  navigateToHref(href);
}

export function prefetchToken(
  mint: string,
  options: { warm?: boolean; chain?: string | null } = {},
): void {
  if (typeof window === 'undefined') return;
  if (!mint) return;
  /* ROUTE prefetch is chain-agnostic and always safe. `warm` is NOT: it asks
     the shell to pull this token's Solana snapshot, holders and candles, and
     doing that for a 0x address is a guaranteed-miss round trip against the
     wrong indexer. So a non-Solana prefetch warms the route and nothing
     else. */
  const solana = isSolanaChain(options.chain);
  prefetchHref(hrefForToken(mint, options.chain), {
    warm: solana ? options.warm : false,
  });
}

export function rememberLiveTokenMint(mint: string, hint?: TokenNavigationHint): void {
  if (!mint) return;
  metricCount('rememberLiveTokenMint');
  // Memory-only on the SSE hot path: record that this mint was seen and
  // (optionally) cache its hint. Persistence is batched off-path by
  // `scheduleFlush()`; no synchronous sessionStorage work happens here.
  liveTokenSeenAt.set(mint, Date.now());
  recentMintsDirty = true;
  scheduleFlush();
  if (hint) rememberTokenNavigationHint(mint, hint);
}

export function readTokenNavigationHint(mint: string): TokenNavigationHint | null {
  if (!mint) return null;
  // Memory first (instant, same-tab runtime). Fall back to storage only for
  // a cold tab (reload / direct link / cross-tab) and hydrate memory so the
  // next read is a map hit. Known misses short-circuit before the storage
  // read; a later hint write clears the miss entry.
  const cached = tokenHintMemory.get(mint);
  if (cached) return cached;
  if (tokenHintMissMemory.has(mint)) return null;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(hintStorageKey(mint));
    if (!raw) {
      rememberTokenHintMiss(mint);
      return null;
    }
    const hint = normalizeTokenHint(JSON.parse(raw) as Partial<TokenNavigationHint>);
    setTokenHintMemory(mint, hint);
    return hint;
  } catch {
    return null;
  }
}

export function tokenTickerFromNavigationHint(mint: string): string | null {
  const hint = readTokenNavigationHint(mint);
  return cleanTokenTicker(hint?.symbol, mint) ?? cleanTokenTicker(hint?.name, mint);
}

export function isRememberedLiveTokenMint(mint: string): boolean {
  if (!mint) return false;
  const seenAt = liveTokenSeenAt.get(mint);
  if (seenAt != null && Date.now() - seenAt <= LIVE_TOKEN_TTL_MS) return true;
  if (typeof window === 'undefined') return false;
  // Cold tab fallback: read the persisted recent-mints list (read-only --
  // unlike before, this never rewrites storage on a read) and hydrate memory.
  try {
    const raw = window.sessionStorage.getItem(LIVE_TOKEN_KEY);
    if (!raw) return false;
    const list = parseLiveTokenEntries(JSON.parse(raw), Date.now());
    const entry = list.find((item) => item.mint === mint);
    if (!entry) return false;
    liveTokenSeenAt.set(mint, entry.seenAtMs);
    return true;
  } catch {
    return false;
  }
}

const ESTABLISHED_TOKEN_KEY = 'trade:established-mints:v1';
// Longer than the 2-min live-token window so a coin the user has actually opened
// (and that resolved to a real, non-stub snapshot) stays "known" across a normal
// browsing session. Keeps `isKnownMint` — hence the snapshot's `hydrateIdentity`
// React Query cache-key discriminator — STABLE on return: otherwise a coin that
// has aged out of the discover feed AND the live-token window flips
// `hydrateIdentity` on the next visit, lands on a different cache key, and pays a
// needless cold snapshot refetch (slow return). Bounded set + TTL → self-expiring.
const ESTABLISHED_TOKEN_TTL_MS = 30 * 60_000;

/**
 * Mark a mint as "established": the user opened it and it resolved to a real
 * (non-stub) snapshot. Refreshes the timestamp on re-view so a frequently-opened
 * coin never expires mid-session.
 */
export function rememberEstablishedTokenMint(mint: string): void {
  if (typeof window === 'undefined' || !mint) return;
  try {
    const raw = window.sessionStorage.getItem(ESTABLISHED_TOKEN_KEY);
    const now = Date.now();
    const list = parseEstablishedTokenEntries(raw ? JSON.parse(raw) : null, now);
    const next = [
      { mint, seenAtMs: now },
      ...list.filter((entry) => entry.mint !== mint),
    ].slice(0, 1000);
    window.sessionStorage.setItem(ESTABLISHED_TOKEN_KEY, JSON.stringify(next));
  } catch {
    // Best-effort guard only.
  }
}

export function isEstablishedTokenMint(mint: string): boolean {
  if (typeof window === 'undefined' || !mint) return false;
  try {
    const raw = window.sessionStorage.getItem(ESTABLISHED_TOKEN_KEY);
    const now = Date.now();
    const list = parseEstablishedTokenEntries(raw ? JSON.parse(raw) : null, now);
    window.sessionStorage.setItem(ESTABLISHED_TOKEN_KEY, JSON.stringify(list));
    return list.some((entry) => entry.mint === mint);
  } catch {
    return false;
  }
}

function parseEstablishedTokenEntries(value: unknown, nowMs: number): LiveTokenEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): LiveTokenEntry | null => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Partial<LiveTokenEntry>;
      if (typeof entry.mint !== 'string' || !entry.mint) return null;
      const seenAtMs = typeof entry.seenAtMs === 'number' ? entry.seenAtMs : nowMs;
      return { mint: entry.mint, seenAtMs };
    })
    .filter((entry): entry is LiveTokenEntry => (
      entry != null && nowMs - entry.seenAtMs <= ESTABLISHED_TOKEN_TTL_MS
    ));
}

export function rememberTokenNavigationHint(mint: string, hint: TokenNavigationHint): void {
  if (!mint) return;
  // Memory write only. Identity (name/symbol/image/links/kinds) drives
  // dedup; volatile fields (marketCap/txns) update memory silently and
  // never dirty storage or fire an event. The discover feed re-remembers
  // up to ~150 coins per frame, so this is what keeps idle storage writes
  // and TOKEN_HINT_EVENT dispatches near zero.
  const normalized = normalizeTokenHint(hint);
  const prev = tokenHintMemory.get(mint);
  // MONOTONIC pair/lifecycle identity: `quoteMint` and `sourceSection`
  // never change for a mint once known, but most hint writers (feed
  // bookkeeping, ticker caches, position pills) don't carry them. A
  // null-defaulted write must not clobber a previously-known value —
  // that regression made graduated USDC pairs mis-resolve to the SOL
  // fallback in the pre-snapshot window.
  const next: TokenNavigationHint = {
    ...normalized,
    quoteMint: normalized.quoteMint ?? prev?.quoteMint ?? null,
    sourceSection: normalized.sourceSection ?? prev?.sourceSection ?? null,
  };
  setTokenHintMemory(mint, next);
  const identityChanged =
    !prev || tokenHintIdentitySignature(prev) !== tokenHintIdentitySignature(next);
  if (!identityChanged) return;
  dirtyHintMints.add(mint);
  scheduleFlush();
  dispatchTokenHintEvent(mint);
}

/** Field-wise coalesce of a fresh (already normalized) hint over what was
 *  previously known: the fresh value wins wherever it exists, the previous
 *  value fills every null. Volatile fields (marketCap/txns) coalesce too —
 *  an older number beats an em-dash on first paint. */
function mergeTokenHints(
  prev: TokenNavigationHint | null,
  next: TokenNavigationHint,
): TokenNavigationHint {
  if (!prev) return next;
  return {
    name: next.name ?? prev.name,
    symbol: next.symbol ?? prev.symbol,
    imageUrl: next.imageUrl ?? prev.imageUrl,
    imageFallbackUrl: next.imageFallbackUrl ?? prev.imageFallbackUrl,
    twitterUrl: next.twitterUrl ?? prev.twitterUrl,
    telegramUrl: next.telegramUrl ?? prev.telegramUrl,
    websiteUrl: next.websiteUrl ?? prev.websiteUrl,
    marketCap: next.marketCap ?? prev.marketCap,
    txns: next.txns ?? prev.txns,
    kinds: next.kinds ?? prev.kinds,
    sourceSection: next.sourceSection ?? prev.sourceSection,
    quoteMint: next.quoteMint ?? prev.quoteMint,
  };
}

/** Canonicalize a (possibly partial) hint to a full, null-defaulted shape. */
function normalizeTokenHint(hint: Partial<TokenNavigationHint>): TokenNavigationHint {
  return {
    name: hint.name ?? null,
    symbol: hint.symbol ?? null,
    imageUrl: hint.imageUrl ?? null,
    imageFallbackUrl: hint.imageFallbackUrl ?? null,
    twitterUrl: hint.twitterUrl ?? null,
    telegramUrl: hint.telegramUrl ?? null,
    websiteUrl: hint.websiteUrl ?? null,
    marketCap: hint.marketCap ?? null,
    txns: hint.txns ?? null,
    kinds: Array.isArray(hint.kinds)
      ? hint.kinds.filter((kind): kind is string => typeof kind === 'string')
      : null,
    sourceSection: isTokenNavigationSourceSection(hint.sourceSection)
      ? hint.sourceSection
      : null,
    quoteMint: typeof hint.quoteMint === 'string' && hint.quoteMint ? hint.quoteMint : null,
  };
}

/**
 * Stable-identity signature for dedup: only fields that define WHICH token
 * this is (and how it looks), never the volatile market data. Two hints
 * with the same signature are considered unchanged for persistence/events.
 */
export function tokenHintIdentitySignature(hint: TokenNavigationHint): string {
  return JSON.stringify([
    hint.name ?? null,
    hint.symbol ?? null,
    hint.imageUrl ?? null,
    hint.imageFallbackUrl ?? null,
    hint.twitterUrl ?? null,
    hint.telegramUrl ?? null,
    hint.websiteUrl ?? null,
    Array.isArray(hint.kinds) ? hint.kinds : null,
    hint.sourceSection ?? null,
    hint.quoteMint ?? null,
  ]);
}

/** TradePage filter: only react to a hint event for the active trade mint. */
export function shouldHandleTokenHintEvent(
  detail: unknown,
  mint: string | null | undefined,
): boolean {
  if (!mint || !detail || typeof detail !== 'object') return false;
  return (detail as { mint?: unknown }).mint === mint;
}

function hintStorageKey(mint: string): string {
  return `${HINT_KEY_PREFIX}${mint}`;
}

function dispatchTokenHintEvent(mint: string): void {
  if (typeof window === 'undefined') return;
  metricCount('tokenHintEvents');
  window.dispatchEvent(new CustomEvent(TOKEN_HINT_EVENT, { detail: { mint } }));
}

function scheduleFlush(): void {
  if (typeof window === 'undefined') return;
  registerLifecycleFlush();
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    flushTokenNavigationState();
  }, FLUSH_DELAY_MS);
}

function registerLifecycleFlush(): void {
  if (lifecycleFlushRegistered || typeof window === 'undefined') return;
  lifecycleFlushRegistered = true;
  window.addEventListener('pagehide', flushTokenNavigationState);
  window.addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      flushTokenNavigationState();
    }
  });
}

/**
 * Write any pending recent-mints list + dirty hints to sessionStorage.
 * Exported so tests can force a flush and so callers (lifecycle handlers)
 * can persist synchronously on hide. Cheap no-op when nothing is dirty.
 */
export function flushTokenNavigationState(): void {
  if (typeof window === 'undefined') return;
  if (recentMintsDirty) {
    persistRecentMints();
    recentMintsDirty = false;
  }
  if (dirtyHintMints.size === 0) return;
  for (const mint of dirtyHintMints) {
    const hint = tokenHintMemory.get(mint);
    if (hint) persistHint(mint, hint);
  }
  dirtyHintMints.clear();
}

function persistHint(mint: string, hint: TokenNavigationHint): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(hint);
    window.sessionStorage.setItem(hintStorageKey(mint), serialized);
    metricCount('hintStorageWrites');
    metricBytes('hintStorageBytes', serialized.length);
  } catch {
    // Best-effort UI hint cache only.
  }
}

function persistRecentMints(): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const entries: LiveTokenEntry[] = [];
    for (const [mint, seenAtMs] of liveTokenSeenAt) {
      if (now - seenAtMs > LIVE_TOKEN_TTL_MS) {
        liveTokenSeenAt.delete(mint); // prune expired so memory stays bounded
        continue;
      }
      entries.push({ mint, seenAtMs });
    }
    entries.sort((a, b) => b.seenAtMs - a.seenAtMs);
    const serialized = JSON.stringify(entries.slice(0, RECENT_MINTS_LIMIT));
    window.sessionStorage.setItem(LIVE_TOKEN_KEY, serialized);
    metricCount('hintStorageWrites');
    metricBytes('hintStorageBytes', serialized.length);
  } catch {
    // Best-effort recent-mints cache only.
  }
}

/** Test-only: clear the in-memory caches (simulates a fresh page load). */
export function __resetTokenNavigationStateForTests(): void {
  tokenHintMemory.clear();
  tokenHintMissMemory.clear();
  liveTokenSeenAt.clear();
  dirtyHintMints.clear();
  recentMintsDirty = false;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
}

function isTokenNavigationSourceSection(value: unknown): value is TokenNavigationSourceSection {
  return value === 'alpha'
    || value === 'new-pairs'
    || value === 'almost-graduated'
    || value === 'graduated';
}

function parseLiveTokenEntries(value: unknown, nowMs: number): LiveTokenEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): LiveTokenEntry | null => {
      if (typeof item === 'string') {
        return { mint: item, seenAtMs: nowMs };
      }
      if (!item || typeof item !== 'object') return null;
      const entry = item as Partial<LiveTokenEntry>;
      if (typeof entry.mint !== 'string' || !entry.mint) return null;
      const seenAtMs = typeof entry.seenAtMs === 'number' ? entry.seenAtMs : nowMs;
      return { mint: entry.mint, seenAtMs };
    })
    .filter((entry): entry is LiveTokenEntry => (
      entry != null && nowMs - entry.seenAtMs <= LIVE_TOKEN_TTL_MS
    ));
}

function cleanTokenTicker(value: string | null | undefined, mint: string): string | null {
  const cleaned = value?.trim().replace(/^\$/, '');
  if (!cleaned) return null;
  if (cleaned === mint) return null;
  if (/^(unknown|loading|loading metadata)$/i.test(cleaned)) return null;
  return cleaned;
}

export function hrefForView(view: View): string {
  switch (view) {
    case 'discover':
      return '/discover';
    case 'tracker':
      return '/tracker';
    case 'trade':
      return '/trade';
    case 'portfolio':
      return '/portfolio';
    case 'rewards':
      return '/rewards';
    case 'frens':
      return '/frens';
    case 'chat':
      return '/agent';
    case 'agent-wallet':
      // Deep link rather than the retired page. Kept as its own View so
      // existing `navigateToView('agent-wallet')` callers still resolve
      // to the surface, which is now a modal over Portfolio → Wallets.
      // Literal, not an import from `components/portfolio`: this module
      // is on the navigation hot path and should not pull in a feature
      // slice for one string. Mirrors `AGENT_WALLET_SETUP_HREF`.
      return '/portfolio?tab=wallets&agent=setup';
    case 'conditionals':
      return '/conditionals';
    default: {
      const _exhaustive: never = view;
      void _exhaustive;
      return '/discover';
    }
  }
}

/**
 * Canonical trade-page href for a token, on ANY chain. Exported so clickable
 * token surfaces (Discover cards, activity rows, the position strip) can
 * render REAL `<a href>` elements — pre-hydration clicks then fall back to
 * native browser navigation instead of dispatching into a not-yet-mounted
 * bridge.
 *
 * `chain` is optional and its absence means Solana, which is why every one of
 * the ~dozen Solana-only call sites is unchanged and still produces the exact
 * `/trade/<mint>` bytes it always did. Before this parameter existed the
 * function COULD NOT express a chain at all, so the EVM surfaces routed around
 * it with their own builder — and the surfaces that could not route around it
 * (the position strip, tracker rows, agent prose) emitted a Solana href for an
 * EVM address, which is not a 404 but something worse: a link to a DIFFERENT
 * token, since a 0x string is not a valid mint and the Solana route's own gate
 * is the only thing that catches it.
 */
export function hrefForToken(mint: string, chain?: string | null): string {
  return tradePageHref(mint, chain);
}

/**
 * Route to any in-terminal href through the same navigation bridge the
 * Solana token path uses.
 *
 * Exported for the EVM surfaces, whose hrefs are `/trade/<chain>/<0xaddr>`
 * and carry no mint, no hint memory and no prewarm — none of
 * `navigateToToken`'s machinery applies to them, and calling it with a 0x
 * address would write a Solana token hint keyed by an EVM address. This is
 * the bridge alone: an in-app `router.push` when the bridge is mounted, a
 * hard navigation when it is not.
 */
export function navigateToTerminalHref(href: string): void {
  if (typeof window === 'undefined') return;
  if (href === '') return;
  navigateToHref(href);
}

function navigateToHref(href: string): void {
  const detail: TerminalHrefDetail = { href };
  const event = new CustomEvent<TerminalHrefDetail>(TERMINAL_NAVIGATE_EVENT, {
    detail,
    cancelable: true,
  });
  const handled = !window.dispatchEvent(event);
  if (!handled) {
    // During a hard refresh React can paint shell markup before the root navigation bridge's
    // effect has attached. A click in that window used to dispatch into the void, making
    // tabs/cards feel bricked until unrelated boot work completed. Fall back to a normal
    // browser navigation so clicks always make progress; once the bridge is mounted it calls
    // preventDefault() and this remains an in-app router.push().
    window.location.assign(href);
  }
}

function prefetchHref(href: string, options: { warm?: boolean } = {}): void {
  const detail: TerminalHrefDetail = { href, warm: options.warm === true };
  const event = new CustomEvent<TerminalHrefDetail>(TERMINAL_PREFETCH_EVENT, { detail });
  window.dispatchEvent(event);
}

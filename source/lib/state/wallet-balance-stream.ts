'use client';

import { tradingApiUrl } from '@/lib/api/trading';
import { subscribeStreamGeneration } from '@/lib/state/stream-generation';

/**
 * Shared, ref-counted client for the per-wallet the chain stream balance SSE
 * (`/api/v1/trade/wallet-balance/stream`). One EventSource per wallet is
 * shared across every consumer (the single-wallet `useTradeStream` poll
 * and the multi-wallet `useMultiWalletTokenBalance` fan-out), so a trade
 * page with N selected wallets opens exactly N connections regardless of
 * how many hooks read them.
 *
 * Consumers read imperatively from their existing poll ticks via
 * {@link streamedTokenBalance}: a non-null result means "use this, skip
 * the network fetch"; null means cold/absent/disconnected → fall through
 * to the authoritative poll. This keeps the submit/`force` read path
 * untouched while eliminating the steady-state 250 ms polling.
 */

interface WalletBalanceWire {
  readonly tokenBalances?: ReadonlyArray<{ readonly mint?: string; readonly amount?: string }>;
}

/** Parse an SSE balance frame's JSON payload. Returns null on garbage. */
export function parseWalletBalanceStreamData(data: string): WalletBalanceWire | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as WalletBalanceWire;
  } catch {
    return null;
  }
}

/**
 * Extract a single mint's base-unit balance from a streamed wallet
 * snapshot. Returns null when the mint is absent or malformed. Pure +
 * exported for unit tests.
 */
export function tokenBaseUnitsFromWalletWire(
  wire: WalletBalanceWire | null,
  mint: string,
): string | null {
  if (!wire?.tokenBalances) return null;
  const row = wire.tokenBalances.find((entry) => entry.mint === mint);
  const amount = row?.amount;
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) return null;
  return amount;
}

interface StreamEntry {
  readonly walletAccountId: string | null;
  /** Per-mint balance + client receipt time of the frame that carried it. */
  tokensByMint: Map<string, { amount: string; atMs: number }>;
  connected: boolean;
  /** Client receipt time of the last snapshot/balance frame (stream liveness). */
  updatedAtMs: number;
  es: EventSource | null;
  refCount: number;
  retryHandle: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;

// Freshness bound for serving a streamed balance to sell sizing. Mirrors
// the api pull's `INGESTION_TOKEN_MAX_AGE_MS`: if this wallet's snapshot
// has not refreshed within this window (ingestion went quiet / stopped
// observing the wallet), treat the stream as stale and fall back to the
// authoritative poll so a stale-high balance can never feed an oversell.
// Actively-traded wallets refresh well inside this window, so the hot
// 250ms poll stays eliminated where the volume actually is.
export const STREAM_FRESH_MS = 1_500;

const entries = new Map<string, StreamEntry>();

function walletKeyOf(walletAccountId: string | null): string {
  return walletAccountId ?? 'primary';
}

/**
 * Open (or join) the balance stream for a wallet. Returns a release fn;
 * the underlying EventSource closes when the last consumer releases.
 */
export function acquireWalletBalanceStream(walletAccountId: string | null): () => void {
  const key = walletKeyOf(walletAccountId);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      walletAccountId,
      tokensByMint: new Map(),
      connected: false,
      updatedAtMs: 0,
      es: null,
      refCount: 0,
      retryHandle: null,
      retryDelayMs: RETRY_BASE_MS,
    };
    entries.set(key, entry);
  }
  entry.refCount += 1;
  if (entry.es === null && entry.retryHandle === null) connect(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) teardown(key);
  };
}

function connect(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.refCount <= 0) return;
  const path = entry.walletAccountId
    ? `/api/v1/trade/wallet-balance/stream?wallet_account_id=${encodeURIComponent(entry.walletAccountId)}`
    : '/api/v1/trade/wallet-balance/stream';
  const url = tradingApiUrl(path);
  if (!url || typeof EventSource === 'undefined') return;
  let es: EventSource;
  try {
    es = new EventSource(url, { withCredentials: true });
  } catch {
    return;
  }
  entry.es = es;
  es.addEventListener('open', () => {
    const e = entries.get(key);
    if (!e) return;
    e.connected = true;
    e.retryDelayMs = RETRY_BASE_MS;
  });
  const onData = (ev: Event): void => {
    const e = entries.get(key);
    if (!e) return;
    applyFrame(e, (ev as MessageEvent).data as string);
  };
  es.addEventListener('snapshot', onData);
  es.addEventListener('balance', onData);
  es.addEventListener('error', () => {
    const e = entries.get(key);
    if (!e) return;
    e.connected = false;
    try { e.es?.close(); } catch { /* ignore */ }
    e.es = null;
    if (e.refCount > 0 && e.retryHandle === null) {
      e.retryHandle = setTimeout(() => {
        const cur = entries.get(key);
        if (cur) cur.retryHandle = null;
        connect(key);
        // Jittered (0.5-1.0x): a server restart must not synchronize the
        // reconnect herd (same idiom as the Discover feed hooks).
      }, Math.round(e.retryDelayMs * (0.5 + Math.random() * 0.5)));
      if (e.retryHandle.unref) e.retryHandle.unref();
      e.retryDelayMs = Math.min(e.retryDelayMs * 2, RETRY_MAX_MS);
    }
  });
}

function applyFrame(entry: StreamEntry, rawData: string): void {
  const wire = parseWalletBalanceStreamData(rawData);
  if (!wire?.tokenBalances) return;
  const now = Date.now();
  for (const row of wire.tokenBalances) {
    if (
      typeof row.mint === 'string' &&
      typeof row.amount === 'string' &&
      /^[0-9]+$/.test(row.amount)
    ) {
      entry.tokensByMint.set(row.mint, { amount: row.amount, atMs: now });
    }
  }
  // Frames are merge-only (ingestion's signature snapshots list just the
  // mints that transaction touched), so only the LISTED mints are
  // current as of now — freshness is stamped per mint above. The
  // entry-wide stamp tracks stream liveness for `walletStreamState`; it
  // must never mark an unrefreshed per-mint row as fresh, or activity on
  // other mints keeps re-serving a stale balance and suppresses the
  // authoritative poll.
  entry.updatedAtMs = now;
}

function teardown(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.retryHandle !== null) clearTimeout(entry.retryHandle);
  try { entry.es?.close(); } catch { /* ignore */ }
  entries.delete(key);
}

/**
 * Current streamed base-unit balance for `(wallet, mint)`, or null when
 * the stream is disconnected or has not observed the mint yet (caller
 * falls back to the authoritative poll). Read from poll ticks.
 */
export function streamedTokenBalance(
  walletAccountId: string | null,
  mint: string,
  maxAgeMs: number = STREAM_FRESH_MS,
): string | null {
  const entry = entries.get(walletKeyOf(walletAccountId));
  if (!entry || !entry.connected) return null;
  // Per-mint staleness: a row only counts as fresh if a frame carried
  // THIS mint within the window. Entry-level activity on other mints
  // must not re-serve an unrefreshed row — defer to the authoritative
  // poll rather than risk a stale-high sell hint.
  const row = entry.tokensByMint.get(mint);
  if (!row || Date.now() - row.atMs > maxAgeMs) return null;
  return row.amount;
}

export function isWalletBalanceStreamConnected(walletAccountId: string | null): boolean {
  return entries.get(walletKeyOf(walletAccountId))?.connected ?? false;
}

// bfcache restore: the frozen EventSources are typically CLOSED on
// `pageshow` (persisted) and no React effect re-runs for this
// module-level client — force-reconnect every live entry. Consumers'
// freshness checks (`walletStreamState`) already handle the brief gap.
subscribeStreamGeneration(() => {
  for (const [key, entry] of entries) {
    if (entry.refCount <= 0) continue;
    if (entry.retryHandle !== null) {
      clearTimeout(entry.retryHandle);
      entry.retryHandle = null;
    }
    try { entry.es?.close(); } catch { /* ignore */ }
    entry.es = null;
    entry.connected = false;
    entry.retryDelayMs = RETRY_BASE_MS;
    connect(key);
  }
});

export type WalletStreamState = 'fresh' | 'stale' | 'disconnected';

/**
 * Connectivity/freshness of a wallet's balance stream, independent of
 * whether it has observed any particular mint. Callers use this to tell
 * "wallet is up to date and this mint has no freshly observed balance —
 * not held, or held-but-quiet so the seeded value carries forward"
 * (`fresh`, combined with a null {@link streamedTokenBalance}) apart
 * from "the stream is down or lagging" (`stale`/`disconnected`).
 *
 * The distinction is what lets the balance pollers stop hammering the
 * authoritative `/token-balance` endpoint for mints the user does not
 * hold (serve a single seed read, then defer to the stream) while still
 * polling wallets whose stream genuinely cannot be trusted — so a
 * stale-high balance can never feed a sell hint.
 *
 * A connected stream that has not yet received its first snapshot frame
 * (`updatedAtMs === 0`) reports `stale`, which correctly routes the very
 * first read through the seed/poll path until the snapshot lands.
 */
export function walletStreamState(
  walletAccountId: string | null,
  maxAgeMs: number = STREAM_FRESH_MS,
): WalletStreamState {
  const entry = entries.get(walletKeyOf(walletAccountId));
  if (!entry || !entry.connected) return 'disconnected';
  if (Date.now() - entry.updatedAtMs > maxAgeMs) return 'stale';
  return 'fresh';
}

export type MintStreamState = 'fresh_value' | 'stale' | 'unobserved';

/**
 * Freshness of a SPECIFIC mint's streamed balance row — distinct from
 * {@link walletStreamState}, which is stream-wide. Lets a consumer tell a
 * mint that was NEVER carried (seed value may carry forward) apart from one
 * whose row has aged out of the window (balance may have moved without a
 * refresh → must poll authoritatively):
 *   - 'fresh_value' — a frame carried THIS mint within `maxAgeMs`
 *   - 'stale'       — a row exists but is older than `maxAgeMs`
 *   - 'unobserved'  — no frame ever carried this mint
 *
 * Without this distinction the stream-wide `fresh` state let activity on
 * OTHER mints keep a held-but-quiet mint's stale row indefinitely suppressing
 * its poll — defeating the per-mint freshness guard end-to-end (finding #16).
 */
export function mintStreamState(
  walletAccountId: string | null,
  mint: string,
  maxAgeMs: number = STREAM_FRESH_MS,
): MintStreamState {
  const entry = entries.get(walletKeyOf(walletAccountId));
  const row = entry?.tokensByMint.get(mint);
  if (!row) return 'unobserved';
  if (Date.now() - row.atMs > maxAgeMs) return 'stale';
  return 'fresh_value';
}

/** Test-only: tear down all streams + clear state between tests. */
export function _resetWalletBalanceStreamForTests(): void {
  for (const key of [...entries.keys()]) teardown(key);
}

/**
 * Test-only: apply a raw SSE frame to a wallet's entry (created and
 * marked connected if absent) without opening an EventSource.
 */
export function _applyWalletBalanceFrameForTests(
  walletAccountId: string | null,
  rawData: string,
): void {
  const key = walletKeyOf(walletAccountId);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      walletAccountId,
      tokensByMint: new Map(),
      connected: false,
      updatedAtMs: 0,
      es: null,
      refCount: 0,
      retryHandle: null,
      retryDelayMs: RETRY_BASE_MS,
    };
    entries.set(key, entry);
  }
  entry.connected = true;
  applyFrame(entry, rawData);
}

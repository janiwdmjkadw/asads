'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { tradingApiUrl } from '@/lib/api/trading';
import { subscribeStreamGeneration } from '@/lib/state/stream-generation';

/**
 * Shared, ref-counted client for the server-joined live positions SSE
 * (`/api/v1/trade/positions/stream`). One EventSource per WALLET SET is
 * shared across every consumer, so the position bar opens exactly one
 * connection for the current selection regardless of how many components
 * read it. The server frame already carries the fully aggregated
 * `{ amountRaw, amountUsd, pnlPct, contributors }` per coin (balances ⋈
 * cost basis ⋈ live price, blended across the set), so the client just
 * parses + fans out — there is NO polling here.
 */

/** One wallet's contribution to an aggregated position (for sell-all fan-out). */
export interface PositionContributor {
  readonly walletAccountId: string;
  readonly amountRaw: string;
}

/** One open position, ready for a pill (aggregated across the selected wallets). */
export interface PositionItem {
  readonly mint: string;
  readonly symbol: string | null;
  readonly logo: string | null;
  /** Total raw base-unit balance across contributors; sell-all balance hint. */
  readonly amountRaw: string;
  /** Current USD value across contributors (null when unpriced). */
  readonly amountUsd: number | null;
  /** Blended unrealized PnL % (null unless every contributor's basis is known). */
  readonly pnlPct: number | null;
  /** Blended cost basis in lamports (null unless every contributor's basis is known). */
  readonly costBasisLamports: string | null;
  /** Per-wallet breakdown so a sell-all fans out across the holders. */
  readonly contributors: ReadonlyArray<PositionContributor>;
}

interface Snapshot {
  readonly items: ReadonlyArray<PositionItem>;
  readonly isLoading: boolean;
}

const EMPTY_LOADING: Snapshot = { items: [], isLoading: true };
const EMPTY_IDLE: Snapshot = { items: [], isLoading: false };

interface StreamEntry {
  /** Sorted, unique wallet ids this stream subscribes to. */
  readonly walletAccountIds: ReadonlyArray<string>;
  snapshot: Snapshot;
  es: EventSource | null;
  refCount: number;
  retryHandle: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  readonly listeners: Set<() => void>;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;
/** Keep a zero-ref stream (and its last snapshot) alive briefly so a
 *  wallet-selection re-key / strict-mode remount reuses the connection
 *  instead of flashing back to EMPTY_LOADING (mirrors useWalletActivity). */
const TEARDOWN_LINGER_MS = 5_000;

const entries = new Map<string, StreamEntry>();

/** Stable cache key + subscription set for a selection. */
function signatureOf(walletAccountIds: ReadonlyArray<string>): string {
  const unique = [...new Set(walletAccountIds.filter((id) => id.length > 0))].sort();
  return unique.length > 0 ? unique.join(',') : 'primary';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseContributors(raw: unknown): PositionContributor[] {
  if (!Array.isArray(raw)) return [];
  const out: PositionContributor[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const walletAccountId = entry['walletAccountId'];
    const amountRaw = entry['amountRaw'];
    if (typeof walletAccountId === 'string' && typeof amountRaw === 'string') {
      out.push({ walletAccountId, amountRaw });
    }
  }
  return out;
}

/** Parse an SSE `positions` frame into items. Pure; exported for unit tests. */
export function parsePositionsStreamData(data: string): PositionItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !Array.isArray(parsed['positions'])) return null;
  const items: PositionItem[] = [];
  for (const raw of parsed['positions']) {
    if (!isObject(raw)) continue;
    const mint = raw['mint'];
    const amountRaw = raw['amountRaw'];
    if (typeof mint !== 'string' || typeof amountRaw !== 'string') continue;
    items.push({
      mint,
      symbol: typeof raw['symbol'] === 'string' ? raw['symbol'] : null,
      logo: typeof raw['logo'] === 'string' ? raw['logo'] : null,
      amountRaw,
      amountUsd: typeof raw['amountUsd'] === 'number' ? raw['amountUsd'] : null,
      pnlPct: typeof raw['pnlPct'] === 'number' ? raw['pnlPct'] : null,
      costBasisLamports:
        typeof raw['costBasisLamports'] === 'string' ? raw['costBasisLamports'] : null,
      contributors: parseContributors(raw['contributors']),
    });
  }
  return items;
}

function notify(entry: StreamEntry): void {
  for (const listener of entry.listeners) listener();
}

function connect(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.refCount <= 0) return;
  const params = entry.walletAccountIds
    .map((id) => `wallet_account_id=${encodeURIComponent(id)}`)
    .join('&');
  const path = params.length > 0
    ? `/api/v1/trade/positions/stream?${params}`
    : '/api/v1/trade/positions/stream';
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
    if (e) e.retryDelayMs = RETRY_BASE_MS;
  });
  es.addEventListener('positions', (ev: Event) => {
    const e = entries.get(key);
    if (!e) return;
    const items = parsePositionsStreamData((ev as MessageEvent).data as string);
    if (items === null) return;
    e.snapshot = { items, isLoading: false };
    notify(e);
  });
  es.addEventListener('error', () => {
    const e = entries.get(key);
    if (!e) return;
    try {
      e.es?.close();
    } catch {
      /* ignore */
    }
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

function teardown(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.retryHandle !== null) clearTimeout(entry.retryHandle);
  if (entry.lingerTimer !== null) clearTimeout(entry.lingerTimer);
  try {
    entry.es?.close();
  } catch {
    /* ignore */
  }
  entries.delete(key);
}

// bfcache restore: the frozen EventSources are typically CLOSED on
// `pageshow` (persisted) and no React effect re-runs for this
// module-level client — force-reconnect every live entry. The held
// snapshot stays served while the fresh frame arrives.
subscribeStreamGeneration(() => {
  for (const [key, entry] of entries) {
    if (entry.refCount <= 0) continue;
    if (entry.retryHandle !== null) {
      clearTimeout(entry.retryHandle);
      entry.retryHandle = null;
    }
    try { entry.es?.close(); } catch { /* ignore */ }
    entry.es = null;
    entry.retryDelayMs = RETRY_BASE_MS;
    connect(key);
  }
});

function acquire(
  key: string,
  walletAccountIds: ReadonlyArray<string>,
  listener: () => void,
): () => void {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      walletAccountIds,
      snapshot: EMPTY_LOADING,
      es: null,
      refCount: 0,
      retryHandle: null,
      retryDelayMs: RETRY_BASE_MS,
      lingerTimer: null,
      listeners: new Set(),
    };
    entries.set(key, entry);
  }
  if (entry.lingerTimer !== null) {
    clearTimeout(entry.lingerTimer);
    entry.lingerTimer = null;
  }
  entry.listeners.add(listener);
  entry.refCount += 1;
  if (entry.es === null && entry.retryHandle === null) connect(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount <= 0 && current.lingerTimer === null) {
      // Defer teardown so a quick re-subscribe (wallet re-key, strict-
      // mode remount) reuses the connection + last snapshot.
      current.lingerTimer = setTimeout(() => {
        const latest = entries.get(key);
        if (!latest) return;
        latest.lingerTimer = null;
        if (latest.refCount <= 0) teardown(key);
      }, TEARDOWN_LINGER_MS);
      if (current.lingerTimer.unref) current.lingerTimer.unref();
    }
  };
}

/**
 * Live open positions aggregated across `walletAccountIds` over the
 * shared positions SSE. Re-subscribes when the selection signature
 * changes. `enabled` gates the subscription (signed-out users open
 * nothing).
 */
export function usePositionsStream(
  walletAccountIds: ReadonlyArray<string>,
  enabled: boolean,
): Snapshot {
  // Sorted, deduped ids derived from the signature so the subscription is
  // stable across renders that pass an equal-but-new array reference.
  const key = signatureOf(walletAccountIds);
  const ids = useMemo(
    () => (key === 'primary' ? [] : key.split(',')),
    [key],
  );

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (!enabled) return () => {};
      return acquire(key, ids, onChange);
    },
    [key, ids, enabled],
  );
  const getSnapshot = useCallback((): Snapshot => {
    if (!enabled) return EMPTY_IDLE;
    return entries.get(key)?.snapshot ?? EMPTY_LOADING;
  }, [key, enabled]);
  // Server snapshot has no client streams open → idle.
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_IDLE);
}

/** Test-only: tear down all streams + clear state between tests. */
export function _resetPositionsStreamForTests(): void {
  for (const key of [...entries.keys()]) teardown(key);
}

'use client';

import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';

/**
 * Cross-reload persistence for the token read cache.
 *
 * The in-memory React Query cache already makes in-SPA token-to-token navigation
 * instant. This layer extends that to a hard reload / a fresh session opening a
 * `/trade/:mint` URL directly: the last snapshot (which embeds the candle seed) is
 * restored from IndexedDB on boot, so the chart paints from cache instead of waiting on
 * the network — even for an old coin nowhere near the hot path.
 *
 * Deliberately dependency-free (native IndexedDB) and SSR-safe (no render gating, so it
 * cannot cause a hydration mismatch): we hydrate AFTER mount. A fresh network fetch in
 * flight is never clobbered because `hydrate` only fills a query that has no newer data.
 */

const DB_NAME = 'terminal-query-cache';
const STORE_NAME = 'kv';
const ENTRY_KEY = 'react-query:v1';
/** Bump when the persisted shape or token query semantics change; stale blobs are dropped. */
const CACHE_VERSION = 1;
/** Drop the whole blob if older than this (a day-old chart is not worth restoring). */
const MAX_AGE_MS = 24 * 60 * 60_000;
/** Per-query freshness: only persist/restore reasonably recent token data.
 *  Was 6h — a snapshot carries the market cap, the candle seed AND a trade
 *  tape, and hydrating hours-old ones repainted long-dead prices on click
 *  (the refetch heals it, but the flash reads as the terminal serving stale
 *  data). 30min keeps the instant-paint for realistic revisit windows. */
const QUERY_MAX_AGE_MS = 30 * 60_000;
/**
 * Cap on persisted snapshots. Bounds main-thread serialization and IndexedDB size
 * regardless of how many coins a long session touched — we keep only the most recently
 * updated ones (the coins a user is realistically about to revisit).
 */
const MAX_PERSISTED_SNAPSHOTS = 40;

interface PersistedBlob {
  version: number;
  savedAt: number;
  state: DehydratedState;
}

/**
 * Only the token snapshot is worth persisting: it carries the candle seed that paints the
 * chart instantly. Candle/holder/top-trader queries are supplementary (re-fetched fast and
 * warmed by prewarm), so persisting them would only bloat the blob and main-thread cost.
 */
function isPersistableTokenKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'token' && queryKey[1] === 'snapshot';
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result as T | undefined);
          req.onerror = () => resolve(undefined);
          tx.oncomplete = () => db.close();
        } catch {
          resolve(undefined);
        }
      }),
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

/** Restore persisted token queries into the client. Best-effort; never throws. */
export async function restorePersistedQueries(queryClient: QueryClient): Promise<void> {
  let blob: PersistedBlob | undefined;
  try {
    blob = await idbGet<PersistedBlob>(ENTRY_KEY);
  } catch {
    return;
  }
  if (!blob || blob.version !== CACHE_VERSION || typeof blob.savedAt !== 'number') {
    if (blob) void idbDel(ENTRY_KEY);
    return;
  }
  if (Date.now() - blob.savedAt > MAX_AGE_MS) {
    void idbDel(ENTRY_KEY);
    return;
  }
  try {
    // Age-filter at RESTORE time too: the write-side filter runs at save,
    // so a blob restored hours later would otherwise hydrate queries far
    // past the freshness bound.
    const now = Date.now();
    blob.state.queries = blob.state.queries.filter(
      (query) => now - query.state.dataUpdatedAt <= QUERY_MAX_AGE_MS,
    );
    if (blob.state.queries.length === 0) {
      // Fully expired: drop it now, or every boot until MAX_AGE_MS re-reads
      // and re-filters the dead blob.
      void idbDel(ENTRY_KEY);
      return;
    }
    hydrate(queryClient, blob.state);
  } catch {
    void idbDel(ENTRY_KEY);
  }
}

/**
 * Begin persisting token queries. Returns an unsubscribe.
 *
 * Writes happen ONLY when the user leaves — tab backgrounded
 * (`visibilitychange` → hidden) or page unloading (`pagehide`) — and only
 * when a persistable query actually changed since the last write. The
 * previous 3s-debounced write-during-use ran `dehydrate` + a synchronous
 * structured-clone IndexedDB `put` on the main thread exactly while the
 * user was scrolling/hovering Discover: ~2.7s of blocking per 15s scroll
 * window on a 4x-throttled CPU (scroll-jank harness; `TimerHandler` +
 * `IDBOpenDBRequest.onsuccess` LoAF blame). The blob's only consumer is
 * the NEXT page load, and every path to a load (reload, close, navigate
 * away, background-then-kill) fires one of the two hide signals first —
 * so flushing at hide time keeps the restore behavior while moving the
 * cost off the interaction path. A hard crash loses the last snapshot,
 * which "best-effort persistence" already tolerates.
 */
export function startPersistingQueries(queryClient: QueryClient): () => void {
  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    try {
      const now = Date.now();
      const state = dehydrate(queryClient, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' &&
          query.state.data != null &&
          isPersistableTokenKey(query.queryKey) &&
          now - query.state.dataUpdatedAt <= QUERY_MAX_AGE_MS,
      });
      if (state.queries.length === 0) {
        void idbDel(ENTRY_KEY);
        return;
      }
      // Keep only the most recently updated snapshots so the blob stays small and bounded.
      if (state.queries.length > MAX_PERSISTED_SNAPSHOTS) {
        state.queries = [...state.queries]
          .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
          .slice(0, MAX_PERSISTED_SNAPSHOTS);
      }
      const blob: PersistedBlob = { version: CACHE_VERSION, savedAt: now, state };
      void idbSet(ENTRY_KEY, blob);
    } catch {
      // Best-effort persistence: a serialization/IDB hiccup must never surface.
    }
  };

  // Only snapshot-query changes can alter the persisted blob, so only they
  // mark it dirty (candle / holders / alpha polls are never persisted and
  // must not cause writes). The mark is a boolean flip — no timers, no
  // dehydrate, no IDB traffic while the user is active.
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (!isPersistableTokenKey(event.query.queryKey)) return;
    dirty = true;
  });
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
  }

  return () => {
    unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    }
  };
}

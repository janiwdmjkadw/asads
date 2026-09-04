import { useEffect, useRef, useState } from 'react';
import { limitDiscoverRows } from './useLiveNewPairs';
import type { MockCoin } from './mockCoins';

/**
 * Browser render-cache slice for the "Graduated" row.
 *
 * Graduated coins ride INSIDE the new-pairs envelope (the backend buckets
 * them to the top of the same `/discover/stream` frame), so this row has no
 * dedicated stream — it is the `graduated` subset of the singleton new-pairs
 * feed. That feed is empty for a beat on a cold hard refresh, which used to
 * surface a hardcoded mock list (a fake-data flash). Instead we keep our own
 * last-good render cache (same pattern as `useLiveNewPairs` /
 * `useAlmostGraduated`): boot-seed the row from it so it paints real,
 * previously-seen graduated cards immediately, then swap to live rows the
 * moment the new-pairs feed populates.
 */
const GRADUATED_SESSION_CACHE_KEY = 'discover:graduated:last-pairs:session:v1';
const GRADUATED_LOCAL_CACHE_KEY = 'discover:graduated:last-pairs:local:v1';
const GRADUATED_CACHE_TTL_MS = 10 * 60_000;
const CACHE_FLUSH_DELAY_MS = 2_000;

// Client boot seed: read the last-good graduated cards once at module load.
// Adopted only post-hydration (see useGraduatedRenderCache) so the client's
// first render matches the server HTML.
let bootSeed: MockCoin[] = [];
if (typeof window !== 'undefined') {
  const cached = readCachedGraduatedCoins();
  if (cached && cached.length > 0) bootSeed = cached;
}

/**
 * Returns the graduated rows to render. While the new-pairs feed is still
 * empty (`feedReady === false`) it returns the boot-seeded last-good cache so
 * the row is never blank/mock on a cold refresh; once the feed is ready it
 * returns the live `graduated` subset verbatim (even when empty — an honest
 * "no graduated right now"). Live rows are trailing-throttled into the cache
 * so the next hard refresh seeds instantly.
 */
export function useGraduatedRenderCache(
  liveGraduated: readonly MockCoin[],
  feedReady: boolean,
  /** FALSE while a section search query narrows `liveGraduated` — a
   *  narrowed list must never become the next session's boot seed (it
   *  would render a mostly-empty row under an empty search box). */
  persistable = true,
): MockCoin[] {
  // The boot seed is adopted AFTER hydration (one post-mount commit), never
  // in the initial render: the server rendered zero graduated cards, so a
  // useState initializer that returns cached cards makes the client's
  // hydration pass structurally diverge from the server HTML — a minified
  // React #418 on every warm reload of /discover (reproduced headless with
  // a captured cache blob). The sibling lanes already paint post-hydration;
  // this matches them, at the cost of the seed appearing one frame later.
  const [seed, setSeed] = useState<MockCoin[]>([]);
  useEffect(() => {
    if (bootSeed.length > 0) setSeed(limitDiscoverRows(bootSeed));
  }, []);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(liveGraduated);
  latestRef.current = liveGraduated;
  const persistableRef = useRef(persistable);
  persistableRef.current = persistable;

  useEffect(() => {
    if (!feedReady || !persistable || liveGraduated.length === 0) return;
    if (flushRef.current !== null) return;
    flushRef.current = setTimeout(() => {
      flushRef.current = null;
      // Re-check at fire time: a query typed during the 2s trailing delay
      // narrows latestRef and must not reach storage.
      if (persistableRef.current) writeCachedGraduatedCoins(latestRef.current);
    }, CACHE_FLUSH_DELAY_MS);
  }, [feedReady, persistable, liveGraduated]);

  useEffect(
    () => () => {
      if (flushRef.current !== null) clearTimeout(flushRef.current);
    },
    [],
  );

  return feedReady ? (liveGraduated as MockCoin[]) : seed;
}

function readCachedGraduatedCoins(): MockCoin[] | null {
  if (typeof window === 'undefined') return null;
  const cached = readCachedGraduatedCoinsFromStorage(
    () => window.localStorage,
    GRADUATED_LOCAL_CACHE_KEY,
  );
  if (cached) return cached;
  return readCachedGraduatedCoinsFromStorage(
    () => window.sessionStorage,
    GRADUATED_SESSION_CACHE_KEY,
  );
}

function writeCachedGraduatedCoins(coins: readonly MockCoin[]): void {
  if (typeof window === 'undefined' || coins.length === 0) return;
  const payload = JSON.stringify({ savedAtMs: Date.now(), coins });
  try {
    window.localStorage.setItem(GRADUATED_LOCAL_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
  try {
    window.sessionStorage.setItem(GRADUATED_SESSION_CACHE_KEY, payload);
  } catch {
    // Best-effort render cache only.
  }
}

function readCachedGraduatedCoinsFromStorage(
  storageFactory: () => Storage,
  key: string,
): MockCoin[] | null {
  try {
    const storage = storageFactory();
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAtMs?: unknown; coins?: unknown };
    if (
      typeof parsed.savedAtMs !== 'number'
      || Date.now() - parsed.savedAtMs > GRADUATED_CACHE_TTL_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    if (!Array.isArray(parsed.coins)) return null;
    const coins = parsed.coins.filter(isCachedCoin);
    return coins.length > 0 ? coins : null;
  } catch {
    return null;
  }
}

function isCachedCoin(value: unknown): value is MockCoin {
  if (!value || typeof value !== 'object') return false;
  const coin = value as Partial<MockCoin>;
  return typeof coin.id === 'string'
    && typeof coin.ticker === 'string'
    && typeof coin.name === 'string'
    && typeof coin.handle === 'string'
    && typeof coin.imageUrl === 'string'
    && Array.isArray(coin.platforms)
    && typeof coin.ageLabel === 'string'
    && typeof coin.volume === 'string'
    && typeof coin.marketCap === 'string'
    && typeof coin.followers === 'string'
    && typeof coin.txns === 'number';
}

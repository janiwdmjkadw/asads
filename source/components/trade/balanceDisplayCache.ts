/**
 * Session-scoped memory of the last KNOWN token-balance display per
 * `(wallet, mint)`. `useTradeStream` clears `tokenBalance` to null on a
 * balance-key change and panels then render `0` until the next poll — this
 * cache lets the display fall back to the last confirmed value (muted)
 * instead of flashing zero.
 *
 * DISPLAY ONLY, by contract: nothing here may feed sell sizing, balance
 * hints, or order payloads. The write-through sessionStorage blob survives
 * a soft navigation; the injectable storage param keeps the module
 * bun-testable (no `window` in the test env).
 */

export interface DisplayBalanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DisplayBalanceEntry {
  readonly tokens: string; // decimal base units
  readonly atMs: number;
}

const MAX_ENTRIES = 50;
const STORAGE_KEY = 'trade:display-balances:v1';

// Insertion-ordered Map doubles as the LRU: writes re-insert at the tail,
// eviction pops the head.
const cache = new Map<string, DisplayBalanceEntry>();
// `undefined` = hydration not attempted yet (first call hydrates once).
let hydrated = false;

function displayBalanceKey(walletAccountId: string | null, mint: string): string {
  return `${walletAccountId ?? 'primary'}|${mint}`;
}

function defaultStorage(): DisplayBalanceStorage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function hydrate(storage: DisplayBalanceStorage | null): void {
  if (hydrated) return;
  hydrated = true;
  if (storage === null) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!Array.isArray(row) || row.length !== 2) continue;
      const [key, entry] = row as [unknown, { tokens?: unknown; atMs?: unknown } | null];
      if (
        typeof key !== 'string' ||
        entry === null ||
        typeof entry !== 'object' ||
        typeof entry.tokens !== 'string' ||
        typeof entry.atMs !== 'number'
      ) {
        continue;
      }
      cache.set(key, { tokens: entry.tokens, atMs: entry.atMs });
    }
  } catch {
    // Corrupt blob / storage denied — start empty.
  }
}

function persist(storage: DisplayBalanceStorage | null): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
  } catch {
    // Quota / privacy mode — the cache is best-effort.
  }
}

export function rememberDisplayBalance(
  walletAccountId: string | null,
  mint: string,
  tokens: string,
  storage: DisplayBalanceStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  hydrate(storage);
  const key = displayBalanceKey(walletAccountId, mint);
  cache.delete(key); // re-insert at the LRU tail
  cache.set(key, { tokens, atMs: now });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  persist(storage);
}

export function readDisplayBalance(
  walletAccountId: string | null,
  mint: string,
  storage: DisplayBalanceStorage | null = defaultStorage(),
): DisplayBalanceEntry | null {
  hydrate(storage);
  return cache.get(displayBalanceKey(walletAccountId, mint)) ?? null;
}

/** Test-only: clears the memory cache and re-arms hydration. */
export function _resetBalanceDisplayCacheForTests(): void {
  cache.clear();
  hydrated = false;
}

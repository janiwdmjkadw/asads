/**
 * Watchlist data layer — the client contract for the per-user token
 * watchlist (trade-page star + navbar chip strip). Per-user rows live
 * server-side (Clerk-scoped Aurora, /api/watchlist) so the list is durable
 * and cross-device; market data for the chips is polled separately from
 * the ingestion batch snapshot endpoint.
 */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Mirrors the server cap in app/api/watchlist/route.ts. */
export const MAX_WATCHED_TOKENS = 50;

export interface WatchedToken {
  mint: string;
  createdAtMs: number;
}

export function isValidWatchMint(input: string): boolean {
  return BASE58_RE.test(input.trim());
}

const isDev = process.env.NODE_ENV !== 'production';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function sendJson<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// Dev/offline fallback: localhost can't reach the Clerk-gated route +
// private Aurora, so the per-user CRUD 401/503s. In development we
// transparently persist to localStorage so the surface is fully usable
// offline (mirrors lib/api/tracker.ts). Production always uses the DB API.
const DEV_KEY = 'watchlist:dev:tokens:v1';

function devRead(): WatchedToken[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DEV_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as WatchedToken[]) : [];
  } catch {
    return [];
  }
}

function devWrite(list: WatchedToken[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEV_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

export async function fetchWatchlist(): Promise<WatchedToken[]> {
  try {
    const data = await getJson<{ tokens?: WatchedToken[] }>('/api/watchlist');
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch (e) {
    if (isDev) return devRead();
    throw e;
  }
}

export async function addWatchedToken(mint: string): Promise<void> {
  try {
    await sendJson('/api/watchlist', 'POST', { mint });
  } catch (e) {
    if (!isDev) throw e;
    const list = devRead();
    if (!list.some((t) => t.mint === mint)) {
      devWrite([{ mint, createdAtMs: Date.now() }, ...list].slice(0, MAX_WATCHED_TOKENS));
    }
  }
}

export async function removeWatchedToken(mint: string): Promise<void> {
  try {
    await sendJson(`/api/watchlist?mint=${encodeURIComponent(mint)}`, 'DELETE');
  } catch (e) {
    if (!isDev) throw e;
    devWrite(devRead().filter((t) => t.mint !== mint));
  }
}

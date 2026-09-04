/**
 * Hidden-tokens data layer — the client contract for the per-user hidden
 * token set (the Discover hide button). Per-user rows live server-side
 * (Clerk-scoped Aurora, /api/hidden-tokens) so the set is durable and
 * cross-device; the Discover rows filter against the in-memory mint set,
 * so hiding stays instant.
 */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Mirrors the server cap in app/api/hidden-tokens/route.ts. */
export const MAX_HIDDEN_TOKENS = 2000;

export interface HiddenToken {
  mint: string;
  createdAtMs: number;
}

export function isValidHiddenMint(input: string): boolean {
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
// offline (mirrors lib/api/watchlist.ts). Production always uses the DB API.
const DEV_KEY = 'hidden-tokens:dev:v1';

function devRead(): HiddenToken[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DEV_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as HiddenToken[]) : [];
  } catch {
    return [];
  }
}

function devWrite(list: HiddenToken[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEV_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

export async function fetchHiddenTokens(): Promise<HiddenToken[]> {
  try {
    const data = await getJson<{ tokens?: HiddenToken[] }>('/api/hidden-tokens');
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch (e) {
    if (isDev) return devRead();
    throw e;
  }
}

export async function addHiddenToken(mint: string): Promise<void> {
  try {
    await sendJson('/api/hidden-tokens', 'POST', { mint });
  } catch (e) {
    if (!isDev) throw e;
    const list = devRead();
    if (!list.some((t) => t.mint === mint)) {
      devWrite([{ mint, createdAtMs: Date.now() }, ...list].slice(0, MAX_HIDDEN_TOKENS));
    }
  }
}

export async function removeHiddenToken(mint: string): Promise<void> {
  try {
    await sendJson(`/api/hidden-tokens?mint=${encodeURIComponent(mint)}`, 'DELETE');
  } catch (e) {
    if (!isDev) throw e;
    devWrite(devRead().filter((t) => t.mint !== mint));
  }
}

export async function removeAllHiddenTokens(): Promise<void> {
  try {
    await sendJson('/api/hidden-tokens?all=1', 'DELETE');
  } catch (e) {
    if (!isDev) throw e;
    devWrite([]);
  }
}

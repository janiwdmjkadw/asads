/**
 * Tracker data layer — the client contract for the Tracker page's two
 * panels (tracked Twitter handles + tracked Solana wallets) and the
 * tweet feed that backs the left panel.
 *
 * Tweets reuse the same `TweetDTO` the hover card standardizes on; the
 * feed is just the same `tweets` table read by `author_handle` instead
 * of by id. Per-user tracked lists live server-side (Clerk-scoped
 * Aurora rows) so they are durable + cross-device and, for wallets,
 * feed the trading service's subscribe-once-per-wallet registry.
 */

import type { TweetDTO } from './tweet';

/** Twitter handle: 1–15 chars of [A-Za-z0-9_], no leading '@'. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface TrackableAccount {
  /** Lowercased handle we have captured tweets for. */
  handle: string;
  /** Tweets currently cached for this handle (retention window). */
  tweets: number;
  /** Epoch ms of the most recent captured tweet, or null. */
  lastMs: number | null;
}

export interface TrackedAccount {
  handle: string;
  createdAtMs: number;
}

export interface TrackedWalletRow {
  address: string;
  label: string | null;
  createdAtMs: number;
}

export interface TrackerWalletActivityEvent {
  signature: string;
  slot: number;
  blockTimeMs: number | null;
  wallet: string;
  mint: string;
  isBuy: boolean;
  solLamports: string;
  tokens: string;
  venue: 'bonding_curve' | 'amm';
  /** Exact at-trade market cap in lamports (string bigint), null when the
   *  server could not compute it (or the row predates the column). */
  mcLamports?: string | null;
  receivedAtMs: number;
}

/** Normalize raw input (`@Elon`, ` elonmusk `) to a canonical handle. */
export function normalizeHandle(input: string): string | null {
  const trimmed = input.trim().replace(/^@+/, '');
  if (!HANDLE_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function isValidWalletAddress(input: string): boolean {
  return BASE58_RE.test(input.trim());
}

export function shortAddress(address: string): string {
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
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

// ── Trackable accounts (the set we actually capture tweets for) ──────

export async function fetchTrackableAccounts(): Promise<TrackableAccount[]> {
  try {
    const data = await getJson<{ handles?: TrackableAccount[] }>('/api/tracker/available');
    return Array.isArray(data.handles) ? data.handles : [];
  } catch {
    return [];
  }
}

// Dev/offline fallback: localhost can't reach the Clerk-gated api +
// private Aurora, so the per-user CRUD routes 401/503. In development we
// transparently persist to localStorage so the page is fully usable
// offline (mirrors the tweet-fixture dev loop). Production always uses
// the DB API; this fallback only triggers on a non-ok response and only
// when NODE_ENV !== 'production'.
const DEV_KEY = { accounts: 'tracker:dev:accounts:v1', wallets: 'tracker:dev:wallets:v1' };

function devRead<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function devWrite<T>(key: string, list: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

// ── Tracked Twitter accounts (per user) ─────────────────────────────

export async function fetchTrackedAccounts(): Promise<TrackedAccount[]> {
  try {
    const data = await getJson<{ accounts?: TrackedAccount[] }>('/api/tracker/accounts');
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch (e) {
    if (isDev) return devRead<TrackedAccount>(DEV_KEY.accounts);
    throw e;
  }
}

export async function addTrackedAccount(handle: string): Promise<void> {
  try {
    await sendJson('/api/tracker/accounts', 'POST', { handle });
  } catch (e) {
    if (!isDev) throw e;
    const list = devRead<TrackedAccount>(DEV_KEY.accounts);
    if (!list.some((a) => a.handle === handle)) {
      devWrite(DEV_KEY.accounts, [{ handle, createdAtMs: Date.now() }, ...list]);
    }
  }
}

export async function removeTrackedAccount(handle: string): Promise<void> {
  try {
    await sendJson(`/api/tracker/accounts?handle=${encodeURIComponent(handle)}`, 'DELETE');
  } catch (e) {
    if (!isDev) throw e;
    devWrite(DEV_KEY.accounts, devRead<TrackedAccount>(DEV_KEY.accounts).filter((a) => a.handle !== handle));
  }
}

/** Track every available handle (most-tweeted first) up to the server cap.
 *  One server-side statement — never a loop of single adds. Returns how many
 *  handles were newly added. */
export async function trackAllAccounts(): Promise<number> {
  try {
    const data = await sendJson<{ added?: number }>('/api/tracker/accounts/bulk', 'POST', {
      action: 'track-all',
    });
    return typeof data.added === 'number' ? data.added : 0;
  } catch (e) {
    if (!isDev) throw e;
    // Dev fallback mirrors the server rule: fill to the cap from the
    // available list (already ordered by tweet count desc).
    const available = await fetchTrackableAccounts();
    const list = devRead<TrackedAccount>(DEV_KEY.accounts);
    const tracked = new Set(list.map((a) => a.handle));
    const room = Math.max(0, 200 - list.length);
    const fresh = available
      .filter((a) => !tracked.has(a.handle))
      .slice(0, room)
      .map((a) => ({ handle: a.handle, createdAtMs: Date.now() }));
    devWrite(DEV_KEY.accounts, [...fresh, ...list]);
    return fresh.length;
  }
}

/** Untrack every handle the caller tracks. */
export async function untrackAllAccounts(): Promise<void> {
  try {
    await sendJson('/api/tracker/accounts/bulk', 'POST', { action: 'untrack-all' });
  } catch (e) {
    if (!isDev) throw e;
    devWrite(DEV_KEY.accounts, []);
  }
}

// ── Tracked wallets (per user; drives the global subscribe-once set) ─

export async function fetchTrackedWallets(): Promise<TrackedWalletRow[]> {
  try {
    const data = await getJson<{ wallets?: TrackedWalletRow[] }>('/api/tracker/wallets');
    return Array.isArray(data.wallets) ? data.wallets : [];
  } catch (e) {
    if (isDev) return devRead<TrackedWalletRow>(DEV_KEY.wallets);
    throw e;
  }
}

export async function addTrackedWallet(address: string, label?: string): Promise<void> {
  try {
    await sendJson('/api/tracker/wallets', 'POST', { address, label: label ?? null });
  } catch (e) {
    if (!isDev) throw e;
    const list = devRead<TrackedWalletRow>(DEV_KEY.wallets);
    if (!list.some((w) => w.address === address)) {
      devWrite(DEV_KEY.wallets, [{ address, label: label ?? null, createdAtMs: Date.now() }, ...list]);
    }
  }
}

export async function removeTrackedWallet(address: string): Promise<void> {
  try {
    await sendJson(`/api/tracker/wallets?address=${encodeURIComponent(address)}`, 'DELETE');
  } catch (e) {
    if (!isDev) throw e;
    devWrite(DEV_KEY.wallets, devRead<TrackedWalletRow>(DEV_KEY.wallets).filter((w) => w.address !== address));
  }
}

// ── Tweet feed by handle ────────────────────────────────────────────

export async function fetchTrackerTweets(handles: string[], limit = 40): Promise<TweetDTO[]> {
  if (handles.length === 0) return [];
  const qs = `handles=${encodeURIComponent(handles.join(','))}&limit=${limit}`;
  try {
    const data = await getJson<{ tweets?: TweetDTO[] }>(`/api/tracker/tweets?${qs}`);
    const tweets = Array.isArray(data.tweets) ? data.tweets : [];
    // Local dev can't reach the private Aurora, so the route returns an
    // empty list. Synthesize a content-rich feed from the dev fixture so
    // the page is fully exercisable offline (mirrors lib/api/tweet.ts).
    if (tweets.length === 0 && isDev) return devFixtureTweets(handles);
    return tweets;
  } catch {
    if (isDev) return devFixtureTweets(handles);
    return [];
  }
}

export function trackerTweetsStreamUrl(handles: string[]): string | null {
  if (handles.length === 0) return null;
  return `/api/tracker/tweets/stream?handles=${encodeURIComponent(handles.join(','))}`;
}

export async function fetchTrackerWalletActivityForMint(
  mint: string | null | undefined,
  wallets: string[],
  limit = 500,
): Promise<TrackerWalletActivityEvent[]> {
  const cleanMint = mint?.trim();
  if (!cleanMint || wallets.length === 0) return [];
  const qs = new URLSearchParams({
    mint: cleanMint,
    wallets: wallets.join(','),
    limit: String(limit),
  });
  try {
    // The route omits `mint` from each row (constant — we passed it);
    // reconstruct it here so the DTO satisfies WalletActivityEvent consumers.
    const data = await getJson<{ events?: Array<Omit<TrackerWalletActivityEvent, 'mint'>> }>(
      `/api/tracker/wallet-activity?${qs.toString()}`,
    );
    if (!Array.isArray(data.events)) return [];
    return data.events.map((event) => ({ ...event, mint: cleanMint }));
  } catch {
    return [];
  }
}

async function devFixtureTweets(handles: string[]): Promise<TweetDTO[]> {
  const { resolveFixtureTweet } = await import('./tweet-fixture');
  const base = resolveFixtureTweet('fixture');
  if (base.kind !== 'ok') return [];
  const out: TweetDTO[] = [];
  handles.forEach((handle, hi) => {
    for (let i = 0; i < 4; i += 1) {
      const ageMs = (hi * 4 + i) * 7 * 60_000;
      out.push({
        ...base.tweet,
        id: `dev-${handle}-${i}`,
        url: `https://x.com/${handle}/status/${1000 + hi * 4 + i}`,
        createdAtMs: Date.now() - ageMs,
        text: `Dev fixture tweet #${i + 1} from @${handle}. The tracker feed renders these locally because Aurora is unreachable off-VPC.\n\nReplace with live data in production.`,
        author: { ...base.tweet.author, handle, name: handle },
      });
    }
  });
  return out.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

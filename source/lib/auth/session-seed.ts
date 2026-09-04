/**
 * Cold-start session seed contract between the (terminal) server layout and
 * the client Clerk session mirror.
 *
 * The server layout inlines `window.__LISTEN_SESSION_SEED__ = { t, m }`
 * (JWT + receipt timestamp) into the initial HTML; the zustand session
 * store consumes it at module init so `getClerkSession().token` is
 * non-null from the very first client frame — before clerk.browser.js has
 * even started downloading. `m` is stamped CLIENT-SIDE at script parse
 * time (`Date.now()` emitted as code, not a server value) so the
 * freshness check below compares two readings of the SAME clock — server
 * ⇄ client clock skew cannot reject fresh seeds or admit stale ones.
 * Clerk session JWTs live ~60s, so a stale seed (e.g. an RSC router-cache
 * replay, which re-executes the script) is discarded rather than trusted.
 */

export const SESSION_SEED_GLOBAL = '__LISTEN_SESSION_SEED__';

/** Reject seeds older than this — Clerk JWT TTL is ~60s; leave headroom. */
const SEED_MAX_AGE_MS = 45_000;

export interface SessionSeed {
  readonly token: string;
  readonly mintedAtMs: number;
}

export function readSessionSeed(): SessionSeed | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as unknown as Record<string, unknown>)[SESSION_SEED_GLOBAL];
  if (!raw || typeof raw !== 'object') return null;
  const token = (raw as { t?: unknown }).t;
  const mintedAtMs = (raw as { m?: unknown }).m;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof mintedAtMs !== 'number' || !Number.isFinite(mintedAtMs)) return null;
  if (Date.now() - mintedAtMs > SEED_MAX_AGE_MS) return null;
  return { token, mintedAtMs };
}

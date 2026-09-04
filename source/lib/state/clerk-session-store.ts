import { create } from 'zustand';
import { readSessionSeed } from '@/lib/auth/session-seed';

/**
 * Global mirror of the current Clerk session, kept in sync by the
 * `<ClerkSessionSync />` provider (mounted once at app root).
 *
 * Why this exists: `useAuth().getToken()` returns a Promise even
 * when Clerk's internal cache has a valid JWT. On latency-critical
 * paths (Quickbuy click → submit, prewarm interval, hot-path order
 * submission) that microtask + the Promise allocation are measurable
 * — we shave them by mirroring the latest token into a Zustand store
 * that callers read synchronously.
 *
 * Safety model:
 *   - The token in the store is best-effort. If Clerk rotated the
 *     JWT between mirror updates and the cached one is stale, api/
 *     returns 401 → callers handle the existing reauth path.
 *   - The store is never the source of truth — Clerk's own session
 *     state is. We just shadow it for read speed.
 *   - On sign-out, the sync provider clears the token to null so
 *     hot paths short-circuit immediately (no need to wait for the
 *     next render).
 *
 * Threat model: the token is already in memory at the same trust
 * boundary as anything `useAuth()` returns (the React tree). The
 * store doesn't widen the surface — it just exposes a synchronous
 * view of what was already there.
 */

export interface ClerkSessionSnapshot {
  /**
   * Latest JWT seen from `getToken()`. Null when signed out, when
   * Clerk hasn't loaded yet, or when the last refresh failed.
   * Hot-path callers treat null as "skip" rather than "wait".
   */
  readonly token: string | null;
  /**
   * Epoch-ms expiry of `token`, decoded from its `exp` claim once per
   * rotation (never on the hot read path). Null when there is no token
   * or the payload didn't parse — callers fail open to today's
   * behavior. Lets hot paths spot a stale-after-idle mirror (laptop
   * sleep, long-hidden tab) without submitting a dead bearer.
   */
  readonly tokenExpMs: number | null;
  /**
   * Tri-state Clerk auth result. `null` = Clerk hasn't loaded yet.
   * True/false once Clerk reports. Callers should branch on
   * `isSignedIn === true` (not truthy) to avoid the loading state
   * looking signed-in.
   */
  readonly isSignedIn: boolean | null;
  /** True once `useAuth().isLoaded` has flipped true at least once. */
  readonly isLoaded: boolean;
  /**
   * Monotonic counter bumped on every successful refresh. Useful
   * for effects that want to re-fire when the token rotates (e.g.
   * reopen an SSE stream).
   */
  readonly tokenVersion: number;
}

interface ClerkSessionState extends ClerkSessionSnapshot {
  // `tokenExpMs` is derived inside the store (decoded from the token),
  // so callers never pass it.
  setSession: (next: Omit<ClerkSessionSnapshot, 'tokenVersion' | 'tokenExpMs'>) => void;
  clear: () => void;
}

const INITIAL: ClerkSessionSnapshot = {
  token: null,
  tokenExpMs: null,
  isSignedIn: null,
  isLoaded: false,
  tokenVersion: 0,
};

/**
 * Decode a JWT's `exp` claim to epoch ms without a library. Best-effort:
 * any parse failure returns null, which consumers treat as "no expiry
 * known" (today's behavior). Runs once per token rotation — never on the
 * synchronous read path.
 */
function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Cold-start fast path: the (terminal) server layout inlines a freshly
 * minted session JWT into the initial HTML (see lib/auth/session-seed.ts).
 * Consuming it here — at module init, before any effect runs — means hot
 * paths (quickbuy submit, /me, SOL balance) carry a valid bearer from the
 * first frame instead of waiting ~1-3s for clerk.browser.js on a cold cache.
 * `isLoaded: true` is intentional: the seed IS an authoritative "signed in"
 * answer from the server; ClerkSessionSync overwrites the whole snapshot as
 * soon as Clerk JS reports for real.
 */
function seededInitial(): ClerkSessionSnapshot {
  const seed = readSessionSeed();
  if (!seed) return INITIAL;
  return {
    token: seed.token,
    tokenExpMs: decodeJwtExpMs(seed.token),
    isSignedIn: true,
    isLoaded: true,
    tokenVersion: 1,
  };
}

export const useClerkSessionStore = create<ClerkSessionState>((set, get) => ({
  ...seededInitial(),
  setSession: (next) => {
    const prev = get();
    // Only bump tokenVersion when the token actually changed value —
    // a same-token refresh shouldn't kick downstream effects. Same
    // applies to `isLoaded` and `isSignedIn` flips.
    const tokenChanged = next.token !== prev.token;
    set({
      token: next.token,
      // Decode `exp` only on real rotation — same-token refreshes stay free.
      tokenExpMs: tokenChanged
        ? (next.token !== null ? decodeJwtExpMs(next.token) : null)
        : prev.tokenExpMs,
      isSignedIn: next.isSignedIn,
      isLoaded: next.isLoaded,
      tokenVersion: tokenChanged ? prev.tokenVersion + 1 : prev.tokenVersion,
    });
  },
  clear: () => set({ ...INITIAL }),
}));

/**
 * Imperative read for use outside React (event handlers in
 * non-component code, module-level helpers, etc.). Equivalent to
 * `useClerkSessionStore.getState()` but reads cleaner at call sites.
 */
export function getClerkSession(): ClerkSessionSnapshot {
  const s = useClerkSessionStore.getState();
  return {
    token: s.token,
    tokenExpMs: s.tokenExpMs,
    isSignedIn: s.isSignedIn,
    isLoaded: s.isLoaded,
    tokenVersion: s.tokenVersion,
  };
}

/**
 * Decode a JWT's `sub` claim (the Clerk user id for Clerk session
 * tokens). Best-effort, cached per token value so repeated reads are
 * free. Lets cold-boot paths know WHO is signed in from the
 * server-inlined seed, frames before clerk.browser.js reports
 * `useAuth().userId` — e.g. so per-user localStorage state (tracked
 * wallets) hydrates under the right key immediately instead of the
 * anon key.
 */
let cachedSubForToken: string | null = null;
let cachedSub: string | null = null;

function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

export function getMirroredClerkUserId(): string | null {
  const token = useClerkSessionStore.getState().token;
  if (token === null) return null;
  if (token !== cachedSubForToken) {
    cachedSubForToken = token;
    cachedSub = decodeJwtSub(token);
  }
  return cachedSub;
}

/**
 * Self-heal: force-mint a fresh JWT via the global clerk-js instance and
 * mirror it into the store. Called from outside React (cold-boot-auth)
 * when the api answered `reauth_required` to a request that DID carry a
 * bearer — i.e. the mirrored token went stale between syncs. Single-flight
 * so a burst of rejected queries mints at most one token.
 */
let mirrorRefreshInFlight = false;

interface ClerkGlobal {
  Clerk?: {
    session?: {
      getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
    } | null;
  };
}

export async function forceClerkMirrorRefresh(): Promise<void> {
  if (mirrorRefreshInFlight) return;
  const session = (globalThis as ClerkGlobal).Clerk?.session;
  if (!session) return;
  mirrorRefreshInFlight = true;
  try {
    const token = await session.getToken({ skipCache: true });
    // Only mirror a real token. A null here means clerk-js itself could
    // not refresh (signed out / revoked); leave the store for
    // ClerkSessionSync to settle so we don't fight its tri-state.
    if (token) {
      useClerkSessionStore.getState().setSession({ token, isSignedIn: true, isLoaded: true });
    }
  } catch {
    // Transient mint failure — the 30s sync interval is the fallback.
  } finally {
    mirrorRefreshInFlight = false;
  }
}

/** Test-only: reset to initial state between cases. */
export function _resetClerkSessionStoreForTests(): void {
  useClerkSessionStore.setState({ ...INITIAL });
}

import { getClerkSession } from '@/lib/state/clerk-session-store';

// Hard cap on how long an order submit will wait for an auth token. The hot
// path (warm Clerk mirror) returns synchronously and never hits this. It only
// bounds the COLD window right after a page refresh, where the mirror isn't
// populated yet and Clerk's `getToken()` would otherwise block on the full
// JS-load + FAPI handshake + JWT mint (~seconds). On timeout we surface a
// fast retry instead of stalling — and we never fire a cookie-only POST,
// which cannot authenticate against the cross-site API origin.
const ORDER_TOKEN_WAIT_MS = 1_000;

// Treat a mirrored token expiring within this window as cold. Clerk JWTs
// live ~60s; after laptop sleep / a long-hidden tab the mirror can hold an
// expired token, and POSTing it is a guaranteed `reauth_required` (a lost
// click). 5s matches @clerk/backend's default clock-skew tolerance. An
// undecodable `exp` (tokenExpMs null) keeps the fast path — fail open.
const TOKEN_EXP_SKEW_MS = 5_000;

/**
 * Resolve the auth token for an order submit WITHOUT blocking the send on
 * Clerk's cold bootstrap:
 *   - warm (mirror has an unexpired token): return it synchronously →
 *     instant POST;
 *   - signed out: return null immediately;
 *   - cold (signed in / unknown, mirror empty or expired-after-idle): race
 *     `getToken()` against a short timeout so the order fires the instant
 *     the token lands, and never hangs the UI if Clerk is still loading.
 *
 * Shared by Discover quickbuy and every trade-page submit surface.
 */
export async function resolveOrderAuthToken(
  getToken: () => Promise<string | null>,
): Promise<string | null> {
  const session = getClerkSession();
  // One numeric compare — the warm path stays fully synchronous. A
  // near-expired mirror falls through to the bounded race below, where the
  // wake-time forced mint (ClerkSessionSync) is usually already in flight.
  const nearExpiry =
    session.tokenExpMs !== null && session.tokenExpMs - Date.now() < TOKEN_EXP_SKEW_MS;
  if (session.token !== null && !nearExpiry) return session.token;
  if (session.isLoaded && session.isSignedIn !== true) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getToken().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ORDER_TOKEN_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Single-flight guard for `warmOrderAuthToken`: rapid presses (spam-click,
// pointerdown + synthetic click) must not stack N Clerk refreshes. clerk-js
// dedups in-flight getToken() calls internally too; this just keeps us from
// even entering it repeatedly.
let warmInFlight = false;

/**
 * Fire-and-forget pre-warm of the order auth token, called at pointerdown /
 * press time. When the mirror is cold or near-expiry this starts Clerk's
 * `getToken()` early, so the submit path's `resolveOrderAuthToken` (which
 * calls `getToken()` again) joins the SAME in-flight mint via clerk-js's
 * token cache instead of starting it after gates/validation. Warming only —
 * no authorization decision moves earlier, and the warm path (mirror holds
 * an unexpired token) is a synchronous no-op.
 */
export function warmOrderAuthToken(getToken: () => Promise<string | null>): void {
  const session = getClerkSession();
  const nearExpiry =
    session.tokenExpMs !== null && session.tokenExpMs - Date.now() < TOKEN_EXP_SKEW_MS;
  if (session.token !== null && !nearExpiry) return;
  if (session.isLoaded && session.isSignedIn !== true) return;
  if (warmInFlight) return;
  warmInFlight = true;
  getToken()
    .catch(() => null)
    .finally(() => {
      warmInFlight = false;
    });
}

/**
 * Message for a submit that couldn't get a token. Distinguishes a genuine
 * signed-out state from the brief post-refresh bootstrap window so the toast
 * isn't a misleading "sign in required" when the user IS signed in and just
 * needs to tap again a beat later.
 */
export function orderTokenErrorMessage(): string {
  return getClerkSession().isSignedIn === true ? 'still signing in — tap again' : 'sign in required';
}

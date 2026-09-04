import {
  forceClerkMirrorRefresh,
  getClerkSession,
  useClerkSessionStore,
} from '@/lib/state/clerk-session-store';

/**
 * Cold-boot guard for cookie-optimistic read hooks.
 *
 * On a hard refresh the Clerk token mirror is empty, so the first fetch goes
 * out without a bearer — and against the cross-site API origin that request
 * cannot authenticate, so the api answers "reauth". That answer says nothing
 * about the session; caching it renders a signed-in user as signed out until
 * the next refetch. Throwing instead lets React Query retry and keep any
 * last good data.
 *
 * Stale-mirror self-heal: a reauth answer to a request that DID carry a
 * bearer usually means the mirrored JWT expired between syncs (Clerk
 * session tokens live ~60s). Force-mint a fresh token via clerk-js
 * (single-flight) and throw so React Query retries with it — without this,
 * one stale poll renders a signed-in user as "please sign in again" until
 * the next manual refetch.
 */
export const STALE_TOKEN_REAUTH = 'stale_token_reauth';
export const COLD_BOOT_UNAUTHENTICATED = 'cold_boot_unauthenticated';

export function throwOnColdBootReauth<T extends { kind: string }>(
  result: T,
  tokenUsed: string | null,
): T {
  if (result.kind !== 'reauth') return result;
  if (tokenUsed === null) {
    throw new Error(COLD_BOOT_UNAUTHENTICATED);
  }
  void forceClerkMirrorRefresh();
  throw new Error(STALE_TOKEN_REAUTH);
}

/**
 * Upper bound on one event-driven wait for the Clerk token mirror. With the
 * clerk.browser.js preload in the root layout the script is usually
 * cache-warm well under this; the bound only stops a dead Clerk CDN from
 * pinning queryFns forever (the cold-boot retry policy re-enters the wait
 * on the next attempt, so the total budget is retries × this bound).
 */
const CLERK_TOKEN_WAIT_TIMEOUT_MS = 8_000;

/**
 * Resolve the moment the Clerk session mirror can answer authoritatively:
 *   - mirror already has a token → resolves synchronously with it;
 *   - loaded + positively signed out → resolves null immediately;
 *   - cold (clerk-js still booting) → subscribes to the store and resolves
 *     the INSTANT a token lands (or signed-out is confirmed) — no polling,
 *     no fixed retry-delay quantization.
 */
export function awaitClerkToken(
  timeoutMs: number = CLERK_TOKEN_WAIT_TIMEOUT_MS,
): Promise<string | null> {
  const now = getClerkSession();
  if (now.token !== null) return Promise.resolve(now.token);
  if (now.isLoaded && now.isSignedIn === false) return Promise.resolve(null);
  return new Promise((resolve) => {
    // `settle` closes over `unsubscribe`/`timer`; both are assigned before
    // anything can invoke it (the store subscription never fires
    // synchronously and the timer is in the future).
    const settle = (token: string | null): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve(token);
    };
    const unsubscribe = useClerkSessionStore.subscribe((state) => {
      if (state.token !== null) {
        settle(state.token);
      } else if (state.isLoaded && state.isSignedIn === false) {
        settle(null);
      }
    });
    const timer = setTimeout(() => settle(getClerkSession().token), timeoutMs);
  });
}

/**
 * Cookie-optimistic fetch with event-driven cold-boot recovery.
 *
 * The first attempt fires IMMEDIATELY with whatever the mirror holds (warm
 * token, or null → session-cookie auth) — on a seeded boot or same-origin
 * deploy that first attempt simply succeeds and nothing below runs. When a
 * token-less attempt comes back as the cold-boot reauth, we wait for the
 * token mirror to populate (store subscription, resolves the instant
 * clerk-js mints) and retry ONCE within the same queryFn run. This replaces
 * the old fixed-delay retry loop, which quantized first data paint to
 * 1.5s steps after the token was already available.
 *
 * `doFetch` is expected to throw COLD_BOOT_UNAUTHENTICATED for a token-less
 * reauth answer (via `throwOnColdBootReauth` or the fetcher's own guard).
 * Every other error — including STALE_TOKEN_REAUTH — passes through to the
 * caller's retry policy untouched.
 */
export async function withColdBootAuth<T>(
  doFetch: (authToken: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await doFetch(getClerkSession().token);
  } catch (err) {
    if ((err as Error)?.message !== COLD_BOOT_UNAUTHENTICATED) throw err;
    const token = await awaitClerkToken();
    // Still no bearer (signed out, or Clerk genuinely down): rethrow the
    // cold-boot error so `coldBootRetry` decides — it re-enters this wait
    // on the next attempt while Clerk is loading, and stops once loaded.
    if (token === null) throw err;
    return doFetch(token);
  }
}

/**
 * Retry policy companion: the event-driven wait above means a retry here is
 * the EXCEPTION (signed-out boot, Clerk CDN outage, stale-token reauth) —
 * not the steady-state cold-boot path. Keep retrying (bounded) while Clerk
 * JS is still booting; a stale-token reauth retries a few times regardless
 * of load state (the forced mint lands within ~1 retry delay). For real
 * (typed) failures the fetchers resolve, so this never loops on genuine
 * errors.
 */
export function coldBootRetry(failureCount: number, error: Error): boolean {
  if (error?.message === STALE_TOKEN_REAUTH) {
    return failureCount < 3;
  }
  return !getClerkSession().isLoaded && failureCount < 20;
}

/**
 * Short on purpose: the in-queryFn wait handles the boot window, so this
 * delay only paces the exceptional retries above — it should not add a
 * perceptible step to recovery.
 */
export const COLD_BOOT_RETRY_DELAY_MS = 250;

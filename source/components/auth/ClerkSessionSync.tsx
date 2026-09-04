'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';

/**
 * Mirror Clerk session into the global Zustand store so latency-
 * critical paths can read the JWT synchronously instead of awaiting
 * `getToken()`. Mount this exactly once near the app root, inside
 * the `<ClerkProvider>` tree.
 *
 * Refresh cadence: Clerk session tokens are short-lived. We do one
 * cheap cached read on mount, then cached reads on the interval (Clerk
 * auto-refreshes near expiry, so the cached read returns the rotated
 * token when rotation actually happened) and force-mint only on browser
 * wake/focus/online events so the synchronous mirror does not outlive
 * Clerk's cached JWT while the user sits idle on a page. The store's
 * same-value guard keeps `tokenVersion` stable across same-token
 * refreshes, so tokenVersion-keyed effects (SSE reconnects, …) only
 * re-fire on REAL rotation.
 *
 * Rotation handling: if Clerk's SDK refreshes the underlying JWT
 * between our polls, the next poll picks it up. If api/ rejects a
 * call because the mirrored token went stale in the interim, the
 * caller's existing reauth handling (`reauth_required: true` →
 * Clerk modal) takes over — the store is best-effort, not the
 * source of truth.
 *
 * Renders nothing.
 */

const REFRESH_INTERVAL_MS = 30_000;
/**
 * Focus + visibilitychange + pageshow can all fire within the same
 * wake gesture — without a guard that's 2-3 concurrent forced JWT
 * mints. One forced refresh per window is plenty.
 */
const FORCED_REFRESH_MIN_INTERVAL_MS = 5_000;

export function ClerkSessionSync(): null {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const setSession = useClerkSessionStore((s) => s.setSession);
  const clear = useClerkSessionStore((s) => s.clear);

  useEffect(() => {
    if (!isLoaded) {
      // Clerk not initialised yet — leave the store in its initial
      // ({ token: null, isLoaded: false }) state so consumers can
      // distinguish "not loaded" from "loaded + signed out".
      return;
    }

    if (isSignedIn !== true) {
      // Loaded, but signed out (or unknown). Clear any stale token
      // so hot paths short-circuit immediately on the next read.
      setSession({ token: null, isSignedIn: false, isLoaded: true });
      return;
    }

    let cancelled = false;
    // Resolves true when the read/mint succeeded, false on failure —
    // never rejects. forceRefresh uses the flag to only charge SUCCESSFUL
    // forced mints against the min-interval budget.
    const fire = async (force = false): Promise<boolean> => {
      try {
        const token = await getToken(force ? { skipCache: true } : undefined);
        if (cancelled) return true;
        setSession({ token, isSignedIn: true, isLoaded: true });
        return true;
      } catch {
        // Keep the previous token in the store on refresh failure.
        // If the failure was transient (network blip, Clerk 5xx)
        // the next interval recovers; if it was actual session
        // revocation, the previously-mirrored token will 401 on
        // the next api/ call and trigger reauth.
        return false;
      }
    };

    void fire(false);

    // Single-flight + min-interval guard for the wake/focus handlers:
    // a refocus gesture fires focus + visibilitychange (+ pageshow on
    // bfcache restore) back-to-back; mint at most one forced JWT.
    let forcedInFlight = false;
    let lastForcedAtMs = 0;
    const forceRefresh = () => {
      const now = Date.now();
      if (forcedInFlight || now - lastForcedAtMs < FORCED_REFRESH_MIN_INTERVAL_MS) return;
      forcedInFlight = true;
      // Stamp the budget only on SUCCESS: a failed wake mint (e.g. laptop
      // wake before the network is back up) must not suppress the
      // follow-up 'online'-event refresh behind the min-interval guard.
      fire(true)
        .then((ok) => { if (ok) lastForcedAtMs = Date.now(); })
        .finally(() => { forcedInFlight = false; })
        .catch(() => { /* fire() never rejects; defensive */ });
    };
    const onVisibilityChange = () => {
      // visibilitychange also fires on HIDE — only refresh on show.
      if (document.hidden) return;
      forceRefresh();
    };
    // Interval uses the CACHED read: force-minting here would rotate the
    // JWT (and bump tokenVersion) every 30s by construction, re-running
    // every tokenVersion-keyed effect. Clerk refreshes its cache near
    // expiry, so the cached read still picks up real rotations.
    const onInterval = () => { void fire(false); };
    const timer = window.setInterval(onInterval, REFRESH_INTERVAL_MS);
    window.addEventListener('focus', forceRefresh);
    window.addEventListener('online', forceRefresh);
    window.addEventListener('pageshow', forceRefresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', forceRefresh);
      window.removeEventListener('online', forceRefresh);
      window.removeEventListener('pageshow', forceRefresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isLoaded, isSignedIn, getToken, setSession]);

  // On unmount (e.g. SPA route to a no-Clerk surface) clear so the
  // mirror doesn't outlive its subscription. Separate effect so the
  // refresh loop's dep array stays clean.
  useEffect(() => {
    return () => { clear(); };
  }, [clear]);

  return null;
}

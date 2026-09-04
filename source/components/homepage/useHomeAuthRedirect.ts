'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isAccessGateDisabled } from '@/lib/api/invite';
import { useMe } from '@/lib/api/me';

const POST_REDEEM_REDIRECT = '/discover' as const;

/**
 * Client-side gate safety net for `/`. The server render can miss a
 * just-set Clerk session (post-login redirect race / router cache),
 * leaving an authed user on the marketing page without the invite-code
 * modal. Once Clerk hydrates and /me resolves, this routes a redeemed
 * user into the app and hands everyone else back to `onNotRedeemed`
 * (which opens the modal) — runs once.
 *
 * Shared by both faces of `/`: the legacy HomeHero and the landing page.
 *
 * @param onNotRedeemed called once when the signed-in user has not
 *   redeemed a code. Must be referentially stable (a `useState` setter or
 *   a `useCallback`); it is an effect dependency.
 */
export function useHomeAuthRedirect(onNotRedeemed: () => void) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const meQuery = useMe();
  const autoHandledRef = useRef(false);

  useEffect(() => {
    if (autoHandledRef.current) return;
    if (!isLoaded || isSignedIn !== true) return;
    // Local-dev bypass: signed-in -> straight into the app, no code.
    if (isAccessGateDisabled()) {
      autoHandledRef.current = true;
      router.push(POST_REDEEM_REDIRECT);
      return;
    }
    const me = meQuery.data;
    if (!me || me.reauth_required) return;
    autoHandledRef.current = true;
    if (me.user.access_code_redeemed) {
      // Hard navigation: the client router cache may hold a pre-redemption
      // /discover payload (a redirect back to '/'), and replaying it from
      // here was the second half of the '/'<->'/discover' flash loop. A
      // full document load always gets the fresh server decision.
      //
      // Deliberately NO `router.prefetch('/discover')` anywhere on this
      // page either: for a NOT-YET-REDEEMED user the (terminal) layout
      // answers /discover with a redirect('/'), and prefetching caches
      // that redirect in the client router (staleTimes keeps it ~30s), so
      // the post-redeem push replayed the stale redirect -> '/' bounced
      // forward again -> an infinite '/'<->'/discover' flashing loop.
      window.location.assign(POST_REDEEM_REDIRECT);
    } else {
      onNotRedeemed();
    }
  }, [isLoaded, isSignedIn, meQuery.data, router, onNotRedeemed]);
}

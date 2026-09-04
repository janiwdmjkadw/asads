'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { bindReferral } from '@/lib/api/referral';
import { useMe } from '@/lib/api/me';
import { clearPendingReferral, readPendingReferral } from '@/lib/referral/pending';

// Slice "Referral & Rewards": once a Clerk session is active, bind the latest
// captured /fren slug to the user. The API enforces the real
// eligibility rules (not self, not already bound, no prior fills); this
// just fires the request once per session and clears the capture on any
// terminal outcome. Mounted in app/providers.tsx (inside ClerkProvider) so
// it runs on the homepage right after sign-up, before the user reaches the
// terminal shell.
//
// The dedicated /signup/fren/{slug} page owns binding (so it can show a
// confirmation modal), so this global fallback stands down on that route to
// avoid a double-bind race that would surface a misleading `already_bound`.

const MAX_RETRIES = 10;

export function ReferralBindSync(): null {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const pathname = usePathname();
  const meQuery = useMe({ enabled: isSignedIn === true });
  const attempted = useRef(false);
  const retryCount = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isLoaded || isSignedIn !== true || attempted.current) return;
    // Let the dedicated sign-up page handle the bind (+ confirmation modal).
    if (pathname?.startsWith('/signup')) return;
    const me = meQuery.data;
    if (!me || me.reauth_required) return;
    // Clerk signed-in is not the same as "user finished Listen signup".
    // Wait until invite-code redemption is complete.
    if (me.user.access_code_redeemed !== true) return;
    const slug = readPendingReferral();
    if (!slug) return;
    attempted.current = true;
    void (async () => {
      try {
        const result = await bindReferral(slug, { authToken: await getToken() });
        // Clear on any non-transient outcome (ok / rejected / reauth). On a
        // raw network error, leave the capture so a later session retries.
        if (result.kind !== 'error') {
          clearPendingReferral();
          retryCount.current = 0;
          return;
        }
        scheduleRetry();
      } catch {
        // Network/unknown — leave the capture for a future attempt.
        scheduleRetry();
      }
    })();
    return () => {
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [isLoaded, isSignedIn, getToken, meQuery.data, pathname, retryNonce]);

  function scheduleRetry(): void {
    if (retryCount.current >= MAX_RETRIES) return;
    attempted.current = false;
    retryCount.current += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(retryCount.current, 5));
    retryTimer.current = window.setTimeout(() => setRetryNonce((n) => n + 1), delayMs);
  }

  return null;
}

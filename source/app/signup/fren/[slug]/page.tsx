'use client';

import { SignUp, useAuth } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { bindReferral, resolveReferralSlug } from '@/lib/api/referral';
import { useMe } from '@/lib/api/me';
import { clearPendingReferral, rememberPendingReferral } from '@/lib/referral/pending';
import { FrenInvite } from '@/components/referral/FrenInvite';
import {
  ConfirmationModal,
  InviteStatus,
  SignupStyles,
  frenIdentity,
  type BindPhase,
} from '@/components/referral/SignupFrenArt';

// Slice "Referral & Rewards": dedicated /signup/fren/{slug} landing where a
// referred visitor completes sign-up. Flow:
//   1. Capture the slug (latest explicit link wins until bind) on mount so
//      attribution survives any OAuth/Web3 redirect round-trip.
//   2. Signed-out  -> show the invite context ("Your fren is @{slug}") with
//      Clerk's <SignUp/> mounted in-page (hash routing, redirects back here).
//   3. Signed-in   -> bind the referral server-side (idempotent, permanent
//      after bind) and show an explicit confirmation modal so it's obvious it worked.
// Public route — allow-listed in middleware.ts.

const POST_FLOW_REDIRECT = '/' as const;

export default function SignupFrenPage() {
  const params = useParams();
  const router = useRouter();
  const rawSlug = params?.slug;
  const slug = typeof rawSlug === 'string' ? rawSlug : Array.isArray(rawSlug) ? (rawSlug[0] ?? '') : '';
  const normalizedSlug = slug.trim().toLowerCase();
  const encodedSlug = encodeURIComponent(normalizedSlug);

  const { isLoaded, isSignedIn, getToken } = useAuth();
  const meQuery = useMe({ enabled: isSignedIn === true });
  const [valid, setValid] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<BindPhase>({ status: 'pending' });
  const [retryNonce, setRetryNonce] = useState(0);
  const bindAttempted = useRef(false);

  // Capture immediately + validate the slug for friendly copy.
  useEffect(() => {
    if (!normalizedSlug) {
      router.replace('/');
      return;
    }
    rememberPendingReferral(normalizedSlug);

    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const ok = await resolveReferralSlug(normalizedSlug, controller.signal);
      if (!cancelled) setValid(ok);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [normalizedSlug, router]);

  // Once a Clerk session is active, bind exactly once and surface the result.
  useEffect(() => {
    if (!isLoaded || isSignedIn !== true || bindAttempted.current || !normalizedSlug) return;
    const me = meQuery.data;
    if (!me || me.reauth_required) return;
    if (me.user.access_code_redeemed !== true) {
      // Clerk has created/restored a session, but Listen signup still needs
      // the invite-code step. Preserve the pending referral and hand off to
      // the normal homepage access-code flow; ReferralBindSync will bind once
      // access is redeemed.
      router.replace('/');
      return;
    }
    bindAttempted.current = true;
    setPhase({ status: 'binding' });
    void (async () => {
      const result = await bindReferral(normalizedSlug, { authToken: await getToken() });
      // Clear the capture on any non-transient outcome; keep it on a raw
      // network error so a later session (or ReferralBindSync) can retry.
      if (result.kind !== 'error') clearPendingReferral();
      setPhase({ status: 'done', result });
    })();
  }, [isLoaded, isSignedIn, getToken, meQuery.data, normalizedSlug, router, retryNonce]);

  const retryBind = () => {
    bindAttempted.current = false;
    setPhase({ status: 'pending' });
    // Bump a dep of the bind effect — resetting the ref alone never
    // re-runs it, which left the retry spinner stuck forever.
    setRetryNonce((n) => n + 1);
  };

  const identity = frenIdentity(normalizedSlug);
  const signedOut = isLoaded && isSignedIn !== true;
  const found = valid !== false;

  return (
    <>
      {/* SIGNED OUT: the invite, as a band of the landing page.
          See `FrenInvite` for why this is not the onboarding panel. */}
      {signedOut ? (
        <FrenInvite
          slug={normalizedSlug}
          valid={valid}
          action={
            <SignUp
              routing="hash"
              forceRedirectUrl={`/signup/fren/${encodedSlug}`}
              fallbackRedirectUrl={`/signup/fren/${encodedSlug}`}
              signInForceRedirectUrl={`/signup/fren/${encodedSlug}`}
            />
          }
        />
      ) : null}

      {/* Everything past sign-up stays on the dark utility ground: these
          are states, not a first impression. */}
      {!signedOut ? (
        <main
          className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16"
          style={{ background: '#08080b' }}
        >
          <SignupStyles />

          {!isLoaded ? (
            <span
              aria-label="Loading"
              className="sf-shimmer"
              style={{
                width: 200,
                height: 2,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, rgba(245,245,245,0.55), transparent)',
                backgroundSize: '200% 100%',
              }}
            />
          ) : null}

          {isLoaded && isSignedIn === true && meQuery.data && !meQuery.data.reauth_required ? (
            <InviteStatus accessRedeemed={meQuery.data.user.access_code_redeemed} />
          ) : null}

          {isLoaded &&
          isSignedIn === true &&
          meQuery.data &&
          !meQuery.data.reauth_required &&
          meQuery.data.user.access_code_redeemed === true ? (
            <ConfirmationModal
              slug={normalizedSlug}
              identity={identity}
              phase={phase}
              onContinue={() => router.push(POST_FLOW_REDIRECT)}
              onRetry={retryBind}
            />
          ) : null}
        </main>
      ) : null}
    </>
  );
}

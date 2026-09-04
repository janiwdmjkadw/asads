'use client';

import { useAuth } from '@clerk/nextjs';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import type { CodeVerdict } from '@/homepage/certificate-invite';
import { ACCESS_REDEEMED_STORAGE_KEY, redeemCode } from '@/lib/api/invite';
import { useMe } from '@/lib/api/me';
import { useFullscreenOnboarding } from '@/lib/onboarding/useFullscreenOnboarding';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { useHomeAuthRedirect } from './useHomeAuthRedirect';

// Lazy: either invite modal pulls framer-motion plus its own scene assets
// but only opens for authed-not-redeemed users — keep both out of the
// homepage bundle and load one chunk when the modal actually opens.
const CreatorPassModal = dynamic(
  () => import('@/homepage/creator-pass-modal').then((m) => m.CreatorPassModal),
  { ssr: false },
);

const CertificateInviteModal = dynamic(
  () => import('@/homepage/certificate-invite').then((m) => m.CertificateInviteModal),
  { ssr: false },
);

/** The classic creator pass is preserved and selectable; certificate is the default. */
function isClassicVariant() {
  return getRuntimeConfig().inviteModalVariant === 'classic';
}

const POST_REDEEM_REDIRECT = '/discover' as const;
const POST_REDEEM_ONBOARDING = '/welcome' as const;

/**
 * Where a FRESH redemption lands. With the full-screen onboarding on, go
 * straight there: routing to /discover first booted the whole terminal and
 * then let `OnboardingAutoOpen` push /welcome a beat later, so the user saw
 * the terminal flash by and got yanked out of it.
 *
 * Fallback is today's /discover, and it is harmless in every fail-closed
 * case (LD initializing, unreachable, ad-blocked, flag off): the auto-open
 * gate in TerminalShell still routes those users after boot — that is
 * exactly the seam this skips, not a path it removes.
 */
export function postRedeemDestination(fullscreenOnboarding: boolean): string {
  return fullscreenOnboarding ? POST_REDEEM_ONBOARDING : POST_REDEEM_REDIRECT;
}

export interface HomeAccessGateProps {
  /** Auto-open the invite-code modal (authed user who has not redeemed). */
  showAccessModal?: boolean;
  /** Sequential signup number for the pass seal. */
  userNumber?: number | null;
}

/**
 * The invite-code gate of `/`: the client-side auth safety net plus the
 * lazy invite-code modal it opens. Renders no layout of its own, so either
 * face of the homepage (HomeHero, LandingPage) can mount it as a sibling.
 */
export function HomeAccessGate({
  showAccessModal = false,
  userNumber = null,
}: HomeAccessGateProps = {}) {
  const [creatorPassOpen, setCreatorPassOpen] = useState(showAccessModal);
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { refetch: refetchMe } = useMe();
  const fullscreenOnboarding = useFullscreenOnboarding();
  const classic = isClassicVariant();

  const openModal = useCallback(() => setCreatorPassOpen(true), []);
  useHomeAuthRedirect(openModal);

  /* The api already answers WHY a code bounced (`not_found` |
     `already_redeemed` | `revoked`) and `redeemCode` already carries it
     through — this callback used to drop it on the floor by returning a
     bare boolean. The certificate's misprint names the reason, so it gets
     the whole verdict; the classic pass only understands a boolean and
     keeps getting one. */
  const validateAccessCode = useCallback(
    async (code: string): Promise<CodeVerdict> => {
      const result = await redeemCode(code, await getToken());
      if (result.accepted) {
        try {
          window.localStorage.setItem(ACCESS_REDEEMED_STORAGE_KEY, 'true');
        } catch {
          // localStorage is a flash-prevention cache only; ignore failures.
        }
        // Mint the signed `cp_redeemed` cookie NOW, concurrent with the
        // success animation, so the post-redeem hard navigation lands on
        // the (terminal) layout's cookie fast path instead of paying the
        // authoritative api round-trip on the very first /discover load.
        // The route re-verifies redemption server-side, so calling it
        // immediately post-redeem is safe; on a lost race the layout
        // simply falls back to the server check.
        void fetch('/api/session/redeemed', { method: 'POST' }).catch(() => undefined);
        // Client-cache refresh only — the post-redeem flow hard-navigates,
        // so don't block the success animation on a /me round trip.
        void refetchMe();
      }
      return { accepted: result.accepted, reason: result.reason };
    },
    [getToken, refetchMe],
  );

  const validateAccessCodeBoolean = useCallback(
    async (code: string): Promise<boolean> => (await validateAccessCode(code)).accepted,
    [validateAccessCode],
  );

  // Warm the post-auth path. A signed-in user on the homepage is about to
  // either open the invite-code modal (lazy ~50KB chunk) or fly into
  // /discover after redeeming — warm the chunk so that moment doesn't
  // stall on a network fetch.
  useEffect(() => {
    if (!isLoaded || isSignedIn !== true) return;
    void (classic
      ? import('@/homepage/creator-pass-modal')
      : import('@/homepage/certificate-invite'));
  }, [classic, isLoaded, isSignedIn]);

  // Mounted only while open so the dynamic chunk loads on demand
  // (the modal renders nothing while closed anyway).
  if (!creatorPassOpen) return null;

  const shared = {
    open: creatorPassOpen,
    onOpenChange: setCreatorPassOpen,
    serialNumber: userNumber,
    onSuccessAnimationComplete: () => {
      // The success flourish (certificate: mint bloom, then the ADMITTED
      // stamp coming down; classic: seal flare + the pass taking flight)
      // plays BEFORE this fires — the certificate holds the callback until
      // its stamp has settled — and this window is the beat after it.
      // HARD navigation on purpose: redemption just changed the
      // (terminal) layout's redirect decision, and any cached RSC
      // payload for /discover predates it (see useHomeAuthRedirect).
      // A full document load guarantees a fresh server render — and
      // seeds the session + redeemed cookie path — instead of
      // replaying a stale cached redirect into a loop.
      window.setTimeout(
        () => window.location.assign(postRedeemDestination(fullscreenOnboarding)),
        1050,
      );
    },
  };

  // Two call sites rather than one, because the two modals take different
  // validation contracts: the certificate reads the rejection reason to
  // pick its misprint, the classic pass only knows accepted/rejected.
  return classic ? (
    <CreatorPassModal {...shared} onValidateCode={validateAccessCodeBoolean} />
  ) : (
    <CertificateInviteModal {...shared} onValidateCode={validateAccessCode} />
  );
}

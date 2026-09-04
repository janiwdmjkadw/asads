'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { rememberPendingReferral } from '@/lib/referral/pending';

// Slice "Referral & Rewards": public /fren/{slug} short link (the shareable
// invite URL). Captures the referral slug (latest explicit link wins until
// server bind) so attribution survives the redirect, then hands off to the dedicated
// /signup/fren/{slug} page where the visitor completes sign-up and the
// referrer<-referee binding is confirmed. Public route — allow-listed in
// middleware.ts.

export default function FrenPage() {
  const params = useParams();
  const router = useRouter();
  const rawSlug = params?.slug;
  const slug = typeof rawSlug === 'string' ? rawSlug : Array.isArray(rawSlug) ? (rawSlug[0] ?? '') : '';
  const normalizedSlug = slug.trim().toLowerCase();

  useEffect(() => {
    if (!normalizedSlug) {
      router.replace('/');
      return;
    }
    // Capture immediately — don't wait on the network — then
    // forward to the sign-up page that owns the rest of the flow.
    rememberPendingReferral(normalizedSlug);
    router.replace(`/signup/fren/${encodeURIComponent(normalizedSlug)}`);
  }, [normalizedSlug, router]);

  return (
    /*
     * THE SAME GROUND AND THE SAME BLACK as /signup/fren/{slug}, which this
     * page hands off to.
     *
     * It used to paint `var(--bg, #0a0a0a)`, and `--bg` is not defined on
     * this route, so the fallback was what always rendered. That put three
     * different blacks in one handoff: #0a0a0a here, #070709 on the body,
     * #08080b on the destination. Both are #000000 now. The redirect fires on mount, so all a
     * visitor ever saw of this page was a flash of the wrong colour.
     *
     * The copy is down to one line for the same reason. It carried its own
     * 22px headline reading "You've got a fren invite", which is the same
     * sentence the destination sets at 58px: the same words in a different
     * voice, one frame apart.
     */
    <main
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6"
      style={{ background: '#000000' }}
    >
      <p
        className="relative font-geist-mono text-[11px] uppercase tracking-[0.16em]"
        style={{ color: 'rgba(245,245,245,0.42)' }}
      >
        {normalizedSlug ? `Taking you to @${normalizedSlug}...` : 'Redirecting...'}
      </p>
    </main>
  );
}

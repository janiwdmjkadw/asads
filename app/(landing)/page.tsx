import { Suspense } from 'react';

import { pageMeta } from '../../sandbox/siteMeta';

import { LandingPage } from '@/components/landing/LandingPage';
import { InvitePreview } from '../../sandbox/InvitePreview';

/*
 * `/` — the landing page.
 *
 * The production route file is a server component that reads the Clerk
 * session and decides whether to mount `HomeAccessGate`, which opens the
 * invite modal and routes an already-redeemed user into /discover. None of
 * that is here: the sandbox's mock `/me` is always redeemed, so the gate
 * would bounce you off this page the moment it loaded.
 *
 * `?invite=<id>` mounts an invite-code candidate over the page — `/?invite=1a`,
 * `/?invite=1g`, any id from /whatever. It renders nothing without that
 * parameter, so the plain landing is untouched.
 */
export const metadata = pageMeta({
  title: 'Listen',
  description:
    'The agentic trading terminal. Write the condition in a sentence, and it holds it against the market until it is true.',
  path: '/',
});

export default function HomeRoute() {
  return (
    <>
      <LandingPage />
      <Suspense fallback={null}>
        <InvitePreview />
      </Suspense>
    </>
  );
}

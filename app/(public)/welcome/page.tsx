import { Suspense } from 'react';

import { WelcomeClient } from './WelcomeClient';

/*
 * `/welcome` — the full screen post redemption onboarding.
 *
 * ── WHY THE ROUTE IS SPLIT IN TWO ────────────────────────────────────
 *
 * The flow reads `?step=2` with `useSearchParams`, and a client component
 * that calls it with no Suspense boundary above it cannot be prerendered:
 * Next has to bail the whole route out to client side rendering, and in a
 * production build that is a hard error rather than a warning. It failed
 * the deploy at "Generating static pages (4/19)".
 *
 * So the hook lives in `WelcomeClient` and this file is the server
 * component that puts a boundary over it. The fallback is `null` because
 * the flow paints its own full screen ground and a spinner would flash
 * against it for one frame.
 */
export default function WelcomeRoute() {
  return (
    <Suspense fallback={null}>
      <WelcomeClient />
    </Suspense>
  );
}

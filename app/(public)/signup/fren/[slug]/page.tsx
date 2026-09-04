import { Suspense } from 'react';

import { SignupFrenClient } from './SignupFrenClient';

/*
 * `/signup/fren/[slug]` — where a fren invite link lands.
 *
 * Split for the same reason `/welcome` is: it reads `?state` with
 * `useSearchParams`, and that hook in a client component with no Suspense
 * boundary above it is a build error rather than a warning. The hook is in
 * `SignupFrenClient`; this file is the boundary.
 */
export default function SignupFrenRoute() {
  return (
    <Suspense fallback={null}>
      <SignupFrenClient />
    </Suspense>
  );
}

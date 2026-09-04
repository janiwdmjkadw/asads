'use client';

import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { Pill, type PillProps } from './Pill';

/* Post-auth lands back on '/', which routes by redeemed status (redeemed
   -> /discover; not redeemed -> the invite-code modal). Same contract the
   product hero uses — see components/homepage/HomeHero.tsx. */
const POST_AUTH_REDIRECT = '/' as const;

/* Clerk's buttons clone their single child and attach the open-modal
   `onClick`, so the pill keeps its own markup (a real <button>, since it
   takes no `href`) and its focus ring. The wrappers exist because the
   landing sections are server components and Clerk's cloning has to happen
   on the client. */
export type AuthPillProps = Omit<PillProps, 'href'>;

/** Pill that opens the Clerk sign-in modal. */
export function SignInPill(props: AuthPillProps) {
  return (
    <SignInButton
      mode="modal"
      forceRedirectUrl={POST_AUTH_REDIRECT}
      signUpForceRedirectUrl={POST_AUTH_REDIRECT}
    >
      <Pill {...props} />
    </SignInButton>
  );
}

/** Pill that opens the Clerk sign-up modal. */
export function SignUpPill(props: AuthPillProps) {
  return (
    <SignUpButton
      mode="modal"
      forceRedirectUrl={POST_AUTH_REDIRECT}
      signInForceRedirectUrl={POST_AUTH_REDIRECT}
    >
      <Pill {...props} />
    </SignUpButton>
  );
}

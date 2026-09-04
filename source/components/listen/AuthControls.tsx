'use client';

import { SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';
import { AccountMenu } from './AccountMenu';

const AVATAR_SIZE = 28;

/* The account tile is one of the header's three budgeted accent spends, so
   it keeps the gradient — but not the 10px outer glow, and not a radius of
   its own: 8px and the one header hairline, like every other control. */
const triggerStyle: React.CSSProperties = {
  width: `${AVATAR_SIZE}px`,
  height: `${AVATAR_SIZE}px`,
  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
  border: '1px solid var(--hdr-edge)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
  borderRadius: 'var(--hdr-r)',
  cursor: 'pointer',
  padding: 0,
};

/**
 * Topnav auth surface. Replaces the static gradient avatar placeholder
 * with a Clerk-aware control:
 *
 * - Signed out: the same gradient circle, now a button that opens the
 *   Clerk sign-in modal (Axiom-style — no full-page redirect on the
 *   common path).
 * - Signed in: the app's own AccountMenu — the gradient tile again, now
 *   the trigger for a token-themed popover.
 *
 * The component renders nothing while Clerk is still loading so the
 * topnav does not flash between states on first paint.
 */
export function AuthControls() {
  /* Use the new `_FORCE_REDIRECT_URL` env names. The legacy
     `_AFTER_SIGN_{IN,UP}_URL` envs are auto-recognized by Clerk as
     deprecated props and trigger a console warning on every load,
     even when they're only read here and forwarded through the
     non-deprecated `forceRedirectUrl` prop. Switching the env names
     keeps the legacy auto-pickup out of the picture entirely. */
  const afterSignIn =
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL ?? '/discover';
  const afterSignUp =
    process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL ?? '/discover';

  return (
    <span className="topnav-auth-controls hidden sm:inline-flex items-center">
      <SignedOut>
        <SignInButton
          mode="modal"
          forceRedirectUrl={afterSignIn}
          signUpForceRedirectUrl={afterSignUp}
        >
          <button
            type="button"
            aria-label="Sign in"
            className="topnav-avatar"
            style={triggerStyle}
          />
        </SignInButton>
      </SignedOut>
      <SignedIn>
        {/* Our own popover, not Clerk's `<UserButton>`: the stock card is
            light-themed (it broke all thirty themes) and its avatar is the
            OAuth photo rather than the picture set in Settings. */}
        <AccountMenu />
      </SignedIn>
    </span>
  );
}

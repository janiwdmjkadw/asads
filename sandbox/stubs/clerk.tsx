'use client';

/**
 * Stand-in for `@clerk/nextjs`. Auth is backend owned, so the export
 * deliberately excludes it. Aliased in next.config.mjs, which means nothing
 * under `source/` imports this directly and no import in the export was
 * edited to make it run.
 *
 * It reports a signed-in user, because the authenticated terminal is the
 * state worth designing against. `getToken` returns a placeholder string;
 * every request carrying it is answered by the mock API routes under
 * `app/api/`, so it is never checked and never leaves this machine.
 *
 * To design the signed-out chrome instead, add `?signedout` to any URL in
 * this tab; `?signedin` puts it back. It is a per-tab override rather than
 * a constant here on purpose: the invite pages are the only surfaces whose
 * signed-out state is the one worth designing, and flipping a module
 * constant to reach them signs you out of the terminal at the same time.
 *
 * The `<SignedIn>` / `<SignedOut>` pair and the nav's auth controls all
 * follow it. On a `?signedout` URL the server still renders the signed-in
 * branch and the client corrects it on mount, which React logs and
 * recovers from — a dev-only cost, paid only on that URL, in a file that
 * never ships.
 */

import './clerk-card.css';
import { useCallback, useMemo, type ReactNode } from 'react';

const SIGNED_IN_DEFAULT = true;

/**
 * STICKY, per tab. `?signedout` used to be read straight off the current
 * URL, which made the signed-out invite page nearly impossible to sit on:
 * `/fren/{slug}` redirects to `/signup/fren/{slug}` on mount and a client
 * side `router.replace` does not carry the query string, so the override
 * evaporated on the very first navigation and the tab silently signed
 * itself back in.
 *
 * It is remembered for the tab instead. `?signedin` clears it, and it
 * dies with the tab either way — `sessionStorage`, not `localStorage`, so
 * a window opened tomorrow is not still pretending.
 */
const OVERRIDE_KEY = 'sandbox-signed-out';

function signedIn(): boolean {
  if (typeof window === 'undefined') return SIGNED_IN_DEFAULT;

  let stored: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('signedin')) window.sessionStorage.removeItem(OVERRIDE_KEY);
    else if (params.has('signedout')) window.sessionStorage.setItem(OVERRIDE_KEY, '1');
    stored = window.sessionStorage.getItem(OVERRIDE_KEY);
  } catch {
    /* Private windows and blocked site data throw on access rather than
       returning null. The sandbox default is the right answer there. */
    return SIGNED_IN_DEFAULT;
  }

  return stored === '1' ? false : SIGNED_IN_DEFAULT;
}

const SANDBOX_USER_ID = 'user_sandbox_designer';

export function useAuth() {
  return useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: signedIn(),
      userId: signedIn() ? SANDBOX_USER_ID : null,
      sessionId: signedIn() ? 'sess_sandbox' : null,
      orgId: null,
      getToken: async (_options?: { skipCache?: boolean; template?: string }) => 'sandbox-token',
      signOut: async () => {},
    }),
    [],
  );
}

export function useUser() {
  return useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: signedIn(),
      user: signedIn()
        ? {
            id: SANDBOX_USER_ID,
            username: 'designer',
            firstName: 'Design',
            lastName: 'Sandbox',
            fullName: 'Design Sandbox',
            primaryEmailAddress: { emailAddress: 'designer@sandbox.local' },
            emailAddresses: [{ emailAddress: 'designer@sandbox.local' }],
            imageUrl: '',
            publicMetadata: {},
            externalAccounts: [],
          }
        : null,
    }),
    [],
  );
}

export function useClerk() {
  return useMemo(
    () => ({
      loaded: true,
      user: signedIn() ? { id: SANDBOX_USER_ID } : null,
      session: signedIn() ? { id: 'sess_sandbox' } : null,
      openSignIn: () => {},
      openSignUp: () => {},
      openUserProfile: () => {},
      signOut: async () => {},
      redirectToSignIn: () => {},
    }),
    [],
  );
}

/**
 * Clerk's step-up prompt wrapper. In production it re-runs the action after
 * the user re-verifies; here there is no second factor to satisfy, so it
 * simply calls through. A call site that returns a "needs reverification"
 * hint therefore surfaces that hint as its own result rather than opening a
 * prompt — which is the honest sandbox outcome, since the flow it protects
 * (revealing a recovery key, withdrawing funds) has no backend behind it.
 */
export function useReverification<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return useCallback((...args: Args) => action(...args), [action]);
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedIn({ children }: { children: ReactNode }) {
  return signedIn() ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return signedIn() ? null : <>{children}</>;
}

interface AuthButtonProps {
  children?: ReactNode;
  mode?: 'modal' | 'redirect';
  forceRedirectUrl?: string;
  fallbackRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
  [key: string]: unknown;
}

/**
 * The hosted sign-in / sign-up triggers. Clerk renders whatever child you
 * give it and attaches the click handler, so the pill, the nav button and
 * their hover states are all the export's own styling — the click is simply
 * inert here.
 */
function AuthButton({ children }: AuthButtonProps) {
  return <>{children}</>;
}

export const SignInButton = AuthButton;
export const SignUpButton = AuthButton;

/**
 * The hosted sign-in / sign-up cards.
 *
 * THE LIVE CARD'S FIELDS, ON A LIGHT GROUND.
 *
 * Two passes got this wrong in opposite directions. The first was a grey
 * placeholder rectangle, so every screenshot of the invite page showed a
 * panel with a hole where the only thing anybody interacts with belongs.
 * The second had Clerk's DEFAULT anatomy — an email field and a submit —
 * which is not this install's: the real card also offers Solana, asks for
 * an optional first and last name, and takes a password with a reveal
 * toggle. Those extra fields are most of its height, so a layout designed
 * around the short version was designed around a card about half the size
 * of the real one.
 *
 * So the CONTROLS are copied from the live card and the COLOURS are not.
 * Clerk renders dark on the live site, but here it mounts inside the
 * product's white panel, and a dark card in the middle of a white one is
 * the black-box problem this stub already had once. Clerk takes an
 * `appearance` config, so theming it light in production is a config
 * change rather than a redesign — which makes light the honest thing to
 * design against.
 *
 * What has to be right in a sandbox is the anatomy, the order and the
 * height. Those are right; the pixels are Clerk's to decide.
 *
 * Inert. Nothing submits and there are no click handlers at all rather
 * than stubbed ones, so a mis-click here cannot look like it did
 * something.
 */

const CARD_INK = '#0b0b0b';
const CARD_MUTED = '#767676';
const CARD_FAINT = '#9a9a9a';
const CARD_LINE = 'rgba(11,11,11,0.13)';
const SANS = 'var(--font-geist-sans), system-ui, sans-serif';

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.05-1.2-.16-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
    </svg>
  );
}

function SolanaMark() {
  return (
    <svg width="15" height="12" viewBox="0 0 18 14" aria-hidden>
      <defs>
        <linearGradient id="clerk-sol" x1="0" y1="14" x2="18" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g fill="url(#clerk-sol)">
        <path d="M3.2 10.4a.6.6 0 0 1 .43-.18h13.1c.27 0 .4.32.21.51l-2.6 2.6a.6.6 0 0 1-.42.18H.83a.29.29 0 0 1-.2-.5l2.57-2.6Z" />
        <path d="M3.2.66A.62.62 0 0 1 3.63.48h13.1c.27 0 .4.32.21.51l-2.6 2.6a.6.6 0 0 1-.42.18H.83a.29.29 0 0 1-.2-.5L3.2.66Z" />
        <path d="M14.34 5.5a.6.6 0 0 0-.42-.18H.83a.29.29 0 0 0-.2.5l2.57 2.6a.6.6 0 0 0 .43.18h13.1c.27 0 .4-.32.21-.51l-2.6-2.6Z" />
      </g>
    </svg>
  );
}

function EyeMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M1.5 9s2.7-4.5 7.5-4.5S16.5 9 16.5 9 13.8 13.5 9 13.5 1.5 9 1.5 9Z" stroke={CARD_FAINT} strokeWidth="1.2" />
      <circle cx="9" cy="9" r="2.1" stroke={CARD_FAINT} strokeWidth="1.2" />
    </svg>
  );
}

function SocialButton({ mark, label }: { mark: React.ReactNode; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        border: `1px solid ${CARD_LINE}`,
        borderRadius: 8,
        background: '#ffffff',
        fontFamily: SANS,
        fontSize: 13,
        fontWeight: 500,
        color: CARD_INK,
      }}
    >
      {mark}
      {label}
    </div>
  );
}

function Field({ label, placeholder, optional, eye }: {
  label: string;
  placeholder: string;
  optional?: boolean;
  eye?: boolean;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: CARD_INK }}>{label}</span>
        {optional ? <span style={{ fontSize: 12, color: CARD_FAINT }}>Optional</span> : null}
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          height: 36,
          marginTop: 6,
          padding: '0 10px',
          border: `1px solid ${CARD_LINE}`,
          borderRadius: 8,
          background: '#ffffff',
          fontSize: 13,
          color: CARD_FAINT,
        }}
      >
        {placeholder}
        {eye ? (
          <span style={{ position: 'absolute', right: 10, display: 'flex' }}>
            <EyeMark />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AuthCard({ heading, sub, names, footer, footerAction }: {
  heading: string;
  sub: string;
  names: boolean;
  footer: string;
  footerAction: string;
}) {
  return (
    <div
      className="ck-card"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        border: `1px solid ${CARD_LINE}`,
        borderRadius: 14,
        background: '#fafafa',
        fontFamily: SANS,
        overflow: 'hidden',
      }}
    >
      <div className="ck-body" style={{ padding: '24px 24px 22px' }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            textAlign: 'center',
            color: CARD_INK,
            letterSpacing: '-0.01em',
          }}
        >
          {heading}
        </div>
        <p style={{ margin: '7px 0 0', fontSize: 13, textAlign: 'center', color: CARD_MUTED }}>
          {sub}
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <SocialButton mark={<GoogleMark />} label="Google" />
          <SocialButton mark={<SolanaMark />} label="Solana" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 0' }}>
          <span style={{ flex: 1, height: 1, background: CARD_LINE }} />
          <span style={{ fontSize: 12, color: CARD_MUTED }}>or</span>
          <span style={{ flex: 1, height: 1, background: CARD_LINE }} />
        </div>

        {/* Both names on one row, as the live card sets them. */}
        {names ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Field label="First name" placeholder="First name" optional />
            <Field label="Last name" placeholder="Last name" optional />
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <Field label="Email address" placeholder="Enter your email address" />
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Password" placeholder="Enter your password" eye />
        </div>

        {/* The gradient submit, with its play mark. The one place the live
            card's colour is kept: it is the product's accent rather than
            Clerk's chrome, and it is what the eye goes to on the panel. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 38,
            marginTop: 20,
            borderRadius: 8,
            background: 'linear-gradient(90deg, #b6e9f2 0%, #7ff0d8 55%, #4fe3c1 100%)',
            fontSize: 13.5,
            fontWeight: 600,
            color: '#0b1214',
          }}
        >
          Continue
          <span style={{ fontSize: 10 }}>▶</span>
        </div>
      </div>

      {/* Its own band, as the live card renders it — not a line of text
          floating under the button. */}
      <div
        className="ck-band"
        style={{
          padding: '14px 24px',
          borderTop: `1px solid ${CARD_LINE}`,
          background: '#f2f2f2',
          fontSize: 13,
          textAlign: 'center',
          color: CARD_MUTED,
        }}
      >
        {footer} <span style={{ color: CARD_INK, fontWeight: 600 }}>{footerAction}</span>
      </div>

      <div
        className="ck-band ck-band-sub"
        style={{
          padding: '0 24px 15px',
          background: '#f2f2f2',
          fontSize: 11.5,
          textAlign: 'center',
          color: CARD_FAINT,
        }}
      >
        Secured by <span style={{ color: CARD_MUTED, fontWeight: 600 }}>Clerk</span>
      </div>
    </div>
  );
}

export function SignIn() {
  return (
    <AuthCard
      heading="Sign in to Listen"
      sub="Welcome back. Please sign in to continue."
      names={false}
      footer="No account?"
      footerAction="Sign up"
    />
  );
}

export function SignUp() {
  return (
    <AuthCard
      heading="Create your account"
      sub="Welcome! Please fill in the details to get started."
      names
      footer="Already have an account?"
      footerAction="Sign in"
    />
  );
}

export function UserButton() {
  return null;
}

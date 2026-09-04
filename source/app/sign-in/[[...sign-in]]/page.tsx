import { SignIn } from '@clerk/nextjs';

/**
 * Hosted fallback for direct navigation to /sign-in. The primary
 * auth UX is the Clerk modal opened from the topnav avatar; this
 * page handles email magic-link callbacks and any direct entry.
 *
 * Renders outside the (terminal) route group so the trading shell
 * (top nav, theme provider, query client) does not load on the
 * auth page.
 */
export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <SignIn />
    </main>
  );
}

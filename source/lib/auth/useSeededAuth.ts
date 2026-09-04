'use client';

import { useAuth } from '@clerk/nextjs';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';

/**
 * Clerk auth state merged with the server-seeded session mirror.
 *
 * On a cold load the mirror is seeded from the (terminal) layout's inline
 * JWT (see lib/auth/session-seed.ts) frames before clerk.browser.js boots,
 * so consumers gating UI on "signed in" unblock immediately instead of
 * waiting ~1-3s for Clerk JS. Once Clerk has loaded, its answer wins
 * unconditionally (the mirror is best-effort, Clerk is the source of truth).
 */
export function useSeededAuth(): { isLoaded: boolean; isSignedIn: boolean | null | undefined } {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useAuth();
  const mirrorLoaded = useClerkSessionStore((s) => s.isLoaded);
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  return {
    isLoaded: clerkLoaded || mirrorLoaded,
    isSignedIn: clerkLoaded ? clerkSignedIn : (mirrorSignedIn ?? clerkSignedIn),
  };
}

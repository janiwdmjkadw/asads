'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renders its children only after hydration.
 *
 * The terminal is a client tree whose data comes from React Query, and in
 * this sandbox that cache is seeded entirely in the browser: from the local
 * mock API, from the SSE fixtures, and from the read cache the export
 * persists to localStorage. The server therefore cannot render the same
 * first frame the client does — a token avatar, a price, a wallet balance —
 * and React reports every one of those as a hydration mismatch. The dev
 * overlay then covers the page you are trying to look at.
 *
 * Production does not have that problem because a server layer seeds the
 * same data on both sides. Rather than paper over each site, the sandbox
 * skips the server frame for the terminal: nothing is lost, since every
 * component under here is `'use client'` anyway.
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : null;
}

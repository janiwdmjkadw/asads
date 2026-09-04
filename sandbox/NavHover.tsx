'use client';

import { useEffect } from 'react';

/**
 * `?navhover=<name>` — flip between the top nav's hover treatments.
 *
 * Sandbox only, and deliberately not `useSearchParams`: this mounts in
 * the terminal layout, and that hook in a client component with no
 * Suspense boundary makes Next deopt the whole route to client side
 * rendering and log an error for it — on every terminal route, every
 * load. Reading the URL by hand inside an effect costs none of that,
 * because effects only ever run on the client.
 *
 * Names: lift, edge, invert, sink, raise, ink.
 */

const HOVERS = ['lift', 'edge', 'invert', 'sink', 'raise', 'ink'] as const;

export function NavHover(): null {
  useEffect(() => {
    const root = document.querySelector('.listen-root');
    if (!(root instanceof HTMLElement)) return undefined;

    const asked = new URLSearchParams(window.location.search).get('navhover');
    const name = HOVERS.find((entry) => entry === asked);
    if (!name) return undefined;

    root.dataset.navhover = name;
    return () => {
      delete root.dataset.navhover;
    };
  }, []);

  return null;
}

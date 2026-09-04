'use client';

/**
 * `prefers-reduced-motion`, read SYNCHRONOUSLY on the first render.
 *
 * The chat tree never server-renders — both entry points load it through
 * `dynamic(…, { ssr: false })` (`AgentChatDock.tsx:15`, `AgentPageGate.tsx:13`)
 * — so there is no hydration pass to mismatch, and the usual
 * "start false, settle in an effect" shape would cost a visible frame of
 * the wrong surface: under reduced motion the Soren skin falls back to the
 * classic activity group, and that group must not flash in and out.
 *
 * One `MediaQueryList` is shared by every caller; `useSyncExternalStore`
 * subscribes each of them to it.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

let cached: MediaQueryList | null = null;

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  cached ??= window.matchMedia(QUERY);
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const mql = query();
  if (mql === null) return () => undefined;
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return query()?.matches === true;
}

/** No DOM to ask: motion is allowed until the client says otherwise. */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

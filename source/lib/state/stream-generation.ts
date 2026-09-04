'use client';

import { create } from 'zustand';

/**
 * Stream-generation counter for bfcache restores.
 *
 * When a page is restored from the back/forward cache (`pageshow` with
 * `event.persisted === true`), every `EventSource` the page held was
 * frozen and is typically CLOSED on restore — but no React effect
 * re-runs, so SSE-backed UI silently stops updating until a remount.
 *
 * This module exposes a monotonically increasing `generation` counter
 * that bumps exactly once per bfcache restore. Stream hooks include the
 * generation in their connect-effect dependency arrays (or subscribe
 * imperatively via {@link subscribeStreamGeneration} for module-level
 * stream clients) so a restore tears down and re-opens every stream.
 */

interface StreamGenerationState {
  generation: number;
  bump: () => void;
}

export const useStreamGenerationStore = create<StreamGenerationState>((set) => ({
  generation: 0,
  bump: () => set((state) => ({ generation: state.generation + 1 })),
}));

/** React subscription: re-renders (and re-runs dependent effects) on bump. */
export function useStreamGeneration(): number {
  return useStreamGenerationStore((s) => s.generation);
}

/** Imperative read for non-React callers. */
export function getStreamGeneration(): number {
  return useStreamGenerationStore.getState().generation;
}

/**
 * Imperative subscription for module-level stream clients (e.g. the
 * ref-counted wallet-balance / positions SSE singletons that live
 * outside any React effect). The listener fires once per bump.
 * Returns an unsubscribe function.
 */
export function subscribeStreamGeneration(listener: () => void): () => void {
  let prev = getStreamGeneration();
  return useStreamGenerationStore.subscribe((state) => {
    if (state.generation === prev) return;
    prev = state.generation;
    listener();
  });
}

// One-time module-level `pageshow` registration. SSR-safe: a server
// render never touches `window`; the first client import registers.
let pageshowRegistered = false;
function registerPageshowBump(): void {
  if (pageshowRegistered || typeof window === 'undefined') return;
  pageshowRegistered = true;
  window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) useStreamGenerationStore.getState().bump();
  });
}
registerPageshowBump();

/** Test-only: reset the counter between cases. */
export function _resetStreamGenerationForTests(): void {
  useStreamGenerationStore.setState({ generation: 0 });
}

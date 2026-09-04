'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Slice "Portfolio Spot tab": animate a number toward a target.
 *
 * The hero portfolio total shouldn't *snap* when a refetch lands — a
 * value that glides home reads as money breathing, not a layout jolt.
 * This hook eases the displayed value toward `target` on a
 * requestAnimationFrame loop with an ease-out curve.
 *
 * Design constraints baked in:
 *   - Honors `prefers-reduced-motion` — snaps instantly, no rAF loop.
 *   - Snaps for sub-threshold deltas so a $0.01 refetch jitter never
 *     kicks off a pointless 600ms tween.
 *   - Re-targets mid-flight from the *currently visible* value (tracked
 *     in a ref) so a fresh update never yanks the number backwards.
 *   - Always lands exactly on the target — no floating-point drift
 *     leaving the readout a cent shy of the truth.
 *   - Cancels cleanly on unmount / retarget (no orphaned frames).
 */
export function useAnimatedNumber(
  target: number,
  opts?: {
    /** Tween duration in ms. Default 620. */
    readonly durationMs?: number;
    /** Below this absolute delta we snap instead of animating. */
    readonly snapThreshold?: number;
  },
): number {
  const durationMs = opts?.durationMs ?? 620;
  const snapThreshold = opts?.snapThreshold ?? 0.005;

  const safeTarget = Number.isFinite(target) ? target : 0;
  const [display, setDisplay] = useState<number>(safeTarget);
  // Mirrors the latest on-screen value across renders so a retarget
  // always springs from what the eye currently sees.
  const displayRef = useRef<number>(safeTarget);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const from = displayRef.current;
    const delta = safeTarget - from;

    if (reduce || Math.abs(delta) <= snapThreshold) {
      displayRef.current = safeTarget;
      setDisplay(safeTarget);
      return undefined;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutExpo — fast departure, long graceful settle.
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      if (t >= 1) {
        displayRef.current = safeTarget;
        setDisplay(safeTarget);
        rafRef.current = null;
        return;
      }
      const next = from + delta * eased;
      displayRef.current = next;
      setDisplay(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [safeTarget, durationMs, snapThreshold]);

  return display;
}

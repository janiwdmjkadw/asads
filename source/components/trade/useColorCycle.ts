import { useEffect, useState } from 'react';

export interface ColorStop {
  /** Solid hex color the value transitions to. */
  color: string;
  /** Companion glow used as `text-shadow`. */
  glow: string;
}

/**
 * Cycles through a list of color stops at a fixed cadence. Used by
 * TokenHeaderBar to gently animate the market-cap value through a
 * cyan/orange/green rotation — communicates liveness without resorting
 * to the more aggressive flash-on-update pattern.
 *
 * The transition between stops is handled by the consumer (apply
 * `transition: color/text-shadow` on the target element). This hook only
 * returns the current stop.
 */
export function useColorCycle(
  stops: readonly ColorStop[],
  intervalMs = 4000,
): ColorStop {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (stops.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % stops.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [stops.length, intervalMs]);

  return stops[idx % stops.length] ?? stops[0]!;
}

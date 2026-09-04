import { useEffect, useRef } from 'react';
import { horizontalWheelDelta, horizontalWheelUsesVertical } from './laneWheelIntent';

/**
 * Converts vertical wheel scroll into horizontal scroll on the target element.
 * Uses a non-passive listener so `preventDefault()` is honored (React's
 * synthetic `onWheel` is passive by default).
 */
export function useHorizontalWheel<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const handler = (e: WheelEvent) => {
      const delta = horizontalWheelDelta(e);
      if (horizontalWheelUsesVertical(e)) {
        el.scrollLeft += delta;
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [enabled]);

  return ref;
}

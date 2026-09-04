'use client';

import { useEffect, useState } from 'react';

/**
 * Live frames-per-second of the page, sampled once per second via
 * `requestAnimationFrame`. Cheap: one rAF callback that only re-renders the
 * consumer at ~1Hz (when the rounded value changes), not every frame.
 */
export function useFps(): number {
  const [fps, setFps] = useState(60);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();

    const loop = (now: number) => {
      frames += 1;
      const elapsed = now - last;
      if (elapsed >= 1000) {
        setFps((prev) => {
          const next = Math.round((frames * 1000) / elapsed);
          return next === prev ? prev : next;
        });
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return fps;
}

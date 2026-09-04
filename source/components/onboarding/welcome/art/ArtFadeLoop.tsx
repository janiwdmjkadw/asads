'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import './art-motion.css';

/**
 * Brings the onboarding artwork in, stroke by stroke, on a loop.
 *
 * The drawings in this folder are hand-authored stroke SVGs — thirty-odd
 * separate paths each. Fading one as a single block reads as a picture
 * being switched on; fading each stroke on its own delay reads as the
 * drawing arriving. This writes those delays and nothing else: one pass at
 * mount, then CSS owns every frame (see art-motion.css). A loop driven
 * from JS would cost main thread forever, on a step where the main thread
 * is also running a Turnkey iframe.
 *
 * The delay is by AUTHORING order rather than by length or position, so
 * the key arrives the way it was drawn — bow, shaft, bit — instead of
 * shortest-first, which reads as random.
 *
 * `data-stroke` is what the stylesheet selects on, and it is only set on
 * elements that actually measured. A degenerate shape (this artwork has
 * one empty path) stays inert rather than pulsing on its own out of step
 * with everything around it.
 *
 * Plain React: `useRef`, `useEffect`, DOM. No Next API, so it drops into
 * any React app with the stylesheet beside it.
 */
const SELECTOR = 'path, polyline, polygon, line, circle, ellipse';

/** Cap the ramp so a dense drawing still comes round in reasonable time. */
const STAGGER_MS = 26;
const MAX_DELAY_MS = 900;

export function ArtFadeLoop({ children, className }: { children: ReactNode; className?: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.querySelectorAll<SVGGeometryElement>(SELECTOR).forEach((stroke, index) => {
      let length = 0;
      try {
        length = stroke.getTotalLength();
      } catch {
        length = 0;
      }
      if (!length) return;

      stroke.dataset.stroke = '';
      stroke.style.setProperty('--d', `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms`);
    });
  }, []);

  return (
    <span ref={hostRef} className={className ? `art-fade ${className}` : 'art-fade'}>
      {children}
    </span>
  );
}

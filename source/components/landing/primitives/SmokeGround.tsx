'use client';

import { GemSmoke } from '@paper-design/shaders-react';
import { cn } from '@/lib/utils';
import { smokePresets, type SmokePresetName } from '../shaders';
import { useNearViewport } from './useNearViewport';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface SmokeGroundProps {
  preset: SmokePresetName;
  className?: string;
}

/* Same reduced-motion policy as `MeshGround`: freeze the shader on one
   deterministic frame rather than dropping it for the flat ground colour. */
const STILL = { speed: 0, frame: 12000 } as const;

/**
 * Live gem-smoke ground (the footer's logo mark). Fills its parent, so
 * it belongs in a `Section`'s `bleed` slot. Under reduced motion it
 * renders a frozen frame of the same smoke.
 *
 * Like `MeshGround`, the canvas mounts LAZILY: the footer's flat ground
 * paints at once and the smoke starts when the band is within a viewport
 * of the fold.
 */
export function SmokeGround({ preset, className }: SmokeGroundProps) {
  const { params, back } = smokePresets[preset];
  const reducedMotion = usePrefersReducedMotion();
  const [ref, near] = useNearViewport<HTMLDivElement>();

  return (
    <div ref={ref} aria-hidden className={cn('h-full w-full', className)} style={{ backgroundColor: back }}>
      {near ? (
        <GemSmoke {...params} {...(reducedMotion ? STILL : null)} style={{ width: '100%', height: '100%' }} />
      ) : null}
    </div>
  );
}

'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { cn } from '@/lib/utils';
import { meshPresets, type MeshPresetName } from '../shaders';
import { useNearViewport } from './useNearViewport';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface MeshGroundProps {
  preset: MeshPresetName;
  className?: string;
}

/* Reduced-motion policy for SHADER grounds: freeze, don't drop. `speed: 0`
   stops the render loop entirely (no recurring cost) and paints one still
   frame of the same field, so the band keeps its design instead of
   collapsing to a flat colour — a white `back` under the mint band read as
   a background that failed to load. `frame` is milliseconds into the
   animation; pinning a constant makes the still deterministic rather than
   whatever t=0 happens to be. Videos have their own policy, in `Video.tsx`. */
const STILL = { speed: 0, frame: 12000 } as const;

/**
 * Live mesh-gradient ground. Fills its parent, so it belongs in a
 * `Section`'s `bleed` slot. Under reduced motion it renders a frozen
 * frame of the same gradient.
 *
 * The canvas mounts LAZILY — the flat `back` colour paints immediately and
 * the shader only starts once the band is within a viewport of the fold, so
 * a ground three screens down costs nothing until the reader is nearly there.
 * `back` also stands in wherever WebGL is unavailable.
 */
export function MeshGround({ preset, className }: MeshGroundProps) {
  const { params, back } = meshPresets[preset];
  const reducedMotion = usePrefersReducedMotion();
  const [ref, near] = useNearViewport<HTMLDivElement>();

  return (
    <div ref={ref} aria-hidden className={cn('h-full w-full', className)} style={{ backgroundColor: back }}>
      {near ? (
        <MeshGradient {...params} {...(reducedMotion ? STILL : null)} style={{ width: '100%', height: '100%' }} />
      ) : null}
    </div>
  );
}

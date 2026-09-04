'use client';

import { GrainGradient, grainGradientPresets } from '@paper-design/shaders-react';
import { usePrefersReducedMotion } from '../../primitives';

/**
 * A ground for the LIGHT band.
 *
 * Flat white between two black bands reads as a hole in the page rather
 * than as a surface — there is nothing in it for light to fall across. So
 * the band gets the same treatment the dark ones do, inverted: a slow
 * grain field in near-whites, plus a radial in the layout that lifts the
 * centre and lets the edges settle.
 *
 * The values are held between #ffffff and #e8e8e8 — about 9% of range. Any
 * more and it stops being a white band and starts being a grey one, which
 * is the beige mistake in a different colour.
 *
 * Speed is a tenth of the hero's, like every other secondary ground here:
 * the hero carries the page's one loud animation and a second would
 * compete. Reduced motion freezes it on a still frame.
 */
function pick<P>(presets: readonly { name: string; params: P }[], name: string): P {
  return (presets.find((preset) => preset.name === name) ?? presets[0]!).params;
}

const FILL = { width: '100%', height: '100%' } as const;

export function LightGround({ className }: { className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className={className}>
      <GrainGradient
        {...pick(grainGradientPresets, 'Blob')}
        speed={0.1}
        colors={['#ffffff', '#f4f4f4', '#ececec', '#e8e8e8']}
        colorBack="#ffffff"
        {...(reducedMotion ? { speed: 0 } : null)}
        style={FILL}
      />
    </div>
  );
}

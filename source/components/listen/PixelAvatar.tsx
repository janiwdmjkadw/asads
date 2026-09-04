'use client';

import { useEffect, useRef } from 'react';
import { drawPixelAvatar, pixelAvatarSpec } from './pixel-avatar';

/**
 * The seeded invader, painted into an 8x8 canvas and blown up by CSS with
 * `pixelated` so every cell stays a hard square at any size.
 *
 * Decorative: `aria-hidden`, because the control wrapping it already carries
 * the label.
 */
export function PixelAvatar({
  seed,
  size,
  className,
}: {
  seed: string;
  size: number;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    drawPixelAvatar(ctx, pixelAvatarSpec(seed));
  }, [seed]);

  return (
    <canvas
      ref={ref}
      width={8}
      height={8}
      aria-hidden
      className={className}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
}

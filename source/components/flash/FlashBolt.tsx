'use client';

/**
 * THE BOLT, DRAWN RATHER THAN PLACED.
 *
 * It shipped as `<img src="/assets/flash-bolt.svg">`, which means the
 * only things that can move are the whole box's opacity and transform:
 * a picture of a bolt, sitting there. Inlined, every one of its facets
 * is a stroke this component can address, and the drawing becomes the
 * animation.
 *
 * The paths are the asset's own, at 0.4 stroke on a 150 box. `ink` is
 * the one thing the caller sets, because this sits on white in the Flash
 * dialog and would sit on black anywhere else.
 */

import type { CSSProperties, ReactElement } from 'react';

/** The asset's geometry, verbatim. */
const SHAPES: ReadonlyArray<readonly [kind: 'polygon' | 'polyline' | 'path', d: string]> = [
  ['polygon', '62.5 13.9 104.1 6.8 111.4 16.5 87.5 51.2 104.3 48.1 104.4 48.1 104.3 48.1 104.3 48.1 104.3 48.1 104.3 48.1 104.3 54.5 93.3 72.1 86.5 88.1 37.8 143.1 65.8 80.2 50.6 83.6 52.2 78.4 37.9 80.7'],
  ['polyline', '38.1 80.5 69.8 26.2 77.3 20.8 93.5 18.4'],
  ['path', 'm62.6 14 7.2 12.2'],
  ['polyline', '77.3 20.8 62.6 13.9 93.5 18.4'],
  ['polyline', '38 80.7 73.7 56.9 90.5 30.2 91.9 28.6 86.4 51.4'],
  ['polyline', '59.3 57 69.7 26.3 77.3 20.8 104.1 6.9 92 28.6 79.3 52.7 73.7 56.9 104.3 48.2'],
  ['polyline', '98 17.8 111.3 16.4 94.3 41.7 87.5 51.3'],
  ['polygon', '38.2 80.6 104.3 48.2 84.9 64.8 38.2 80.6 84.9 51.5 104.3 48.2 104.3 48.2'],
  ['polyline', '84.9 65.1 38.2 142 85.2 64.6 104.3 48.6 93.3 71.1 112.3 55.4 97.1 75.6 86.5 88.1'],
  ['polygon', '53.4 78.1 57.2 75.1 73.9 69.4 84.9 65.1 73.9 73.1 58 74.9 63.2 75.4 53.7 78.1 57.8 78.2 50.8 83.5'],
  ['polyline', '66.7 89.2 66.8 78.1 73.9 73.1 66.7 89.2 84.9 65.1'],
  ['polyline', '53.4 78.1 66.8 78.1 65.9 80.2'],
  ['polyline', '104.5 56.1 112.3 55.3 104.5 53.8 112.3 55.3'],
];

export function FlashBolt({
  size = 110,
  ink = '#060607',
  weight = 0.4,
  className,
  style,
}: {
  readonly size?: number;
  readonly ink?: string;
  /*
   * Stroke width in VIEWBOX units, and the reason it is a prop: the
   * asset's own 0.4 on a 150 box renders as a third of a pixel, which
   * is a whisper at the size the dialog draws it. Fine as a watermark,
   * far too faint as the one piece of art on the panel.
   */
  readonly weight?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 150 150"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={`fb${className === undefined ? '' : ` ${className}`}`}
      style={style}
    >
      <style>{SHEET}</style>
      <g
        stroke={ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ ['--fb-w' as string]: String(weight), strokeWidth: weight }}
      >
        {SHAPES.map(([kind, d], i) => {
          if (kind === 'path') return <path key={i} d={d} className="fb-l" />;
          if (kind === 'polygon') return <polygon key={i} points={d} className="fb-l" />;
          return <polyline key={i} points={d} className="fb-l" />;
        })}
      </g>
    </svg>
  );
}

const SHEET = `
/*
 * NO ANIMATION. It drew itself in and struck on a loop; the owner did
 * not want it moving. Inlining still earns its place: the stroke weight
 * is now a prop, which an <img> could never expose.
 */
.fb .fb-l{ stroke-dasharray: none; stroke-dashoffset: 0; }
`;

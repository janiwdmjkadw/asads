import type { LineArtProps } from './types';

/**
 * RewardsArt — Paper B5 `6OQ-1` "Isometric wireframe rectangles", 256×256 at
 * band-relative (737, 93), stroke #201609 at 0.687.
 *
 * Geometry is verbatim from Paper, whose source viewBox is 150×150;
 * the wrapping scale (1.7066667 = 256/150) maps it into the 256 box its
 * siblings use, which keeps the designed stroke weight. Paper sets round joins
 * on every shape and round caps on the open paths only — mirrored here.
 */
export function RewardsArt({ className, title }: LineArtProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={0.687}
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g transform="scale(1.7066667)">
        <polygon points="22.3 29.1 62.2 6.8 88 21.9 88 27.5 48.7 49.2 22.3 34.5" />
        <path d="m22.4 29.1 26.3 14.7" strokeLinecap="round" />
        <path d="m48.7 43.8v5.4" strokeLinecap="round" />
        <path d="m48.7 43.7 39.2-21.6" strokeLinecap="round" />
        <polyline points="105.5 77.7 127.7 64.5 127.7 58.7 86.9 36.2 60.6 51.1 60.6 57.1 63.5 58.9" />
        <path d="m60.6 51.2 39.8 23.5 27.2-16" strokeLinecap="round" />
        <path d="m60.8 51.3 39.6 23.2" strokeLinecap="round" />
        <path d="m100.4 74.7v5.2m-36.8-20.9-26.4 14.8v5.4l37.8 21.6" strokeLinecap="round" />
        <path d="m37.4 73.8 37.7 21.4 30.8-17.2" strokeLinecap="round" />
        <path d="m106.1 77.7 0.7 0.2-0.8 2.2" />
        <polygon points="75.1 95.2 105.9 77.9 105.9 77.9 106 77.8 105.9 77.9 106 77.8 105.9 77.9 106 77.7 106 77.8 105.9 77.9 106 77.8 105.9 77.9 105.9 77.9 106 77.8 106.2 77.7 106 77.8 106.1 77.7 106 77.8 106 77.7 105.9 77.9 106 77.8 106 77.9 106.1 77.8 106 77.8 106 83.5 75.1 100.8" />
        <polyline points="106 82.3 125.7 93.4 125.7 98.9 84.4 122.7 55.3 105.2 55.3 99.3 63.8 94.4" />
        <path d="m55.5 99.3 28.8 18.1 41.3-23.9" strokeLinecap="round" />
        <path d="m84.3 117.4v5.3" strokeLinecap="round" />
        <polyline points="55.1 102.3 36.2 113.6 36.2 119.2 75.1 142.9 106.8 124.1 106.8 124.1 106.8 124.1 106.8 124.1 106.9 124.1 106.8 124.1 106.9 124.1 106.8 124.1 107 124 106.9 124.1 106.9 124 107 124 106.9 124 106.9 124 107 124 107 124 107.1 123.9 106.9 124" />
        <path d="m36.3 113.7 38.8 23.5 31.7-18.6" strokeLinecap="round" />
        <path d="m75.1 137.2v5.7" strokeLinecap="round" />
        <polyline points="100 114.5 106.8 118.3 106.9 118.4 106.9 118.4" />
        <path d="m63.7 58.9 36.6 21.2v-0.1" strokeLinecap="round" />
      </g>
    </svg>
  );
}

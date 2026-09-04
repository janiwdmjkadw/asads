import type { LineArtProps } from './types';

export function TrackingArt({ className, title }: LineArtProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={0.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(21.52 0.0) scale(1.366062)">
        <polyline points="26 73.7 21.3 71.3 29.1 68.4" />
        <polygon points="64.4 6.3 21.3 27.6 32.4 33.2 72.8 25.5 82.4 15.8" />
        <polyline points="82.4 24.8 82.4 15.8 72.8 25.4 72.4 30.1" />
        <path d="m80.7 26.4 9.3-8.1 16.7 7 1.7 0.7" />
        <polyline points="80.7 26.4 95.1 31.9 106.6 25.8 106.7 25.6" />
        <polyline points="90.1 49.6 95.1 31.9 106.6 26.5 106.6 40.8 90.5 50" />
        <polyline points="21.3 27.6 21.3 63.9 48.9 79.2 44.5 60.8 32.4 33.3" />
        <polyline points="82.4 73.5 88.9 69.5 94.7 53.3 106.6 40.8 98.6 46.4 86.6 51 82.4 63.8" />
        <path d="m44.4 60.8 2.5-2.5" />
        <polygon points="40.6 36 64.4 47.9 64.4 87.3 53.1 81.2 40.6 36.1" />
        <polyline points="84.5 50.2 89.8 34.1 77.1 29.2 40.6 36" />
        <polyline points="64.4 47.9 89.8 34.1 82.2 57.1 64.4 87.3" />
        <polyline points="80.4 26.6 79 30.1 80.6 29.2" />
        <line x1="84.5" x2="86.6" y1="50.2" y2="51" />
        <polyline points="76.3 68.2 77.1 68.1 84.5 76.7 64.4 93.8 32.7 75.9 39.4 74" />
        <polyline points="25.2 73.8 55.3 136.6 58.8 132.5" />
        <polyline points="21.3 71.3 21.3 146.3 55.3 136.6" />
        <polyline points="33 75.6 32.5 75.8 60.3 135 64.4 133.8 64.4 93.8" />
        <polyline points="84.5 76.7 78.6 115.3 64.4 133.6" />
        <polyline points="49.1 79.2 52.1 77.6 51.5 74.5" />
        <path d="m77.7 116.4c0.3-0.1 2.5 2.3 2.5 2.3l10.3 5-10.3 47.7-15.8 8.5-39.4-19.5v-10.2l39.4-11.2" />
        <polyline points="96.7 125.9 99.9 126.2 100.8 126.2 60.9 100.8" />
        <polyline points="81.1 167.5 84.6 169.1 90.4 144.4 96.7 126" />
        <polyline points="64.4 139 64.4 179.9 25 149.8 32 143.5" />
        <polygon points="83.1 109.6 89 114.1 114.4 104.1 128.2 69.1 135.2 50.4 119.8 40.7 107.4 45.7 98.1 52.7 95 59.9 89 74.7 83.1 109.5" />
        <polygon points="98.1 52.8 110.4 60.8 110.2 61.9 94.2 103.3 90 114 90.2 113.9 114.4 104.1 131.6 58.9 135.1 50.4 119.6 40.8 107.3 45.7" />
        <polyline points="83.1 109.6 94.2 103.3 131.6 58.9" />
        <polyline points="131.9 59.1 114.3 104.1 101.3 119 93 112.9" />
        <polyline points="80.3 61.1 78.5 69.4 80.1 71.1 82.4 63.9 80.4 61.1" />
        <polyline points="100.7 126.2 100.7 160.4 84.6 169.1" />
        <polyline points="87.6 137.7 89.6 145 94 133.7" />
        <line x1="78.6" x2="96.7" y1="114.5" y2="126" />
        <polyline points="85.6 119.5 90.6 123.6 90.6 124" />
        <polygon points="110.4 60.8 110.4 60.8 110.4 60.8" />
        <polyline points="87.7 120.9 81 118.5 80.2 118.5 64.6 138.8" />
        <line x1="25.3" x2="34.7" y1="73.9" y2="71.4" />
        <polyline points="98.1 52.8 110.4 60.8 135.2 50.4 120 40.7 107.3 45.7 98.1 52.7" />
      </g>
    </svg>
  );
}

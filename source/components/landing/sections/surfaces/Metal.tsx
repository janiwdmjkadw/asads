import type { ReactElement } from 'react';

import './metal.css';

/**
 * The metals the surface drawings are struck in.
 *
 * ── THEY ARE THE ROOST'S, VERBATIM ───────────────────────────────────
 *
 * The rewards ladder is the one place on this site with a material in
 * it, and these are its exact ramps. Five stops each, because two make a
 * coloured shape and it is the narrow bright band in the middle that
 * makes an eye read metal rather than paint.
 *
 * ── WHY GRADIENTS AND NOT A MASK ─────────────────────────────────────
 *
 * The roost paints a CSS gradient on a box and masks it with
 * `logo.svg` — a file, with a URL. These drawings are React components,
 * so there is nothing to point `mask-image` at. Laying the drawing over a
 * gradient with `mix-blend-mode` does not work either: blending cannot
 * punch line art out of a fill, and it produces four solid metal squares.
 *
 * So the gradient goes on the STROKE. `LineArt` sets `stroke` as a
 * presentation attribute on the svg, and a CSS `stroke` on the same
 * element beats a presentation attribute, so each drawing simply points
 * at one of these by id.
 *
 * ── AND WHY THE RAMP IS IN USER SPACE ────────────────────────────────
 *
 * `userSpaceOnUse` across the 256 box, so the ramp is fixed in the
 * drawing's own coordinates rather than travelling with each stroke. A
 * stroke that MOVES therefore travels through the ramp and changes value
 * as it goes, which is what metal does when you turn it — and these
 * drawings all move. Under the default every stroke would carry its own
 * private gradient and the whole thing would read flat.
 */

const METALS: ReadonlyArray<{
  readonly name: string;
  readonly stops: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    name: 'bronze',
    stops: [['0%', '#5e3115'], ['32%', '#a9642f'], ['47%', '#e0a066'], ['66%', '#96552a'], ['100%', '#4d2711']],
  },
  {
    name: 'silver',
    stops: [['0%', '#6c737c'], ['30%', '#c2c9d1'], ['46%', '#f4f7fa'], ['66%', '#a8b0b9'], ['100%', '#5f666e']],
  },
  {
    name: 'gold',
    stops: [['0%', '#7a5408'], ['30%', '#d3a72c'], ['46%', '#f7dd8a'], ['66%', '#c09220'], ['100%', '#6b4806']],
  },
  {
    /* Icy blue rather than a second silver: the last rung has to be
       unmistakable beside a metal that is also pale and also cool. The
       roost's own reasoning, and it holds here for the same reason. */
    name: 'platinum',
    stops: [['0%', '#3d6d96'], ['27%', '#8ec6e8'], ['45%', '#e8f7ff'], ['68%', '#6fa9d2'], ['100%', '#315a80']],
  },
];

/**
 * Mounted once by the band. It draws nothing; it only carries the four
 * gradient definitions the strokes reference.
 */
export function MetalDefs(): ReactElement {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" className="absolute">
      <defs>
        {METALS.map((metal, i) => (
          <linearGradient
            key={metal.name}
            id={`lp-metal-${i}`}
            x1="0"
            y1="0"
            x2="256"
            y2="256"
            gradientUnits="userSpaceOnUse"
          >
            {metal.stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

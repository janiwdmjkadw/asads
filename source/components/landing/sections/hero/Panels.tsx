import type { CSSProperties, ReactElement } from 'react';

import './panels.css';

/**
 * The hero ground: panels hanging in a room.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────
 *
 * Seven large panels at different depths, each tilted a few degrees off
 * square, drifting toward the camera on a forty second pass. Near ones
 * are out of focus, mid ones are sharp. Nothing else is in it.
 *
 * ── THE FOUR THINGS IT DEPENDS ON ────────────────────────────────────
 *
 * SCALE. Every panel is larger than the headline. A mark smaller than the
 * type reads as texture; a form larger than it reads as architecture, and
 * that alone is most of the difference between this and wallpaper.
 *
 * COUNT. Seven. Earlier passes at this band put four hundred small marks
 * on the page and every one of them read as noise.
 *
 * THE COLUMN STAYS EMPTY. The panels sit at the edges and the corners.
 * Nothing crosses the left two thirds at the height the type sits at, so
 * the run is never fighting anything behind it.
 *
 * DEPTH OF FIELD. The near plates are blurred and the far ones are not.
 * It is the one detail that makes the band read as a photographed space
 * rather than as stacked divs.
 *
 * ── THE TOP THIRD IS MASKED TO NOTHING ───────────────────────────────
 *
 * NOT OPTIONAL. The header is glass: it blurs whatever passes underneath
 * it. A panel crossing behind the bar both smears the bar and pulls the
 * eye off the first line of the page. The fade is what allows the rest of
 * the field to be as present as it is.
 *
 * Only transform and opacity animate, so the whole thing runs on the
 * compositor and the main thread stays free for the run above it. It is
 * aria-hidden and inert.
 */

interface Panel {
  /** Percent across and down the band. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot: number;
  /** Out of focus, in pixels. Near plates only. */
  readonly blur: number;
  /** Ink alpha. Nothing here goes past 7 percent. */
  readonly ink: number;
  readonly dur: number;
  /** Negative, so every panel is already mid pass on the first frame. */
  readonly delay: number;
}

const PANELS: readonly Panel[] = [
  /* top right, the big one, sharp, behind the shoulder of the type */
  { x: 74, y: 4, w: 820, h: 580, rot: -4, blur: 0, ink: 0.062, dur: 44, delay: -6 },
  /* right, nearer and out of focus, overlapping the one above */
  { x: 92, y: 40, w: 640, h: 500, rot: 5, blur: 16, ink: 0.05, dur: 52, delay: -28 },
  /* far right edge, deep and small */
  { x: 104, y: 74, w: 460, h: 400, rot: -6, blur: 0, ink: 0.045, dur: 38, delay: -15 },
  /* bottom left, the counterweight, under the type */
  { x: 6, y: 96, w: 760, h: 540, rot: 6, blur: 10, ink: 0.055, dur: 48, delay: -33 },
  /* bottom centre, deep, filling the floor the type leaves empty */
  { x: 46, y: 104, w: 700, h: 460, rot: -3, blur: 0, ink: 0.04, dur: 56, delay: -11 },
  /* nearest thing in the frame, bottom right, softest */
  { x: 78, y: 112, w: 940, h: 480, rot: 3, blur: 24, ink: 0.05, dur: 40, delay: -22 },
  /* far left, deep, so the left edge is not dead */
  { x: -8, y: 34, w: 420, h: 460, rot: -7, blur: 0, ink: 0.035, dur: 60, delay: -44 },
];

export function Panels(): ReactElement {
  return (
    <div aria-hidden className="hero-panels">
      <div className="hero-room">
        {PANELS.map((p, i) => (
          <span
            key={i}
            style={
              {
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.w}px`,
                height: `${p.h}px`,
                background: `rgba(11, 11, 11, ${p.ink})`,
                filter: p.blur ? `blur(${p.blur}px)` : undefined,
                /* The keyframes own the transform, so the tilt has to
                   reach them as a variable or it is thrown away. */
                ['--rot' as string]: `${p.rot}deg`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

'use client';

/*
 * THE HERO GROUND.
 *
 * ── WHAT THE REFERENCE ACTUALLY IS ───────────────────────────────────
 *
 * Not squares, not a grid, not a pattern. It is SIX ENORMOUS PANELS
 * hanging in space at different depths, tilted a few degrees off square,
 * drifting toward the camera. Nothing else is in it.
 *
 * The four things that make it work, all of which every earlier pass here
 * got wrong:
 *
 *   SCALE. The panels are bigger than the headline. Small marks read as
 *   texture; a form larger than the type reads as architecture.
 *
 *   COUNT. Six. Not four hundred. A crowd is noise.
 *
 *   THE MIDDLE IS EMPTY. Every panel sits out at an edge or a corner and
 *   the centre column is untouched, which is why the type stays the
 *   loudest thing on the page.
 *
 *   DEPTH OF FIELD. The near ones are out of focus and the mid ones are
 *   sharp. That single detail is the whole difference between a render
 *   and a stack of divs, and it is what was missing every time.
 *
 * ── WHAT IS DIFFERENT HERE ───────────────────────────────────────────
 *
 * The reference is lit panels on black. This page is white, so the same
 * object has to be read the other way up: the panels are faint ink on
 * paper rather than light in a dark room. Same geometry, same depth, same
 * emptiness in the middle.
 *
 * The top third is masked to nothing, because the bar is glass.
 * Only transform animates.
 */

import type { CSSProperties, ReactElement } from 'react';

interface Panel {
  /** Percent of the container. Nothing sits between 26 and 60: that is the type. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot: number;
  /** How far back it hangs. Drives size, softness and how dark it lands. */
  readonly z: number;
  /** Out of focus, in pixels. The near plates only. */
  readonly blur: number;
  readonly ink: number;
  readonly dur: number;
  readonly delay: number;
}

const PANELS: readonly Panel[] = [
  /* top right, the big one, sharp, sitting behind the shoulder of the type */
  { x: 74, y: 4, w: 820, h: 580, rot: -4, z: -420, blur: 0, ink: 0.062, dur: 44, delay: -6 },
  /* right, nearer and out of focus, overlapping the one above */
  { x: 92, y: 40, w: 640, h: 500, rot: 5, z: -160, blur: 16, ink: 0.05, dur: 52, delay: -28 },
  /* far right edge, deep and small */
  { x: 104, y: 74, w: 460, h: 400, rot: -6, z: -640, blur: 0, ink: 0.045, dur: 38, delay: -15 },
  /* bottom left, the counterweight, under the type */
  { x: 6, y: 96, w: 760, h: 540, rot: 6, z: -300, blur: 10, ink: 0.055, dur: 48, delay: -33 },
  /* bottom centre, deep, filling the floor the type leaves empty */
  { x: 46, y: 104, w: 700, h: 460, rot: -3, z: -700, blur: 0, ink: 0.04, dur: 56, delay: -11 },
  /* nearest thing in the frame, bottom right, softest */
  { x: 78, y: 112, w: 940, h: 480, rot: 3, z: -60, blur: 24, ink: 0.05, dur: 40, delay: -22 },
  /* far left, deep, so the left edge is not dead */
  { x: -8, y: 34, w: 420, h: 460, rot: -7, z: -760, blur: 0, ink: 0.035, dur: 60, delay: -44 },
];

export function Grounds(): ReactElement {
  return (
    <div className="gl">
      <style>{SHEET}</style>

      <section className="g">
        <div className="g-field" aria-hidden>
          <div className="p-space">
            {PANELS.map((p, i) => (
              <span
                key={i}
                style={
                  {
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: `${p.w}px`,
                    height: `${p.h}px`,
                    background: `rgba(11, 14, 20, ${p.ink})`,
                    filter: p.blur ? `blur(${p.blur}px)` : undefined,
                    /* The keyframes own `transform`, so the tilt has to
                       reach them as a variable or it is thrown away. */
                    ['--r' as string]: `${p.rot}deg`,
                    ['--z' as string]: `${p.z}px`,
                    animationDuration: `${p.dur}s`,
                    animationDelay: `${p.delay}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>

        {/* the real headline, so the ground is judged under the thing it
            has to sit beneath */}
        <div className="g-col">
          <h1>Armed, and reading the market without you.</h1>
        </div>
      </section>
    </div>
  );
}

/* NO BACKTICKS BELOW THIS LINE. One of them ends the stylesheet. */
const SHEET = `
.gl, .gl * { box-sizing: border-box; }
.gl { zoom: 0.847458; background: #141517; padding: 18px; }

.g {
  position: relative; overflow: hidden; border-radius: 14px;
  background: #FFFFFF; height: 780px;
  display: flex; align-items: center;
}

.g-field {
  position: absolute; inset: 0; overflow: hidden; pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.34) 18%, #000 42%, #000 94%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.34) 18%, #000 42%, #000 94%, transparent 100%);
}

/*
 * THE ROOM.
 *
 * A shallow perspective with the vanishing point above centre, so panels
 * arriving from the back come down and out toward the corners rather than
 * straight through the headline.
 */
.p-space {
  position: absolute; inset: 0;
  perspective: 900px; perspective-origin: 50% 34%;
  transform-style: preserve-3d;
}

.p-space > span {
  position: absolute; display: block;
  border-radius: 14px;
  animation-name: papproach;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  will-change: transform;
}

/*
 * THE DRIFT.
 *
 * Panels come forward the length of the room and start again. It is the
 * only motion in the band, it takes forty odd seconds a pass, and at that
 * speed the eye never catches a thing moving: the frame is simply never
 * the same twice.
 *
 * translate3d only. Nothing here reflows or repaints.
 */
@keyframes papproach {
  0%   { transform: translate3d(-50%, -50%, -900px) rotate(var(--r, 0deg)); opacity: 0; }
  18%  { opacity: 1; }
  82%  { opacity: 1; }
  100% { transform: translate3d(-50%, -46%, 260px) rotate(var(--r, 0deg)); opacity: 0; }
}

/* the headline, at the real size, in the real column */
.g-col { position: relative; z-index: 1; width: min(1400px, 100% - 48px); margin: 0 auto; }
.g-col h1 {
  margin: 0; max-width: 24ch;
  font-family: var(--sans);
  font-size: 84px; font-weight: 500; letter-spacing: -0.045em; line-height: 1.04;
  color: #0B0E14;
}
`;

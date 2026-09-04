'use client';

import type { ReactNode } from 'react';
import './grip-variants.css';

/*
 * ── SHEET 7 · THE GRIP ON A DOCKED SEAM ──────────────────────────────
 *
 * When a panel is floating it has four edges and four corners, and a
 * pointer already expects to drag them. Snapped, three of those edges
 * are against the window and the only one that resizes anything is the
 * seam facing the page — a 1px line with nothing on it.
 *
 * These are eight ways to say "grab here" on that line, each drawn on a
 * real seam at shipping size, and each shown twice: at rest, and lit
 * the way it looks under the pointer.
 *
 * Sided, all of them. Every mark here is drawn for a panel docked
 * RIGHT, so the page is on the left. A left dock mirrors.
 */

const Dots3 = (
  <svg viewBox="0 0 4 18" fill="currentColor" aria-hidden>
    <circle cx="2" cy="2.4" r="1.2" />
    <circle cx="2" cy="9" r="1.2" />
    <circle cx="2" cy="15.6" r="1.2" />
  </svg>
);

const Dots6 = (
  <svg viewBox="0 0 6 22" fill="currentColor" aria-hidden>
    <circle cx="1.6" cy="5" r="1.15" />
    <circle cx="4.4" cy="5" r="1.15" />
    <circle cx="1.6" cy="11" r="1.15" />
    <circle cx="4.4" cy="11" r="1.15" />
    <circle cx="1.6" cy="17" r="1.15" />
    <circle cx="4.4" cy="17" r="1.15" />
  </svg>
);

const Dots3Thin = (
  <svg viewBox="0 0 3 16" fill="currentColor" aria-hidden>
    <circle cx="1.5" cy="2" r="1" />
    <circle cx="1.5" cy="8" r="1" />
    <circle cx="1.5" cy="14" r="1" />
  </svg>
);

const Arrows = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 8.5 6 12l3.5 3.5" />
    <path d="M14.5 8.5 18 12l-3.5 3.5" />
  </svg>
);

/** One seam, in one state. `lit` is the pointer being on it. */
function Seam({ v, lit, mark }: { v: string; lit?: boolean; mark: ReactNode }) {
  return (
    <div className={`gr-seam ${v}`} data-lit={lit ? '' : undefined}>
      <span className="g">{mark}</span>
      <u>{lit ? 'grab' : 'rest'}</u>
    </div>
  );
}

function Tile({ n, name, note, v, mark }: { n: number; name: string; note: string; v: string; mark: ReactNode }) {
  return (
    <div className="gr-tile">
      <div className="gr-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="gr-pair">
        <Seam v={v} mark={mark} />
        <Seam v={v} lit mark={mark} />
      </div>
    </div>
  );
}

export function GripVariants() {
  return (
    <section className="gr">
      <h2>The grip on a docked seam</h2>
      <p className="gr-note">
        Page on the left, panel on the right, the panel's own hairline between them, everything at
        shipping size. Each mark twice: at rest, then lit the way it looks under the pointer. None
        of them move, grow or slide when the pointer arrives, because a target that shifts once you
        are on it is a target you have to chase.
      </p>

      <div className="gr-rack">
        <Tile n={1} name="Plate" note="what ships now, one state" v="gr1" mark={<span>{Dots3}</span>} />
        <Tile n={2} name="Dots" note="the first try, nothing holding them" v="gr2" mark={Dots6} />
        <Tile n={3} name="Bar" note="a thumb, like a scrollbar's" v="gr3" mark={<i />} />
        <Tile n={4} name="Notch" note="the seam itself, thickened" v="gr4" mark={<i />} />
        <Tile n={5} name="Tab" note="half a pill, pulled out of the panel" v="gr5" mark={<span>{Dots3Thin}</span>} />
        <Tile n={6} name="Rung" note="ticks across the line, not dots on it" v="gr6" mark={<><i /><i /><i /></>} />
        <Tile n={7} name="Arrows" note="says which way it goes" v="gr7" mark={Arrows} />
        <Tile n={8} name="Ghost" note="clean until the pointer is on it" v="gr8" mark={<span>{Dots3}</span>} />
      </div>
    </section>
  );
}

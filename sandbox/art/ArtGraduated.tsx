'use client';

import './art.css';
import { GRADUATED, PADS } from '@/components/discover/column/rowData';

/*
 * EVERY LAUNCHPAD, ON CURVE AND GRADUATED.
 *
 * Two blocks per pad, side by side. The left one is a token still on its
 * launchpad's bonding curve: the picture's ring and the badge's ring are
 * both the pad's own colour. The right one has graduated: both go gold.
 *
 * That is the whole state. `--pad` is the only value that changes and
 * both rings read it, so there is one rule for this and nothing else in
 * the block moves.
 */

function art(seed: number): string {
  const hues = [150, 28, 96, 265, 200, 340, 45, 180];
  const h = hues[seed % hues.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="hsl(${h} 30% 14%)"/>` +
    `<circle cx="48" cy="42" r="20" fill="hsl(${h} 55% 46%)"/>` +
    `<rect x="18" y="66" width="60" height="12" rx="6" fill="hsl(${h} 40% 26%)"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Block({
  pad,
  i,
  graduated,
}: {
  pad: (typeof PADS)[number];
  i: number;
  graduated?: boolean;
}) {
  return (
    /*
     * `--pad` is set HERE rather than by a `[data-grad]` rule in the
     * stylesheet. A custom property set inline wins over one set by a
     * selector, exactly like any other declaration — so the CSS rule
     * never applied and the graduated block kept the pad's own colour.
     * The element that sets the variable is the only place that can
     * change it.
     */
    <div
      className="ar"
      data-grad={graduated ? '' : undefined}
      style={{
        ['--pad' as string]: graduated ? GRADUATED : pad.colour,
        /*
         * The RING's paint, not just a colour. Flat for a launchpad; the
         * gold gradient for graduated, which is what makes it read as
         * metal — the reference's own ring runs #ae7b0e to #efc10d
         * across its width.
         */
        ['--ring' as string]: graduated
          ? 'linear-gradient(135deg, #ae7b0e 0%, #efc10d 46%, #f7d770 62%, #b8830f 100%)'
          : pad.colour,
      }}
    >
      <div className="ar-box">
        <img className="ar-img" src={art(i)} alt="" />
        <span className="ar-pad">
          <span className="ar-pad-face">
            {/* The same artwork in both states. Graduated tints it gold
                rather than replacing it with a silhouette, so the mark
                keeps the internal contrast that makes it recognisable. */}
            <img
              src={pad.logo}
              alt=""
              data-solid={pad.solid ? '' : undefined}
              data-gold={graduated ? '' : undefined}
            />
          </span>
        </span>
      </div>
      <span className="ar-mint">{graduated ? 'graduated' : 'on curve'}</span>
    </div>
  );
}

export function ArtGraduated() {
  return (
    <div className="arg-grid">
      {PADS.map((pad, i) => (
        <div className="arg-cell" key={pad.key}>
          <div className="arg-two">
            <Block pad={pad} i={i} />
            <Block pad={pad} i={i} graduated />
          </div>
          <span className="arg-name">{pad.label}</span>
        </div>
      ))}
    </div>
  );
}

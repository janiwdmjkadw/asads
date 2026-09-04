'use client';

import './perps-coming.css';

/**
 * Slice "Portfolio perpetuals tab": the coming-soon screen.
 *
 * The word, in the middle of the tab, and a ticker of mint bars rising
 * and falling along the bottom. No caption, no date, no feature list,
 * no button — nothing is claimed that has not been said out loud.
 *
 * `BARS` is a density, not a layout: the bars are flex children with no
 * fixed width, so this number decides how fine the band is and it fills
 * any pane.
 *
 * The delays are a WALK, not a stagger. `index * -0.2s` reads as a wave
 * travelling left to right, which is a progress bar; an irregular cycle
 * reads as a market.
 */

const BARS = 72;

const OFFSETS = [0, -0.9, -0.35, -1.7, -0.6, -2.2, -0.15, -1.25, -0.75, -1.95, -0.45, -2.5];

export function PerpsComing(): React.ReactElement {
  return (
    <div className="pc">
      <div className="pc-mid">
        <div className="pc-big">
          Perpetuals<s>.</s>
        </div>
        {/* Set well back and directly under the word, so it reads as a
            note on it rather than as the second of two grey lines
            centred in an empty panel, which is what it replaced. */}
        <div className="pc-soon">
          Coming soon<s>.</s>
        </div>
      </div>

      <span className="pc-ticker" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} style={{ animationDelay: `${OFFSETS[i % OFFSETS.length]}s` }} />
        ))}
      </span>
      <span className="pc-base" aria-hidden />
    </div>
  );
}

import './art.css';
import { PADS } from '@/components/discover/column/rowData';
import { PAD_MARKS } from '@/components/discover/column/padMarks';

/*
 * THE COIN, BOTH WAYS.
 *
 * Every launchpad's art block on curve and graduated, side by side. Not
 * the mark on its own — the whole thing: the outlined picture, the ring
 * around it, and the pad badge in its corner.
 *
 * ── WHY THE PAIR ─────────────────────────────────────────────────────
 *
 * Graduation is not a badge that gets added, it is a restyle of the same
 * object: the ring turns gold, the pad's colour is replaced, and the
 * badge artwork goes through a filter. Three changes to one block. Shown
 * apart they each look fine; the only way to see whether the graduated
 * one still reads as the SAME coin is to put them next to each other.
 *
 * ── THE GOLD IS A FILTER, WHICH IS WHY BONK IS THE ODD ONE ───────────
 *
 * The badge keeps the pad's real bitmap and tints it. That works on
 * artwork with its own light and dark, and fails on Bonk, whose logo is
 * an orange disc with a light emblem on it — tinting a full colour
 * bitmap cannot know which pixels are the mark, so it came out an orange
 * smear. Graduated Bonk uses the traced mark instead, which takes
 * `currentColor`, so gold is just a colour. That swap is visible here.
 */

const GRADUATED = '#e8b33d';
const GOLD_RING = '#e8b33d';

/* The picture inside the block. The same generated placeholder the rows
   use — this sheet is about the frame, the ring and the badge, and a
   real photograph in the middle would be the loudest thing on it. */
function art(seed: number): string {
  const hues = [150, 28, 96, 265, 200, 340, 45, 180];
  const h = hues[seed % hues.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">`
    + `<rect width="96" height="96" fill="hsl(${h} 30% 14%)"/>`
    + `<circle cx="48" cy="42" r="20" fill="hsl(${h} 55% 46%)"/>`
    + `<rect x="18" y="66" width="60" height="12" rx="6" fill="hsl(${h} 40% 26%)"/>`
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Block({
  pad,
  index,
  graduated,
}: {
  pad: (typeof PADS)[number];
  index: number;
  graduated: boolean;
}) {
  return (
    <div
      className="ar"
      data-grad={graduated ? '' : undefined}
      style={{
        ['--pad' as string]: graduated ? GRADUATED : pad.colour,
        ['--ring' as string]: graduated ? GOLD_RING : pad.colour,
      }}
    >
      <div className="ar-box">
        <img className="ar-img" src={art(index)} alt="" />
        <span className="ar-pad">
          <span className="ar-pad-face">
            {graduated && pad.key === 'bonk' ? (
              <span className="ar-pad-mark">{PAD_MARKS.bonk}</span>
            ) : (
              <img
                src={pad.logo}
                alt=""
                data-solid={pad.solid ? '' : undefined}
                data-gold={graduated ? '' : undefined}
              />
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

export function CoinSheet() {
  return (
    <div className="cs">
      <div className="cs-head">
        <span className="qs-title">Coin</span>
        <span className="cs-key">on curve · graduated</span>
      </div>
      <div className="cs-grid">
        {PADS.map((pad, index) => (
          <div className="cs-cell" key={pad.key}>
            <div className="cs-pair">
              <Block pad={pad} index={index} graduated={false} />
              <Block pad={pad} index={index} graduated />
            </div>
            <span className="ms-label">{pad.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import './fren-variants.css';

/*
 * ── YOUR FRENS · BESIDE ──────────────────────────────────────────────
 *
 * The chosen one, with the two changes asked for.
 *
 * ── THE RANKS ARE BACK, THE MOVEMENT IS NOT ──────────────────────────
 *
 * I took the numerals out on the argument that the order already says
 * the position. It does, but that is not what a rank is FOR here: the
 * left half has taken rank one out of the column entirely, so without
 * numerals the right column starts at an unlabelled second place and
 * you cannot tell where in a board of a thousand you are looking. The
 * numeral is the only thing tying this column to the featured fren
 * beside it.
 *
 * The movement carets are gone. A red or green arrow on every row put a
 * column of colour down the middle of a section whose subject is the
 * figure at the far end, and it was the loudest thing here for the
 * least reason: how a fren moved since last week is not why anybody
 * opens this.
 *
 * That leaves no colour in the section at all, which is right. Green
 * and red mean a gain and a loss in this product, and none of these
 * rows is either.
 *
 * ── AND THE REST OF THEM ─────────────────────────────────────────────
 *
 * A referral list is not ten people. It is ten people and then however
 * many hundreds, and every version so far ended with `and 8 more` in
 * grey, which is a shrug: it names a count and drops the money.
 *
 * The last row is a real row now. It carries the count and the COMBINED
 * total those frens paid you, set in the same column as every figure
 * above it, so the tail is weighed against the head instead of being
 * filed away. At a thousand frens that line is usually the largest
 * figure on the screen, and it should be.
 *
 * IT OPENS NOTHING. It is the last line of the list, not a door.
 */

interface Fren {
  readonly rank: number;
  readonly who: string;
  readonly vol: number;
  readonly earned: number;
}

const TOP_FREN: Fren = { rank: 1, who: 'aster', vol: 412.8, earned: 0.8256 };

const SHOWN: ReadonlyArray<Fren> = [
  { rank: 2, who: 'brixby', vol: 308.15, earned: 0.6163 },
  { rank: 3, who: 'delune', vol: 204.44, earned: 0.4089 },
  { rank: 4, who: 'evren', vol: 188.9, earned: 0.3778 },
  { rank: 5, who: 'fenwick', vol: 170.21, earned: 0.3404 },
  { rank: 6, who: 'grigg', vol: 142.6, earned: 0.2852 },
  { rank: 7, who: 'halcy', vol: 118.03, earned: 0.2361 },
  { rank: 8, who: 'ibsen', vol: 96.44, earned: 0.1929 },
  { rank: 9, who: 'juno', vol: 74.12, earned: 0.1482 },
  { rank: 10, who: 'kepler', vol: 58.9, earned: 0.1178 },
];

/* A thousand frens, so the tail is the interesting case rather than a
   footnote. Ten are drawn and the other 1,014 are one line. */
const TOTAL_FRENS = 1024;
const REST_COUNT = TOTAL_FRENS - 1 - SHOWN.length;
const REST_EARNED = 6.3242;

const sol = (n: number) => n.toFixed(4);
/* Two digits always. A board that runs past nine and prints `9` then
   `10` shifts every name on the row below it. */
const two = (n: number) => String(n).padStart(2, '0');
const count = (n: number) => n.toLocaleString();

function Beside() {
  return (
    <div className="fv-beside">
      <div className="fv-beside-l">
        <span className="fv-lab">Top fren this week</span>
        <div className="fv-beside-nm">@{TOP_FREN.who}</div>
        <div className="fv-beside-e">
          {sol(TOP_FREN.earned)}
          <span className="fv-beside-u">SOL to you</span>
        </div>
        <span className="fv-dim">from {TOP_FREN.vol.toFixed(2)} SOL traded</span>
      </div>

      <div className="fv-beside-r">
        {SHOWN.map((f) => (
          <div className="fv-beside-row" key={f.who}>
            <span className="fv-rk">{two(f.rank)}</span>
            <span className="fv-nm">@{f.who}</span>
            <span className="fv-num">{sol(f.earned)}</span>
          </div>
        ))}

        {/*
         * Not `and 1,014 more` in grey. That names a count and drops
         * the money, on a page whose subject is the money.
         *
         * The figure sits in the SAME column as every figure above it,
         * so the tail is weighed against the head. At this many frens
         * it is the largest number on the section, which is the true
         * thing about a referral list and the thing every version so
         * far hid.
         *
         * IT OPENS NOTHING. It was a button with a chevron and a hover
         * plate, which promised a screen behind it that does not exist
         * and turned the last line of a summary into a door. It is a
         * row: the last line of the list, saying what the rest of them
         * add up to.
         *
         * No numeral in front of it, because it is not a position. It
         * is everybody after the tenth.
         */}
        <div className="fv-more">
          <span className="fv-more-n">{count(REST_COUNT)} more frens</span>
          <span className="fv-more-e">{sol(REST_EARNED)}</span>
        </div>
      </div>
    </div>
  );
}

export function FrenVariants() {
  return (
    <div className="fv">
      <h2>YOUR FRENS · BESIDE</h2>
      <p className="fv-note">
        The rank numerals are back: the left half has taken rank one out of the column, so without
        them the right column starts at an unlabelled second place and you cannot tell where in a
        board of a thousand you are looking. The movement carets are gone, and with them the last
        colour in the section, which is right, because green and red mean a gain and a loss in this
        product and none of these rows is either. The last row carries the count and the combined total the rest of them paid, in the same
        column as every figure above it, so at a thousand frens the tail is weighed against the head
        instead of filed away as grey text.
      </p>

      <div className="fv-slot">
        <div className="fv-frame">
          <Beside />
        </div>
      </div>
    </div>
  );
}

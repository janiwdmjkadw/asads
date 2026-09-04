import { ArtColumn } from './ArtColumn';
import type { BuyVariant } from '@/components/discover/column/TokenRow';

/*
 * QUICK BUY, BY SIZE THEN BY CORNER.
 *
 * All of them put the control in the same place — bottom right of the
 * row — and differ only in how much of it there is and how hard the
 * corner is.
 *
 * ── TWO BANDS, NOT ONE ROW OF FIVE ───────────────────────────────────
 *
 * Round on top, sharp underneath, with each sharp column sitting
 * directly below the round one it varies. Five columns in a line put a
 * sharp small next to a round large, and comparing those two tells you
 * nothing about either — the only useful comparison is straight down.
 *
 * ── REAL COLUMNS, NOT MOCK ROWS ──────────────────────────────────────
 *
 * Three rows each, and they are the actual column component. One of
 * these variants is a HOVER, and a screenshot of a hover is a picture
 * of a state nobody is in — whether the panel covers something you were
 * reading can only be answered by pointing at it.
 */

const ROUND: readonly [BuyVariant, string][] = [
  ['small', 'Small · round'],
  ['large', 'Large · round'],
  ['ultra', 'Ultra · 25% on hover'],
];

const SHARP: readonly [BuyVariant, string][] = [
  ['small-sharp', 'Small · sharp'],
  ['large-sharp', 'Large · sharp'],
];

function Band({ set }: { set: readonly [BuyVariant, string][] }) {
  return (
    <div className="bv-sheet">
      {set.map(([v, label]) => (
        <div className="bv-col" key={v}>
          <span className="bv-label">{label}</span>
          <div className="arc-sheet">
            <ArtColumn buy={v} limit={3} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BuyVariants() {
  return (
    <div className="bv-stack">
      <Band set={ROUND} />
      <Band set={SHARP} />
    </div>
  );
}

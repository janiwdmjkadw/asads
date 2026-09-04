'use client';

import { PresetMenu } from './PresetMenu';
import './column.css';
import { useBuyStyle } from '@/lib/state/buyStyle';
import { SolDefs } from './sol';

/**
 * THE COLUMN, as settled on `/whatever`, now in the board.
 *
 * This is the head and the ground and nothing else. The list below it is
 * EMPTY on purpose, which is the same decision the sheet made: the rows
 * are not settled, and a lane full of tokens is twenty objects arguing
 * with whatever is being decided about the thing holding them.
 *
 * Four things in the head differ from the reference, and all four are
 * deliberate:
 *
 *   1 · The search is an OUTLINED PILL, not a filled plate. A fill makes
 *       it a block sitting in the head; an outline makes it a field cut
 *       into it.
 *   2 · It carries NO magnifier and its placeholder is CENTRED. The word
 *       "Search" is the whole label, and an icon beside it is the same
 *       word twice.
 *   3 · The bordered group holds only TWO things, the buy size and the
 *       preset. Those are settings; the filter is an action, so it sits
 *       loose outside the group, as the reference has it.
 *   4 · The buy size is TYPED, not displayed. It was a static number,
 *       which made the one setting you change most often on this lane
 *       the one thing you could not touch.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * Column mode used to render `Section`'s own dense header over a
 * `CardLane` of `CoinCard`s. Both are gone from this path. Nothing about
 * ROWS mode changed: it still renders the old header and the old lane,
 * so the horizontal carousels are untouched.
 */

const I = {
  /*
   * A FUNNEL, not three stacked lines. The old glyph was a long line
   * over a shorter one over a shorter one, which is the mark for
   * sliders, or a list, or a menu, and is used for all three elsewhere
   * in this product. A funnel means one thing: something goes in and
   * less comes out.
   */
  filter: 'M3.5 5.5h17l-6.6 7.6v5.2l-3.8 2.2v-7.4z',
  chart: 'M3 17l5.5-6 4 4L21 6M21 6h-4.5M21 6v4.5',
} as const;

/* Solid, not stroked. The reference draws it filled and it is the one
   mark in the head that reads as a symbol rather than an outline. */
function Bolt() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      className="cl-bolt"
      aria-hidden
      style={{ display: 'block' }}
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
    </svg>
  );
}

function Glyph({ d, size = 11, weight = 1.9 }: { d: string; size?: number; weight?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/*
 * The real Solana mark in its own gradient, not a stroked glyph in grey.
 *
 * The gradient id is suffixed per column. Three of these mount at once
 * in the board and an SVG `<defs>` id is DOCUMENT global — with one
 * shared id every column after the first paints from whichever copy the
 * browser resolved, and unmounting that one blanks the others.
 */
/*
 * The real Solana mark in its own gradient.
 *
 * The gradient id is suffixed per column. Three of these mount at once
 * and an SVG `<defs>` id is DOCUMENT global — with one shared id every
 * column after the first paints from whichever copy the browser
 * resolved, and unmounting that one blanks the others.
 */
function SolMark({ uid }: { uid: string }) {
  const id = `cl-sol-grad-${uid}`;
  return (
    <svg className="cl-sol" viewBox="0 0 24 24" width="12" height="12" fill={`url(#${id})`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M4.53 15.88a.87.87 0 0 1 .61-.25h17.4c.39 0 .58.47.3.74l-3.44 3.44a.87.87 0 0 1-.61.25H1.4a.42.42 0 0 1-.3-.72l3.43-3.46z" />
      <path d="M4.53 4.6a.9.9 0 0 1 .61-.25h17.4c.39 0 .58.47.3.74l-3.44 3.44a.87.87 0 0 1-.61.25H1.4a.42.42 0 0 1-.3-.72L4.53 4.6z" />
      <path d="M19.19 10.2a.87.87 0 0 0-.61-.25H1.18a.42.42 0 0 0-.3.72l3.44 3.44c.16.16.38.25.61.25h17.4a.42.42 0 0 0 .3-.72l-3.44-3.44z" />
    </svg>
  );
}

export function ColumnShell({
  label,
  uid,
  onFilters,
  filtersActive = false,
  children,
}: {
  label: string;
  uid: string;
  /**
   * The lane's contents.
   *
   * Absent in the board, where the list is deliberately empty while the
   * row is designed — so the board renders exactly as it did before this
   * existed. It is here so the `/whatever` sheet can put rows inside the
   * REAL head rather than a copy of it: a duplicated head drifts from
   * this one the first time either is touched, and then the sheet is
   * approving something the app does not have.
   */
  children?: import('react').ReactNode;
  /*
   * Opens `DiscoverFiltersModal` on THIS column's section. Passed down
   * rather than called from here: one modal is mounted for the whole
   * board and `DiscoverPage` owns which section it opens on, so a column
   * that opened its own would be a second one fighting the first.
   */
  onFilters?: () => void;
  /** Whether this section currently has any filter set — the funnel inks. */
  filtersActive?: boolean;
}) {
  const { style: buy } = useBuyStyle();
  const buySize = buy.size;

  return (
    <div className="cl" data-kind="column-row">
      <div className="cl-head">
        <span className="cl-title">{label}</span>

        {/*
          * ONE SPACER. The head is two things: the heading on the left
          * and the settings on the right, with the whole gap between
          * them. Nothing sits in the middle.
          */}
        <span className="cl-grow" />

        <label className="cl-search">
          <input placeholder="Search" spellCheck={false} aria-label={`Search ${label}`} />
        </label>

        <span className="cl-tools">
          {/*
            * NO BOLT in front of the number. The SOL mark on the other
            * side is already the unit, and the control sits in a group
            * whose whole subject is how this lane buys — so a lightning
            * bolt was saying "this is the buy amount" to a number that
            * could not be anything else.
            *
            * `size={3}` rather than a width: the field grows with the
            * number, so `0` and `2.5` both sit tight against the unit
            * instead of leaving a gap that moves.
            */}
          <span className="cl-tool is-field">
            <Bolt />
            <input
              className="cl-size"
              defaultValue="0"
              size={3}
              inputMode="decimal"
              spellCheck={false}
              aria-label="Quick buy amount in SOL"
            />
            <SolMark uid={uid} />
          </span>
          <span className="cl-toolrule" aria-hidden />
          {/* Opens the three presets. See `PresetMenu`. */}
          <PresetMenu />
        </span>

        {/*
          * NO MUTE BUTTON.
          *
          * The speaker was the only control in the head that did not
          * change what the lane shows — it silenced a sound, which is a
          * preference and belongs with the other preferences rather than
          * on every column three times over.
          *
          * The funnel stays loose here, as the reference has it: it does
          * something rather than holding a setting.
          */}
        <button
          type="button"
          className="cl-loose"
          data-on={filtersActive}
          aria-label={`Filter ${label}`}
          aria-haspopup="dialog"
          onClick={onFilters}
        >
          <Glyph d={I.filter} size={13} />
        </button>
      </div>

      {/* Empty in the board. See the note at the top of this file. */}
      {/* Ultra is the only quick-buy treatment wired in. The rest are
            still being picked on `/whatever`; a switch replaces this
            literal when one of them wins. */}
      {/*
        * The Solana gradient, defined ONCE for the whole column.
        *
        * Every row's fee mark paints with `url(#arc-sol)`. It used to
        * live in the sandbox column's wrapper, so the mark rendered
        * unfilled everywhere else — a `fill` pointing at a gradient that
        * is not on the page paints nothing at all.
        *
        * It lives in `sol.tsx` now, with the mark it feeds, so any other
        * surface that wants one takes the pair rather than copying the
        * stops and hoping the ids still match.
        */}
      <SolDefs />
      {/* The quick-buy treatment, chosen in the Tweaks palette. Ultra is
          a different LAYOUT rather than a bigger button, which is why
          size lands as an attribute here and not as a variable. */}
      <div className="cl-list" data-buy={buySize}>
        {children}
      </div>
    </div>
  );
}

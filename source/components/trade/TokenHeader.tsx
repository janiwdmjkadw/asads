'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './trade-header.css';
import { PADS } from '../discover/column/rowData';
import { PAD_MARKS } from '../discover/column/padMarks';
import { ROW2_MARKS, type Row2Key } from '../discover/column/rowMarks';
import { PILL_MARKS } from '../discover/column/Pills';
import { SolDefs, SolMark } from '../discover/column/sol';

/*
 * THE TRADE PAGE'S TOKEN HEADER — LEFT HALF.
 *
 * Who the coin is: the picture, the ticker, the sentence the dev wrote,
 * how old it is, where its links go, how many people are watching.
 *
 * ── AND THE RIGHT HALF: WHAT IT IS WORTH ─────────────────────────────
 *
 * The market cap set loud and alone, then five readings behind it, then
 * two things that are not readings at all.
 *
 * They are two kinds of fact and they sit at opposite ends with the
 * whole bar between them, because nothing in the middle belongs to
 * either. Left is identity — none of it is a number you trade on. Right
 * is price, and every figure in it moves.
 *
 * ── THE MARKET CAP CARRIES NO LABEL ──────────────────────────────────
 *
 * 19px against 12.5 for the five beside it, and no word over it. The
 * five that DO have labels are the ones you have to be told the name of;
 * the big figure is the one you came for, and a caption on it would be a
 * caption explaining the obvious.
 *
 * ── NOTHING HERE IS REDRAWN ──────────────────────────────────────────
 *
 * The first cut of this hand drew all of it: a placeholder square with a
 * gold dot for a badge, and nine fresh glyphs for the second line. Both
 * already exist and are already settled.
 *
 * So the picture is the Discover row's own art block — the same `.ar`
 * markup, the same ring, the same pad badge in the same corner, out of
 * `token-row.css` — and every mark on the second line comes from
 * `ROW2_MARKS`, in the wrapper class it wears on a row.
 *
 * That is not tidiness. A header drawing its own copy of the leaf is a
 * header whose leaf will one day differ from the one six pixels below it
 * on the board, and nobody will know which is right.
 *
 * ── THE MARKS ARE SIZED UP, THOUGH ───────────────────────────────────
 *
 * On a row they render at 15.5px in a 61px band. This bar is 56px with
 * two lines instead of three, and the same marks at the same size looked
 * lost in it — see `.th .th-i` in `trade-header.css`.
 */

/* The pad this mock is launched on. A real entry, so the badge is a real
   logo rather than a stand-in. */
const PAD = PADS.find((p) => p.key === 'bonk')!;

/* The coin's picture. Generated rather than a photograph: the sheet is
   about the band, and a real face in the corner of it is the loudest
   thing on the page. */
function art(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
    + '<rect width="96" height="96" fill="#3a2418"/>'
    + '<circle cx="48" cy="38" r="19" fill="#c2683a"/>'
    + '<rect x="16" y="62" width="64" height="20" rx="8" fill="#8f4a28"/>'
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/*
 * A row mark, in the wrapper it wears on a row. `filled` marks carry no
 * stroke; the leaf brings its own viewBox because it is drawn a pixel
 * down its box.
 */
function Mark({ k, cls, tier, tip = true }: { k: Row2Key; cls: string; tier?: string; tip?: boolean }) {
  const mark = ROW2_MARKS[k];
  const props = 'filled' in mark && mark.filled
    ? ({ fill: 'currentColor', stroke: 'none' } as const)
    : ({
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    } as const);
  return (
    <span className={cls} data-tip={tip ? mark.label : undefined} data-tier={tier}>
      <svg viewBox={'viewBox' in mark ? mark.viewBox : '0 0 24 24'} {...props}>
        {mark.art}
      </svg>
    </span>
  );
}

/* Copy and star are the header's OWN — they act on the page you are
   looking at rather than describing the coin, so they are not row marks
   and are not in the shared set. */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const Copy = (
  <svg viewBox="0 0 24 24" {...S}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);
const Star = (
  <svg viewBox="0 0 24 24" {...S}><path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" /></svg>
);
const Chevron = (
  <svg viewBox="0 0 24 24" {...S}><path d="m14.5 5.5-7 6.5 7 6.5" /></svg>
);
const Refresh = (
  <svg viewBox="0 0 24 24" {...S}><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20.5 4v4.5H16" /></svg>
);
const Megaphone = (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></svg>
);
const Eye = (
  <svg viewBox="0 0 24 24" {...S}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3.1" /></svg>
);

/*
 * A labelled reading. The label sits ABOVE its figure rather than beside
 * it: five pairs inline would be ten things read left to right, and
 * stacked it is five columns where the eye takes the bottom line only.
 */
function Stat({
  label,
  short,
  tone,
  lead,
  children,
}: {
  label: string;
  /*
   * The narrow form of the same label. Both are rendered and CSS picks
   * one — the alternative is measuring the viewport in JS to decide
   * which string to return, which makes a layout question into a render
   * question and gets it wrong on the first paint.
   */
  short?: string;
  /* Tints the FIGURE. The label stays grey either way. */
  tone?: 'up' | 'down';
  /* The one label in a group that names the group — see `.th-flow`. */
  lead?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="th-stat">
      <span className="th-stat-k" data-lead={lead ? '' : undefined}>
        <span className="th-k-long">{label}</span>
        {short ? <span className="th-k-short">{short}</span> : null}
      </span>
      <span className="th-stat-v" data-tone={tone}>{children}</span>
    </div>
  );
}

/*
 * ── THE FOUR WINDOWS ─────────────────────────────────────────────────
 *
 * One set of readings each. `buyShare` drives the split bar, and it
 * agrees with `net` by construction — over half means more bought than
 * sold, which means the net is positive. They are two views of the same
 * fact and a fixture where they disagree would be a fixture teaching the
 * bar to lie.
 */
const WINDOWS = [
  { key: '5m', change: '+45.15%', up: true, vol: '$150K', buys: ['1.41K', '$76.6K'], sells: ['1.3K', '$73.3K'], net: '+$3.29K', netUp: true, buyShare: 51 },
  { key: '1h', change: '+1.17K%', up: true, vol: '$1.2M', buys: ['12.4K', '$618K'], sells: ['11.9K', '$647K'], net: '-$29.1K', netUp: false, buyShare: 48 },
  { key: '6h', change: '+1.17K%', up: true, vol: '$4.8M', buys: ['48.2K', '$2.44M'], sells: ['46.1K', '$2.36M'], net: '+$81.4K', netUp: true, buyShare: 55 },
  { key: '24h', change: '+1.17K%', up: true, vol: '$12.6M', buys: ['121K', '$6.38M'], sells: ['119K', '$6.22M'], net: '+$160K', netUp: true, buyShare: 50 },
] as const;

export function TokenHeader() {
  /*
   * Which window the four readings are showing. It is the ONLY piece of
   * state on this bar — everything else is a fixture — because it is the
   * only thing a reader changes.
   */
  const [win, setWin] = useState(0);
  const w = WINDOWS[win];

  const strip = useRef<HTMLDivElement>(null);
  /*
   * A fixed nudge rather than a page: the row is a run of small items of
   * very different widths, and scrolling by the container's width would
   * jump past four of them at once. 260 moves about two readings, which
   * is close enough to "the next thing" to feel like stepping.
   */
  const nudge = useCallback((dir: 1 | -1) => {
    strip.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  }, []);

  /*
   * ── AN ARROW ONLY EXISTS WHILE THERE IS SOMETHING BEHIND IT ─────────
   *
   * Two independent facts, not one: whether anything is cut off to the
   * LEFT and whether anything is cut off to the RIGHT. A single "does it
   * overflow" flag would leave a back arrow showing at the start of the
   * row, pointing at nothing.
   *
   * ── AND IT IS MEASURED, NOT ASSUMED ─────────────────────────────────
   *
   * The scroll listener catches the position changing; the observer
   * catches the SIZE changing, which the scroll event does not fire for
   * — the window resizing, or the row's own contents reflowing when a
   * figure grows a digit. Both children are observed as well as the
   * strip, because the strip's own box does not change when what is
   * inside it does.
   */
  const [cut, setCut] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    /* A pixel of slack: sub-pixel layout leaves `scrollLeft` a fraction
       short of `max` at the end of a scroll, which would keep the
       forward arrow up with nothing left to reach. */
    setCut({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure]);

  return (
    <div className="th-wrap">

      {/* The gradient the mark paints with. Once per surface — a
          `fill: url(#id)` resolves against the document, so without this
          the mark renders invisible rather than wrong. */}
      <SolDefs />

      <header className="th">
        {/*
          * ── THE LEFT SIDE SCROLLS, IT DOES NOT SHRINK ───────────────
          *
          * Identity and price used to give up width as the window
          * closed: the sentence truncated, then the marks crowded, then
          * everything collided. That trades a readable bar for a bar
          * that is technically still one line.
          *
          * They keep their size now and run off the end instead. The
          * flow block on the right is opaque and pinned, so the strip
          * passes UNDER it — nothing is hidden behind a fade, and the
          * arrows on that block bring the rest back.
          */}
        <div className="th-scroll" ref={strip}>
        <div className="th-id">
          {/* The board's art block, unchanged — `.ar` and everything
              under it is `token-row.css`. */}
          <div
            className="ar th-art"
            style={{ ['--pad' as string]: PAD.colour, ['--ring' as string]: PAD.colour }}
          >
            <div className="ar-box">
              <img className="ar-img" src={art()} alt="" />
              <span className="ar-pad">
                <span className="ar-pad-face">
                  {PAD_MARKS[PAD.key]
                    ? <span className="ar-pad-mark">{PAD_MARKS[PAD.key]}</span>
                    : <img src={PAD.logo} alt="" />}
                </span>
              </span>
            </div>
          </div>

          <div className="th-lines">
            <div className="th-line">
              {/* One target: the name and the sentence go where the
                  picture goes. */}
              <span className="th-art-hit">
              <span className="th-tick">Markiplier</span>
              {/* The dev's own sentence, not a second name. It is the one
                  thing on this bar allowed to truncate — everything else
                  is a fixed word or a figure, and half a figure is worse
                  than none. */}
              <span className="th-desc">that seems undervalued</span>
              </span>
              <span className="th-i" data-tip="Copy address">{Copy}</span>
              <Mark k="website" cls="th-i" />
              <span className="th-i" data-tip="Watchlist">{Star}</span>
              {/*
                * ── THE AGE APPEARS TWICE, AND ONLY ONE IS EVER SHOWN ──
                *
                * Wide it belongs at the head of the marks line, where it
                * frames everything after it: a 40% holder concentration
                * at four seconds old is a launch, the same figure at four
                * days is a rug that already happened.
                *
                * Narrow, the marks line is the row that wraps, and an age
                * pushed onto a second line of glyphs is orphaned from the
                * name it describes. So it moves up beside the ticker,
                * which is where the reference puts it too.
                *
                * Both are in the DOM and CSS shows one. The alternative
                * is a media query read in JS, which decides at render
                * time what is a layout question and gets it wrong on the
                * first paint.
                */}
              <span className="th-age th-age-top">15m</span>
            </div>

            <div className="th-line th-line-2">
              {/* Age leads, the same as it does on a row: it is the field
                  that changes what every other one means. */}
              <span className="th-age th-age-line2">15m</span>
              {/* The one mark with no tip: the leaf IS the label. Its tier
                  is the whole message and a bubble saying "Audit" adds a
                  word to something already read at a glance. */}
              <Mark k="leaf" cls="arc-leaf" tier="good" tip={false} />
              <Mark k="search" cls="th-i" />
              <Mark k="telegram" cls="th-i" />
              <Mark k="github" cls="th-i" />
              <Mark k="account" cls="th-i" />
              {/* The one bordered thing on the bar. Everything else here
                  is a fact; this is the only control.

                  The mark is Dex Screener's own — `PILL_MARKS.boost`,
                  the same owl the third line of a Discover row uses for
                  a paid listing and for a boost. Funding one IS a Dex
                  Screener action, so it takes their mark rather than a
                  SOL glyph, which is what it had and which said the
                  wrong thing: that this was about paying in SOL. */}
              <span className="th-fund" data-tip="Fund on Dex Screener">{PILL_MARKS.boost}Fund</span>
              {/* LAST on the line. It is the only item here that is a
                  live count rather than a fact about the coin or a thing
                  to press, so it sits at the end where a figure belongs
                  — the same place holders and migrations take on a row. */}
              <span className="th-watch" data-tip="Watching now">{Eye}37</span>
              {/*
                * ── THE CALL COUNT HAS A SECOND HOME ───────────────────
                *
                * Wide it belongs with the figures, at the end of the
                * price group. Under 480 that row has 32px of slack and
                * the count needs 33, so it wrapped — and a single item
                * on a fourth line is the chopped look.
                *
                * It moves up here instead, where the marks line has
                * nearly a hundred pixels spare. Same duplicate-and-
                * toggle as the age above.
                */}
              <span className="th-calls th-calls-line2" data-tip="Dev migrations">
                <span className="th-crown">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">{ROW2_MARKS.migrations.art}</svg>
                </span>
                53
              </span>

            </div>
          </div>
        </div>

        {/* ── WHAT IT IS WORTH ──────────────────────────────────── */}
        <div className="th-figs">
          {/* "MC" only appears in the narrow layout. Set large and alone
              across the bar the figure needs no label; run inline with
              five others it is the one unlabelled number in a row of
              labelled ones, which reads as an omission. */}
          <span className="th-mc"><span className="th-k-short">MC</span>$5.56K</span>

          <Stat label="Price" short="P">
            {/* The leading zeros are a COUNT, not digits. At this price
                there are five of them, and printing them would make the
                number twice the width of the two beside it. */}
            $0.0<sub>5</sub>6
          </Stat>
          <Stat label="Liquidity" short="L">$6.65K</Stat>
          <Stat label="Supply" short="S">
            971M
            <span className="th-re" data-tip="Refresh supply">{Refresh}</span>
          </Stat>
          <Stat label="Global Fees Paid" short="F">
            {/* Solana's own mark, gradient and all — the same
                `<SolMark />` the fee figure on a Discover row uses. It
                was three hand drawn chevrons in a flat teal, which is a
                drawing OF the logo rather than the logo. */}
            <span className="th-sol"><SolMark size={13} /></span>
            31.53
          </Stat>
          <Stat label="ATH" short="ATH">$99.9K</Stat>

          {/* Not readings. A count of who called this coin, and the
              control that broadcasts it — so they sit past the figures
              with more air than anything between the stats. */}
          <span className="th-calls th-calls-figs" data-tip="Dev migrations">
            <span className="th-crown">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">{ROW2_MARKS.migrations.art}</svg>
            </span>
            53
          </span>
          {/* A button, not a bare mark. Everything else on this half is
              something to READ; this is the one thing on it you do, and
              a lone glyph beside five figures reads as a sixth reading
              rather than as an action. The word is what makes it one. */}
          <button type="button" className="th-call">
            {Megaphone}
            Call
          </button>
        </div>
        </div>

        {/* The way back to what scrolled off. They sit on the flow
            block because it is the thing pinned over the strip — the
            arrows belong to the edge that is doing the covering. */}
        {cut.left || cut.right ? (
          <div className="th-nav">
            {cut.left ? (
              <button type="button" className="th-arrow" aria-label="Scroll left" onClick={() => nudge(-1)}>
                {Chevron}
              </button>
            ) : null}
            {cut.right ? (
              <button type="button" className="th-arrow is-right" aria-label="Scroll right" onClick={() => nudge(1)}>
                {Chevron}
              </button>
            ) : null}
          </div>
        ) : null}

        {/*
          * ── THE FLOW, AND THE BAR UNDER IT ──────────────────────
          *
          * Four readings that only mean anything together: what moved
          * in the window, how much of it was buying, how much selling,
          * and the difference. They are one group, so they get one
          * rule under them rather than four separate columns.
          *
          * The bar is the same four numbers again as a proportion. It
          * is not decoration: buys and sells are two long strings a
          * reader has to compare digit by digit, and the split says
          * which way it went before either is read.
          *
          * ── AND IT SITS AT THE FAR RIGHT, ON ITS OWN ────────────
          *
          * Not beside the price group. Those five are what the coin IS
          * WORTH — one figure each, and all of them still. These four
          * are what is HAPPENING to it inside a five minute window, and
          * they change while you watch. Running them on from the price
          * made nine columns of small type that read as one long table,
          * and the seam between two kinds of fact disappeared.
          *
          * `margin-left: auto` puts the whole width of the bar between
          * them, and that space is the separator.
          */}
        <div className="th-flow">

          <div className="th-flow-row">
            {/* The window's own name leads the group — picking 1h
                changes this label as well as the figures, so the row
                always says what it is measuring. */}
            <Stat label={`${w.key} Vol`} lead>{w.vol}</Stat>
            <Stat label="Buys" tone="up">{w.buys[0]}<i>/</i>{w.buys[1]}</Stat>
            <Stat label="Sells" tone="down">{w.sells[0]}<i>/</i>{w.sells[1]}</Stat>
            <Stat label="Net Vol." tone={w.netUp ? 'up' : 'down'}>{w.net}</Stat>
          </div>
          <div className="th-split" aria-hidden>
            <span style={{ width: `${w.buyShare}%` }} />
          </div>

          {/*
            * ── THE WINDOWS, ON HOVER ───────────────────────────────
            *
            * The four readings above are ONE window — five minutes —
            * and the figure only means something against the others.
            * +45% over five minutes is a different fact depending on
            * whether the day is up 1000% or flat.
            *
            * So the other windows take the same box. Hovering the block
            * crossfades the readings out and these in: same place, same
            * size, nothing dropped below the bar.
            *
            * They are buttons: clicking one swaps the four readings to
            * that window. The one showing is marked by the TONE of its
            * label, not by a plate — the plate is the hover, and a cell
            * wearing both would say the pointer was on it.
            */}
          <div className="th-tf">
            {WINDOWS.map((it, i) => (
              <button
                type="button"
                className="th-tf-c"
                key={it.key}
                data-on={i === win ? '' : undefined}
                onClick={() => setWin(i)}
              >
                <b>{it.key}</b>
                <em>{it.change}</em>
              </button>
            ))}
          </div>
        </div>
      </header>
    </div>
  );
}

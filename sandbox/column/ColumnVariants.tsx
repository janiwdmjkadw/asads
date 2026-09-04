'use client';

/**
 * The column, remade from the reference.
 *
 * ── NO TOKEN ART ─────────────────────────────────────────────────────
 *
 * The 56px image is gone. Everything else about the reference row is
 * kept: ticker and name, age with its run of inline marks, the dev's
 * handle and what else they have shipped, four risk pills, volume over
 * market cap, the fee, and a one-press buy.
 *
 * The launchpad badge, the verified tick and the truncated mint were
 * welded to that image. They move onto the line that identifies the
 * token, which is where they belonged anyway — all three answer WHICH
 * token this is, and none of them was ever about the picture.
 *
 * Dropping the art takes 66px off the left of every row and lets the
 * whole thing sit two lines shorter, which on a lane holding twenty of
 * them is four more visible.
 *
 * ── WHERE IT STILL DIFFERS FROM THE REFERENCE ────────────────────────
 *
 * COLOUR IS SPENT ONLY ON RISK. The reference greens the age, the market
 * cap, the fee, the buy and all four pills — six unrelated things in one
 * hue, so being green stops meaning anything. Here the four pills keep
 * green and red because those are the only values where the COLOUR is
 * the reading: a 31% dev holding is not a large number, it is a bad one.
 *
 * THE BUY IS WHITE. It is the one press on the row and the only filled
 * thing on it, so it does not read as a fifth pill.
 */

import type { ColumnKind } from './kinds';
import './column.css';

interface Pill {
  readonly icon: string;
  readonly value: string;
  /** Trailing note — the reference's "1mo", "5mo", "1yr". */
  readonly note?: string;
  readonly bad?: boolean;
}

interface Coin {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly mint: string;
  readonly age: string;
  readonly holders: string;
  readonly comments: string;
  readonly bought: string;
  readonly watchers?: string;
  readonly dev?: string;
  readonly devTokens?: string;
  readonly devFollowers?: string;
  readonly vol: string;
  readonly mc: string;
  readonly fee: string;
  readonly pills: readonly Pill[];
  readonly launchpad: 'pump' | 'bonk';
  readonly verified?: boolean;
}

/* The pill glyphs, in the reference's order: dev holding, top-ten
   holding, snipers, insiders. */
const P = {
  dev: 'M12 3.5c-3 0-5 2-5 4.5 0 3 2.5 4 2.5 6.5h5c0-2.5 2.5-3.5 2.5-6.5 0-2.5-2-4.5-5-4.5zM9.5 18h5M10.5 20.5h3',
  top: 'M5 9.5h14l-1.5 9h-11zM5 9.5l2-4h10l2 4M9 13v2M15 13v2',
  snipe: 'M12 4v3M12 17v3M4 12h3M17 12h3M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  inside: 'M7 10.5V8a5 5 0 0110 0v2.5M5.5 10.5h13v9h-13z',
} as const;

const COINS: readonly Coin[] = [
  {
    id: 'c1', ticker: 'ABC', name: 'Alons Black Child', mint: 'Azk…pump', age: '1s',
    holders: '1', comments: '0', bought: '0/1',
    vol: '$21', mc: '$3.0K', fee: '0', launchpad: 'pump', verified: true,
    pills: [
      { icon: P.dev, value: '1%' },
      { icon: P.top, value: '1%', note: '1mo' },
      { icon: P.snipe, value: '0 · 0%' },
      { icon: P.inside, value: '1%' },
    ],
  },
  {
    id: 'c2', ticker: 'Pixelmoon', name: 'Pixel Moon', mint: 'pU7…pump', age: '3s',
    holders: '14', comments: '1', bought: '5/267', watchers: '1',
    vol: '$548', mc: '$3.5K', fee: '0.022', launchpad: 'pump', verified: true,
    pills: [
      { icon: P.dev, value: '9%' },
      { icon: P.top, value: '4%', note: '5mo' },
      { icon: P.snipe, value: '8 · 2%' },
      { icon: P.inside, value: '5%' },
    ],
  },
  {
    id: 'c3', ticker: 'hawt', name: 'hawtdog', mint: '6v4…pump', age: '4s',
    holders: '2', comments: '0', bought: '0/1', watchers: '1',
    dev: '@hawtdogluff', devTokens: '0', devFollowers: '0',
    vol: '$162', mc: '$3.1K', fee: '0', launchpad: 'pump', verified: true,
    pills: [
      { icon: P.dev, value: '5%' },
      { icon: P.top, value: '5%', note: '1m' },
      { icon: P.snipe, value: '0 · 0%' },
      { icon: P.inside, value: '5%', bad: true },
    ],
  },
  {
    id: 'c4', ticker: 'WAGMI', name: 'We Are All Gonna Make It', mint: 'EVY…pump', age: '7s',
    holders: '3', comments: '3', bought: '198/26,959', watchers: '12',
    dev: '@quantsdev1223', devTokens: '83', devFollowers: '2.41K',
    vol: '$6.3K', mc: '$3.1K', fee: '0.489', launchpad: 'bonk', verified: true,
    pills: [
      { icon: P.dev, value: '5%' },
      { icon: P.top, value: 'DS', note: '1yr' },
      { icon: P.snipe, value: '12 · 0%' },
      { icon: P.inside, value: '0%' },
    ],
  },
  {
    id: 'c5', ticker: 'DUCKS', name: 'DONALD DUCKS', mint: '7BE…pump', age: '10s',
    holders: '3', comments: '1', bought: '0/513', watchers: '2',
    dev: '@simoscan', devTokens: '317', devFollowers: '100',
    vol: '$146', mc: '$3.2K', fee: '0.00', launchpad: 'pump',
    pills: [
      { icon: P.dev, value: '5%' },
      { icon: P.top, value: '3%', note: '6mo' },
      { icon: P.snipe, value: '1 · 2%' },
      { icon: P.inside, value: '5%' },
    ],
  },
  {
    id: 'c6', ticker: 'PENNY', name: 'Penny Stonks and the very long tail', mint: '9wL…2mmj', age: '11s',
    holders: '1', comments: '0', bought: '0/1', watchers: '1',
    dev: '@pennystonks_', devTokens: '0', devFollowers: '1',
    vol: '$0', mc: '$3.0K', fee: '0', launchpad: 'bonk',
    pills: [
      { icon: P.dev, value: '0%' },
      { icon: P.top, value: 'DS', note: '14s' },
      { icon: P.snipe, value: '0 · 0%' },
      { icon: P.inside, value: '0%' },
    ],
  },
  {
    id: 'c7', ticker: 'PC', name: 'Photonic Computing', mint: '29v…pump', age: '14s',
    holders: '4', comments: '3', bought: '3/1,188', watchers: '3',
    dev: '@oliverodevvorrr', devTokens: '99', devFollowers: '69',
    vol: '$1.1K', mc: '$4.0K', fee: '0.049', launchpad: 'pump', verified: true,
    pills: [
      { icon: P.dev, value: '31%', bad: true },
      { icon: P.top, value: '12%', note: '2mo' },
      { icon: P.snipe, value: '4 · 9%', bad: true },
      { icon: P.inside, value: '2%' },
    ],
  },
];

/* ── atoms ──────────────────────────────────────────────────────────── */

function Glyph({ d, size = 11, weight = 1.9 }: { d: string; size?: number; weight?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const I = {
  link: 'M10 13.5a4 4 0 006 .5l2.5-2.5a4 4 0 00-5.7-5.7L11.5 7',
  find: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0',
  chat: 'M20.5 12c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.1-2.9-.4L4 20l1.2-3.3C4.1 15.4 3.5 13.8 3.5 12c0-3.6 3.8-6.5 8.5-6.5s8.5 2.9 8.5 6.5z',
  cup: 'M7 4h10v5a5 5 0 01-10 0zM12 14v4M8.5 20h7M17 5h2.5v2a3 3 0 01-3 3M7 5H4.5v2a3 3 0 003 3',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  bolt: 'M13 3L5.5 13.5H11l-1 7.5L18.5 10H13z',
  wave: 'M4 12h3l2-5 3 10 3-8 2 3h3',
  mute: 'M11 5L6.5 9H3v6h3.5L11 19zM16 9l4 6M20 9l-4 6',
  /*
   * A FUNNEL, not three stacked lines.
   *
   * The old glyph was a long line over a shorter one over a shorter one
   * — which is the mark for sliders, or for a list, or for a menu, and is
   * used for all three elsewhere in this product. A funnel means one
   * thing only: something goes in and less comes out.
   */
  filter: 'M3.5 5.5h17l-6.6 7.6v5.2l-3.8 2.2v-7.4z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  chart: 'M3 17l5.5-6 4 4L21 6M21 6h-4.5M21 6v4.5',
} as const;

/**
 * THE BOLT, FILLED.
 *
 * Every other mark in this head is a stroked outline, and the bolt was
 * too — an outlined lightning shape at 13px is a thin white wireframe
 * with a hole through the middle, which is why it read as grey no matter
 * what colour it was given. A bolt is a solid shape; filling it is what
 * makes it fully white.
 */
function BoltMark({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#ffffff" aria-hidden>
      <path d="M13 3L5.5 13.5H11l-1 7.5L18.5 10H13z" />
    </svg>
  );
}

/**
 * Solana, in the brand gradient. The head had it as a stroked glyph in
 * grey, which is a smudge beside a number rather than a unit on it.
 *
 * The gradient id is fixed rather than generated: every instance is the
 * identical fill, so duplicate ids all resolve to the first definition
 * and resolve to the right thing.
 */
function SolMark() {
  return (
    <svg className="cl-sol" viewBox="0 0 24 24" width="12" height="12" fill="url(#cl-sol-grad)" aria-hidden>
      <defs>
        <linearGradient id="cl-sol-grad" x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M4.6 16.4h13.9c.3 0 .5.1.7.3l2.4 2.5c.4.4.1 1-.4 1H7.3c-.3 0-.5-.1-.7-.3l-2.4-2.5c-.4-.4-.1-1 .4-1z" />
      <path d="M4.6 3.8h13.9c.3 0 .5.1.7.3l2.4 2.5c.4.4.1 1-.4 1H7.3c-.3 0-.5-.1-.7-.3L4.2 4.8c-.4-.4-.1-1 .4-1z" />
      <path d="M19.4 10.1H5.5c-.3 0-.5.1-.7.3l-2.4 2.5c-.4.4-.1 1 .4 1h13.9c.3 0 .5-.1.7-.3l2.4-2.5c.4-.4.1-1-.4-1z" />
    </svg>
  );
}

/** An icon and its number — the reference's whole vocabulary for metrics. */
function Mark({ d, value }: { d: string; value: string }) {
  return (
    <span className="cl-mark">
      <Glyph d={d} size={10} />
      {value}
    </span>
  );
}

function Row({ c }: { c: Coin }) {
  return (
    <div className="cl-row">
      <span className="cl-body">
        {/*
          * Ticker, name, and the three things that used to hang off the
          * art: which launchpad, whether it is verified, and the mint.
          * All three answer WHICH token this is, so they belong on the
          * line that names it.
          */}
        <span className="cl-line">
          <span className="cl-ticker">{c.ticker}</span>
          <span className="cl-name">{c.name}</span>
          <span className={`cl-pad is-${c.launchpad}`} aria-hidden />
          {c.verified ? (
            <span className="cl-tick" aria-hidden>
              <Glyph d="M5 12.5l4.5 4.5L19 7" size={7} weight={3.2} />
            </span>
          ) : null}
          <span className="cl-mint">{c.mint}</span>
        </span>

        {/*
          * THE RUN OF MARKS IS GONE.
          *
          * Seven icon-and-number pairs at 10px in grey — socials, holder
          * count, comments, a bought ratio, watchers, then the dev's two
          * counts. Nine values in a line you cannot read without leaning
          * in, on a row you are scanning twenty of. The reference gets
          * away with it because it is the densest surface it has; here it
          * was the only illegible thing on the row.
          *
          * What survives is the age and the dev, which are the two the
          * eye actually stops on. The rest belongs on the token's own
          * page, where there is room to label them.
          */}
        <span className="cl-marks">
          <span className="cl-age">{c.age}</span>
          {c.dev ? <span className="cl-dev">{c.dev}</span> : null}
        </span>

        {/*
         * The four risk percentages — the ONLY coloured values on the
         * row, because they are the only ones where the colour is the
         * reading.
         */}
        <span className="cl-pills">
          {c.pills.map((p, i) => (
            <span key={i} className={`cl-pill${p.bad ? ' is-bad' : ''}`}>
              <Glyph d={p.icon} size={10} />
              {p.value}
              {p.note ? <span className="cl-note">{p.note}</span> : null}
            </span>
          ))}
        </span>

      </span>

      {/* ── the figures, then the one press ── */}
      <span className="cl-right">
        <span className="cl-fig">
          <span className="cl-cap">V</span>
          <span className="cl-num">{c.vol}</span>
          <span className="cl-cap">MC</span>
          <span className="cl-num is-mc">{c.mc}</span>
        </span>
        <span className="cl-fig">
          <span className="cl-cap">F</span>
          <span className="cl-num">{c.fee}</span>
        </span>
        <button type="button" className="cl-buy">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden>
            <path d="M13 3L5.5 13.5H11l-1 7.5L18.5 10H13z" />
          </svg>
          2 SOL
        </button>
      </span>
    </div>
  );
}

export function ColumnLane({ kind }: { kind: ColumnKind }) {
  return (
    <div className={`cl is-${kind}`} data-kind="column-row">
      {/*
        * THE HEAD, COPIED.
        *
        * Four things differed from the reference and all four are fixed:
        *
        *  1 · The search is a PILL WITH A BORDER, not a filled plate. A
        *      fill makes it a block sitting in the head; an outline makes
        *      it a field cut into it.
        *  2 · It has NO magnifier and its placeholder is CENTRED. The
        *      word "Search" is the whole label, and an icon beside it is
        *      the same word twice.
        *  3 · The bordered group holds only TWO things — the buy size and
        *      the preset. Those are settings; the mute and the filter are
        *      actions, and the reference leaves them loose outside it.
        *  4 · The SOL mark beside the size is the real one, in its
        *      gradient. It was a stroked glyph in grey.
        */}
      <div className="cl-head">
        <span className="cl-title">New</span>
        <span className="cl-grow" />
        {/*
          * ONE SPACER, BEFORE THE SEARCH — not one either side.
          *
          * Two spacers centre the search in the head, which is not what
          * the reference does: the title sits hard left and EVERYTHING
          * else clusters at the right, search included. The only gap on
          * the row is between the title and that cluster.
          */}
        <label className="cl-search">
          <input placeholder="Search" spellCheck={false} />
        </label>

        <span className="cl-tools">
          {/*
            * THE BUY SIZE IS TYPED, NOT DISPLAYED.
            *
            * It was a static number, which makes the one setting you
            * change most often on this lane the one thing you cannot
            * touch. It is an input now — the bolt and the SOL mark sit
            * either side of it as the label and the unit, and the whole
            * thing stays a single control rather than becoming a form.
            *
            * `size={4}` rather than a width: the field grows with the
            * number, so `0` and `2.5` both sit tight against their unit
            * instead of leaving a gap that moves.
            */}
          {/*
            * NO BOLT.
            *
            * The SOL mark on the other side of the number is already the
            * unit, and the control sits in a group whose whole subject is
            * how this lane buys — so a lightning bolt in front of it was
            * saying "this is the buy amount" to a number that could not
            * be anything else.
            */}
          <span className="cl-tool is-field">
            <input
              className="cl-size"
              defaultValue="0"
              size={3}
              inputMode="decimal"
              spellCheck={false}
              aria-label="Quick buy amount in SOL"
            />
            <SolMark />
          </span>
          <span className="cl-toolrule" aria-hidden />
          <button type="button" className="cl-tool">
            P1
            <Glyph d={I.chart} size={13} />
          </button>
        </span>

        {/* Loose, as the reference has them: these do something rather
            than hold a setting. */}
        <button type="button" className="cl-loose" aria-label="Mute alerts">
          <Glyph d={I.mute} size={15} />
        </button>
        <button type="button" className="cl-loose" aria-label="Filters">
          <Glyph d={I.filter} size={15} />
        </button>
      </div>

      {/*
        * EMPTY ON PURPOSE.
        *
        * The rows are the settled part; the COLUMN is what is being
        * worked on — its head, its ground, its width, its scroll. A lane
        * full of tokens is seven objects arguing with whatever is being
        * decided about the thing holding them.
        *
        * `Row` and its fixtures are left in this file, unrendered, so
        * putting them back is one line.
        */}
      <div className="cl-list" />
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import './frens-header-variants.css';

/*
 * ── FRENS · THE HEADER ───────────────────────────────────────────────
 *
 * Every part stays: the name, the tagline, the two counts, the four
 * sort tabs, the four windows, the search. What changes is what the
 * colour is FOR.
 *
 * ── THE PAGE HAS THREE PALETTES AND NONE OF THEM IS A PERSON ─────────
 *
 * `LENS_COLOR` gives a hue to each SORT KEY — pnl green, calls pink,
 * win rate blue, volume amber. That is a hue for the button you last
 * pressed.
 *
 * `RANK_THEME` gives a hue to each PODIUM POSITION — first gold, second
 * blue, third pink. That is a hue for a slot, so a fren changes colour
 * when somebody overtakes them.
 *
 * `confetti(index)` gives a hue by ARRAY INDEX, which changes the
 * moment the board is sorted differently.
 *
 * So the same person is green on the board, gold on the podium and cyan
 * in the mosaic, and none of those is them. The colour looks good and
 * says nothing.
 *
 * ── ONE PALETTE, KEYED TO THE PERSON ─────────────────────────────────
 *
 * `frenInk` hashes the USER ID. A fren keeps their colour across the
 * board, the calls strip, the podium and the mosaic, for as long as
 * they exist — the way `inkForMint` keeps a token its colour on the
 * portfolio tape, and for the same reason: keyed on position it would
 * repaint every time a price moved.
 *
 * The cost, and it is the point: sort tabs and windows go MONOCHROME.
 * If colour means a person, it cannot also mean a control.
 *
 *   1  Roster    the mosaic becomes one tile per fren
 *   2  Pile      the frens themselves, as a row of marks
 *   3  Spectrum  one bar, each fren sized by their share of volume
 *   4  Quiet     no graphic; the counts carry the colour
 */

const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

/**
 * A fren's colour, from their id.
 *
 * Hashed rather than indexed so it survives a re-sort, a new fren
 * joining above them, and the board being filtered. It is the same
 * function `cutColors.ts` uses for tokens, for the same reason.
 */
function frenInk(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CONFETTI[((h % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

const FRENS = [
  { id: 'fren_1000', name: 'Soren', vol: 13674 },
  { id: 'fren_1001', name: 'aster', vol: 7267 },
  { id: 'fren_1002', name: 'brixby', vol: 4977 },
  { id: 'fren_1003', name: 'delune', vol: 3829 },
  { id: 'fren_1004', name: 'evren', vol: 3121 },
  { id: 'fren_1005', name: 'fenwick', vol: 2637 },
  { id: 'fren_1006', name: 'grigg', vol: 2304 },
  { id: 'fren_1007', name: 'halcy', vol: 2047 },
  { id: 'fren_1008', name: 'ibsen', vol: 1846 },
  { id: 'fren_1009', name: 'jorvik', vol: 1685 },
  { id: 'fren_1010', name: 'kessel', vol: 1553 },
  { id: 'fren_1011', name: 'lumen', vol: 1443 },
];

const TOTAL = FRENS.reduce((s, f) => s + f.vol, 0);

/* Every part of the header, restyled. Monochrome on purpose: the hues
   belong to people now. */
function Controls() {
  return (
    <div className="fh-controls">
      <div className="fh-sorts">
        {['PnL', 'Best calls', 'Win rate', 'Volume'].map((k, i) => (
          <button key={k} type="button" data-on={i === 0 ? '' : undefined}>
            {k}
          </button>
        ))}
      </div>
      <div className="fh-right">
        <div className="fh-win">
          {['1D', '7D', '30D', 'All'].map((w, i) => (
            <button key={w} type="button" data-on={i === 1 ? '' : undefined}>
              {w}
            </button>
          ))}
        </div>
        <input className="fh-search" placeholder="Search frens, coins, theses" spellCheck={false} />
      </div>
    </div>
  );
}

function Head({ children }: { children?: ReactNode }) {
  return (
    <div className="fh-head">
      <div>
        <h1>Frens</h1>
        <p>Best calls, real PnL, one click tracking. Find the people worth listening to.</p>
        <div className="fh-counts">
          <span>
            <b>12</b> frens on the board
          </span>
          <span>
            <b>5</b> scored calls
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="fh-slot">
      <div className="fh-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="fh-frame">{children}</div>
    </div>
  );
}

/* ── 1 ── ROSTER ──────────────────────────────────────────────────────
 * The mosaic was a decorative scatter of coloured tiles. It is twelve
 * tiles now, one per fren, each in that fren's own colour — the same
 * scatter, except it is the board. */
function Roster() {
  return (
    <div className="fh-roster" aria-hidden>
      {FRENS.map((f) => (
        <span key={f.id} style={{ background: frenInk(f.id) }} />
      ))}
    </div>
  );
}

/* ── 2 ── PILE ────────────────────────────────────────────────────────
 * The frens themselves: initials on their own colour, overlapped the
 * way a face pile is. The most literal answer to `who is on this
 * board`, and the only one where the header names anybody. */
function Pile() {
  return (
    <div className="fh-pile">
      {FRENS.slice(0, 8).map((f) => (
        <span key={f.id} style={{ color: frenInk(f.id) }} title={f.name}>
          {f.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      <em>+4</em>
    </div>
  );
}

/* ── 3 ── SPECTRUM ────────────────────────────────────────────────────
 * One bar, a segment per fren, each sized by their share of the board's
 * volume. The header stops being decoration entirely and becomes the
 * only place you can see the shape of the board at a glance.
 *
 * The risk is that at fifty frens it is a smear. */
function Spectrum() {
  return (
    <div className="fh-spectrum" aria-hidden>
      {FRENS.map((f) => (
        <span key={f.id} style={{ flex: f.vol / TOTAL, background: frenInk(f.id) }} />
      ))}
    </div>
  );
}

export function FrensHeaderVariants() {
  return (
    <div className="fh">
      <h2>FRENS · THE HEADER</h2>
      <p className="fh-note">
        Every part stays. What changes is what the colour is for. The page has three palettes today
        and none of them is a person: a hue per sort key, a hue per podium position, and a hue by
        array index. The same fren is green on the board, gold on the podium and cyan in the mosaic.
      </p>
      <p className="fh-note">
        `frenInk` hashes the user id instead, so a fren keeps their colour across the board, the
        calls, the podium and the header, the way a token keeps its colour on the portfolio tape.
        The cost is deliberate: the sort tabs and windows go monochrome, because if colour means a
        person it cannot also mean a control.
      </p>

      <div className="fh-stack">
        <Slot i={1} name="Roster" note="the mosaic becomes one tile per fren">
          <Head>
            <Roster />
          </Head>
          <Controls />
        </Slot>

        <Slot i={2} name="Pile" note="the frens themselves, as a row of marks">
          <Head>
            <Pile />
          </Head>
          <Controls />
        </Slot>

        <Slot i={3} name="Spectrum" note="one bar, each fren sized by their share of volume">
          <Head />
          <Spectrum />
          <Controls />
        </Slot>

        <Slot i={4} name="Quiet" note="no graphic; the counts carry the colour">
          <div className="fh-head">
            <div>
              <h1>Frens</h1>
              <p>Best calls, real PnL, one click tracking. Find the people worth listening to.</p>
              <div className="fh-counts fh-counts-lit">
                <span>
                  <i style={{ background: frenInk('fren_1000') }} />
                  <b>12</b> frens on the board
                </span>
                <span>
                  <i style={{ background: frenInk('fren_1003') }} />
                  <b>5</b> scored calls
                </span>
              </div>
            </div>
          </div>
          <Controls />
        </Slot>
      </div>
    </div>
  );
}

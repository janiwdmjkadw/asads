'use client';

import { useState, type ReactNode } from 'react';
import './roster-variants.css';

/*
 * ── FRENS · THE ROSTER, SIX WAYS ─────────────────────────────────────
 *
 * Roster landed: the decorative scatter of tiles became one tile per
 * fren in that fren's own colour, so the ornament turned into the
 * board. These are six versions of that object, all animated.
 *
 * ── HOW THE MOTION IS BUILT ──────────────────────────────────────────
 *
 * Every one of these animates `transform` and `opacity` ONLY. Both are
 * composited, so the grid never triggers layout or paint and a dozen
 * tiles moving at once cost nothing. Animating width, height, top or
 * background would re-lay the header out on every frame.
 *
 * There is no sound and nothing here can make one. The click the page
 * has now comes from the global sounds setting in the Tweaks panel, not
 * from this component.
 *
 * ── AND IT STOPS FOR PEOPLE WHO ASK IT TO ────────────────────────────
 *
 * Every loop is cut by `prefers-reduced-motion`. A header that breathes
 * forever is the exact thing that setting exists for, and it is a line
 * of CSS.
 *
 *   1  Cascade   they arrive one after another, once
 *   2  Breathe   a slow pulse, each tile on its own phase
 *   3  Drift     the original scatter, every tile on its own float
 *   4  Weight    sized by share of volume, and it re-sorts
 *   5  Bars      the bars from the old masthead, carrying the frens
 *   6  Wave      a light crosses the grid on a long loop
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

/** Hashed on the id, so a fren keeps their colour through a re-sort. */
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

/* ── 1 ── CASCADE ─────────────────────────────────────────────────────
 * They arrive one after another and then stop. An entrance rather than
 * a loop: it says `these are the frens` once, on load, and never asks
 * for attention again. */
function Cascade({ run }: { run: number }) {
  return (
    <div className="rv-grid" key={run} aria-hidden>
      {FRENS.map((f, i) => (
        <span
          key={f.id}
          className="rv-tile rv-in"
          style={{ background: frenInk(f.id), animationDelay: `${i * 55}ms` }}
        />
      ))}
    </div>
  );
}

/* ── 2 ── BREATHE ─────────────────────────────────────────────────────
 * A slow pulse, each tile on its own phase so the grid never blinks in
 * unison. Alive without moving — the only motion is opacity, so nothing
 * shifts position and the eye is not dragged to it. */
function Breathe() {
  return (
    <div className="rv-grid" aria-hidden>
      {FRENS.map((f, i) => (
        <span
          key={f.id}
          className="rv-tile rv-breathe"
          style={{ background: frenInk(f.id), animationDelay: `${(i * 370) % 2600}ms` }}
        />
      ))}
    </div>
  );
}

/* ── 3 ── DRIFT ───────────────────────────────────────────────────────
 * The original masthead's scatter — irregular sizes, irregular gaps —
 * with every tile floating on its own slow loop. Closest to what is
 * there now, except each mark is a person. */
const SCATTER = [
  { x: 0, y: 0, s: 16 }, { x: 22, y: 6, s: 10 }, { x: 38, y: 0, s: 13 },
  { x: 56, y: 9, s: 9 }, { x: 70, y: 2, s: 15 }, { x: 90, y: 8, s: 11 },
  { x: 6, y: 24, s: 11 }, { x: 26, y: 28, s: 15 }, { x: 46, y: 22, s: 9 },
  { x: 62, y: 30, s: 13 }, { x: 80, y: 24, s: 10 }, { x: 96, y: 30, s: 14 },
];

function Drift() {
  return (
    <div className="rv-scatter" aria-hidden>
      {FRENS.map((f, i) => {
        const p = SCATTER[i]!;
        return (
          <span
            key={f.id}
            className="rv-dot rv-float"
            style={{
              background: frenInk(f.id),
              left: `${p.x}%`,
              top: p.y,
              width: p.s,
              height: p.s,
              animationDelay: `${(i * 480) % 3800}ms`,
              animationDuration: `${5200 + (i % 4) * 900}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ── 4 ── WEIGHT ──────────────────────────────────────────────────────
 * Sized by share of the board's volume, so the header answers who is
 * actually moving size rather than just who exists. Press the control
 * and it re-sorts: the tiles travel to their new places rather than
 * cutting, which is the whole reason to animate a board at all.
 *
 * The travel is `transform` on a flex row, so nothing re-lays out. */
function Weight({ order }: { order: 'vol' | 'name' }) {
  const rows = order === 'vol' ? FRENS : [...FRENS].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="rv-weight" aria-hidden>
      {rows.map((f) => (
        <span
          key={f.id}
          className="rv-seg"
          style={{ flex: f.vol / TOTAL, background: frenInk(f.id) }}
        />
      ))}
    </div>
  );
}

/* ── 5 ── BARS ────────────────────────────────────────────────────────
 * The bars from the old masthead, which were pure decoration, carrying
 * the frens instead. Length is volume; they wipe out from the left on
 * arrival. */
function Bars({ run }: { run: number }) {
  return (
    <div className="rv-bars" key={run} aria-hidden>
      {FRENS.slice(0, 7).map((f, i) => (
        <span
          key={f.id}
          className="rv-bar"
          style={{
            background: frenInk(f.id),
            width: `${28 + (f.vol / FRENS[0]!.vol) * 72}%`,
            animationDelay: `${i * 70}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ── 6 ── WAVE ────────────────────────────────────────────────────────
 * A light crossing the grid on a long loop. The tiles never move and
 * never change colour; a highlight passes over them, which is the
 * quietest way to make a static object feel live. */
function Wave() {
  return (
    <div className="rv-grid rv-wave" aria-hidden>
      {FRENS.map((f, i) => (
        <span
          key={f.id}
          className="rv-tile rv-lit"
          style={{ background: frenInk(f.id), animationDelay: `${(i % 6) * 150 + Math.floor(i / 6) * 90}ms` }}
        />
      ))}
    </div>
  );
}

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="rv-slot">
      <div className="rv-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="rv-frame">
        <div className="rv-head">
          <div>
            <h1>Frens</h1>
            <p>Best calls, real PnL, one click tracking.</p>
            <div className="rv-counts">
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
      </div>
    </div>
  );
}

export function RosterVariants() {
  const [run, setRun] = useState(0);
  const [order, setOrder] = useState<'vol' | 'name'>('vol');

  return (
    <div className="rv">
      <div className="rv-top">
        <div>
          <h2>FRENS · THE ROSTER, SIX WAYS</h2>
          <p className="rv-note">
            One tile per fren, in that fren&apos;s own colour, animated. Everything moves on
            transform and opacity only, so the header never triggers layout and a dozen tiles cost
            nothing. Every loop is cut by `prefers-reduced-motion`. Nothing here makes a sound, and
            nothing here can — the click on the page now is the global sounds setting.
          </p>
        </div>
        <div className="rv-ctl">
          <button type="button" onClick={() => setRun((v) => v + 1)}>
            Replay entrances
          </button>
          <button type="button" onClick={() => setOrder((v) => (v === 'vol' ? 'name' : 'vol'))}>
            Re-sort Weight
          </button>
        </div>
      </div>

      <div className="rv-stack">
        <Slot i={1} name="Cascade" note="they arrive one after another, once">
          <Cascade run={run} />
        </Slot>
        <Slot i={2} name="Breathe" note="a slow pulse, each tile on its own phase">
          <Breathe />
        </Slot>
        <Slot i={3} name="Drift" note="the original scatter, every tile on its own float">
          <Drift />
        </Slot>
        <Slot i={4} name="Weight" note="sized by share of volume, and it re-sorts">
          <Weight order={order} />
        </Slot>
        <Slot i={5} name="Bars" note="the old masthead bars, carrying the frens">
          <Bars run={run} />
        </Slot>
        <Slot i={6} name="Wave" note="a light crosses the grid on a long loop">
          <Wave />
        </Slot>
      </div>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import './call-variants.css';

/*
 * ── FRENS · BEST CALLS, FIVE WAYS ────────────────────────────────────
 *
 * A horizontal scroller of cards. Each one is a fren, a token, a
 * percentage and a thesis in three clamped lines, with a coloured strip
 * along the top edge.
 *
 * ── WHAT IS WRONG WITH IT ────────────────────────────────────────────
 *
 * THE STRIP IS `confetti(index)`. A colour by array POSITION, so the
 * card's edge changes the moment the window or the sort changes. The
 * fren it belongs to already has a colour now; the card is wearing
 * somebody else's.
 *
 * THE PERCENTAGE IS THE POINT AND IS SET AT 13px. `+95%` is why anybody
 * reads the card and it is the same size as the handle above it.
 *
 * THE THESIS IS CLAMPED TO THREE LINES on a card 250px wide, which is
 * where a sentence goes to be truncated. It is also the only thing on
 * this page a person actually WROTE, and everything else here is
 * generated.
 *
 * ── THE FIVE ─────────────────────────────────────────────────────────
 *
 *   1  Now      what ships, with the fren's real colour on it
 *   2  Figure   the percentage leads at display size
 *   3  Quote    the thesis is the card; it is the only written thing
 *   4  Row      not cards; a list that does not need a scroller
 *   5  Ticket   the token leads, because a call is about a coin
 */

const CONFETTI = ['#37d67a', '#3b82f6', '#38bdf8', '#f052d2', '#fbbf24', '#22d3ee', '#8b5cf6', '#7ce85e'] as const;

function frenInk(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CONFETTI[((h % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

interface Call {
  readonly id: string;
  readonly who: string;
  readonly ticker: string;
  readonly pct: number;
  readonly age: string;
  readonly thesis: string;
}

const CALLS: ReadonlyArray<Call> = [
  { id: 'fren_1000', who: 'Soren', ticker: 'BONK', pct: 95.4, age: '2h', thesis: 'Supply is tight and the dev wallet has not moved in three weeks.' },
  { id: 'fren_1001', who: 'aster', ticker: 'WIF', pct: 53.9, age: '11h', thesis: 'Every dip since launch has been bought inside an hour.' },
  { id: 'fren_1002', who: 'brixby', ticker: 'POPCAT', pct: 38.1, age: '20h', thesis: 'Holder count is up and the top ten is flat. That is real distribution.' },
  { id: 'fren_1003', who: 'delune', ticker: 'MEW', pct: 29.5, age: '1d', thesis: 'It survived a 40% drawdown without the book thinning. That matters.' },
  { id: 'fren_1004', who: 'evren', ticker: 'PONKE', pct: 23.4, age: '2d', thesis: 'Liquidity doubled overnight and nobody is talking about it yet.' },
];

const initials = (n: string) => n.slice(0, 2).toUpperCase();

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="cv-slot">
      <div className="cv-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="cv-frame">
        <div className="cv-sec">Best calls, 7 days</div>
        {children}
      </div>
    </div>
  );
}

/* ── 1 ── NOW ─────────────────────────────────────────────────────────
 * What ships, with one thing corrected: the strip is the FREN's colour
 * instead of the array index, so a card stops changing edge when the
 * list is re-sorted. */
function Now() {
  return (
    <div className="cv-scroll">
      {CALLS.map((c) => (
        <button type="button" className="cv-card" key={c.id} style={{ ['--fc' as string]: frenInk(c.id) }}>
          <span className="cv-edge" aria-hidden />
          <div className="cv-head">
            <span className="cv-av" style={{ background: frenInk(c.id) }}>
              {initials(c.who)}
            </span>
            <span className="cv-who">@{c.who}</span>
            <span className="cv-pct">+{c.pct.toFixed(0)}%</span>
          </div>
          <p className="cv-thesis">{c.thesis}</p>
          <div className="cv-foot">
            ${c.ticker} · called {c.age} ago · to ATH
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── 2 ── FIGURE ──────────────────────────────────────────────────────
 * The percentage is why anybody reads the card, so it is set at the
 * size that says so. Everything else steps back to caption weight.
 *
 * The gain keeps the product's up green rather than the fren's colour:
 * a number that went up is green everywhere else in here, and that
 * meaning outranks identity on a figure. */
function Figure() {
  return (
    <div className="cv-scroll">
      {CALLS.map((c) => (
        <button type="button" className="cv-card cv-card-fig" key={c.id}>
          <span className="cv-big">+{c.pct.toFixed(0)}%</span>
          <div className="cv-head">
            <span className="cv-av cv-av-sm" style={{ background: frenInk(c.id) }}>
              {initials(c.who)}
            </span>
            <span className="cv-who">@{c.who}</span>
            <span className="cv-tick">${c.ticker}</span>
          </div>
          <p className="cv-thesis cv-thesis-sm">{c.thesis}</p>
        </button>
      ))}
    </div>
  );
}

/* ── 3 ── QUOTE ───────────────────────────────────────────────────────
 * The thesis is the only thing on this entire page a person actually
 * wrote — every other figure is generated — and it was clamped to three
 * lines in a 250px box. Here it is the card, set at reading size, with
 * the attribution under it the way a quotation is attributed. */
function Quote() {
  return (
    <div className="cv-quotes">
      {CALLS.slice(0, 3).map((c) => (
        <button type="button" className="cv-quote" key={c.id}>
          <p>{c.thesis}</p>
          <div className="cv-by">
            <span className="cv-av cv-av-sm" style={{ background: frenInk(c.id) }}>
              {initials(c.who)}
            </span>
            <span className="cv-who">@{c.who}</span>
            <span className="cv-dim">
              ${c.ticker} · {c.age} ago
            </span>
            <span className="cv-pct">+{c.pct.toFixed(0)}%</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── 4 ── ROW ─────────────────────────────────────────────────────────
 * Not cards at all. A horizontal scroller hides everything past the
 * third card behind a gesture nobody performs; a list shows five in
 * less height and needs no scroller. The thesis gets one line, which is
 * honest about being a preview rather than pretending to be the whole
 * thing. */
function Row() {
  return (
    <div className="cv-rows">
      {CALLS.map((c) => (
        <button type="button" className="cv-row" key={c.id}>
          <span className="cv-av cv-av-sm" style={{ background: frenInk(c.id) }}>
            {initials(c.who)}
          </span>
          <span className="cv-who">@{c.who}</span>
          <span className="cv-tick">${c.ticker}</span>
          <span className="cv-line">{c.thesis}</span>
          <span className="cv-dim">{c.age}</span>
          <span className="cv-pct">+{c.pct.toFixed(0)}%</span>
        </button>
      ))}
    </div>
  );
}

/* ── 5 ── TICKET ──────────────────────────────────────────────────────
 * The token leads, because a call is about a coin before it is about a
 * person. Closest to how the rest of the terminal presents a position,
 * and the only one where you could scan the strip for a ticker you
 * already hold. */
function Ticket() {
  return (
    <div className="cv-scroll">
      {CALLS.map((c) => (
        <button type="button" className="cv-card cv-card-tk" key={c.id}>
          <div className="cv-tk-head">
            <span className="cv-coin" aria-hidden>
              {c.ticker.slice(0, 1)}
            </span>
            <div>
              <div className="cv-tk-n">${c.ticker}</div>
              <div className="cv-dim">{c.age} ago · to ATH</div>
            </div>
            <span className="cv-pct cv-pct-lg">+{c.pct.toFixed(0)}%</span>
          </div>
          <p className="cv-thesis cv-thesis-sm">{c.thesis}</p>
          <div className="cv-by">
            <span className="cv-av cv-av-sm" style={{ background: frenInk(c.id) }}>
              {initials(c.who)}
            </span>
            <span className="cv-who">@{c.who}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function CallVariants() {
  return (
    <div className="cv">
      <h2>FRENS · BEST CALLS, FIVE WAYS</h2>
      <p className="cv-note">
        Three faults in what ships. The card&apos;s top strip is coloured by ARRAY POSITION, so it
        changes when the window or sort changes and the fren it belongs to is wearing somebody
        else&apos;s colour. The percentage is why anybody reads the card and is set at 13px, the same
        as the handle above it. And the thesis is clamped to three lines in a 250px box, when it is
        the only thing on this page a person actually wrote.
      </p>
      <p className="cv-note">
        Every card below uses the fren&apos;s own colour. The gain stays the product&apos;s up green
        rather than taking it: a number that went up is green everywhere else in here, and on a
        figure that meaning outranks identity.
      </p>

      <div className="cv-stack">
        <Slot i={1} name="Now" note="what ships, with the fren's real colour on it">
          <Now />
        </Slot>
        <Slot i={2} name="Figure" note="the percentage leads at display size">
          <Figure />
        </Slot>
        <Slot i={3} name="Quote" note="the thesis is the card">
          <Quote />
        </Slot>
        <Slot i={4} name="Row" note="not cards; a list that needs no scroller">
          <Row />
        </Slot>
        <Slot i={5} name="Ticket" note="the token leads, because a call is about a coin">
          <Ticket />
        </Slot>
      </div>
    </div>
  );
}

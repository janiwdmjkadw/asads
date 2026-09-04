'use client';

import type { ReactNode } from 'react';
import './call-card-variants.css';

/*
 * ── FRENS · THE CALL CARD, FOUR WAYS ─────────────────────────────────
 *
 * What opens when you click a call. Two lead with a chart and two do
 * not, because the open question is whether the chart is carrying the
 * card or only filling it.
 *
 * ── WHAT A CALL ACTUALLY IS ──────────────────────────────────────────
 *
 * Four market caps and nothing else:
 *
 *   CALLED    what it was worth when they said so
 *   PEAK      the best it ever got
 *   SOLD      where they got out, if they did
 *   NOW       what it is worth today
 *
 * Every figure on this card is one of those four or a ratio between
 * two of them. `12x` is peak over called. The badge is which of the
 * four beat which:
 *
 *   holding      never sold, and it is still up
 *   banger       sold near the peak
 *   semi fumble  sold on the way up and left most of it behind
 *   fumble       sold near the bottom after a run
 *   loss         it never worked
 *
 * That is the story the card has to tell, and the version that ships
 * tells it with one figure and a word.
 *
 * ── WHAT IS THERE NOW ────────────────────────────────────────────────
 *
 * A rainbow gradient bar across the top, a `Holding` pill, an empty
 * chart box captioned `No chart data yet`, the multiple at display
 * size, a `CALL → ATH · still holding` line, and a `listen /
 * listen.money` plate along the bottom edge — a watermark on a card
 * only signed in users can open.
 *
 *   1  Ladder   the four caps as a vertical scale; no chart
 *   2  Arc      the chart leads, the caps mark it
 *   3  Ledger   the four caps as figures, the way spot reads
 *   4  Story    one sentence, and the numbers under it
 */

const INK = '#f052d2';

interface Call {
  readonly who: string;
  readonly ticker: string;
  readonly thesis: string;
  readonly called: number;
  readonly peak: number;
  readonly now: number;
  readonly sold: number | null;
  readonly badge: 'holding' | 'banger' | 'semi_fumble' | 'fumble' | 'loss';
  readonly age: string;
}

const CALL: Call = {
  who: 'Soren',
  ticker: 'BONK',
  thesis: 'Supply is tight and the dev wallet has not moved in three weeks.',
  called: 210_000,
  peak: 2_610_000,
  now: 2_410_000,
  sold: null,
  badge: 'holding',
  age: '14h',
};

const SOLD_CALL: Call = {
  who: 'brixby',
  ticker: 'POPCAT',
  thesis: 'Holder count is up and the top ten is flat. That is real distribution.',
  called: 480_000,
  peak: 3_810_000,
  now: 2_240_000,
  sold: 1_150_000,
  badge: 'semi_fumble',
  age: '18h',
};

const BADGE: Record<Call['badge'], string> = {
  holding: 'Still holding',
  banger: 'Sold near the top',
  semi_fumble: 'Sold early',
  fumble: 'Sold low',
  loss: 'Never worked',
};

const mc = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);
const mult = (a: number, b: number) => {
  const m = a / b;
  return m >= 10 ? `${Math.round(m)}x` : `${m.toFixed(1)}x`;
};

/* A price line drawn from the call's OWN four caps rather than fetched.
   The ingestion API is not wired here, and a card cannot be judged with
   an empty box where its largest element goes. */
function line(c: Call): string {
  const pts = [c.called, c.called * 1.4, c.peak * 0.62, c.peak, c.peak * 0.78, c.now];
  const hi = Math.max(...pts);
  const lo = Math.min(...pts) * 0.86;
  const w = 300;
  const h = 84;
  const xy = pts.map((p, i) => [
    (i / (pts.length - 1)) * w,
    h - ((p - lo) / (hi - lo)) * h,
  ]);
  let d = `M ${xy[0]![0]} ${xy[0]![1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i += 1) {
    const [px, py] = xy[i - 1]!;
    const [x, y] = xy[i]!;
    d += ` C ${(px + (x - px) / 2).toFixed(1)} ${py.toFixed(1)}, ${(px + (x - px) / 2).toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function Head({ c }: { c: Call }) {
  return (
    <div className="cc-head">
      <span className="cc-av" style={{ background: INK }}>
        {c.who.slice(0, 2).toUpperCase()}
      </span>
      <div>
        <div className="cc-who">@{c.who}</div>
        <div className="cc-when">
          called {c.age} ago · ${c.ticker}
        </div>
      </div>
      <span className="cc-badge">{BADGE[c.badge]}</span>
    </div>
  );
}

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="cc-slot">
      <div className="cc-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="cc-stage">{children}</div>
    </div>
  );
}

/* ── 1 ── LADDER · no chart ───────────────────────────────────────────
 * The four caps on one vertical scale, in the order they happened. It
 * is the only version where you can see the SHAPE of the call — how far
 * it ran, and how much of the run they kept — without a price line.
 *
 * Where they sold sits between called and peak, which is the entire
 * argument of the badge, drawn. */
function Ladder({ c }: { c: Call }) {
  const hi = c.peak;
  const at = (v: number) => `${(1 - v / hi) * 100}%`;
  return (
    <div className="cc-card">
      <Head c={c} />
      <p className="cc-thesis">{c.thesis}</p>

      <div className="cc-ladder">
        <div className="cc-rail" aria-hidden>
          <span className="cc-rail-fill" style={{ top: at(c.peak), bottom: `${(c.called / hi) * 100}%` }} />
        </div>
        <div className="cc-marks">
          <span style={{ top: at(c.peak) }}>
            <i>Peak</i>
            <b>{mc(c.peak)}</b>
            <u>{mult(c.peak, c.called)}</u>
          </span>
          <span style={{ top: at(c.now) }}>
            <i>Now</i>
            <b>{mc(c.now)}</b>
            <u>{mult(c.now, c.called)}</u>
          </span>
          {c.sold ? (
            <span style={{ top: at(c.sold) }}>
              <i>Sold</i>
              <b>{mc(c.sold)}</b>
              <u>{mult(c.sold, c.called)}</u>
            </span>
          ) : null}
          <span style={{ top: at(c.called) }}>
            <i>Called</i>
            <b>{mc(c.called)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 2 ── ARC · the chart leads ───────────────────────────────────────
 * The price line at the top with the call and the peak marked on it.
 * Drawn from the call's own caps rather than fetched, so the card is
 * never an empty box.
 *
 * The argument for it: a call is a bet on a shape, and this is the only
 * version that shows the shape. The argument against: it is the only
 * version that needs data the card does not already have. */
function Arc({ c }: { c: Call }) {
  return (
    <div className="cc-card">
      <div className="cc-chart">
        <svg viewBox="0 0 300 84" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="cc-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK} stopOpacity="0.22" />
              <stop offset="100%" stopColor={INK} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line(c)} L 300 84 L 0 84 Z`} fill="url(#cc-fade)" />
          <path d={line(c)} fill="none" stroke={INK} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="cc-chart-a">Called {mc(c.called)}</span>
        <span className="cc-chart-b">Peak {mc(c.peak)}</span>
      </div>
      <Head c={c} />
      <p className="cc-thesis">{c.thesis}</p>
      <div className="cc-figs">
        <span>
          <i>Peak</i>
          <b>{mult(c.peak, c.called)}</b>
        </span>
        <span>
          <i>Now</i>
          <b>{mult(c.now, c.called)}</b>
        </span>
        <span>
          <i>{c.sold ? 'They sold at' : 'Still in'}</i>
          <b>{c.sold ? mult(c.sold, c.called) : '—'}</b>
        </span>
      </div>
    </div>
  );
}

/* ── 3 ── LEDGER · no chart ───────────────────────────────────────────
 * The four caps as four figures, read the way the spot tab reads. The
 * quietest of the four and the only one that would render identically
 * whether the chart API is up or not. */
function Ledger({ c }: { c: Call }) {
  return (
    <div className="cc-card">
      <Head c={c} />
      <div className="cc-big">
        {mult(c.peak, c.called)}
        <span className="cc-big-u">at its peak</span>
      </div>
      <p className="cc-thesis">{c.thesis}</p>
      <div className="cc-figs cc-figs-4">
        <span>
          <i>Called at</i>
          <b>{mc(c.called)}</b>
        </span>
        <span>
          <i>Peak</i>
          <b>{mc(c.peak)}</b>
        </span>
        <span>
          <i>{c.sold ? 'Sold at' : 'Sold'}</i>
          <b>{c.sold ? mc(c.sold) : 'Never'}</b>
        </span>
        <span>
          <i>Now</i>
          <b>{mc(c.now)}</b>
        </span>
      </div>
    </div>
  );
}

/* ── 4 ── STORY · the chart supports ──────────────────────────────────
 * One sentence saying what happened, in words, with the figures under
 * it and a small line behind. The badge stops being a pill and becomes
 * the actual claim: `sold at 2.4x and it went to 7.9x` is the fumble,
 * stated. */
function Story({ c }: { c: Call }) {
  const said = c.sold
    ? `Called it at ${mc(c.called)}. It ran to ${mc(c.peak)}, and they sold at ${mc(c.sold)} — ${mult(c.sold, c.called)} of a ${mult(c.peak, c.called)} move.`
    : `Called it at ${mc(c.called)}. It ran to ${mc(c.peak)} and they never sold.`;
  return (
    <div className="cc-card">
      <Head c={c} />
      <p className="cc-said">{said}</p>
      <div className="cc-spark" aria-hidden>
        <svg viewBox="0 0 300 84" preserveAspectRatio="none">
          <path d={line(c)} fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <p className="cc-thesis cc-thesis-q">“{c.thesis}”</p>
    </div>
  );
}

export function CallCardVariants() {
  return (
    <div className="cc">
      <h2>FRENS · THE CALL CARD, FOUR WAYS</h2>
      <p className="cc-note">
        A call is four market caps and nothing else: what it was worth when they said so, the best
        it ever got, where they sold if they did, and what it is worth now. Every figure on the card
        is one of those or a ratio between two. The badge is just which beat which. Two of these
        lead with a chart and two have none, because the open question is whether the chart carries
        the card or only fills it.
      </p>
      <p className="cc-note">
        The lines are drawn from the call&apos;s own caps rather than fetched. The ingestion API is
        not wired in the sandbox, and a card cannot be judged with an empty box where its largest
        element goes.
      </p>

      <div className="cc-stack">
        <Slot i={1} name="Ladder" note="the four caps on one scale; no chart">
          <Ladder c={CALL} />
          <Ladder c={SOLD_CALL} />
        </Slot>
        <Slot i={2} name="Arc" note="the chart leads, the caps mark it">
          <Arc c={CALL} />
          <Arc c={SOLD_CALL} />
        </Slot>
        <Slot i={3} name="Ledger" note="four figures, the way spot reads; no chart">
          <Ledger c={CALL} />
          <Ledger c={SOLD_CALL} />
        </Slot>
        <Slot i={4} name="Story" note="one sentence, and a line behind it">
          <Story c={CALL} />
          <Story c={SOLD_CALL} />
        </Slot>
      </div>
    </div>
  );
}

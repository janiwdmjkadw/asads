'use client';

/*
 * CONDITIONALS, FOUR WAYS. SECOND SET.
 *
 * The first set was four arrangements of the same quiet text, and one of
 * them reached for a serif the terminal does not use. These are one
 * family only, Geist, the app's own, and each is built around a
 * different thing being the loudest thing on the page:
 *
 *   1 Clock   — the life of the play, drawn. Born, fired, time left.
 *   2 Hinge   — when on one side, then on the other. Grammar as layout.
 *   3 Result  — the number at display size, the play as its caption.
 *   4 Blotter — one line each, nothing wraps, the whole book on a screen.
 *
 * Black ground, no fills, no boxes, colour only on a gain or a loss.
 */

import type { ReactElement } from 'react';
import { Solana } from '@/components/listen/icons/Icons';

// ───────────────────────── the plays ─────────────────────────

export type State = 'watching' | 'paused' | 'cancelling' | 'done' | 'expired' | 'failed';

export interface Play {
  readonly id: string;
  readonly sym: string;
  readonly when: string;
  readonly then: string;
  readonly state: State;
  readonly note?: string;
  readonly net?: number;
  readonly pct?: number;
  /** How far through its life, 0 to 1. */
  readonly life: number;
  /** Where the fires landed on that life. */
  readonly fires: readonly number[];
  readonly left: string;
  readonly at: string;
}

export const PLAYS: readonly Play[] = [
  { id: 'a', sym: 'BONK', when: 'Every time BONK falls 15% in an hour', then: 'buy 2 SOL', state: 'watching', note: 'Fired twice, one still open', net: 0.86, pct: 21.5, life: 0.34, fires: [0.11, 0.27], left: '2 days left', at: '19:00' },
  { id: 'b', sym: 'WIF', when: 'When WIF crosses $2.40', then: 'sell half the position', state: 'watching', note: 'Waiting on the first fire', life: 0.18, fires: [], left: '5 days left', at: '04:00' },
  { id: 'c', sym: 'MEW', when: 'When MEW liquidity doubles', then: 'buy 1.5 SOL', state: 'watching', note: 'Catching up', life: 0.62, fires: [], left: '1 day left', at: '22:20' },
  { id: 'd', sym: 'POPCAT', when: 'If the POPCAT team ships the promised burn', then: 'buy 3 SOL', state: 'watching', note: '41 judged, no match yet', life: 0.15, fires: [], left: '10 days left', at: '23:00' },
  { id: 'e', sym: 'PONKE', when: 'Every 10% dip on PONKE', then: 'buy 5 SOL', state: 'paused', note: 'Needs 5.02 SOL, the wallet holds 1.86', net: -2.6, pct: -17.3, life: 0.27, fires: [0.06, 0.14, 0.22], left: '8 days left', at: '23:00' },
  { id: 'f', sym: 'GOAT', when: 'If GOAT drops below $1.80', then: 'sell everything', state: 'paused', note: 'The sell failed five times', life: 0.55, fires: [], left: '3 days left', at: '23:00' },
  { id: 'g', sym: 'BONK', when: 'When BONK reclaims $0.000042', then: 'buy 4 SOL', state: 'cancelling', note: 'Stopping now', life: 0.35, fires: [], left: '4 days left', at: '21:00' },
  { id: 'h', sym: 'WIF', when: 'When WIF hit $1.90', then: 'buy 3 SOL', state: 'done', note: 'Fired once, every run settled', net: 4.42, pct: 147.3, life: 1, fires: [0.72], left: 'Ended 27 Aug', at: '23:00' },
  { id: 'i', sym: 'PONKE', when: 'When PONKE crossed $0.60', then: 'buy 6 SOL', state: 'failed', note: 'Fired once, then the buy failed', net: -6, pct: -100, life: 1, fires: [0.4], left: 'Failed 26 Aug', at: '23:00' },
  { id: 'j', sym: 'GOAT', when: 'Every 5% dip on GOAT', then: 'buy 1 SOL', state: 'expired', note: 'Fired 4 times, then ran out', net: -0.88, pct: -22, life: 1, fires: [0.2, 0.38, 0.55, 0.81], left: 'Ran out 24 Aug', at: '23:00' },
];

export const WORD: Readonly<Record<State, string>> = {
  watching: 'Watching',
  paused: 'Paused',
  cancelling: 'Stopping',
  done: 'Done',
  expired: 'Expired',
  failed: 'Failed',
};

const LIVE: readonly State[] = ['watching', 'paused', 'cancelling'];
export const isLive = (p: Play) => LIVE.includes(p.state);

// ───────────────────────── shared bits ─────────────────────────

export function Net({ net, pct, size = 13 }: { readonly net: number; readonly pct?: number; readonly size?: number }): ReactElement {
  const up = net >= 0;
  return (
    <span className="cv-net" style={{ color: up ? 'var(--up)' : 'var(--down)', fontSize: size }}>
      {up ? '+' : '−'}
      {Math.abs(net).toFixed(2)}
      <Solana style={{ width: size * 0.6, height: size * 0.6, marginLeft: size * 0.22, marginRight: pct === undefined ? 0 : size * 0.34 }} />
      {pct === undefined ? null : (
        <em>
          {up ? '+' : '−'}
          {Math.abs(pct).toFixed(1)}%
        </em>
      )}
    </span>
  );
}

/** Figures picked out of a clause so the sentence has a spine. */
export function Say({ text, sym }: { readonly text: string; readonly sym: string }): ReactElement {
  const parts = text.split(new RegExp('(' + sym + '|\\$?[\\d.]+%?(?: SOL)?)', 'g'));
  return (
    <>
      {parts.map((part, i) => {
        if (part === sym) return <b key={i}>{part}</b>;
        if (/\d/.test(part) && /^\$?[\d.]+%?( SOL)?$/.test(part)) return <i key={i}>{part}</i>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function Tabs(): ReactElement {
  return (
    <div className="cv-tabs">
      {['Active', 'History', 'Expired', 'Failed'].map((t) => (
        <button key={t} type="button" className={t === 'Active' ? 'is-on' : undefined}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── 1 · CLOCK ─────────────────────────
/*
 * A conditional is a thing WAITING, and nothing else in the app has to
 * draw that. Each play gets a track for its whole life: solid to now,
 * hollow for the time it has left, a mark for every time it fired. Read
 * the column of tracks and you know which plays are nearly out of road
 * without reading a word.
 */
function Clock(): ReactElement {
  return (
    <section className="cv-clk">
      {PLAYS.map((p) => (
        <article key={p.id} className={isLive(p) ? 'cv-clk-r' : 'cv-clk-r is-past'} data-s={p.state}>
          <div className="cv-clk-head">
            <p className="cv-clk-say">
              <Say text={p.when} sym={p.sym} />
              <span>, </span>
              <Say text={p.then} sym={p.sym} />
              <span>.</span>
            </p>
            {p.net === undefined ? null : <Net net={p.net} pct={p.pct} size={14} />}
          </div>

          <div className="cv-clk-track">
            <span className="cv-clk-run" style={{ width: (p.life * 100).toFixed(2) + '%' }} />
            {p.fires.map((f, i) => (
              <span key={i} className="cv-clk-fire" style={{ left: (f * 100).toFixed(2) + '%' }} />
            ))}
            {isLive(p) ? <span className="cv-clk-now" style={{ left: (p.life * 100).toFixed(2) + '%' }} /> : null}
          </div>

          <p className="cv-clk-sub">
            <span className="cv-clk-st">{WORD[p.state]}</span>
            {p.note === undefined ? null : <span>{p.note}</span>}
            <span className="cv-clk-left">{p.left}</span>
          </p>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── 2 · HINGE ─────────────────────────
/*
 * A play is a condition and a consequence, so the row is two halves with
 * the hinge drawn between them: the trigger on the left, what it does on
 * the right, one column of marks down the middle holding them apart.
 */
function Hinge(): ReactElement {
  return (
    <section className="cv-hng">
      <header className="cv-hng-h">
        <span>When</span>
        <span />
        <span>Then</span>
        <span>Result</span>
      </header>
      {PLAYS.map((p) => (
        <article key={p.id} className={isLive(p) ? 'cv-hng-r' : 'cv-hng-r is-past'} data-s={p.state}>
          <div className="cv-hng-when">
            <p>
              <Say text={p.when} sym={p.sym} />
            </p>
            <small>{WORD[p.state]}</small>
          </div>
          <span className="cv-hng-pin" />
          <div className="cv-hng-then">
            <p>
              <Say text={p.then} sym={p.sym} />
            </p>
            {p.note === undefined ? null : <small>{p.note}</small>}
          </div>
          <div className="cv-hng-res">
            {p.net === undefined ? <span className="cv-hng-wait">{p.left}</span> : <Net net={p.net} pct={p.pct} size={13.5} />}
          </div>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── 3 · RESULT ─────────────────────────
/*
 * The number first, at a size nothing else on the page reaches, and the
 * play demoted to its caption. A play that has not paid yet says so at
 * the same size, so the column reads as one run of figures rather than a
 * list with numbers in it.
 */
function Result(): ReactElement {
  return (
    <section className="cv-res">
      {PLAYS.map((p) => (
        <article key={p.id} className={isLive(p) ? 'cv-res-r' : 'cv-res-r is-past'}>
          <div className="cv-res-fig">
            {p.net === undefined ? (
              <span className="cv-res-none">Nothing yet</span>
            ) : (
              <>
                <Net net={p.net} size={30} />
                {p.pct === undefined ? null : (
                  <span className="cv-res-pct" style={{ color: p.net >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {p.net >= 0 ? '+' : '−'}
                    {Math.abs(p.pct).toFixed(1)}%
                  </span>
                )}
              </>
            )}
          </div>
          <div className="cv-res-body">
            <p className="cv-res-say">
              <Say text={p.when} sym={p.sym} />
              <span>, </span>
              <Say text={p.then} sym={p.sym} />
              <span>.</span>
            </p>
            <p className="cv-res-sub">
              <span>{WORD[p.state]}</span>
              {p.note === undefined ? null : <span>{p.note}</span>}
              <span>{p.left}</span>
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── 4 · BLOTTER ─────────────────────────
/*
 * One line per play and nothing wraps, ever. Tight rows, one set of
 * columns, the whole book on one screen. The opposite of the Clock: for
 * somebody with forty plays running who wants the shape of the book
 * rather than the story of any one play.
 */
function Blotter(): ReactElement {
  return (
    <section className="cv-blt">
      <header className="cv-blt-h">
        <span>At</span>
        <span>Token</span>
        <span>When</span>
        <span>Then</span>
        <span>State</span>
        <span>Left</span>
        <span>Result</span>
      </header>
      {PLAYS.map((p) => (
        <article key={p.id} className={isLive(p) ? 'cv-blt-r' : 'cv-blt-r is-past'} data-s={p.state}>
          <span className="cv-blt-at">{p.at}</span>
          <span className="cv-blt-sym">{p.sym}</span>
          <span className="cv-blt-when">
            <Say text={p.when} sym={p.sym} />
          </span>
          <span className="cv-blt-then">
            <Say text={p.then} sym={p.sym} />
          </span>
          <span className="cv-blt-st">{WORD[p.state]}</span>
          <span className="cv-blt-left">{p.left}</span>
          <span className="cv-blt-net">{p.net === undefined ? <em>—</em> : <Net net={p.net} pct={p.pct} size={12.5} />}</span>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── the sheet ─────────────────────────

const NOTES: Readonly<Record<string, string>> = {
  Clock: 'The life of each play, drawn. Solid to now, hollow for the time it has left, a mark for every fire.',
  Hinge: 'When on one side, then on the other, the hinge down the middle.',
  Result: 'The number at display size, the play as its caption.',
  Blotter: 'One line each, nothing wraps, the whole book on a screen.',
};

export function CondVariants(): ReactElement {
  const sheets: ReadonlyArray<readonly [string, string, ReactElement]> = [
    ['1', 'Clock', <Clock key="1" />],
    ['2', 'Hinge', <Hinge key="2" />],
    ['3', 'Result', <Result key="3" />],
    ['4', 'Blotter', <Blotter key="4" />],
  ];
  return (
    <div className="cv">
      <style>{SHEET}</style>
      {sheets.map(([n, name, node]) => (
        <div className="cv-v" key={n}>
          <h2>
            <b>{n}</b>
            {name}
          </h2>
          <p className="cv-note">{NOTES[name]}</p>
          <div className="cv-frame">
            <h1>Conditionals</h1>
            <Tabs />
            {node}
          </div>
        </div>
      ))}
    </div>
  );
}

const SHEET = `
/* ONE FAMILY. The terminal is Geist and nothing here reaches past it. */
.cv, .cv * { font-family: var(--sans); }
.cv { background: #000; min-height: 100vh; padding: 40px 0 120px; }
.cv-v { max-width: 1180px; margin: 0 auto 92px; padding: 0 32px; }
.cv-v > h2 { margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink-2); }
.cv-v > h2 b { font-size: 12px; font-weight: 600; color: var(--ink-3); }
.cv-note { margin: 0 0 22px; font-size: 12.5px; color: var(--ink-3); }

.cv-frame h1 {
  margin: 0 0 18px; font-size: 27px; font-weight: 600;
  letter-spacing: -0.024em; line-height: 1.1; color: var(--ink-0);
}
.cv-tabs { display: flex; gap: 26px; margin-bottom: 26px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.cv-tabs button {
  border: 0; background: none; padding: 0 0 11px; cursor: pointer; position: relative;
  font-size: 13px; font-weight: 500; letter-spacing: -0.006em; color: var(--ink-3);
}
.cv-tabs button.is-on { color: var(--ink-0); }
.cv-tabs button.is-on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--ink-0); }

.cv-net {
  display: inline-flex; align-items: baseline; white-space: nowrap;
  font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: -0.014em;
}
.cv-net svg { flex: none; align-self: center; }
.cv-net em { font-style: normal; font-weight: 500; opacity: 0.7; font-size: 0.78em; }

.cv b { font-weight: 600; color: var(--ink-0); }
.cv i { font-style: normal; font-variant-numeric: tabular-nums; color: var(--ink-0); }
.is-past b, .is-past i { color: var(--ink-1); }

/* ── 1 · CLOCK ── */
.cv-clk-r { padding: 20px 0 22px; border-top: 1px solid rgba(255,255,255,0.05); }
.cv-clk-r:first-child { border-top: 0; padding-top: 2px; }
.cv-clk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; margin-bottom: 13px; }
.cv-clk-say { margin: 0; font-size: 16px; line-height: 1.4; letter-spacing: -0.014em; color: var(--ink-1); max-width: 68ch; }
.cv-clk-r.is-past .cv-clk-say { color: var(--ink-2); }

/* The track. Height 3, so it reads as a measure and not a bar chart. */
.cv-clk-track { position: relative; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.07); }
.cv-clk-run { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--ink-2); }
.cv-clk-r.is-past .cv-clk-run { background: var(--ink-3); }
.cv-clk-r[data-s='paused'] .cv-clk-run { background: var(--ink-3); }
/* Every fire, on the life it happened in. */
.cv-clk-fire { position: absolute; top: -3px; width: 1px; height: 9px; margin-left: -0.5px; background: var(--ink-0); }
/* Now: the head of the run, the only thing on the track with a size. */
.cv-clk-now { position: absolute; top: -2.5px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--ink-0); outline: 3px solid #000; }
.cv-clk-r[data-s='paused'] .cv-clk-now { background: #000; box-shadow: inset 0 0 0 1.5px var(--ink-2); }
.cv-clk-r[data-s='cancelling'] .cv-clk-now { background: var(--ink-3); }

.cv-clk-sub { margin: 13px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 9px; font-size: 12.5px; color: var(--ink-3); }
.cv-clk-sub > span + span::before { content: '·'; margin-right: 9px; color: var(--ink-4); }
.cv-clk-st { color: var(--ink-2); font-weight: 500; }
.cv-clk-left { margin-left: auto; }
.cv-clk-left::before { display: none; }

/* ── 2 · HINGE ── */
.cv-hng-h, .cv-hng-r { display: grid; grid-template-columns: minmax(0,1fr) 30px minmax(0,0.86fr) 168px; align-items: start; }
.cv-hng-h { padding-bottom: 11px; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 11.5px; color: var(--ink-3); }
.cv-hng-h span:last-child { text-align: right; }
.cv-hng-r { padding: 17px 0 18px; border-bottom: 1px solid rgba(255,255,255,0.045); }
.cv-hng-r:first-of-type .cv-hng-pin::before { top: 8px; }
.cv-hng-r:last-of-type .cv-hng-pin::before { bottom: 8px; }
.cv-hng-when p, .cv-hng-then p { margin: 0; font-size: 15px; line-height: 1.4; letter-spacing: -0.012em; color: var(--ink-1); }
.cv-hng-r.is-past .cv-hng-when p, .cv-hng-r.is-past .cv-hng-then p { color: var(--ink-2); }
.cv-hng-when small, .cv-hng-then small { display: block; margin-top: 5px; font-size: 11.5px; color: var(--ink-3); }
/* The hinge: a short line with the join marked on it. */
.cv-hng-pin { position: relative; align-self: stretch; }
.cv-hng-pin::before { content: ''; position: absolute; left: 50%; top: -1px; bottom: -1px; width: 1px; background: rgba(255,255,255,0.14); }
.cv-hng-pin::after { content: ''; position: absolute; left: 50%; top: 8px; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--ink-2); outline: 3px solid #000; }
.cv-hng-r.is-past .cv-hng-pin::after { background: var(--ink-4); }
.cv-hng-res { text-align: right; padding-top: 1px; }
.cv-hng-wait { font-size: 12.5px; color: var(--ink-3); }

/* ── 3 · RESULT ── */
.cv-res-r { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 32px; align-items: start; padding: 24px 0 26px; border-top: 1px solid rgba(255,255,255,0.05); }
.cv-res-r:first-child { border-top: 0; padding-top: 2px; }
.cv-res-fig { display: flex; flex-direction: column; gap: 5px; }
.cv-res-fig .cv-net { letter-spacing: -0.028em; }
.cv-res-pct { font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; opacity: 0.72; }
.cv-res-none { font-size: 20px; font-weight: 500; letter-spacing: -0.02em; color: var(--ink-4); }
.cv-res-say { margin: 0 0 7px; font-size: 15.5px; line-height: 1.42; letter-spacing: -0.012em; color: var(--ink-1); max-width: 60ch; }
.cv-res-r.is-past .cv-res-say { color: var(--ink-2); }
.cv-res-sub { margin: 0; display: flex; flex-wrap: wrap; gap: 0 9px; font-size: 12.5px; color: var(--ink-3); }
.cv-res-sub > span + span::before { content: '·'; margin-right: 9px; color: var(--ink-4); }

/* ── 4 · BLOTTER ── */
.cv-blt-h, .cv-blt-r {
  display: grid; grid-template-columns: 44px 62px minmax(0,1.25fr) minmax(0,0.75fr) 76px 96px 150px;
  align-items: baseline; column-gap: 16px;
}
.cv-blt-h { padding-bottom: 9px; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 11px; color: var(--ink-3); }
.cv-blt-h span:last-child, .cv-blt-net { text-align: right; }
.cv-blt-r { padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.035); font-size: 13px; color: var(--ink-1); }
.cv-blt-r > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-blt-r.is-past { color: var(--ink-2); }
.cv-blt-at { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.cv-blt-sym { font-weight: 600; color: var(--ink-1); letter-spacing: -0.006em; }
.cv-blt-then { color: var(--ink-2); }
.cv-blt-st { font-size: 12.5px; color: var(--ink-3); }
.cv-blt-r[data-s='paused'] .cv-blt-st, .cv-blt-r[data-s='failed'] .cv-blt-st { color: var(--ink-0); }
.cv-blt-left { font-size: 12.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.cv-blt-net em { font-style: normal; color: var(--ink-4); }

@media (max-width: 940px) {
  .cv-hng-h, .cv-hng-r { grid-template-columns: minmax(0,1fr) 26px minmax(0,0.9fr); }
  .cv-hng-h span:last-child { display: none; }
  .cv-hng-res { grid-column: 3; text-align: left; padding-top: 8px; }
  .cv-res-r { grid-template-columns: 1fr; gap: 12px; }
  .cv-blt-h, .cv-blt-r { grid-template-columns: 44px 62px minmax(0,1fr) 84px 140px; }
  .cv-blt-h span:nth-child(4), .cv-blt-h span:nth-child(6), .cv-blt-then, .cv-blt-left { display: none; }
}
@media (max-width: 620px) {
  .cv-v { padding: 0 18px; }
  .cv-clk-head { flex-direction: column; gap: 9px; }
  .cv-clk-left { margin-left: 0; }
  .cv-clk-left::before { display: inline; }
}
`;

'use client';

/*
 * CONDITIONALS, FOUR MORE. THIRD SET.
 *
 * The first eight all took the same shape as the thing they replace: a
 * flat list of rows, newest first, one after another. These four change
 * what the page IS, not how a row is drawn:
 *
 *   5 Book   — grouped by token, with what each token has actually paid.
 *   6 Desk   — a list on the left, the play you picked open on the right.
 *   7 Charts — the token's price is the row, with the trigger drawn on it.
 *   8 Wall   — four plays to a screen, at the size of a headline.
 *
 * Same rules: Geist only, black ground, no fills, no boxes, and the only
 * colour on the page is a gain or a loss.
 */

import { useState, type ReactElement } from 'react';
import { Net, PLAYS, Say, Tabs, WORD, isLive, type Play } from './CondVariants';

// ───────────────────────── a price line ─────────────────────────

/*
 * A deterministic walk per token, so the same symbol always draws the
 * same line and the set does not reshuffle on every render. Not real
 * prices: enough shape to show where the trigger sits against them.
 */
function walk(seed: string, n = 44): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  let v = 0.5;
  for (let i = 0; i < n; i += 1) {
    h = (h * 1664525 + 1013904223) >>> 0;
    v += ((h % 1000) / 1000 - 0.48) * 0.09;
    v = Math.max(0.06, Math.min(0.94, v));
    out.push(v);
  }
  return out;
}

function Spark({ seed, trigger, tone }: { readonly seed: string; readonly trigger: number; readonly tone: string }): ReactElement {
  /* Stretched to fill the box. The raw walk only ever wanders a little
     way from the middle, so unnormalised every token drew the same flat
     hair across the row and the trigger had nothing to cross. */
  const raw = walk(seed);
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const span = hi - lo || 1;
  const pts = raw.map((v) => 0.08 + ((v - lo) / span) * 0.84);
  const w = 100;
  const h = 30;
  const d = pts
    .map((v, i) => (i === 0 ? 'M' : 'L') + ((i / (pts.length - 1)) * w).toFixed(2) + ' ' + ((1 - v) * h).toFixed(2))
    .join(' ');
  const y = ((1 - trigger) * h).toFixed(2);
  return (
    <svg className="cv-spark" viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" aria-hidden>
      {/* The level the play is waiting on, drawn across the price. */}
      <line x1="0" x2={w} y1={y} y2={y} stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={tone} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Where the trigger sits on the walk, so the dashed line lands somewhere true. */
function triggerFor(p: Play): number {
  const pts = walk(p.sym);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const last = 0.08 + (((pts[pts.length - 1] ?? 0.5) - lo) / span) * 0.84;
  /* A live play is waiting on a level it has not reached; an ended one
     sits the other side of it. */
  return isLive(p) ? Math.min(0.95, last + 0.22) : Math.max(0.05, last - 0.16);
}

// ───────────────────────── 5 · BOOK ─────────────────────────
/*
 * Not a stream of plays: a book with a page per token. You do not think
 * "what did I set up on Tuesday", you think "what is my BONK doing", and
 * every play on a token belongs together with what that token has paid.
 */
function Book(): ReactElement {
  const syms = Array.from(new Set(PLAYS.map((p) => p.sym)));
  return (
    <section className="cv-bk">
      {syms.map((sym) => {
        const rows = PLAYS.filter((p) => p.sym === sym);
        const paid = rows.reduce((sum, p) => sum + (p.net ?? 0), 0);
        const live = rows.filter(isLive).length;
        return (
          <div className="cv-bk-g" key={sym}>
            <header className="cv-bk-h">
              <h3>{sym}</h3>
              <span className="cv-bk-n">
                {rows.length} {rows.length === 1 ? 'play' : 'plays'}
                {live === 0 ? '' : ', ' + live + (live === 1 ? ' still running' : ' still running')}
              </span>
              {paid === 0 ? null : <Net net={paid} size={15} />}
            </header>
            {rows.map((p) => (
              <article className={isLive(p) ? 'cv-bk-r' : 'cv-bk-r is-past'} key={p.id}>
                <p className="cv-bk-say">
                  <Say text={p.when} sym={p.sym} />
                  <span>, </span>
                  <Say text={p.then} sym={p.sym} />
                  <span>.</span>
                </p>
                <span className="cv-bk-st">{WORD[p.state]}</span>
                <span className="cv-bk-left">{p.left}</span>
                <span className="cv-bk-net">{p.net === undefined ? <em>—</em> : <Net net={p.net} pct={p.pct} size={12.5} />}</span>
              </article>
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ───────────────────────── 6 · DESK ─────────────────────────
/*
 * The list stops being the whole page. Left is every play at one line
 * each; right is the one you are looking at, opened out, with room for
 * the things a row can never hold: why it paused, what the judge has
 * seen, every run it has made. Nothing navigates away.
 */
function Desk(): ReactElement {
  const [picked, setPicked] = useState('a');
  const p = PLAYS.find((x) => x.id === picked) ?? PLAYS[0]!;
  return (
    <section className="cv-dsk">
      <div className="cv-dsk-list">
        {PLAYS.map((row) => (
          <button
            type="button"
            key={row.id}
            onClick={() => setPicked(row.id)}
            className={'cv-dsk-i' + (row.id === picked ? ' is-on' : '') + (isLive(row) ? '' : ' is-past')}
          >
            <span className="cv-dsk-sym">{row.sym}</span>
            <span className="cv-dsk-say">
              <Say text={row.when} sym={row.sym} />
            </span>
            <span className="cv-dsk-st">{WORD[row.state]}</span>
          </button>
        ))}
      </div>

      <div className="cv-dsk-open">
        <p className="cv-dsk-say-big">
          <Say text={p.when} sym={p.sym} />
          <span>, </span>
          <Say text={p.then} sym={p.sym} />
          <span>.</span>
        </p>

        <div className="cv-dsk-figs">
          <div>
            <span>State</span>
            <b>{WORD[p.state]}</b>
          </div>
          <div>
            <span>Fired</span>
            <b>{p.fires.length === 0 ? 'Never' : p.fires.length + ' times'}</b>
          </div>
          <div>
            <span>Clock</span>
            <b>{p.left}</b>
          </div>
          <div>
            <span>Result</span>
            <b>{p.net === undefined ? 'Nothing yet' : <Net net={p.net} pct={p.pct} size={14} />}</b>
          </div>
        </div>

        {p.note === undefined ? null : <p className="cv-dsk-note">{p.note}</p>}

        <div className="cv-dsk-runs">
          <span className="cv-dsk-lab">Runs</span>
          {p.fires.length === 0 ? (
            <p className="cv-dsk-empty">It has not fired yet.</p>
          ) : (
            p.fires.map((f, i) => (
              <p className="cv-dsk-run" key={i}>
                <b>{'Run ' + (i + 1)}</b>
                <span>{p.then}</span>
                <span className="cv-dsk-run-at">{(f * 100).toFixed(0)}% into its life</span>
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── 7 · CHARTS ─────────────────────────
/*
 * The one thing a conditional is about that the ledger never shows: the
 * price it is watching. Every row carries the token's line with the
 * trigger drawn across it, so how close a play is to firing is a picture
 * rather than a sentence you have to do arithmetic on.
 */
function Charts(): ReactElement {
  return (
    <section className="cv-cht">
      {PLAYS.map((p) => (
        <article className={isLive(p) ? 'cv-cht-r' : 'cv-cht-r is-past'} key={p.id}>
          <div className="cv-cht-l">
            <div className="cv-cht-top">
              <span className="cv-cht-sym">{p.sym}</span>
              <span className="cv-cht-st">{WORD[p.state]}</span>
            </div>
            <p className="cv-cht-say">
              <Say text={p.when} sym={p.sym} />
              <span>, </span>
              <Say text={p.then} sym={p.sym} />
              <span>.</span>
            </p>
          </div>
          <Spark seed={p.sym} trigger={triggerFor(p)} tone={isLive(p) ? 'var(--ink-1)' : 'var(--ink-3)'} />
          <div className="cv-cht-r2">
            {p.net === undefined ? <span className="cv-cht-none">{p.left}</span> : <Net net={p.net} pct={p.pct} size={14} />}
            <span className="cv-cht-left">{p.net === undefined ? '' : p.left}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── 8 · WALL ─────────────────────────
/*
 * Four to a screen, at the size of a headline. A conditional is a
 * sentence somebody said out loud to the app, and this is the only one
 * of the eight that treats it that way. Everything else is a footnote
 * under it.
 */
function Wall(): ReactElement {
  return (
    <section className="cv-wal">
      {PLAYS.map((p) => (
        <article className={isLive(p) ? 'cv-wal-r' : 'cv-wal-r is-past'} key={p.id}>
          <p className="cv-wal-say">
            <Say text={p.when} sym={p.sym} />
            <span>, </span>
            <Say text={p.then} sym={p.sym} />
            <span>.</span>
          </p>
          <p className="cv-wal-sub">
            <span>{WORD[p.state]}</span>
            {p.note === undefined ? null : <span>{p.note}</span>}
            <span>{p.left}</span>
            {p.net === undefined ? null : <Net net={p.net} pct={p.pct} size={13} />}
          </p>
        </article>
      ))}
    </section>
  );
}

// ───────────────────────── the sheet ─────────────────────────

const NOTES: Readonly<Record<string, string>> = {
  Book: 'A page per token, and what that token has actually paid.',
  Desk: 'The list on the left, the play you picked open on the right.',
  Charts: 'The price the play is watching, with the trigger drawn across it.',
  Wall: 'Four to a screen, at the size of a headline.',
};

export function CondVariants2(): ReactElement {
  const sheets: ReadonlyArray<readonly [string, string, ReactElement]> = [
    ['5', 'Book', <Book key="5" />],
    ['6', 'Desk', <Desk key="6" />],
    ['7', 'Charts', <Charts key="7" />],
    ['8', 'Wall', <Wall key="8" />],
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
/* ── 5 · BOOK ── */
.cv-bk-g { margin-bottom: 34px; }
.cv-bk-g:last-child { margin-bottom: 0; }
.cv-bk-h { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.09); }
.cv-bk-h h3 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.018em; color: var(--ink-0); }
.cv-bk-n { font-size: 12px; color: var(--ink-3); margin-right: auto; }
.cv-bk-r { display: grid; grid-template-columns: minmax(0,1fr) 84px 108px 150px; align-items: baseline; column-gap: 16px; padding: 11px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.cv-bk-say { margin: 0; font-size: 14px; line-height: 1.4; letter-spacing: -0.01em; color: var(--ink-1); }
.cv-bk-r.is-past .cv-bk-say { color: var(--ink-2); }
.cv-bk-st, .cv-bk-left { font-size: 12.5px; color: var(--ink-3); }
.cv-bk-net { text-align: right; }
.cv-bk-net em { font-style: normal; color: var(--ink-4); }

/* ── 6 · DESK ── */
.cv-dsk { display: grid; grid-template-columns: minmax(0,0.9fr) minmax(0,1.1fr); gap: 40px; align-items: start; }
.cv-dsk-list { display: flex; flex-direction: column; }
.cv-dsk-i {
  display: grid; grid-template-columns: 62px minmax(0,1fr) 74px; align-items: baseline; column-gap: 12px;
  border: 0; border-bottom: 1px solid rgba(255,255,255,0.04); background: none; cursor: pointer;
  padding: 10px 10px 11px; margin: 0 -10px; text-align: left; color: var(--ink-1);
}
.cv-dsk-i:hover { color: var(--ink-0); }
/* The pick is a mark in the margin, not a filled row: nothing on this
   page is allowed a background. */
.cv-dsk-i.is-on { position: relative; }
.cv-dsk-i.is-on::before { content: ''; position: absolute; left: -10px; top: 9px; bottom: 10px; width: 2px; background: var(--ink-0); }
.cv-dsk-i.is-past { color: var(--ink-3); }
.cv-dsk-sym { font-size: 12.5px; font-weight: 600; letter-spacing: -0.006em; }
.cv-dsk-say { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-dsk-st { font-size: 12px; color: var(--ink-3); text-align: right; }

.cv-dsk-open { border-left: 1px solid rgba(255,255,255,0.07); padding-left: 32px; }
.cv-dsk-say-big { margin: 0 0 22px; font-size: 20px; line-height: 1.38; letter-spacing: -0.018em; color: var(--ink-0); }
.cv-dsk-figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.cv-dsk-figs > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cv-dsk-figs span { font-size: 11.5px; color: var(--ink-3); }
.cv-dsk-figs b { font-size: 14px; font-weight: 600; letter-spacing: -0.012em; color: var(--ink-0); }
.cv-dsk-note { margin: 16px 0 0; font-size: 13px; color: var(--ink-2); }
.cv-dsk-runs { margin-top: 24px; }
.cv-dsk-lab { display: block; margin-bottom: 10px; font-size: 11.5px; color: var(--ink-3); }
.cv-dsk-empty { margin: 0; font-size: 13px; color: var(--ink-3); }
.cv-dsk-run { margin: 0; display: grid; grid-template-columns: 74px minmax(0,1fr) auto; gap: 12px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.04); font-size: 13px; color: var(--ink-2); }
.cv-dsk-run b { font-weight: 500; color: var(--ink-1); }
.cv-dsk-run-at { font-size: 12px; color: var(--ink-3); }

/* ── 7 · CHARTS ── */
.cv-cht-r { display: grid; grid-template-columns: minmax(0,1fr) 190px 168px; align-items: center; column-gap: 28px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.045); }
.cv-cht-top { display: flex; align-items: baseline; gap: 10px; margin-bottom: 5px; }
.cv-cht-sym { font-size: 12.5px; font-weight: 600; letter-spacing: -0.006em; color: var(--ink-0); }
.cv-cht-st { font-size: 11.5px; color: var(--ink-3); }
.cv-cht-say { margin: 0; font-size: 14.5px; line-height: 1.4; letter-spacing: -0.012em; color: var(--ink-1); }
.cv-cht-r.is-past .cv-cht-say { color: var(--ink-2); }
.cv-spark { display: block; width: 190px; height: 34px; color: var(--ink-3); }
.cv-cht-r2 { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; }
.cv-cht-none, .cv-cht-left { font-size: 12.5px; color: var(--ink-3); }

/* ── 8 · WALL ── */
.cv-wal-r { padding: 30px 0 32px; border-top: 1px solid rgba(255,255,255,0.05); }
.cv-wal-r:first-child { border-top: 0; padding-top: 4px; }
.cv-wal-say { margin: 0 0 14px; font-size: 26px; line-height: 1.3; letter-spacing: -0.026em; color: var(--ink-0); max-width: 26ch; }
.cv-wal-r.is-past .cv-wal-say { color: var(--ink-2); }
.cv-wal-sub { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; font-size: 13px; color: var(--ink-3); }
.cv-wal-sub > span + span::before { content: '·'; margin-right: 10px; color: var(--ink-4); }

@media (max-width: 940px) {
  .cv-bk-r { grid-template-columns: minmax(0,1fr) 140px; }
  .cv-bk-st, .cv-bk-left { display: none; }
  .cv-dsk { grid-template-columns: 1fr; gap: 26px; }
  .cv-dsk-open { border-left: 0; padding-left: 0; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 24px; }
  .cv-dsk-figs { grid-template-columns: repeat(2, 1fr); }
  .cv-cht-r { grid-template-columns: minmax(0,1fr) 130px; row-gap: 12px; }
  .cv-spark { width: 130px; }
  .cv-cht-r2 { grid-column: 1 / -1; align-items: flex-start; text-align: left; }
  .cv-wal-say { font-size: 22px; max-width: none; }
}
`;

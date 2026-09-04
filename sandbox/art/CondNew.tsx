'use client';

/*
 * THE FILTER ON THE LEFT, EIGHT WAYS OF DRAWING IT.
 *
 * The page is settled: the filter stands in a column on the left and the
 * plays run beside it with their readings in a column of their own. What
 * is not settled is what that filter LOOKS like. Four words in grey with
 * the live one turned white is the least a control can be, and it reads
 * as text that happens to be there rather than as something you operate.
 *
 * ── WHAT IS HELD CONSTANT ────────────────────────────────────────────
 *
 * Everything except the filter. Same two plays, same readings, same
 * sizes, same spacing, in all eight. Anything that looks different
 * between two panels is the control being different.
 *
 * ── THE RULES THESE OBEY ─────────────────────────────────────────────
 *
 * No counts on it. Never bigger than the play it filters. No box drawn
 * around the set. No underline, on hover or otherwise. Black ground.
 */

import type { ReactElement, ReactNode } from 'react';

const PICKS = ['Active', 'History', 'Expired', 'Failed'] as const;

interface Play {
  readonly sym: string;
  readonly say: string;
  readonly state: string;
  readonly fired: string;
  readonly made: ReactNode;
  readonly runs: string;
  readonly life: number;
}

const PLAYS: readonly Play[] = [
  {
    sym: 'BONK', say: 'Every time BONK falls 15% in an hour, buy 2 SOL. Until Friday.', state: 'Watching',
    fired: '2', made: <span className="up">+0.86 SOL</span>, runs: 'in 2d', life: 0.62,
  },
  {
    sym: 'WIF', say: 'When WIF crosses $2.40, sell half the position. Once.', state: 'Watching',
    fired: 'Never', made: <span className="none">Nothing yet</span>, runs: 'in 5d', life: 0.18,
  },
];

/** The plays, identical in all eight panels. */
function Book(): ReactElement {
  return (
    <div className="book">
      {PLAYS.map((p) => (
        <article key={p.sym} className="row">
          <div className="col">
            <p className="say">
              <b>{p.sym}</b> {p.say}
            </p>
            <p className="sub">
              <span>{p.state}</span>
              <span className="end">13:00</span>
            </p>
          </div>
          <div className="figs">
            <span className="read">
              <span className="k">Fired</span>
              <span className="v">{p.fired}</span>
            </span>
            <span className="read">
              <span className="k">Made</span>
              <span className="v">{p.made}</span>
            </span>
            <span className="read">
              <span className="k">Runs</span>
              <span className="v">{p.runs}</span>
            </span>
            <span className="read">
              <span className="k">Life</span>
              <span className="v">{(p.life * 100).toFixed(0)}%</span>
            </span>
            <span className="trk">
              <span style={{ width: (p.life * 100).toFixed(0) + '%' }} />
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Panel({ n, name, note, children }: { readonly n: number; readonly name: string; readonly note: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="v">
      <h2>
        <b>{n}</b>
        {name}
      </h2>
      <p className="v-note">{note}</p>
      <div className="v-scr">
        <h1>Conditionals</h1>
        <div className="split">
          <aside className="nav">{children}</aside>
          <div className="main">
            <Book />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every panel's filter is this markup with a different class on it. */
function Nav({ kind }: { readonly kind: string }): ReactElement {
  return (
    <div className={`sel sel--${kind}`} role="tablist" aria-label="Which conditionals">
      {PICKS.map((p) => (
        <button key={p} type="button" role="tab" aria-selected={p === 'Active'} className={p === 'Active' ? 'on' : undefined}>
          <i aria-hidden />
          <span>{p}</span>
        </button>
      ))}
    </div>
  );
}

const SET: ReadonlyArray<readonly [number, string, string, string]> = [
  [1, 'Slab', 'The live one on a solid block of ink, the type knocked out of it. The one thing on the page that is solid.', 'slab'],
  [2, 'Rail', 'A hairline running the height of the set, with a solid length of it beside the live one.', 'rail'],
  [3, 'Plate', 'Each one on its own quiet ground, the live one a step brighter. It reads as four keys.', 'plate'],
  [4, 'Ring', 'Four hairline pills. The live one is the pill whose ring is bright, and no pill is ever filled.', 'ring'],
  [5, 'Mark', 'A small square before the live one and nothing else, on a set spaced wide enough to breathe.', 'mark'],
  [6, 'Cut', 'The live one steps out of the column, past the left edge the others hold to.', 'cut'],
  [7, 'Weight', 'No mark at all. The live one is set heavier and the others thin out, so it is weight alone.', 'weight'],
  [8, 'Bracket', 'The live one is held between two rules of its own, the way a terminal has always said you are here.', 'bracket'],
];

export function CondNew(): ReactElement {
  return (
    <div className="cn">
      <style>{SHEET}</style>
      <div className="cn-lede">
        <h1>The filter, eight ways</h1>
        <p>The page is settled. Only the control on the left changes, and everything beside it is identical in all eight.</p>
      </div>
      {SET.map(([n, name, note, kind]) => (
        <Panel key={n} n={n} name={name} note={note}>
          <Nav kind={kind} />
        </Panel>
      ))}
    </div>
  );
}

/*
 * NO BACKTICKS BELOW THIS LINE. The sheet is one template literal and a
 * stray backtick in a comment ends the string, which surfaces as a
 * missing semicolon two hundred lines further down.
 */
const SHEET = `
.cn, .cn * { box-sizing: border-box; font-family: var(--sans); }
.cn { background: #000; min-height: 100vh; padding: 40px 0 120px; color: #fff; }
.cn-lede { max-width: 1320px; margin: 0 auto 40px; padding: 0 28px; }
.cn-lede h1 { margin: 0 0 8px; font-size: 21px; font-weight: 600; letter-spacing: -0.02em; }
.cn-lede p { margin: 0; font-size: 13px; color: #6f7480; }
.v { max-width: 1320px; margin: 0 auto 48px; padding: 0 28px; }
.v > h2 { margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; font-size: 15px; font-weight: 600; color: #a6acb8; }
.v > h2 b { font-size: 12px; color: #6f7480; }
.v-note { margin: 0 0 14px; font-size: 12.5px; color: #6f7480; }
.v-scr { padding: 30px 30px 26px; border-top: 1px solid rgba(255,255,255,0.12); }
.v-scr > h1 { margin: 0 0 24px; font-size: 27px; font-weight: 600; letter-spacing: -0.024em; color: #ffffff; }
.cn button { border: 0; background: none; margin: 0; padding: 0; cursor: pointer; font: inherit; color: inherit; text-align: left; }
.cn p { margin: 0; }
.up { color: #34d399; font-weight: 500; }
.none { color: #6f7480; font-weight: 400; }

/* ── the page, identical everywhere ── */
.split { display: flex; align-items: flex-start; gap: 40px; }
.nav { flex: none; width: 176px; padding-top: 2px; }
.main { flex: 1; min-width: 0; }
.row { display: grid; grid-template-columns: minmax(0,1fr) 268px; gap: 44px; align-items: start; padding: 0 0 18px; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.row:last-child { border-bottom: 0; }
.say { font-size: 16px; line-height: 1.4; letter-spacing: -0.014em; color: #e4e7ee; }
.say b { font-weight: 600; color: #ffffff; }
.sub { display: flex; align-items: baseline; margin-top: 9px; font-size: 12.5px; color: #6f7480; }
.sub .end { margin-left: auto; font-variant-numeric: tabular-nums; }
.figs { display: flex; flex-direction: column; gap: 7px; padding-top: 2px; }
.read { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.read .k { flex: none; font-size: 11px; color: #6f7480; }
.read .v { font-size: 12.5px; font-weight: 500; color: #e4e7ee; font-variant-numeric: tabular-nums; text-align: right; }
.trk { position: relative; display: block; height: 3px; margin-top: 2px; border-radius: 2px; background: rgba(255,255,255,0.07); }
.trk span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: #a8aeba; }

/* ── the eight ── */
.sel { display: flex; flex-direction: column; align-items: stretch; }
.sel button { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 500; letter-spacing: -0.006em; color: #6f7480; transition: color .14s ease, background-color .14s ease, box-shadow .14s ease; }
.sel button i { display: none; }
.sel button:hover { color: #b3b9c4; }

/* 1 SLAB */
.sel--slab { gap: 4px; }
.sel--slab button { padding: 8px 12px; border-radius: 7px; }
.sel--slab button.on { background: #ffffff; color: #000000; }
.sel--slab button.on:hover { color: #000000; }

/* 2 RAIL */
.sel--rail { position: relative; gap: 14px; padding-left: 15px; }
.sel--rail::before { content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 1px; background: rgba(255,255,255,0.14); }
.sel--rail button.on { color: #ffffff; }
.sel--rail button.on i { display: block; position: absolute; left: -0.5px; width: 2px; height: 15px; background: #ffffff; }

/* 3 PLATE */
.sel--plate { gap: 3px; }
.sel--plate button { padding: 9px 12px; border-radius: 6px; background: rgba(255,255,255,0.03); }
.sel--plate button:hover { background: rgba(255,255,255,0.06); }
.sel--plate button.on { background: rgba(255,255,255,0.10); color: #ffffff; }

/* 4 RING */
.sel--ring { gap: 7px; align-items: flex-start; }
.sel--ring button { padding: 7px 14px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.11); }
.sel--ring button:hover { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2); }
.sel--ring button.on { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55); color: #ffffff; }

/* 5 MARK */
.sel--mark { gap: 17px; }
.sel--mark button i { display: block; width: 6px; height: 6px; background: transparent; }
.sel--mark button.on { color: #ffffff; }
.sel--mark button.on i { background: #ffffff; }

/* 6 CUT */
.sel--cut { gap: 15px; padding-left: 16px; }
.sel--cut button { transition: transform .16s cubic-bezier(.22,.61,.36,1), color .14s ease; }
.sel--cut button.on { color: #ffffff; transform: translateX(-16px); }
.sel--cut button.on i { display: block; width: 9px; height: 1px; background: #ffffff; }

/* 7 WEIGHT */
.sel--weight { gap: 15px; }
.sel--weight button { font-size: 14px; font-weight: 400; color: #4c515c; }
.sel--weight button:hover { color: #8a909d; }
.sel--weight button.on { font-weight: 600; color: #ffffff; letter-spacing: -0.012em; }

/* 8 BRACKET */
.sel--bracket { gap: 13px; align-items: flex-start; }
.sel--bracket button.on { position: relative; padding: 9px 0; color: #ffffff; }
.sel--bracket button.on::before, .sel--bracket button.on::after { content: ''; position: absolute; left: 0; width: 26px; height: 1px; background: rgba(255,255,255,0.5); }
.sel--bracket button.on::before { top: 0; }
.sel--bracket button.on::after { bottom: 0; }

@media (max-width: 1000px) {
  .row { grid-template-columns: minmax(0,1fr); gap: 14px; }
}
`;

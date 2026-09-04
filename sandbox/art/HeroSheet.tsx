'use client';

/*
 * THE HERO, FIVE COMPOSITIONS.
 *
 * ── WHAT WAS WRONG LAST TIME, EXACTLY ────────────────────────────────
 *
 * All five put a TABLE in the hero. Steps was a three column feature
 * grid. Definition was a dictionary entry over a four row table. Ledger
 * was a can and cannot comparison. Index was a sitemap. Record was a stat
 * row. That is a documentation page with a headline on top of it, and it
 * is what "a whole bunch of Q and As" means.
 *
 * ── THE RULE HERE ────────────────────────────────────────────────────
 *
 * No table. No list. No grid. No set of columns. Nothing that repeats a
 * shape three or four times across the screen. Each of these is ONE
 * arrangement of type in a space, and the arrangement is the design.
 *
 * Also still out: any picture of the app, real or faked. A mint or ink
 * ground under a white bar. A slogan that names nothing. Letter spaced
 * uppercase, gradients, glows, grey films, monospaced figures, underline
 * hovers, a headline stacked over a code block.
 *
 * ── WHAT FILLS THE SCREEN INSTEAD ────────────────────────────────────
 *
 * Scale and placement. The type here runs 110 to 190px, which is the size
 * type has to be when it is the only thing on a page, and where it SITS
 * is the composition: pinned to a corner, cropped by an edge, held
 * between two rules, or set as one paragraph that is read rather than
 * scanned.
 *
 *   PAPER #FFFFFF   INK #0B0E14   BODY #3E4A47   FAINT #8A9591
 *   LINE  #E9EDEB   PANEL #F4F7F6
 */

import type { ReactElement, ReactNode } from 'react';

function Bar(): ReactElement {
  return (
    <div className="hs-bar">
      <div className="hs-barrow">
        <span className="hs-mark" aria-hidden />
        <nav className="hs-nav">
          <a href="#">Terminal</a>
          <a href="#">Rewards</a>
          <a href="#">Community</a>
        </nav>
        <span className="hs-gap" />
        <button type="button" className="hs-login">
          Log in
        </button>
        <button type="button" className="hs-cta">
          Start Trading
        </button>
      </div>
    </div>
  );
}

function Page({ cls, children }: { readonly cls: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className={`hs-page ${cls}`}>
      <Bar />
      <section className="hs">{children}</section>
    </div>
  );
}

/* ══ 01 · ANCHOR ═══════════════════════════════════════════════════════
 *
 * The headline is pinned to the bottom left at 168px and the supporting
 * line sits high on the right, just under the bar. The air between the
 * two corners is the composition; nothing is centred and nothing is
 * repeated.
 */
function Anchor(): ReactElement {
  return (
    <Page cls="is-anchor">
      <div className="hs-col">
        <div className="hs-topright">
          <p>
            A trading terminal on Solana where the order is a sentence. Describe it once and an agent
            holds it against every block until it is true.
          </p>
          <button type="button" className="hs-cta is-big">
            Start Trading
          </button>
        </div>
        <h1>
          Trade by
          <br />
          describing it.
        </h1>
      </div>
    </Page>
  );
}

/* ══ 02 · PARAGRAPH ════════════════════════════════════════════════════
 *
 * There is no headline separate from the copy. One paragraph at 46px is
 * the whole screen, most of it grey, with the four phrases that carry the
 * product in ink. You read it rather than scan it, and the reading is the
 * design.
 */
function Paragraph(): ReactElement {
  return (
    <Page cls="is-para">
      <div className="hs-col">
        <p className="hs-read">
          <b>Listen</b> is a trading terminal on Solana. You <b>describe a trade in one sentence</b>,
          an agent <b>holds it against every block</b> until the moment it is true, and then it{' '}
          <b>asks you before it spends anything</b>.
        </p>
        <div className="hs-inline">
          <button type="button" className="hs-cta is-big">
            Start Trading
          </button>
          <span className="hs-quiet">12,408 conditions are armed right now.</span>
        </div>
      </div>
    </Page>
  );
}

/* ══ 03 · DROP ═════════════════════════════════════════════════════════
 *
 * One word at 210px carrying the whole left of the screen, with the
 * sentence it belongs to set small against it. An editorial opening
 * rather than a headline in a box.
 */
function Drop(): ReactElement {
  return (
    <Page cls="is-drop">
      <div className="hs-col">
        <div className="hs-dropwrap">
          <span className="hs-dropcap" aria-hidden>
            Say
          </span>
          <div className="hs-dropsay">
            <h1>
              <span className="hs-vis">Say</span> what you are
              <br />
              waiting for. It
              <br />
              does the waiting.
            </h1>
            <p>
              A terminal on Solana where the condition you write is held against the chain every
              block, and nothing fires until you approve it.
            </p>
            <button type="button" className="hs-cta is-big">
              Start Trading
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}

/* ══ 04 · HELD ═════════════════════════════════════════════════════════
 *
 * The statement sits between two full bleed rules with a lot of air
 * inside them, and the supporting line and the button share the baseline
 * underneath. A framed statement, which is the oldest composition there
 * is and still the hardest to get wrong.
 */
function Held(): ReactElement {
  return (
    <Page cls="is-held">
      <div className="hs-rulewrap">
        <div className="hs-col">
          <h1>
            The chain never
            <br />
            closes. Neither
            <br />
            does it.
          </h1>
        </div>
      </div>
      <div className="hs-col hs-under">
        <p>
          Write the trade you are waiting for. Listen watches Solana every block and brings it back
          to you priced, at two in the morning if that is when it happens.
        </p>
        <button type="button" className="hs-cta is-big">
          Start Trading
        </button>
      </div>
    </Page>
  );
}

/* ══ 05 · OVERFLOW ═════════════════════════════════════════════════════
 *
 * Set at 190px, the headline is wider than the window and the last word
 * is cut by the right edge. It says the thing is bigger than the screen
 * it is on, which is the only claim a hero can make with no picture in it.
 */
function Overflow(): ReactElement {
  return (
    <Page cls="is-over">
      <h1>
        An agent at
        <br />
        the desk, always.
      </h1>
      <div className="hs-col hs-under">
        <p>
          A trading terminal on Solana where you say what you are waiting for and something reads
          every block until it happens. It asks before it spends.
        </p>
        <button type="button" className="hs-cta is-big">
          Start Trading
        </button>
      </div>
    </Page>
  );
}

const SET: ReadonlyArray<readonly [string, string, ReactElement]> = [
  ['Anchor', 'Headline pinned bottom left at 168px, the supporting line high on the right. The air between two corners is the composition.', <Anchor key="a" />],
  ['Paragraph', 'No separate headline. One paragraph at 46px is the whole screen, grey with the four phrases that matter in ink.', <Paragraph key="b" />],
  ['Drop', 'One word at 210px holding the left, the sentence it belongs to set small against it. An editorial opening.', <Drop key="c" />],
  ['Held', 'The statement between two full bleed rules with air inside them, the line and the button sharing the baseline below.', <Held key="d" />],
  ['Overflow', 'Set wider than the window so the last word is cut by the right edge. The thing is bigger than the screen it is on.', <Overflow key="e" />],
];

export function HeroSheet(): ReactElement {
  return (
    <div className="hsl">
      <style>{SHEET}</style>
      <p className="hsl-head">
        Five compositions. No table, no list, no grid, no set of columns in any of them. Nothing that
        repeats a shape across the screen.
      </p>
      {SET.map(([name, note, node], i) => (
        <div className="hsl-v" key={name}>
          <h2>
            <b>{String(i + 1).padStart(2, '0')}</b>
            {name}
          </h2>
          <p className="hsl-note">{note}</p>
          <div className="hsl-stage">{node}</div>
        </div>
      ))}
    </div>
  );
}

const SHEET = `
.hsl, .hsl * { box-sizing: border-box; }
/* globals.css puts zoom 1.18 on html for the terminal and this route
   inherits it, so 1400px would lay out at 1186. Divided back out, the
   sheet sits at true CSS pixels, the same as the landing runs at.
   No backticks in this string; one of them ends the whole stylesheet. */
.hsl { zoom: 0.847458; background: #141517; min-height: 118vh; padding: 24px 22px 90px; font-family: var(--sans); }
.hsl-head { margin: 0 0 22px; max-width: 100ch; font-size: 12.5px; line-height: 1.55; color: var(--ink-3); }
.hsl-v { margin-bottom: 30px; }
.hsl-v > h2 { margin: 0 0 3px; display: flex; align-items: baseline; gap: 10px; font-size: 14px; font-weight: 600; color: var(--ink-1); }
.hsl-v > h2 b { font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--ink-3); }
.hsl-note { margin: 0 0 10px; max-width: 104ch; font-size: 12px; line-height: 1.5; color: var(--ink-3); }
.hsl-stage { border-radius: 12px; overflow: hidden; }

.hs-page {
  --paper:#FFFFFF; --ink:#0B0E14; --body:#3E4A47; --faint:#8A9591;
  --line:#E9EDEB; --panel:#F4F7F6;
  --col: min(1400px, 100% - 48px);
  background: var(--paper); color: var(--body); font-family: var(--sans); -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
.hs-col { width: var(--col); margin: 0 auto; }
.hs-gap { flex: 1 1 auto; }

/* ── the bar, as shipped ── */
.hs-bar { border-bottom: 1px solid var(--line); }
.hs-barrow { display: flex; align-items: center; width: var(--col); margin: 0 auto; height: 72px; }
.hs-mark { display: block; width: 32px; height: 32px; flex: none; background: var(--ink);
  -webkit-mask-image: url(/landing/svg/mark.svg); mask-image: url(/landing/svg/mark.svg);
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-position: center; mask-position: center;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.hs-nav { display: flex; align-items: center; gap: 4px; margin-left: 30px; }
.hs-nav a { padding: 9px 14px; border-radius: 9px; font-size: 15.5px; letter-spacing: -0.012em; color: var(--body); text-decoration: none; }
.hs-nav a:hover { color: var(--ink); background: var(--panel); }
.hs-login { border: 0; background: none; padding: 9px 14px; border-radius: 9px; cursor: pointer; font-family: var(--sans); font-size: 15.5px; color: var(--body); }
.hs-cta { border: 0; cursor: pointer; height: 38px; margin-left: 10px; padding: 0 18px; border-radius: 10px; background: var(--ink); color: #fff; font-family: var(--sans); font-size: 14.5px; font-weight: 500; transition: transform 180ms ease-in-out; }
.hs-cta:hover { transform: translateY(-1px); }
.hs-cta.is-big { height: 54px; margin: 0; padding: 0 28px; border-radius: 13px; font-size: 16.5px; }
.hs-quiet { font-size: 15px; color: var(--faint); }
.hs h1 { margin: 0; font-weight: 500; letter-spacing: -0.05em; line-height: .9; color: var(--ink); }

/* ══ 01 · ANCHOR ══ two corners, and the air between them ═══════════ */
.is-anchor .hs { padding: 46px 0 78px; }
.is-anchor .hs-col { display: flex; flex-direction: column; min-height: 720px; }
.hs-topright { align-self: flex-end; width: 400px; text-align: right; }
.hs-topright p { margin: 0; font-size: 17px; line-height: 1.5; color: var(--body); }
.hs-topright .hs-cta { margin-top: 26px; }
.is-anchor h1 { margin-top: auto; font-size: 168px; }

/* ══ 02 · PARAGRAPH ══ the reading is the design ════════════════════ */
.is-para .hs { padding: 132px 0 140px; }
.hs-read { margin: 0; max-width: 24ch; font-size: 46px; font-weight: 400; letter-spacing: -0.032em; line-height: 1.18; color: #B4BEBB; }
.hs-read b { font-weight: 500; color: var(--ink); }
.hs-inline { display: flex; align-items: center; gap: 24px; margin-top: 56px; }

/* ══ 03 · DROP ══ one word holds the left ═══════════════════════════ */
.is-drop .hs { padding: 70px 0 96px; }
.hs-dropwrap { position: relative; }
.hs-dropcap { position: absolute; left: -14px; top: -26px; z-index: 0; font-size: 210px; font-weight: 500; letter-spacing: -0.06em; line-height: 1; color: var(--panel); user-select: none; }
.hs-dropsay { position: relative; z-index: 1; padding-top: 60px; padding-left: 132px; }
.is-drop h1 { font-size: 74px; line-height: .98; }
.hs-vis { color: var(--ink); }
.hs-dropsay p { margin: 30px 0 0; max-width: 44ch; font-size: 17px; line-height: 1.5; color: var(--body); }
.hs-dropsay .hs-cta { margin-top: 34px; }

/* ══ 04 · HELD ══ a statement between two rules ═════════════════════ */
.is-held .hs { padding: 0 0 92px; }
.hs-rulewrap { padding: 108px 0 116px; border-bottom: 1px solid var(--line); }
.is-held h1 { font-size: 122px; }
.hs-under { display: flex; align-items: flex-end; justify-content: space-between; gap: 60px; padding-top: 40px; }
.hs-under p { margin: 0; max-width: 48ch; font-size: 17px; line-height: 1.5; color: var(--body); }

/* ══ 05 · OVERFLOW ══ wider than the window ═════════════════════════ */
.is-over .hs { padding: 96px 0 92px; }
.is-over h1 { padding-left: max(24px, calc((100% - var(--col)) / 2)); font-size: 190px; white-space: nowrap; }
.is-over .hs-under { padding-top: 64px; }

@media (max-width: 1100px) {
  .is-anchor .hs-col { min-height: 0; }
  .hs-topright { align-self: stretch; width: auto; text-align: left; }
  .is-anchor h1 { margin-top: 56px; font-size: 46px; }
  .is-para .hs { padding: 56px 0 64px; }
  .hs-read { font-size: 26px; max-width: none; }
  .hs-dropcap { display: none; }
  .hs-dropsay { padding: 0; }
  .is-drop h1, .is-held h1 { font-size: 40px; }
  .hs-rulewrap { padding: 48px 0 52px; }
  .hs-under { flex-direction: column; align-items: flex-start; gap: 26px; }
  .is-over h1 { font-size: 44px; white-space: normal; }
  .hs-nav { display: none; }
}
`;

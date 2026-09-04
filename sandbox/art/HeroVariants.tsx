'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

/**
 * HERO: THE SPLIT, WITH A CONDITIONAL RUNNING ON THE RIGHT.
 *
 * ── THE STRUCTURE ────────────────────────────────────────────────────
 *
 * Taken from the reference: full bleed, two halves on a hairline, the copy
 * held in the left one on a wide margin with registration ticks at its
 * corners, and a live panel filling the right. Small eyebrow, one large
 * headline, one line under it, one control.
 *
 * ── AND WHAT IS OURS RATHER THAN THEIRS ──────────────────────────────
 *
 * The reference is dark on both sides. This page is white, so the split
 * carries the contrast instead: paper on the left, and the right panel in
 * #0a0a0a, which is the same ink surface the order card on this site is
 * already made of. Two materials the product already owns, rather than a
 * new one invented for a hero.
 *
 * ── THE THREE RIGHT PANELS ───────────────────────────────────────────
 *
 * The left half is identical in all three. Only what is running on the
 * right changes:
 *
 *   1  THE RUN     one conditional through its whole life: armed, then the
 *                  cap climbing, then the match, then filled. The figure is
 *                  the size of the panel.
 *   2  THE CARD    the order writing itself, term by term, and settling on
 *                  awaiting approval.
 *   3  THE TRACE   the tools landing one at a time with what each found,
 *                  and how long it took.
 */

function useBeat(durations: readonly number[]): number {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const ms = durations[beat] ?? 2400;
    const id = window.setTimeout(() => setBeat((b) => (b + 1) % durations.length), ms);
    return () => window.clearTimeout(id);
  }, [beat, durations]);
  return beat;
}

function useClimb(live: boolean, from: number, to: number, step: number): number {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (!live) {
      setN(from);
      return;
    }
    const id = window.setInterval(
      () => setN((v) => Math.min(to, v + step + Math.floor(Math.random() * step))),
      130,
    );
    return () => window.clearInterval(id);
  }, [live, from, to, step]);
  return n;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * THE PANEL'S CHROME.
 *
 * The detail layer the reference carries and the first pass of this did
 * not: a cross at each corner, a tick rail on each side at the vertical
 * centre, and small squares off the rails.
 *
 * There is no control cluster in the bottom right. The reference has pause
 * and mute there because its panel is a video; ours is a readout with
 * nothing to pause, so the buttons were a control that does not exist.
 *
 * It is instrument marking rather than decoration. It says the panel is a
 * readout and not a slide, and it is what stops a large dark rectangle
 * with one number in it reading as empty.
 *
 * None of it moves. The readout is the only thing on the panel that
 * changes, and chrome that animated would compete with it. All of it is
 * aria-hidden: none of it carries meaning a reader needs.
 */
function Chrome() {
  return (
    <div className="ch" aria-hidden>
      <span className="ch-x is-tl" />
      <span className="ch-x is-tr" />
      <span className="ch-x is-bl" />
      <span className="ch-x is-br" />

      <span className="ch-rail is-left">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} data-tall={i > 3 && i < 7 ? 'true' : 'false'} />
        ))}
      </span>
      <span className="ch-rail is-right">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} data-tall={i > 3 && i < 7 ? 'true' : 'false'} />
        ))}
      </span>

      <span className="ch-sq is-a" />
      <span className="ch-sq is-b" />
      <span className="ch-sq is-c" />
      <span className="ch-sq is-d" />

    </div>
  );
}

/** The left half. Identical in all three. */
function Copy(): ReactElement {
  return (
    <div className="sp-left">
      {/* Registration ticks, as the reference has them: four corners of the
          content area, not of the panel. They mark the margin. */}
      <span aria-hidden className="sp-tick is-tl" />
      <span aria-hidden className="sp-tick is-tr" />
      <span aria-hidden className="sp-tick is-bl" />
      <span aria-hidden className="sp-tick is-br" />

      <div className="sp-copy">
        <span className="sp-eyebrow">Built for Solana traders who never sleep on a fill</span>
        <h1 className="sp-h">
          Say it once.
          <br />
          It trades it
          <br />
          for you.
        </h1>
        <p className="sp-p">Solana has the markets. Listen holds your condition against them.</p>
        <button type="button" className="sp-cta">
          <span>Start trading</span>
          <i aria-hidden>+</i>
        </button>
      </div>
    </div>
  );
}

/* ── 01 · THE RUN ──────────────────────────────────────────────────── */
const RUN_MS = [3000, 9000, 1800, 4600];

function Run(): ReactElement {
  const beat = useBeat(RUN_MS);
  const cap = useClimb(beat === 1, 4182, 5000, 8);
  const state = ['Armed', 'Watching', 'Match', 'Filled'][beat] ?? 'Armed';
  const pct = beat === 0 ? 0 : Math.min(100, ((cap - 3800) / 1200) * 100);

  return (
    <div className="rn">
      <div className="rn-top">
        <span className="rn-sym">TAU</span>
        <span className="rn-state" data-beat={beat}>
          {state}
        </span>
      </div>

      <div className="rn-mid">
        <p className="rn-cond">Buy 2 SOL if the market cap passes $5,000</p>
        <p className="rn-figure num">{beat === 0 ? money(4182) : money(beat >= 2 ? 5000 : cap)}</p>
        <div className="rn-meter">
          <i style={{ width: `${beat >= 2 ? 100 : pct}%` }} />
        </div>
      </div>

      <ol className="rn-log">
        {[
          ['03:14:02', 'Armed. Watching every block.'],
          ['03:52:44', 'Market cap crossed $5,000.'],
          ['03:52:45', 'Filled. 2 SOL at 0.0041.'],
        ].map(([at, text], i) => (
          <li key={text} data-on={beat >= i + 1 ? 'true' : 'false'}>
            <span className="num">{at}</span>
            <b>{text}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── 02 · THE CARD ─────────────────────────────────────────────────── */
const CARD_MS = [2400, 2200, 2200, 2200, 5200];

function Card(): ReactElement {
  const beat = useBeat(CARD_MS);
  const armed = beat >= 4;
  return (
    <div className="cd">
      <div className="cd-top">
        <b>New conditional</b>
        <em data-armed={armed ? 'true' : 'false'}>{armed ? 'Awaiting approval' : 'Writing'}</em>
      </div>
      <dl>
        {[
          ['When', 'TAU market cap passes $5,000'],
          ['Then', 'buy 2 SOL, 15% max slippage'],
          ['With', 'the agent wallet, holding 40 SOL'],
          ['Until', 'it fires once, or 24 hours pass'],
        ].map(([k, v], i) => (
          <div key={k} data-in={beat >= i ? 'true' : 'false'}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="cd-foot" data-armed={armed ? 'true' : 'false'}>
        <span className="cd-no">Decline</span>
        <span className="cd-yes">Approve</span>
      </div>
    </div>
  );
}

/* ── 03 · THE TRACE ────────────────────────────────────────────────── */
const TOOLS: ReadonlyArray<readonly [string, string, string]> = [
  ['resolve_asset', 'TAU · 7xKq…4rNp', '0.2s'],
  ['read_market', 'cap $4,182 · liq $61K', '0.3s'],
  ['size_position', '2 SOL · 15% slippage', '0.2s'],
  ['set_guardrails', '24 hours · one fill', '0.1s'],
  ['arm', 'watching every block', '0.4s'],
];

function Trace(): ReactElement {
  const at = useBeat([1400, 1000, 1000, 1000, 1000, 5000]);
  return (
    <div className="tc">
      <p className="tc-you">buy 2 sol of tau if its market cap passes 5000</p>
      <ol className="tc-list">
        {TOOLS.map(([name, found, ms], i) => (
          <li key={name} data-on={at > i ? 'true' : 'false'}>
            <b>{name}</b>
            <span>{found}</span>
            <em className="num">{ms}</em>
          </li>
        ))}
      </ol>
      <p className="tc-end" data-in={at >= 5 ? 'true' : 'false'}>
        Armed in <span className="num">1.2s</span>
      </p>
    </div>
  );
}

function Band({ n, note, children }: { readonly n: number; readonly note: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="sp-slot">
      <span className="sp-n">
        {String(n).padStart(2, '0')} <em>{note}</em>
      </span>
      <section className="sp">
        <Copy />
        <div className="sp-right">
          <Chrome />
          {children}
        </div>
      </section>
    </div>
  );
}

export function HeroVariants(): ReactElement {
  return (
    <div className="sps">
      <style>{SHEET}</style>
      <Band n={1} note="the run, whole life">
        <Run />
      </Band>
      <Band n={2} note="the card, writing itself">
        <Card />
      </Band>
      <Band n={3} note="the trace, tool by tool">
        <Trace />
      </Band>
    </div>
  );
}

/* NO BACKTICKS BELOW THIS LINE. One of them ends the stylesheet. */
const SHEET = `
.sps, .sps * { box-sizing: border-box; }
.sps {
  --sans: var(--font-instrument-sans, var(--font-geist-sans, ui-sans-serif)), system-ui, sans-serif;
  --ink: #0b0b0b; --body: #55555a; --faint: #8a8a90; --line: rgba(11,11,11,.13);
  --dark: #0a0a0a; --paper: #f5f5f5; --dim: #7d7d84; --mint: #5EEAD4;
  zoom: 0.847458; background: #141517; padding: 22px 22px 120px;
  font-family: var(--sans);
}
.sp-slot { margin-bottom: 26px; }
.sp-n { display: block; padding-bottom: 8px; font-size: 12px; color: #6f7276; font-variant-numeric: tabular-nums; }
.sp-n em { font-style: normal; padding-left: 8px; color: #4f5256; }

/*
 * THE SPLIT.
 *
 * Full bleed, two halves on one hairline. The left is a hair wider than
 * the right: the copy needs the measure and the panel does not, and a dead
 * even split makes the headline wrap a word early.
 */
.sp {
  position: relative; overflow: hidden; border-radius: 14px;
  display: grid; grid-template-columns: 1.06fr 1fr;
  min-height: clamp(700px, 90vh, 920px);
  background: #fff; color: var(--ink);
}
.sp-left { position: relative; display: flex; align-items: center; border-right: 1px solid var(--line); }
.sp-copy { width: min(560px, 100% - 120px); margin: 0 auto; }

/*
 * THE TICKS.
 *
 * Four corners of the CONTENT area rather than of the panel, so they mark
 * the margin the copy is set to. Drawn as two borders on an empty span:
 * an L, not a box.
 */
.sp-tick { position: absolute; width: 13px; height: 13px; pointer-events: none; }
.sp-tick.is-tl { left: 46px; top: 46px; border-left: 1px solid var(--line); border-top: 1px solid var(--line); }
.sp-tick.is-tr { right: 46px; top: 46px; border-right: 1px solid var(--line); border-top: 1px solid var(--line); }
.sp-tick.is-bl { left: 46px; bottom: 46px; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.sp-tick.is-br { right: 46px; bottom: 46px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }

.sp-eyebrow { display: block; font-size: 14px; line-height: 20px; color: var(--faint); }
.sp-h { margin: 28px 0 0; font-size: clamp(38px, 4.4vw, 76px); font-weight: 400; line-height: 1.02; letter-spacing: -0.04em; }
.sp-p { margin: 26px 0 0; max-width: 40ch; font-size: clamp(15px, 1.4vw, 18px); line-height: 1.55; color: var(--body); }

/* One control, with the reference's split affordance on the end of it. */
.sp-cta {
  display: inline-flex; align-items: stretch; margin-top: 34px; padding: 0;
  border: 1px solid var(--ink); background: none; color: var(--ink);
  font-family: inherit; font-size: 15px; cursor: pointer;
  transition: background-color 200ms ease-out, color 200ms ease-out;
}
.sp-cta span { padding: 14px 20px; }
/* The plus is on its own cell behind a rule, as the reference has it: one
   control that reads as two, which is what makes it look like a tool
   rather than a marketing button. */
.sp-cta i { display: flex; align-items: center; padding: 0 14px; border-left: 1px solid var(--ink); font-style: normal; font-size: 17px; }
.sp-cta:hover { background: var(--ink); color: #fff; }

/*
 * THE PANEL.
 *
 * #0a0a0a, which is the ink surface the order card on this site is already
 * made of. It is not a new material invented for a hero.
 */
.sp-right { position: relative; display: flex; align-items: stretch; background: var(--dark); color: var(--paper); }

.num { font-variant-numeric: tabular-nums; }

/*
 * THE PANEL CHROME.
 *
 * Inert, above the ground and under the readout.
 */
.ch { position: absolute; inset: 0; pointer-events: none; }
.ch-x { position: absolute; width: 9px; height: 9px; }
.ch-x::before, .ch-x::after { content: ''; position: absolute; background: rgba(245,245,245,.34); }
.ch-x::before { left: 0; right: 0; top: 4px; height: 1px; }
.ch-x::after { top: 0; bottom: 0; left: 4px; width: 1px; }
.ch-x.is-tl { left: 26px; top: 26px; }
.ch-x.is-tr { right: 26px; top: 26px; }
.ch-x.is-bl { left: 26px; bottom: 26px; }
.ch-x.is-br { right: 26px; bottom: 26px; }

/* The rails read as a scale. The middle three ticks are taller, which is
   what makes it a scale rather than a row of marks. */
.ch-rail { position: absolute; top: 50%; translate: 0 -50%; display: flex; align-items: center; gap: 4px; }
.ch-rail.is-left { left: 22px; }
.ch-rail.is-right { right: 22px; }
.ch-rail i { display: block; width: 1px; height: 5px; background: rgba(245,245,245,.26); }
.ch-rail i[data-tall='true'] { height: 9px; background: rgba(245,245,245,.42); }

.ch-sq { position: absolute; width: 5px; height: 5px; background: rgba(245,245,245,.3); }
.ch-sq.is-a { left: 74px; top: 27%; }
.ch-sq.is-b { right: 74px; top: 27%; }
.ch-sq.is-c { left: 74px; bottom: 27%; }
.ch-sq.is-d { right: 74px; bottom: 27%; }


/*
 * 01 THE RUN.
 *
 * The readout takes the panel: condition at the top, the figure across the
 * middle at up to 150px, the meter full width, the log on the bottom edge.
 * The first pass floated in the centre with a third of the panel empty
 * above and below it.
 */
.rn {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 62px clamp(44px, 4.6vw, 78px);
}
.rn-top { display: flex; align-items: baseline; justify-content: space-between; }
.rn-sym { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.rn-state { font-size: 14.5px; color: var(--dim); transition: color 400ms ease-out; }
.rn-state[data-beat='1'] { color: var(--mint); }
.rn-state[data-beat='2'], .rn-state[data-beat='3'] { color: #fff; }
.rn-mid { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
.rn-cond { margin: 0; max-width: 30ch; font-size: clamp(18px, 1.9vw, 24px); line-height: 1.32; color: var(--dim); }
.rn-figure { margin: 26px 0 0; font-size: clamp(64px, 9vw, 150px); font-weight: 500; line-height: .94; letter-spacing: -0.055em; }
.rn-meter { position: relative; height: 4px; margin-top: 34px; border-radius: 2px; background: rgba(245,245,245,.12); overflow: hidden; }
.rn-meter i { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: #fff; transition: width 220ms linear; }
.rn-log { margin: 0; padding: 0; list-style: none; }
.rn-log li {
  display: grid; grid-template-columns: 96px 1fr; gap: 18px; padding: 13px 0;
  border-top: 1px solid rgba(245,245,245,.1); font-size: 15px;
  opacity: 0; transition: opacity 420ms ease-out;
}
.rn-log li[data-on='true'] { opacity: 1; }
.rn-log span { color: var(--dim); font-size: 14px; }
.rn-log b { font-weight: 400; }

/*
 * 02 THE CARD.
 *
 * The card IS the panel rather than an object floating in it: the terms
 * space out to fill the height and the decision sits on the bottom edge.
 */
.cd {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  padding: 62px clamp(44px, 4.6vw, 78px);
}
.cd-top { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 10px; }
.cd-top b { font-size: 22px; font-weight: 500; letter-spacing: -0.02em; }
.cd-top em { font-style: normal; font-size: 14.5px; color: var(--dim); transition: color 400ms ease-out; }
.cd-top em[data-armed='true'] { color: #fff; }
.cd dl { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; margin: 0; }
.cd dl > div {
  display: grid; grid-template-columns: 76px 1fr; gap: 18px; padding: 22px 0;
  border-top: 1px solid rgba(245,245,245,.1);
  opacity: 0; transform: translateY(4px);
  transition: opacity 460ms ease-out, transform 460ms ease-out;
}
.cd dl > div[data-in='true'] { opacity: 1; transform: none; }
.cd dt { font-size: 14.5px; line-height: 26px; color: var(--dim); }
.cd dd { margin: 0; font-size: clamp(16px, 1.5vw, 19px); line-height: 26px; }
.cd-foot { display: flex; gap: 10px; padding-top: 26px; border-top: 1px solid rgba(245,245,245,.1); opacity: .3; transition: opacity 460ms ease-out; }
.cd-foot[data-armed='true'] { opacity: 1; }
.cd-no { display: flex; align-items: center; height: 44px; padding: 0 22px; border-radius: 10px; font-size: 14.5px; color: var(--dim); box-shadow: inset 0 0 0 1px rgba(245,245,245,.16); }
.cd-yes { display: flex; align-items: center; height: 44px; padding: 0 28px; border-radius: 10px; background: #fff; color: #000; font-size: 14.5px; font-weight: 600; }

/*
 * 03 THE TRACE.
 *
 * Sentence at the top, tool rows spread down the panel, timing on the
 * floor. The rows carry real height so five of them reach the bottom
 * rather than clustering under the sentence.
 */
.tc {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  padding: 62px clamp(44px, 4.6vw, 78px);
}
.tc-you { margin: 0 0 8px; font-size: clamp(20px, 2.1vw, 29px); line-height: 1.24; letter-spacing: -0.028em; }
.tc-list { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; margin: 0; padding: 0; list-style: none; }
.tc-list li {
  display: grid; grid-template-columns: 170px 1fr 50px; align-items: baseline; gap: 18px;
  padding: 19px 0; border-top: 1px solid rgba(245,245,245,.1); font-size: 15.5px;
  opacity: 0; transform: translateY(5px); transition: opacity 360ms ease-out, transform 360ms ease-out;
}
.tc-list li[data-on='true'] { opacity: 1; transform: none; }
.tc-list b { font-weight: 400; }
.tc-list span { color: var(--dim); }
.tc-list em { font-style: normal; text-align: right; font-size: 13.5px; color: var(--dim); }
.tc-end { margin: 0; padding-top: 24px; border-top: 1px solid rgba(245,245,245,.1); font-size: 17px; color: var(--dim); opacity: 0; transition: opacity 460ms ease-out; }
.tc-end[data-in='true'] { opacity: 1; }

/*
 * ── BELOW 1023 ───────────────────────────────────────────────────────
 *
 * The split stacks. Side by side on a phone gives the copy 180px, which
 * breaks the headline onto seven lines.
 */
@media (max-width: 1023px) {
  .sp { grid-template-columns: minmax(0, 1fr); }
  .sp-left { border-right: 0; border-bottom: 1px solid var(--line); padding: 72px 0; }
  .sp-copy { width: calc(100% - 80px); }
  .sp-right { padding: 56px 0; }
  .rn, .cd, .tc { padding: 44px 28px; }
}
`;

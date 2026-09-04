'use client';

/*
 * THE AGENT BAND — the one that already worked, rebuilt light.
 *
 * ── WHAT IT WAS ──────────────────────────────────────────────────────
 *
 * On the old page this was a white band carrying a black Conditional
 * Order card with four numbered callouts down its right side. It was the
 * best thing on that page, and the reason is worth writing down: it does
 * not describe the product, it opens one up. Every other band said what
 * Listen is; this one showed a real order mid flight and pointed at the
 * four parts of it that matter.
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────
 *
 * THE CARD IS PAPER NOW, not black. The new palette's one strong object
 * is a white plate with a rim and a real shadow, which is the material
 * the deposit sheet and the wallet modal are made of. A black card on a
 * white page was the old page's contrast; this page gets its contrast
 * from weight and from the teal instead.
 *
 * THE EYEBROW IS GONE. `ALWAYS AT THE DESK` was 9.5px, uppercase, at
 * 0.13em tracking, which is the loudest type treatment in the product
 * spent on the quietest words on the band.
 *
 * THE CALLOUTS ARE TIED TO THE CARD. They were four paragraphs floating
 * beside it; each one now has a leader rule running back to the row it is
 * about, so "shows its work" is something the layout does rather than
 * something the headline claims.
 *
 * THE FIGURES ARE REAL. Every condition carries what it is actually at
 * right now against what it is waiting for, because a card with dashes in
 * it is a diagram of the product and not the product.
 *
 * ── PALETTE ──────────────────────────────────────────────────────────
 *
 *   PAPER #FFFFFF   INK #0B0E14   BODY #3E4A47   FAINT #8A9591
 *   LINE  #E9EDEB   PANEL #F4F7F6   RIM #DDE3E1   TEAL #0F6D5F
 *
 * No mint as a ground. On paper it is 1.4:1 and the only job it holds is
 * a 7px dot.
 */

import type { ReactElement } from 'react';

const CALLOUTS: ReadonlyArray<readonly [string, string, string]> = [
  ['01', 'The trigger', 'A live condition on the chain, not a reminder. It is watched continuously, not polled when you open the app.'],
  ['02', 'The size', 'Derived from the thesis rather than typed in. Five units, priced at the moment the condition turns true.'],
  ['03', 'The chain', 'Leg two cannot arm until leg one actually fills. Settlement, not a timer, is what releases it.'],
  ['04', 'The exits', 'Two of them, whichever comes first: a day from arming, or a twenty percent fall from peak.'],
];

function Bar(): ReactElement {
  return (
    <div className="ag-bar">
      <div className="ag-barrow">
        <span className="ag-mark" aria-hidden />
        <nav className="ag-nav">
          <a href="#">Terminal</a>
          <a href="#">Rewards</a>
          <a href="#">Community</a>
        </nav>
        <span className="ag-gap" />
        <button type="button" className="ag-login">
          Log in
        </button>
        <button type="button" className="ag-cta">
          Start Trading
        </button>
      </div>
    </div>
  );
}

function Card(): ReactElement {
  return (
    <div className="ag-card">
      <div className="ag-card-h">
        <div>
          <span className="ag-sym">TAU</span>
          <span className="ag-name">Tau Protocol</span>
        </div>
        <span className="ag-state">Awaiting approval</span>
      </div>

      {/* ── LEG ONE ── */}
      <div className="ag-leg">
        <div className="ag-leg-h">
          <span>Leg one</span>
          <span className="ag-legstate">Arms on approval</span>
        </div>

        <div className="ag-row" data-tie="01">
          <span className="ag-k">When</span>
          <span className="ag-v">Market cap crosses $5,000</span>
          <span className="ag-n">$4,180</span>
          <span className="ag-w">watching</span>
        </div>

        <div className="ag-row is-then" data-tie="02">
          <span className="ag-k">Then</span>
          <span className="ag-v">
            Buy <b>5 TAU</b>
          </span>
          <span className="ag-n">≈ $21.40</span>
          <span className="ag-w">at trigger</span>
        </div>
      </div>

      {/* The join between the legs is the mechanism, so it gets a line of
          its own rather than being implied by the order of two blocks. */}
      <div className="ag-join" data-tie="03">
        <span>Settlement chained</span>
      </div>

      {/* ── LEG TWO ── */}
      <div className="ag-leg">
        <div className="ag-leg-h">
          <span>Leg two</span>
          <span className="ag-legstate">Queued</span>
        </div>

        <div className="ag-row">
          <span className="ag-k">When</span>
          <span className="ag-v">Leg one has filled</span>
          <span className="ag-n" />
          <span className="ag-w">not yet</span>
        </div>

        <div className="ag-either" data-tie="04">
          <span className="ag-either-k">and either of these</span>
          <div className="ag-either-r">
            <span className="ag-v">24 hours from arming</span>
            <span className="ag-n">23h 41m left</span>
          </div>
          <div className="ag-either-r">
            <span className="ag-v">Price falls 20% from peak</span>
            <span className="ag-n">down 4.1%</span>
          </div>
        </div>

        <div className="ag-row is-then">
          <span className="ag-k">Then</span>
          <span className="ag-v">
            Sell <b>100%</b>
          </span>
          <span className="ag-n">≈ $21.40</span>
          <span className="ag-w">at trigger</span>
        </div>
      </div>

      <div className="ag-card-f">
        <span>It has been holding this for 6 days. It will not fire without you.</span>
        <span className="ag-btns">
          <button type="button" className="ag-cta is-sm">
            Approve
          </button>
          <button type="button" className="ag-ghost">
            Edit
          </button>
        </span>
      </div>
    </div>
  );
}

export function AgentSection(): ReactElement {
  return (
    <div className="agl">
      <style>{SHEET}</style>
      <p className="agl-head">
        The agent band, rebuilt in the light palette. The card is paper with a rim now rather than
        black, the tracked uppercase eyebrow is gone, and every callout is tied by a rule to the row
        it is about.
      </p>
      <div className="agl-stage">
        <div className="ag-page">
          <Bar />

          <section className="ag">
            <div className="ag-col">
              <div className="ag-top">
                <h2>
                  An agent that
                  <br />
                  shows its work.
                </h2>
                <p>
                  One order, opened up. Every condition it is waiting on, every leg it will fire, and
                  the exact point where it stops and asks you.
                </p>
              </div>

              <div className="ag-body">
                <Card />

                <div className="ag-notes">
                  {CALLOUTS.map(([n, t, d]) => (
                    <div className="ag-note" key={n}>
                      <span className="ag-tie" aria-hidden />
                      <span className="ag-n-num">{n}</span>
                      <b>{t}</b>
                      <p>{d}</p>
                    </div>
                  ))}
                  <button type="button" className="ag-cta is-big">
                    Meet your agent
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const SHEET = `
.agl, .agl * { box-sizing: border-box; }
/* globals.css puts zoom 1.18 on html for the terminal and this route
   inherits it, so 1400px would lay out at 1186. Divided back out, the
   sheet sits at true CSS pixels, the same as the landing runs at.
   No backticks in this string; one of them ends the whole stylesheet. */
.agl { zoom: 0.847458; background: #141517; min-height: 118vh; padding: 24px 22px 90px; font-family: var(--sans); }
.agl-head { margin: 0 0 16px; max-width: 100ch; font-size: 12.5px; line-height: 1.55; color: var(--ink-3); }
.agl-stage { border-radius: 12px; overflow: hidden; }

.ag-page {
  --paper:#FFFFFF; --ink:#0B0E14; --body:#3E4A47; --faint:#8A9591;
  --line:#E9EDEB; --panel:#F4F7F6; --rim:#DDE3E1; --teal:#0F6D5F;
  --col: min(1400px, 100% - 48px);
  background: var(--paper); color: var(--body); font-family: var(--sans); -webkit-font-smoothing: antialiased;
}
.ag-col { width: var(--col); margin: 0 auto; }
.ag-gap { flex: 1 1 auto; }

/* ── the bar, as shipped ── */
.ag-bar { border-bottom: 1px solid var(--line); }
.ag-barrow { display: flex; align-items: center; width: var(--col); margin: 0 auto; height: 72px; }
.ag-mark { display: block; width: 32px; height: 32px; flex: none; background: var(--ink);
  -webkit-mask-image: url(/landing/svg/mark.svg); mask-image: url(/landing/svg/mark.svg);
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-position: center; mask-position: center;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.ag-nav { display: flex; align-items: center; gap: 4px; margin-left: 30px; }
.ag-nav a { padding: 9px 14px; border-radius: 9px; font-size: 15.5px; letter-spacing: -0.012em; color: var(--body); text-decoration: none; }
.ag-nav a:hover { color: var(--ink); background: var(--panel); }
.ag-login { border: 0; background: none; padding: 9px 14px; border-radius: 9px; cursor: pointer; font-family: var(--sans); font-size: 15.5px; color: var(--body); }
.ag-cta { border: 0; cursor: pointer; height: 38px; margin-left: 10px; padding: 0 18px; border-radius: 10px; background: var(--ink); color: #fff; font-family: var(--sans); font-size: 14.5px; font-weight: 500; transition: transform 180ms ease-in-out; }
.ag-cta:hover { transform: translateY(-1px); }
.ag-cta.is-sm { height: 34px; margin: 0; padding: 0 16px; border-radius: 8px; font-size: 13px; }
.ag-cta.is-big { height: 50px; margin: 0; padding: 0 26px; border-radius: 12px; font-size: 16px; align-self: flex-start; }
.ag-ghost { border: 0; box-shadow: inset 0 0 0 1px var(--rim); cursor: pointer; height: 34px; padding: 0 14px; border-radius: 8px; background: none; font-family: var(--sans); font-size: 13px; color: var(--body); }

/* ── the band ── */
.ag { padding: 104px 0 116px; }
.ag-top { display: grid; grid-template-columns: minmax(0,1fr) 460px; gap: 80px; align-items: end; }
.ag h2 { margin: 0; font-size: 62px; font-weight: 500; letter-spacing: -0.042em; line-height: .98; color: var(--ink); }
.ag-top p { margin: 0 0 8px; font-size: 17.5px; line-height: 1.5; color: var(--body); }

/* The card leads and the notes run beside it, tied row to row. */
.ag-body { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 74px; margin-top: 66px; align-items: start; }

/* ══ THE CARD ══ paper with a rim, which is this palette's one strong
   object. Every figure is real and tabular. */
.ag-card { border-radius: 16px; background: var(--paper); overflow: hidden; font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 1px var(--rim), 0 34px 80px -44px rgba(11,14,20,.4); }
.ag-card-h { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 19px 22px; border-bottom: 1px solid var(--line); }
.ag-sym { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); }
.ag-name { margin-left: 9px; font-size: 14px; color: var(--faint); }
.ag-state { padding: 5px 11px; border-radius: 999px; background: var(--panel); font-size: 12.5px; color: var(--body); }

.ag-leg-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 15px 22px 10px; }
.ag-leg-h > span:first-child { font-size: 13px; font-weight: 600; color: var(--ink); }
.ag-legstate { font-size: 12.5px; color: var(--faint); }

.ag-row { display: grid; grid-template-columns: 46px minmax(0,1fr) 92px 72px; align-items: baseline; gap: 14px; padding: 12px 22px; }
.ag-row + .ag-row, .ag-either + .ag-row { border-top: 1px solid var(--line); }
.ag-k { font-size: 12.5px; color: var(--faint); }
.ag-v { font-size: 15px; color: var(--ink); }
.ag-v b { font-weight: 600; }
.ag-n { font-size: 13.5px; text-align: right; color: var(--body); }
.ag-w { font-size: 12.5px; text-align: right; color: var(--faint); }
.ag-row.is-then { background: var(--panel); }

/* The nested condition group. It is indented and on the recessed grey so
   the "either" reads as inside the leg rather than beside it. */
.ag-either { margin: 0 22px 0 82px; padding: 12px 14px 13px; border-radius: 10px; background: var(--panel); }
.ag-either-k { display: block; font-size: 12.5px; color: var(--faint); }
.ag-either-r { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding-top: 9px; }
.ag-either-r .ag-v { font-size: 14.5px; }
.ag-either-r .ag-n { font-size: 13px; color: var(--faint); }

/* The join between the legs. A rule with the word on it, because
   settlement chaining is the mechanism and it deserves a line. */
.ag-join { position: relative; display: flex; justify-content: center; margin: 14px 0 4px; }
.ag-join::before { content: ''; position: absolute; left: 22px; right: 22px; top: 50%; height: 1px; background: var(--line); }
.ag-join span { position: relative; padding: 0 12px; background: var(--paper); font-size: 12.5px; color: var(--teal); }

.ag-card-f { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 22px; border-top: 1px solid var(--line); font-size: 13px; color: var(--faint); }
.ag-btns { display: flex; gap: 9px; }

/* ══ THE NOTES ══ tied to the card, not floating beside it ══════════ */
.ag-notes { display: flex; flex-direction: column; gap: 40px; padding-top: 4px; }
.ag-note { position: relative; padding-left: 40px; }
/* The leader. It runs from the note back toward the card, which is what
   makes the annotation an annotation. */
.ag-tie { position: absolute; left: 0; top: 11px; width: 26px; height: 1px; background: var(--rim); }
.ag-n-num { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--faint); }
.ag-note b { display: block; margin-top: 5px; font-size: 19px; font-weight: 500; letter-spacing: -0.022em; color: var(--ink); }
.ag-note p { margin: 8px 0 0; font-size: 15px; line-height: 1.5; color: var(--body); }

@media (max-width: 1100px) {
  .ag { padding: 56px 0 64px; }
  .ag h2 { font-size: 36px; }
  .ag-top, .ag-body { grid-template-columns: minmax(0,1fr); gap: 28px; }
  .ag-body { margin-top: 40px; gap: 44px; }
  .ag-notes { gap: 30px; }
  .ag-either { margin-left: 22px; }
  .ag-row { grid-template-columns: 44px minmax(0,1fr) 80px; }
  .ag-w { display: none; }
  .ag-nav { display: none; }
}
`;

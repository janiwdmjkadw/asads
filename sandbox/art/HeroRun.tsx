'use client';

/*
 * THE HERO. THE RUN, WITH THE COPY FIXED.
 *
 * ── WHAT WAS WRONG WITH IT ───────────────────────────────────────────
 *
 * IT ASKED. One act read "Buy 2 SOL of TAU, like you asked?" and that is
 * the wrong product. This is a CONDITIONAL: you already said what you
 * wanted and under what circumstances, and the whole point is that it
 * does not come back and ask you again. An approval step here quietly
 * described a worse product than the real one.
 *
 * IT OPENED ON NOTHING. The first act said "Nothing is running yet",
 * which spends the most valuable frame in the band on the absence of the
 * thing. It opens on the conditional itself now.
 *
 * IT REPEATED ITSELF. Three consecutive acts printed the identical rule
 * sentence while only the small line under it changed, so for eight
 * seconds the band looked frozen. Every act has its own line now, and no
 * two are the same words.
 *
 * ── AND THE WAITING IS THE LONG ONE ──────────────────────────────────
 *
 * The acts do not share a duration. Writing takes 3 seconds, arming 2.2,
 * and WATCHING takes 6 — longer than any other act in the run, because
 * waiting is what this product actually does with almost all of its
 * time. An even cadence would have made the watch feel like a step on
 * the way to something rather than the thing itself.
 *
 * Inside the box: white ground, no images, no split, plain English, about
 * 940px, type and hairlines and live figures only.
 */

import { useEffect, useState, type ReactElement } from 'react';

/** [big line, small line under it, how long it holds] */
type Act = readonly [string, string, number];

const ACTS: readonly Act[] = [
  ['Buy 2 SOL of TAU if its market cap passes $5,000.', 'One sentence. That is the entire setup.', 3400],
  ['Armed.', 'It is reading the market from here, on its own.', 2400],
  ['', '', 6000] /* the watch. Its line is the live figure, written below. */,
  ['It just passed $5,000.', 'The condition you wrote is true.', 2600],
  ['Bought 2 SOL of TAU at $5,010.', 'Done, and it tells you exactly what it paid.', 3400],
];

const WATCH = 2;

export function HeroRun(): ReactElement {
  const [i, setI] = useState(0);
  const [cap, setCap] = useState(4180);

  /* Each act holds for its own duration rather than a shared beat. */
  useEffect(() => {
    const id = window.setTimeout(() => setI((v) => (v + 1) % ACTS.length), ACTS[i]![2]);
    return () => window.clearTimeout(id);
  }, [i]);

  /* The market only moves while it is being watched, and it resets when
     the run comes back round, so the number is never ahead of the story
     it is being told inside. */
  useEffect(() => {
    if (i !== WATCH) {
      if (i === 0) setCap(4180);
      return;
    }
    const id = window.setInterval(() => setCap((v) => Math.min(4990, v + 8 + Math.floor(Math.random() * 22))), 240);
    return () => window.clearInterval(id);
  }, [i]);

  const watching = i === WATCH;
  const line = watching ? `The market cap is $${cap.toLocaleString('en-US')}.` : ACTS[i]![0];
  const note = watching
    ? `$${(5000 - cap).toLocaleString('en-US')} to go. Nothing for you to do.`
    : ACTS[i]![1];

  return (
    <section className="r">
      <style>{SHEET}</style>
      <div className="r-col">
        {/* `key` on the act is what replays the entrance: React swaps the
            node rather than mutating it, so the animation restarts. On the
            watch act the key is held so the live figure updates in place
            instead of the line re-entering every 240ms. */}
        <div className="r-act" key={watching ? 'watch' : i}>
          <p className="r-line">{line}</p>
          <p className="r-note">{note}</p>
        </div>

        {/* Where you are in the run, without a label. The watch mark is
            wider than the others because that act is longer, so the row
            is honest about the shape of the loop. */}
        <div className="r-marks" aria-hidden>
          {ACTS.map((a, k) => (
            <span key={a[1] + k} className={[k === WATCH ? 'is-long' : '', k <= i ? 'is-on' : ''].join(' ')} />
          ))}
        </div>

        <p className="r-foot">
          The agentic trading terminal. Write the condition in a sentence, and it holds it against
          the market until it is true.
        </p>

        <div className="r-go">
          <button type="button" className="r-cta">
            Start trading
          </button>
          <button type="button" className="r-alt">
            See how it works
          </button>
        </div>
      </div>
    </section>
  );
}

/*
 * No backticks in this string, ever. It is inside a template literal and
 * one of them ends the whole stylesheet.
 */
const SHEET = `
.r, .r * { box-sizing: border-box; }
.r {
  --paper:#FFFFFF; --ink:#0B0E14; --body:#3E4A47; --faint:#8A9591;
  --line:#E9EDEB; --panel:#F4F7F6;
  --col: min(1400px, 100% - 48px);
  position: relative; overflow: hidden; background: var(--paper);
  font-family: var(--sans); -webkit-font-smoothing: antialiased;
  min-height: 940px; display: flex; align-items: center; padding: 80px 0;
}
.r-col { width: var(--col); margin: 0 auto; }

/* The act is given a fixed height so the buttons and the footnote never
   move between acts. A line that is one word long and a line that is
   twelve would otherwise shift everything under them by 80px. */
.r-act { min-height: 250px; animation: ract 520ms cubic-bezier(.2,.85,.25,1); }
@keyframes ract { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
.r-line { margin: 0; max-width: 19ch; font-size: 84px; font-weight: 500; letter-spacing: -0.045em; line-height: 1.02; color: var(--ink); font-variant-numeric: tabular-nums; }
.r-note { margin: 28px 0 0; font-size: 22px; color: var(--faint); font-variant-numeric: tabular-nums; }

.r-marks { display: flex; align-items: center; gap: 10px; margin-top: 30px; }
.r-marks span { width: 46px; height: 3px; border-radius: 2px; background: var(--line); transition: background-color 400ms ease-out; }
.r-marks span.is-long { width: 92px; }
.r-marks span.is-on { background: var(--ink); }

.r-foot { margin: 40px 0 0; max-width: 58ch; font-size: 17px; line-height: 1.5; color: var(--faint); }
.r-go { display: flex; align-items: center; gap: 14px; margin-top: 40px; }
.r-cta { border: 0; cursor: pointer; height: 56px; padding: 0 32px; border-radius: 999px; background: var(--ink); color: #fff; font-family: var(--sans); font-size: 17px; font-weight: 500; transition: transform 180ms ease-in-out; }
.r-cta:hover { transform: translateY(-1px); }
.r-alt { border: 0; cursor: pointer; height: 56px; padding: 0 22px; border-radius: 999px; background: none; color: var(--body); font-family: var(--sans); font-size: 17px; transition: color 150ms ease-in-out, background-color 150ms ease-in-out; }
.r-alt:hover { color: var(--ink); background: var(--panel); }
`;

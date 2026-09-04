'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import './clarify.css';

/**
 * The agentic hero: it asks when it is not sure.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────
 *
 * A real exchange. You write a sentence with a genuine ambiguity in it,
 * the agent comes back and asks which reading you meant, you answer, and
 * it arms. Four beats, on a loop.
 *
 * ── WHY THIS AND NOT THE LANDING'S HERO ──────────────────────────────
 *
 * The landing opens on a sentence being made exact, and an earlier version
 * of this page opened on something close enough that the two read as the
 * same page twice. This is the opposite behaviour: not the agent resolving
 * a sentence on its own, but the agent REFUSING to.
 *
 * It is also the single most load bearing claim the product makes. An
 * agent with its own wallet that guesses at an ambiguous instruction is a
 * liability; one that comes back and asks is a colleague. Everything else
 * on this page is downstream of that, so it is what the band opens on.
 *
 * ── THE AMBIGUITY IS REAL ────────────────────────────────────────────
 *
 * "When the dev sells" genuinely has two readings, and they are worth very
 * different amounts of money: any sale at all, or the wallet going to
 * zero. A made up ambiguity would be worse than none, because anybody who
 * trades would see through it immediately.
 *
 * ── THE SURFACE ──────────────────────────────────────────────────────
 *
 * The same sheet the landing hero sits on: a grey ground, a white sheet
 * inset from it, one rim, one radius, and the band below left full bleed
 * white. The two pages are visibly the same site.
 *
 * Reduced motion gets the finished exchange rather than a frozen first
 * frame, which would read as a page that failed to load.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

/*
 * `.lp` still declares the DARK palette, so every band on the light page
 * has to state its own. Without this the type paints near white on white.
 */
const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
  '--lp-panel': '#F7F9F8',
  '--lp-rim': '#DDE3E1',
} as CSSProperties;

/*
 * The beats. The question holds longest, because it is the one thing on
 * this page somebody has to actually read, and the armed state holds
 * longer still: it is where a visitor who scrolls in mid loop should land.
 *
 * NOTE: these run 300 to 700ms longer than written, because a timer plus a
 * React commit is never the interval you asked for. Tune by measuring.
 */
const BEATS = [2800, 4200, 2400, 6000];

export function ClarifyHero() {
  const [beat, setBeat] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const ms = BEATS[beat] ?? 2800;
    const id = window.setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), ms);
    return () => window.clearTimeout(id);
  }, [beat, reduced]);

  const at = reduced ? BEATS.length - 1 : beat;
  const on = (n: number): 'true' | 'false' => (at >= n ? 'true' : 'false');

  return (
    <section id="hero" style={LIGHT} className="relative isolate w-full bg-[#F1F1F1] p-[14px] lg:p-[18px]">
      <div className="cf-sheet">
        <div className="mx-auto w-[min(1400px,100%-40px)] py-16 lg:w-[min(1400px,100%-48px)] lg:py-20">
          <span className={`${SANS} block text-[13.5px] leading-5 text-lp-ink-3`}>Agentic trading</span>
          <h1
            className={`${SANS} mt-4 max-w-[22ch] text-[clamp(26px,3.6vw,50px)] font-medium leading-[1.06] tracking-[-0.038em] text-lp-ink-1`}
          >
            It asks when it is not sure. It never guesses.
          </h1>

          <div className="cf">
            {/* what you wrote */}
            <div className="cf-turn" data-in="true">
              <span className={`${SANS} cf-who`}>You</span>
              <p className={`${SANS} cf-said`}>buy 10 sol of $jimothy when the dev sells</p>
            </div>

            {/* the question it came back with */}
            <div className="cf-turn is-agent" data-in={on(1)}>
              <span aria-hidden className="cf-mark" />
              <div>
                <p className={`${SANS} cf-says`}>
                  Before I hold this. The dev selling could mean any sale at all, or the wallet
                  going to zero. Those are worth very different amounts, so which one fires the buy?
                </p>
                <div className="cf-opts">
                  <span className={`${SANS} ${at >= 2 ? 'is-picked' : ''}`}>The wallet going to zero</span>
                  <span className={SANS}>Any sale at all</span>
                </div>
              </div>
            </div>

            {/* and what it armed */}
            <div className="cf-turn is-agent" data-in={on(3)}>
              <span aria-hidden className="cf-mark" />
              <div>
                <p className={`${SANS} cf-says`}>
                  Armed. Watching the dev wallet every block, and nothing is spent until it empties.
                </p>
                <div className="cf-armed">
                  <b className={SANS}>Buy $JIMOTHY</b>
                  <span className={`${SANS} tabular-nums`}>
                    10 SOL · dev wallet to zero · 24 hours · agent wallet
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={`${SANS} flex h-12 w-fit shrink-0 items-center rounded-full bg-lp-ink-1 px-7 text-[15px] font-medium leading-none text-white transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none`}
            >
              Deploy an agent
            </button>
            <a
              href="#run"
              className={`${SANS} flex h-12 w-fit items-center px-4 text-[15px] leading-none text-lp-ink-2 transition-colors duration-150 ease-in-out hover:text-lp-ink-1`}
            >
              Watch one think
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

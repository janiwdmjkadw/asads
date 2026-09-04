'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { LightGround } from '../sections/agent/LightGround';
import { usePrefersReducedMotion } from '../primitives';
import './run.css';

/**
 * The run: one sentence turning into a standing order, in the open.
 *
 * ── THERE IS NO CARD ─────────────────────────────────────────────────
 *
 * Two versions of this band put the order in a panel, one white and one
 * black, and both were wrong for the same reason: a card is a picture of
 * an order, and this band is supposed to be the order being written.
 *
 * So the finished order is a SENTENCE, full width, at headline size. It
 * starts almost entirely grey and fills in with ink as the tools resolve
 * the parts of it. What you watch is your own loose sentence becoming an
 * exact one, which is the only claim the section is making.
 *
 * ── THE FUZZY HALF IS THE INTERESTING HALF ───────────────────────────
 *
 * "A meme" is not a field anything can match on. The second step is the
 * one that earns the page: the agent turns the vague half of the sentence
 * into a scored judgement with a stated threshold AND a stated behaviour
 * below it. Everything downstream reads off that, so nobody watching ever
 * concludes that any post from the account fires the trade.
 *
 * ── IT LOOPS, AND IT NEVER JUMPS ─────────────────────────────────────
 *
 * Every step is always in the DOM and every word of the order is always
 * in the layout. Steps arrive by opacity, words arrive by colour. A band
 * that grows by a line every two seconds drags the whole page under it
 * while somebody is reading.
 *
 * ── A NOTE ON THE TIMINGS ────────────────────────────────────────────
 *
 * The beats run 300 to 700ms longer than the numbers below, because a
 * timer plus a React commit is never the interval you asked for. Tune by
 * measuring, not by reading these.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
  '--lp-hover': 'rgba(11, 11, 11, 0.06)',
} as CSSProperties;

const SENTENCE = 'if elon tweets a meme buy me 10 sol of the first coin someone deploys on pumpfun';

interface Step {
  readonly name: string;
  /** What this step is FOR, in the language of the sentence. */
  readonly note: string;
  /** What it actually found. One line, never a status. */
  readonly found: string;
  readonly ms: number;
}

const STEPS: readonly Step[] = [
  {
    name: 'Who is elon',
    note: 'The name, resolved to one account.',
    found: '@elonmusk on X, 221.4M followers',
    ms: 2000,
  },
  {
    name: 'What counts as a meme',
    note: 'The vague half, turned into a score.',
    found: 'Image and caption read together. Fires at 0.85, asks you below it.',
    ms: 3000,
  },
  {
    name: 'Watching',
    note: 'Every post scored, not only the ones that match.',
    found: 'Live, and reading posts as they land.',
    ms: 2400,
  },
  {
    name: 'Finding the coin',
    note: 'Not the next mint. The one about the post.',
    found: 'New mints decoded at the slot they land, before their first trade.',
    ms: 2800,
  },
  {
    name: 'Sizing it',
    note: 'Your standing guardrails, applied unasked.',
    found: '10 SOL, 15% max slippage, bundle under 8%, expires in 24 hours.',
    ms: 3000,
  },
];

/*
 * THE ORDER, AS A SENTENCE.
 *
 * A part with no `from` is scaffolding and is always there. A part WITH a
 * `from` is a value some step had to go and find, and it stays grey until
 * that step resolves. Reading the greys tells you exactly how much of
 * your sentence was doing no work.
 */
interface Part {
  readonly text: string;
  readonly from?: number;
}

const ORDER: readonly Part[] = [
  { text: 'When ' },
  { text: '@elonmusk', from: 1 },
  { text: ' posts an image the classifier scores ' },
  { text: '0.85 or higher', from: 2 },
  { text: ' as a meme, buy ' },
  { text: 'the first new mint whose metadata is about that post', from: 4 },
  { text: ', for ' },
  { text: '10 SOL', from: 5 },
  { text: ', and stop after ' },
  { text: 'one fill or 24 hours', from: 5 },
  { text: '.' },
];

/* One beat past the last step is the finished order. */
const DONE = STEPS.length;
const DONE_MS = 5600;

export function Run() {
  const reducedMotion = usePrefersReducedMotion();
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const ms = beat === DONE ? DONE_MS : (STEPS[beat]?.ms ?? 2400);
    const id = window.setTimeout(() => setBeat((b) => (b + 1) % (DONE + 1)), ms);
    return () => window.clearTimeout(id);
  }, [beat, reducedMotion]);

  /* Reduced motion gets the finished run rather than a frozen first frame,
     which would read as a page that failed to load. */
  const at = reducedMotion ? DONE : beat;
  const done = at === DONE;

  return (
    <section id="run" style={LIGHT} className="relative isolate w-full bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[96px] lg:pt-[88px]">
        <div className="flex flex-col items-start gap-6 pb-11 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-12">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>The run</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              You type the thesis.
              <br /> It does the sitting still.
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>
            Every tool it reaches for and every value it resolves is on the page as it happens, and
            the order writes itself out of them. Nothing moves until you approve it.
          </p>
        </div>

        {/* what you gave it */}
        <div className="run-said">
          <span className={SANS}>You said</span>
          <p className={SANS}>{SENTENCE}</p>
        </div>

        {/*
          THE TRACE RUNS ACROSS, NOT DOWN.
          Five steps in a row under one rail. Stacked, it was a 900px
          column of prose beside a panel, and the band read as a document.
          Across, the whole pipeline is one glance wide and the order below
          it gets the full measure.
        */}
        <ol className="run-trace">
          {STEPS.map((step, i) => {
            const state = i < at ? 'done' : i === at ? 'live' : 'ahead';
            return (
              <li key={step.name} data-state={state}>
                <i aria-hidden className="run-node" />
                <p className={`${SANS} run-name`}>{step.name}</p>
                <p className={`${SANS} run-note`}>{step.note}</p>
                <p className={`${SANS} run-found`}>{step.found}</p>
              </li>
            );
          })}
        </ol>

        {/* ── the order, as one sentence ─────────────────────────────── */}
        <div className="run-order" data-done={done ? 'true' : 'false'}>
          <span className={`${SANS} run-label`}>{done ? 'It will run' : 'Writing the order'}</span>
          <p className={`${SANS} run-sentence`}>
            {ORDER.map((part, i) =>
              part.from === undefined ? (
                <span key={i}>{part.text}</span>
              ) : (
                <span key={i} className="run-part" data-in={at >= part.from ? 'true' : 'false'}>
                  {part.text}
                </span>
              ),
            )}
          </p>

          {/*
            APPROVE IS THE ONE GESTURE THIS BAND OFFERS, and it is dead
            until the sentence is finished. That is the claim the section
            is making rather than a detail: a control you could press
            while values were still resolving would be the exact thing
            this page says the product is not.
          */}
          <div className="run-decide">
            <button type="button" className={`${SANS} run-approve`} disabled={!done}>
              Approve
            </button>
            <p className={`${SANS} run-decidenote`}>
              {done
                ? 'Approve once and it runs on its own from here. You can rewrite it or kill it at any point, even while a condition is firing.'
                : 'Nothing is signed and nothing can fire until this sentence is finished and you have read it.'}
            </p>
          </div>
        </div>

        <p className={`${SANS} mt-12 max-w-[70ch] text-[15px] leading-[26px] text-lp-ink-3`}>
          What you did not do: open a builder, name a strategy, pick a template, write the condition
          in anything but English, or sit at a screen waiting for a post that might never come.
        </p>
      </div>
    </section>
  );
}

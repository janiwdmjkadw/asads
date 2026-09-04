'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { LightGround } from '../agent/LightGround';

import { usePrefersReducedMotion } from '../../primitives';
import '../hero.css';

/**
 * The hero: your sentence, made exact.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────
 *
 * The conditional you would actually type, set at headline size, and then
 * the agent resolving it in place: the vague parts get a rule under them
 * one at a time, and what each one became is named underneath. By the time
 * the band has played once, a visitor has seen that the input is English
 * and that the output is exact, without reading a word of marketing.
 *
 * ── WHY THERE IS NO CARD IN IT ───────────────────────────────────────
 *
 * Every other shape tried here put a panel under the sentence with the
 * same facts in it, which means the band says everything twice: once in
 * your words and once in the product's. Annotating your own sentence says
 * it once. It is also the only version that never shows a second copy of
 * what you wrote.
 *
 * ── THE NOTES SIT UNDER THE WHOLE SENTENCE ───────────────────────────
 *
 * NOT under the words they belong to. Hanging each one off its own word is
 * the obvious build and it does not survive a sentence that wraps: at this
 * size the line breaks after "passes", and a note belonging to a word on
 * line one lands on top of line two. In order, in a row, they read the
 * same and cannot collide.
 *
 * ── AND IT IS NOT A HEADLINE WITH COPY UNDER IT ──────────────────────
 *
 * One line of type above the sentence and one line under it. That is the
 * whole copy budget for the band, deliberately: the demonstration is the
 * argument.
 *
 * Reduced motion gets the finished state rather than a frozen first frame,
 * which would read as a page that failed to load.
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
  '--lp-hover': 'rgba(11, 11, 11, 0.06)',
} as CSSProperties;

interface Piece {
  readonly text: string;
  /** Set only on the parts the agent had to resolve. */
  readonly label?: string;
  readonly value?: string;
  /** The beat this one lands on. */
  readonly at?: number;
}

const SENTENCE: readonly Piece[] = [
  { text: 'Buy ' },
  { text: '2 SOL', label: 'Size', value: 'from the agent wallet, which holds 40', at: 1 },
  { text: ' of ' },
  { text: 'TAU', label: 'Asset', value: '7xKq…4rNp on Solana', at: 2 },
  { text: ' if its market cap passes ' },
  { text: '$5,000', label: 'Trigger', value: 'checked every block', at: 3 },
  { text: '.' },
];

/*
 * The beats. The three resolutions are quick and the finished state holds,
 * because the finished state is the one somebody scrolling past should
 * land on.
 *
 * NOTE: these run 300 to 700ms longer than written, because a timer plus a
 * React commit is never the interval you asked for. Tune by measuring.
 */
const BEATS = [1500, 1500, 1500, 5600];

const NOTES = SENTENCE.filter((p) => p.label);

export function HeroSaid() {
  const reducedMotion = usePrefersReducedMotion();
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const ms = BEATS[beat] ?? 1500;
    const id = window.setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), ms);
    return () => window.clearTimeout(id);
  }, [beat, reducedMotion]);

  const at = reducedMotion ? BEATS.length - 1 : beat;

  return (
    /*
     * THE HERO IS A SHEET, NOT A BAND.
     *
     * The section itself is a grey ground and the hero sits on a white
     * sheet inset from it, with a rim and a real radius. Every band under
     * this one stays full bleed white, so the hero is the only thing on the
     * site with an edge around it, and that edge is what marks it.
     *
     * It replaces eight sheets of trying to do this with TONE. Two percent
     * was invisible and seven percent was a smudge; there is no value
     * between them that is both visible and clean. Shape reads at a glance
     * and costs the type nothing, because the type is still on white.
     *
     * The floor rule is gone with it. The sheet has its own bottom edge, and
     * a hairline under a rounded corner reads as a mistake.
     */
    <section
      id="hero"
      style={LIGHT}
      className="relative isolate w-full bg-[#F1F1F1] p-[14px] lg:p-[18px]"
    >
      <div className="relative isolate flex min-h-[clamp(700px,90vh,910px)] w-full items-center overflow-hidden rounded-[22px] bg-lp-ground shadow-[inset_0_0_0_1px_rgba(11,11,11,0.07)] lg:rounded-[26px]">
        <LightGround className="absolute inset-0 -z-20 size-full" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
        />

      {/*
        ONE FLUID COLUMN AT EVERY WIDTH.

        The stepped column the bands below use produced a cliff on a band
        this tall: 961px at 1009 wide, 760px at 995. A 200px jump across
        fourteen pixels of resize, which made every window that is not
        maximised look like the phone layout.
      */}
      <div className="relative mx-auto w-[min(1400px,100%-40px)] py-20 lg:w-[min(1400px,100%-48px)]">
        <span className={`${SANS} block text-[13.5px] leading-5 text-lp-ink-3`}>
          The agentic trading terminal for Solana
        </span>

        {/* The label, not a second headline. It used to be set at 60px
            against a 62px sentence, so the band opened on two headlines
            of the same size and neither won. The sentence is the hero. */}
        <h1
          className={`${SANS} mt-4 max-w-[24ch] text-[clamp(19px,1.9vw,24px)] font-medium leading-[1.3] tracking-[-0.02em] text-lp-ink-2`}
        >
          Your words, made exact.
        </h1>

        {/* the sentence somebody would actually type */}
        <p className={`${SANS} hero-said`}>
          {SENTENCE.map((p, i) =>
            p.label ? (
              <span key={i} className="hero-word" data-in={at >= (p.at ?? 0) ? 'true' : 'false'}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>

        {/* and what each resolved part became */}
        <div className="hero-notes">
          {NOTES.map((p) => (
            <div key={p.label} data-in={at >= (p.at ?? 0) ? 'true' : 'false'}>
              <span className={SANS}>{p.label}</span>
              <b className={SANS}>{p.text}</b>
              <em className={SANS}>{p.value}</em>
            </div>
          ))}
        </div>

        <p className={`${SANS} hero-state`} data-in={at >= 3 ? 'true' : 'false'}>
          Armed. It holds that against every block until it is true, and asks nothing of you in
          between.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={`${SANS} flex h-12 w-fit shrink-0 items-center rounded-full bg-lp-ink-1 px-7 text-[15px] font-medium leading-none text-white transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none`}
          >
            Start trading
          </button>
          <a
            href="#agent"
            className={`${SANS} flex h-12 w-fit items-center px-4 text-[15px] leading-none text-lp-ink-2 transition-colors duration-150 ease-in-out hover:text-lp-ink-1`}
          >
            See how it works
          </a>
        </div>
        </div>
      </div>
    </section>
  );
}

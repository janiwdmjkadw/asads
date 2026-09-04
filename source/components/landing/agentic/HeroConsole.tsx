'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { LightGround } from '../sections/agent/LightGround';
import { Panels } from '../sections/hero/Panels';
import { usePrefersReducedMotion } from '../primitives';
import './hero.css';

/**
 * The agentic hero: the input IS the product.
 *
 * ── WHY THE CONSOLE IS THE CENTREPIECE ───────────────────────────────
 *
 * The whole claim of this page is that a sentence is the strategy. A
 * headline can only assert that. So the band types a real prompt, one
 * character at a time, and then names what the agent took out of it. By
 * the time you have finished reading the headline you have already
 * watched the product accept something no form could have.
 *
 * ── THE PROMPTS ARE NOT WRITTEN FOR THE PAGE ─────────────────────────
 *
 * They are lowercase, unpunctuated and three conditions deep, because
 * that is what people type. A tidied up example would prove the opposite
 * of the point.
 *
 * ── WHAT IT READS BACK ───────────────────────────────────────────────
 *
 * Once a prompt lands, the console names what it understood: the trigger,
 * the universe, the size. Not a spinner and not a checkmark. The read is
 * the only evidence that the sentence was parsed rather than merely
 * accepted.
 *
 * Reduced motion gets a prompt already read, and no typing at all.
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

const PROMPTS: readonly string[] = [
  'if elon tweets a meme buy me 10 sol of the first coin someone deploys on pumpfun',
  'copy trade frankdegods for 6 hours. only tech coins, no memes',
  'once dev sells all $jimothy, buy 10 sol but only if top 10 cluster is less than 15%',
];

/* What the console names once each prompt has landed. */
const READS: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
  [
    ['Trigger', 'a meme post from @elonmusk'],
    ['Universe', 'the first new mint about it'],
    ['Size', '10 SOL, once'],
  ],
  [
    ['Trigger', 'every fill from frankdegods'],
    ['Universe', 'tech coins only, memes dropped'],
    ['Size', 'mirrored for 6 hours'],
  ],
  [
    ['Trigger', 'the dev wallet going to zero'],
    ['Universe', '$jimothy, top 10 under 15%'],
    ['Size', '10 SOL, once'],
  ],
];

type Phase = 'typing' | 'read' | 'clearing';

const TYPE_MS = 26;
const CLEAR_MS = 9;
const READ_MS = 3400;

export function AgenticHero() {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');

  const prompt = PROMPTS[index] ?? '';

  useEffect(() => {
    if (reducedMotion) return;

    if (phase === 'read') {
      const id = window.setTimeout(() => setPhase('clearing'), READ_MS);
      return () => window.clearTimeout(id);
    }

    const typing = phase === 'typing';
    const id = window.setInterval(
      () => {
        setCount((n) => {
          if (typing) {
            if (n >= prompt.length) {
              setPhase('read');
              return n;
            }
            return n + 1;
          }
          if (n <= 0) {
            setIndex((i) => (i + 1) % PROMPTS.length);
            setPhase('typing');
            return 0;
          }
          return n - 1;
        });
      },
      typing ? TYPE_MS : CLEAR_MS,
    );
    return () => window.clearInterval(id);
  }, [phase, prompt.length, reducedMotion]);

  const text = reducedMotion ? prompt : prompt.slice(0, count);
  const read = reducedMotion || phase === 'read';
  const rows = READS[index] ?? [];

  return (
    <section
      id="hero"
      style={LIGHT}
      className="relative isolate flex min-h-[clamp(720px,92vh,940px)] w-full items-center bg-lp-ground"
    >
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />
      {/* The same room the landing hero hangs in, so the two pages open on
          the same note rather than as two different products. */}
      <Panels />

      {/* The floor is a full bleed rule, as it is on the landing hero. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-lp-hairline" />

      {/*
        ONE FLUID COLUMN AT EVERY WIDTH.

        The stepped column the bands below use produced a cliff on a band
        this tall: 961px at 1009 wide, 760px at 995. A 200px jump across
        fourteen pixels of resize, which made every window that is not
        maximised look like the phone layout.
      */}
      <div className="relative mx-auto w-[min(1400px,100%-40px)] py-20 lg:w-[min(1400px,100%-48px)]">
        <span className={`${SANS} block text-[13.5px] leading-5 text-lp-ink-3`}>Agentic trading</span>

        <h1
          className={`${SANS} mt-5 max-w-[20ch] text-[clamp(34px,7vw,100px)] font-medium leading-[1.02] tracking-[-0.045em] text-lp-ink-1`}
        >
          Say it once. It trades it for you.
        </h1>

        <p className={`${SANS} mt-7 max-w-[58ch] text-[clamp(15px,1.5vw,19px)] leading-[1.6] text-lp-ink-2`}>
          No builder, no blocks, no strategy language to learn on a Sunday. Write the condition the
          way you would say it to a friend at 3am, and an agent holds it against the tape until it
          is true.
        </p>

        {/* ── the console ─────────────────────────────────────────── */}
        <div className="ah-console" data-read={read ? 'true' : 'false'}>
          <div className={`${SANS} ah-bar`}>
            <span>New agent</span>
            <span className="ah-state">{read ? 'Read' : 'Listening'}</span>
          </div>

          <p className={`${SANS} ah-line`}>
            {text}
            {read ? null : <i aria-hidden className="ah-caret" />}
          </p>

          {/*
            The read stays MOUNTED and is hidden with opacity rather than
            unmounted. Swapping the node out collapses the console by the
            height of three rows every few seconds and the whole page under
            it jumps.
          */}
          <div className="ah-read" aria-hidden={!read}>
            {rows.map(([label, value]) => (
              <div key={label} className={SANS}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-3">
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

        <p className={`${SANS} mt-6 text-[13.5px] leading-5 text-lp-ink-3`}>
          It gets its own wallet, never yours. You approve the strategy once, and from that moment
          it runs on its own.
        </p>
      </div>
    </section>
  );
}

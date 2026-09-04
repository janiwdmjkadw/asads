'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { LightGround } from '../agent/LightGround';
import { Panels } from './Panels';
import { usePrefersReducedMotion } from '../../primitives';
import '../hero.css';

/**
 * The hero: one conditional, run from written to filled, on a loop.
 *
 * ── WHY IT IS A RUN AND NOT A CLAIM ──────────────────────────────────
 *
 * Every other shape tried for this band was a headline with a
 * demonstration under it, and they all felt the same however different
 * the words were, because they were the same shape wearing different
 * clothes. This one has no headline at all. The band IS the
 * demonstration, and the product names itself in small type at the
 * bottom once you have already watched it work.
 *
 * ── IT DOES NOT ASK ──────────────────────────────────────────────────
 *
 * An earlier version had an act reading "Buy 2 SOL of TAU, like you
 * asked?" and that is a different, worse product. This is a CONDITIONAL:
 * you said what you wanted and under what circumstances, and it not
 * coming back to bother you is the entire value. Nothing in this run
 * asks for anything.
 *
 * ── THE LINES ARE THE SAME LENGTH ON PURPOSE ─────────────────────────
 *
 * One act used to read "Armed." while the one before it ran to three
 * lines of 84px type, and at that size the difference does not read as a
 * beat, it reads as a mistake. Every big line here is between 42 and 57
 * characters, so the block of type stays roughly the same shape while
 * the words inside it change and the band never appears to collapse.
 *
 * ── AND THE WATCH IS THE LONG ONE ────────────────────────────────────
 *
 * The acts do not share a duration. Writing holds 3.6 seconds, arming
 * 3.2, and WATCHING holds 6.5 — longer than anything else in the run,
 * because waiting is what this product does with almost all of its time.
 * An even cadence made the watch feel like a step towards something
 * rather than the thing itself. Its progress mark is drawn double width
 * to match.
 *
 * No `next/image`, no `next/font`, no Next API. It drops into any React
 * app unchanged.
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

/** [the line, the line under it, how long it holds] */
type Act = readonly [string, string, number];

const ACTS: readonly Act[] = [
  [
    'Buy 2 SOL of TAU if its market cap passes $5,000.',
    'One sentence, in your own words. That is the entire setup.',
    3600,
  ],
  [
    'Armed, and reading the market without you.',
    'It holds the condition against every block from here.',
    3200,
  ],
  /* The watch. Its line is written from the live figure below. */
  ['', '', 6500],
  [
    'It just passed $5,000, which is what you asked for.',
    'The condition you wrote is true, so the order goes.',
    3000,
  ],
  [
    'Bought 2 SOL of TAU at $5,010, and told you what it paid.',
    'No approval, no prompt. You had already decided this.',
    3600,
  ],
];

const WATCH = 2;

export function Hero() {
  const reducedMotion = usePrefersReducedMotion();
  const [act, setAct] = useState(0);
  const [cap, setCap] = useState(4180);

  /* Each act holds for its own duration rather than a shared beat. */
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setTimeout(() => setAct((v) => (v + 1) % ACTS.length), ACTS[act]![2]);
    return () => window.clearTimeout(id);
  }, [act, reducedMotion]);

  /* The market only moves while it is being watched, and it resets when
     the run comes back round, so the figure is never ahead of the story
     being told around it. */
  useEffect(() => {
    if (reducedMotion) return;
    if (act !== WATCH) {
      if (act === 0) setCap(4180);
      return;
    }
    const id = window.setInterval(
      () => setCap((v) => Math.min(4990, v + 7 + Math.floor(Math.random() * 18))),
      260,
    );
    return () => window.clearInterval(id);
  }, [act, reducedMotion]);

  const watching = act === WATCH;
  const line = watching
    ? `Still watching. The market cap is $${cap.toLocaleString('en-US')} of $5,000.`
    : ACTS[act]![0];
  const note = watching
    ? `$${(5000 - cap).toLocaleString('en-US')} to go, and nothing at all for you to do.`
    : ACTS[act]![1];

  return (
    <section id="hero" style={LIGHT} className="relative isolate flex min-h-[clamp(720px,92vh,940px)] w-full items-center bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <Panels />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      {/* THE FLOOR IS A FULL BLEED RULE.

          The band ends on a line that runs the whole window while the
          type stays in the column, which is the same relationship the
          header's hairline has with the bar inside it. It also stops the
          hero and the Agent band under it reading as one continuous white
          nothing, which is most of what made the band feel empty. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-lp-hairline" />

      {/*
        THE COLUMN IS FLUID HERE, unlike the bands under it.

        They use `max-w-[760px] px-5` below `lg` and the full 1400 above
        it, and on this band that produced a cliff: at 1009px wide the
        column measured 961, and at 995 it measured 760. A 200px jump
        across fourteen pixels of resize, which is what made every window
        that is not maximised look like the phone layout.

        One expression instead, at every width: 1400 when there is room,
        the viewport minus its gutters when there is not. The gutter is
        the only thing that steps, 40 to 48, and 40 is what `px-5` was
        giving on a phone anyway.
      */}
      <div className="relative mx-auto w-[min(1400px,100%-40px)] py-20 lg:w-[min(1400px,100%-48px)]">
        {/*
          `key` is what replays the entrance: React swaps the node instead
          of mutating it, so the animation restarts on every act. On the
          watch it is held constant, or the line would re-enter every
          260ms as the figure updates.

          The fixed minimum height stops the footnote and the buttons
          moving between acts. Without it a two line act and a three line
          act shift everything under them by about 90px.
        */}
        <div
          key={watching ? 'watch' : act}
          /* The reserve grows with the type for the same reason the type
             is fluid: a fixed 330px is far too much room at 900 wide and
             not enough at 1600. */
          className="min-h-[clamp(200px,24vw,340px)] motion-safe:animate-[heroact_540ms_cubic-bezier(.2,.85,.25,1)]"
        >
          <h1
            /*
              FLUID, NOT STEPPED.

              This was `text-[36px]` with `lg:text-[100px]`, so every
              width from 1023 down — every tablet, and every desktop
              window that is not maximised — got the phone's 36px. The
              band went from 100px to 36px across one pixel of resize.

              `clamp` scales it continuously instead: 34px is the floor on
              the narrowest phone, 7vw is the middle, and it stops growing
              at 100px so a very wide monitor does not get a headline
              taller than the band. The leading and the tracking tighten
              with it for the same reason.
            */
            className={`${SANS} max-w-[24ch] text-[clamp(34px,7vw,100px)] font-medium leading-[1.06] tracking-[-0.042em] tabular-nums text-lp-ink-1`}
          >
            {line}
          </h1>
          <p className={`${SANS} mt-5 text-[clamp(16px,1.55vw,22px)] leading-[1.45] tabular-nums text-lp-ink-3 lg:mt-7`}>
            {note}
          </p>
        </div>

        {/* Where you are in the run, without a label on it. The watch mark
            is double width because that act is nearly twice as long, so
            the row is honest about the shape of the loop. */}
        <div aria-hidden className="mt-9 flex items-center gap-2 lg:mt-12 lg:gap-3">
          {ACTS.map((a, i) => (
            <span
              key={a[1] + i}
              className={[
                'h-[3px] rounded-full transition-colors duration-[400ms] ease-out',
                /* The watch is nearly twice as long as any other act, so
                   its mark is twice as wide and the row is honest about
                   the shape of the loop. `flex-[2]` against `flex-1` does
                   that at any width without a fixed size. */
                i === WATCH ? 'flex-[2]' : 'flex-1',
                i <= act ? 'bg-lp-ink-1' : 'bg-lp-hairline',
              ].join(' ')}
            />
          ))}
        </div>

        {/* The product names itself here, after you have watched it work,
            rather than claiming something above the demonstration. */}
        <p className={`${SANS} mt-9 max-w-[58ch] text-[clamp(15px,1.15vw,17px)] leading-6 text-lp-ink-3 lg:mt-10`}>
          The agentic trading terminal. Write the condition in a sentence, and it holds it against
          the market until it is true.
        </p>

        <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:mt-10">
          <button
            type="button"
            className={`${SANS} flex h-14 shrink-0 items-center justify-center rounded-full bg-lp-ink-1 px-8 text-[17px] font-medium leading-none text-white transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none`}
          >
            Start trading
          </button>
          <button
            type="button"
            className={`${SANS} flex h-14 shrink-0 items-center justify-center rounded-full px-6 text-[17px] leading-none text-lp-ink-2 transition-colors duration-150 ease-in-out hover:bg-[#f4f7f6] hover:text-lp-ink-1`}
          >
            See how it works
          </button>
        </div>
      </div>
    </section>
  );
}

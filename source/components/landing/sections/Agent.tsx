'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { LightGround } from './agent/LightGround';
import { usePrefersReducedMotion } from '../primitives';
import './agent/run.css';

/**
 * The conditionals band: two legs, running.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A dark 500px order card with five numbered footnotes down a margin,
 * joined to it by 430px leader lines. That band was restored out of the
 * old commit and then corrected repeatedly — the card flattened, the
 * uppercase removed, the fork drawn, the lines lengthened — but nobody
 * ever asked what it should BE. It was a diagram of an interface, and it
 * was the only diagram on a page that had since become a run in the
 * hero, a roost on a rail in rewards, and one object at a time in
 * surfaces.
 *
 * ── THE ARGUMENT IT NOW MAKES ────────────────────────────────────────
 *
 * Every static version of this band had to SAY that leg two waits on leg
 * one settling. A sentence claiming a dependency is the weakest possible
 * way to show one.
 *
 * Here leg two is visibly held: dimmed, queued, its rail at zero, while
 * leg one goes armed, searching, match, bought, settled. The chain in
 * the gutter lights at the exact moment settlement lands, and only then
 * does leg two arm. That is the product's whole claim, performed instead
 * of asserted.
 *
 * ── HOW LONG LEG TWO IS HELD ─────────────────────────────────────────
 *
 * 4.6 seconds of configured time, down from 14.4. The band's argument is
 * that leg two waits, and it does have to be SEEN waiting — but the first
 * pass spent 6.2 seconds on the search alone, which is long enough to
 * stop reading as anticipation and start reading as a stall.
 *
 * MEASURED, every act runs about 400 to 800ms longer than the number
 * written here: a 1200ms act was holding 2002. That is timer coalescing
 * plus a React commit per act, and it is why these figures look shorter
 * than they feel. Tune by measuring, not by reading them.
 *
 * ── THE MARKET CANNOT CONTRADICT THE STORY ───────────────────────────
 *
 * The figure only climbs while leg one is searching, and it is put back
 * when the run comes round again. A number that carried on rising while
 * the copy said "bought" would undo the entire point of the band.
 *
 * ── REDUCED MOTION ───────────────────────────────────────────────────
 *
 * The run stops on the first act, which is both legs written and only
 * one of them looking at anything. That is the most informative single
 * frame in the sequence, so somebody who has asked for less motion still
 * gets the band's argument in one still.
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

/**
 * One frame of the run. Both legs are described in the same object so
 * the two halves can never drift out of step with each other, or with
 * the sentence underneath them.
 */
interface Act {
  readonly leg1: string;
  readonly leg2: string;
  /** Leg one's rail, or null to let the live market place it. */
  readonly fill1: number | null;
  readonly fill2: number;
  readonly leg2Now: string;
  readonly say: string;
  readonly ms: number;
}

const ACTS: readonly Act[] = [
  {
    leg1: 'armed',
    leg2: 'queued',
    fill1: 0,
    fill2: 0,
    leg2Now: 'waiting on leg 1',
    say: 'Both legs are written. Only the first one is looking at anything.',
    ms: 900,
  },
  {
    leg1: 'searching',
    leg2: 'queued',
    fill1: null,
    fill2: 0,
    leg2Now: 'waiting on leg 1',
    say: 'It reads the market cap against $5,000 on every block.',
    ms: 1800,
  },
  {
    leg1: 'match',
    leg2: 'queued',
    fill1: 1,
    fill2: 0,
    leg2Now: 'waiting on leg 1',
    say: 'It reached $5,000. That is the condition you wrote.',
    ms: 800,
  },
  {
    leg1: 'bought',
    leg2: 'queued',
    fill1: 1,
    fill2: 0,
    leg2Now: 'still waiting',
    say: 'Bought 5 TAU for 0.104 SOL. Leg two has still not moved.',
    ms: 1100,
  },
  {
    leg1: 'settled',
    leg2: 'armed',
    fill1: 1,
    fill2: 0.06,
    leg2Now: 'armed just now',
    say: 'The trade settled, and only now does leg two arm. Not on a timer.',
    ms: 2600,
  },
  {
    leg1: 'settled',
    leg2: 'searching',
    fill1: 1,
    fill2: 0.54,
    leg2Now: '23h left, down 11% from peak',
    say: 'Leg two watches both exits at once, and takes whichever comes first.',
    ms: 2800,
  },
  {
    leg1: 'settled',
    leg2: 'sold',
    fill1: 1,
    fill2: 1,
    leg2Now: 'down a fifth from peak',
    say: 'It fell a fifth before the day was up, so that is the exit that fired.',
    ms: 2600,
  },
];

/** The one act where the market is allowed to move. */
const SEARCHING = 1;
/** From here on, leg one has settled and leg two is released. */
const RELEASED = 4;

function live(state: string): boolean {
  return state === 'searching' || state === 'match' || state === 'armed';
}

export function Agent() {
  const reducedMotion = usePrefersReducedMotion();
  const [act, setAct] = useState(0);
  const [cap, setCap] = useState(4180);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setTimeout(() => setAct((v) => (v + 1) % ACTS.length), ACTS[act]!.ms);
    return () => window.clearTimeout(id);
  }, [act, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    if (act === 0) setCap(4180);
    if (act !== SEARCHING) return;
    /* The step and the interval are set so the climb from 4,180 lands on
       5,000 just as the searching act ends. They are not free numbers: a
       slower climb leaves the market mid air when the copy says it
       matched, and a faster one sits at the top doing nothing. */
    const id = window.setInterval(
      () => setCap((v) => Math.min(4980, v + 26 + Math.floor(Math.random() * 46))),
      80,
    );
    return () => window.clearInterval(id);
  }, [act, reducedMotion]);

  const a = ACTS[act]!;
  const fill1 = a.fill1 ?? (cap - 3900) / 1100;
  const released = act >= RELEASED;

  return (
    <section id="agent" data-lp-run="" style={LIGHT} className="relative isolate w-full bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      {/* The header's column, so the eyebrow starts on the same line as
          the mark in the bar and the headline in every band around it. */}
      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[88px] lg:pt-[80px]">
        <div className="flex flex-col items-start gap-6 pb-12 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-14">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>Always at the desk</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              An agent that shows its work
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>
            One order, opened up. Every condition it is waiting on, every leg it will fire, and the point where it
            stops and asks you.
          </p>
        </div>

        <div className="run-dip">
          {/* ── leg one ────────────────────────────────────────────── */}
          <div className="run-leg">
            <div className="run-legtop">
              <span className={`${SANS} text-[16px] font-medium leading-5 text-lp-ink-1`}>Leg 1</span>
              <span className={`${SANS} run-state text-[15px] leading-5 ${live(a.leg1) ? 'is-live' : ''}`}>
                {a.leg1}
              </span>
            </div>

            <p className={`${SANS} text-[21px] leading-[1.35] tracking-[-0.02em] text-lp-ink-1 lg:text-[26px]`}>
              When the market cap reaches $5,000
            </p>

            <div className="run-track" aria-hidden>
              <i style={{ width: `${Math.min(1, fill1) * 100}%` }} />
            </div>

            <p className={`${SANS} mb-8 text-[15px] leading-5 tabular-nums text-lp-ink-3 lg:text-[16px]`}>
              {act === SEARCHING
                ? `$${cap.toLocaleString('en-US')} of $5,000`
                : act > SEARCHING
                  ? 'reached $5,000'
                  : 'at $4,180 of $5,000'}
            </p>

            <p className={`${SANS} text-[32px] font-medium leading-none tracking-[-0.032em] text-lp-ink-1 lg:text-[42px]`}>Buy 5 TAU</p>
            <p className={`${SANS} mt-3 text-[15px] leading-6 text-lp-ink-3 lg:text-[16px]`}>
              Spends about 0.104 SOL, priced at the moment it turns true.
            </p>
          </div>

          {/* ── the chain, in the gutter between them ───────────────── */}
          <div aria-hidden className={released ? 'run-chain is-on' : 'run-chain'}>
            <span className="run-chainline" />
            <span className="run-chaindot" />
            <span className="run-chainline" />
          </div>

          {/* ── leg two ────────────────────────────────────────────── */}
          <div className={`run-leg is-right${released ? '' : ' is-waiting'}`}>
            <div className="run-legtop">
              <span className={`${SANS} text-[16px] font-medium leading-5 text-lp-ink-1`}>Leg 2</span>
              <span className={`${SANS} run-state text-[15px] leading-5 ${live(a.leg2) ? 'is-live' : ''}`}>
                {a.leg2}
              </span>
            </div>

            <p className={`${SANS} text-[21px] leading-[1.35] tracking-[-0.02em] text-lp-ink-1 lg:text-[26px]`}>
              After leg 1 settles, whichever comes first
            </p>

            <div className={`${SANS} run-either mt-4 flex flex-col gap-2.5 text-[16px] leading-6 text-lp-ink-2 lg:text-[17px]`}>
              <span>24 hours from arming</span>
              <span>a fifth down from peak</span>
            </div>

            <div className="run-track" aria-hidden>
              <i style={{ width: `${a.fill2 * 100}%` }} />
            </div>

            <p className={`${SANS} mb-8 text-[15px] leading-5 tabular-nums text-lp-ink-3 lg:text-[16px]`}>{a.leg2Now}</p>

            <p className={`${SANS} text-[32px] font-medium leading-none tracking-[-0.032em] text-lp-ink-1 lg:text-[42px]`}>
              Sell all of it
            </p>
            <p className={`${SANS} mt-3 text-[15px] leading-6 text-lp-ink-3 lg:text-[16px]`}>
              Worth about 0.099 SOL at today&rsquo;s price.
            </p>
          </div>
        </div>

        {/* What just happened, in one line. Keyed on the act so it
            re-enters rather than swapping in place. */}
        <p
          key={act}
          className={`${SANS} mt-10 max-w-[70ch] text-[17px] leading-[1.5] text-lp-ink-3 motion-safe:animate-[runsay_460ms_cubic-bezier(.2,.85,.25,1)] lg:text-[19px]`}
        >
          {a.say}
        </p>

        <button
          type="button"
          className={`${SANS} mt-10 flex h-12 w-fit shrink-0 items-center rounded-full bg-lp-ink-1 px-7 text-[15px] font-medium leading-none text-white transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none lg:mt-12`}
        >
          Meet your agent
        </button>
      </div>
    </section>
  );
}

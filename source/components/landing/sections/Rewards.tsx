import type { CSSProperties } from 'react';

import { LightGround } from './agent/LightGround';
import { RewardIcon, type RewardIconName } from './rewards/RewardIcon';
import { Roost } from './rewards/Roost';

/**
 * Rewards — the band, rebuilt.
 *
 * ── WHAT WAS WRONG WITH IT ───────────────────────────────────────────
 *
 * Three equal columns, each with a stroke icon, a title and a line. An
 * icon grid that could have been lifted onto any product on the internet
 * without changing a word, and which said nothing a reader could check:
 * "real cashback on every trade" with no number anywhere near it.
 *
 * ── WHAT IT IS NOW ───────────────────────────────────────────────────
 *
 * The three survive, in the same order, because three is what this band
 * has always been and the words were never the problem. What is new is the
 * LADDER above them, which is the number the band was missing.
 *
 * See rewards/Roost.tsx: it is the product's own tier ladder, the same
 * metals and the same masked logo `TierRoost.tsx` uses, carrying the real
 * rates. Somebody who reads this and signs in meets the thing they were
 * shown rather than a drawing of it. That is the whole reason to spend the
 * band's one picture here rather than on another set of icons.
 *
 * ── THE GROUND ───────────────────────────────────────────────────────
 *
 * The same pair Agent and Surfaces carry, and the same one for the same
 * reason: flat white between them reads as a hole in the page rather than
 * as a surface, because there is nothing in it for light to fall across.
 * A third white band lit differently from the two above it shows the join.
 *
 * The ink is declared light on this scope, the mechanism every band here
 * uses, so every `text-lp-ink-2` inside resolves dark on light and
 * tokens.css stays the one place a colour is decided.
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

interface Way {
  readonly icon: RewardIconName;
  readonly title: string;
  readonly body: string;
  /* The line that carries the fact. Cashback's is the only one the ladder
     above already proves; the other two are the band's own claims and want
     real figures behind them before this ships. */
  readonly note: string;
}

const WAYS: readonly Way[] = [
  {
    icon: 'cashback',
    title: 'Cashback',
    body: 'Real cashback on every trade, paid as you go.',
    note: 'Base to platinum, 10% to 60% of your fees.',
  },
  {
    icon: 'quests',
    title: 'Quests',
    body: 'Daily quests that pay you to sharpen your edge.',
    note: 'A new set every day.',
  },
  {
    icon: 'invite',
    title: 'Invite rewards',
    body: 'Bring a trader. When they win, you both do.',
    note: 'You earn on their volume, for good.',
  },
];

export function Rewards() {
  return (
    <section id="rewards" style={LIGHT} className="relative isolate w-full bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      {/* The header's column, verbatim, the way Agent and Surfaces carry
          it, so every left edge on the page falls on one line. */}
      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[88px] lg:pt-[80px]">
        <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>Rewards</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              Trading pays
              <br /> you back
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>
            Cashback, quests and invite rewards. Earning is part of trading here, not a programme bolted onto it.
          </p>
        </div>

        {/* The ladder sits between the head and the three, and the space
            under it is deliberate: sitting straight on the hairline that
            starts the columns, it read as a bar with a border stuck to it
            rather than as its own object. */}
        <div className={`${SANS} mt-11 pb-10 lg:mt-14 lg:pb-[52px]`}>
          <Roost />
        </div>

        <div className="grid grid-cols-1 border-t border-lp-hairline lg:grid-cols-3">
          {WAYS.map((way, index) => (
            <div
              key={way.title}
              /* Vertical rules at `lg`, horizontal below it. A vertical
                 rule between stacked blocks divides nothing, and a
                 horizontal one between columns is a line through the
                 middle of the row. */
              className={[
                /* CENTRED WHEN STACKED, left aligned in columns.

                   Stacked, each of these is a full width block holding a
                   26px glyph, one short heading and two short lines, and
                   left aligning that leaves the icon marooned at the edge
                   of a band whose own axis is the middle of the phone.
                   In three columns the axis is the column, so it goes
                   back to the left edge at `lg`.

                   The LAST one drops its bottom padding, because the band
                   already carries 72px of its own underneath and the two
                   were stacking into a hole at the foot of the page. */
                'flex flex-col items-center py-9 text-center last:pb-0',
                'lg:items-start lg:py-10 lg:pl-10 lg:pr-10 lg:text-left lg:first:pl-0 lg:last:pr-0 lg:last:pb-0',
                index > 0 ? 'border-t border-lp-hairline lg:border-l lg:border-t-0' : '',
              ].join(' ')}
            >
              {/* No plate behind the glyph. It was a filled ink square with
                  a shadow, which made three small buttons out of three
                  statements. */}
              <RewardIcon name={way.icon} className="size-[26px] text-lp-ink-1" />
              <h3 className={`${SANS} mt-4 text-[21px] font-medium leading-[1.14] tracking-[-0.025em] text-lp-ink-1`}>
                {way.title}
              </h3>
              <p className={`${SANS} mx-auto mt-2 max-w-[40ch] text-[15.5px] leading-[24px] text-lp-ink-2 lg:mx-0`}>{way.body}</p>
              <p className={`${SANS} mt-3 text-[13.5px] leading-5 text-lp-ink-3`}>{way.note}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

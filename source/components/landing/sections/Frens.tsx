'use client';

import { useMemo, type CSSProperties } from 'react';

import { LightGround } from './agent/LightGround';
import './frens/frens.css';

/**
 * Frens — the board. The podium, then the rest.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * The Surfaces band: four things given equal billing that were never
 * equal. One of them was CONDITIONALS, which has an entire band of its
 * own two sections up, so the page was listing its own headline feature
 * as a quarter of a footnote. And socialized trading — twelve real people
 * and a scored leaderboard — got the same 46 character paragraph as
 * everything else.
 *
 * ── THE RANK IS DERIVED, NOT WRITTEN DOWN ────────────────────────────
 *
 * The rows are sorted by PnL at render, and the number beside each name
 * is its position in that sorted list. That is not a tidiness thing: the
 * fixture's own order put `evren` fifth on a board while `evren` is DOWN
 * 36 SOL and three people below were up. A leaderboard whose rank
 * disagrees with its own numbers is worse than no leaderboard, and a
 * hardcoded rank will disagree the first time a figure changes.
 *
 * ── UP IS GREEN, DOWN IS RED, AND BOTH ARE DARKENED ──────────────────
 *
 * #0F6D5F and #B4482E, which is the same pair the token search rows use
 * on white elsewhere in the product. The bright greens a trading UI
 * reaches for are built for dark grounds: #34D399 on paper lands under
 * 2:1 and stops being readable, which is a bug this codebase has already
 * shipped once.
 *
 * ── TWO OF THEM ARE DOWN ─────────────────────────────────────────────
 *
 * Kept deliberately, because the fixture is deliberate about it: a board
 * where everybody is up is a board nobody believes. Sorting just means
 * they are now where they belong, at the bottom.
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
  /* Readable on paper. See the note above about bright greens. */
  '--lp-up': '#0f6d5f',
  '--lp-down': '#b4482e',
} as CSSProperties;

interface Fren {
  readonly name: string;
  readonly bio: string;
  /** Lifetime PnL in SOL, signed. */
  readonly pnl: number;
  /** Best call, as the multiple it actually reads as. */
  readonly best: number;
  readonly ticker: string;
  readonly wins: number;
  readonly losses: number;
}

/* Straight out of the frens fixture in `sandbox/mockData.ts`. Written in
   the fixture's order; the board sorts it below. */
const FRENS: readonly Fren[] = [
  { name: 'Soren', bio: 'Momentum only. If it is not moving I am not looking.', pnl: 829.4, best: 12.4, ticker: 'TAU', wins: 38, losses: 6 },
  { name: 'aster', bio: 'Early on infra plays. Long horizons, few positions.', pnl: 449.2, best: 9.7, ticker: 'KIMBO', wins: 35, losses: 8 },
  { name: 'brixby', bio: 'Scalps the open, flat by noon.', pnl: 310.4, best: 7.9, ticker: 'MASH', wins: 33, losses: 9 },
  { name: 'delune', bio: 'Reads the chain, not the chat.', pnl: 238.5, best: 6.7, ticker: 'PONKE', wins: 30, losses: 11 },
  { name: 'evren', bio: 'Mostly wrong, occasionally very right.', pnl: -36, best: 5.8, ticker: 'GIGA', wins: 28, losses: 13 },
  { name: 'fenwick', bio: 'Size when it is obvious, nothing when it is not.', pnl: 164.8, best: 5.2, ticker: 'BRETT', wins: 25, losses: 15 },
  { name: 'grigg', bio: 'Meme structure and liquidity. Nothing else.', pnl: 143.5, best: 4.6, ticker: 'RATW', wins: 22, losses: 16 },
  { name: 'halcy', bio: 'Patient. Two or three calls a month.', pnl: 127.3, best: 4.2, ticker: 'SQPT', wins: 20, losses: 18 },
  { name: 'ibsen', bio: 'Fades every top signal he sees.', pnl: -58.5, best: 3.9, ticker: 'JF1U', wins: 18, losses: 20 },
  { name: 'jorvik', bio: 'Runs a basket, rebalances weekly.', pnl: 114.2, best: 3.6, ticker: 'XLDW', wins: 16, losses: 21 },
];

function sol(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} SOL`;
}

/** The one place the up and down colour is decided. */
function tone(pnl: number): string {
  return pnl < 0 ? 'text-[var(--lp-down)]' : 'text-[var(--lp-up)]';
}

export function Frens() {
  /* Sorted here rather than in the array, so the rank can never disagree
     with the figure printed next to it. */
  const board = useMemo(() => [...FRENS].sort((a, b) => b.pnl - a.pnl), []);
  const podium = board.slice(0, 3);
  const rest = board.slice(3);

  return (
    <section id="frens" data-lp-frens="" style={LIGHT} className="relative isolate w-full bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      {/* The header's column, so the eyebrow starts on the same line as
          the mark in the bar and the headline in every band around it. */}
      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[88px] lg:pt-[80px]">
        <div className="flex flex-col items-start gap-6 pb-11 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-12">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>Frens</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              Talk is cheap.
              <br /> PnL speaks.
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>
            Every call is timestamped and scored against what actually happened. Follow the ones who are right, and
            see the ones who are not.
          </p>
        </div>

        {/* The podium. Three across at EVERY width — see frens.css for
            what has to give at 375 to keep that shape. */}
        <div className="frens-podium">
          {podium.map((f, i) => (
            <div key={f.name}>
              <span className={`${SANS} frens-prank tabular-nums`}>{String(i + 1).padStart(2, '0')}</span>
              <p className={`${SANS} frens-pname`}>{f.name}</p>
              <p className={`${SANS} frens-ppnl tabular-nums ${tone(f.pnl)}`}>{sol(f.pnl)}</p>
              <p className={`${SANS} frens-pbio`}>{f.bio}</p>
              <p className={`${SANS} frens-pbest tabular-nums`}>
                Best call {f.best}x on {f.ticker} · {f.wins} wins, {f.losses} losses
              </p>
            </div>
          ))}
        </div>

        {/* Everybody else gets a line. It is how a leaderboard is actually
            read, and it lets the band show ten people without giving ten
            people equal room. */}
        <div className="frens-rest">
          {rest.map((f, i) => (
            <div key={f.name}>
              <i className={`${SANS} tabular-nums`}>{String(i + 4).padStart(2, '0')}</i>
              <b className={SANS}>{f.name}</b>
              <span className={`${SANS} tabular-nums`}>
                {f.best}x on {f.ticker}
              </span>
              <em className={`${SANS} tabular-nums ${tone(f.pnl)}`}>{sol(f.pnl)}</em>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`${SANS} mt-11 flex h-12 w-fit shrink-0 items-center rounded-full bg-lp-ink-1 px-7 text-[15px] font-medium leading-none text-white transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none lg:mt-12`}
        >
          Find your frens
        </button>
      </div>
    </section>
  );
}

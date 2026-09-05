'use client';

import { useMemo } from 'react';
import type { RefereeEntry, ReferralWindow } from '@/lib/api/referral';
import { lamportsToSol } from './primitives';
import './fren-board.css';

/**
 * Slice "Referral & Rewards": your frens, on the referral tab.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A panel titled `Your referrals · weekly` holding a three column table
 * — fren, volume, you earned — sitting in the left half of a two column
 * row, with the global leaderboard in the right half.
 *
 * Every row weighed the same as every other, on a list whose entire
 * point is that some frens are worth far more than others, and the
 * table ended at whatever the page happened to fetch with no statement
 * of what the rest of them add up to.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────
 *
 * Hierarchy laid out SIDEWAYS. The top fren takes the left half at
 * display size, and everyone else runs down the right in one dense
 * column.
 *
 * The reason it is sideways rather than stacked: this section is the
 * same height whether you have ten frens or a thousand. Every stacked
 * arrangement grows with the list, and a referral list is the one thing
 * on this page that has no upper bound.
 *
 * ── THE LAST ROW IS THE POINT ────────────────────────────────────────
 *
 * A referral list is ten people and then however many hundreds. The old
 * table simply stopped; the usual fix is `and 1,014 more` in grey,
 * which names a count and drops the money on a page whose subject is
 * the money.
 *
 * So the tail carries the count AND the combined total those frens paid
 * you, set in the same column as every figure above it. At any real
 * number of frens it is the largest figure in the section, which is the
 * true shape of a referral book.
 *
 * It is a row and not a control. It had a chevron and a hover plate,
 * which promised a screen behind it that does not exist.
 *
 * ── NO COLOUR ────────────────────────────────────────────────────────
 *
 * There was a movement caret per row, red or green. That put a column
 * of colour down the middle of a section whose subject is the figure at
 * the far end, and green and red mean a GAIN and a LOSS everywhere else
 * in this product. None of these rows is either.
 */

interface Props {
  readonly referees: ReadonlyArray<RefereeEntry>;
  /** Every fren in the window, including the ones not in `referees`. */
  readonly totalCount: number;
  /** Everything earned in the window, in lamports. */
  readonly totalEarnedLamports: string;
  readonly window: ReferralWindow;
}

/** Ten drawn: one featured and nine in the column. */
const DRAWN = 10;

/*
 * ── THE METAL IS WHAT THEY PAID YOU ──────────────────────────────────
 *
 * Cashback strikes the owl by the tier you reached; points strikes it
 * by what an accolade is worth. This tab had no colour at all and sat
 * flat beside them, and the same rule transfers without being bent: a
 * fren board is already sorted by worth, so worth is what the metal
 * says here too.
 *
 * BY EARNINGS, NOT BY RANK. A rank metal would always show exactly one
 * gold and would look tidier, but a fren's mark would then change
 * because SOMEBODY ELSE traded — your second place drops to bronze when
 * a stranger overtakes them. On earnings a fren only ever moves on
 * their own activity, which is what a metal means on the other two
 * tabs: a cashback tier and an accolade bonus are both absolute.
 *
 * The thresholds below are tuned to look right against the fixture and
 * are the part of this worth revisiting once there is real referral
 * volume to look at. If most frens land on one metal, they are wrong.
 */
const METALS: ReadonlyArray<string> = [
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #98a1aa 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #d29155 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #dbe2e8 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #eccb63 46%, #c09220 66%, #6b4806 100%)',
  'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #cbe6f6 45%, #6fa9d2 68%, #315a80 100%)',
];

/** The cashback ladder's own names, so the two systems agree. */
const METAL_NAMES = ['Base', 'Bronze', 'Silver', 'Gold', 'Platinum'] as const;

function metalIndex(sol: number): number {
  if (sol >= 2) return 4;
  if (sol >= 1) return 3;
  if (sol >= 0.5) return 2;
  if (sol >= 0.25) return 1;
  return 0;
}

const sol4 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
/* Two digits always. A board that runs past nine and prints `9` then
   `10` shifts every name on the row below it. */
const two = (n: number) => String(n).padStart(2, '0');

export function FrenBoard(props: Props): React.ReactElement {
  const ranked = useMemo(() => {
    /*
     * Sorted by what they PAID YOU, not by their volume. The two mostly
     * agree, and where they disagree the fee is the one this section is
     * ranking: a fren trading a different pair at a different fee can
     * out-earn one who traded more.
     */
    return [...props.referees]
      .map((r) => ({
        who: r.label,
        vol: lamportsToSol(r.volumeLamports),
        earned: lamportsToSol(r.referralFeeLamports),
      }))
      .sort((a, b) => b.earned - a.earned);
  }, [props.referees]);

  /*
   * ── TWO EMPTY STATES, NOT ONE ────────────────────────────────────
   *
   * This was a single grey line: `No referral activity in this window
   * yet.` It told the person with fourteen frens who had a quiet week
   * exactly what it told the person who has never had one, and those
   * are completely different situations — one is a link that has not
   * worked, the other is a link that worked fine.
   *
   * `totalCount` already knows which. It is either zero or it is not.
   *
   * The mark is the owl each fren carries in this list, drawn once and
   * held right back: the shape of the thing that is missing. It is not
   * here because the logo looks good — a board of frens is a board of
   * these, and an empty one is one of them with nobody in it.
   */
  if (ranked.length === 0) {
    const never = props.totalCount === 0;
    return (
      <div className="frb-none">
        <span className="frb-owl frb-owl-lg frb-owl-ghost" aria-hidden />
        <div>
          <b>{never ? 'No frens yet' : 'Nobody traded this week'}</b>
          <p>
            {never
              ? 'Anyone who joins through your link is yours, and you earn on every trade they ever make. It does not expire and it does not cap.'
              : `You have ${props.totalCount.toLocaleString()} ${props.totalCount === 1 ? 'fren' : 'frens'}, and none of them traded in this window. Try a longer one.`}
          </p>
        </div>
      </div>
    );
  }

  const top = ranked[0]!;
  const shown = ranked.slice(1, DRAWN);

  /*
   * The tail is derived rather than fetched: the endpoint returns a page
   * of referees and the window's totals separately, so what is left is
   * the total minus what is drawn.
   *
   * Both are floored at zero. If a total ever lags the rows behind it —
   * a cache serving one and not the other — a negative count or a
   * negative SOL figure on screen is worse than no line at all.
   */
  const drawnEarned = ranked.slice(0, DRAWN).reduce((s, r) => s + r.earned, 0);
  const restCount = Math.max(0, props.totalCount - Math.min(DRAWN, ranked.length));
  const restEarned = Math.max(0, lamportsToSol(props.totalEarnedLamports) - drawnEarned);

  return (
    <div className="frb">
      <div className="frb-top">
        <span className="frb-lab">Top fren, {props.window}</span>
        {/* The mark sits BESIDE the name rather than above it, so the
            medal reads as belonging to the person instead of floating
            over the block. */}
        <div className="frb-medal">
          <span
            className="frb-owl frb-owl-lg"
            aria-hidden
            style={{ background: METALS[metalIndex(top.earned)] }}
          />
          <div>
            <div className="frb-top-nm">{top.who}</div>
            <div className="frb-top-e">
              {sol4(top.earned)}
              <span className="frb-top-u">SOL to you</span>
            </div>
            <span className="frb-metal">{METAL_NAMES[metalIndex(top.earned)]}</span>
          </div>
        </div>
        <span className="frb-dim">
          from {top.vol.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL traded
        </span>
      </div>

      <div className="frb-list">
        {shown.map((f, i) => (
          <div className="frb-row" key={`${f.who}-${i}`}>
            {/* The rank leads the row. The featured fren has taken
                position one out of this column, so without a numeral it
                starts at an unlabelled second place and nothing ties it
                to the name beside it.
                
                It stays even though the row now carries a metal,
                because here the metal is EARNINGS and not position —
                the two say different things, so neither is a second
                copy of the other. On a rank keyed metal the numeral
                would be redundant and would go. */}
            <span className="frb-rk">{two(i + 2)}</span>
            <span
              className="frb-owl"
              aria-hidden
              style={{ background: METALS[metalIndex(f.earned)] }}
            />
            <span className="frb-nm">{f.who}</span>
            <span className="frb-num">{sol4(f.earned)}</span>
          </div>
        ))}

        {restCount > 0 ? (
          /* No numeral in front of it: this is not a position, it is
             everybody after the tenth. */
          <div className="frb-rest">
            <span className="frb-rest-n">
              {restCount.toLocaleString()} more {restCount === 1 ? 'fren' : 'frens'}
            </span>
            <span className="frb-rest-e">{sol4(restEarned)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

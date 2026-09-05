'use client';

import { lamportsStringToNumber } from '@/lib/format';
import type { CashbackMe } from '@/lib/api/cashback';
import './tier-roost.css';

/**
 * Slice "Cashback": the tier ladder, as a roost of owls.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A rail with five hue coded pips on it, under a 96px ghost word of the
 * current tier's name set in that tier's own colour, with a coin drawn
 * at the summit. Every tier had an arbitrary hue, so the page taught a
 * colour code before it could tell you anything: you had to learn that
 * cyan meant silver before the screen said a word.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────
 *
 * Five owls in a row, each struck in the metal it is named after, read
 * the way stripes on a sleeve are read.
 *
 * A metal is not a code. Bronze IS bronze, and nobody needs telling
 * that gold outranks it or has to consult a legend. The colour carries
 * the meaning directly rather than standing in for it, which is the
 * same test the portfolio chart's green and red pass. That is why this
 * page spends colour where the rest of the product does not.
 *
 * The mark is `/assets/logo.svg` applied as a CSS mask — the technique
 * `BrandMark.tsx` uses for the nav — so the crest and the logo are one
 * file and cannot drift apart, and the metal is simply the background
 * showing through the silhouette.
 */

/*
 * ── THE METALS ───────────────────────────────────────────────────────
 *
 * Keyed by INDEX, not by name. The tier keys have already changed once
 * in this product's life (`clay` through `owl` before the current
 * base/bronze/silver/gold/platinum), and a lookup on the name would
 * silently fall back to grey the next time they change. The endpoint
 * returns the ladder in order, so position is the reliable key.
 *
 * Each ramp is dark edge, body, a tight specular band, body again,
 * darker foot. Five stops rather than two, because two stops make a
 * coloured shape and it is the narrow bright band that makes an eye
 * read metal.
 *
 * ── THE SPECULAR BAND IS NOT NEARLY WHITE ANY MORE ───────────────────
 *
 * On a black page the bright stop could go almost to paper and still
 * read as a highlight, because everything around it was dark. Over
 * white it IS the page: silver's and platinum's bands were holes
 * punched through the middle of each bird. Every band comes down a
 * step so the metal still turns on a ground that is now light. The
 * same three ramps are shared by the accolade medals and the fren
 * board, and they moved together.
 */
const METALS: ReadonlyArray<string> = [
  /* Steel. The plainest working metal, so the ladder starts somewhere
     honest and every rung above it is warmer or brighter. Iron went
     darker than the page's own hairline and read as absent. */
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, var(--d-tierroost-1, #98a1aa) 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, var(--d-tierroost-2, #d29155) 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, var(--d-tierroost-3, #dbe2e8) 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, var(--d-tierroost-4, #dfb646) 46%, #c09220 66%, #6b4806 100%)',
  /* Icy blue rather than a brighter silver. The top rung has to be
     unmistakable at 30px beside a metal that is also pale and also
     cool, and a blue platinum is a convention rank ladders already
     taught everybody. */
  'linear-gradient(145deg, #3d6d96 0%, var(--d-tierroost-5, #6fb1dc) 27%, var(--d-tierroost-6, #a5d0ea) 45%, #6fa9d2 68%, #315a80 100%)',
];

/** Past the table, the top metal repeats rather than falling to grey. */
const metalAt = (i: number) => METALS[Math.min(i, METALS.length - 1)]!;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  readonly me: CashbackMe;
  /** The rate actually being paid, which a partner override can raise. */
  readonly effectiveBps: number;
}

/*
 * ── THE RAIL ─────────────────────────────────────────────────────────
 *
 * One bar, the full width of the roost.
 *
 * It measures the BAND you are in, not the ladder. That distinction is
 * the whole reason this function exists: the bands are 250, 750, 1,500
 * and 7,500 SOL wide, so a bar scaled to platinum's threshold would put
 * four of the five tiers inside its first quarter and show somebody
 * most of the way through silver a fill at 13%.
 *
 * Against the band it reads true — 19% of the way from silver to gold —
 * and the sentence under it names which two rungs that is between, so
 * the bar never has to carry that on its own.
 */
function bandFill(me: CashbackMe): number {
  const at = me.tier.index;
  const lo = lamportsStringToNumber(me.tiers[at]?.minVolumeLamports ?? '0') ?? 0;
  const hi = lamportsStringToNumber(me.nextTier?.minVolumeLamports ?? '0') ?? 0;
  const now = lamportsStringToNumber(me.lifetimeVolumeLamports) ?? 0;

  /* At the top of the ladder there is no next rung, so the bar is full
     rather than dividing by zero and painting an empty one on the
     person who has finished. */
  if (!me.nextTier) return 1;
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (now - lo) / (hi - lo)));
}

export function TierRoost(props: Props): React.ReactElement {
  const at = props.me.tier.index;

  return (
    <div className="trs" role="img" aria-label={`Tier ${props.me.tier.key}`}>
      {props.me.tiers.map((t, i) => (
        <div className="trs-c" key={t.key} data-on={i === at ? '' : undefined}>
          {/*
           * The rungs ahead keep their own metal at low opacity rather
           * than turning into grey silhouettes. Half the point of a
           * ladder is wanting the next one, and you cannot want gold if
           * gold is drawn as a blank until the day you reach it.
           *
           * 0.62, and the pale metals deepened to match. A quarter
           * strength reads over black and vanishes over white, and
           * even at 42% gold and platinum — the two palest ramps, and
           * the two rungs this ladder exists to sell — were the
           * faintest things on the tab. They are quieter than the rung
           * you are on, which is at full strength and drawn larger,
           * and that is the whole distinction they need.
           */}
          <span
            className="trs-owl"
            aria-hidden
            style={{
              width: i === at ? 60 : 46,
              height: i === at ? 60 : 46,
              background: metalAt(i),
              opacity: i > at ? 0.62 : 1,
            }}
          />
          <span className="trs-k">{cap(t.key)}</span>
          <span className="trs-p">{Math.round(t.cashbackBps / 100)}%</span>
        </div>
      ))}

      <div className="trs-rail" aria-hidden>
        <i style={{ width: `${bandFill(props.me) * 100}%` }} />
      </div>
    </div>
  );
}

/** The one line under the roost: where you are and what closes the gap. */
export function TierLine({
  me,
  effectiveBps,
  remaining,
}: {
  me: CashbackMe;
  effectiveBps: number;
  remaining: string | null;
}): React.ReactElement {
  if (!me.nextTier || remaining === null) {
    return (
      <p className="trs-say">
        <b>{cap(me.tier.key)}</b> is the top of the ladder, at{' '}
        {Math.round(effectiveBps / 100)}% back.
      </p>
    );
  }
  return (
    <p className="trs-say">
      <b>{remaining} SOL</b> of volume to {cap(me.nextTier.key)}, which pays{' '}
      {Math.round(me.nextTier.cashbackBps / 100)}% back.
    </p>
  );
}

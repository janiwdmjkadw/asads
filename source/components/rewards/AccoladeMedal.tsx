'use client';

import { useState } from 'react';
import { useClaimAccolade, type Accolade } from '@/lib/api/cashback';
import './accolade-medal.css';

/**
 * Slice "Points": one accolade, as a medal.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A bordered tile with an inset etch, a coloured status strip signing
 * its top edge, an SVG progress ring in a gradient, a tinted icon tile,
 * a `+N pts` chip and a Claim button. Three colour systems and five
 * decorations per accolade, six to a screen.
 *
 * Then, briefly, a plain row — which lost the Claim button along with
 * the tile and left two accolades announcing they were collectable
 * with nothing to press. That is fixed here.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────
 *
 * The product's own owl, struck in a metal, with the metal set by what
 * the accolade is WORTH.
 *
 * The mark is `/assets/logo.svg` as a CSS mask, the same technique
 * `BrandMark.tsx` uses for the nav and `TierRoost` uses for the tier
 * ladder, so all three are one file and cannot drift apart.
 */

/*
 * ── THE METAL IS THE PRICE ───────────────────────────────────────────
 *
 * Higher bonus, better metal. `Ten Thousand` is worth 2,500 points and
 * is struck in platinum; `First Trade` is worth 100 and is base.
 *
 * This is the same palette the cashback ladder uses, and it is doing
 * the same job in both places: saying how much something is worth
 * without a number having to be read first. It is not a code — nobody
 * has to be taught that gold beats bronze.
 *
 * Thresholds rather than a rank over the current list. A rank would
 * repaint every medal the day a new accolade is added, and an accolade
 * you already collected changing metal is a lie about what you earned.
 */
const METALS: ReadonlyArray<string> = [
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #98a1aa 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #d29155 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #dbe2e8 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #eccb63 46%, #c09220 66%, #6b4806 100%)',
  'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #cbe6f6 45%, #6fa9d2 68%, #315a80 100%)',
];

/*
 * The cashback ladder's own names. The lowest is `Base`, not `Steel` —
 * I had invented a word for it, which put a sixth rank name into a
 * product that already has five and made the two systems disagree
 * about the same metal.
 */
const NAMES = ['Base', 'Bronze', 'Silver', 'Gold', 'Platinum'] as const;

/** Base under 250, then bronze, silver, gold, platinum at 2,500. */
function metalIndex(points: number): number {
  if (points >= 2500) return 4;
  if (points >= 1000) return 3;
  if (points >= 500) return 2;
  if (points >= 250) return 1;
  return 0;
}

export function AccoladeMedal({ accolade: a }: { accolade: Accolade }): React.ReactElement {
  const claim = useClaimAccolade();
  const [justClaimed, setJustClaimed] = useState(false);

  const claimable = a.status === 'unlocked' && !justClaimed;
  const claimed = a.status === 'claimed' || justClaimed;
  const pct = Math.round(Math.min(Math.max(a.progress, 0), 1) * 100);

  const onClaim = () => {
    if (!claimable || claim.isPending) return;
    claim.mutate(a.key, {
      onSuccess: (res) => {
        if (res.kind === 'ok') setJustClaimed(true);
      },
    });
  };

  const m = metalIndex(a.bonusPoints);

  return (
    <div className="acm" data-ready={claimable ? '' : undefined} data-locked={!claimed && !claimable ? '' : undefined}>
      {/*
       * A locked medal keeps its own metal at low opacity rather than
       * turning grey. Half the point of showing an accolade you have
       * not earned is wanting it, and you cannot want the platinum one
       * if it is drawn as a blank until the day you get it.
       */}
      <span
        className="acm-owl"
        aria-hidden
        style={{ background: METALS[m], opacity: claimed || claimable ? 1 : 0.24 }}
      />

      <span className="acm-n">{a.name}</span>
      <span className="acm-d">{a.description}</span>

      <span className="acm-p">
        +{a.bonusPoints.toLocaleString()}
        {/* The metal's name, so the ranking is legible rather than
            something you have to infer from the colour alone. */}
        <em>{NAMES[m]}</em>
      </span>

      {claimable ? (
        <button type="button" className="acm-go" onClick={onClaim} disabled={claim.isPending}>
          {claim.isPending ? 'Claiming…' : 'Claim'}
        </button>
      ) : claimed ? (
        <span className="acm-s">Collected</span>
      ) : (
        /* Progress under the locked ones only. A claimed accolade is at
           100% forever, and a full bar on it reads as something still
           running. */
        <span className="acm-bar" aria-label={`${pct}% complete`}>
          <i style={{ width: `${pct}%` }} />
          <u>{pct}%</u>
        </span>
      )}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import './fren-metal-variants.css';

/*
 * ── REFERRAL · BRINGING THE METAL OVER ───────────────────────────────
 *
 * Cashback and Points both spend colour, and both spend it the same
 * way: the owl struck in a metal, and the metal says WORTH. A tier you
 * reached, an accolade's bonus. Referral has none of it and sits flat
 * beside them.
 *
 * The language transfers honestly, and that is the whole argument for
 * doing this rather than inventing a third system. A fren board is
 * ranked by what each person paid you — worth is literally what the
 * column sorts on — so the same rule applies without being bent.
 *
 * What is NOT allowed is a hue per fren for its own sake. I argued that
 * out earlier and it still holds: five frens are five instances of one
 * thing, and five arbitrary colours would claim they are five
 * categories. A metal is a rank, which is different.
 *
 *   1  Medal    only the top fren is struck; the list stays plain
 *   2  Ranked   metal by POSITION — first gold, second silver, third
 *               bronze, everyone else base
 *   3  Earned   metal by what they actually paid you, on thresholds
 */

const METALS = [
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #e0a066 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #f4f7fa 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)',
  'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #e8f7ff 45%, #6fa9d2 68%, #315a80 100%)',
];
const NAMES = ['Base', 'Bronze', 'Silver', 'Gold', 'Platinum'];

interface Fren {
  readonly rank: number;
  readonly who: string;
  readonly earned: number;
}

const TOP: Fren = { rank: 1, who: 'aster', earned: 2.7 };
const REST: ReadonlyArray<Fren> = [
  { rank: 2, who: 'brixby', earned: 1.4 },
  { rank: 3, who: 'you', earned: 0.9667 },
  { rank: 4, who: 'delune', earned: 0.75 },
  { rank: 5, who: 'evren', earned: 0.62 },
  { rank: 6, who: 'fenwick', earned: 0.5333 },
  { rank: 7, who: 'grigg', earned: 0.4714 },
  { rank: 8, who: 'halcy', earned: 0.425 },
  { rank: 9, who: 'ibsen', earned: 0.3889 },
];

/*
 * ── TWO WAYS TO PICK THE METAL, AND THEY BEHAVE DIFFERENTLY ──────────
 *
 * BY RANK is stable to look at and unstable in meaning: there is always
 * exactly one gold, so the board always looks the same, and a fren's
 * metal changes when SOMEBODY ELSE trades. Second place drops to bronze
 * because a stranger overtook them.
 *
 * BY EARNINGS is the opposite: a fren's metal only ever moves on their
 * own activity, which is what the rest of the product means by a metal
 * — the cashback tier and the accolade bonus are both absolute. The
 * cost is that a quiet week can leave every fren on base.
 */
const byRank = (rank: number) => (rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0);

const byEarned = (sol: number) => (sol >= 2 ? 4 : sol >= 1 ? 3 : sol >= 0.5 ? 2 : sol >= 0.25 ? 1 : 0);

const sol = (v: number) => v.toFixed(4);
const two = (v: number) => String(v).padStart(2, '0');

function Owl({ size, m, dim }: { size: number; m: number; dim?: boolean }) {
  return (
    <span
      className="fm-owl"
      aria-hidden
      style={{ width: size, height: size, background: METALS[m], opacity: dim ? 0.7 : 1 }}
    />
  );
}

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="fm-slot">
      <div className="fm-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="fm-frame">{children}</div>
    </div>
  );
}

/* ── 1 ── MEDAL ───────────────────────────────────────────────────────
 * Only the featured fren is struck, at display size, and the list stays
 * exactly as it is. One coloured object on the tab, the way the roost
 * is one coloured object on cashback. */
function Medal() {
  return (
    <div className="fm-beside">
      <div>
        <span className="fm-lab">Top fren this week</span>
        <div className="fm-medal">
          <Owl size={64} m={byEarned(TOP.earned)} />
          <div>
            <div className="fm-nm">@{TOP.who}</div>
            <div className="fm-e">
              {sol(TOP.earned)}
              <span className="fm-u">SOL to you</span>
            </div>
          </div>
        </div>
        <span className="fm-dim">from 920 SOL traded</span>
      </div>
      <div className="fm-list">
        {REST.map((f) => (
          <div className="fm-row" key={f.who}>
            <span className="fm-rk">{two(f.rank)}</span>
            <span className="fm-n">@{f.who}</span>
            <span className="fm-num">{sol(f.earned)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 2 ── RANKED ──────────────────────────────────────────────────────
 * Podium metals down the list: first gold, second silver, third bronze,
 * everyone else base. The board always looks the same, which is either
 * the appeal or the tell. */
function Ranked() {
  return (
    <div className="fm-beside">
      <div>
        <span className="fm-lab">Top fren this week</span>
        <div className="fm-medal">
          <Owl size={64} m={byRank(TOP.rank)} />
          <div>
            <div className="fm-nm">@{TOP.who}</div>
            <div className="fm-e">
              {sol(TOP.earned)}
              <span className="fm-u">SOL to you</span>
            </div>
          </div>
        </div>
        <span className="fm-dim">from 920 SOL traded</span>
      </div>
      <div className="fm-list">
        {REST.map((f) => (
          <div className="fm-row fm-row-owl" key={f.who}>
            <Owl size={20} m={byRank(f.rank)} dim={f.rank > 3} />
            <span className="fm-n">@{f.who}</span>
            <span className="fm-num">{sol(f.earned)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 3 ── EARNED ──────────────────────────────────────────────────────
 * Metal by what they actually paid you, on thresholds. A fren's mark
 * only ever moves on their own trading, which is what a metal means
 * everywhere else in this product. */
function Earned() {
  return (
    <div className="fm-beside">
      <div>
        <span className="fm-lab">Top fren this week</span>
        <div className="fm-medal">
          <Owl size={64} m={byEarned(TOP.earned)} />
          <div>
            <div className="fm-nm">@{TOP.who}</div>
            <div className="fm-e">
              {sol(TOP.earned)}
              <span className="fm-u">SOL to you</span>
            </div>
            <span className="fm-metal">{NAMES[byEarned(TOP.earned)]}</span>
          </div>
        </div>
      </div>
      <div className="fm-list">
        {REST.map((f) => (
          <div className="fm-row fm-row-owl" key={f.who}>
            <Owl size={20} m={byEarned(f.earned)} />
            <span className="fm-n">@{f.who}</span>
            <span className="fm-num">{sol(f.earned)}</span>
          </div>
        ))}
        <div className="fm-more">
          <span>5 more frens</span>
          <span className="fm-num">4.3447</span>
        </div>
      </div>
    </div>
  );
}

export function FrenMetalVariants() {
  return (
    <div className="fm">
      <h2>REFERRAL · BRINGING THE METAL OVER</h2>
      <p className="fm-note">
        Cashback and Points both spend colour the same way: the owl struck in a metal, and the metal
        says worth. Referral has none and sits flat beside them. The language transfers honestly
        rather than needing a third system invented, because a fren board is already ranked by what
        each person paid you.
      </p>
      <p className="fm-note">
        The choice underneath is what sets the metal. By RANK the board always looks the same and
        there is always exactly one gold, but a fren drops a metal because somebody else traded. By
        EARNINGS a fren only ever moves on their own activity, which is what a metal means on the
        other two tabs, at the cost of a quiet week leaving everybody on base.
      </p>

      <div className="fm-stack">
        <Slot i={1} name="Medal" note="only the top fren is struck; the list stays plain">
          <Medal />
        </Slot>
        <Slot i={2} name="Ranked" note="first gold, second silver, third bronze, rest base">
          <Ranked />
        </Slot>
        <Slot i={3} name="Earned" note="metal by what they actually paid you">
          <Earned />
        </Slot>
      </div>
    </div>
  );
}

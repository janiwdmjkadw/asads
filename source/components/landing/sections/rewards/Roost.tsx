import './roost.css';

/**
 * The tier ladder, as a roost of owls.
 *
 * This is not a landing page invention. `components/rewards/TierRoost.tsx`
 * already draws the ladder exactly this way inside the product, and the
 * two have to be the same object: somebody who reads this band and then
 * signs in should meet the thing they were shown, not a marketing drawing
 * of it. So the metals below are copied out of `tier-roost.css` character
 * for character, and the mark is the real logo rather than an icon of one.
 *
 * ── THE NUMBERS ARE REAL ─────────────────────────────────────────────
 *
 * Base 10, Bronze 18, Silver 25, Gold 40, Platinum 60, out of the cashback
 * fixture. Not a scale invented to look like a scale.
 *
 * ── AND THE VOLUME IS NOT ON IT ──────────────────────────────────────
 *
 * What it costs to climb a rung is a number that changes, means nothing to
 * somebody who has not traded yet, and turns a bar into a table. The rungs
 * and the rates are the whole claim. Everything else about the ladder
 * lives on the rewards page, which is where somebody who cares is going.
 */

/*
 * Five stops each rather than two, because two stops make a coloured shape
 * and it is the narrow bright band that makes an eye read metal.
 *
 * Keyed by POSITION, like the product's copy is, not by tier name. The
 * keys have already changed once in this product's life (`clay` through
 * `owl` before the current base through platinum) and a lookup on the name
 * would quietly fall back to grey the next time they change.
 */
const METALS: readonly string[] = [
  /* Steel. The plainest working metal, so the ladder starts somewhere
     honest and every rung above it is warmer or brighter. */
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #e0a066 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #f4f7fa 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)',
  /* Icy blue rather than a brighter silver. The top rung has to be
     unmistakable beside a metal that is also pale and also cool. */
  'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #e8f7ff 45%, #6fa9d2 68%, #315a80 100%)',
];

const TIERS: ReadonlyArray<readonly [string, string]> = [
  ['Base', '10%'],
  ['Bronze', '18%'],
  ['Silver', '25%'],
  ['Gold', '40%'],
  ['Platinum', '60%'],
];

/*
 * The rail stops under Silver, the middle owl.
 *
 * The row is `space-between`, so the middle owl's centre IS 50% of the
 * rail's width. The two line up exactly without either being told about
 * the other, and they stay lined up at every width.
 */
const FILL = 50;

export function Roost() {
  return (
    <div data-lp-roost="">
      <div className="rst-row">
        {TIERS.map(([name, rate], index) => (
          <div className="rst-c" key={name}>
            <span className="rst-owl" aria-hidden style={{ background: METALS[index] }} />
            <span className="rst-p">{rate}</span>
            <span className="rst-k">{name}</span>
          </div>
        ))}
      </div>

      {/* The owls say what the rungs are. The rail says it is a thing you
          move along, which five separate marks on their own do not: without
          it they read as a legend rather than as a ladder. */}
      <div className="rst-rail" aria-hidden>
        <i style={{ width: `${FILL}%` }} />
        <b style={{ left: `${FILL}%` }} />
      </div>

      <p className="rst-say">
        Five tiers. The rate climbs with your lifetime volume across every wallet, and never resets.
      </p>
    </div>
  );
}

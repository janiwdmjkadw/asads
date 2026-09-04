'use client';

import './rewards-variants.css';

/*
 * ── REWARDS · ONE DESIGN ─────────────────────────────────────────────
 *
 * Not three. The last sheet was one black plate submitted three times
 * with the furniture moved, and the third differed by a blue label and
 * nothing else. That is the same failure as five identical wallet
 * tables, and calling them variants does not make them variants.
 *
 * So: one, built properly, with the two things that were actually wrong
 * fixed rather than restated.
 *
 * ── WHAT WAS TOO SIMPLE ──────────────────────────────────────────────
 *
 * A black rectangle with a big number in it. Restraint is not the same
 * as absence: the products this is measured against are restrained AND
 * have craft under the restraint, and I shipped the restraint on its
 * own. What was missing is material.
 *
 * So the banner is now a SURFACE rather than a hole:
 *
 *   It sits a shade above the page rather than being the same black, so
 *   it is an object with an edge instead of a region of nothing.
 *
 *   A one pixel light along its top edge. This is how a real raised
 *   surface behaves and it is the entire reason a card looks made
 *   rather than drawn.
 *
 *   A slow vertical falloff, lighter at the top, so the plate has a
 *   direction. Two percent of white, which you feel and do not see.
 *
 *   The figure is 76px against an 11px label, and the tracking closes
 *   as the size grows.
 *
 * No gradient, no glow, no coloured field. Every one of those is one
 * material doing the work of composition.
 *
 * ── AND THE FRENS LIST ───────────────────────────────────────────────
 *
 * It was five grey discs, five names and four columns of figures with a
 * thin line floating under each row. The discs carried nothing, the
 * floating line belonged to no column, and every row weighed the same
 * as every other, so a list whose whole point is that some frens are
 * worth more than others said nothing about which.
 *
 * Now the share IS the row. Each row is filled from the left in
 * proportion to what that fren paid you, so the shape of the list is
 * the answer, and the rank sits where the dead disc used to.
 */

/*
 * `move` is places gained or lost since last week. It is the thing that
 * makes a list a LEADERBOARD rather than a sorted table: a ranking with
 * no movement in it is just an order, and the reason anybody looks at a
 * board twice is to see what changed.
 */
const FRENS = [
  { rank: 1, who: 'aster', vol: '412.80', earned: '0.8256', share: 32, move: 2 },
  { rank: 2, who: 'brixby', vol: '308.15', earned: '0.6163', share: 24, move: -1 },
  { rank: 3, who: 'delune', vol: '204.44', earned: '0.4089', share: 16, move: 0 },
  { rank: 4, who: 'evren', vol: '188.90', earned: '0.3778', share: 15, move: 3 },
  { rank: 5, who: 'fenwick', vol: '170.21', earned: '0.3404', share: 13, move: -2 },
];

/*
 * ── THE PODIUM, WITHOUT MEDALS ───────────────────────────────────────
 *
 * The top three are told apart by the BRIGHTNESS of their rank numeral
 * and nothing else. No gold, no silver, no bronze, no trophy: this is a
 * list of people paying you money, and dressing it as a sports result
 * is the fastest way to make a finance screen look like a game.
 *
 * One ink, three steps of it, and the fourth step carries everyone
 * else. The eye finds the top of the board without being told.
 */
function rankInk(rank: number): string {
  if (rank === 1) return '#ffffff';
  if (rank === 2) return 'rgba(255, 255, 255, 0.62)';
  if (rank === 3) return 'rgba(255, 255, 255, 0.42)';
  return 'rgba(255, 255, 255, 0.26)';
}

/* Places gained or lost. `--up` and `--down` are honest here: they mean
   a gain and a loss everywhere else in the product, and moving up a
   board is a gain. A fren who held their place gets a dash rather than
   a zero, because zero is a quantity and this is an absence. */
function Move({ n }: { n: number }) {
  if (n === 0) return <span className="rw-move rw-move-flat">·</span>;
  const up = n > 0;
  return (
    <span className={up ? 'rw-move rw-move-up' : 'rw-move rw-move-down'}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
        <path d={up ? 'M4 1 L7.4 6.4 H0.6 Z' : 'M4 7 L0.6 1.6 H7.4 Z'} fill="currentColor" />
      </svg>
      {Math.abs(n)}
    </span>
  );
}

function Banner() {
  return (
    <div className="rw-bn">
      <div className="rw-bn-in">
        <div>
          <span className="rw-lab">Claimable</span>
          {/* The decimals set back, the way the portfolio dims its
              cents: both halves are true, the second is secondary, and
              holding it back is what lets the first be read rather than
              parsed. */}
          <div className="rw-total rw-total-xl">
            2<span className="rw-dimdec">.4181</span>
            <span className="rw-unit">SOL</span>
          </div>
          <div className="rw-bn-sub">
            <span className="rw-up">+2.5690 SOL</span>
            <span className="rw-quiet">this week from 14 frens</span>
          </div>
        </div>

        <div className="rw-bn-r">
          <button type="button" className="rw-go rw-go-lg">
            Claim
          </button>
          <span className="rw-quiet">0.3106 SOL still pending</span>
        </div>
      </div>
    </div>
  );
}

export function RewardsVariants() {
  return (
    <div className="rw">
      <h2>REWARDS · ONE DESIGN</h2>
      <p className="rw-note">
        One, not three. The last sheet was the same black plate submitted three times with the
        furniture moved. The banner is a surface now rather than a hole: a shade above the page, a
        one pixel light along its top edge, and a slow falloff so it has a direction. That is what
        was missing, and it is material rather than colour. The frens list is rebuilt underneath.
      </p>

      <div className="rw-slot">
        <div className="rw-frame rw-frame-flush">
          <Banner />

          <div className="rw-p">
            <div className="rw-tabs">
              <button type="button" data-on>
                Referral
              </button>
              <button type="button">Cashback</button>
              <button type="button">Points</button>
            </div>

            <div className="rw-inv">
              <div className="rw-inv-l">
                <span className="rw-lab">Your fren link</span>
                <div className="rw-inv-url">
                  <span className="rw-inv-b">listen.local/fren/</span>
                  <span className="rw-inv-s">designer</span>
                </div>
                <div className="rw-actions">
                  <button type="button" className="rw-go">
                    Copy link
                  </button>
                  <span className="rw-quiet">
                    You earn 20% of the 1% fee on every trade they make
                  </span>
                </div>
              </div>
              <div className="rw-qr rw-qr-lg">
                <div className="rw-qr-box" aria-hidden />
                <span className="rw-quiet">Scan to join</span>
              </div>
            </div>

            <div className="rw-rule" />

            <div className="rw-sec">
              Fren leaderboard<small>14 frens, this week</small>
            </div>

            <div className="rw-fh">
              <span>Fren</span>
              <span>Volume</span>
              <span>You earned</span>
            </div>

            <div className="rw-roll">
              {FRENS.map((f) => (
                <div className="rw-roll-r" key={f.who}>
                  {/*
                   * The share IS the row. Filled from the left in
                   * proportion to what this fren paid you, so the shape
                   * of the list is the answer and no column has to be
                   * spent on a percentage.
                   *
                   * Scaled against the LARGEST contributor rather than
                   * against a hundred: at these shares everything would
                   * otherwise fill a third of the row and the five would
                   * be indistinguishable.
                   */}
                  <span
                    className="rw-roll-fill"
                    aria-hidden
                    style={{ width: `${(f.share / FRENS[0]!.share) * 100}%` }}
                  />
                  {/* Two digits, always. A board that runs to ten and
                      shows `9` then `10` shifts every name on the row
                      below it; the leading zero is what keeps the
                      column still. */}
                  <span className="rw-roll-rank" style={{ color: rankInk(f.rank) }}>
                    {String(f.rank).padStart(2, '0')}
                  </span>
                  <span className="rw-roll-n">@{f.who}</span>
                  <Move n={f.move} />
                  <span className="rw-roll-v">{f.vol} SOL</span>
                  <span className="rw-roll-e">{f.earned} SOL</span>
                </div>
              ))}
            </div>

            <div className="rw-rule" />
            <div className="rw-sec">Payout history</div>
            <div className="rw-ph">
              {[
                ['1.8420 SOL', 'Confirmed', '28 Aug 2026'],
                ['0.9930 SOL', 'Confirmed', '21 Aug 2026'],
                ['1.2077 SOL', 'Confirmed', '14 Aug 2026'],
              ].map(([a, s, d]) => (
                <div className="rw-ph-r" key={d}>
                  <span>{a}</span>
                  <span className="rw-dim">{s}</span>
                  <span className="rw-dim">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

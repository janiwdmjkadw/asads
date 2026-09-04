'use client';

import { useState, type CSSProperties } from 'react';
import { CashbackTab } from './CashbackTab';
import { PointsTab } from './PointsTab';
import { ReferralTab } from './ReferralTab';
import type { RewardSection } from './primitives';
import './rewards-page.css';

/**
 * Slice "Referral & Rewards": the rewards page shell.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A full bleed masthead carrying, all at once: a rainbow confetti
 * hairline; a lens tinted aurora; a dot matrix starfield; chart paper
 * gridlines; seven ascending bars in seven hues with a coin at the
 * summit; the section's ordinal set in a serif italic at the height of
 * the plate and tinted with the section's hue; and the word `rewards`
 * in a serif italic lowercase, under a nav that already says Rewards.
 *
 * Then tabs numbered `01 02 03`, each with an icon and a coloured
 * underline. Then fixed gutter rails of coloured ticks and a falling
 * column of confetti over a vertical `MMXXVI`. Then a plate mark
 * signing the page `rewards · A LISTEN ORIGINAL · MMXXVI`.
 *
 * Two typefaces the rest of the terminal never uses, seven hues, and
 * roughly a third of the first screen given to decoration, on a page
 * whose job is to tell you a number and let you take it.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────
 *
 * The name, one line saying what the tab does, and space. Black, like
 * every other surface in the product. What makes it an entrance is the
 * room around it, which is the technique the portfolio total uses one
 * page over at 44px.
 *
 * Nothing was deleted to get here: `primitives`, `icons`, `rewards.css`
 * and the masthead's parts are all still on disk. This file does not
 * call them.
 */

const SUBTITLES: Record<RewardSection, string> = {
  referral: 'Invite frens and earn a cut of every trade they make, for as long as they trade.',
  cashback: 'A slice of your own fees, returned. Trade more, climb tiers, earn more.',
  points: 'Every trade earns points. Unlock accolades and climb the ranks.',
};

const TABS: ReadonlyArray<{ id: RewardSection; label: string }> = [
  { id: 'referral', label: 'Referral' },
  { id: 'cashback', label: 'Cashback' },
  { id: 'points', label: 'Points' },
];

export function RewardsPage(): React.ReactElement {
  const [section, setSection] = useState<RewardSection>('referral');

  return (
    <main
      className="rwp flex-1 min-h-0 flex flex-col overflow-y-auto"
      style={{ maxHeight: 'var(--h-app-content)' } as CSSProperties}
    >
      <div className="rwp-in">
        <header className="rwp-mast">
          <h1>Rewards</h1>
          <p key={section}>{SUBTITLES[section]}</p>
        </header>

        {/* Words, the live one white. It was `01 02 03` with an icon
            each and a coloured underline: three marks per tab to say
            which of three you had clicked. */}
        <div className="rwp-tabs" role="tablist" aria-label="Rewards sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={section === t.id}
              data-on={section === t.id ? '' : undefined}
              onClick={() => setSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div key={section} className="rwp-body">
          {section === 'referral' ? <ReferralTab /> : null}
          {section === 'cashback' ? <CashbackTab /> : null}
          {section === 'points' ? <PointsTab /> : null}
        </div>
      </div>
    </main>
  );
}

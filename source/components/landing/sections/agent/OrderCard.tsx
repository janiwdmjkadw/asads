'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
  CardHead,
  ChainDivider,
  DecisionRow,
  DetailsRow,
  EitherRows,
  LegHead,
  ThenRow,
  WhenRow,
} from './fragments';
import { ORDER } from './orderData';

/**
 * The conditional order card, whole — composed from the same fragments the
 * mobile band interleaves with its reasoning. See fragments.tsx.
 *
 * Fluid up to the 500 the composition is drawn to: the desktop band gives
 * it exactly that, and the mobile one gives it whatever the gutter leaves.
 */
/* Fully fluid. The card no longer caps itself — the column holding it
   decides: 500 fixed in the desktop composition, the stacked column's own
   width below `lg`. A `max-w` here would silently override that and pin
   the stacked card at the desktop measure. */
/*
 * One radius, one rim, one shadow. The card used to run 20 on the outside,
 * 16 on each leg box, 12 on each row panel and fully round on every chip
 * and button — five radii on one object, which is most of why it read as
 * chopped rather than as made.
 *
 * The rim is new. A black card on a light band with nothing but a drop
 * shadow has no edge of its own; a 1px inner highlight is what makes an
 * object look lit rather than cut out.
 */
const CARD =
  'w-full overflow-hidden rounded-[18px] bg-[#0a0a0a] shadow-[inset_0_0_0_1px_rgba(245,245,245,0.09),0_30px_70px_-24px_rgba(11,11,11,0.45)]';

export function OrderCard({ className }: { className?: string }) {
  /* The card is approvable. One piece of state, owned here because three
     places read it: the status badge, leg one's badge, and the row at the
     foot that either asks or reports. */
  const [armed, setArmed] = useState(false);

  return (
    <div className={cn(CARD, className)}>
      <CardHead className="px-4 pb-4 pt-5 lg:px-6 lg:pb-5 lg:pt-6" armed={armed} />

      {/*
        NO LEG BOX. Each leg was wrapped in a bordered, rounded container
        carrying a 2px accent stripe down its left edge — a box inside the
        card, holding boxes of its own. The stripe is the most dated thing
        on a fintech card after the tracked uppercase, and the box was the
        second level of three.

        A leg is a heading and its rows now, with the rows on hairlines.
        The card is the only surface on the card.
      */}
      <div className="border-t border-lp-hairline px-4 lg:px-6">
        {ORDER.legs.map((leg, index) => (
          <div key={leg.name}>
            {/* Full bleed to the card's edges. The seam is a break in the
                document, and a break that stops short of both margins is
                a box, which is the thing this card just got rid of. */}
            {index > 0 ? <ChainDivider className="-mx-4 mb-5 mt-4 px-4 lg:-mx-6 lg:px-6" /> : null}
            <div className={index > 0 ? '' : 'pt-5 lg:pt-6'}>
              <LegHead leg={leg} armed={armed} chained={index > 0} />
              <div className="mt-1 divide-y divide-lp-hairline">
                <WhenRow leg={leg} />
                <EitherRows leg={leg} />
                <ThenRow leg={leg} />
              </div>
            </div>
          </div>
        ))}
        <div className="pb-5 lg:pb-6" />
      </div>

      <DetailsRow className="border-t border-lp-hairline px-4 py-4 lg:px-6" />
      <DecisionRow
        className="border-t border-lp-hairline p-4 lg:p-5"
        armed={armed}
        onApprove={() => setArmed(true)}
        onUndo={() => setArmed(false)}
      />
    </div>
  );
}

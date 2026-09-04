'use client';

/*
 * The `/whatever` column.
 *
 * The ROW itself lives in `source/components/discover/column/TokenRow`
 * now, because the real Discover columns render it too. This file is
 * just the sheet's frame around it — one copy of the row, so what is
 * reviewed here is what ships.
 */

import { ColumnShell } from '@/components/discover/column/ColumnShell';
import { TokenRow, type BuyVariant } from '@/components/discover/column/TokenRow';
import { PADS } from '@/components/discover/column/rowData';
import './art.css';

export function ArtColumn({ buy, limit }: { buy?: BuyVariant; limit?: number } = {}) {
  const rows = PADS.flatMap((pad, i) => [
    <TokenRow key={`${pad.key}-on`} pad={pad} i={i} graduated={false} />,
    <TokenRow key={`${pad.key}-grad`} pad={pad} i={i} graduated />,
  ]);
  return (
    <div className="arc-wrap" data-buy={buy}>
      {/*
        * The Solana gradient, defined ONCE for the whole column.
        * Every row's fee mark points at `url(#arc-sol)`. Inlined per
        * row it would be 28 copies of the same definition all claiming
        * the same id, which is invalid even where browsers forgive it.
        */}
      <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="arc-sol" x1="1.78" y1="13.33" x2="13.97" y2="1.14" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9945FF" />
            <stop offset="0.24" stopColor="#8752F3" />
            <stop offset="0.465" stopColor="#5497D5" />
            <stop offset="0.6" stopColor="#43B4CA" />
            <stop offset="0.735" stopColor="#28E0B9" />
            <stop offset="1" stopColor="#19FB9B" />
          </linearGradient>
        </defs>
      </svg>
      <ColumnShell label="New" uid="sheet">
        {limit ? rows.slice(0, limit) : rows}
      </ColumnShell>
    </div>
  );
}

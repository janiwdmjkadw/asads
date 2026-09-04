'use client';

import { useMemo, useState } from 'react';
import './trade-tape.css';
import './trade-holders.css';
import { TradesTable } from './TradesTable';
import { mockHolders, mockToken, mockTrades } from './mockTrade';

/**
 * The tape under the chart: Trades, Positions, Orders, Holders, Top
 * Traders and Dev Tokens.
 *
 * ── IT IS THE EXISTING TABLE ─────────────────────────────────────────
 *
 * `TradesTable` already owns all six tabs, their paging, the TRACKED
 * filter, the LISTEN card view and the wallet-profile hand-off. None of
 * that is design work worth redoing, so this brings it in as it stands.
 *
 * Every prop but `trades` is optional, and the ones left out are the
 * live feeds that belong to the old `TradePage` — holders, top traders,
 * dev deploys, advanced orders. Those tabs render their own empty states
 * rather than being given invented rows, which is the honest thing for
 * them to show until the feed is behind them.
 */
export function TokenTape() {
  /*
   * ── THE TRACKED FILTER IS OWNED HERE ────────────────────────────────
   *
   * `TradesTable` reports the toggle and renders the state; the SET and
   * the switch belong to whoever mounts it, because on the shipping page
   * the tracked wallets are paged server-side. Without an owner the
   * button pressed and nothing happened — it looked broken.
   *
   * A couple of the mock traders are marked as followed, so the filter
   * has something to actually narrow to.
   */
  const [trackedOnly, setTrackedOnly] = useState(false);
  const trackedWalletLabels = useMemo(
    () => ({
      [mockTrades[1].traderAddress as string]: 'alt main',
      [mockTrades[4].traderAddress as string]: 'sniper 3',
    }),
    [],
  );
  const trackedHolders = useMemo(() => mockHolders.slice(1, 4), []);

  return (
    <div className="tt">
      <TradesTable
        mintKey="mock"
        trades={mockTrades}
        holders={mockHolders}
        trackedOnly={trackedOnly}
        trackedFilterAvailable
        onToggleTrackedOnly={() => setTrackedOnly((v) => !v)}
        trackedHolders={trackedHolders}
        trackedWalletLabels={trackedWalletLabels}
        pageTokenSymbol={mockToken.ticker}
      />
    </div>
  );
}

'use client';

import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { TradeWalletActivity } from '@/components/trade/TradeWalletActivity';
import { mockToken } from '@/components/trade/mockTrade';
import { TokenHeader } from '@/components/trade/TokenHeader';
import { TokenChart } from '@/components/trade/TokenChart';
import { TokenTape } from '@/components/trade/TokenTape';
import { TokenTradePanel } from '@/components/trade/TokenTradePanel';

/**
 * `/trade` — the one trade page.
 *
 * The token header across the top; under it a column holding the chart
 * and the tape, with the trade rail down the right of both.
 *
 * ── THE PAGE IS LOCKED, THE COLUMNS SCROLL ───────────────────────────
 *
 * ── THE TWO FLOATING TRACKERS ────────────────────────────────────────
 *
 * `TradeWalletActivity` is the host for both: the tweet tracker and the
 * wallet activity feed, each a panel you pop out and can drag against
 * either edge to dock. It carries the `trade` dock context, so the two
 * pages keep their own idea of what is open and which side it is on.
 *
 * It was mounted by the OLD trade page and nothing here mounted it, so
 * the pills that open them were simply absent from this one — the panels
 * existed and had a trade context waiting for them, with nobody putting
 * them on the page.
 *
 * ── THE PAGE IS LOCKED, THE COLUMNS SCROLL ───────────────────────────
 *
 * `--h-app-content` is the window minus the nav, the sub-nav, the page
 * bar and the footer — the same height Discover locks itself to. Without
 * it the row sized itself to its TALLEST child and pushed the page off
 * the bottom of the window.
 *
 * Inside that lock, each column carries its own overflow: the rail
 * scrolls, and the chart-and-tape column scrolls. So the chart keeps its
 * 600 and the tape keeps its floor, and when the two together are taller
 * than the window you scroll to the rest of the tape rather than having
 * it crushed into a peephole.
 *
 * ── ON A PHONE THE PAGE SCROLLS INSTEAD ──────────────────────────────
 *
 * That lock is a desk idea. On a phone the window is 700 tall, the chart
 * takes 300 of it and the sheet's strip takes another 34, which leaves
 * the ledger a few rows and no way to reach the rest — holders, top
 * traders and the trades all ended below a bottom edge you could not
 * move. `.tw-page` becomes the scroll container below 700 (see
 * trade-tape.css) and everything inside it takes its natural height.
 */
export default function TradeRoute() {
  const trackedWallets = useTrackedWalletsContext();
  return (
    /*
     * A docked panel takes a side of the WINDOW, so the PAGE gives that
     * side up — all of it, header included. Padding the chart-and-rail
     * row alone left the token header running full width underneath the
     * panel, so the top of the page stayed put while everything below it
     * moved. `useDockCssVars` writes these on <html> per context, so
     * `-trade` is this page's own and Discover's docks never move it.
     */
    <div
      className="tw-page flex h-[var(--h-app-content)] min-h-0 flex-col"
      style={{
        paddingLeft: 'var(--dock-left-w-trade, 0px)',
        paddingRight: 'var(--dock-right-w-trade, 0px)',
      }}
    >
      <TradeWalletActivity
        trackedWallets={trackedWallets}
        tradeMint={mockToken.mintAddress}
        tokenTicker={mockToken.ticker}
        tokenName={mockToken.name}
        hasSnapshot
        tokenHintVersion={0}
      />
      <TokenHeader />
      <div className="flex min-h-0 flex-1">
        <div className="tw-col flex min-w-0 flex-1 flex-col">
          <TokenChart />
          <TokenTape />
        </div>
        <TokenTradePanel />
      </div>
    </div>
  );
}

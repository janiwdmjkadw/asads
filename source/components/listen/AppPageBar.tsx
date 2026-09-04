'use client';

/**
 * THE PAGE BAR — the strip directly under the watchlist nav.
 *
 * The page's name on the left, and the wallet cluster on the right: the
 * trading-settings cog, the group selector and the multi-wallet selector
 * with the aggregate SOL and USDC of the selection.
 *
 * ── WHY THE CLUSTER MOVED HERE ───────────────────────────────────────
 *
 * It used to sit on the right of the watchlist nav, sharing one line with
 * the tape. Two things were competing for that line: a strip that wants
 * every pixel it can get, and a cluster whose width is whatever the
 * wallet figures happen to be. The tape lost, which is why it was the
 * thing that got hidden on a narrow window.
 *
 * On its own line the cluster is not taking width from anything, and the
 * tape has the full bar.
 *
 * ── THE LABEL IS THE ROUTE'S ─────────────────────────────────────────
 *
 * Not a constant. It reads the same labels the top nav writes on its
 * pills, so the two can never call the same page different things.
 *
 * ── AND IT IS DISCOVER'S BAR ONLY ────────────────────────────────────
 *
 * It used to render on every terminal page. On Discover the title and
 * the wallet cluster sit above a board that is all rows and controls, so
 * a bar of controls belongs to it. Everywhere else it was a strip of
 * chrome repeating a word the top nav already highlights, taking 38px
 * off a page that wanted them — the trade page reads that height back
 * out of the chart.
 *
 * So it returns null off Discover, and the height it reserves goes with
 * it rather than staying behind as a gap.
 */

import { usePathname } from 'next/navigation';

import { SubHeaderWalletCluster } from './SubHeaderWalletCluster';
import './page-bar.css';

/*
 * Keyed by the first path segment, which is what the route is. Trade is
 * the one page whose name is not its segment: the segment is followed by
 * a mint, and the page is about that coin rather than about a section.
 */
const LABELS: Record<string, string> = {
  '': 'Discover',
  discover: 'Discover',
  tracker: 'Tracker',
  portfolio: 'Portfolio',
  rewards: 'Rewards',
  frens: 'Frens',
  conditionals: 'Conditionals',
  agent: 'Agent',
  'agent-wallet': 'Agent Wallet',
  trade: 'Trade',
};

function labelFor(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  return LABELS[segment] ?? 'Discover';
}

/* `/` is Discover too — the terminal opens on the board. */
function isDiscover(pathname: string): boolean {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  return segment === '' || segment === 'discover';
}

export function AppPageBar() {
  const pathname = usePathname();

  /*
   * Nothing rendered AND nothing reserved.
   *
   * `--h-pagebar` is subtracted from `--h-app-content`, so returning null
   * on its own would leave every other page sized as though the bar were
   * still there — a 38px hole. Zeroing the variable on the same condition
   * keeps the two facts in one place.
   *
   * ── AND IT IS ZEROED ON `.listen-root`, NOT `:root` ────────────────
   *
   * `--h-pagebar: 38px` and `--h-app-content` are both declared on
   * `.listen-root`. A custom property set on an ANCESTOR is shadowed by
   * the same property declared on a descendant, so zeroing it at `:root`
   * changed nothing for anything inside the shell: `--h-app-content`
   * kept resolving against 38.
   *
   * The symptom was a page locked to the viewport ending 38px short of
   * the footer, with a band of dead space under it that nothing could be
   * made to fill.
   */
  if (!isDiscover(pathname)) {
    return <style>{`.listen-root { --h-pagebar: 0px; }`}</style>;
  }

  return (
    /*
     * `data-subheader-v2` as well as `data-page-bar`.
     *
     * The cog, the group selector and the wallet chip are styled by
     * `subheader-v2.css`, and every one of those rules is scoped to
     * `[data-subheader-v2] [data-testid=…]`. Moving the cluster into a
     * plain div dropped the whole rail treatment on the floor: the
     * plates, the white-when-open, the hover. The attribute is the
     * scope, so this bar carries it too and the three controls look
     * exactly as they did one row up.
     */
    <div
      data-page-bar=""
      data-subheader-v2=""
      className="relative z-[19] flex w-full shrink-0 items-center px-[15px]"
    >
      <span className="page-bar-title">{labelFor(pathname)}</span>
      {/* `ml-auto` rather than a spacer: the cluster is pinned right even
          on a page whose title is one short word. */}
      <div className="ml-auto flex shrink-0 items-center">
        <SubHeaderWalletCluster />
      </div>
    </div>
  );
}

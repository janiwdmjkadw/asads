'use client';

/**
 * EVM tables panel — the exact visual frame of the Solana page's
 * `TradesTable` (trade-page unification, phase 2): the same `.panel` shell,
 * the same `tab-underline` tab bar at `--h-tab-bar`, the same internally
 * scrolling body under it.
 *
 * EXACT-FRAME rather than a reuse of `TradesTable` itself: that component's
 * row contracts are Solana-bound to the bone — every trade row hardcodes the
 * SOL glyph on its Total cell, holder/trader rows require SOL balances and
 * mount `FundingCell`/`SolscanButton` (Solana dossier + Solscan lookups on
 * EVM addresses), and its Dev Tokens / Orders tabs read Solana-only hooks.
 * Feeding EVM rows through it would render wrong-unit figures wearing a
 * verified look — the exact defect class this page's doctrine exists to stop.
 *
 * The tab BODIES are the page's existing EVM surfaces, passed in as nodes so
 * the page keeps owning every fetch and honest-state decision (loading /
 * not-found / error / loaded stay distinguishable). Only the ACTIVE tab's
 * body is mounted — same per-tab economics as the Solana table, where an
 * unselected tab does not poll.
 */

import { useEffect, useState, type ReactNode } from 'react';

const TABS = [
  { id: 'trades', label: 'Trades' },
  { id: 'fills', label: 'My Fills' },
  { id: 'holders', label: 'Holders' },
  { id: 'topTraders', label: 'Top Traders' },
  { id: 'devTokens', label: 'Dev Tokens' },
  { id: 'orders', label: 'Orders' },
] as const;

type EvmTableTabId = (typeof TABS)[number]['id'];

export interface EvmTradesTableProps {
  trades: ReactNode;
  fills: ReactNode;
  holders: ReactNode;
  topTraders: ReactNode;
  devTokens: ReactNode;
  orders?: ReactNode;
  orderCount?: number;
  /** Rendered as `(N)` after the Trades label; null/undefined = no claim. */
  tradeCount?: number | null;
  /** Rendered as `(N)` after the Holders label; null/undefined = no claim. */
  holderCount?: number | null;
  onActiveTabChange?: (tab: EvmTableTabId) => void;
}

export function EvmTradesTable({
  trades,
  fills,
  holders,
  topTraders,
  devTokens,
  orders,
  orderCount,
  tradeCount,
  holderCount,
  onActiveTabChange,
}: EvmTradesTableProps) {
  const [active, setActive] = useState<EvmTableTabId>('trades');
  useEffect(() => onActiveTabChange?.(active), [active, onActiveTabChange]);
  const body = active === 'trades'
    ? trades
    : active === 'fills'
      ? fills
      : active === 'holders'
        ? holders
        : active === 'topTraders'
          ? topTraders
          : active === 'devTokens'
            ? devTokens
            : (orders ?? trades);
  return (
    <div
      className="panel flex h-full min-h-0 w-full flex-col"
      style={{ paddingBottom: 0 }}
      data-testid="evm-trades-table"
    >
      {/* px-6 matches .trow's horizontal padding, same as the Solana bar. */}
      <div
        className="flex h-[var(--h-tab-bar)] shrink-0 items-center gap-6 overflow-x-auto px-6 scroll-hide"
        style={{ borderBottom: '1px solid var(--hairline)' }}
      >
        {TABS.filter((tab) => tab.id !== 'orders' || orders !== undefined).map((tab) => {
          const count =
            tab.id === 'trades'
              ? tradeCount
              : tab.id === 'holders'
                ? holderCount
                : tab.id === 'orders'
                  ? orderCount
                  : null;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`tab-underline ${active === tab.id ? 'active' : ''}`}
              data-testid={`evm-table-tab-${tab.id}`}
            >
              {tab.label}
              {count != null && (
                <span className="t-num-sm font-normal" style={{ color: 'var(--ink-3)' }}>
                  ({count.toLocaleString()})
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto scroll-hide">
        <div className="flex min-h-full min-w-[var(--table-min-w)] flex-col">{body}</div>
      </div>
    </div>
  );
}

/**
 * Slice "Multi-wallet split buy/sell orders" (UI revision): pure
 * routing rule shared by every trade surface (TradePanel, the
 * Instant Trade Box, the discover-page QuickBuy chip, future
 * one-tap surfaces). Extracted from `WalletCountButton.tsx` into a
 * dedicated module so callers can import the rule without dragging
 * the React component (and its `MultiWalletSelector` dependency
 * tree) into their bundle. Importing from a 'use client' component
 * works at the type level but caused Next.js static prerender to
 * pull the whole component graph into pages that only need the
 * pure routing decision (discover/CoinCard).
 *
 *   - count <= 0 : 'none' — the trade form should refuse to submit
 *   - count === 1: 'single' — POST /api/v1/trade/orders
 *   - count >= 2 : 'batch'  — POST /api/v1/trade/batch-orders
 *
 * This is the canonical statement of the count-based routing rule;
 * `TradePanel.handleClick`, `InstantTradeBox.submit*`,
 * `CoinCard.handleQuickbuy`, and any future caller MUST honour it.
 */
export type WalletCountRoute = 'none' | 'single' | 'batch';

export function routeForWalletCount(count: number): WalletCountRoute {
  if (!Number.isFinite(count) || count <= 0) return 'none';
  if (count === 1) return 'single';
  return 'batch';
}

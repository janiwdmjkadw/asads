'use client';

import { Fragment } from 'react';
import {
  hrefForToken,
  navigateToToken,
  prefetchToken,
  tokenTickerFromNavigationHint,
} from '@/components/listen/navigation';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import { formatUsd, truncateMint } from '@/components/portfolio/spot/format';
import { useWatchlist } from './useWatchlist';
import { useWatchlistQuotes, type WatchlistQuote } from './useWatchlistQuotes';

/**
 * Watchlist strip for the top sub-header — the sibling of PositionsBar the
 * star/chart toggle swaps between. Each chip is the coin's art + ticker +
 * live market cap + 24h % change; clicking opens its Trade page. Data rides
 * one lite batch poll for the whole list (useWatchlistQuotes) — never a
 * per-coin stream. Coins are starred/unstarred from the trade page header;
 * the strip itself is read-only.
 */
export function WatchlistBar() {
  const watchlist = useWatchlist();
  // Only mounted while the watchlist mode is selected, so the poll runs
  // exactly when the chips are visible.
  const quotes = useWatchlistQuotes(
    watchlist.tokens.map((t) => t.mint),
    false,
  );

  if (watchlist.tokens.length === 0) {
    return (
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
        {watchlist.isLoading ? 'Loading watchlist…' : 'No watched coins. Star one on its trade page.'}
      </span>
    );
  }

  return (
    <div className="scroll-hide -mx-1 flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto px-1">
      {watchlist.tokens.map((token, i) => (
        <Fragment key={token.mint}>
          {i > 0 ? (
            <span
              aria-hidden
              className="h-3.5 w-px shrink-0"
              style={{ background: 'var(--hairline)' }}
            />
          ) : null}
          <WatchlistChip mint={token.mint} quote={quotes.get(token.mint)} />
        </Fragment>
      ))}
    </div>
  );
}

function WatchlistChip({ mint, quote }: { mint: string; quote: WatchlistQuote | undefined }) {
  const { src, onError } = useResolvedTokenImage(ingestionTokenImageUrl(mint), null, mint);
  const ticker = quote?.symbol ?? tokenTickerFromNavigationHint(mint) ?? truncateMint(mint);
  const pct = quote?.change24hPct ?? null;
  const pctColor = pct == null ? 'var(--ink-3)' : pct >= 0 ? 'var(--up)' : 'var(--down)';

  return (
    /* REAL <a href> (pre-hydration clicks fall back to native navigation);
       hydrated clicks take the SPA path with an identity hint so the trade
       header paints instantly. */
    <a
      href={hrefForToken(mint)}
      draggable={false}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        navigateToToken(mint, quote?.symbol ? { symbol: quote.symbol } : undefined);
      }}
      onPointerEnter={() => prefetchToken(mint)}
      onFocus={() => prefetchToken(mint)}
      title={`Open ${ticker}`}
      className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--tabs-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={{ fontFamily: 'var(--mono)' }}
    >
      <img
        src={src}
        onError={onError}
        alt=""
        width={13}
        height={13}
        className="h-[13px] w-[13px] shrink-0 rounded-full object-cover"
      />
      <span
        className="text-[10px] font-semibold uppercase leading-none"
        style={{ color: 'var(--ink-1)', letterSpacing: '0.04em' }}
      >
        {ticker}
      </span>
      {/* Market cap, or an honest placeholder while the first poll is in
          flight. Never a fake zero. */}
      <span className="text-[9.5px] leading-none tabular-nums" style={{ color: 'var(--ink-3)' }}>
        {quote?.marketCapUsd != null ? formatUsd(quote.marketCapUsd) : '—'}
      </span>
      <span
        className="text-[9.5px] font-semibold leading-none tabular-nums"
        style={{ color: pctColor }}
        title="24h price change. Change since launch for coins younger than 24h, and no figure while the reference loads or when the coin has not traded in 24h"
      >
        {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
      </span>
    </a>
  );
}

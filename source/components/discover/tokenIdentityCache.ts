import { rememberTokenNavigationHint, tokenTickerFromNavigationHint } from '@/components/listen/navigation';

export interface TokenIdentitySource {
  /** Mint address for live/runtime tokens. Required for persisted identity hints. */
  id?: string | null;
  ticker?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  links?: {
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
  };
  marketCap?: string | null;
  txns?: number | null;
}

export function tokenCardKey(coin: TokenIdentitySource & { handle?: string | null }): string {
  if (coin.id) return `mint:${coin.id}`;
  return [
    'static',
    coin.ticker?.trim() ?? '',
    coin.name?.trim() ?? '',
    coin.handle?.trim() ?? '',
  ].join(':');
}

export function rememberTokenIdentities(coins: readonly TokenIdentitySource[]): void {
  for (const coin of coins) {
    if (!coin.id) continue;
    const symbol = cleanTicker(coin.ticker, coin.id) ?? cleanTicker(coin.name, coin.id);
    const name = cleanTicker(coin.name, coin.id) ?? symbol;
    if (!symbol && !name && !coin.imageUrl) continue;
    rememberTokenNavigationHint(coin.id, {
      name: name ?? null,
      symbol: symbol ?? null,
      imageUrl: coin.imageUrl ?? null,
      twitterUrl: coin.links?.twitter ?? null,
      telegramUrl: coin.links?.telegram ?? null,
      websiteUrl: coin.links?.website ?? null,
      marketCap: coin.marketCap ?? null,
      txns: coin.txns ?? null,
    });
  }
}

export function resolveSharedTicker(
  mint: string,
  tickerByMint: ReadonlyMap<string, string>,
  fallback?: string | null,
): string | null {
  return cleanTicker(fallback, mint)
    ?? cleanTicker(tickerByMint.get(mint), mint)
    ?? tokenTickerFromNavigationHint(mint);
}

function cleanTicker(value: string | null | undefined, mint: string): string | null {
  const cleaned = value?.trim().replace(/^\$/, '');
  if (!cleaned) return null;
  if (cleaned === mint) return null;
  if (/^(unknown|loading|loading metadata)$/i.test(cleaned)) return null;
  return cleaned;
}

import type { ReactNode } from 'react';
import { CoinCard } from '../CoinCard';
import { AlphaCard } from '../AlphaCard';
import { tokenCardKey } from '../tokenIdentityCache';
import type { AlphaCoin, MockCoin } from '../mockCoins';
import type { QuickBuySectionId } from '@/lib/state/trade-store';

/** A card item is either a live/standard coin or an Alpha coin. Both are
 *  compatible with `tokenCardKey`, so the lane keys them uniformly. */
export type CardItem = MockCoin | AlphaCoin;

/** Rich Alpha card (takes the coin directly — Alpha mocks aren't in the feed store). */
export function renderAlphaCard(coin: AlphaCoin, opts: { flash?: boolean } = {}): ReactNode {
  return <AlphaCard coin={coin} flash={opts.flash ?? false} />;
}

/** Standard coin card (subscribes to the feed store by key). */
export function renderStandardCard(
  coin: MockCoin,
  opts: {
    sectionId: QuickBuySectionId;
    flash: boolean;
    attentionFlash?: boolean;
    imageLoading: 'eager' | 'lazy';
  },
): ReactNode {
  return (
    <CoinCard
      cardKey={tokenCardKey(coin)}
      fallbackCoin={coin}
      sectionId={opts.sectionId}
      flash={opts.flash}
      attentionFlash={opts.attentionFlash ?? false}
      imageLoading={opts.imageLoading}
    />
  );
}

import { filterCoinsBySearch } from './discoverSearch';
import { coinPassesFilter, type DiscoverSectionId, type RowFilter } from './discoverFilters';
import { EVM_LANE_RENDER_LIMIT, type EvmLane } from '@/lib/evm/laneState';
import type { MockCoin } from './mockCoins';

/**
 * What one EVM lane actually renders: the search applied, then the render cap.
 *
 * A LEAF MODULE, not a function on `EvmDiscoverLanes.tsx`, for the same reason
 * `laneState.ts` holds the ordering and staleness rules: this is pure logic
 * about what a user sees, and it must be testable without a DOM. Importing the
 * component to reach it would drag `CoinCard` — and through it Clerk — into a
 * unit test, which in this runner is a module-load failure rather than a slow
 * test.
 */

/**
 * Which persisted Solana filter row an EVM lane borrows its bounds from.
 *
 * THE BOUNDS ARE SHARED ON PURPOSE. `DiscoverFilters` is persisted under one
 * key and the modal edits three named rows; minting a fourth vocabulary for the
 * EVM board would give a user two "Ripening" filters that disagree, which is
 * the same two-places-to-say-one-thing problem the `/discover/evm` route was
 * retired for. Three of the four stages map by name and by lifecycle:
 * `new` → New Pairs, `ripening` → Ripening (the Solana row's own label for
 * `almost-graduated`), `graduated` → Graduated.
 *
 * `migrating` has no Solana counterpart and takes the GRADUATED bounds: its
 * curve has already completed and the liquidity is mid-move to the AMM, so it
 * sits after graduation in the lifecycle, not before it. The alternative —
 * leaving one lane unfiltered — would let a max-market-cap bound hide a token
 * in three lanes and show it in the fourth, with nothing on screen saying why.
 */
/* Takes a LANE, not a stage, and the distinction is load-bearing: `migrating`
   cards render in the Ripening lane (`stagesForLane`), so mapping them to
   `graduated` bounds would filter a card by one section's thresholds while its
   lane header showed another's — the two-places-disagree bug this board keeps
   being audited for. Exhaustive over the three lanes; no `default`, so adding
   a lane is a type error rather than a silent fall-through. */
export function evmFilterSection(lane: EvmLane): DiscoverSectionId {
  switch (lane) {
    case 'new':
      return 'new-pairs';
    case 'ripening':
      return 'almost-graduated';
    case 'graduated':
      return 'graduated';
  }
}

/**
 * FILTER FIRST, SEARCH SECOND, CAP LAST, and the order is load-bearing.
 * Capping first would hand the filter fifty rows out of a lane holding four
 * times that and call the result a search of the lane. The Solana sections
 * apply theirs in the same order for the same reason.
 *
 * The metric filter is the Solana predicate itself (`coinPassesFilter`), which
 * only became usable on these rows once the EVM adapter started carrying a
 * NUMERIC market cap and volume beside its display text — see
 * `lib/evm/cardAdapter.ts`. Wiring it before that would have hidden the entire
 * board the moment any bound went active, because `passesRange` excludes a row
 * whose metric is unknown and every EVM row's metric was unknown.
 *
 * That exclusion rule is inherited deliberately, not worked around: a token
 * whose USD figure the indexer withholds (the stock-quoted Pons markets, and
 * anything with no fresh oracle) cannot be PROVEN to sit inside a dollar bound,
 * and showing it anyway would let a "max $50k" filter return tokens of unknown
 * size. The lane header's `N of TOTAL` is what keeps the omission visible.
 *
 * The search predicate is the one the Solana sections use — possible only
 * because these rows are `MockCoin`s. It folds case and matches
 * ticker | name | id, and since an EVM row's id is `bsc:0x…`, a user pasting a
 * contract address finds it.
 *
 * THE CAP IS THE RENDER HALF OF THE BOUND; the store half is `laneState`'s
 * `EVM_LANE_STORE_LIMIT`. Neither substitutes for the other — without the
 * store cap this only hides unbounded growth behind a viewport, and without
 * this the board mounts an unbounded number of live card subscriptions.
 */
export function laneVisibleRows(
  rows: MockCoin[],
  search: string,
  filter?: RowFilter,
): MockCoin[] {
  const filtered =
    filter === undefined ? rows : rows.filter((row) => coinPassesFilter(row, filter));
  return filterCoinsBySearch(filtered, search).slice(0, EVM_LANE_RENDER_LIMIT);
}

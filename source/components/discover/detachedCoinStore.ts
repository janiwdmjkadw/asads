'use client';

/**
 * A `DiscoverFeedStore` that is NOT the Solana live feed.
 *
 * WHY THIS EXISTS. `CoinCard` addresses its data by `cardKey` through
 * `DiscoverCoinStoreContext`, and the default context value is the module
 * singleton fed by the Solana ingestion SSE. A card rendered with an EVM key
 * against that singleton would subscribe into the Solana feed for a key that
 * feed will never contain — it would render nothing, hold a listener slot on
 * the hottest store in the app, and (worse) would silently start rendering
 * another chain's data the day a key collided.
 *
 * The seam already existed and is already load-bearing: the Almost Graduated
 * section overrides the same context with its own DB-backed store. So an EVM
 * lane overriding it is the established pattern, NOT a new one — which is
 * exactly why the card's subscription machinery needs no chain branch at all.
 * `cardKey` is decoupled from the Solana feed by decoupling the STORE, not by
 * threading a chain flag through `useCardCoinSlice`.
 *
 * This store is push-only: a caller `replace()`s the current row set each time
 * its own source changes, and the store diffs to find which keys actually
 * moved so an unchanged card does not re-render. It reuses
 * `createDiscoverFeedStore` rather than reimplementing the diff, so there is
 * one merge/notify implementation in the app and it cannot drift.
 */

import { createDiscoverFeedStore, type DiscoverFeedStore } from './discoverFeedStore';
import type { MockCoin } from './mockCoins';

/**
 * Create a detached store.
 *
 * `orderFlushMs` is 0 (fully synchronous) rather than the singleton's 500ms:
 * the coalescing window exists to damp page-level sort/filter passes over a
 * ~250ms full-top-N Solana feed, and a lane driven by discrete SSE frames does
 * not have that problem. Adding latency it does not need would just make the
 * lane feel slower than Solana's — the opposite of the goal.
 */
export function createDetachedCoinStore(): DiscoverFeedStore {
  return createDiscoverFeedStore({ orderFlushMs: 0 });
}

/**
 * Push a row set into a detached store.
 *
 * `replace` (not `ingest`) on purpose: `ingest` treats an empty frame as "no
 * update" so a transient empty envelope can never blank the hot Solana feed.
 * A detached store's source is authoritative — an empty lane genuinely IS
 * empty, and refusing to clear it would leave a stale card on screen for a
 * token that has moved to another lifecycle stage.
 */
export function publishRows(store: DiscoverFeedStore, rows: readonly MockCoin[]): void {
  store.replace(rows);
}

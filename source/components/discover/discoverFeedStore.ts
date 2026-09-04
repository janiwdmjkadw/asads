'use client';

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { bumpFeedApply } from '@/lib/perf/navActivity';
import * as feedPerf from './feedPerfStats';
import { coinsEqual } from './coinEquality';
import { isFeedPausedForNavigation, onFeedResume } from './feedNavigationPause';
import type { MockCoin } from './mockCoins';
import { tokenCardKey } from './tokenIdentityCache';

/**
 * Fine-grained external store for the Discover live feed.
 *
 * The ingestion daemon pushes the full top-N list every ~250ms. Naively
 * pushing that into React state re-renders every card on every tick.
 * Instead, this store diff-merges each snapshot keyed by `tokenCardKey`
 * and notifies ONLY the keys whose data actually changed -- so a price
 * tick on one coin re-renders only that coin's card (O(changed), not
 * O(total)). This is the `useSyncExternalStore` equivalent of per-entity
 * atoms; no extra dependency.
 *
 * Two subscription channels:
 *   - per-coin (`subscribeCoin`/`getCoin`): each `CoinCard` subscribes to
 *     its own key and re-renders only when that coin changes.
 *   - order (`subscribeOrder`/`getSnapshot`): the ordered `MockCoin[]`
 *     array used by `DiscoverPage` (sort/filter/toasts) and `TradePage`.
 *     The snapshot reference is stable across ticks with no change, which
 *     `useSyncExternalStore` requires to avoid render loops.
 */

type Listener = () => void;

export interface DiscoverFeedStore {
  /** Diff-merge a full feed snapshot; notifies only changed keys + order. */
  ingest(next: readonly MockCoin[]): void;
  /** Diff-merge an authoritative full snapshot, allowing empty to clear rows. */
  replace(next: readonly MockCoin[]): void;
  getCoin(key: string): MockCoin | undefined;
  subscribeCoin(key: string, listener: Listener): () => void;
  /** Stable-reference ordered array; new reference only when something changed. */
  getSnapshot(): MockCoin[];
  subscribeOrder(listener: Listener): () => void;
  /**
   * Committed row ORDER as `cardKey[]`, SEPARATE from entity data: the
   * reference only moves when keys or positions actually change, so a
   * content-only tick (fresh coin objects, identical ordering) hands
   * structural consumers the exact same array and their memos/diffs
   * short-circuit on `===`. Entity data is never staled to achieve this —
   * `getSnapshot()`/`getCoin()` stay fresh per commit; only the ORDER
   * reference is stabilized (phase 0.3, amendment A5).
   */
  getOrderKeys(): string[];
}

export interface DiscoverFeedStoreOptions {
  /**
   * Coalescing window for the ORDER channel, in ms. `0` (default) keeps the
   * historical fully-synchronous behavior. When positive, per-coin
   * notifications stay immediate (visible price ticks are never delayed) but
   * the snapshot-array rebuild + order notification — the thing that drives
   * DiscoverPage's O(n) sort/filter passes and card reordering — commits at
   * most once per window (leading + trailing edge). Measured rationale:
   * per-tick page-level re-renders were the dominant main-thread cost that
   * starved route transitions on throttled CPUs (see perf-harness latency
   * report). Lossless: every SSE frame carries the full top-N state, so the
   * trailing flush always lands on the complete current ordering.
   */
  orderFlushMs?: number;
}

/** Exported for tests; production uses the `discoverFeedStore` singleton. */
export function createDiscoverFeedStore(options: DiscoverFeedStoreOptions = {}): DiscoverFeedStore {
  const orderFlushMs = options.orderFlushMs ?? 0;
  const coinByKey = new Map<string, MockCoin>();
  /** Last COMMITTED order (what `snapshot` reflects). */
  let order: string[] = [];
  /** Latest computed order, possibly awaiting a coalesced commit. */
  let pendingOrder: string[] | null = null;
  let snapshot: MockCoin[] = [];
  const coinListeners = new Map<string, Set<Listener>>();
  const orderListeners = new Set<Listener>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCommitAt = 0;

  function rebuildSnapshot(): void {
    const next: MockCoin[] = [];
    for (const key of order) {
      const coin = coinByKey.get(key);
      if (coin) next.push(coin);
    }
    snapshot = next;
  }

  function notifyCoin(key: string): void {
    const listeners = coinListeners.get(key);
    if (!listeners) return;
    for (const listener of listeners) listener();
  }

  function notifyOrder(): void {
    for (const listener of orderListeners) listener();
  }

  function commitOrder(): void {
    if (pendingOrder !== null) {
      // Reuse the committed order reference when the pending keys are
      // element-for-element equal (content-only ticks): structural
      // consumers of `getOrderKeys()` keep identity while the snapshot
      // below still rebuilds with fresh entity references.
      if (orderKeysEqual(order, pendingOrder)) {
        feedPerf.noteOrderReuse();
      } else {
        order = pendingOrder;
      }
      pendingOrder = null;
    }
    lastCommitAt = Date.now();
    rebuildSnapshot();
    notifyOrder();
  }

  function scheduleOrderCommit(): void {
    if (orderFlushMs <= 0) {
      commitOrder();
      return;
    }
    const now = Date.now();
    if (now - lastCommitAt >= orderFlushMs) {
      // Leading edge: a quiet feed commits instantly (no added latency on
      // the first change after an idle period).
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      commitOrder();
      return;
    }
    if (flushTimer !== null) return; // trailing flush already scheduled
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!isFeedPausedForNavigation()) {
        commitOrder();
        return;
      }
      // The timer was armed by a frame ingested just before a navigation/
      // scroll/modal pause engaged — committing now would run the page-level
      // sort/filter re-render the pause exists to keep off that window.
      // Defer to resume. Guards: the consumer's own resume flush usually
      // re-ingests and commits first (pendingOrder null — skip the redundant
      // notify), and a post-resume ingest may have re-armed coalescing
      // (flushTimer set — let that window own the commit).
      const cancel = onFeedResume(() => {
        cancel();
        if (pendingOrder !== null && flushTimer === null) commitOrder();
      });
    }, Math.max(1, orderFlushMs - (now - lastCommitAt)));
  }

  function applySnapshot(next: readonly MockCoin[], allowEmpty: boolean): void {
    // Empty frames are normally treated as "no update" (a heartbeat or
    // transient empty envelope must never blank the last visible hot feed),
    // matching the prior `applyFreshDiscoverRows` semantics. Dedicated
    // authoritative feeds can call `replace()` below to intentionally clear.
    if (next.length === 0 && !allowEmpty) return;

    const baseline = pendingOrder ?? order;
    const nextOrder: string[] = [];
    const seen = new Set<string>();
    const dirtyKeys: string[] = [];
    const removedKeys: string[] = [];
    let orderChanged = next.length !== baseline.length;
    let membershipChanged = false;

    for (let i = 0; i < next.length; i += 1) {
      const coin = next[i];
      const key = tokenCardKey(coin);
      if (seen.has(key)) continue; // defensive de-dupe within a frame
      seen.add(key);
      nextOrder.push(key);

      const prev = coinByKey.get(key);
      if (prev === undefined) {
        coinByKey.set(key, coin);
        // A brand-new mint entering the feed — see fast path below.
        membershipChanged = true;
      } else if (!coinsEqual(prev, coin)) {
        coinByKey.set(key, coin);
        dirtyKeys.push(key);
      }

      if (baseline[i] !== key) orderChanged = true;
    }

    // Drop coins no longer present in the latest snapshot.
    if (coinByKey.size !== seen.size) {
      for (const key of coinByKey.keys()) {
        if (!seen.has(key)) {
          coinByKey.delete(key);
          removedKeys.push(key);
          membershipChanged = true;
        }
      }
      orderChanged = true;
    }

    // Per-coin channel FIRST and always immediate — visible cards tick at
    // feed rate regardless of the order-channel coalescing below.
    for (const key of dirtyKeys) notifyCoin(key);
    for (const key of removedKeys) notifyCoin(key);

    if (orderChanged || dirtyKeys.length > 0 || removedKeys.length > 0) {
      pendingOrder = nextOrder;
      if (membershipChanged) {
        // MEMBERSHIP FAST PATH: a new pair must hit the DOM at frame
        // latency — first-seen speed is the product. Bypass the coalescing
        // window entirely (it exists to dampen price-tick reorder churn,
        // not to delay new coins; delaying them also delays their image
        // fetch, which starts only after the card mounts).
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        commitOrder();
      } else {
        scheduleOrderCommit();
      }
    }
  }

  return {
    ingest(next) {
      bumpFeedApply();
      applySnapshot(next, false);
    },

    replace(next) {
      bumpFeedApply();
      applySnapshot(next, true);
    },

    getCoin(key) {
      return coinByKey.get(key);
    },

    subscribeCoin(key, listener) {
      let listeners = coinListeners.get(key);
      if (!listeners) {
        listeners = new Set<Listener>();
        coinListeners.set(key, listeners);
      }
      listeners.add(listener);
      return () => {
        const set = coinListeners.get(key);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) coinListeners.delete(key);
      };
    },

    getSnapshot() {
      return snapshot;
    },

    subscribeOrder(listener) {
      orderListeners.add(listener);
      return () => {
        orderListeners.delete(listener);
      };
    },

    getOrderKeys() {
      return order;
    },
  };
}

function orderKeysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Module singleton -- one feed, mirrored to every Discover consumer.
 *
 * Order channel coalesced to 500ms: page-level sorts/reorders run at <=2Hz
 * while per-coin price ticks stay at full feed rate. This is the main fix
 * for navigation latency on weaker CPUs — the per-frame page re-render was
 * starving route transitions (click->chart measured 5.2s @4x CPU throttle,
 * ~0.6s once Discover stops hogging the main thread).
 */
export const ORDER_FLUSH_MS = 500;
export const discoverFeedStore = createDiscoverFeedStore({ orderFlushMs: ORDER_FLUSH_MS });

/**
 * The feed store a `CoinCard` subtree reads its per-coin data from.
 * Defaults to the singleton new-pairs feed. The "Almost Graduated"
 * section overrides this (via a Provider) with its own DB-backed store,
 * so that row can render any-age, close-to-bonding coins that never enter
 * the recency-capped new-pairs feed -- while New Pairs and Graduated keep
 * reading the singleton, leaving the hot path untouched.
 */
export const DiscoverCoinStoreContext = createContext<DiscoverFeedStore>(discoverFeedStore);

const subscribeOrder = (listener: Listener): (() => void) =>
  discoverFeedStore.subscribeOrder(listener);
const getOrderSnapshot = (): MockCoin[] => discoverFeedStore.getSnapshot();

// SSR / hydration: the store is only ever populated on the client (the
// feed seeds in an effect, after hydration). The server always renders
// an empty feed, so the server snapshot must be a STABLE empty array --
// returning the live store here would mismatch the server HTML (the
// store may already be client-seeded during the hydration pass) and
// throw a hydration error. After hydration React switches to the live
// getSnapshot and the seeded rows appear via a normal update.
const EMPTY_FEED: MockCoin[] = [];
const getOrderServerSnapshot = (): MockCoin[] => EMPTY_FEED;
const getCoinServerSnapshot = (): MockCoin | undefined => undefined;

/**
 * The ordered live feed as a `MockCoin[]`. Reference is stable between
 * ticks that change nothing, so array consumers (DiscoverPage memos,
 * TradePage lookups) only recompute when the feed actually changes.
 */
const noopSubscribe = (): (() => void) => () => {};

export function useDiscoverFeedArray(disabled = false): MockCoin[] {
  // `disabled` (dev `?debugNoTradeDiscoverSubscription=1`) is constant for the
  // tab's lifetime, so swapping to a no-op subscribe + stable empty snapshot
  // here means the consumer never re-renders on feed ticks at all -- the point
  // of the diagnostic.
  return useSyncExternalStore(
    disabled ? noopSubscribe : subscribeOrder,
    disabled ? getOrderServerSnapshot : getOrderSnapshot,
    getOrderServerSnapshot,
  );
}

/**
 * Ordered live feed with a DORMANT mode for the hidden persistent Discover
 * pane: while `dormant`, the subscription is a no-op so order flushes never
 * re-render the (invisible) page — measured +11pp renderer CPU on the trade
 * page otherwise — but the CURRENT snapshot keeps being returned, so nothing
 * unmounts. Flipping `dormant` swaps the subscribe function, which makes
 * `useSyncExternalStore` re-subscribe and synchronously read the latest
 * snapshot — the revealed page is current in the same render.
 */
export function useDiscoverFeedArrayDormant(dormant: boolean): MockCoin[] {
  return useSyncExternalStore(
    dormant ? noopSubscribe : subscribeOrder,
    getOrderSnapshot,
    getOrderServerSnapshot,
  );
}

/**
 * Ordered live feed for an explicit store instance (e.g. the dedicated
 * almost-graduated feed). Mirrors `useDiscoverFeedArray` but bound to the
 * passed store rather than the singleton.
 */
export function useDiscoverFeedArrayOf(store: DiscoverFeedStore, dormant = false): MockCoin[] {
  const subscribe = useCallback(
    (listener: Listener) => (dormant ? noopSubscribe() : store.subscribeOrder(listener)),
    [store, dormant],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getOrderServerSnapshot);
}

/**
 * Subscribe a single card to its own coin. Re-renders the caller only
 * when this specific coin's data changes -- not on unrelated ticks. Reads
 * from whichever store the nearest `DiscoverCoinStoreContext` provides
 * (the singleton new-pairs feed by default; the dedicated store inside the
 * Almost Graduated section).
 */
export function useDiscoverCoin(key: string, frozen = false): MockCoin | undefined {
  const store = useContext(DiscoverCoinStoreContext);
  // Dev diagnostic (`?debugFreezeCards=1`): subscribe with a no-op so the card
  // mounts with its current data but never re-renders on feed ticks -- isolates
  // the per-card re-render churn from static DOM + the feed/sort machinery.
  const subscribe = useCallback(
    (listener: Listener) => (frozen ? () => {} : store.subscribeCoin(key, listener)),
    [store, key, frozen],
  );
  const getSnapshot = useCallback(() => store.getCoin(key), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getCoinServerSnapshot);
}

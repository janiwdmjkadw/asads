'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { coinSlicesEqual } from './coinEquality';
import { DiscoverCoinStoreContext, type DiscoverFeedStore } from './discoverFeedStore';
import type { MockCoin } from './mockCoins';

/**
 * Phase-1 "grouped live islands": per-island slice subscriptions for the
 * Discover coin card.
 *
 * The store's per-coin channel replaces the WHOLE coin object whenever any
 * field changed, so a card subscribed via `useDiscoverCoin` re-renders its
 * entire tree per tick. Islands instead subscribe through this module:
 * each island selects only the fields it renders, the selected slice is
 * content-compared against the previous one (`coinSlicesEqual` — same
 * per-field rules the store's own `coinsEqual` diff uses), and an
 * unchanged slice keeps its reference so `useSyncExternalStore` bails out
 * of the re-render entirely. A market-cap tick then re-renders the stats
 * island, not the image / meta rows / quickbuy machinery.
 *
 * Freeze semantics (off-screen and hidden-pane cards) are preserved from
 * `useDiscoverCoin(key, frozen)` but moved OUT of React state: the card
 * wrapper publishes its frozen flag into a mutable `CardLiveHandle` cell
 * and islands' subscribe functions attach/detach the store listener when
 * the cell flips — a visibility flip therefore re-renders no island at
 * all (previously the whole card wrapper re-rendered per flip and relied
 * on `memo` to bail). Reads are NEVER frozen: `getSnapshot` always
 * returns latest store data, so an unfreezing island is current in the
 * same render, exactly like `useDiscoverCoin`.
 */

type Listener = () => void;

export interface CardLiveHandle {
  readonly cardKey: string;
  /** Latest fallback row (static fixtures / transient store races). Read
   *  through a getter so fallback prop churn never invalidates context. */
  getFallback(): MockCoin | undefined;
  /** True while the card is off-screen or the Discover pane is hidden. */
  isFrozen(): boolean;
  subscribeFrozen(listener: Listener): () => void;
  /** Wrapper-only: publish a frozen flip to enrolled islands. */
  setFrozen(frozen: boolean): void;
  /** Wrapper-only: keep the fallback getter current. */
  setFallback(fallback: MockCoin | undefined): void;
}

export function createCardLiveHandle(
  cardKey: string,
  fallback: MockCoin | undefined,
  frozen: boolean,
): CardLiveHandle {
  let currentFallback = fallback;
  let currentFrozen = frozen;
  const listeners = new Set<Listener>();
  return {
    cardKey,
    getFallback: () => currentFallback,
    isFrozen: () => currentFrozen,
    subscribeFrozen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setFrozen(next) {
      if (next === currentFrozen) return;
      currentFrozen = next;
      for (const listener of listeners) listener();
    },
    setFallback(next) {
      currentFallback = next;
    },
  };
}

export const CardLiveContext = createContext<CardLiveHandle | null>(null);

/**
 * Card-wrapper hook: owns the `CardLiveHandle` the card's islands read
 * through `CardLiveContext`. The handle is identity-stable for the
 * card's lifetime (per `cardKey`); frozen flips and fallback churn are
 * published into it from effects, so context consumers never re-render
 * on either.
 */
export function useCardLiveHandle(
  cardKey: string,
  fallback: MockCoin | undefined,
  frozen: boolean,
): CardLiveHandle {
  const handle = useMemo(
    () => createCardLiveHandle(cardKey, fallback, frozen),
    // A new key means a different coin: rebuild the handle (islands
    // resubscribe via the context identity change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardKey],
  );
  // Fallback may be a fresh object per order commit; keep the getter
  // current without invalidating anything (reads happen at snapshot /
  // click time only).
  handle.setFallback(fallback);
  useEffect(() => {
    handle.setFrozen(frozen);
  }, [handle, frozen]);
  return handle;
}

interface SliceCache<T> {
  coin: MockCoin | undefined;
  slice: T;
}

/**
 * Core slice subscription. `selector` MUST be a module-level (or
 * otherwise identity-stable) function — the latest one is applied via a
 * ref, but a changing selector cannot invalidate the cached slice.
 */
function useCoinSliceOf<T>(
  store: DiscoverFeedStore,
  handle: CardLiveHandle,
  selector: (coin: MockCoin | undefined) => T,
): T {
  const cacheRef = useRef<SliceCache<T> | null>(null);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const read = useCallback(
    (coin: MockCoin | undefined): T => {
      const cached = cacheRef.current;
      if (cached !== null && cached.coin === coin) return cached.slice;
      const next = selectorRef.current(coin);
      if (cached !== null && coinSlicesEqual(cached.slice, next)) {
        // Fresh coin object, identical slice content: keep the previous
        // reference so useSyncExternalStore skips the re-render.
        cacheRef.current = { coin, slice: cached.slice };
        return cached.slice;
      }
      cacheRef.current = { coin, slice: next };
      return next;
    },
    [],
  );

  const subscribe = useCallback(
    (onChange: Listener) => {
      let unsubCoin: (() => void) | null = null;
      const sync = () => {
        if (!handle.isFrozen() && unsubCoin === null) {
          unsubCoin = store.subscribeCoin(handle.cardKey, onChange);
          // Catch anything that changed while frozen: getSnapshot reads
          // latest, the slice compare decides whether to re-render.
          onChange();
        } else if (handle.isFrozen() && unsubCoin !== null) {
          unsubCoin();
          unsubCoin = null;
        }
      };
      sync();
      const unsubFrozen = handle.subscribeFrozen(sync);
      return () => {
        unsubFrozen();
        if (unsubCoin !== null) unsubCoin();
      };
    },
    [store, handle],
  );

  const getSnapshot = useCallback(
    () => read(store.getCoin(handle.cardKey) ?? handle.getFallback()),
    [read, store, handle],
  );
  // Server (and the client hydration pass) renders from the fallback row
  // only — the store is client-seeded after hydration, exactly like
  // `useDiscoverCoin`'s undefined server snapshot + `?? fallbackCoin`.
  const getServerSnapshot = useCallback(
    () => read(handle.getFallback()),
    [read, handle],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Island hook: select a live slice of the enclosing card's coin. Must be
 * rendered under the card wrapper's `CardLiveContext` provider.
 */
export function useCardCoinSlice<T>(selector: (coin: MockCoin | undefined) => T): T {
  const store = useContext(DiscoverCoinStoreContext);
  const handle = useContext(CardLiveContext);
  if (handle === null) {
    throw new Error('useCardCoinSlice must render inside a CardLiveContext provider');
  }
  return useCoinSliceOf(store, handle, selector);
}

/**
 * Wrapper hook: same slice machinery, bound to an explicit handle (the
 * card wrapper selects its structural slice before providing context).
 */
export function useCoinSliceWithHandle<T>(
  handle: CardLiveHandle,
  selector: (coin: MockCoin | undefined) => T,
): T {
  const store = useContext(DiscoverCoinStoreContext);
  return useCoinSliceOf(store, handle, selector);
}

/**
 * Click-time read of the card's CURRENT coin (latest store data, falling
 * back to the fixture row). Handlers use this instead of closing over
 * churny fields, so they need no live subscription at all.
 */
export function readCardCoin(
  store: DiscoverFeedStore,
  handle: CardLiveHandle,
): MockCoin | undefined {
  return store.getCoin(handle.cardKey) ?? handle.getFallback();
}

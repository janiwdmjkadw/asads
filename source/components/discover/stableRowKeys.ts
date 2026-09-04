import { useCallback, useRef } from 'react';

/**
 * Structural order slice for a rendered Discover row (phase 0.3).
 *
 * Splits a derived row list into the two things the column actually needs:
 *
 *   - `keys`: the row ORDER as `cardKey[]`. The reference is REUSED whenever
 *     keys and positions are element-for-element equal with the previous
 *     render, so a content-only feed tick (fresh coin objects, same rows in
 *     the same slots) hands the memoized lane the exact same array and the
 *     50-slot list reconciliation is skipped entirely. Cards keep receiving
 *     fresh data through their own per-coin store subscription
 *     (`useDiscoverCoin`), so nothing renders stale — only the ORDER
 *     reference is stabilized.
 *   - `getItem`: identity-stable lookup of the LATEST item for a key, read
 *     by the lane's `renderCard` when it does re-render (order change /
 *     flash). Backed by a ref that is refreshed on every render, so a
 *     re-rendering lane always sees current data; a memo-skipped lane never
 *     reads it.
 *
 * The ref writes during render are idempotent for a given `items` input
 * (same pattern as DiscoverPage's `prewarmLanesRef`); these renders are
 * synchronous `useSyncExternalStore` updates, never time-sliced.
 */
const EMPTY_KEYS: string[] = [];

export function useStableRowKeys<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { keys: string[]; getItem: (key: string) => T | undefined } {
  const keysRef = useRef<string[]>(EMPTY_KEYS);
  const byKeyRef = useRef<ReadonlyMap<string, T>>(new Map());

  const byKey = new Map<string, T>();
  const next: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (byKey.has(key)) continue; // defensive de-dupe (mirrors the store)
    byKey.set(key, item);
    next.push(key);
  }
  byKeyRef.current = byKey;
  if (!keysEqual(keysRef.current, next)) keysRef.current = next;

  const getItem = useCallback((key: string): T | undefined => byKeyRef.current.get(key), []);
  return { keys: keysRef.current, getItem };
}

function keysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

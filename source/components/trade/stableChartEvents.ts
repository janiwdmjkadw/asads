import { useRef } from 'react';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';

/**
 * True when both arrays cover the SAME (signature:wallet) key-set. The
 * bubble-event memos re-derive from the live tape on every trade tick, so
 * most recomputes produce a fresh array with identical contents — key-set
 * equality is the cheap O(n) proof that nothing bubble-relevant changed
 * (same-key history/tape events describe the same tx with equivalent
 * fields, so equal key-sets means equal bubbles).
 */
export function sameEventKeySet(
  a: readonly WalletActivityEvent[],
  b: readonly WalletActivityEvent[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const aKeys = new Set<string>();
  for (const event of a) aKeys.add(`${event.signature}:${event.wallet}`);
  // Duplicate keys make a set-size proof unsound — report changed and let
  // the caller take the fresh array (correct, just not identity-stable).
  if (aKeys.size !== a.length) return false;
  const bKeys = new Set<string>();
  for (const event of b) {
    const key = `${event.signature}:${event.wallet}`;
    if (!aKeys.has(key)) return false;
    bKeys.add(key);
  }
  return bKeys.size === a.length;
}

/**
 * Identity-stabilizing pass for a derived event array: keeps returning the
 * previous array while the (signature:wallet) key-set is unchanged, so
 * downstream memos (the chart's wallet-marker model) rebuild only when a
 * bubble-relevant event actually arrives — not on every tape tick.
 */
export function useStableEventArray(next: WalletActivityEvent[]): WalletActivityEvent[] {
  const ref = useRef(next);
  if (ref.current !== next && !sameEventKeySet(ref.current, next)) {
    ref.current = next;
  }
  return ref.current;
}

/**
 * Generic form of `useStableEventArray` for non-event rows (the tape's
 * bubble-relevant TokenTrade slice): keeps the previous array while the
 * key-set is unchanged. Same duplicate-key soundness rule as
 * `sameEventKeySet` — duplicates report "changed" and take the fresh array.
 * `keyOf` must be a stable module-level function.
 */
export function useStableKeyedArray<T>(next: T[], keyOf: (item: T) => string): T[] {
  const ref = useRef(next);
  if (ref.current !== next && !sameKeySet(ref.current, next, keyOf)) {
    ref.current = next;
  }
  return ref.current;
}

function sameKeySet<T>(a: readonly T[], b: readonly T[], keyOf: (item: T) => string): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const aKeys = new Set<string>();
  for (const item of a) aKeys.add(keyOf(item));
  if (aKeys.size !== a.length) return false;
  const bKeys = new Set<string>();
  for (const item of b) {
    const key = keyOf(item);
    if (!aKeys.has(key)) return false;
    bKeys.add(key);
  }
  return bKeys.size === a.length;
}

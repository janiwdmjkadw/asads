// Section-header search: case-folded substring match over ticker / name /
// mint. Pure so the per-section row derivations stay unit-testable; the query
// is folded ONCE per derivation (not per coin), and an empty query is a
// perfect no-op — the input array is returned by reference so memoized
// consumers see identical output identity.

export interface SearchableCoin {
  /** Mint pubkey for live coins; static mocks may omit it. */
  id?: string | null;
  ticker: string;
  name: string;
}

export function coinMatchesSearch(coin: SearchableCoin, foldedQuery: string): boolean {
  if (foldedQuery.length === 0) return true;
  return (
    coin.ticker.toLowerCase().includes(foldedQuery) ||
    coin.name.toLowerCase().includes(foldedQuery) ||
    (coin.id ? coin.id.toLowerCase().includes(foldedQuery) : false)
  );
}

export function filterCoinsBySearch<T extends SearchableCoin>(coins: T[], query: string): T[] {
  const folded = query.trim().toLowerCase();
  if (folded.length === 0) return coins;
  return coins.filter((coin) => coinMatchesSearch(coin, folded));
}

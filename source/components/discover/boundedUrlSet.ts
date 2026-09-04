/**
 * A tiny bounded LRU set of strings (URLs), extracted from the token-image
 * hover prefetch so the eviction logic is pure and unit-testable.
 *
 * Backed by a `Map` (which preserves insertion order, so the first key is the
 * least-recently-used). `add` returns whether the value was NEW -- the caller
 * uses that to decide whether to do the (idempotent but not free) side effect,
 * e.g. kick off an image prefetch. Re-adding an existing value just marks it
 * most-recently-used so it survives eviction longer.
 */
export interface BoundedUrlSet {
  /** Record `url` as most-recently-used. Returns true only if it was new. */
  add(url: string): boolean;
  has(url: string): boolean;
  readonly size: number;
}

export function createBoundedUrlSet(limit: number): BoundedUrlSet {
  const items = new Map<string, true>();
  return {
    add(url) {
      if (items.has(url)) {
        // Touch: re-insert so it moves to the most-recently-used end.
        items.delete(url);
        items.set(url, true);
        return false;
      }
      items.set(url, true);
      if (items.size > limit) {
        const oldest = items.keys().next().value;
        if (oldest !== undefined) items.delete(oldest);
      }
      return true;
    },
    has: (url) => items.has(url),
    get size() {
      return items.size;
    },
  };
}

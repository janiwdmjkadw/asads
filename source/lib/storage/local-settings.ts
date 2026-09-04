'use client';

/**
 * Generic Clerk-user-keyed JSON storage helpers backed by
 * `window.localStorage`. Used as a write-through cache for
 * server-persisted UI preferences so a page refresh shows the
 * last-known value instantly while the authoritative GET to the API
 * is in flight.
 *
 * Pattern:
 *
 *   T0          : page mount, store starts at default (empty)
 *   T0 + 1ms    : `loadLocalSettings(key, clerkUserId, parser)`
 *                 hydrates the store with the cached value -> input
 *                 + cards render the right number immediately
 *   T0 + ~300ms : server GET resolves, hydrate runs again with the
 *                 authoritative value (reconciliation). If the cache
 *                 was already current, the user sees no flicker.
 *   on change   : every store mutation writes back to localStorage
 *                 via a subscriber. Next refresh starts at step 1
 *                 with the latest value.
 *
 * Key format: `terminal:settings:<key>:<clerkUserId>`.
 *
 *  - Prefix `terminal:settings:` namespaces this from other
 *    `localStorage` usage in the app (e.g. selected-wallet-store,
 *    discover:show-mayhem) and makes a future bulk-clear trivial.
 *  - Binding to the Clerk user id means user A signing out and user
 *    B signing in on the same browser does not leak A's preferences
 *    into B's session. (Cross-user collisions are the most common
 *    "stale localStorage" footgun.)
 *  - We bind to the Clerk subject rather than the internal Aurora
 *    `identity.users.id` because the Clerk id is available
 *    synchronously after `useAuth()` resolves; the internal id
 *    requires a `/me` round-trip, which defeats the "instant
 *    preview" goal.
 *
 * Failure modes are all soft: a `try/catch` wraps every
 * `window.localStorage` call so privacy mode, quota-exceeded errors,
 * and disabled-storage browsers degrade to "no cache" rather than
 * crashing the page.
 *
 * The parser passed to `loadLocalSettings` is REQUIRED to validate
 * shape defensively — `localStorage` contents are user-mutable, and
 * a future app version may change the cached shape. A parser that
 * returns `null` for anything unexpected keeps the rest of the app
 * structurally trustworthy without a runtime crash on stale cache.
 */

const PREFIX = 'terminal:settings:';

function fullKey(key: string, userId: string): string {
  return `${PREFIX}${key}:${userId}`;
}

/**
 * The exact `localStorage` key a `(key, userId)` pair maps to. Exposed
 * so cross-tab `storage`-event listeners can match incoming events
 * against the keys this module writes without duplicating the format.
 */
export function localSettingsStorageKey(key: string, userId: string): string {
  return fullKey(key, userId);
}

export function loadLocalSettings<T>(
  key: string,
  userId: string,
  parse: (raw: unknown) => T | null,
): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(fullKey(key, userId));
    if (raw === null) return null;
    const json: unknown = JSON.parse(raw);
    return parse(json);
  } catch {
    return null;
  }
}

export function saveLocalSettings<T>(key: string, userId: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(fullKey(key, userId), JSON.stringify(value));
  } catch {
    /* Quota exceeded / privacy mode / disabled-storage browser. Silent
       — the cache is advisory; the server is the source of truth and
       the app continues working without local caching. */
  }
}

export function clearLocalSettings(key: string, userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(fullKey(key, userId));
  } catch {
    /* See `saveLocalSettings` — soft-fail. */
  }
}

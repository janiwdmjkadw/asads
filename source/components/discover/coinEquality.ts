import type { MockCoin } from './mockCoins';

/**
 * Fields that change on (nearly) every 250ms feed tick but are NOT
 * rendered by the card directly, so they must not force a re-render:
 *
 *   - `ageMs`: the raw `now - createdAt` millis, recomputed server-side
 *     every tick. The card renders `ageLabel` (a derived "23s"/"5m"
 *     string), which IS compared below -- so age still updates visibly
 *     when the label actually changes (per second / per minute), just
 *     not on every 250ms tick. Comparing the raw `ageMs` here would mark
 *     every coin "changed" every tick and defeat the whole optimization.
 *
 * `createdAtMs` / `lastTradeAtMs` / `marketCapUsd` are intentionally NOT
 * ignored: they drive DiscoverPage's live sort and must stay fresh in
 * the stored snapshot (they only change on trades, not every tick).
 */
const RENDER_IRRELEVANT_KEYS: ReadonlySet<keyof MockCoin> = new Set(['ageMs']);

/**
 * Structural equality for two `MockCoin`s, used by the Discover feed
 * store to decide whether an incoming tick actually changed a coin.
 *
 * Correctness contract: this MUST return `false` whenever any field that
 * affects the rendered card OR the live sort differs. The store reuses
 * the previous object reference (so the card skips re-render) ONLY when
 * this returns `true`, so a false positive would show stale data. We
 * compare keys generically -- scalars by `===`, arrays (`platforms`,
 * `kinds`) by element-wise content, nested objects (`links`) by shallow
 * field content -- skipping only the explicitly non-rendered,
 * every-tick fields in `RENDER_IRRELEVANT_KEYS`. A field added to
 * `MockCoin` later is automatically compared (covered by default).
 *
 * The inverse direction is safe: a false negative (declaring two equal
 * coins different) only costs one extra, harmless re-render.
 */
export function coinsEqual(a: MockCoin, b: MockCoin): boolean {
  if (a === b) return true;

  const aKeys = Object.keys(a) as (keyof MockCoin)[];
  const bKeys = Object.keys(b) as (keyof MockCoin)[];
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (RENDER_IRRELEVANT_KEYS.has(key)) continue;
    if (!coinValueEqual(a[key], b[key])) return false;
  }

  return true;
}

/**
 * Content equality for a single coin FIELD value, with the same rules
 * `coinsEqual` applies per key: scalars by `===`, arrays element-wise,
 * plain objects by shallow field content. Exported for the per-island
 * slice subscriptions (`cardLiveSlice.ts`), which compare selected
 * field subsets under the identical contract.
 */
export function coinValueEqual(av: unknown, bv: unknown): boolean {
  if (av === bv) return true;

  if (Array.isArray(av)) {
    return Array.isArray(bv) && arrayContentEqual(av, bv);
  }

  if (isPlainObject(av)) {
    return isPlainObject(bv) && objectContentEqual(av, bv);
  }

  // Scalars (string / number / boolean / null / undefined) that were
  // not `===` above are genuinely different.
  return false;
}

/**
 * Content equality for two SLICE records (field subsets a live island
 * selected off its coin). Key sets must match (selectors are static, so
 * they always do); values compare per `coinValueEqual`. Scalar slices
 * (a selector returning one value) compare directly.
 */
export function coinSlicesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!(key in b) || !coinValueEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return coinValueEqual(a, b);
}

function arrayContentEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    // Object elements (e.g. `feeShareRecipients`' `{pubkey, bps}` rows) are
    // freshly allocated by JSON.parse on every full-frame reconversion, so
    // reference equality would mark every fee-share coin dirty per re-seed.
    // Shallow content compare keeps them stable; scalars keep strict `===`.
    if (isPlainObject(av) && isPlainObject(bv) && objectContentEqual(av, bv)) continue;
    return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectContentEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    // `key in b` guards the undefined-valued-key case: {x: undefined} vs
    // {y: 1} match on key count and a.x === b.x (both undefined) — without
    // the presence check that is a false POSITIVE, which this module's
    // contract forbids (stale card data).
    if (!(key in b) || a[key] !== b[key]) return false;
  }
  return true;
}

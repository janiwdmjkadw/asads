/**
 * Phase-0 kill switches for the Discover feed pipeline (dev/probe only).
 * Each switch disables one stage of the delta pipeline so the headless
 * jank probe can attribute cost by ablation:
 *
 *   - `no-commit`      Full-frame seeds still apply (the board mounts once,
 *                      so the probe measures a realistic ~150-card DOM), but
 *                      DELTA commits never reach the store: frames parse and
 *                      patch the consumer base, dirty accumulates, and
 *                      `flushIfDirty()` is inert. What remains is the floor
 *                      imposed by parse/patch + all NON-feed work — the
 *                      ceiling on what any render-side optimization can buy.
 *   - `stable-order`   The consumer keeps the FIRST order it saw for the
 *                      lifetime of the page: upserted card content still
 *                      flows, order changes are ignored, and new mints not
 *                      in the retained order are simply not shown. Isolates
 *                      list-reconciliation/order cost from content updates.
 *   - `flashes-off`    Disables the arrival flash spans (wallet-mint flash +
 *                      graduation attention flash) at the point where the
 *                      flash sets are populated, so the page-level flash
 *                      setState re-renders are suppressed too. Cheap control.
 *   - `live-scroll`    Phase-1 measurement flag: feed commits keep applying
 *                      DURING active lane scrolling (the scroll leg of the
 *                      navigation pause no longer suppresses them). Scroll
 *                      ACTIVITY tracking itself is untouched — pointer-enter
 *                      heartbeat/arming guards behave exactly as in
 *                      production — so the probe isolates the commit-
 *                      suspension variable alone. This is the end-state goal
 *                      of the islands work (smooth scrolling currently
 *                      conceals stale numbers); shipping it is a product
 *                      decision made on the A/B numbers. Implies
 *                      `scroll-defer-off` (frames must parse during scroll
 *                      to be applied during scroll).
 *   - `scroll-defer-off` Ablation flag for the scroll parse deferral (the
 *                      DEFAULT behavior stashes raw delta frames during
 *                      active lane scrolling and replays them on resume;
 *                      see deltaWire.ts). ON restores the old parse-during-
 *                      scroll behavior so the probe can attribute the
 *                      mid-scroll 33-50ms frame slips to parse/patch.
 *
 * OFF is byte-identical behavior: each switch resolves once per page load
 * (localStorage `listen:feed-kill:<name>`, key style per feedPerfStats),
 * is cached, and hot paths only ever read a boolean captured at consumer
 * construction. `?feedkill=<name>[,<name>…]` is the probe-convenience
 * query-param equivalent (persists the named switches and CLEARS the
 * others; `?feedkill=0` clears all). Page reload applies changes — there
 * is no live toggling.
 */

const KEY_PREFIX = 'listen:feed-kill:';

export type FeedKillSwitch =
  | 'no-commit'
  | 'stable-order'
  | 'flashes-off'
  | 'live-scroll'
  | 'scroll-defer-off';

const cache = new Map<FeedKillSwitch, boolean>();

/**
 * Resolve a switch once and cache the verdict (pattern per feedPerfStats).
 * Reads `?feedkill` first — when present it is authoritative for every
 * switch it resolves (named → persisted on, unnamed → cleared) — then the
 * stored key. Never memoizes on the server so the client re-resolves.
 */
export function feedKillSwitchEnabled(name: FeedKillSwitch): boolean {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined') return false;
  let result = false;
  try {
    const param = new URLSearchParams(window.location.search).get('feedkill');
    if (param !== null) {
      result = param
        .split(',')
        .map((entry) => entry.trim())
        .includes(name);
      if (result) window.localStorage.setItem(KEY_PREFIX + name, '1');
      else window.localStorage.removeItem(KEY_PREFIX + name);
    } else {
      result = window.localStorage.getItem(KEY_PREFIX + name) === '1';
    }
  } catch {
    result = false;
  }
  cache.set(name, result);
  return result;
}

/** Test-only: force/clear a cached switch verdict (null clears all). */
export function __setKillSwitchForTests(name: FeedKillSwitch | null, value?: boolean): void {
  if (name === null) {
    cache.clear();
    return;
  }
  if (value === undefined) cache.delete(name);
  else cache.set(name, value);
}

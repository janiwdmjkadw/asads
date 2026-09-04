/**
 * Phase-0 instrumentation for the Discover feed pipeline (dev/probe only,
 * NO behavior changes). Measures, per column stream and aggregated:
 *
 *   - Durations (sum + worst): JSON parse, base patch (patchDelta/seedFull,
 *     includes convert), materialize, and the store-apply callback.
 *   - React-commit proxy (`renderProxy`): apply-start -> the SECOND
 *     animation frame after the apply, i.e. after the browser had a paint
 *     opportunity for the resulting commit. A React `<Profiler>` would
 *     measure actualDuration directly, but production react-dom bundles
 *     never invoke Profiler's onRender (that needs the react-dom/profiling
 *     build), and the headless probe runs against `next build` output — so
 *     the double-rAF proxy is used everywhere instead of a dev-only number.
 *   - Changed cards (unique mints) per committed frame, plus changed-field
 *     counts over a small fixed numeric set (TRACKED_FIELDS).
 *   - Scroll/navigation suspension: suppressed commits, accumulated dirty
 *     time, and per catch-up flush the batch size (cards changed since the
 *     suspension began) + pause duration.
 *   - Order stats per committed frame: received / element-equal changed /
 *     length. The first apply of a session counts as changed (no baseline).
 *   - Store-apply transactions per animation-frame window ACROSS columns
 *     (`txWindows`): detects whether the streams commit in the same frame
 *     or separate frames.
 *
 * DISABLED BY DEFAULT. Enabled only on the client when `?feedperf=1` is in
 * the URL (persisted to `localStorage['listen:feed-perf']`, key style per
 * verboseLogs.ts) or that key is already `'1'`; `?feedperf=0` clears it.
 * When disabled, every hook site in deltaWire.ts is a single
 * `this.perf !== null` check — no timestamps, no allocation, no calls into
 * this module. When enabled, `window.__feedPerfStats` exposes
 * `{ snapshot(), reset() }` for the headless probe.
 */

import type { MockCoin } from './mockCoins';

const FLAG_KEY = 'listen:feed-perf';

/** The two real delta streams. The Graduated column has NO stream of its
 *  own — it is derived in DiscoverPage from the `graduated` subset of the
 *  new-pairs store, so its feed cost is already counted under 'new-pairs'. */
export type FeedPerfColumn = 'new-pairs' | 'almost-graduated';

const COLUMNS: readonly FeedPerfColumn[] = ['new-pairs', 'almost-graduated'];

/** Small fixed numeric set compared on upserted cards vs their previous
 *  version — the churny per-tick values, cheap `!==` per field. */
const TRACKED_FIELDS = [
  'marketCapUsd',
  'volumeUsd',
  'txns',
  'holderCount',
  'bondingProgressPct',
] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

interface DurationStat {
  count: number;
  totalMs: number;
  worstMs: number;
}

interface ColumnState {
  parse: DurationStat;
  patch: DurationStat;
  materialize: DurationStat;
  apply: DurationStat;
  renderProxy: DurationStat;
  /** Committed frames (store applies). */
  commits: number;
  /** Raw upsert events (a mint upserted twice pre-commit counts twice). */
  upsertEvents: number;
  /** Unique changed mints, summed per committed frame + worst frame. */
  cardsChangedTotal: number;
  cardsChangedWorst: number;
  fieldChanges: Record<TrackedField, number>;
  suppressedCommits: number;
  dirtyMsTotal: number;
  catchupCount: number;
  catchupBatchTotal: number;
  catchupBatchWorst: number;
  catchupPauseMsTotal: number;
  catchupPauseMsWorst: number;
  ordersReceived: number;
  ordersChanged: number;
  lastOrderLength: number;
  // --- transient, cleared on each apply ---
  pendingMints: Set<string>;
  pendingOrderReceived: boolean;
  suppressedSinceMs: number | null;
  prevOrder: readonly string[] | null;
  renderProxyPending: boolean;
}

export interface FeedPerfDurationSnapshot {
  count: number;
  totalMs: number;
  worstMs: number;
}

export interface FeedPerfColumnSnapshot {
  parse: FeedPerfDurationSnapshot;
  patch: FeedPerfDurationSnapshot;
  materialize: FeedPerfDurationSnapshot;
  apply: FeedPerfDurationSnapshot;
  renderProxy: FeedPerfDurationSnapshot;
  commits: number;
  upsertEvents: number;
  cardsChangedTotal: number;
  cardsChangedWorst: number;
  fieldChanges: Record<TrackedField, number>;
  suppressedCommits: number;
  dirtyMsTotal: number;
  catchups: {
    count: number;
    batchTotal: number;
    batchWorst: number;
    pauseMsTotal: number;
    pauseMsWorst: number;
  };
  order: {
    received: number;
    changed: number;
    lastLength: number;
  };
}

export interface FeedPerfSnapshot {
  enabled: boolean;
  columns: Record<FeedPerfColumn, FeedPerfColumnSnapshot>;
  /** Column sums (worsts are maxes; `order.lastLength` is the sum). */
  aggregate: FeedPerfColumnSnapshot;
  /** Store applies per animation-frame window across ALL columns. */
  txWindows: {
    count: number;
    appliesTotal: number;
    maxApplies: number;
    multiApplyWindows: number;
  };
  /** Store commits that reused the previous order reference (see
   *  discoverFeedStore commitOrder). */
  orderReuse: number;
}

let cached: boolean | null = null;

function newDuration(): DurationStat {
  return { count: 0, totalMs: 0, worstMs: 0 };
}

function newFieldChanges(): Record<TrackedField, number> {
  return {
    marketCapUsd: 0,
    volumeUsd: 0,
    txns: 0,
    holderCount: 0,
    bondingProgressPct: 0,
  };
}

function newColumnState(): ColumnState {
  return {
    parse: newDuration(),
    patch: newDuration(),
    materialize: newDuration(),
    apply: newDuration(),
    renderProxy: newDuration(),
    commits: 0,
    upsertEvents: 0,
    cardsChangedTotal: 0,
    cardsChangedWorst: 0,
    fieldChanges: newFieldChanges(),
    suppressedCommits: 0,
    dirtyMsTotal: 0,
    catchupCount: 0,
    catchupBatchTotal: 0,
    catchupBatchWorst: 0,
    catchupPauseMsTotal: 0,
    catchupPauseMsWorst: 0,
    ordersReceived: 0,
    ordersChanged: 0,
    lastOrderLength: 0,
    pendingMints: new Set<string>(),
    pendingOrderReceived: false,
    suppressedSinceMs: null,
    prevOrder: null,
    renderProxyPending: false,
  };
}

const states: Record<FeedPerfColumn, ColumnState> = {
  'new-pairs': newColumnState(),
  'almost-graduated': newColumnState(),
};

const txWindows = { count: 0, appliesTotal: 0, maxApplies: 0, multiApplyWindows: 0 };
let txWindowOpen = false;
let txWindowApplies = 0;
/** Store-level order-slice reuse hits (phase 0.3): commits whose key order
 *  was element-equal to the committed one, so the store kept the previous
 *  `order` array reference. Global (not per column) — the two feed stores
 *  share one counter, which is enough to verify the reuse path fires. */
let orderReuseHits = 0;

function defaultNow(): number {
  return performance.now();
}
let now: () => number = defaultNow;

function defaultScheduleFrame(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => callback());
    return;
  }
  setTimeout(callback, 0);
}
let scheduleFrame: (callback: () => void) => void = defaultScheduleFrame;

/**
 * Resolve the flag once and cache it (pattern per hotPathMetrics). Reads
 * `?feedperf` first (persisting the choice), then the stored key. Never
 * memoizes on the server so the client re-resolves post-hydration.
 */
function resolveEnabled(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  let result = false;
  try {
    const param = new URLSearchParams(window.location.search).get('feedperf');
    if (param === '1') {
      window.localStorage.setItem(FLAG_KEY, '1');
      result = true;
    } else if (param === '0') {
      window.localStorage.removeItem(FLAG_KEY);
      result = false;
    } else {
      result = window.localStorage.getItem(FLAG_KEY) === '1';
    }
  } catch {
    result = false;
  }
  cached = result;
  if (result) exposeOnWindow();
  return result;
}

/** The one boolean the hot path checks (deltaWire caches the verdict per
 *  consumer at construction — a single `!== null` per hook point after). */
export function enabled(): boolean {
  return resolveEnabled();
}

function record(stat: DurationStat, ms: number): void {
  stat.count += 1;
  stat.totalMs += ms;
  if (ms > stat.worstMs) stat.worstMs = ms;
}

export function noteParse(column: FeedPerfColumn, ms: number): void {
  if (!resolveEnabled()) return;
  record(states[column].parse, ms);
}

/** One base mutation pass (patchDelta or seedFull, convert included).
 *  `orderApplied` = the pass installed a new order (delta applied / seed). */
export function notePatch(column: FeedPerfColumn, ms: number, orderApplied: boolean): void {
  if (!resolveEnabled()) return;
  const state = states[column];
  record(state.patch, ms);
  if (orderApplied) state.pendingOrderReceived = true;
}

/** One converted upsert. `prev` is the card's previous converted version
 *  (undefined for a brand-new mint) — field diffs only run when enabled. */
export function noteUpsert(
  column: FeedPerfColumn,
  mint: string,
  prev: MockCoin | undefined,
  next: MockCoin,
): void {
  if (!resolveEnabled()) return;
  const state = states[column];
  state.upsertEvents += 1;
  state.pendingMints.add(mint);
  if (prev === undefined) return;
  for (const field of TRACKED_FIELDS) {
    if (prev[field] !== next[field]) state.fieldChanges[field] += 1;
  }
}

/** A store commit reused the previous order reference (element-equal keys). */
export function noteOrderReuse(): void {
  if (!resolveEnabled()) return;
  orderReuseHits += 1;
}

/** A commit was suppressed by the scroll/navigation pause. The first one
 *  of a pause anchors the dirty clock. */
export function noteSuppressedCommit(column: FeedPerfColumn): void {
  if (!resolveEnabled()) return;
  const state = states[column];
  state.suppressedCommits += 1;
  if (state.suppressedSinceMs === null) state.suppressedSinceMs = now();
}

export function noteMaterialize(column: FeedPerfColumn, ms: number): void {
  if (!resolveEnabled()) return;
  record(states[column].materialize, ms);
}

/**
 * One committed frame (store apply). Folds in the pending per-frame stats
 * (changed cards, order, catch-up), counts the apply into the shared
 * animation-frame transaction window, and schedules the double-rAF render
 * proxy anchored at `applyStartMs` (the moment the store write began).
 */
export function noteApply(
  column: FeedPerfColumn,
  ms: number,
  applyStartMs: number,
  order: readonly string[],
): void {
  if (!resolveEnabled()) return;
  const state = states[column];
  record(state.apply, ms);
  state.commits += 1;

  const changed = state.pendingMints.size;
  state.cardsChangedTotal += changed;
  if (changed > state.cardsChangedWorst) state.cardsChangedWorst = changed;
  state.pendingMints.clear();

  if (state.pendingOrderReceived) state.ordersReceived += 1;
  state.pendingOrderReceived = false;
  state.lastOrderLength = order.length;
  if (state.prevOrder === null || !ordersEqual(state.prevOrder, order)) {
    state.ordersChanged += 1;
  }
  state.prevOrder = order;

  if (state.suppressedSinceMs !== null) {
    // Catch-up flush: this apply is the first commit since the pause began,
    // so its changed set IS the accumulated batch.
    const pauseMs = now() - state.suppressedSinceMs;
    const batch = changed;
    state.suppressedSinceMs = null;
    state.dirtyMsTotal += pauseMs;
    state.catchupCount += 1;
    state.catchupBatchTotal += batch;
    if (batch > state.catchupBatchWorst) state.catchupBatchWorst = batch;
    state.catchupPauseMsTotal += pauseMs;
    if (pauseMs > state.catchupPauseMsWorst) state.catchupPauseMsWorst = pauseMs;
  }

  countApplyInWindow();

  if (!state.renderProxyPending) {
    state.renderProxyPending = true;
    scheduleFrame(() => {
      scheduleFrame(() => {
        state.renderProxyPending = false;
        record(state.renderProxy, now() - applyStartMs);
      });
    });
  }
}

function ordersEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function countApplyInWindow(): void {
  if (txWindowOpen) {
    txWindowApplies += 1;
    return;
  }
  txWindowOpen = true;
  txWindowApplies = 1;
  scheduleFrame(() => {
    const applies = txWindowApplies;
    txWindowOpen = false;
    txWindowApplies = 0;
    txWindows.count += 1;
    txWindows.appliesTotal += applies;
    if (applies > txWindows.maxApplies) txWindows.maxApplies = applies;
    if (applies > 1) txWindows.multiApplyWindows += 1;
  });
}

function snapshotDuration(stat: DurationStat): FeedPerfDurationSnapshot {
  return { count: stat.count, totalMs: stat.totalMs, worstMs: stat.worstMs };
}

function snapshotColumn(state: ColumnState): FeedPerfColumnSnapshot {
  return {
    parse: snapshotDuration(state.parse),
    patch: snapshotDuration(state.patch),
    materialize: snapshotDuration(state.materialize),
    apply: snapshotDuration(state.apply),
    renderProxy: snapshotDuration(state.renderProxy),
    commits: state.commits,
    upsertEvents: state.upsertEvents,
    cardsChangedTotal: state.cardsChangedTotal,
    cardsChangedWorst: state.cardsChangedWorst,
    fieldChanges: { ...state.fieldChanges },
    suppressedCommits: state.suppressedCommits,
    dirtyMsTotal: state.dirtyMsTotal,
    catchups: {
      count: state.catchupCount,
      batchTotal: state.catchupBatchTotal,
      batchWorst: state.catchupBatchWorst,
      pauseMsTotal: state.catchupPauseMsTotal,
      pauseMsWorst: state.catchupPauseMsWorst,
    },
    order: {
      received: state.ordersReceived,
      changed: state.ordersChanged,
      lastLength: state.lastOrderLength,
    },
  };
}

function mergeDuration(into: FeedPerfDurationSnapshot, from: FeedPerfDurationSnapshot): void {
  into.count += from.count;
  into.totalMs += from.totalMs;
  if (from.worstMs > into.worstMs) into.worstMs = from.worstMs;
}

function aggregateColumns(
  columns: Record<FeedPerfColumn, FeedPerfColumnSnapshot>,
): FeedPerfColumnSnapshot {
  const aggregate = snapshotColumn(newColumnState());
  for (const column of COLUMNS) {
    const from = columns[column];
    mergeDuration(aggregate.parse, from.parse);
    mergeDuration(aggregate.patch, from.patch);
    mergeDuration(aggregate.materialize, from.materialize);
    mergeDuration(aggregate.apply, from.apply);
    mergeDuration(aggregate.renderProxy, from.renderProxy);
    aggregate.commits += from.commits;
    aggregate.upsertEvents += from.upsertEvents;
    aggregate.cardsChangedTotal += from.cardsChangedTotal;
    if (from.cardsChangedWorst > aggregate.cardsChangedWorst) {
      aggregate.cardsChangedWorst = from.cardsChangedWorst;
    }
    for (const field of TRACKED_FIELDS) {
      aggregate.fieldChanges[field] += from.fieldChanges[field];
    }
    aggregate.suppressedCommits += from.suppressedCommits;
    aggregate.dirtyMsTotal += from.dirtyMsTotal;
    aggregate.catchups.count += from.catchups.count;
    aggregate.catchups.batchTotal += from.catchups.batchTotal;
    if (from.catchups.batchWorst > aggregate.catchups.batchWorst) {
      aggregate.catchups.batchWorst = from.catchups.batchWorst;
    }
    aggregate.catchups.pauseMsTotal += from.catchups.pauseMsTotal;
    if (from.catchups.pauseMsWorst > aggregate.catchups.pauseMsWorst) {
      aggregate.catchups.pauseMsWorst = from.catchups.pauseMsWorst;
    }
    aggregate.order.received += from.order.received;
    aggregate.order.changed += from.order.changed;
    aggregate.order.lastLength += from.order.lastLength;
  }
  return aggregate;
}

/** Plain-object copy of all counters — what the headless probe reads via
 *  `window.__feedPerfStats.snapshot()`. */
export function snapshot(): FeedPerfSnapshot {
  const columns = {
    'new-pairs': snapshotColumn(states['new-pairs']),
    'almost-graduated': snapshotColumn(states['almost-graduated']),
  };
  return {
    enabled: cached === true,
    columns,
    aggregate: aggregateColumns(columns),
    txWindows: { ...txWindows },
    orderReuse: orderReuseHits,
  };
}

/** Zero all counters (the enable flag is untouched). */
export function reset(): void {
  states['new-pairs'] = newColumnState();
  states['almost-graduated'] = newColumnState();
  txWindows.count = 0;
  txWindows.appliesTotal = 0;
  txWindows.maxApplies = 0;
  txWindows.multiApplyWindows = 0;
  txWindowOpen = false;
  txWindowApplies = 0;
  orderReuseHits = 0;
}

function exposeOnWindow(): void {
  if (typeof window === 'undefined') return;
  const global = window as unknown as {
    __feedPerfStats?: { snapshot: typeof snapshot; reset: typeof reset };
  };
  global.__feedPerfStats = { snapshot, reset };
}

/** Test-only: force/clear the cached enable verdict. */
export function __setEnabledForTests(value: boolean | null): void {
  cached = value;
}

/** Test-only: replace the clock (null restores performance.now). */
export function __setNowForTests(fn: (() => number) | null): void {
  now = fn ?? defaultNow;
}

/** Test-only: replace the frame scheduler (null restores rAF/timeout). */
export function __setScheduleFrameForTests(fn: ((callback: () => void) => void) | null): void {
  scheduleFrame = fn ?? defaultScheduleFrame;
}

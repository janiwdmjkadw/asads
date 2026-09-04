import { compactAge } from '@/lib/format';
import * as feedPerf from './feedPerfStats';
import {
  enrollSharedFlush,
  unenrollSharedFlush,
  type FlushSchedule,
  type SharedFlushParticipant,
} from './feedFlushCoordinator';
import { feedKillSwitchEnabled } from './feedKillSwitches';
import type { FeedPerfColumn } from './feedPerfStats';
import type { LiveNewPair } from './useLiveNewPairs';
import type { MockCoin } from './mockCoins';

/**
 * `new-pairs-delta` SSE frame (`?wire=delta` connections): the full
 * authoritative row ordering plus full cards only for mints that are new or
 * changed since the server's previous tick. Anything absent from `order`
 * left the board. See `DiscoverDeltaEnvelope` on the ingestion side.
 */
export interface DiscoverDeltaFrame {
  seq?: number;
  order?: string[];
  upsert?: LiveNewPair[];
}

interface FullFrame {
  items?: LiveNewPair[];
}

export interface FeedStreamConsumerOptions {
  /** Wire card -> render card. Runs ONLY for new/changed cards on the delta
   *  path (this is the whole point: `livePairToCoin` is the expensive step —
   *  URL parsing, link normalization, number formatting — and used to run
   *  for every card on every frame). */
  convert(pair: LiveNewPair): MockCoin;
  /** Push a materialized full ordered listing into the store (render path). */
  apply(items: MockCoin[]): void;
  /** Navigation/modal pause: while true, frames only patch the base; the
   *  resume path calls `flushIfDirty()` to materialize once. */
  isPaused(): boolean;
  /** Active lane scroll (production: `isFeedScrollActive`). While true,
   *  delta frames are stashed RAW — not even parsed — and replayed in
   *  order by the resume flush. Field beacons showed the mid-scroll
   *  33-50ms frame slips (58→51 FPS) come from parse/convert/patch in the
   *  SSE handler, which the commit suspension never covered. Absent =
   *  never defer (non-scroll consumers, tests). */
  isScrolling?(): boolean;
  /** A delta could not be applied (no/broken base) — trigger one recovery
   *  poll. The next full seed restores the anchor. */
  onBaseLost(): void;
  /**
   * Policy for FULL frames with zero items: the main new-pairs feed ignores
   * them (a heartbeat/transient empty must never blank the board), the
   * almost-graduated feed applies them (its stream is authoritative and may
   * intentionally clear the row).
   */
  emptyFullFrames: 'ignore' | 'apply';
  /** Test seam: schedule the coalescing flush (production default is rAF +
   *  a hidden-tab timeout backstop). Returns a cancel. Consumers sharing a
   *  schedule FUNCTION share one flush wave (see feedFlushCoordinator) —
   *  production consumers all use the module default, so their applies land
   *  back-to-back in the same animation-frame window; harnesses that inject
   *  their own seam get a private wave. */
  scheduleFlush?(flush: () => void): () => void;
  /** Test seam for age-label refresh. */
  now?(): number;
  /** Phase-0 instrumentation column tag (see feedPerfStats.ts). Only takes
   *  effect when the `listen:feed-perf` flag is on; otherwise every hook
   *  point below reduces to one `this.perf !== null` check. */
  perfColumn?: FeedPerfColumn;
}

/**
 * When the tab is hidden, rAF never fires — flush on a timeout instead so
 * background consumers of the store (e.g. the Trade page's feed lookups)
 * don't go stale. Nothing paints while hidden, so the slower cadence is
 * free; a VISIBLE tab always flushes at the next animation frame.
 */
const HIDDEN_FLUSH_BACKSTOP_MS = 300;

/** Raw-frame stash cap while scroll-deferring (~30s of 250ms server ticks).
 *  Deltas are sequential patches, so overflow cannot drop just the oldest —
 *  the whole stash is abandoned and one recovery re-seed restores the base
 *  (same path as any other seq gap). */
const SCROLL_DEFER_MAX_FRAMES = 120;

function defaultScheduleFlush(flush: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    const timer = setTimeout(flush, 0);
    return () => clearTimeout(timer);
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(rafHandle);
    clearTimeout(timerHandle);
    flush();
  };
  const rafHandle = window.requestAnimationFrame(run);
  const timerHandle = setTimeout(run, HIDDEN_FLUSH_BACKSTOP_MS);
  return () => {
    done = true;
    window.cancelAnimationFrame(rafHandle);
    clearTimeout(timerHandle);
  };
}

/**
 * SSE frame consumer for a delta-wire discover stream. Owns the per-mint
 * base of CONVERTED render cards and keeps the whole pipeline O(changed):
 *
 *   - Full frames re-seed the base (rare: connect/reconnect/recovery poll).
 *   - Delta frames convert only the `upsert` cards and patch the base;
 *     unchanged cards keep their object identity, so the downstream store
 *     diff (`coinsEqual`) short-circuits on `===` instead of deep-comparing.
 *   - Age handling: `ageMs` advances every tick server-side, so deltas
 *     exclude it from change detection — materialization recomputes the
 *     label from `createdAtMs` locally and clones a card ONLY when its
 *     rendered label text actually changed (per second/minute, not per
 *     250ms tick).
 *
 * Delivery semantics (realtime is the product):
 *   - Full-frame SEEDS apply synchronously — the board mounts/re-bases with
 *     zero added latency (rare: connect/reconnect/recovery poll).
 *   - Delta commits enroll in a SHARED rAF-aligned flush wave (see
 *     feedFlushCoordinator): every consumer dirty in the same frame window
 *     applies back-to-back in one synchronous block — one React render
 *     batch instead of one per stream — at ≤1 frame of added latency
 *     (300ms backstop while the tab is hidden). Burst frames (reconnect
 *     catch-up, tab refocus) coalesce into the same wave: the listing
 *     materializes once per window, not once per frame.
 *   - While paused (route transition / search modal), frames only patch the
 *     base; `flushIfDirty()` on resume materializes once — the board is
 *     instantly current at O(changed)-per-frame stash cost.
 */
export class FeedStreamConsumer implements SharedFlushParticipant {
  private cards = new Map<string, MockCoin>();
  private order: string[] = [];
  private baseSeeded = false;
  private baseGeneration = 0;
  /** Server tick seq of the last applied delta. `null` = unknown (fresh
   *  full/REST seed — full frames carry no seq, so the first delta after a
   *  seed is accepted blind and re-anchors). Guards mid-stream contiguity:
   *  a delta whose seq is not `baseSeq + 1` was diffed against a tick we
   *  never applied, and patching it would silently render stale cards. */
  private baseSeq: number | null = null;
  private dirty = false;
  /** The flush-wave scheduler this consumer enrolls with — the coordinator
   *  keys shared waves by this function's identity. */
  private readonly schedule: FlushSchedule;
  /** Non-null ONLY when phase-0 instrumentation is enabled for this stream
   *  (flag + column tag). Every hook point guards on it, so the disabled
   *  path costs a single null check and never reads the clock. */
  private readonly perf: FeedPerfColumn | null;
  /** Phase-0 `no-commit` kill switch (see feedKillSwitches.ts): delta
   *  commits never reach the store — parse/patch keep the base current,
   *  dirty accumulates, and `flushIfDirty()` is inert. Full-frame seeds
   *  still apply so the board mounts a realistic card set to measure
   *  against. Resolved once at construction; OFF costs one boolean. */
  private readonly noCommit: boolean;
  /** Phase-0 `stable-order` kill switch: keep the FIRST (non-empty) order
   *  this consumer saw for the lifetime of the page. Upserted card content
   *  still flows; order changes are ignored; new mints outside the retained
   *  order are simply not shown (and the base skips its prune so retained
   *  rows survive server-side eviction — acceptable growth for a probe). */
  private readonly stableOrder: boolean;
  /** True once `stable-order` has captured its order. Never set while the
   *  switch is off, so the OFF path is byte-identical. */
  private orderFrozen = false;
  /** Raw delta frames stashed while scroll-deferring, in arrival order. */
  private pendingRaw: string[] = [];
  /** The stash overflowed: it was abandoned and the resume path must
   *  recover via one re-seed instead of replaying a broken seq chain. */
  private pendingOverflow = false;
  /** Scroll deferral enabled for this consumer (has an `isScrolling`
   *  source and no switch disables it). `scroll-defer-off` ablates the
   *  deferral; `live-scroll` needs frames applied DURING scroll, so the
   *  two are mutually exclusive and live-scroll wins. */
  private readonly scrollDefer: boolean;

  constructor(private readonly options: FeedStreamConsumerOptions) {
    this.perf =
      options.perfColumn !== undefined && feedPerf.enabled() ? options.perfColumn : null;
    this.noCommit = feedKillSwitchEnabled('no-commit');
    this.stableOrder = feedKillSwitchEnabled('stable-order');
    this.scrollDefer =
      options.isScrolling !== undefined &&
      !feedKillSwitchEnabled('scroll-defer-off') &&
      !feedKillSwitchEnabled('live-scroll');
    this.schedule = options.scheduleFlush ?? defaultScheduleFlush;
  }

  /** Full-frame SSE payload (`new-pairs` event / bare message). Returns
   *  TRUE when the payload parsed as a frame (even an ignored-empty one) —
   *  the reconnect-backoff reset signal ("the server is really talking",
   *  not merely "a socket opened"). */
  consumeFull(raw: string): boolean {
    try {
      const parseStart = this.perf !== null ? performance.now() : 0;
      const data = JSON.parse(raw) as FullFrame;
      if (this.perf !== null) feedPerf.noteParse(this.perf, performance.now() - parseStart);
      this.seedFull(data.items ?? []);
      return true;
    } catch {
      // Ignore malformed payloads or non-JSON heartbeats.
      return false;
    }
  }

  /** Replace the base with an authoritative full listing (SSE full frame or
   *  REST recovery poll). */
  seedFull(pairs: readonly LiveNewPair[]): void {
    if (pairs.length === 0 && this.options.emptyFullFrames === 'ignore') return;
    const patchStart = this.perf !== null ? performance.now() : 0;
    const cards = new Map<string, MockCoin>();
    const order: string[] = [];
    for (const pair of pairs) {
      if (!pair || typeof pair.mint !== 'string') continue;
      const converted = this.options.convert(pair);
      if (this.perf !== null) {
        feedPerf.noteUpsert(this.perf, pair.mint, this.cards.get(pair.mint), converted);
      }
      cards.set(pair.mint, converted);
      order.push(pair.mint);
    }
    if (this.orderFrozen) {
      // stable-order: a re-seed refreshes card content but never the order.
      for (const [mint, converted] of cards) this.cards.set(mint, converted);
    } else {
      this.cards = cards;
      this.order = order;
      if (this.stableOrder && order.length > 0) this.orderFrozen = true;
    }
    if (this.perf !== null) feedPerf.notePatch(this.perf, performance.now() - patchStart, true);
    // A seed re-bases the board; any scroll-stash predates it and replaying
    // it would patch stale content over the fresher base. Discard.
    this.pendingRaw = [];
    this.pendingOverflow = false;
    this.baseSeeded = true;
    this.baseSeq = null;
    this.baseGeneration += 1;
    this.commit(true);
  }

  /** True once an authoritative full listing has seeded the base. Ignored
   *  heartbeats/malformed frames never set it. Lets the mount-time REST
   *  hedge skip its seed when the SSE full frame already landed (a slow
   *  REST body must not roll back a newer live base). */
  hasBase(): boolean {
    return this.baseSeeded;
  }

  /** Monotonic count of applied base mutations (full seeds AND delta
   *  patches). A recovery poll captures this BEFORE its GET and seeds only
   *  if it is unchanged when the body resolves — a late REST body must not
   *  overwrite newer state (full-frame or delta-applied; either rollback
   *  also strands the next delta). */
  baseVersion(): number {
    return this.baseGeneration;
  }

  /** Delta-frame SSE payload (`new-pairs-delta` event). Returns TRUE when
   *  the payload parsed as a frame (applied or not) — see `consumeFull`. */
  consumeDelta(raw: string): boolean {
    if (this.scrollDefer && this.options.isScrolling?.() === true) {
      // Mid-scroll: stash raw and get off the frame path — parse, convert,
      // and patch all wait for the resume replay. Returning true without
      // parsing treats mid-scroll heartbeats as "server is talking" for
      // the reconnect backoff, which is the right read anyway.
      if (this.pendingRaw.length >= SCROLL_DEFER_MAX_FRAMES) {
        this.pendingRaw = [];
        this.pendingOverflow = true;
      } else {
        this.pendingRaw.push(raw);
      }
      return true;
    }
    try {
      const applied = this.parseAndPatch(raw);
      if (applied) this.commit();
      return true;
    } catch {
      // Ignore malformed payloads or non-JSON heartbeats.
      return false;
    }
  }

  /** Parse one raw delta payload and patch the base. Throws on non-JSON
   *  (caller decides whether that matters). Returns patchDelta's verdict. */
  private parseAndPatch(raw: string): boolean {
    const parseStart = this.perf !== null ? performance.now() : 0;
    const frame = JSON.parse(raw) as DiscoverDeltaFrame;
    if (this.perf !== null) feedPerf.noteParse(this.perf, performance.now() - parseStart);
    const patchStart = this.perf !== null ? performance.now() : 0;
    const applied = this.patchDelta(frame);
    if (this.perf !== null) {
      feedPerf.notePatch(this.perf, performance.now() - patchStart, applied);
    }
    return applied;
  }

  /** Drain the scroll-stash as ONE merged patch: the naive frame-by-frame
   *  replay moved the parse/convert cost into the post-scroll settle
   *  window (measured: settle hitches 13→21). Hot cards are upserted in
   *  many stashed frames but only the LAST value renders, so the merge
   *  converts each changed mint once, rebuilds the order once, and bumps
   *  the base generation once. Seq contiguity is validated across the
   *  stash; a gap (or an overflowed stash) recovers via one re-seed,
   *  exactly like any other seq gap. */
  private drainDeferred(): void {
    if (this.pendingOverflow) {
      this.pendingOverflow = false;
      this.pendingRaw = [];
      this.baseSeq = null;
      this.options.onBaseLost();
      return;
    }
    if (this.pendingRaw.length === 0) return;
    const stash = this.pendingRaw;
    this.pendingRaw = [];
    const parseStart = this.perf !== null ? performance.now() : 0;
    const latest = new Map<string, LiveNewPair>();
    let order: string[] | null = null;
    let chainSeq = this.baseSeq;
    for (const raw of stash) {
      let frame: DiscoverDeltaFrame;
      try {
        frame = JSON.parse(raw) as DiscoverDeltaFrame;
      } catch {
        continue; // malformed payload/heartbeat: same silent skip as live
      }
      const seq = typeof frame.seq === 'number' ? frame.seq : null;
      if (seq !== null && chainSeq !== null && seq !== chainSeq + 1) {
        if (this.perf !== null) feedPerf.noteParse(this.perf, performance.now() - parseStart);
        this.baseSeq = null;
        this.options.onBaseLost();
        return;
      }
      if (seq !== null) chainSeq = seq;
      const frameOrder = frame.order ?? [];
      if (frameOrder.length === 0) continue; // empty tick: chain already advanced
      for (const card of frame.upsert ?? []) {
        if (card && typeof card.mint === 'string') latest.set(card.mint, card);
      }
      order = frameOrder;
    }
    if (this.perf !== null) feedPerf.noteParse(this.perf, performance.now() - parseStart);
    if (order === null) {
      // Only empty/malformed ticks: keep the seq anchor current.
      if (chainSeq !== null) this.baseSeq = chainSeq;
      return;
    }
    // Apply the merged result through the normal patch path (stable-order,
    // membership validation, generation bump). The chain was validated
    // above — clear the anchor so patchDelta accepts and re-anchors at the
    // stash's end seq.
    this.baseSeq = null;
    const patchStart = this.perf !== null ? performance.now() : 0;
    const applied = this.patchDelta({
      seq: chainSeq ?? undefined,
      order,
      upsert: [...latest.values()],
    });
    if (this.perf !== null) {
      feedPerf.notePatch(this.perf, performance.now() - patchStart, applied);
    }
    if (applied) this.dirty = true;
  }

  /** Resume path: replay any scroll-stash, then materialize + apply the
   *  latest patched base once. */
  flushIfDirty(): void {
    this.drainDeferred();
    if (this.noCommit) return; // kill switch: catch-up flushes are inert too
    if (this.dirty) this.applyNow();
  }

  /** Effect cleanup: leave any pending shared flush wave (the wave's
   *  schedule is cancelled when the last participant leaves). */
  dispose(): void {
    unenrollSharedFlush(this, this.schedule);
  }

  /** Shared-wave flush entry point (see feedFlushCoordinator): apply the
   *  latest patched base if this consumer is still dirty. A resume flush or
   *  kill switch may have drained/blocked it since enrollment — no-op then. */
  flushShared(): void {
    if (this.noCommit) return;
    if (this.dirty && !this.options.isPaused()) this.applyNow();
  }

  /**
   * Patch the base with one delta frame. Returns `false` when nothing should
   * be committed: an empty `order` is a no-op rather than an instruction to
   * clear the board (real empties arrive as full frames), and a missing base
   * or a mint the ordering references that we don't hold means we lost the
   * full-frame anchor — `onBaseLost` triggers a recovery re-seed.
   */
  private patchDelta(frame: DiscoverDeltaFrame): boolean {
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    const order = frame.order ?? [];
    if (order.length === 0) {
      // Deliberate no-op (empty board tick) — but keep the seq anchor
      // current so the next non-empty delta isn't misread as a gap.
      if (seq !== null) this.baseSeq = seq;
      return false;
    }
    if (!this.baseSeeded) {
      this.options.onBaseLost();
      return false;
    }
    if (seq !== null && this.baseSeq !== null && seq !== this.baseSeq + 1) {
      // Non-contiguous delta: it was diffed against a tick this base never
      // applied (dropped frames, cross-connection mix, server restart).
      // Cards whose only change happened in the missed ticks would render
      // stale with no error — drop the frame and request a fresh anchor.
      this.baseSeq = null;
      this.options.onBaseLost();
      return false;
    }
    for (const card of frame.upsert ?? []) {
      if (card && typeof card.mint === 'string') {
        const converted = this.options.convert(card);
        if (this.perf !== null) {
          feedPerf.noteUpsert(this.perf, card.mint, this.cards.get(card.mint), converted);
        }
        this.cards.set(card.mint, converted);
      }
    }
    if (this.orderFrozen) {
      // stable-order: ignore the frame's ordering and skip the prune —
      // frozen rows must survive server-side eviction to stay rendered.
    } else {
      // Rebuild the base keyed by the new order (reference moves only): prunes
      // mints that left the board so the base cannot grow unbounded.
      const next = new Map<string, MockCoin>();
      for (const mint of order) {
        const coin = this.cards.get(mint);
        if (coin === undefined) {
          this.options.onBaseLost();
          return false;
        }
        next.set(mint, coin);
      }
      this.cards = next;
      this.order = order;
      if (this.stableOrder) this.orderFrozen = true;
    }
    if (seq !== null) this.baseSeq = seq;
    // A delta advances the base too: a recovery GET captured before this
    // frame is now stale and must not clobber the delta-applied state.
    this.baseGeneration += 1;
    return true;
  }

  private commit(fromSeed = false): void {
    this.dirty = true;
    // no-commit kill switch: delta ticks stop here (base patched, store
    // untouched, dirty accumulating). Seeds pass so the board mounts.
    if (this.noCommit && !fromSeed) return;
    if (this.options.isPaused()) {
      if (this.perf !== null) feedPerf.noteSuppressedCommit(this.perf);
      return;
    }
    if (fromSeed) {
      // Seeds re-base the whole board and are rare — apply synchronously so
      // mount/recovery latency stays zero. A pending wave then finds this
      // consumer clean and skips it.
      this.applyNow();
      return;
    }
    // Delta tick: join the shared rAF-aligned wave. Same-window commits
    // from ANY consumer flush back-to-back as one notification block;
    // re-enrolling while a wave is pending is a Set no-op.
    enrollSharedFlush(this, this.schedule);
  }

  private applyNow(): void {
    this.dirty = false;
    if (this.perf !== null) {
      const materializeStart = performance.now();
      const listing = this.materialize();
      const applyStart = performance.now();
      feedPerf.noteMaterialize(this.perf, applyStart - materializeStart);
      this.options.apply(listing);
      feedPerf.noteApply(this.perf, performance.now() - applyStart, applyStart, this.order);
      return;
    }
    this.options.apply(this.materialize());
  }

  private materialize(): MockCoin[] {
    const now = this.options.now?.() ?? Date.now();
    const items: MockCoin[] = [];
    for (const mint of this.order) {
      let coin = this.cards.get(mint);
      if (!coin) continue; // unreachable: seed/patch validated membership
      const createdAtMs = coin.createdAtMs;
      if (typeof createdAtMs === 'number' && createdAtMs > 0) {
        const ageMs = Math.max(0, now - createdAtMs);
        const ageLabel = compactAge(ageMs);
        if (ageLabel !== coin.ageLabel) {
          coin = { ...coin, ageMs, ageLabel };
          this.cards.set(mint, coin);
        }
      }
      items.push(coin);
    }
    return items;
  }
}

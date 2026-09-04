/**
 * Feed pause: navigation transitions + covering overlays.
 *
 * While a route transition is in flight — or the token search modal covers
 * the board — Discover's SSE frame application (full-feed diff-merge +
 * store notifications + card re-renders) competes with the router/typing
 * for main-thread time — measured at ~5s of added click→chart latency on
 * 4x-throttled CPUs (perf-harness report) and 66-234ms blocks per delta
 * frame in production perf beacons. Pausing frame APPLICATION for those
 * windows removes the contention at zero data cost: every SSE frame (and
 * the delta base kept current underneath) carries the complete top-N
 * state, so the resume flush applies the latest stashed frame and the feed
 * is instantly current — nothing is ever missed, only deferred.
 *
 * The navigation pause is bounded by a safety timeout so a stalled
 * navigation can never freeze the feed; the modal pause is exactly
 * scoped to the modal's open state (effect cleanup releases it).
 */

import { feedKillSwitchEnabled } from './feedKillSwitches';

const SAFETY_RESUME_MS = 2_000;

/** Trailing window after the last lane scroll event before the feed resumes.
 *  Long enough to cover the gap between wheel ticks in a continuous scroll,
 *  short enough that the post-scroll catch-up flush feels instant. */
const SCROLL_RESUME_MS = 250;

type ResumeCallback = () => void;

let paused = false;
/** Held while an overlay (the token search modal) covers the feed — the
 *  cards behind it are barely visible, and perf beacons measured the
 *  delta-apply + re-render pipeline blocking the main thread 66-234ms per
 *  frame, starving the search keystroke path. No safety timer: the modal
 *  holds the pause for exactly as long as it is open (its effect cleanup
 *  is the release). */
let modalPaused = false;
/** Held while a card lane is actively scrolling — feed applies (store
 *  ingest + React re-render, 50-250ms tasks in field beacons) were the
 *  dominant frame-drop source during scroll. Trailing-edge release. */
let scrollPaused = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let scrollResumeFrame: number | null = null;
let lastScrollAt = 0;
const resumeCallbacks = new Set<ResumeCallback>();

export function isFeedPausedForNavigation(): boolean {
  // `live-scroll` (phase-1 probe flag, cached one-time read): commits keep
  // applying during scroll; only the navigation/modal legs still pause.
  // Scroll-activity tracking (`isFeedScrollActive`) is deliberately NOT
  // affected — pointer heartbeat/arming guards keep production behavior.
  return (
    paused
    || modalPaused
    || (scrollPaused && !feedKillSwitchEnabled('live-scroll'))
  );
}

/** True while a Discover card lane is being actively scrolled. */
export function isFeedScrollActive(): boolean {
  return scrollPaused;
}

/** Called by the navigation bridge right before `router.push`. */
export function pauseFeedForNavigation(): void {
  paused = true;
  if (safetyTimer !== null) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    resumeFeedAfterNavigation();
  }, SAFETY_RESUME_MS);
}

/** Called when the route settles (pathname change) — and by the safety timer. */
export function resumeFeedAfterNavigation(): void {
  if (!paused) return;
  paused = false;
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (!modalPaused && !scrollPaused) fireResumeCallbacks();
}

/** Called by the search modal on open. */
export function pauseFeedForModal(): void {
  modalPaused = true;
}

/** Called by the search modal on close/unmount. */
export function resumeFeedAfterModal(): void {
  if (!modalPaused) return;
  modalPaused = false;
  if (!paused && !scrollPaused) fireResumeCallbacks();
}

/**
 * Called from each card lane's (passive) scroll handler: holds the pause
 * while scroll events keep arriving and releases — with the catch-up
 * flush — SCROLL_RESUME_MS after the last one.
 */
export function noteFeedScrollActivity(): void {
  scrollPaused = true;
  lastScrollAt = Date.now();
  cancelScrollResumeFrame();
  if (scrollTimer === null) armScrollRelease(SCROLL_RESUME_MS);
}

function armScrollRelease(delay: number): void {
  scrollTimer = setTimeout(() => {
    const remaining = lastScrollAt + SCROLL_RESUME_MS - Date.now();
    if (remaining > 0) {
      armScrollRelease(remaining);
      return;
    }
    scrollTimer = null;
    scheduleScrollResumeCallbacks();
  }, delay);
}

/**
 * Keep the feed paused while the browser paints the lane's final native scroll
 * position. The second rAF runs after that paint opportunity, releases the
 * scroll leg, then flushes the latest stashed snapshot. A renewed scroll
 * cancels either frame before the pause can open.
 */
function scheduleScrollResumeCallbacks(): void {
  if (scrollResumeFrame !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    scrollResumeFrame = requestAnimationFrame(() => {
      scrollResumeFrame = requestAnimationFrame(() => {
        scrollResumeFrame = null;
        scrollPaused = false;
        if (!paused && !modalPaused) fireResumeCallbacks();
      });
    });
    return;
  }
  // Non-browser test runners have no rAF. Preserve the same asynchronous
  // boundary with a zero-delay timer rather than making tests use a special
  // synchronous production path.
  scrollResumeFrame = setTimeout(() => {
    scrollResumeFrame = setTimeout(() => {
      scrollResumeFrame = null;
      scrollPaused = false;
      if (!paused && !modalPaused) fireResumeCallbacks();
    }, 0) as unknown as number;
  }, 0) as unknown as number;
}

function cancelScrollResumeFrame(): void {
  if (scrollResumeFrame === null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scrollResumeFrame);
  else clearTimeout(scrollResumeFrame);
  scrollResumeFrame = null;
}

function fireResumeCallbacks(): void {
  cancelScrollResumeFrame();
  for (const callback of resumeCallbacks) {
    try {
      callback();
    } catch {
      // One consumer's resume failure must not starve the others.
    }
  }
}

/**
 * Ingestion hooks register a callback that applies their stashed latest
 * frame on resume. Returns an unsubscribe for effect cleanup.
 */
export function onFeedResume(callback: ResumeCallback): () => void {
  resumeCallbacks.add(callback);
  return () => {
    resumeCallbacks.delete(callback);
  };
}

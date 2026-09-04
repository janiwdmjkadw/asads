/**
 * Scroll-time hover damping for Discover card lanes.
 *
 * While a lane is actively scrolling, cards sweep under the stationary
 * cursor and each one takes `:hover` — a transform-lift transition
 * (compositor layer promote/demote + a full card re-raster per card) and
 * the score-glow filter bump, on enter AND leave, per card swept. That
 * paint churn rides the scroll's frame budget.
 *
 * This marks the scrolled lane with `data-lane-scrolling` while scroll
 * events keep arriving and clears it 250ms after the last one (the same
 * trailing window as the feed scroll pause, so hover chrome returns
 * together with the feed catch-up flush). `discover.css` pins the
 * expensive hover chrome to its exact idle values under the attribute and
 * pins the incidental score→BUY hover visual to the score. This is CSS-only:
 * hit-testing and the quickbuy button's click/pointerdown handlers stay live.
 *
 * Per-event cost is one `Date.now()` + compare (single timer, timestamp
 * re-arm) — nothing on the scroll's critical path.
 */

const LANE_SCROLLING_ATTR = 'data-lane-scrolling';

/** Mirrors feedNavigationPause's SCROLL_RESUME_MS trailing window. */
const SCROLL_IDLE_MS = 250;

/** The slice of `Element` the damper drives (stubbed in tests). */
export interface DampedLane {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

let activeLane: DampedLane | null = null;
let lastScrollAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function armIdleRelease(delay: number): void {
  idleTimer = setTimeout(() => {
    const remaining = lastScrollAt + SCROLL_IDLE_MS - Date.now();
    if (remaining > 0) {
      // Scroll events arrived since arming — re-arm for the remainder
      // instead of paying a clearTimeout+setTimeout per scroll event.
      armIdleRelease(remaining);
      return;
    }
    idleTimer = null;
    activeLane?.removeAttribute(LANE_SCROLLING_ATTR);
    activeLane = null;
  }, delay);
}

/**
 * Called from each lane's (passive) scroll handler. Only one lane scrolls
 * at a time, so switching lanes releases the previous one immediately.
 */
export function noteLaneScrollActivity(lane: DampedLane): void {
  lastScrollAt = Date.now();
  if (activeLane !== lane) {
    activeLane?.removeAttribute(LANE_SCROLLING_ATTR);
    activeLane = lane;
    lane.setAttribute(LANE_SCROLLING_ATTR, '');
  }
  if (idleTimer === null) armIdleRelease(SCROLL_IDLE_MS);
}

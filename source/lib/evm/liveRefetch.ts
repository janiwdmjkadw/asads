/**
 * Debounced snapshot refetch while trade frames are arriving.
 *
 * The EVM stream vocabulary has no candle, holder or trader frames
 * (`lib/evm/stream.ts` — `trade` / `stage` / `reverted` are the whole
 * alphabet), so on an active token the tape and the header stats move live
 * while the chart, holders and top-traders panels stay frozen at their first
 * paint until a rare stage/reorg/resnapshot bump. The Solana page solves the
 * same gap with a 5s snapshot poll; this module is the EVM equivalent, gated
 * on activity: a trade frame for the watched token arms ONE timer, further
 * frames inside the window are absorbed, and the refetch fires once per
 * interval for as long as trades keep arriving. A quiet token costs nothing
 * beyond the one armed refetch already owed.
 *
 * Deliberately trailing-edge: the frame itself already moved the price and
 * the tape, so the snapshot re-read is catch-up work, not first paint — and
 * firing on the leading edge would double the read burst at the exact moment
 * a token gets busy. Stale-until-replaced is the caller's rule and is
 * untouched here: this module says WHEN to re-read and never clears what is
 * on screen.
 */

type TimerId = ReturnType<typeof setTimeout>;

export interface LiveRefetchScheduler {
  /** A trade frame for the watched token arrived. */
  noteTradeFrame(): void;
  /** Cancel any armed refetch. The scheduler is dead afterwards. */
  dispose(): void;
}

export function createLiveRefetchScheduler(options: {
  /** Minimum spacing between refetches. One timer, never a queue. */
  intervalMs: number;
  onRefetch: () => void;
  /** Injected by tests, so the schedule is asserted rather than slept for. */
  setTimeoutImpl?: (handler: () => void, ms: number) => TimerId;
  clearTimeoutImpl?: (id: TimerId) => void;
}): LiveRefetchScheduler {
  const setTimer =
    options.setTimeoutImpl ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const clearTimer = options.clearTimeoutImpl ?? ((id: TimerId) => clearTimeout(id));
  let pending: TimerId | null = null;
  let disposed = false;
  return {
    noteTradeFrame() {
      // One armed timer absorbs the whole burst. A disposed scheduler stays
      // dead — arming after dispose would fire a refetch into an unmounted
      // component.
      if (disposed || pending !== null) return;
      pending = setTimer(() => {
        pending = null;
        options.onRefetch();
      }, options.intervalMs);
    },
    dispose() {
      disposed = true;
      if (pending !== null) {
        clearTimer(pending);
        pending = null;
      }
    },
  };
}

/**
 * The build sequence's clock — beats 5 through 8 of spec/30-creature.md
 * §3.5, as a small cancellable state machine over one callback.
 *
 * TUNING REFERENCE: `tasks/creature/soren-builds.html` (the scrubbable
 * artifact the owner picked "the ninth" from). Every constant below is
 * recovered from its source and is a starting value to judge live, not a
 * re-lock.
 *
 * It is deliberately outside React and outside the DOM, for the same
 * reason `waitCycle.ts` is: the beats are arithmetic, and arithmetic is
 * worth testing without a renderer. What the component does with the
 * beats is CSS — opacity and transform, on the compositor, with the row
 * stagger expressed as `animation-delay` so the browser owns the frames
 * and this module owns only the phase boundaries.
 *
 * The beats, and what each is anchored to:
 *
 *   `gather`  the `tool_call` part landed and the shape is known. Nothing
 *             is drawn yet: the frame HOLDS for the gather's ≈360ms so
 *             Soren is whole a beat before it arrives (§3.5's
 *             "implementation note on beat 4" — the wire hands you one
 *             instant, so the only honest way to be early is to be late).
 *   `frame`   the frame fades in over 320ms and the rows precipitate into
 *             it top-down, staggered.
 *   `settled` every row has landed. Still ghosts: what arrives at beat 8
 *             is CONTENT, and the shape has not changed since beat 5.
 *   `collapsing` / `gone`  the failure form: the rows reverse-stagger back
 *             toward the frame's origin corner, then the surface leaves
 *             and the ordinary error part carries the news.
 */

/** ≈360ms, the locked pour-back bound (§3.4) — the frame waits it out. */
export const GATHER_HOLD_MS = 360;
/** The beat-5 entrance: a fade, no scale, no slide (D7). */
export const FRAME_FADE_MS = 320;
/** The first row starts this long after the frame starts. */
export const FIRST_ROW_DELAY_MS = 230;
/** Row to row. */
export const ROW_STAGGER_MS = 110;
/** One row's flight: translate + fade, from the frame's top-left region. */
export const ROW_FLIGHT_MS = 220;
/** The pellet flies the row's own path, in the row's own time. */
export const PELLET_FLIGHT_MS = 220;
/** One row's exit on the failure form. */
export const COLLAPSE_MS = 240;
/** Reverse stagger on the way out — the last row leaves first. */
export const COLLAPSE_STAGGER_MS = 40;

/**
 * RISK 1 IN §3.5, behind one boolean. The pellets are the only element of
 * the sequence carrying no information, and `beside` — the same sequence
 * without them — may be the better product. `false` drops the dots AND
 * the rows' flight: rows then fade in place, which is what `beside` is.
 * Nothing else in the sequence changes.
 */
export const PELLETS_ENABLED = true;

export type BuildBeat = 'gather' | 'frame' | 'settled' | 'collapsing' | 'gone';

/** When row `index` begins its flight, measured from the frame's start. */
export function rowDelayMs(index: number): number {
  return FIRST_ROW_DELAY_MS + Math.max(0, index) * ROW_STAGGER_MS;
}

/** When the last row has landed, measured from the frame's start. */
export function rowsSettleMs(rowCount: number): number {
  return rowCount <= 0 ? FIRST_ROW_DELAY_MS : rowDelayMs(rowCount - 1) + ROW_FLIGHT_MS;
}

/** When row `index` begins its exit, measured from the collapse's start. */
export function collapseDelayMs(index: number, rowCount: number): number {
  const fromEnd = Math.max(0, rowCount - 1 - Math.max(0, index));
  return fromEnd * COLLAPSE_STAGGER_MS;
}

/** How long the whole collapse takes for `rowCount` rows. */
export function collapseTotalMs(rowCount: number): number {
  return COLLAPSE_MS + COLLAPSE_STAGGER_MS * Math.max(0, rowCount - 1);
}

export interface BuildSequenceTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface BuildSequenceHost {
  readonly rowCount: number;
  /** Every beat boundary, in order; never called after `stop()`. */
  onBeat(beat: BuildBeat): void;
}

export interface BuildSequence {
  /** Act 2: the shape is known. Idempotent. */
  start(): void;
  /**
   * Act 3 arrived. Before the frame has faded in there is no time left to
   * spend, so the choreography is skipped outright (D7's interrupt); once
   * it is playing the remaining staggers are simply cancelled and every
   * row is at rest. Either way the answer is `settled` — the ghost, whole.
   */
  resolve(): void;
  /** The call failed: reverse-stagger out, then `gone`. */
  fail(): void;
  /** Cancel every pending timer. Safe to call twice. */
  stop(): void;
  readonly beat: BuildBeat;
}

const REAL_TIMERS: BuildSequenceTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

export function createBuildSequence(
  host: BuildSequenceHost,
  timers: BuildSequenceTimers = REAL_TIMERS,
): BuildSequence {
  let beat: BuildBeat = 'gather';
  let running = false;
  let timer: number | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  function enter(next: BuildBeat): void {
    clearTimer();
    beat = next;
    host.onBeat(next);
  }

  return {
    get beat(): BuildBeat {
      return beat;
    },
    start(): void {
      if (running) return;
      running = true;
      enter('gather');
      timer = timers.setTimeout(() => {
        if (!running) return;
        enter('frame');
        timer = timers.setTimeout(() => {
          if (!running) return;
          enter('settled');
        }, rowsSettleMs(host.rowCount));
      }, GATHER_HOLD_MS);
    },
    resolve(): void {
      if (!running || beat === 'settled' || beat === 'collapsing' || beat === 'gone') return;
      enter('settled');
    },
    fail(): void {
      if (!running || beat === 'gone') return;
      // Nothing has been drawn yet: there is nothing to collapse, so the
      // surface simply never appears and the error part carries the news.
      if (beat === 'gather') {
        enter('gone');
        return;
      }
      enter('collapsing');
      timer = timers.setTimeout(() => {
        if (!running) return;
        enter('gone');
      }, collapseTotalMs(host.rowCount));
    },
    stop(): void {
      running = false;
      clearTimer();
    },
  };
}

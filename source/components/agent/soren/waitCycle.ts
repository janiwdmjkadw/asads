/**
 * The wait cycle — the beat table Soren runs while a turn is in flight
 * (spec 30-creature §3.4, "The wait is a CYCLE").
 *
 *   pour → dots + a WORD → gather → peek
 *        → pour → dots + next WORD → gather → head-turn → (repeat)
 *
 * It is deliberately outside React and outside the creature: the engine
 * owns one form at a time and reports one-shot forms settling, but it has
 * no notion of a sequence. This module is that sequence, as a small
 * cancellable state machine over two callbacks, so it can be unit-tested
 * with fake timers and no DOM.
 *
 * Two rules shape the implementation:
 *
 * - **Looping forms never settle.** `dots` and `peek` hold until something
 *   else starts them off (`engine.ts:162`), so the cycle holds them on its
 *   own clock; only `pour` / `gather` / `head-turn` wait on `onFormSettled`.
 * - **A settle can arrive SYNCHRONOUSLY.** `ListenCreature.playForm` reports
 *   a refused form (reduced motion, `motion='off'`) back to the caller
 *   immediately, so advancing straight out of the settle callback would
 *   recurse without bound. Every advance is therefore queued.
 *
 * While a tool runs the cycle HOLDS on the dots (D7 — the truthful verb
 * owns the whisper, and Soren must not wander off to peek mid-verb); the
 * whimsy resumes between tools.
 */

import type { FormName } from '@/components/creature/ListenCreature';

/** The forms the wait cycle plays; the rest of the vocabulary is elsewhere. */
export type WaitForm = Extract<FormName, 'pour' | 'dots' | 'gather' | 'peek' | 'head-turn'>;

/** The beat table, in order. Both `pour` steps are followed by their dots. */
export const WAIT_STEPS: readonly WaitForm[] = [
  'pour',
  'dots',
  'gather',
  'peek',
  'pour',
  'dots',
  'gather',
  'head-turn',
];

/** How long the dots are held before the cycle moves on (§3.4: ≈1.2 s). */
export const DOTS_HOLD_MS = 1200;

/** One full peek cycle (`engine.ts` FORM_MS.peek) before moving on. */
export const PEEK_HOLD_MS = 1600;

export interface WaitCycleHost {
  /** Hand one form to the creature (`ListenCreatureHandle.playForm`). */
  playForm(form: WaitForm): void;
  /** Show the whimsy word for this think-beat; beats only grow. */
  setWordBeat(beat: number): void;
}

/** Injectable so the unit test can drive the cycle without real time. */
export interface WaitCycleTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface WaitCycle {
  /** Enter the table at its first beat. Idempotent while running. */
  start(): void;
  /** Cancel every pending timer and stop advancing. Safe to call twice. */
  stop(): void;
  /** The creature's `onFormSettled`, forwarded verbatim. */
  formSettled(form: FormName): void;
  /** True while a tool runs: the cycle holds on the dots. */
  setHolding(holding: boolean): void;
  /** The step being played, or `null` before `start` / after `stop`. */
  readonly form: WaitForm | null;
}

const REAL_TIMERS: WaitCycleTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * The next beat. Without a hold it is simply the next entry, wrapping.
 * With one it converges on the dots and stays there — from a pour, its own
 * dots; from anything else, back through the pour so the arrival is the
 * spec's morph rather than a pop.
 */
export function nextWaitIndex(index: number, holding: boolean): number {
  if (index < 0) return 0;
  if (!holding) return (index + 1) % WAIT_STEPS.length;
  const form = WAIT_STEPS[index];
  if (form === 'dots') return index;
  if (form === 'pour') return index + 1;
  return 0;
}

export function createWaitCycle(
  host: WaitCycleHost,
  timers: WaitCycleTimers = REAL_TIMERS,
): WaitCycle {
  let index = -1;
  let running = false;
  let holding = false;
  let beat = 0;
  let seenDots = false;
  let timer: number | null = null;
  /** The one-shot form whose `onFormSettled` the cycle is waiting on. */
  let awaiting: WaitForm | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  function enter(next: number): void {
    clearTimer();
    awaiting = null;
    const wasDots = index >= 0 && WAIT_STEPS[index] === 'dots';
    index = next;
    const form = WAIT_STEPS[index];
    // The word belongs to the think-beat: it rolls as the dots arrive, and
    // never while a tool's verb owns the whisper or on a dots re-arm.
    if (form === 'dots' && !holding && !wasDots) {
      if (seenDots) beat += 1;
      seenDots = true;
      host.setWordBeat(beat);
    }
    host.playForm(form);
    if (form === 'dots' || form === 'peek') {
      timer = timers.setTimeout(step, form === 'dots' ? DOTS_HOLD_MS : PEEK_HOLD_MS);
      return;
    }
    awaiting = form;
  }

  function step(): void {
    if (!running) return;
    enter(nextWaitIndex(index, holding));
  }

  /** Never advance inside a settle callback — see the header. */
  function stepSoon(): void {
    clearTimer();
    awaiting = null;
    timer = timers.setTimeout(step, 0);
  }

  return {
    get form(): WaitForm | null {
      return running && index >= 0 ? WAIT_STEPS[index] : null;
    },
    start(): void {
      if (running) return;
      running = true;
      beat = 0;
      seenDots = false;
      index = -1;
      enter(0);
    },
    stop(): void {
      running = false;
      clearTimer();
      awaiting = null;
      index = -1;
    },
    formSettled(form: FormName): void {
      if (!running || awaiting === null || form !== awaiting) return;
      stepSoon();
    },
    setHolding(next: boolean): void {
      if (next === holding) return;
      holding = next;
      if (!running || !next) return;
      // Entering a hold mid-peek or mid-head-turn: leave for the dots now
      // rather than at the end of a 1.4–1.6 s beat.
      const form = WAIT_STEPS[index];
      if (form !== 'dots' && form !== 'pour') stepSoon();
    },
  };
}

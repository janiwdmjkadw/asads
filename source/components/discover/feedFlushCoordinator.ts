/**
 * Shared frame-window flush across feed stream consumers (phase 0.4).
 *
 * Before this, each `FeedStreamConsumer` scheduled its own rAF-aligned
 * flush window, so the two SSE streams ('new-pairs', 'almost-graduated')
 * committed their store applies in SEPARATE animation-frame windows
 * ~86-97% of the time (measured by the phase-0 txWindows stat): the server
 * publishes both streams on the same ~250ms tick, but each sync apply ran
 * in its own macrotask and a frame boundary usually landed between them —
 * two notification waves, two React render passes, two chances to blow a
 * frame budget.
 *
 * Now dirty consumers ENROLL in a shared flush wave instead. The first
 * enrollment schedules the flush (production: one rAF + the 300ms
 * hidden-tab backstop, see deltaWire's defaultScheduleFlush); every
 * consumer that dirties before it fires joins the same wave; the flush
 * runs all dirty applies BACK-TO-BACK in one synchronous block, so React
 * batches the resulting store notifications into a single render pass.
 * Cost: an apply now always waits for the next animation frame (≤1 frame
 * added latency, within the product's freshness tolerance) instead of
 * running synchronously on the SSE event.
 *
 * Waves are keyed by the SCHEDULE FUNCTION IDENTITY: consumers sharing a
 * scheduler (production's module-level default) share one wave, while test
 * harnesses that inject their own `scheduleFlush` seam get a private wave
 * each — the same isolation the old per-consumer windows gave them.
 */

/** A consumer's flush entry point. Called once per wave; implementations
 *  must tolerate having nothing to do (dirty already drained by a resume
 *  flush, pause re-engaged, kill switch). */
export interface SharedFlushParticipant {
  flushShared(): void;
}

/** Schedule contract (same shape as FeedStreamConsumerOptions.scheduleFlush):
 *  run `flush` at the next flush opportunity, return a cancel. */
export type FlushSchedule = (flush: () => void) => () => void;

interface FlushWave {
  participants: Set<SharedFlushParticipant>;
  cancel: (() => void) | null;
}

const waves = new Map<FlushSchedule, FlushWave>();

/**
 * Join the pending flush wave for `schedule`, creating (and scheduling) it
 * if none is open. Enrolling the same participant twice is a no-op — the
 * per-consumer `dirty` flag carries the actual state.
 */
export function enrollSharedFlush(
  participant: SharedFlushParticipant,
  schedule: FlushSchedule,
): void {
  const open = waves.get(schedule);
  if (open) {
    open.participants.add(participant);
    return;
  }
  const wave: FlushWave = { participants: new Set([participant]), cancel: null };
  waves.set(schedule, wave);
  // NOTE: a synchronous scheduler (test seam) runs the flush before
  // `wave.cancel` is assigned — the wave is already drained and deleted by
  // then, so the late assignment is inert.
  wave.cancel = schedule(() => {
    if (waves.get(schedule) === wave) waves.delete(schedule);
    // One synchronous block: back-to-back applies land as one React batch.
    for (const enrolled of wave.participants) enrolled.flushShared();
  });
}

/** Leave the pending wave (consumer dispose). Cancels the scheduled flush
 *  when the last participant leaves so no callback fires post-unmount. */
export function unenrollSharedFlush(
  participant: SharedFlushParticipant,
  schedule: FlushSchedule,
): void {
  const wave = waves.get(schedule);
  if (!wave) return;
  wave.participants.delete(participant);
  if (wave.participants.size === 0) {
    waves.delete(schedule);
    wave.cancel?.();
  }
}

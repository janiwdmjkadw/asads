'use client';

/**
 * The build sequence's phase, published for whoever owns Soren.
 *
 * WHY A BUS, AND WHY IT IS CURRENTLY WRITE-ONLY. §3.5's beat 4 is "the
 * dots gather back into him, a beat BEFORE the frame lands" — a beat that
 * belongs to the CREATURE, and the creature on screen during the wait is
 * the gap row's (`SorenGapRow`), a sibling of the card lane mounted by
 * `AgentConversation`. The two ends are siblings, exactly like the
 * composer and the greeter, so the seam is the same one
 * (`composerFocus.ts`): a module-scoped channel about a singleton
 * surface, never persisted, dropped when its publisher unmounts.
 *
 * Until the gap row's owner subscribes, beat 4 is bought by TIMING
 * instead — the frame holds its fade for the gather's ≈360ms
 * (`GATHER_HOLD_MS`), which is what the beat order asks for and reads
 * identically on screen. The messages are published anyway so wiring the
 * real gather is a subscription in `SorenGapRow` and nothing else:
 *
 *   `shape-known`     the `tool_call` part landed — act 1 → act 2, gather
 *   `record-resolved` the ack landed — act 3, Soren may leave
 *   `failed`          the call failed — the rows collapse back toward him
 *   `null`            no build on screen; the sequence has left
 *
 * A subscriber should treat ANY transition away from `shape-known` as the
 * handover: in the conversation the ack re-routes the item and unmounts
 * the sequence in one commit, so the clear is what it will usually see.
 */

export type BuildPhaseMessage = 'shape-known' | 'record-resolved' | 'failed';

type Listener = (phase: BuildPhaseMessage | null) => void;

const listeners = new Set<Listener>();
let phase: BuildPhaseMessage | null = null;

/** Publish, or clear with `null` when the sequence leaves the screen. */
export function publishBuildPhase(next: BuildPhaseMessage | null): void {
  if (next === phase) return;
  phase = next;
  for (const listener of listeners) listener(next);
}

/** Subscribe, seeded with the current value; returns the unsubscribe. */
export function subscribeBuildPhase(listener: Listener): () => void {
  listeners.add(listener);
  listener(phase);
  return () => {
    listeners.delete(listener);
  };
}

/** The current phase, for a reader that is not a React subscriber. */
export function currentBuildPhase(): BuildPhaseMessage | null {
  return phase;
}

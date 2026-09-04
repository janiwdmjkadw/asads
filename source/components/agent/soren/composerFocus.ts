'use client';

/**
 * One bit — "is the composer focused?" — published from the composer and
 * read by the greeter, so Soren can lean toward the field while you type
 * (spec 30-creature §3.2, step 2).
 *
 * WHY A MODULE-SCOPED BUS rather than props. The two ends are SIBLINGS,
 * not relatives: `AgentMessageInput` and `AgentConversation` are separate
 * slots mounted by `AgentWindow` / `AgentPage`, so the only prop path
 * between them runs through those shells — and the shells are out of this
 * change's scope. The signal is a single boolean about a singleton surface
 * (there is exactly one composer on screen), it is never persisted, and it
 * is dropped when the composer unmounts, so the usual objections to global
 * mutable state do not apply. `AgentMessageInput` still takes an
 * `onFocusChange` prop as the ordinary seam for whoever owns the shell.
 */

import { useCallback, useEffect } from 'react';

type Listener = (focused: boolean) => void;

const listeners = new Set<Listener>();
let focused = false;

function publish(next: boolean): void {
  if (next === focused) return;
  focused = next;
  for (const listener of listeners) listener(next);
}

/** Subscribe, seeded with the current value; returns the unsubscribe. */
export function subscribeComposerFocus(listener: Listener): () => void {
  listeners.add(listener);
  listener(focused);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The composer's end of the bus: one setter for its focus handlers, and an
 * unmount reset so a composer that disappears while focused cannot leave
 * the greeter leaning forever.
 */
export function usePublishComposerFocus(
  onFocusChange?: (focused: boolean) => void,
): (focused: boolean) => void {
  useEffect(() => () => publish(false), []);
  return useCallback(
    (next: boolean) => {
      publish(next);
      onFocusChange?.(next);
    },
    [onFocusChange],
  );
}

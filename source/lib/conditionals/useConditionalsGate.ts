'use client';

/**
 * `useConditionalsEnabled`, plus the ONE thing a fail-closed gate cannot
 * tell you on its own: whether the answer is final.
 *
 * The flag reads `false` while LaunchDarkly is still initializing and
 * `false` when LD has evaluated it to false, and those are the same value
 * for two very different situations. A surface that only has to decide
 * whether to show a nav tab does not care. A surface deciding which of two
 * CARDS to mount does: reading the initializing `false` mounts v1, and the
 * evaluation that lands a moment later swaps it for v2 — a flash of the
 * old card in the reader's face, which is worse than a wait.
 *
 * `resolved` is true when LD has answered, or when it has had long enough:
 *
 * - NO PROVIDER (`ldClientId` empty — local rigs, CI) → resolved at once.
 *   There is nothing coming; the fail-closed `false` is already final.
 * - LD ANSWERED → `useLDClient()` is non-undefined. `LDProvider` sets its
 *   `ldClient` state only after `waitForInitialization` settles (resolved,
 *   rejected, or timed out), so the client's presence IS the ready signal
 *   and it cannot be missed the way an already-fired `ready` event can.
 * - LD DID NOT ANSWER → `holdMs` elapses and the caller stops waiting. The
 *   FAIL-CLOSED CONTRACT IS UNCHANGED by this: an unresolved gate still
 *   reports `enabled: false`, so an LD outage degrades to v1 rather than
 *   holding a skeleton forever. `resolved` only ever says whether waiting
 *   longer could still change the answer.
 */

import { useEffect, useState } from 'react';
import { useLDClient } from 'launchdarkly-react-client-sdk';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { useConditionalsEnabled } from './useConditionalsEnabled';

/**
 * How long a caller may hold for LD before treating its silence as an
 * answer. Long enough to cover a normal round trip on a cold page, short
 * enough that an outage costs a pause and not a blank thread.
 */
export const CONDITIONALS_GATE_HOLD_MS = 2_000;

export interface ConditionalsGate {
  /** The flag, fail-closed, exactly as `useConditionalsEnabled` reports it. */
  readonly enabled: boolean;
  /** Waiting longer cannot change `enabled`. */
  readonly resolved: boolean;
}

export function useConditionalsGate(holdMs: number = CONDITIONALS_GATE_HOLD_MS): ConditionalsGate {
  const enabled = useConditionalsEnabled();
  const ldClient = useLDClient();
  // No client id means no provider was mounted at all, so no evaluation
  // is on its way and there is nothing to wait for.
  const noProvider = getRuntimeConfig().ldClientId === '';
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (noProvider) return;
    const timer = setTimeout(() => setHeld(true), holdMs);
    return () => clearTimeout(timer);
  }, [noProvider, holdMs]);

  return { enabled, resolved: noProvider || ldClient !== undefined || held };
}

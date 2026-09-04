'use client';

/**
 * What the authorization is DOING, after the card has been approved.
 *
 * The decision response says whether the conditional armed, and that is
 * the last thing it will ever say. Legs fire, the plan completes, the
 * user cancels it from the Conditionals surface — none of which reaches
 * a card that only ever read the proposal. So an activated card keeps a
 * light poll on `GET /api/trade/conditionals/:id` (design-28 §7) and
 * stops the moment the plan is terminal: nothing here ticks forever
 * beside the live charts, and nothing here guesses between reads.
 *
 * The loop is a plain function rather than a hook body so it can be
 * driven — start, tick, stop — without a DOM.
 */

import { useEffect, useState } from 'react';
import { fetchConditional, fetchConditionalState } from '@/lib/conditionals';
import type {
  ConditionalDetail,
  ConditionalState,
  ConditionalStateResponse,
  TradeControlResult,
} from '@/lib/conditionals';
import type { ConditionalSummary } from './v2/ProposalCardV2';

export type ConditionalFetcher = (
  conditionalId: string,
) => Promise<TradeControlResult<ConditionalDetail>>;

export type ConditionalStateFetcher = (
  conditionalId: string,
) => Promise<TradeControlResult<ConditionalStateResponse>>;

/**
 * One quiet sentence of PROGRESS per leg (leg_no order), or null when the
 * state word already says everything. §7.3's hole, closed with the typed
 * surfaces only — the DAG detail's `unknown[]` rows (progress/timers/
 * pending_evaluations) are deliberately untouched until the client types
 * them:
 *
 *   fired 14:32     — a firing exists for the leg (latest claim's clock)
 *   2 of 3 in zone  — the exit leg's position targets, when evaluable
 *
 * Reads nothing but the response; total on malformed rows.
 */
export function legProgressFromState(state: ConditionalStateResponse): (string | null)[] {
  const legs = [...state.legs].sort((a, b) => a.leg_no - b.leg_no);
  const firedAtByLegId = new Map<string, string>();
  for (const firing of state.firings) {
    if (firing.state === 'guardrail_rejected' || firing.state === 'expired') continue;
    const prev = firedAtByLegId.get(firing.leg_id);
    if (prev === undefined || firing.claimed_at > prev) {
      firedAtByLegId.set(firing.leg_id, firing.claimed_at);
    }
  }
  const zoneByLegNo = new Map<number, { inZone: number; total: number }>();
  for (const position of state.positions ?? []) {
    const legNo = position.exit_leg.leg_no;
    if (legNo === null) continue;
    const tally = zoneByLegNo.get(legNo) ?? { inZone: 0, total: 0 };
    for (const target of position.exit_leg.targets) {
      if (target.in_zone === null) continue;
      tally.total += 1;
      if (target.in_zone) tally.inZone += 1;
    }
    zoneByLegNo.set(legNo, tally);
  }
  return legs.map((leg) => {
    const firedAt = firedAtByLegId.get(leg.id);
    if (firedAt !== undefined) {
      const at = new Date(firedAt);
      if (!Number.isNaN(at.getTime())) {
        const hh = String(at.getHours()).padStart(2, '0');
        const mm = String(at.getMinutes()).padStart(2, '0');
        return `fired ${hh}:${mm}`;
      }
      return 'fired';
    }
    const zone = zoneByLegNo.get(leg.leg_no);
    if (zone !== undefined && zone.total > 0) {
      return zone.total === 1
        ? zone.inZone === 1
          ? 'in zone'
          : 'out of zone'
        : `${zone.inZone} of ${zone.total} in zone`;
    }
    return null;
  });
}

/** One read of the live plan: its state, and the card's summary of it. */
export interface ConditionalLive {
  readonly state: ConditionalState;
  readonly summary: ConditionalSummary;
}

/** Nothing can fire again — the poll has no reason to take another turn. */
const TERMINAL_STATES: ReadonlySet<string> = new Set(['completed', 'cancelled', 'expired']);

export function isTerminalConditionalState(state: ConditionalState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * `pending` on the wire is a leg waiting its turn. The card's word for
 * that is "queued"; every other leg state passes through as the server
 * said it, so a state this build never heard of still renders.
 */
function legLabel(state: string): string {
  return state === 'pending' ? 'queued' : state;
}

export function conditionalLive(detail: ConditionalDetail): ConditionalLive {
  const legs = [...detail.legs].sort((a, b) => a.leg_no - b.leg_no);
  return {
    // `effective_state` is the SERVER's display state (a spent-but-armed
    // plan reads `completed`); it is optional on an older api.
    state: detail.effective_state ?? detail.state,
    summary: {
      legStates: legs.map((leg) => legLabel(leg.state)),
      expiresAtMs: detail.expires_at === null ? Number.NaN : Date.parse(detail.expires_at),
      conditionalId: detail.conditional_id,
    },
  };
}

/** Slow enough to be free, fast enough that a fired leg is not news. */
export const CONDITIONAL_POLL_MS = 10_000;

export interface ConditionalPollOptions {
  readonly fetcher: ConditionalFetcher;
  /**
   * Optional second read per tick: `/state`, for the per-leg progress
   * line. Its failure is invisible — the summary simply carries no
   * `legProgress` that tick. Kept separate from `fetcher` so the poll's
   * pinned lifecycle behaviour is untouched when absent.
   */
  readonly stateFetcher?: ConditionalStateFetcher;
  readonly intervalMs: number;
  readonly onLive: (live: ConditionalLive) => void;
}

/**
 * Read now, then every `intervalMs` until the plan is terminal or the
 * caller stops. A failed read is not terminal — the next tick tries
 * again — and a read that lands after the stop is dropped.
 */
export function startConditionalPoll(
  conditionalId: string,
  { fetcher, stateFetcher, intervalMs, onLive }: ConditionalPollOptions,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const read = (): void => {
    void fetcher(conditionalId).then(async (result) => {
      if (stopped || !result.ok) return;
      let live = conditionalLive(result.value);
      if (stateFetcher !== undefined && !isTerminalConditionalState(live.state)) {
        const stateRead = await stateFetcher(conditionalId).catch(() => null);
        if (stopped) return;
        if (stateRead !== null && stateRead.ok) {
          live = {
            ...live,
            summary: { ...live.summary, legProgress: legProgressFromState(stateRead.value) },
          };
        }
      }
      onLive(live);
      if (isTerminalConditionalState(live.state)) stop();
    });
  };

  read();
  timer = setInterval(read, intervalMs);
  return stop;
}

export interface UseConditionalLiveOptions {
  /** Injected in tests; production uses the shared typed port. */
  readonly fetcher?: ConditionalFetcher;
  readonly stateFetcher?: ConditionalStateFetcher;
  readonly intervalMs?: number;
}

/** The live read for a mounted card. `null` id → no poll, no state. */
export function useConditionalLive(
  conditionalId: string | null,
  options: UseConditionalLiveOptions = {},
): ConditionalLive | null {
  const {
    fetcher = fetchConditional,
    stateFetcher = fetchConditionalState,
    intervalMs = CONDITIONAL_POLL_MS,
  } = options;
  const [live, setLive] = useState<ConditionalLive | null>(null);

  useEffect(() => {
    setLive(null);
    if (conditionalId === null) return;
    return startConditionalPoll(conditionalId, { fetcher, stateFetcher, intervalMs, onLive: setLive });
  }, [conditionalId, fetcher, stateFetcher, intervalMs]);

  return live;
}

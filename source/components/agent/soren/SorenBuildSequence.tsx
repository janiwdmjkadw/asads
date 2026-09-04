'use client';

/**
 * THE BUILD SEQUENCE — act 2 on screen (spec/30-creature.md §3.5).
 *
 * The `propose_conditional` call is still running, and the client already
 * knows everything about the SHAPE of the card it will produce: the leg
 * count, each leg's verb, each leg's condition rows. This is the surface
 * that says so. It draws the TRUE ghost — `ProposalCardGhost` handed a
 * `GhostPlan` — and plays the beats over it:
 *
 *   the frame holds for the gather (≈360ms), so Soren is whole first
 *   → the frame fades in whole and true, 320ms, opacity only
 *   → the rows precipitate top-down into it, 110ms apart, each a 220ms
 *     flight from the frame's top-left region, a 3px ivory pellet riding
 *     the same path
 *   → they settle, and NOTHING MOVES again: the ack switches this lane to
 *     `ProposalPart`, which draws the same ghost from the same plan.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN. Soren himself. He is the gap row's
 * creature, one flex line below, and the gap row is out of this change's
 * scope — so beat 4's gather is bought as TIMING (the frame's hold) and
 * announced on `buildPhase.ts` for whoever wires the creature later.
 *
 * FAIL-CLOSED, twice over. The flag is read here rather than by the lane
 * above, so with `soren-chat-surface` off this renders `null` — exactly
 * what the conversation drew for a running tool before the redesign. With
 * motion reduced the beats are dropped entirely and the ghost stands
 * still, whole, from its first frame.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import type { GhostPlan } from '@/lib/agent/ghost-plan';
import type { ToolViewState } from '@/lib/agent/view';
import { ProposalCardGhost, ghostRowCount, type GhostRowMotion } from '../proposal/CardSkeleton';
import { publishBuildPhase } from './buildPhase';
import {
  PELLETS_ENABLED,
  collapseDelayMs,
  createBuildSequence,
  rowDelayMs,
  type BuildBeat,
  type BuildSequence,
} from './buildSequence';
import { useReducedMotion } from './reducedMotion';

export function SorenBuildSequence({
  plan,
  state,
}: {
  /** The shape the wire stated — the same object the ack lane will get. */
  readonly plan: GhostPlan;
  /** The tool item's state; `running` is the only one that plays beats. */
  readonly state: ToolViewState;
}) {
  const soren = useSorenChat();
  const reduced = useReducedMotion();
  const rowCount = useMemo(() => ghostRowCount(plan), [plan]);
  const [beat, setBeat] = useState<BuildBeat>('gather');
  const sequence = useRef<BuildSequence | null>(null);

  /*
   * MOUNTED WHILE RUNNING IS THE ONLY WAY IN. A thread reloaded after the
   * fact hands this lane an item that already failed; there is no build
   * left to play and nothing to collapse, so it renders nothing and the
   * error part below carries the news.
   */
  const [live] = useState(() => state === 'running');

  useEffect(() => {
    if (!live || !soren || reduced) return;
    const built = createBuildSequence({ rowCount, onBeat: setBeat });
    sequence.current = built;
    built.start();
    publishBuildPhase('shape-known');
    return () => {
      built.stop();
      sequence.current = null;
      publishBuildPhase(null);
    };
  }, [live, soren, reduced, rowCount]);

  useEffect(() => {
    if (state === 'running') return;
    if (state === 'soft_failed') {
      publishBuildPhase('failed');
      sequence.current?.fail();
      return;
    }
    /*
     * The ack landed. In the CONVERSATION this rarely runs: the moment the
     * result pairs, `hasExternalView` sends the item down the ack lane and
     * this unmounts, so the handover a subscriber actually sees is the
     * cleanup's clear. It runs for a lane that keeps this mounted, and it
     * costs nothing to be right there too. Either way the continuity is
     * the identical ghost — there is no crossfade to schedule.
     */
    publishBuildPhase('record-resolved');
    sequence.current?.resolve();
  }, [state]);

  if (!soren || !live) return null;

  /*
   * MOTION REDUCED: the sequence stands down COMPLETELY. Under reduced
   * motion the conversation keeps the classic activity group (the spec
   * names the shimmer as the reduced path), so a ghost here would draw
   * beside it — two surfaces for one call. The reader who asked for
   * stillness gets exactly the pre-redesign experience; the true ghost
   * still appears at ack time via ProposalPart's own loading state.
   */
  if (reduced) return null;

  // Beat 4 is still running: the frame is held so Soren can be whole
  // before it lands. Nothing is drawn — a frame drawn early would be the
  // build starting before he knew anything.
  if (beat === 'gather' || beat === 'gone') return null;

  const rowMotion = motionFor(beat, rowCount);

  return (
    <div
      className={beat === 'collapsing' ? 'ag-soren-build ag-soren-build--out' : 'ag-soren-build'}
      data-testid="agent-soren-build"
      data-beat={beat}
    >
      <ProposalCardGhost plan={plan} {...(rowMotion === null ? {} : { rowMotion })} />
    </div>
  );
}

/**
 * The row decoration for a beat — and `null` at rest, which is the whole
 * continuity mechanism: a settled sequence renders `<ProposalCardGhost
 * plan={plan} />` and nothing else, byte for byte what the ack lane
 * renders a frame later. Divergence here IS the jump.
 */
function motionFor(beat: BuildBeat, rowCount: number): ((rowIndex: number) => GhostRowMotion) | null {
  if (beat === 'frame') {
    return (rowIndex: number): GhostRowMotion => {
      const delay: CSSProperties = { animationDelay: `${rowDelayMs(rowIndex)}ms` };
      return {
        className: PELLETS_ENABLED ? 'ag-soren-brow ag-soren-brow--fly' : 'ag-soren-brow',
        style: delay,
        ...(PELLETS_ENABLED
          ? { pellet: <span className="ag-soren-pellet" style={delay} aria-hidden /> }
          : {}),
      };
    };
  }
  if (beat === 'collapsing') {
    return (rowIndex: number): GhostRowMotion => ({
      className: 'ag-soren-brow ag-soren-brow--out',
      style: { animationDelay: `${collapseDelayMs(rowIndex, rowCount)}ms` },
    });
  }
  return null;
}

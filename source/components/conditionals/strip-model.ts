/**
 * The FLOW STRIP's model — five nodes, four links, derived from what the
 * list route actually serves.
 *
 * The five names are the locked journey the detail view speaks too —
 * Proposed · Approved · Armed · Fired · Settled — so the ledger and the
 * detail page are one language. The strip's whole trick is a FIXED pitch:
 * the nodes stack into five straight columns down the panel, and depth is
 * legible before any row is read. That only works if every row derives
 * from the same table, which is this file.
 *
 * INPUT IS THE WIRE, NOTHING ELSE: the display state, the optional
 * `fired_count`, and the optional `pause` block. `fired_count` is absent
 * on an older api and ABSENT IS NOT ZERO — a row with no count derives its
 * strip from the state alone, and claims nothing past Armed.
 *
 * THE STRIP NEVER CARRIES A COUNT. It used to trail a `×n` tag; the owner
 * cut it on the shipped page, because a row already says how many times it
 * fired in its outcome words ("Fired 3 times") and the tag repeated that in
 * 9.5px mono beside five dots. The count still reaches the DETAIL's rail
 * (`Fired ×2` on the two steps a run passes through), which is why the
 * normalisation lives here as `runCount` rather than inside the model.
 *
 * THE RING IS A CURSOR, NOT A FRONTIER. A repeatable play that has fired
 * and settled once is ringed back at Armed with Fired and Settled filled
 * behind it; that is what an `every` authorization does, and no other
 * treatment says it in 116px.
 *
 * OPEN ENUM: a state this build has never seen gets the CONSERVATIVE
 * strip — Proposed and Approved (a conditional row cannot exist without
 * them) and nothing claimed after that. The page never guesses where an
 * unknown play is standing.
 */

import type { ConditionalPause, ConditionalState, ConditionalSummary } from '@/lib/conditionals';
import { displayState } from './views';

/**
 * `done` filled · `now` ringed live · `held` ringed amber · `ahead` hollow
 * · `stop` barred grey (you stopped it) · `fail` barred `--down` (it
 * stopped on you — the page's only red, and it is 8px wide).
 *
 * A `done` step is LIT in every view. It used to go white-grey once the
 * play had ended, which rendered the whole of History, Expired and Failed
 * as five grey dots and lost the one thing the strip is for: how far a
 * play actually got. Grey is what NEVER happened, and nothing else.
 */
export type FlowNodeState = 'done' | 'now' | 'held' | 'ahead' | 'stop' | 'fail';

/** A link is dashed exactly when the step it leads to is still ahead. */
export type FlowLinkState = 'solid' | 'ahead';

export type FlowNodes = readonly [
  FlowNodeState,
  FlowNodeState,
  FlowNodeState,
  FlowNodeState,
  FlowNodeState,
];

export interface FlowStripModel {
  readonly nodes: FlowNodes;
  readonly links: readonly [FlowLinkState, FlowLinkState, FlowLinkState, FlowLinkState];
  /** What a screen reader hears instead of five dots. */
  readonly label: string;
}

export const FLOW_STEP_NAMES: readonly string[] = [
  'Proposed',
  'Approved',
  'Armed',
  'Fired',
  'Settled',
];

const NODE_VERBS: Readonly<Record<FlowNodeState, string>> = {
  done: 'happened',
  now: 'is where it stands now',
  held: 'is where it is held',
  ahead: 'is still ahead',
  stop: 'is where you stopped it',
  fail: 'is where it failed',
};

export interface FlowStripInput {
  readonly state: ConditionalState;
  readonly firedCount?: number | undefined;
  /**
   * The pause block never colours a node — the strip says WHERE a play
   * stopped and can never say WHY, which is what the amber ring plus the
   * reason line on the row are for. It carries exactly one fact the strip
   * needs: a funds pause naming `leg_no` 2 or later is a pause on a leg
   * that only arms on the PREVIOUS leg's settlement, so leg 1 has fired
   * and settled — whether or not `fired_count` was served.
   */
  readonly pause?: ConditionalPause | null | undefined;
}

/** Nodes only — the table, kept flat so a test can walk every arm of it. */
function nodesFor(state: ConditionalState, fired: boolean): FlowNodes {
  switch (state) {
    // Not approved yet: Approved is the step being stood on.
    case 'draft':
    case 'pending_auth':
      return ['done', 'now', 'ahead', 'ahead', 'ahead'];
    // Live. `cancel_requested` is still live — until it ends, it can fire.
    case 'armed':
    case 'cancel_requested':
      return fired
        ? ['done', 'done', 'now', 'done', 'done']
        : ['done', 'done', 'now', 'ahead', 'ahead'];
    case 'paused':
    case 'budget_paused':
      return fired
        ? ['done', 'done', 'held', 'done', 'done']
        : ['done', 'done', 'held', 'ahead', 'ahead'];
    case 'completed':
      return ['done', 'done', 'done', 'done', 'done'];
    // Your hand: it stopped where it had got to.
    case 'cancelled':
      return fired
        ? ['done', 'done', 'done', 'done', 'stop']
        : ['done', 'done', 'stop', 'ahead', 'ahead'];
    case 'declined':
      return ['done', 'stop', 'ahead', 'ahead', 'ahead'];
    // The clock, not a decision. An expired play is not necessarily an
    // empty one — a full lit strip says runs landed before it ran out.
    case 'expired':
    case 'expiry_pending':
      return fired
        ? ['done', 'done', 'done', 'done', 'done']
        : ['done', 'done', 'done', 'ahead', 'ahead'];
    // Where it died is the first question a failure raises: it fired and
    // settlement came back wrong, or it never got a fill at all.
    case 'failed':
      return fired
        ? ['done', 'done', 'done', 'done', 'fail']
        : ['done', 'done', 'done', 'fail', 'ahead'];
    default:
      return ['done', 'done', 'ahead', 'ahead', 'ahead'];
  }
}

/**
 * A link is dashed exactly when the step it LEADS TO is still ahead. The
 * detail's journey rail draws its own links from this too, so the two
 * surfaces cannot disagree about what "not yet" looks like.
 */
export function linkTo(node: FlowNodeState): FlowLinkState {
  return node === 'ahead' ? 'ahead' : 'solid';
}

function linksFor(nodes: FlowNodes): FlowStripModel['links'] {
  return [linkTo(nodes[1]), linkTo(nodes[2]), linkTo(nodes[3]), linkTo(nodes[4])];
}

/**
 * WHERE THE PLAY IS STANDING, as one node — read back off the strip's own
 * table rather than re-derived. The rail lights its right-hand end with
 * this, so "watching" on the ledger and "watching" on the detail are the
 * same fact and not two readings of one state string.
 *
 * `done` when every node is done: a play that ran to the end is standing
 * on its last step, not on a step it has yet to reach.
 */
export function standingNodeOf(model: FlowStripModel): FlowNodeState {
  for (const node of model.nodes) {
    if (node !== 'done' && node !== 'ahead') return node;
  }
  return 'done';
}

function labelFor(nodes: FlowNodes): string {
  return nodes.map((node, index) => `${FLOW_STEP_NAMES[index]} ${NODE_VERBS[node]}`).join(', ');
}

/**
 * A RUN COUNT THE PAGE MAY SPEAK. Absent is not zero, and a zero, negative
 * or fractional count is not a count — an older api serves no count at all
 * and the page must not read that as "fired nothing".
 */
export function runCount(count: number | null | undefined): number | undefined {
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : undefined;
}

/**
 * The derivation. Pure, total, and the ONLY place a node state is decided.
 */
export function flowStrip(input: FlowStripInput): FlowStripModel {
  const runs = runCount(input.firedCount);
  const legNo = input.pause?.leg_no;
  const fired = runs !== undefined || (typeof legNo === 'number' && legNo >= 2);
  const nodes = nodesFor(input.state, fired);
  return { nodes, links: linksFor(nodes), label: labelFor(nodes) };
}

/** The strip for one list row, read off the wire shape directly. */
export function flowStripFor(row: ConditionalSummary): FlowStripModel {
  return flowStrip({
    state: displayState(row),
    firedCount: row.fired_count,
    pause: row.pause,
  });
}

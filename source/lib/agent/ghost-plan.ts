/**
 * THE SHAPE, READ OFF THE WIRE — act 2 of the build sequence
 * (spec/30-creature.md §3.5).
 *
 * The `propose_conditional` tool call lands typed and complete at
 * generation close, carrying a `TypedPlan`
 * (`packages/platform-core/src/ir/typed-plan.ts`) — the exact leg count,
 * each leg's verb, and each leg's condition tree. Until this module
 * nothing read it, and the ghost that stood in for the card hardcoded two
 * legs of two rows. A hardcoded ghost is a GUESS about the thing the
 * reader cares most about, so §3.5 makes reading the real shape a
 * requirement rather than a polish item.
 *
 * WHAT THIS IS NOT. It is not a parse of the plan — the card is still
 * built from the SERVER's canonical record and nothing here ever reaches
 * an authorization. It answers exactly three questions per leg, all of
 * them geometric: how many condition rows will be drawn, which verb word
 * will sit in the THEN tile, and whether a settlement cap precedes the
 * panel.
 *
 * PURE AND TOTAL. The argument is `unknown` — model-authored JSON that
 * reached the client through a schema this module deliberately does not
 * import (the terminal must not pull `platform-core`'s zod v4 graph for a
 * skeleton). Every field is probed defensively, every walk is bounded,
 * and anything it cannot read at all becomes `null`, which the ghost
 * reads as "fall back to the shipped two-leg shape".
 */

/** The tool whose arguments describe a card before the card exists. */
export const TOOL_PROPOSE_CONDITIONAL = 'propose_conditional';

export interface GhostLeg {
  /** Condition rows the card will draw for this leg — the chain lead included. */
  readonly rows: number;
  /** The word the THEN tile will carry, when the plan states one. */
  readonly verb: 'buy' | 'sell' | null;
  /** `arm_on` is set: a settlement cap precedes this leg's panel. */
  readonly chained: boolean;
}

export interface GhostPlan {
  readonly legs: ReadonlyArray<GhostLeg>;
}

/** `zTypedPlan.legs` is `.min(1).max(8)`; a longer array is clamped, not trusted. */
const MAX_LEGS = 8;
/** A leg always draws at least one row, and the ghost never draws a wall. */
const MIN_ROWS = 1;
const MAX_ROWS = 12;
/** `zTypedCondition.nodes` is `.max(64)`; the walk refuses to exceed it. */
const MAX_NODES = 64;
/** Deep enough for any authorable tree, shallow enough to be free. */
const MAX_DEPTH = 16;

/** The six operators of the IR's flat condition form; everything else is a leaf. */
const OPERATORS = new Set(['all', 'any', 'not_within', 'seq', 'count', 'hold']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * The children of one condition node, as the flat form states them: an
 * `all`/`any` array, a single `child`, or `seq`'s stage objects. Indices
 * are what the schema emits; a nested object is accepted too so a draft
 * shape cannot make the walk throw.
 */
function childrenOf(node: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const children = node['children'];
  if (Array.isArray(children)) out.push(...children);
  if (node['child'] !== undefined) out.push(node['child']);
  const stages = node['stages'];
  if (Array.isArray(stages)) {
    for (const stage of stages) {
      if (isRecord(stage) && stage['child'] !== undefined) out.push(stage['child']);
      else out.push(stage);
    }
  }
  return out;
}

/**
 * LEAVES ARE ROWS. The card draws one row per leaf of the condition tree
 * (`v2/condition-tree.ts` turns the same tree into rows and boxes), so the
 * leaf count is the ghost's row count — an approximation on purpose: the
 * ghost owes the reader the right NUMBER of rows at the right heights, not
 * the card's exact grouping, and a group's own title line rides inside the
 * box the rows already reserve.
 *
 * The walk is over the flat `{root:0, nodes}` form: operators name their
 * children by index. Each index is entered once (so a malformed cycle
 * terminates), the node budget is the schema's own, and the depth budget
 * is generous.
 */
function countLeaves(condition: unknown): number | null {
  if (!isRecord(condition)) return null;
  const nodes = condition['nodes'];
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_NODES) return null;

  const seen = new Set<number>();
  let leaves = 0;
  let visited = 0;

  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    let node: unknown = value;
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < 0 || value >= nodes.length) return;
      if (seen.has(value)) return;
      seen.add(value);
      node = nodes[value];
    }
    if (!isRecord(node)) return;
    visited += 1;
    const op = node['op'];
    if (typeof op !== 'string' || !OPERATORS.has(op)) {
      // Every non-operator node is a leaf — including `op:'leaf'` itself
      // and any leaf kind this build has never heard of.
      leaves += 1;
      return;
    }
    const children = childrenOf(node);
    // An operator with no readable children still occupies a row's worth
    // of card rather than nothing.
    if (children.length === 0) {
      leaves += 1;
      return;
    }
    for (const child of children) walk(child, depth + 1);
  };

  const root = condition['root'];
  walk(typeof root === 'number' ? root : 0, 0);
  return leaves === 0 ? null : leaves;
}

/** `action.side`, when the plan states one this build can draw. */
function verbOf(leg: Record<string, unknown>): 'buy' | 'sell' | null {
  const action = leg['action'];
  if (!isRecord(action)) return null;
  const side = action['side'];
  return side === 'buy' || side === 'sell' ? side : null;
}

/** `arm_on` non-null — the leg waits on an earlier leg's settlement. */
function chainedOf(leg: Record<string, unknown>): boolean {
  const armOn = leg['arm_on'];
  return armOn !== null && armOn !== undefined && isRecord(armOn);
}

/**
 * The plan's shape, or `null` when the payload is not one.
 *
 * `null` is the honest answer for a payload this build cannot read: the
 * ghost then falls back to the shipped two-leg shape, which is a lie but
 * a lie the redesign inherits rather than one it tells fresh.
 */
export function ghostPlanFromArgs(args: unknown): GhostPlan | null {
  if (!isRecord(args)) return null;
  const plan = args['plan'];
  if (!isRecord(plan)) return null;
  const legs = plan['legs'];
  if (!Array.isArray(legs) || legs.length === 0) return null;

  const out: GhostLeg[] = [];
  for (const raw of legs.slice(0, MAX_LEGS)) {
    // One unreadable leg makes the whole geometry a guess again, so the
    // plan is refused rather than drawn short.
    if (!isRecord(raw)) return null;
    const leaves = countLeaves(raw['condition']);
    const chained = chainedOf(raw);
    // A condition the walk could not read still draws its one row: the
    // panel exists either way, and its verb and rail are readable.
    const rows = clamp((leaves ?? MIN_ROWS) + (chained ? 1 : 0), MIN_ROWS, MAX_ROWS);
    out.push({ rows, verb: verbOf(raw), chained });
  }
  return out.length === 0 ? null : { legs: out };
}

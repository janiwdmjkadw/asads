/**
 * The condition renderer — typed IR nodes → a box/row tree.
 *
 * design-28 §1/§3, in one place:
 * - Operator jargon NEVER reaches the DOM. There is no ALL, no ANY, no SEQ
 *   token anywhere in the output: a group carries a plain-English
 *   sentence-case TITLE and its members are rows.
 * - A group with a single child never earns a box — its operator becomes
 *   the row's measure ("holds 30s", "3x within 5m", "10m clear").
 * - The two-child shortcut titles ("Both must hold" / "Either of these")
 *   are about ARITY: they apply whenever a group has exactly two
 *   children, whether those children are rows or boxes. "Both" and
 *   "either" are equally true of two groups as of two rows, and the long
 *   forms' counts ("2 conditions", "1 of 2 needed") were saying nothing a
 *   reader could not already see.
 * - Negation is words, never chrome: a negated leaf is a "No …" row with a
 *   trailing-window measure; a negated group is a box titled "And none of
 *   these in the last 10m".
 * - `seq` is "In this order" with numbered rows. The per-step window is the
 *   step row's MEASURE, not a sentence lead-in and never the title — the
 *   lab's final pass moved it there ("a measure wearing a sentence's
 *   clothes"); the title's quiet right slot keeps the summary
 *   ("within 10m per step"). A step that already measures itself (a
 *   negation's "10m clear") keeps its own and leaves the stage window to
 *   that summary.
 * - Depth cap: the WHEN tile is the root box, then at most TWO inner box
 *   levels. A group that would draw a fourth flattens to one composed row
 *   with inline lowercase conjunctions (arithmetic: level 3 leaves ~244px
 *   of row width, which is not a row).
 * - A single bare condition (L1) gets no box chrome at all.
 *
 * Seams are emitted as metadata, not drawn here: every sibling boundary
 * inside a group takes the same hairline whatever is on either side of it
 * (row↔row, box↔row, row↔box, box↔box), so CSS needs to know the KIND of
 * each sibling. `seq` is the exception — its steps chain with a vertical
 * connector, flagged by `chained`.
 *
 * An operator this build has never heard of degrades the whole group to a
 * marked fallback rather than dropping conditions the user is authorising.
 */

import type { IrCondition, IrNode, IrPredicate } from './ir-types';
import { buildRow, fmtDurationMs, negateRow, rowText, withMeasure } from './row-model';
import type { RowContext, RowModel, Segment } from './row-model';

// ───────────────────────── shape ─────────────────────────

export type SeamKind = 'row' | 'box';

export interface TreeRow {
  readonly type: 'row';
  readonly row: RowModel;
  /** `seq` steps only — the numbered gutter ahead of the chip. */
  readonly ordinal?: number;
  /** The kind of the preceding sibling; absent on the first child. */
  readonly seamBefore?: SeamKind;
  /** This build could not draw the operator that produced this node. */
  readonly degraded?: boolean;
}

export interface TreeBox {
  readonly type: 'box';
  readonly title: string;
  /** The quiet right slot: a count or a window, never a caveat. */
  readonly aside?: string;
  readonly children: readonly BoxOrRow[];
  /** Sibling kinds in order — the total-seam rule's input. */
  readonly childKinds: readonly SeamKind[];
  /** `seq`: steps chain with a vertical connector instead of seams. */
  readonly chained?: boolean;
  readonly seamBefore?: SeamKind;
  readonly degraded?: boolean;
}

export type BoxOrRow = TreeRow | TreeBox;

export interface ConditionTree {
  /** The root group's title, which the WHEN tile wears as its own header.
   *  Absent for a single bare condition — L1 gets no box chrome. */
  readonly title?: string;
  readonly aside?: string;
  readonly children: readonly BoxOrRow[];
  readonly childKinds: readonly SeamKind[];
  readonly chained?: boolean;
  readonly degraded?: boolean;
}

export interface TreeContext extends RowContext {
  readonly predicates: Readonly<Record<string, IrPredicate>>;
  /** Server-rendered per-node text, when the card has it — the fallback an
   *  unrecognised kind or operator renders instead of guessing. */
  readonly serverText?: Readonly<Record<number, string>>;
}

// ───────────────────────── title lexicon ─────────────────────────

interface Title {
  readonly title: string;
  readonly aside?: string;
}

function allTitle(count: number): Title {
  if (count === 2) return { title: 'Both must hold' };
  return { title: 'All of these must hold', aside: `${count} conditions` };
}

function anyTitle(count: number): Title {
  if (count === 2) return { title: 'Either of these' };
  return { title: 'Any one of these', aside: `1 of ${count} needed` };
}

function notWithinTitle(windowMs: number): Title {
  return { title: `And none of these in the last ${fmtDurationMs(windowMs)}` };
}

// ───────────────────────── helpers ─────────────────────────

function kindOf(node: BoxOrRow): SeamKind {
  return node.type;
}

/** Stamp each sibling with the kind of the one before it. */
function withSeams(children: readonly BoxOrRow[]): BoxOrRow[] {
  return children.map((child, index) =>
    index === 0 ? child : ({ ...child, seamBefore: kindOf(children[index - 1]) } as BoxOrRow),
  );
}

function unknownRow(text?: string): TreeRow {
  return {
    type: 'row',
    row: { group: 'unknown', segments: [], ...(text === undefined ? {} : { raw: text }) },
    degraded: true,
  };
}

function decapitalise(segments: readonly Segment[]): Segment[] {
  const [first, ...rest] = segments;
  if (first === undefined) return [];
  return [{ text: `${first.text.charAt(0).toLowerCase()}${first.text.slice(1)}`, role: first.role }, ...rest];
}

// ───────────────────────── the builder ─────────────────────────

/** The WHEN tile is box level 0; two inner levels are allowed below it. */
const MAX_BOX_DEPTH = 2;

class TreeBuilder {
  private readonly nodes: readonly IrNode[];
  private readonly ctx: TreeContext;

  constructor(condition: IrCondition, ctx: TreeContext) {
    this.nodes = condition.nodes;
    this.ctx = ctx;
  }

  node(index: number): IrNode | null {
    return index >= 0 && index < this.nodes.length ? this.nodes[index] : null;
  }

  text(index: number): string | undefined {
    return this.ctx.serverText?.[index];
  }

  /**
   * One node at the box depth it would be drawn at. `visited` closes the
   * only way a positional-index tree can hurt us: a self-referencing node.
   */
  build(index: number, depth: number, visited: ReadonlySet<number>): BoxOrRow {
    if (visited.has(index)) return unknownRow(this.text(index));
    const node = this.node(index);
    if (node === null) return unknownRow(this.text(index));
    const seen = new Set(visited).add(index);

    switch (node.op) {
      case 'leaf': {
        const predicate = this.ctx.predicates[node.predicate_hash];
        const serverText = this.text(index);
        const row = buildRow(
          {
            kind: predicate?.kind ?? node.kind,
            spec: predicate?.spec,
            ...(node.scope === undefined ? {} : { scope: node.scope }),
            ...(serverText === undefined ? {} : { text: serverText }),
          },
          this.ctx,
        );
        return { type: 'row', row };
      }

      case 'all':
      case 'any':
        return this.buildJunction(node, index, depth, seen);

      case 'not_within':
        return this.buildNegation(node, index, depth, seen);

      case 'seq':
        return this.buildSeq(node, index, depth, seen);

      case 'count':
        return this.collapseOperator(node.child, depth, seen, `${node.n}x within ${fmtDurationMs(node.window_ms)}`);

      case 'hold':
        return this.collapseOperator(node.child, depth, seen, `holds ${fmtDurationMs(node.duration_ms)}`);

      default:
        return unknownRow(this.text(index));
    }
  }

  private buildJunction(
    node: Extract<IrNode, { op: 'all' | 'any' }>,
    index: number,
    depth: number,
    seen: ReadonlySet<number>,
  ): BoxOrRow {
    // A group with a single child never earns a box.
    if (node.children.length === 1) return this.build(node.children[0], depth, seen);
    if (depth > MAX_BOX_DEPTH) return { type: 'row', row: this.flatten(index, seen) };

    const children = withSeams(node.children.map((child) => this.build(child, depth + 1, seen)));
    const { title, aside } = node.op === 'all' ? allTitle(children.length) : anyTitle(children.length);
    return {
      type: 'box',
      title,
      ...(aside === undefined ? {} : { aside }),
      children,
      childKinds: children.map(kindOf),
    };
  }

  private buildNegation(
    node: Extract<IrNode, { op: 'not_within' }>,
    index: number,
    depth: number,
    seen: ReadonlySet<number>,
  ): BoxOrRow {
    const measure = `${fmtDurationMs(node.window_ms)} clear`;
    const child = this.node(node.child);

    // A negated GROUP is a box whose title carries the negation, with the
    // group's own members inside it — the inner title would be redundant.
    if (child !== null && (child.op === 'all' || child.op === 'any') && child.children.length > 1) {
      if (depth > MAX_BOX_DEPTH) return { type: 'row', row: this.flatten(index, seen) };
      const grandchildren = withSeams(child.children.map((c) => this.build(c, depth + 1, new Set(seen).add(node.child))));
      return {
        type: 'box',
        ...notWithinTitle(node.window_ms),
        children: grandchildren,
        childKinds: grandchildren.map(kindOf),
      };
    }

    // Everything else collapses to a single "No …" row (single-child rule).
    const built = this.build(node.child, depth, seen);
    if (built.type === 'row') return { ...built, row: negateRow(built.row, measure) };
    return {
      type: 'box',
      ...notWithinTitle(node.window_ms),
      children: [built],
      childKinds: [kindOf(built)],
    };
  }

  private buildSeq(
    node: Extract<IrNode, { op: 'seq' }>,
    index: number,
    depth: number,
    seen: ReadonlySet<number>,
  ): BoxOrRow {
    if (node.stages.length === 1) return this.build(node.stages[0].child, depth, seen);
    if (depth > MAX_BOX_DEPTH) return { type: 'row', row: this.flatten(index, seen) };

    /*
     * THE STEP'S OWN MEASURE WINS. A step is a condition first and a
     * step second: "No dev sale · 10m clear" states the window the
     * negation is ABOUT, and overwriting it with the stage's "within
     * 10m" deletes a term of what the user is authorising in favour of
     * something the box already says. So a step that measures itself
     * keeps its measure, and the stage window is left to the quiet
     * right slot below.
     */
    const children: BoxOrRow[] = node.stages.map((stage, step) => {
      const built = this.build(stage.child, depth + 1, seen);
      const measure = stage.within_ms === undefined ? undefined : `within ${fmtDurationMs(stage.within_ms)}`;
      if (built.type === 'row') {
        const row =
          measure !== undefined && built.row.measure === undefined ? withMeasure(built.row, measure) : built.row;
        return { ...built, ordinal: step + 1, row };
      }
      return measure === undefined || built.aside !== undefined ? built : { ...built, aside: measure };
    });

    // The quiet right slot summarises the per-step window when every step
    // after the first shares one; the title never carries it.
    const windows = node.stages.slice(1).map((stage) => stage.within_ms);
    const uniform = windows.length > 0 && windows.every((w) => w !== undefined && w === windows[0]);
    const aside = uniform && windows[0] !== undefined ? `within ${fmtDurationMs(windows[0])} per step` : undefined;

    return {
      type: 'box',
      title: 'In this order',
      ...(aside === undefined ? {} : { aside }),
      children,
      childKinds: children.map(kindOf),
      chained: true,
    };
  }

  /** `count` / `hold`: the operator becomes a measure on the row, or the
   *  quiet right slot of the box when the counted child is complex. */
  private collapseOperator(childIndex: number, depth: number, seen: ReadonlySet<number>, measure: string): BoxOrRow {
    const built = this.build(childIndex, depth, seen);
    if (built.type === 'row') return { ...built, row: withMeasure(built.row, measure) };
    return { ...built, aside: measure };
  }

  /**
   * Level 3+ — one composed row, inline lowercase conjunctions. Everything
   * beneath is spoken in a single sentence rather than drawn, because a box
   * at this depth has no width left to be a box in.
   */
  private flatten(index: number, visited: ReadonlySet<number>): RowModel {
    const rows: RowModel[] = [];
    const conjunctions: string[] = [];
    // The caller has already marked this node as entered; the walk below
    // starts AT it, so it must not see itself as a cycle.
    const from = new Set(visited);
    from.delete(index);
    this.collect(index, from, rows, conjunctions);
    if (rows.length === 0) {
      const serverText = this.text(index);
      return { group: 'unknown', segments: [], ...(serverText === undefined ? {} : { raw: serverText }) };
    }

    const segments: Segment[] = [];
    rows.forEach((row, position) => {
      if (position > 0) {
        segments.push({ text: conjunctions[position - 1] ?? 'and', role: 'text' });
        segments.push(...decapitalise(row.segments));
      } else {
        segments.push(...row.segments);
      }
      if (row.measure !== undefined) segments.push({ text: row.measure.toLowerCase(), role: 'text' });
    });

    const first = rows[0];
    return {
      group: first.group,
      segments,
      ...(first.scopePlate === undefined ? {} : { scopePlate: first.scopePlate }),
    };
  }

  private collect(index: number, visited: ReadonlySet<number>, rows: RowModel[], conjunctions: string[]): void {
    if (visited.has(index) || rows.length >= 8) return;
    const node = this.node(index);
    if (node === null) return;
    const seen = new Set(visited).add(index);

    switch (node.op) {
      case 'all':
      case 'any': {
        const word = node.op === 'all' ? 'and' : 'or';
        node.children.forEach((child, position) => {
          if (position > 0) conjunctions.push(word);
          this.collect(child, seen, rows, conjunctions);
        });
        return;
      }
      case 'seq': {
        node.stages.forEach((stage, position) => {
          if (position > 0) conjunctions.push('then');
          this.collect(stage.child, seen, rows, conjunctions);
        });
        return;
      }
      case 'not_within': {
        const before = rows.length;
        this.collect(node.child, seen, rows, conjunctions);
        const added = rows[before];
        if (added !== undefined) rows[before] = negateRow(added, `${fmtDurationMs(node.window_ms)} clear`);
        return;
      }
      case 'count': {
        const before = rows.length;
        this.collect(node.child, seen, rows, conjunctions);
        const added = rows[before];
        if (added !== undefined) rows[before] = withMeasure(added, `${node.n}x within ${fmtDurationMs(node.window_ms)}`);
        return;
      }
      case 'hold': {
        const before = rows.length;
        this.collect(node.child, seen, rows, conjunctions);
        const added = rows[before];
        if (added !== undefined) rows[before] = withMeasure(added, `holds ${fmtDurationMs(node.duration_ms)}`);
        return;
      }
      default: {
        const built = this.build(index, MAX_BOX_DEPTH + 1, visited);
        if (built.type === 'row') rows.push(built.row);
        return;
      }
    }
  }
}

/**
 * A leg's condition → the WHEN tile's contents.
 *
 * The root group's title becomes the tile's own header; a bare single
 * condition returns no title and one row, which is the L1 rule.
 */
export function buildConditionTree(condition: IrCondition, ctx: TreeContext): ConditionTree {
  const builder = new TreeBuilder(condition, ctx);
  const root = builder.build(condition.root, 0, new Set());

  if (root.type === 'row') {
    return {
      children: [root],
      childKinds: [kindOf(root)],
      ...(root.degraded === true ? { degraded: true } : {}),
    };
  }

  return {
    title: root.title,
    ...(root.aside === undefined ? {} : { aside: root.aside }),
    children: root.children,
    childKinds: root.childKinds,
    ...(root.chained === true ? { chained: true } : {}),
    ...(root.degraded === true ? { degraded: true } : {}),
  };
}

/** Every row in a tree, in reading order — what the one-line law walks. */
export function treeRows(tree: ConditionTree): RowModel[] {
  const out: RowModel[] = [];
  const walk = (nodes: readonly BoxOrRow[]): void => {
    for (const node of nodes) {
      if (node.type === 'row') out.push(node.row);
      else walk(node.children);
    }
  };
  walk(tree.children);
  return out;
}

/** The tree's sentences, in reading order. Test and a11y affordance. */
export function treeSentences(tree: ConditionTree): string[] {
  return treeRows(tree).map(rowText);
}

/**
 * The WHEN slot — a `ConditionTree` drawn as titled boxes and one-line
 * rows (design-28 §3/§4, lab sections c5 + c7).
 *
 * Every rule the tree encoded as metadata is drawn here and nowhere else:
 * - The root group's title IS the tile's header; a bare condition (L1)
 *   gets no box chrome at all.
 * - THE TOTAL SEAM RULE: one hairline at every sibling boundary inside a
 *   box, whatever is on either side of it. A row carries the line on its
 *   own top border; a box cannot (it has a border of its own, and drawing
 *   there would double it) so it draws the seam IN THE GAP just outside
 *   its top edge. Both are the same 1px line on the same 6/6 air.
 * - `seq` is the exception: its steps chain with a vertical connector in
 *   the ordinal gutter instead of a seam. Vertical = chained, horizontal
 *   = adjacent.
 *
 * The slot draws in Tailwind utilities; what the assembled card shares with
 * it lives in `card-classes`. The SEAMS are the exception and stay in
 * `ProposalCardV2`'s residual sheet, because they are sibling-adjacency
 * rules and no utility on an element can state what its neighbour is.
 */

import type { ReactElement, ReactNode } from 'react';
import { KindChip } from './kind-glyphs';
import { SolMark, TokenDisc } from './marks';
import {
  BOX,
  BOX_B_BARE,
  BOX_B_ROOT,
  BOX_ROOT,
  BOX_ROOT_BARE,
  LF,
  RB,
  ROW,
  ROW_COLS,
  ROW_COLS_SEQ,
  TOK_PLATE,
  UNIT,
  UNIT_LEAD,
  UNIT_PCT,
  UNIT_SEP,
} from './card-classes';
import type { BoxOrRow, ConditionTree, TreeBox } from './condition-tree';
import type { RowModel, Segment } from './row-model';

// ───────────────────────── the sentence ─────────────────────────

/** Units that tuck tight against the figure they belong to (§4 symbols). */
const TIGHT_UNITS = new Set(['%', 'x', 'K', 'M', 'B']);

/** The SOL mark is DRAWN, not typed. `rowText` carries `◎` — that is what a
 *  reader hears and what the phrasing tests assert — but the sentence renders
 *  the lab's inline svg, on the baseline at .82em, one ink back. */
const SOL_MARK = '◎';

/** A comparator rides slightly ABOVE the baseline of the figure it frames —
 *  the .134em lift is what stops `≥` from reading as part of the numeral. */
const OP =
  'pcv2-op relative top-[-.134em] mr-[.26em] font-[family-name:var(--mono)] text-[.83em] font-medium text-[var(--ink-2)]';

/**
 * The other half of the grammar layer — `in`, `from`, `of`. It carries a
 * HOOK and nothing else: on the shipped skin a connective is a word in the
 * sentence and must render exactly as it always did, and the skin that
 * lights it owns its face, its measure and its violet. No lift here — the
 * `-.134em` above is the comparator glyph's own correction, not the
 * layer's.
 */
const CX = 'pcv2-cx';

/** Scope: a plate at symbol length. Silence is the default, so it appears
 *  only where silence would be a lie — and it tightens at the narrow step. */
const SCOPE =
  'pcv2-scope inline-block whitespace-nowrap rounded-[4px] bg-[rgba(255,255,255,.05)] py-[2px] align-[.05em] ' +
  'text-[10px] leading-[1.1] text-[var(--ink-1)] ' +
  'mx-[.24em] px-[4.5px] @[344.02px]:mx-[.34em] @[344.02px]:px-[5.5px]';

/** The row's right-hand measure — a window, a count, whatever qualifies it. */
const MEAS =
  'pcv2-meas ml-auto flex-none whitespace-nowrap text-[11.5px] leading-[1.3] tracking-[.004em] text-[var(--ink-2)]';

/** The step number, in the ordinal gutter or on a box header. */
const ORD =
  'pcv2-ord text-right font-[family-name:var(--mono)] text-[10.5px] leading-none tabular-nums text-[var(--ink-2)]';

const BOX_H = 'pcv2-box-h flex min-w-0 items-center gap-[9px] border-b border-[var(--hairline)]';
const BOX_T = 'pcv2-box-t min-w-0 truncate text-[12.5px] leading-[1.3] tracking-[.004em] text-[var(--ink-1)]';
const BOX_A =
  'pcv2-box-a ml-auto flex-none whitespace-nowrap font-[family-name:var(--mono)] text-[10px] leading-[1.3] tracking-[.02em] tabular-nums text-[var(--ink-2)]';

function unitClass(text: string): string {
  if (text === '%') return UNIT_PCT;
  if (text === '·') return UNIT_SEP;
  if (text === '$') return UNIT_LEAD;
  return UNIT;
}

function unitSpan(text: string, key: number): ReactElement {
  return (
    <span key={key} className={unitClass(text)}>
      {text}
    </span>
  );
}

/** Everything that is not a literal. Literals are grouped by `sentenceNodes`,
 *  which owns the `<b>`, so no `value` ever reaches here. */
function segmentNode(segment: Segment, key: number): ReactNode {
  switch (segment.role) {
    case 'unit':
      return segment.text === SOL_MARK ? <SolMark key={key} /> : unitSpan(segment.text, key);
    case 'operator':
      return (
        <span key={key} className={OP}>
          {segment.text}
        </span>
      );
    case 'connective':
      return (
        <span key={key} className={CX}>
          {segment.text}
        </span>
      );
    default:
      return <span key={key}>{segment.text}</span>;
  }
}

/**
 * Where the type already carries the gap, a word space would double it: a
 * comparator has `margin-right:.26em` and the SOL mark `margin-left:.32em`,
 * and the lab sets neither of them next to a space. `rowText` still writes
 * those spaces — a reader needs the air the type only implies.
 */
function glued(previous: Segment, current: Segment): boolean {
  return previous.role === 'operator' || (current.role === 'unit' && current.text === SOL_MARK);
}

/**
 * Segments → nodes, the way the lab draws a sentence.
 *
 * THE LITERAL IS ONE ELEMENT: a figure and the units that belong to it — a
 * leading `$`, a trailing `%`/`x`/`K`/`M`/`B` — render inside ONE `<b>`, as
 * `<b><span class="u">$</span>75<span class="u">K</span></b>`. The units are
 * stepped back FROM the figure, so they have to inherit the figure's mono
 * face and its .98em basis; left outside the `<b>` they inherit the
 * sentence's sans instead and land a pixel wide and a pixel low.
 */
export function sentenceNodes(segments: readonly Segment[]): ReactNode[] {
  const out: ReactNode[] = [];
  let previous: Segment | null = null;
  let index = 0;
  while (index < segments.length) {
    const head = segments[index];
    if (head === undefined) break;
    const lead = head.role === 'unit' && head.text === '$' && segments[index + 1]?.role === 'value' ? head : null;
    const valueIndex = lead === null ? index : index + 1;
    const candidate = segments[valueIndex];
    const literal = candidate !== undefined && candidate.role === 'value' ? candidate : null;

    let end = valueIndex + 1;
    if (literal !== null) {
      while (end < segments.length) {
        const unit = segments[end];
        if (unit === undefined || unit.role !== 'unit' || !TIGHT_UNITS.has(unit.text)) break;
        end += 1;
      }
    }

    if (previous !== null && !glued(previous, head)) out.push(<span key={`s${index}`}> </span>);

    if (literal === null) {
      out.push(segmentNode(head, index));
      previous = head;
      index += 1;
      continue;
    }

    out.push(
      <b key={index}>
        {lead === null ? null : unitSpan(lead.text, index)}
        {literal.text}
        {segments.slice(valueIndex + 1, end).map((unit, offset) => unitSpan(unit.text, valueIndex + 1 + offset))}
      </b>,
    );
    previous = segments[end - 1] ?? literal;
    index = end;
  }
  return out;
}

// ───────────────────────── the row ─────────────────────────

export interface RowProps {
  readonly row: RowModel;
  readonly ordinal?: number;
  /** The server's own sentence — what a row with nothing to say renders. */
  readonly fallbackText?: string | null;
}

export function ConditionRow({ row, ordinal, fallbackText }: RowProps): ReactElement {
  const raw = row.segments.length === 0 ? (row.raw ?? fallbackText ?? null) : null;
  return (
    <div
      className={`${ROW} ${ordinal === undefined ? ROW_COLS : ROW_COLS_SEQ}`}
      data-testid="pcv2-condition-row"
      data-degraded={row.segments.length === 0 ? 'true' : undefined}
    >
      {/* No pad: the row centres its own slots (`ROW`), so an ordinal
          hand-lowered onto the sentence's first line is now a defect. */}
      {ordinal === undefined ? null : <span className={ORD}>{ordinal}</span>}
      <KindChip group={row.group} />
      <div className={RB}>
        {/* `pcv2-lf--clamp` marks server text the platform does not control.
            It carries no styling of its own any more — the ellipsis is in
            `LF`, because one line is law at EVERY width — but the marker
            still says WHOSE sentence is being truncated. */}
        <div className={`${LF}${raw === null ? '' : ' pcv2-lf--clamp'}`}>
          {row.scopePlate === undefined ? null : (
            <span className={SCOPE}>
              {row.scopePlate.variant === 'leg' ? (
                <>
                  Leg <b>{row.scopePlate.label.replace(/^Leg\s*/, '')}</b>
                </>
              ) : (
                <>
                  {row.scopePlate.mint === undefined ? null : (
                    <TokenDisc mint={row.scopePlate.mint} className={TOK_PLATE} />
                  )}
                  {row.scopePlate.label}
                </>
              )}
            </span>
          )}
          {raw === null ? sentenceNodes(row.segments) : raw}
        </div>
        {row.measure === undefined ? null : <span className={MEAS}>{row.measure}</span>}
      </div>
    </div>
  );
}

// ───────────────────────── the box ─────────────────────────

interface BoxSkin {
  readonly box: string;
  readonly head: string;
  readonly body: string;
}

/**
 * The WHEN tile is box level 0; the tree caps inner boxes at two below it.
 * Each depth is a step down the ramp — a lighter ground, a tighter radius
 * and a tighter pad — so nesting reads as recession rather than as repeat.
 * The two greys are the lab's own depth ramp; the theme has no token for
 * them, which is why they are the only literals on the card.
 *
 * `pcv2-box-h--dN` / `pcv2-box-b--dN` are HOOKS, not styles: the depth a
 * bar and a body are at is a fact only this function knows, and the d4
 * ground repaints per depth. Adding them costs the shipped skin nothing —
 * no rule anywhere selects them without the root modifier.
 */
function boxSkin(depth: number): BoxSkin {
  if (depth === 0) {
    return {
      box: BOX_ROOT,
      head: `${BOX_H} pcv2-box-h--d0 bg-[rgba(255,255,255,.05)] pt-[7px] px-[12px] pb-[6px]`,
      body: `${BOX_B_ROOT} pcv2-box-b--d0`,
    };
  }
  if (depth === 1) {
    return {
      box: `${BOX} pcv2-box--d1 rounded-[9px] bg-[hsl(220,12%,19.5%)]`,
      head: `${BOX_H} pcv2-box-h--d1 pt-[6px] px-[11px] pb-[5px]`,
      body: 'pcv2-box-b pcv2-box-b--d1 pt-[2px] px-[11px] pb-[6px]',
    };
  }
  return {
    box: `${BOX} pcv2-box--d2 rounded-[8px] bg-[hsl(220,12%,23.5%)]`,
    head: `${BOX_H} pcv2-box-h--d2 pt-[5px] px-[9px] pb-[4px]`,
    body: 'pcv2-box-b pcv2-box-b--d2 pt-px px-[9px] pb-[5px]',
  };
}

/**
 * `chained` numbers EVERY step, not only the ones the tree could stamp:
 * the model can carry an ordinal on a row but not on a box, so a sequence
 * whose second step is a group would otherwise read 1, 3, 4. Which step a
 * thing is, is the whole point of "In this order".
 */
function children(nodes: readonly BoxOrRow[], depth: number, fallbackText?: string | null, chained = false): ReactNode[] {
  return nodes.map((node, index) =>
    node.type === 'row' ? (
      <ConditionRow key={index} row={node.row} {...(node.ordinal === undefined ? {} : { ordinal: node.ordinal })} fallbackText={fallbackText} />
    ) : (
      <ConditionBox
        key={index}
        box={node}
        depth={depth}
        fallbackText={fallbackText}
        {...(chained ? { ordinal: index + 1 } : {})}
      />
    ),
  );
}

interface BoxProps {
  readonly box: TreeBox;
  readonly depth: number;
  readonly fallbackText?: string | null;
  readonly ordinal?: number;
}

function ConditionBox({ box, depth, fallbackText, ordinal }: BoxProps): ReactElement {
  const skin = boxSkin(depth);
  return (
    <div className={skin.box} data-testid="pcv2-condition-box">
      <div className={skin.head}>
        {ordinal === undefined ? null : (
          <span className={`${ORD} pcv2-ord--box min-w-[9px] flex-none`}>{ordinal}</span>
        )}
        <span className={BOX_T}>{box.title}</span>
        {box.aside === undefined ? null : <span className={BOX_A}>{box.aside}</span>}
      </div>
      {/* `pcv2-box-b--chained` is a hook, not a style: the residual sheet
          swaps this body's horizontal seams for the vertical connector that
          says these rows are steps, not neighbours. */}
      <div className={`${skin.body}${box.chained === true ? ' pcv2-box-b--chained' : ''}`}>
        {children(box.children, depth + 1, fallbackText, box.chained === true)}
      </div>
    </div>
  );
}

// ───────────────────────── the slot ─────────────────────────

/**
 * The titleless WHEN tile — the THEN tile's twin (§1 L1 rule).
 *
 * Exported because the DEGRADED slot draws the same object: a leg whose IR
 * this build cannot read still owes the reader one tile, on the same
 * metrics, with the chain row in it.
 */
export function BareTile({
  lead,
  children: rows,
}: {
  readonly lead?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={BOX_ROOT_BARE} data-testid="pcv2-condition-box" data-bare="true">
      <div className={BOX_B_BARE}>
        {lead}
        {rows}
      </div>
    </div>
  );
}

export interface ConditionSlotProps {
  readonly tree: ConditionTree;
  /** The server's condition sentence, for rows this build cannot phrase. */
  readonly fallbackText?: string | null;
  /** Rows drawn ahead of the tree — the settlement chain row. */
  readonly lead?: ReactNode;
}

/**
 * THE WHEN SLOT ALWAYS HAS ITS TILE. A tree with a title wears it as the
 * tile's header; a titleless tree (the L1 rule — one condition needs no
 * "Both must hold" over it) drops the HEADER, never the ground.
 *
 * Shipped without it, a single-condition leg rendered its row loose on
 * the panel with no recessed ground under it, which is the one thing the
 * WHEN slot is for.
 *
 * TITLELESS, THE TILE IS THE THEN TILE (owner amendment 2026-08-11). It
 * takes the THEN tile's gutter and its one-line height (`BareTile`), and
 * the chain row comes INSIDE it rather than floating above it: with the
 * chain row loose on the panel a chained leg drew its WHEN slot as two
 * unequal pieces beside one solid THEN tile. One tile, the system's own
 * hairline seam between its rows — which the total seam rule already
 * draws for any two `.pcv2-row` siblings in a `.pcv2-box-b`, so it costs
 * no rule of its own.
 *
 * A TITLED tree keeps its box metrics, and its chain row stays bare above
 * it: the box already carries a header's worth of weight, and the chain
 * row is the plan's wiring, not a member of the group the title names —
 * there is no honest place for it inside that box.
 */
export function ConditionSlot({ tree, fallbackText, lead }: ConditionSlotProps): ReactElement {
  if (tree.title === undefined) {
    return (
      <BareTile lead={lead}>{children(tree.children, 1, fallbackText)}</BareTile>
    );
  }
  const box: TreeBox = {
    type: 'box',
    title: tree.title,
    ...(tree.aside === undefined ? {} : { aside: tree.aside }),
    children: tree.children,
    childKinds: tree.childKinds,
    ...(tree.chained === true ? { chained: true } : {}),
  };
  return (
    <>
      {lead === undefined ? null : <div className="pcv2-bare">{lead}</div>}
      <ConditionBox box={box} depth={0} fallbackText={fallbackText} />
    </>
  );
}

/**
 * A row the PLAN wires rather than the market: "After ⟨Leg 1⟩ fills".
 * It takes the neutral link mark, not a kind hue — this is not a
 * predicate, and colouring it as one would claim a feed it does not read.
 */
export function ChainRow({ legNo }: { readonly legNo: number }): ReactElement {
  return (
    <div className={`${ROW} ${ROW_COLS}`} data-testid="pcv2-chain-row">
      <KindChip group="link" />
      <div className={RB}>
        <div className={LF}>
          <span>After</span>
          <span className={SCOPE}>
            Leg <b>{legNo}</b>
          </span>
          <span>fills</span>
        </div>
      </div>
    </div>
  );
}

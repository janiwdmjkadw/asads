/**
 * `ProposalDetail` → the card's model. Pure, total, and the only place
 * the two halves of the record are joined.
 *
 * The server sends TWO renderings of one plan: `view` (its own prose,
 * always safe to print) and `canonical_payload` (the stored IR envelope,
 * which is what the user is actually authorising). The card draws the
 * IR, because only the IR carries the tree the row system needs — and it
 * falls back to the view's sentence whenever the IR cannot be read.
 *
 * Two binding rules, both load-bearing:
 * - A leg finds its payload BY `payload_hash` (`payloadForLeg`), never by
 *   position. A plan whose legs and payloads are ordered differently
 *   would otherwise authorise leg 1's condition against leg 2's money.
 *   Positional binding survives only as a flagged last resort, for an
 *   envelope whose payloads carry no hashes at all.
 * - Legs are joined view↔IR by `leg_no`, so a leg the decoder had to drop
 *   still renders — as its view sentence, in one neutral row.
 *
 * Nothing here throws and nothing here fetches. A card that cannot read
 * its envelope degrades to prose; it never blanks and it never crashes.
 */

import type { ProposalDetail } from '@/lib/conditionals';
import { buildConditionTree } from './condition-tree';
import type { ConditionTree } from './condition-tree';
import { decodeEnvelope, payloadForLeg } from './ir-types';
import type { DecodedEnvelope, IrLeg } from './ir-types';
import { fmtBpsPct, fmtCount, fmtDurationMs, fmtLamports, shortAddress } from './row-model';

// ───────────────────────── shape ─────────────────────────

export interface CardModelContext {
  /** IANA zone. Every instant on every row renders here. */
  readonly viewerTz: string;
  /** Frozen render instant — the tree's reference for relative phrasing. */
  readonly nowMs: number;
  /** Mint → ticker, when the card knows one. Falls back to 4…4. */
  readonly symbolOf?: (mint: string) => string | undefined;
  /**
   * The mint the CONTAINER knows — v1's parsed `model.mint`, resolved from
   * the same record by the same reader the token chip has always used.
   *
   * A leg whose own payload carries no `{kind:'mint'}` scope used to name
   * its token in prose ("the token"), which is neither a ticker nor an
   * address and clipped to "the tok…" in a narrow window. It is the LAST
   * resort behind leg 1's scope, and behind that the card names no token
   * at all rather than describe one.
   */
  readonly fallbackMint?: string | null;
}

export interface TokenRef {
  /** The resolved ticker when a source knows one, else the mint as 4…4. */
  readonly symbol: string;
  readonly mint: string;
}

/** What the amount IS — the renderer sets the unit's own typography. */
export type AmountUnit = 'sol' | 'pct' | 'tokens';

/**
 * THE ROW IS FOUR THINGS (design-28 §1 Actions, owner amendment
 * 2026-08-12): verb · amount · token image · token name. No connective
 * word joins them — "of" and "of position" were prose the lockup does not
 * need, and the row no longer states where a sell settles either. So the
 * action carries the four facts and nothing that only existed to link them.
 */
export interface LegAction {
  readonly side: 'buy' | 'sell';
  readonly figure: string;
  readonly unit: AmountUnit;
  /** `null` when no source names the token — the row then states none. */
  readonly token: TokenRef | null;
}

export interface CardLeg {
  readonly legNo: number;
  /** `arm_on: {settlement_of_leg}` — the leg this one waits on. */
  readonly chainedTo: number | null;
  /** The WHEN tile's contents. `null` ⇒ the IR could not be read. */
  readonly tree: ConditionTree | null;
  /** The server's own condition sentence — what a null tree renders. */
  readonly fallbackText: string | null;
  readonly action: LegAction | null;
  /** The server's own action sentence — what a null action renders. */
  readonly actionFallbackText: string | null;
  /** This leg's payload was bound POSITIONALLY. Flagged, never silent. */
  readonly payloadBoundByIndex: boolean;
}

export interface PreviewChip {
  readonly before?: string;
  readonly figure: string;
  /** A percent sign, tucked tight. */
  readonly pct?: boolean;
  /** The SOL mark, riding the numeral. */
  readonly sol?: boolean;
  readonly after?: string;
}

export interface DetailRow {
  readonly label: string;
  readonly value: string;
  /** The knob was authored, not inherited — drawn in `--hold`. */
  readonly custom?: boolean;
  /** What the platform did with it, printed beside the override. */
  readonly note?: string;
}

export interface DetailGroup {
  readonly title: string;
  readonly rows: readonly DetailRow[];
}

export interface CardModel {
  readonly legs: readonly CardLeg[];
  readonly previewChips: readonly PreviewChip[];
  readonly detailGroups: readonly DetailGroup[];
  /**
   * Compile warnings the envelope was stored with (`canonical_payload
   * .warnings[].detail`): a stop the curve floor makes unreachable, a
   * copy-trade cooldown floor. Rendered above the fold — a user approving
   * a plan must see them without opening Details.
   */
  readonly warnings: readonly string[];
  /** The envelope was unreadable — every leg is running on view prose. */
  readonly degraded: boolean;
}

// ───────────────────────── reading ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `{ settlement_of_leg: n }` → n. Anything else is not a chain. */
function chainOf(armOn: unknown): number | null {
  if (!isRecord(armOn)) return null;
  return num(armOn['settlement_of_leg']);
}

function mintOf(payload: Record<string, unknown> | null): string | null {
  if (payload === null) return null;
  const scope = payload['scope'];
  return isRecord(scope) && scope['kind'] === 'mint' ? str(scope['mint']) : null;
}

/**
 * A token is named by its TICKER when a source knows one and by its mint
 * as 4…4 when none does. It is never described in prose: "the token" is
 * not an identity, and the row that has to clip it clips a sentence.
 */
function tokenRef(mint: string | null, ctx: CardModelContext): TokenRef | null {
  if (mint === null) return null;
  return { symbol: ctx.symbolOf?.(mint) ?? shortAddress(mint), mint };
}

/**
 * A leg's payload. BY HASH first; positional binding is a flagged last
 * resort for an envelope whose payloads carry no hashes.
 */
function bindPayload(
  envelope: DecodedEnvelope,
  leg: IrLeg,
  index: number,
): { readonly payload: Record<string, unknown> | null; readonly byIndex: boolean } {
  const byHash = payloadForLeg(envelope, leg);
  if (byHash !== null) return { payload: byHash, byIndex: false };
  const hashed = envelope.payloads.some((payload) => str(payload['payload_hash']) !== null);
  if (hashed) return { payload: null, byIndex: false };
  const positional = envelope.payloads[index];
  return positional === undefined ? { payload: null, byIndex: false } : { payload: positional, byIndex: true };
}

/** The action row's own model. `null` when the payload cannot be read. */
function legAction(payload: Record<string, unknown> | null, ctx: CardModelContext): LegAction | null {
  if (payload === null) return null;
  const side = payload['side'];
  if (side !== 'buy' && side !== 'sell') return null;
  const sizing = payload['sizing'];
  if (!isRecord(sizing)) return null;
  const token = tokenRef(mintOf(payload) ?? ctx.fallbackMint ?? null, ctx);

  switch (sizing['kind']) {
    case 'sol_lamports_in': {
      const lamports = num(sizing['amount_lamports']);
      if (lamports === null) return null;
      return { side, figure: fmtLamports(lamports), unit: 'sol', token };
    }
    case 'pct_of_position_bps': {
      const bps = num(sizing['pct_bps']);
      if (bps === null) return null;
      return { side, figure: fmtBpsPct(bps), unit: 'pct', token };
    }
    case 'token_base_units': {
      const units = num(sizing['amount_base_units']);
      if (units === null) return null;
      return { side, figure: fmtCount(units), unit: 'tokens', token };
    }
    default:
      return null;
  }
}

/** Total by construction: a tree that comes back empty is not a tree. */
function safeTree(envelope: DecodedEnvelope, leg: IrLeg, cardMint: string | null, ctx: CardModelContext): ConditionTree | null {
  const positionBinding = num(leg.position_binding) ?? chainOf(leg.arm_on);
  try {
    const tree = buildConditionTree(leg.condition, {
      viewerTz: ctx.viewerTz,
      now: ctx.nowMs,
      predicates: envelope.predicates,
      ...(cardMint === null ? {} : { cardMint }),
      ...(positionBinding === null ? {} : { positionBindingLeg: positionBinding }),
      ...(ctx.symbolOf === undefined ? {} : { symbolOf: ctx.symbolOf }),
    });
    return tree.children.length === 0 ? null : tree;
  } catch {
    // The tree builder is total, but a future node shape must never be
    // the reason a user cannot read what they are authorising.
    return null;
  }
}

// ───────────────────────── details ─────────────────────────

const PARTIAL_FILL: Readonly<Record<string, string>> = {
  re_arm_remainder: 're-arm the remainder',
  market_chase: 'chase the market',
  abandon_alert: 'abandon and alert',
};

interface Clamp {
  readonly legNo: number;
  readonly field: string;
  readonly requested: number;
  readonly ceiling: number;
  readonly source: string;
}

/** `warnings[].detail`, tolerant: a malformed entry renders nothing. */
function readWarnings(envelope: DecodedEnvelope | null): readonly string[] {
  if (envelope === null || !Array.isArray(envelope.warnings)) return [];
  const out: string[] = [];
  for (const raw of envelope.warnings) {
    if (!isRecord(raw)) continue;
    const detail = str(raw['detail']);
    if (detail !== null && detail.length > 0) out.push(detail);
  }
  return out;
}

function readClamps(envelope: DecodedEnvelope | null): readonly Clamp[] {
  if (envelope === null || !Array.isArray(envelope.clamps)) return [];
  const out: Clamp[] = [];
  for (const raw of envelope.clamps) {
    if (!isRecord(raw)) continue;
    const legNo = num(raw['leg_no']);
    const field = str(raw['field']);
    const requested = num(raw['requested']);
    const ceiling = num(raw['ceiling']);
    if (legNo === null || field === null || requested === null || ceiling === null) continue;
    out.push({ legNo, field, requested, ceiling, source: str(raw['source']) ?? 'platform' });
  }
  return out;
}

type Format = (value: number) => string;

const asPct: Format = (bps) => `${fmtBpsPct(bps)}%`;
const asSol: Format = (lamports) => `${fmtLamports(lamports)} SOL`;
const asMs: Format = (ms) => fmtDurationMs(ms);

/** One knob, with its clamp provenance when the platform bit on it. */
function knobRow(
  payload: Record<string, unknown>,
  clamps: readonly Clamp[],
  legNo: number,
  field: string,
  label: string,
  format: Format,
): DetailRow | null {
  const value = num(payload[field]);
  if (value === null) return null;
  const clamp = clamps.find((entry) => entry.legNo === legNo && entry.field === field);
  if (clamp === undefined) return { label, value: format(value) };
  return {
    label,
    value: format(value),
    custom: true,
    note: `asked ${format(clamp.requested)} · ${clamp.source} limit ${format(clamp.ceiling)}`,
  };
}

function executionRows(
  payload: Record<string, unknown>,
  clamps: readonly Clamp[],
  legNo: number,
): readonly DetailRow[] {
  const rows: DetailRow[] = [];
  const push = (row: DetailRow | null): void => {
    if (row !== null) rows.push(row);
  };
  push(knobRow(payload, clamps, legNo, 'slippage_bps', 'Slippage', asPct));
  push(knobRow(payload, clamps, legNo, 'impact_ceiling_bps', 'Impact ceiling', asPct));
  push(knobRow(payload, clamps, legNo, 'max_input_lamports', 'Max input', asSol));
  push(knobRow(payload, clamps, legNo, 'fee_limit_lamports', 'Fee limit', asSol));
  push(knobRow(payload, clamps, legNo, 'tip_limit_lamports', 'Tip limit', asSol));
  push(knobRow(payload, clamps, legNo, 'quote_max_staleness_ms', 'Quote freshness', asMs));
  const sendMode = str(payload['send_mode']);
  if (sendMode !== null) rows.push({ label: 'Send mode', value: sendMode });
  const partial = str(payload['partial_fill_policy']);
  if (partial !== null) rows.push({ label: 'Partial fill', value: PARTIAL_FILL[partial] ?? partial });
  return rows;
}

// ───────────────────────── the builder ─────────────────────────

function legNumbers(irLegs: readonly IrLeg[], viewLegs: readonly { readonly leg_no: number }[]): number[] {
  const seen = new Set<number>();
  for (const leg of irLegs) seen.add(leg.leg_no);
  for (const leg of viewLegs) seen.add(leg.leg_no);
  return [...seen].sort((a, b) => a - b);
}

export function buildCardModel(detail: ProposalDetail, ctx: CardModelContext): CardModel {
  const envelope = decodeEnvelope(detail.canonical_payload);
  const view = detail.view;
  const viewLegs = view?.legs ?? [];
  const irLegs = envelope?.ir.legs ?? [];
  const clamps = readClamps(envelope);

  // The card's own token: leg 1's scope, else the mint the container
  // already resolved off the record. A leaf scoped to it stays silent.
  const firstPayload =
    envelope === null || irLegs[0] === undefined ? null : bindPayload(envelope, irLegs[0], 0).payload;
  const cardMint = mintOf(firstPayload) ?? ctx.fallbackMint ?? null;
  const legCtx: CardModelContext = { ...ctx, fallbackMint: cardMint };

  const legs: CardLeg[] = legNumbers(irLegs, viewLegs).map((legNo) => {
    const index = irLegs.findIndex((leg) => leg.leg_no === legNo);
    const irLeg = index === -1 ? undefined : irLegs[index];
    const viewLeg = viewLegs.find((leg) => leg.leg_no === legNo);
    const bound =
      envelope === null || irLeg === undefined ? { payload: null, byIndex: false } : bindPayload(envelope, irLeg, index);
    return {
      legNo,
      chainedTo: irLeg === undefined ? null : chainOf(irLeg.arm_on),
      tree: envelope === null || irLeg === undefined ? null : safeTree(envelope, irLeg, cardMint, legCtx),
      fallbackText: viewLeg?.condition_text ?? null,
      action: legAction(bound.payload, legCtx),
      actionFallbackText: viewLeg?.action_text ?? null,
      payloadBoundByIndex: bound.byIndex,
    };
  });

  // ── details, collapsed: the three facts that invite the click ──
  const previewChips: PreviewChip[] = [];
  if (firstPayload !== null) {
    const slippage = num(firstPayload['slippage_bps']);
    if (slippage !== null) previewChips.push({ figure: fmtBpsPct(slippage), pct: true, after: 'slip' });
    const maxInput = num(firstPayload['max_input_lamports']);
    if (maxInput !== null) previewChips.push({ before: 'max', figure: fmtLamports(maxInput), sol: true });
  }
  const lifetime = envelope?.ir.lifetime;
  if (isRecord(lifetime)) {
    const duration = num(lifetime['duration_ms']);
    if (duration !== null) previewChips.push({ figure: fmtDurationMs(duration) });
  }

  // ── details, expanded: Order / Execution / Risk / Protections ──
  const orderRows: DetailRow[] = [];
  if (view !== undefined) {
    orderRows.push({ label: 'Repeats', value: view.qualifier.text });
    orderRows.push({ label: 'Lifetime', value: view.lifetime_text });
  }
  for (const leg of legs) {
    if (leg.actionFallbackText !== null) orderRows.push({ label: `Leg ${leg.legNo}`, value: leg.actionFallbackText });
  }
  if (cardMint !== null) orderRows.push({ label: 'Mint', value: cardMint });

  const executionGroups: DetailGroup[] = [];
  irLegs.forEach((leg, index) => {
    if (envelope === null) return;
    const payload = bindPayload(envelope, leg, index).payload;
    if (payload === null) return;
    const rows = executionRows(payload, clamps, leg.leg_no);
    if (rows.length > 0) executionGroups.push({ title: `Execution · leg ${leg.leg_no}`, rows });
  });

  const riskRows: DetailRow[] = [];
  if (view !== undefined) {
    riskRows.push({ label: 'Worst case', value: view.worst_case.text });
    riskRows.push({ label: 'Total exposure', value: asSol(view.worst_case.total_exposure_lamports) });
  }

  const protectionRows: DetailRow[] = [];
  for (const leg of viewLegs) {
    for (const text of leg.guardrail_texts) protectionRows.push({ label: `Leg ${leg.leg_no}`, value: text });
  }
  for (const notice of view?.notices ?? []) protectionRows.push({ label: 'Notice', value: notice.text });

  const detailGroups: DetailGroup[] = [];
  if (orderRows.length > 0) detailGroups.push({ title: 'Order', rows: orderRows });
  detailGroups.push(...executionGroups);
  if (riskRows.length > 0) detailGroups.push({ title: 'Risk', rows: riskRows });
  if (protectionRows.length > 0) detailGroups.push({ title: 'Protections', rows: protectionRows });

  return { legs, previewChips, detailGroups, warnings: readWarnings(envelope), degraded: envelope === null };
}

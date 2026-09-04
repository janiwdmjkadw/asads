/**
 * The conditional envelope, as it actually arrives on the wire.
 *
 * `GET /api/trade/proposals/:id` returns `ProposalDetail.canonical_payload`
 * typed `unknown`. It is the stored IR envelope:
 *
 *   { v, ir: { ir_v, qualifier, lifetime, legs[] },
 *     payloads: ActionPayload[],
 *     predicates: Record<predicate_hash, { kind, spec }>,
 *     clamps? }
 *
 * `decodeEnvelope` is the only door. It is TOTAL — it never throws, and it
 * never REJECTS a plan a future server accepts. Open-enum discipline
 * (04-frontend invariant 3): an operator this build has never heard of, a
 * leaf kind it cannot phrase, a spec shape it does not recognise — each is
 * preserved as a tagged raw value so the renderer can degrade honestly
 * instead of the whole card going blank.
 *
 * Nothing here validates: the server already did (V1–V11, platform-core
 * `ir/validate.ts`). This layer only asks "is this shape readable", and
 * says so in the type.
 */

// ───────────────────────── leaf scope ─────────────────────────

/** §6.1 leaf scope. `unknown` carries a future scope kind through. */
export type LeafScope =
  | { readonly kind: 'mint'; readonly mint: string }
  | { readonly kind: 'pattern' }
  | { readonly kind: 'bound' }
  | { readonly kind: 'unknown'; readonly raw: unknown };

// ───────────────────────── condition nodes ─────────────────────────

/**
 * A condition node, indexed positionally inside `condition.nodes`.
 * Children are INDICES into that array, never inline nodes.
 */
export type IrNode =
  | { readonly op: 'leaf'; readonly kind: string; readonly predicate_hash: string; readonly scope?: LeafScope }
  | { readonly op: 'all'; readonly children: readonly number[] }
  | { readonly op: 'any'; readonly children: readonly number[] }
  | { readonly op: 'not_within'; readonly child: number; readonly window_ms: number }
  | { readonly op: 'seq'; readonly stages: readonly { readonly child: number; readonly within_ms?: number }[] }
  | { readonly op: 'count'; readonly child: number; readonly n: number; readonly window_ms: number }
  | { readonly op: 'hold'; readonly child: number; readonly duration_ms: number; readonly stale_policy?: string }
  /** An operator this build does not implement. Rendered as a degraded group. */
  | { readonly op: 'unknown'; readonly rawOp: string; readonly raw: unknown };

export interface IrCondition {
  readonly root: number;
  readonly nodes: readonly IrNode[];
}

// ───────────────────────── predicates ─────────────────────────

/** A `pred.v1` doc, keyed by its own content hash. `spec` stays `unknown`. */
export interface IrPredicate {
  readonly kind: string;
  readonly spec: unknown;
}

// ───────────────────────── legs & envelope ─────────────────────────

export interface IrLeg {
  readonly leg_no: number;
  readonly arm_on: unknown;
  readonly lifetime?: unknown;
  readonly condition: IrCondition;
  /** Legs bind to payloads by HASH, never by index. */
  readonly action: { readonly payload_hash: string };
  readonly position_binding?: unknown;
  readonly partial_fill_policy?: unknown;
}

export interface IrPlan {
  readonly ir_v?: number;
  readonly qualifier?: unknown;
  readonly lifetime?: unknown;
  readonly legs: readonly IrLeg[];
}

export interface DecodedEnvelope {
  readonly v?: number;
  readonly ir: IrPlan;
  readonly payloads: readonly Record<string, unknown>[];
  readonly predicates: Readonly<Record<string, IrPredicate>>;
  readonly clamps?: unknown;
  /** `canonical_payload.warnings` (compile warnings, F4): read tolerantly by the card model. */
  readonly warnings?: unknown;
}

// ───────────────────────── decoding ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asIndexList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = asFiniteNumber(entry);
    if (n === null || n < 0) return null;
    out.push(n);
  }
  return out;
}

function decodeScope(value: unknown): LeafScope | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { kind: 'unknown', raw: value };
  switch (value['kind']) {
    case 'mint': {
      const mint = asNonEmptyString(value['mint']);
      return mint === null ? { kind: 'unknown', raw: value } : { kind: 'mint', mint };
    }
    case 'pattern':
      return { kind: 'pattern' };
    case 'bound':
      return { kind: 'bound' };
    default:
      return { kind: 'unknown', raw: value };
  }
}

/**
 * One node. Anything unreadable becomes `op:'unknown'` rather than
 * failing the decode — a single future operator must not blank a card.
 */
function decodeNode(value: unknown): IrNode {
  if (!isRecord(value)) return { op: 'unknown', rawOp: '', raw: value };
  const op = typeof value['op'] === 'string' ? value['op'] : '';
  const degraded: IrNode = { op: 'unknown', rawOp: op, raw: value };

  switch (op) {
    case 'leaf': {
      const kind = asNonEmptyString(value['kind']);
      const hash = asNonEmptyString(value['predicate_hash']);
      if (kind === null || hash === null) return degraded;
      const scope = decodeScope(value['scope']);
      return scope === undefined
        ? { op: 'leaf', kind, predicate_hash: hash }
        : { op: 'leaf', kind, predicate_hash: hash, scope };
    }
    case 'all':
    case 'any': {
      const children = asIndexList(value['children']);
      if (children === null || children.length === 0) return degraded;
      return op === 'all' ? { op: 'all', children } : { op: 'any', children };
    }
    case 'not_within': {
      const child = asFiniteNumber(value['child']);
      const windowMs = asFiniteNumber(value['window_ms']);
      if (child === null || child < 0 || windowMs === null) return degraded;
      return { op: 'not_within', child, window_ms: windowMs };
    }
    case 'seq': {
      if (!Array.isArray(value['stages'])) return degraded;
      const stages: { child: number; within_ms?: number }[] = [];
      for (const raw of value['stages']) {
        if (!isRecord(raw)) return degraded;
        const child = asFiniteNumber(raw['child']);
        if (child === null || child < 0) return degraded;
        const within = asFiniteNumber(raw['within_ms']);
        stages.push(within === null ? { child } : { child, within_ms: within });
      }
      if (stages.length === 0) return degraded;
      return { op: 'seq', stages };
    }
    case 'count': {
      const child = asFiniteNumber(value['child']);
      const n = asFiniteNumber(value['n']);
      const windowMs = asFiniteNumber(value['window_ms']);
      if (child === null || child < 0 || n === null || windowMs === null) return degraded;
      return { op: 'count', child, n, window_ms: windowMs };
    }
    case 'hold': {
      const child = asFiniteNumber(value['child']);
      const durationMs = asFiniteNumber(value['duration_ms']);
      if (child === null || child < 0 || durationMs === null) return degraded;
      const stalePolicy = typeof value['stale_policy'] === 'string' ? value['stale_policy'] : undefined;
      return stalePolicy === undefined
        ? { op: 'hold', child, duration_ms: durationMs }
        : { op: 'hold', child, duration_ms: durationMs, stale_policy: stalePolicy };
    }
    default:
      return degraded;
  }
}

function decodeCondition(value: unknown): IrCondition | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value['nodes']) || value['nodes'].length === 0) return null;
  const root = asFiniteNumber(value['root']);
  return { root: root === null || root < 0 ? 0 : root, nodes: value['nodes'].map(decodeNode) };
}

function decodeLeg(value: unknown): IrLeg | null {
  if (!isRecord(value)) return null;
  const condition = decodeCondition(value['condition']);
  if (condition === null) return null;
  const action = isRecord(value['action']) ? value['action'] : undefined;
  const payloadHash = action === undefined ? null : asNonEmptyString(action['payload_hash']);
  if (payloadHash === null) return null;
  const legNo = asFiniteNumber(value['leg_no']);
  const leg: IrLeg = {
    leg_no: legNo === null ? 1 : legNo,
    arm_on: value['arm_on'],
    condition,
    action: { payload_hash: payloadHash },
  };
  return {
    ...leg,
    ...(value['lifetime'] === undefined ? {} : { lifetime: value['lifetime'] }),
    ...(value['position_binding'] === undefined ? {} : { position_binding: value['position_binding'] }),
    ...(value['partial_fill_policy'] === undefined ? {} : { partial_fill_policy: value['partial_fill_policy'] }),
  };
}

function decodePredicates(value: unknown): Record<string, IrPredicate> {
  const out: Record<string, IrPredicate> = {};
  if (!isRecord(value)) return out;
  for (const [hash, doc] of Object.entries(value)) {
    if (!isRecord(doc)) continue;
    const kind = asNonEmptyString(doc['kind']);
    if (kind === null) continue;
    out[hash] = { kind, spec: doc['spec'] };
  }
  return out;
}

/**
 * Read a `canonical_payload` into something renderable, or `null` when it
 * is not an envelope at all.
 *
 * `null` means "this is not the shape" — an empty object, a string, a
 * missing `ir`. It NEVER means "this build is too old": unknown operators,
 * kinds and scopes all survive the decode as tagged raw values, and a leg
 * whose condition is unreadable is dropped rather than failing the plan.
 */
export function decodeEnvelope(canonicalPayload: unknown): DecodedEnvelope | null {
  if (!isRecord(canonicalPayload)) return null;
  const ir = canonicalPayload['ir'];
  if (!isRecord(ir)) return null;
  if (!Array.isArray(ir['legs'])) return null;

  const legs: IrLeg[] = [];
  for (const raw of ir['legs']) {
    const leg = decodeLeg(raw);
    if (leg !== null) legs.push(leg);
  }

  const payloads: Record<string, unknown>[] = Array.isArray(canonicalPayload['payloads'])
    ? canonicalPayload['payloads'].filter(isRecord)
    : [];

  const irV = asFiniteNumber(ir['ir_v']);
  const v = asFiniteNumber(canonicalPayload['v']);

  return {
    ...(v === null ? {} : { v }),
    ir: {
      ...(irV === null ? {} : { ir_v: irV }),
      ...(ir['qualifier'] === undefined ? {} : { qualifier: ir['qualifier'] }),
      ...(ir['lifetime'] === undefined ? {} : { lifetime: ir['lifetime'] }),
      legs,
    },
    payloads,
    predicates: decodePredicates(canonicalPayload['predicates']),
    ...(canonicalPayload['clamps'] === undefined ? {} : { clamps: canonicalPayload['clamps'] }),
    ...(canonicalPayload['warnings'] === undefined ? {} : { warnings: canonicalPayload['warnings'] }),
  };
}

/** The payload a leg's `action.payload_hash` names, or `null`. Never by index. */
export function payloadForLeg(envelope: DecodedEnvelope, leg: IrLeg): Record<string, unknown> | null {
  for (const payload of envelope.payloads) {
    if (payload['payload_hash'] === leg.action.payload_hash) return payload;
  }
  return null;
}

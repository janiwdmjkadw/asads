/**
 * Agent chat stream reducer — pure, framework-free. Consumes the raw
 * `agent_run_events` SSE vocabulary (contracts.ts) and materializes the
 * in-flight assistant turn.
 *
 * The mapping MIRRORS the documented doctrine of the WP-9 adapter module
 * (`agent/src/contracts/adapter-ai-sdk.ts` — see its module doc): that
 * module maps run events to AI SDK `UIMessageChunk`s for a future
 * `useChat` integration; this scaffold consumes the same events directly
 * (F§ inv. 6 — the app-owned schemas are canonical, the SDK is an
 * adapter), branch for branch:
 *
 *   part_delta text|reasoning → open the part lazily, append the delta
 *   part_state text|reasoning → deltas are append-only PREFIXES of the
 *     closing part (§9.2): adopt the full text, close the part
 *   part_state tool_call/other/unknown → keyed by part_id so a re-emitted
 *     state RECONCILES (replaces) instead of duplicating
 *   part_reset / generation_superseded → drop that generation's parts;
 *     a superseded generation's text can never concatenate with its
 *     successor's (B§9.2)
 *   snapshot → replace materialized parts wholly, jump the cursor
 *   run_status → status + terminal transition (completed/failed/cancelled)
 *   error → renderable error part + carries code/retryable for the
 *     degraded-state UI (F§ inv. 5)
 *   generation_started/committed, usage, unknown kinds → cursor-only
 *     (tolerated verbatim; additive evolution never breaks the reducer)
 */

import {
  parseEvent,
  parsePart,
  PART_V,
  TERMINAL_RUN_STATUSES,
  type ParsedPart,
  type RunStatus,
} from './contracts';

export interface StreamPart {
  readonly partId: string;
  /** Generation the part belongs to (null for synthetic/error parts). */
  readonly generationId: string | null;
  readonly parsed: ParsedPart;
  /** True once a part_state closed it (text stops growing). */
  readonly closed: boolean;
}

export interface StreamState {
  /** part ids in first-seen order (render order). */
  readonly order: readonly string[];
  readonly parts: Readonly<Record<string, StreamPart>>;
  readonly runStatus: RunStatus | null;
  readonly statusReason: string | null;
  /** Highest applied event seq — the Last-Event-ID resume cursor. */
  readonly lastSeq: number;
  readonly terminal: boolean;
}

export function emptyStreamState(lastSeq = 0): StreamState {
  return {
    order: [],
    parts: {},
    runStatus: null,
    statusReason: null,
    lastSeq,
    terminal: false,
  };
}

function textParsed(kind: 'text' | 'reasoning', content: string): ParsedPart {
  return kind === 'text'
    ? { known: true, part: { v: PART_V, type: 'text', text: content } }
    : { known: true, part: { v: PART_V, type: 'reasoning', summary: content } };
}

function contentOf(parsed: ParsedPart): string {
  if (!parsed.known) return '';
  if (parsed.part.type === 'text') return parsed.part.text;
  if (parsed.part.type === 'reasoning') return parsed.part.summary;
  return '';
}

function withPart(state: StreamState, record: StreamPart): StreamState {
  const exists = state.parts[record.partId] !== undefined;
  return {
    ...state,
    order: exists ? state.order : [...state.order, record.partId],
    parts: { ...state.parts, [record.partId]: record },
  };
}

function bumpSeq(state: StreamState, seq: number | null): StreamState {
  if (seq === null || seq <= state.lastSeq) return state;
  return { ...state, lastSeq: seq };
}

/**
 * Apply one SSE event. Returns a NEW state when anything render-relevant
 * (or the cursor) changed; cursor-only kinds still advance `lastSeq` so a
 * resume never replays them.
 */
export function applyRunEvent(
  state: StreamState,
  seq: number | null,
  kind: string,
  payload: unknown,
): StreamState {
  const base = bumpSeq(state, seq);
  const parsed = parseEvent(kind, payload);
  if (!parsed.known) return base; // unknown kind or drifted payload: tolerate verbatim

  const event = parsed.event;
  switch (event.kind) {
    case 'part_delta': {
      const { part_id: partId, generation_id: generationId, ptype, delta } = event.payload;
      if (ptype !== 'text' && ptype !== 'reasoning') return base; // tool args et al: not rendered incrementally
      const existing = base.parts[partId];
      const content = existing !== undefined ? contentOf(existing.parsed) + delta : delta;
      return withPart(base, {
        partId,
        generationId,
        parsed: textParsed(ptype, content),
        closed: false,
      });
    }
    case 'part_state': {
      const { part_id: partId, generation_id: generationId, part } = event.payload;
      const parsedPart = parsePart(part);
      return withPart(base, {
        partId,
        generationId,
        parsed: parsedPart,
        closed: true,
      });
    }
    case 'part_reset':
    case 'generation_superseded': {
      const gen = event.payload.generation_id;
      const keep = base.order.filter((id) => base.parts[id]?.generationId !== gen);
      if (keep.length === base.order.length) return base;
      const parts: Record<string, StreamPart> = {};
      for (const id of keep) {
        const record = base.parts[id];
        if (record !== undefined) parts[id] = record;
      }
      return { ...base, order: keep, parts };
    }
    case 'snapshot': {
      const { through_seq: throughSeq, parts, status } = event.payload;
      const order: string[] = [];
      const records: Record<string, StreamPart> = {};
      parts.forEach((raw, i) => {
        const id = `snap-${i}`;
        order.push(id);
        records[id] = { partId: id, generationId: null, parsed: parsePart(raw), closed: true };
      });
      return {
        order,
        parts: records,
        runStatus: status,
        statusReason: null,
        lastSeq: Math.max(base.lastSeq, throughSeq),
        terminal: TERMINAL_RUN_STATUSES.includes(status),
      };
    }
    case 'run_status': {
      const { status, reason } = event.payload;
      return {
        ...base,
        runStatus: status,
        statusReason: reason ?? null,
        terminal: TERMINAL_RUN_STATUSES.includes(status),
      };
    }
    case 'error': {
      const { code, message, retryable } = event.payload;
      const partId = `err-${base.lastSeq}-${base.order.length}`;
      return withPart(base, {
        partId,
        generationId: null,
        parsed: {
          known: true,
          part: { v: PART_V, type: 'error', code, message, retryable },
        },
        closed: true,
      });
    }
    default:
      // generation_started | generation_committed | usage: cursor-only.
      return base;
  }
}

/** Render-ordered parts of the in-flight turn (empty text parts skipped). */
export function streamParts(state: StreamState): ParsedPart[] {
  const out: ParsedPart[] = [];
  for (const id of state.order) {
    const record = state.parts[id];
    if (record !== undefined) out.push(record.parsed);
  }
  return out;
}

/**
 * Materialize the streamed turn back into persisted-shape parts (used by
 * the mock server to build mid-stream snapshots, and by the store to
 * finalize a completed turn). Unknown parts re-emit their verbatim `raw`.
 */
export function partsAsPersisted(state: StreamState): unknown[] {
  return streamParts(state).map((p) => (p.known ? p.part : p.part.raw));
}

/* ------------------------------------------------------------------ *
 * Degraded states (F§ inv. 5 / 04 "Degraded states are explicit")
 * ------------------------------------------------------------------ */

/**
 * Error codes that flip the explicit degraded-state banner (kill switch,
 * budget, dead-letter, admission expiry, no promoted release) — never a
 * silent hang. Everything else renders as an in-thread error part with a
 * retry affordance when `retryable`.
 */
export const DEGRADED_BANNER_COPY: Readonly<Record<string, string>> = {
  agent_paused: 'The agent is paused by an operator kill switch.',
  budget_exhausted: 'Agent budget for this period is exhausted.',
  run_dead_lettered: 'The run was dead-lettered after repeated failures.',
  admission_expired: 'The request expired before a worker picked it up.',
  no_active_release: 'No agent release is currently active.',
};

export interface DegradedBanner {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export function degradedBannerFor(code: string, retryable: boolean): DegradedBanner | null {
  const copy = DEGRADED_BANNER_COPY[code];
  if (copy === undefined) return null;
  return { code, message: copy, retryable };
}

/**
 * Agent chat contracts — terminal-side MIRROR of the canonical schemas in
 * `agent/src/contracts/parts.ts` and `agent/src/contracts/run-events.ts`
 * (WP-9). Keep in sync with those files; they are the single source of
 * truth for shapes (plan §9.1–9.2; B§10, B§9.1).
 *
 * MIRRORED, NOT IMPORTED, deliberately:
 *   - terminal/ deploys standalone (deploy-terminal.sh ships this app
 *     only); a source import reaching into ../agent/src would couple the
 *     terminal build to agent/node_modules and the agent tsconfig (ESM
 *     node20, `.js` specifiers).
 *   - the WP-9 adapter module (`adapter-ai-sdk.ts`) additionally imports
 *     `ai` types; the scaffold decision (04 "Stack" deferred) is to add
 *     no AI SDK dependency yet — the reducer in `chat-core.ts` mirrors the
 *     adapter's DOCUMENTED event mapping instead (see its module doc).
 *
 * Doctrine mirrored verbatim: parts are a closed union, additive-only;
 * unknown `type`s / kinds route through never-throwing fallback lanes and
 * are preserved verbatim (F§ inv. 3). Part schemas are strict; event
 * payload schemas are loose.
 */

import { z } from 'zod';

/** Part schema version. Bumps only for breaking shape changes (never expected). */
export const PART_V = 1;

const v1 = z.literal(1);

export const textPartSchema = z.strictObject({
  v: v1,
  type: z.literal('text'),
  text: z.string(),
});

/** Reasoning summary — never raw chain-of-thought. */
export const reasoningPartSchema = z.strictObject({
  v: v1,
  type: z.literal('reasoning'),
  summary: z.string(),
});

export const toolCallPartSchema = z.strictObject({
  v: v1,
  type: z.literal('tool_call'),
  toolCallId: z.string(),
  name: z.string(),
  args: z.unknown(),
});

export const toolResultPartSchema = z.strictObject({
  v: v1,
  type: z.literal('tool_result'),
  toolCallId: z.string(),
  digest: z.string(),
  preview: z.unknown(),
});

/** Proposal reference — the id ONLY, never the payload (B§10). */
export const proposalRefPartSchema = z.strictObject({
  v: v1,
  type: z.literal('proposal_ref'),
  proposalId: z.string(),
});

export const statusPartSchema = z.strictObject({
  v: v1,
  type: z.literal('status'),
  code: z.string(),
  label: z.string(),
});

export const errorPartSchema = z.strictObject({
  v: v1,
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

/** Hard cap on bindings carried by one context part (bounded prompt cost). */
export const MAX_CONTEXT_MENTIONS = 8;
export const MAX_MENTION_LABEL_LEN = 32;
/** Widest id we bind: base58 pubkey ≤44, uuid 36. */
export const MAX_MENTION_ID_LEN = 64;

/** One `@`/`$` binding the composer resolved at pick time. */
export const contextMentionSchema = z.strictObject({
  kind: z.enum(['wallet', 'token', 'user']),
  label: z.string().min(1).max(MAX_MENTION_LABEL_LEN),
  id: z.string().min(1).max(MAX_MENTION_ID_LEN),
});

/** What the client knew when the turn was sent (page mint, selected wallet, mentions). */
export const contextPartSchema = z.strictObject({
  v: v1,
  type: z.literal('context'),
  mint: z.string().max(MAX_MENTION_ID_LEN).optional(),
  walletAccountId: z.string().max(MAX_MENTION_ID_LEN).optional(),
  mentions: z.array(contextMentionSchema).max(MAX_CONTEXT_MENTIONS),
  /** Mirror of the agent's field: this client draws result objects, so the
   *  model is told to give a reading rather than restate rows (soren). */
  uiResultObjects: z.boolean().optional(),
});

export const partSchema = z.discriminatedUnion('type', [
  textPartSchema,
  reasoningPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  proposalRefPartSchema,
  statusPartSchema,
  errorPartSchema,
  contextPartSchema,
]);

export type TextPart = z.infer<typeof textPartSchema>;
export type ReasoningPart = z.infer<typeof reasoningPartSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type ProposalRefPart = z.infer<typeof proposalRefPartSchema>;
export type StatusPart = z.infer<typeof statusPartSchema>;
export type ErrorPart = z.infer<typeof errorPartSchema>;
export type ContextMention = z.infer<typeof contextMentionSchema>;
export type ContextPart = z.infer<typeof contextPartSchema>;
export type Part = z.infer<typeof partSchema>;

/** Fallback lane for parts outside the v1 union. `raw` is the original value verbatim. */
export interface UnknownPart {
  readonly v: number;
  readonly type: string;
  readonly raw: unknown;
}

export type ParsedPart =
  | { readonly known: true; readonly part: Part }
  | { readonly known: false; readonly part: UnknownPart };

/** Parse one persisted part. NEVER throws (unknown → fallback, verbatim). */
export function parsePart(value: unknown): ParsedPart {
  const result = partSchema.safeParse(value);
  if (result.success) return { known: true, part: result.data };
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    known: false,
    part: {
      v: typeof record.v === 'number' ? record.v : PART_V,
      type: typeof record.type === 'string' ? record.type : 'unknown',
      raw: value,
    },
  };
}

/** Parse a persisted parts array. Never throws; non-array yields `[]`. */
export function parseParts(value: unknown): ParsedPart[] {
  return Array.isArray(value) ? value.map(parsePart) : [];
}

/* ------------------------------------------------------------------ *
 * Run events (mirror of agent/src/contracts/run-events.ts)
 * ------------------------------------------------------------------ */

export const runStatusSchema = z.enum([
  'auth_pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const runEventPayloadSchemas = {
  run_status: z.looseObject({
    status: runStatusSchema,
    reason: z.string().optional(),
    reconnect: z.boolean().optional(),
  }),
  generation_started: z.looseObject({
    generation_id: z.string(),
    attempt_id: z.string(),
    epoch: z.number().int(),
  }),
  part_delta: z.looseObject({
    generation_id: z.string(),
    part_id: z.string(),
    ptype: z.string(),
    delta: z.string(),
  }),
  part_state: z.looseObject({
    generation_id: z.string(),
    part_id: z.string(),
    part: z.unknown(),
  }),
  generation_superseded: z.looseObject({
    generation_id: z.string(),
  }),
  part_reset: z.looseObject({
    generation_id: z.string(),
  }),
  generation_committed: z.looseObject({
    generation_id: z.string(),
  }),
  snapshot: z.looseObject({
    through_seq: z.number().int(),
    parts: z.array(z.unknown()),
    status: runStatusSchema,
  }),
  usage: z.looseObject({
    attempt_id: z.string(),
    tokens: z.record(z.string(), z.number()),
    cost_micro_visible: z.number().optional(),
  }),
  error: z.looseObject({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
} as const;

export type RunEventKind = keyof typeof runEventPayloadSchemas;

export type RunEvent = {
  [K in RunEventKind]: { kind: K; payload: z.infer<(typeof runEventPayloadSchemas)[K]> };
}[RunEventKind];

export interface UnknownRunEvent {
  readonly kind: string;
  readonly payload: unknown;
}

export type ParsedRunEvent =
  | { readonly known: true; readonly event: RunEvent }
  | { readonly known: false; readonly event: UnknownRunEvent };

function isRunEventKind(kind: string): kind is RunEventKind {
  return Object.prototype.hasOwnProperty.call(runEventPayloadSchemas, kind);
}

/** Parse one stream event. NEVER throws (unknown kind/shape → fallback, verbatim). */
export function parseEvent(kind: string, payload: unknown): ParsedRunEvent {
  if (isRunEventKind(kind)) {
    const result = runEventPayloadSchemas[kind].safeParse(payload);
    if (result.success) {
      return { known: true, event: { kind, payload: result.data } as RunEvent };
    }
  }
  return { known: false, event: { kind, payload } };
}

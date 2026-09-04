/**
 * THE SERVER-TRUTH GATE (04-frontend.md invariant 1).
 *
 * A `proposal_ref` content part arrives inside model-authored chat
 * content. This module is the ONLY place that content is allowed to
 * touch, and the ONLY thing it is allowed to yield is an id.
 *
 * Everything downstream — `buildProposalCardModel`, `ProposalCard` —
 * is typed to accept `ProposalDetail` (the record `GET
 * /api/trade/proposals/:id` served) and nothing else, so a payload
 * embedded in chat has no type-legal route to the renderer. The
 * narrowing is structural, not a convention: this function returns a
 * freshly-built object with exactly one key and never spreads its
 * input.
 *
 * If a future edit makes this return the embedded payload, the
 * "hostile chat payload" test in `ref.test.ts` goes red.
 */

/** The only thing the UI is permitted to learn from chat content. */
export interface ProposalRef {
  readonly proposalId: string;
}

/** A uuid, matching the api's `zUuid` on `/api/trade/proposals/:id`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readId(record: Record<string, unknown>): string | null {
  // The part may name the id either way round; nothing else is read.
  for (const key of ['proposal_id', 'proposalId'] as const) {
    const value = record[key];
    if (typeof value === 'string' && UUID.test(value)) return value;
  }
  return null;
}

/**
 * Extract the proposal id from a `proposal_ref` content part.
 *
 * Returns `null` for anything unrecognisable — an unknown part type, a
 * malformed id, a part with no id at all. `null` means "render nothing
 * rich here", never "trust what the part said instead".
 */
export function proposalRefFromPart(part: unknown): ProposalRef | null {
  if (typeof part !== 'object' || part === null || Array.isArray(part)) return null;
  const record = part as Record<string, unknown>;

  // Accept the id at the top level or nested under `data` / `input` /
  // `output`, which is where the AI SDK puts tool-part bodies.
  const candidates: unknown[] = [
    record,
    record['data'],
    record['input'],
    record['output'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const id = readId(candidate as Record<string, unknown>);
    // A NEW object with exactly one key. Never `{...candidate}`.
    if (id !== null) return { proposalId: id };
  }
  return null;
}

/**
 * The status the `act` tool's ack carries when a proposal was created
 * (`agent/src/registry/registry.ts`, persisted inside a `tool_result`
 * part's preview). This — not a `proposal_ref` part — is what the
 * production pipeline actually writes.
 */
export const PROPOSAL_CREATED_STATUS = 'proposal_created';

/**
 * Extract the proposal id from a SUCCESSFUL tool result's preview.
 *
 * Same gate, same one-key answer: the preview also carries an
 * `operationId`, an `approvalTarget` and a `clamped` flag, and none of
 * them are read. Returns `null` unless the preview announces itself as
 * a created proposal AND names a usable (uuid) id — anything else stays
 * on the generic tool-result lane rather than rendering a card the api
 * could not resolve.
 */
export function proposalRefFromToolResult(preview: unknown): ProposalRef | null {
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) return null;
  const record = preview as Record<string, unknown>;
  if (record['status'] !== PROPOSAL_CREATED_STATUS) return null;
  return proposalRefFromPart(record);
}

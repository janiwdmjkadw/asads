/**
 * Revision lineage for a conditional.
 *
 * The platform's modification model (02-execution-platform.md §2.1, §6):
 * a plan edit MINTS A NEW IMMUTABLE PROPOSAL ROW (`kind =
 * conditional_revision`, chained by `revises_proposal_id`), the edit CAS
 * repoints `conditionals.proposal_id` at that revision and bumps
 * `conditionals.version` in the same transaction. Every revision stays
 * on file, and the journal chains them, so "what exactly did I sign, and
 * when" is answerable per version.
 *
 * Two consequences this surface must render, not hide:
 *  - the CURRENT authorized revision is `version` + `proposal_id`; older
 *    versions are history, and each `edited` journal entry is one hop;
 *  - **fired legs are immutable history** — a leg with a claimed firing
 *    cannot be modified (the server answers 409 `leg_immutable` with the
 *    exact leg numbers), so the UI must not offer to edit it.
 *
 * Nothing here mutates or proposes: a modification is a NEW proposal that
 * must be authorized on the server's own rendering of it. This module
 * produces what the user needs to see before asking for one.
 */

import type {
  ConditionalDetail,
  ConditionalEvent,
  ConditionalFiring,
  ConditionalState,
} from '@/lib/conditionals';
import { stateWord } from './views';

export interface LineageEdit {
  /** `conditional_events.seq` — the journal's own ordering. */
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
}

export interface ConditionalLineage {
  readonly conditionalId: string;
  /** The CURRENT authorized revision number (`conditionals.version`). */
  readonly version: number;
  /** The proposal row that authorizes the current revision. */
  readonly proposalId: string;
  /** How many authorized revisions precede the current one. */
  readonly priorRevisions: number;
  /** One entry per `edited` journal row, in journal order. */
  readonly edits: readonly LineageEdit[];
  /** Leg numbers frozen by a claimed firing — the server refuses edits here. */
  readonly immutableLegs: readonly number[];
  /** Leg numbers still open to a revision. */
  readonly modifiableLegs: readonly number[];
  /** True when the conditional's state can accept a revision at all. */
  readonly modifiable: boolean;
  /** Why not, when `modifiable` is false. Always renderable. */
  readonly modifiableReason: string;
}

/** Leg states that are finished history rather than live plan. */
const FROZEN_LEG_STATES: readonly string[] = ['fired', 'completed', 'expired', 'cancelled'];

/**
 * A revision can only be authorized while the conditional is still live.
 * Mirrors the server's `conditional_not_editable` refusal rather than
 * re-deriving a rule of its own.
 */
function editableState(state: ConditionalState): boolean {
  return state === 'armed' || state === 'paused' || state === 'budget_paused';
}

export function conditionalLineage(
  detail: ConditionalDetail,
  events: readonly ConditionalEvent[] = [],
  firings: readonly ConditionalFiring[] = detail.firings,
): ConditionalLineage {
  const edits = events
    // The api journals a revision as 'revision_applied' (plugin.ts runRevision);
    // 'edited' is the older spelling kept for existing journals.
    .filter((event) => event.transition === 'edited' || event.transition === 'revision_applied')
    .map((event) => ({ seq: event.seq, at: event.created_at, actor: event.actor }));

  const claimedLegIds = new Set(firings.map((firing) => firing.leg_id));
  const immutableLegs: number[] = [];
  const modifiableLegs: number[] = [];
  for (const leg of detail.legs) {
    if (claimedLegIds.has(leg.id) || FROZEN_LEG_STATES.includes(leg.state)) {
      immutableLegs.push(leg.leg_no);
    } else {
      modifiableLegs.push(leg.leg_no);
    }
  }

  const stateOk = editableState(detail.state);
  const modifiable = stateOk && modifiableLegs.length > 0;
  // The reason is USER-FACING (it is what the disabled Edit control says in
  // words), so it never prints a raw server state — design-29's rule holds
  // in a refusal exactly as it does in a chip.
  const modifiableReason = stateOk
    ? modifiableLegs.length > 0
      ? ''
      : 'every leg has already fired, a run that has happened cannot be changed'
    : `a plan that is “${stateWord(detail.state).toLowerCase()}” no longer takes changes`;

  return {
    conditionalId: detail.conditional_id,
    version: detail.version,
    proposalId: detail.proposal_id,
    // `version` counts authorized revisions from 1; anything above 1 has
    // predecessors on file even when the journal was truncated.
    priorRevisions: Math.max(0, detail.version - 1),
    edits,
    immutableLegs,
    modifiableLegs,
    modifiable,
    modifiableReason,
  };
}

/** One line describing the lineage, for the detail header. */
export function lineageSummary(lineage: ConditionalLineage): string {
  if (lineage.priorRevisions === 0) {
    return `Revision ${lineage.version}, the original authorization`;
  }
  return `Revision ${lineage.version}, supersedes ${lineage.priorRevisions} earlier ${
    lineage.priorRevisions === 1 ? 'revision' : 'revisions'
  }`;
}

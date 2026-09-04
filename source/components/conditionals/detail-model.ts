/**
 * What the detail says ABOUT the play, around the tabs: the status line
 * above them, and the versions line under the card in Workflow.
 *
 * THE CARD IS NOT THIS MODULE'S BUSINESS. What the plan AUTHORIZES is
 * drawn by `ProposalCardV2` from the server's own envelope, and nothing
 * here re-states it. WHAT IT HAS DONE is not this module's business
 * either — `event-feed.ts` owns that, and owns the wire-reading rules the
 * "what has fired" box used to carry here.
 *
 * FIGURES ARE NEVER INVENTED, WHICH IS MOSTLY A RULE ABOUT SUBTRACTION.
 * `solDeltaOf` reads `reconciliation_result.sol_delta_lamports` — typed
 * `unknown` on the wire — tolerantly or not at all. The authorized amount
 * on the card is NOT a fill and is never printed as one. `failureReasonOf`
 * reads the same envelope's `reason` the same way: a failed firing that
 * cost nothing still has something true to say about WHY.
 */

import type {
  ConditionalDetail,
  ConditionalPause,
  ConditionalQualifier,
  FiringState,
} from '@/lib/conditionals';
import { solText, stamp, type ClockContext } from './ledger-model';
import { humaniseState, stateWord } from './views';

// ───────────────────────── the wire's figures ─────────────────────────

/** Never a raw firing state. Open enum: anything else is humanised. */
const FIRING_WORDS: Readonly<Record<string, string>> = {
  claimed: 'Claimed',
  dispatched: 'Sent',
  guardrail_rejected: 'Refused by a guardrail',
  filled: 'Filled',
  failed: 'Failed',
  unknown: 'Outcome unknown',
  expired: 'Expired',
};

export function firingWord(state: FiringState): string {
  return FIRING_WORDS[state] ?? humaniseState(state);
}

export interface SolDelta {
  readonly sign: '+' | '-';
  /** The magnitude in SOL, trimmed. Never signed itself. */
  readonly amount: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `reconciliation_result.sol_delta_lamports`, read tolerantly. The column
 * is `jsonb` and the port types it `unknown`, so this accepts the two
 * shapes a lamport figure arrives in — a JS number and a BigInt-derived
 * decimal string — and refuses everything else rather than coercing.
 */
export function solDeltaOf(result: unknown): SolDelta | null {
  if (!isRecord(result)) return null;
  const raw = result['sol_delta_lamports'];
  const text =
    typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)
      ? String(raw)
      : typeof raw === 'string' && /^-?\d+$/.test(raw)
        ? raw
        : null;
  if (text === null) return null;
  const negative = text.startsWith('-');
  const amount = solText(negative ? text.slice(1) : text);
  return amount === null ? null : { sign: negative ? '-' : '+', amount };
}

/**
 * `reconciliation_result.reason` — the §13.7 verdict's own word for why a
 * settlement did not land (`never_broadcast`,
 * `not_found_past_blockhash_validity`, …). The reconciler writes it on the
 * FAILED envelope only, so a filled firing answers `null` and so does an
 * api older than the field: this reads the member on its own and never
 * gates on `outcome`, because a record must not be dropped for a key it
 * does not carry.
 *
 * VERBATIM, like every other unrecognised server word on this surface. A
 * failed firing whose reason the wire withheld says nothing — the figure
 * rule (never invent) is the reason rule too.
 */
export function failureReasonOf(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const raw = result['reason'];
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text === '' ? null : text;
}

// ───────────────────────── the identity strip ─────────────────────────

export interface IdentityStrip {
  /** The human state word — never a raw one (`views.ts` owns the table). */
  readonly word: string;
  /** `Aug 12, 21:58`. Empty when the lifetime is still unresolved. */
  readonly expiry: string;
  /** `2 of 3 runs`. Empty when the wire served no count — absent is not zero. */
  readonly runs: string;
}

/**
 * How many times it has run, against how many it was authorized for. The
 * count is OPTIONAL on the wire and an older api omits it; a missing count
 * says nothing rather than claiming zero.
 */
function runsText(qualifier: ConditionalQualifier | undefined, firedCount: number | undefined): string {
  const fired =
    typeof firedCount === 'number' && Number.isInteger(firedCount) && firedCount >= 0
      ? firedCount
      : null;
  if (fired === null) return '';
  if (qualifier?.kind === 'first_n' && typeof qualifier.n === 'number') {
    return `${fired} of ${qualifier.n} runs`;
  }
  if (qualifier?.kind === 'once') return fired > 0 ? 'the one run is done' : 'not run yet';
  if (fired === 0) return 'no runs yet';
  return fired === 1 ? '1 run so far' : `${fired} runs so far`;
}

export function identityStrip(
  detail: ConditionalDetail,
  firedCount: number | undefined,
  ctx: ClockContext,
): IdentityStrip {
  return {
    word: stateWord(detail.effective_state ?? detail.state),
    expiry: stamp(detail.expires_at, ctx),
    runs: runsText(detail.qualifier, firedCount),
  };
}

// ───────────────────────── the lineage strip ─────────────────────────

export interface LineageNode {
  readonly version: number;
  /** `v2 · live` on the current one, `v1` on the rest. */
  readonly label: string;
  readonly current: boolean;
  /** `Aug 11, 20:41`. Empty when the journal does not date that hop. */
  readonly at: string;
}

/**
 * The revision chain, oldest to newest, current lit.
 *
 * `conditionals.version` counts authorized revisions from 1, so the CHAIN
 * is known even when the journal was truncated; the `edited` rows only
 * supply the instants. v1 is dated by the record's own creation and v(k+1)
 * by the k-th edit — the hop that minted it.
 */
export function lineageNodes(
  version: number,
  createdAt: string | null,
  editedAt: readonly string[],
  ctx: ClockContext,
): readonly LineageNode[] {
  const total = Math.max(1, Math.trunc(version));
  const nodes: LineageNode[] = [];
  for (let index = 0; index < total; index += 1) {
    const number = index + 1;
    const current = number === total;
    const iso = index === 0 ? createdAt : (editedAt[index - 1] ?? null);
    nodes.push({
      version: number,
      label: current ? `v${number} · live` : `v${number}`,
      current,
      at: stamp(iso, ctx),
    });
  }
  return nodes;
}

// ───────────────────────── funding ─────────────────────────

/**
 * Does the agent wallet cover what the next run needs?
 *
 * Lamport figures arrive as decimal STRINGS because they are BigInt-derived
 * server-side and a `number` would lose the tail; they are compared as
 * BigInt for the same reason. An unreadable or absent pair answers `null` —
 * "we cannot tell" is a third answer, and the controls row draws it as
 * neither funded nor unfunded.
 */
export function pauseFunded(pause: ConditionalPause | null | undefined): boolean | null {
  if (pause === undefined || pause === null) return null;
  const required = pause.required_lamports;
  const balance = pause.available_lamports ?? pause.balance_lamports;
  if (typeof required !== 'string' || typeof balance !== 'string') return null;
  if (!/^\d+$/.test(required) || !/^\d+$/.test(balance)) return null;
  return BigInt(balance) >= BigInt(required);
}

/** The shortfall in SOL, for the sentence that names it. */
export function shortfallText(pause: ConditionalPause | null | undefined): string | null {
  return pause === undefined || pause === null ? null : solText(pause.shortfall_lamports);
}

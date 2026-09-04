/**
 * Pure view-model for the proposal / authorization card.
 *
 * INPUT IS SERVER TRUTH AND ONLY SERVER TRUTH: `ProposalDetail`, the
 * record `GET /api/trade/proposals/:id` served. There is deliberately no
 * parameter through which a chat-embedded payload could reach a
 * renderer (04-frontend.md invariant 1).
 *
 * Everything here is total: no throw, no exhaustive `switch` over an
 * open server enum, no assumption that an optional block arrived.
 * Additive backend releases must widen values without breaking a
 * deployed client (invariant 3), so unknown states, unknown notice
 * kinds and an ABSENT `view` all degrade to something renderable.
 *
 * `armed` is never derived here from an approval the browser just
 * issued. It appears only when the SERVER reported the conditional's
 * state as `armed` — see `armedFromServer`.
 */

import { formatSolCompact, truncateMint } from '@/lib/format';
import { isKnownConditionalState } from '@/lib/conditionals';
import type {
  AuthorizationNotice,
  AuthorizationView,
  ConditionalState,
  ProposalDetail,
  ProposalKind,
  ProposalState,
} from '@/lib/conditionals';

const LAMPORTS_PER_SOL = 1_000_000_000;

// ───────────────────────── lifecycle ─────────────────────────

/**
 * What the card is doing, from the SERVER's proposal state plus, when
 * the server also told us, the conditional's state.
 *
 * `unknown` is the honest answer for a state this build has never
 * heard of: show the raw string, offer no actions.
 */
export type ProposalPhase =
  | 'awaiting_approval'
  | 'armed'
  | 'authorized'
  | 'declined'
  | 'expired'
  | 'superseded'
  | 'unknown';

/**
 * The card's phase.
 *
 * `conditionalState` must come from a server response (the decision
 * result's `conditional_state`, or a conditional read) — never from the
 * fact that the user just clicked approve. Passing `null` is always
 * safe and yields `authorized` rather than `armed`.
 */
export function proposalPhase(
  state: ProposalState,
  conditionalState: ConditionalState | null,
): ProposalPhase {
  switch (state) {
    case 'pending':
      return 'awaiting_approval';
    case 'declined':
      return 'declined';
    case 'expired':
      return 'expired';
    case 'superseded':
      return 'superseded';
    case 'approved':
      // ARMED IS A SERVER FACT. An approved proposal whose conditional
      // the server has not (yet) reported as armed reads "authorized".
      return conditionalState === 'armed' ? 'armed' : 'authorized';
    default:
      return 'unknown';
  }
}

/**
 * The conditional state the card is allowed to believe. Anything this
 * build does not recognise is discarded rather than guessed at, so an
 * unknown future state can never masquerade as `armed`.
 */
export function armedFromServer(conditionalState: ConditionalState | null | undefined): ConditionalState | null {
  if (typeof conditionalState !== 'string') return null;
  return isKnownConditionalState(conditionalState) ? conditionalState : null;
}

/** Phases where approve / decline controls are meaningful. */
export function acceptsDecision(phase: ProposalPhase): boolean {
  return phase === 'awaiting_approval';
}

// ───────────────────────── countdown ─────────────────────────

export interface ExpiryCountdown {
  /** ISO the server sent, echoed for `<time dateTime>`. */
  readonly expiresAt: string;
  readonly remainingMs: number;
  /** `mm:ss`, or `h:mm:ss` past an hour. `expired` once it runs out. */
  readonly text: string;
  /** Terminal: the decision window has closed. */
  readonly expired: boolean;
  /** Under a minute — render with urgency. */
  readonly urgent: boolean;
}

/**
 * Countdown to the pending-decision deadline. An unparseable
 * `expires_at` yields `null` (render no countdown) rather than NaN.
 */
export function expiryCountdown(expiresAt: string, nowMs: number): ExpiryCountdown | null {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return null;
  const remainingMs = deadline - nowMs;
  if (remainingMs <= 0) {
    return { expiresAt, remainingMs: 0, text: 'expired', expired: true, urgent: false };
  }
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    expiresAt,
    remainingMs,
    text: hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`,
    expired: false,
    urgent: remainingMs < 60_000,
  };
}

// ─────────────────── raw facts from the stored envelope ───────────────────

/** `canonical_payload.warnings[].detail`, tolerant: a malformed entry renders nothing. */
function warningTexts(canonical: unknown): readonly string[] {
  const raw = asRecord(canonical)?.['warnings'];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => readString(asRecord(entry), 'detail')).filter((text): text is string => text !== null);
}
//
// `canonical_payload` is `unknown` by contract. These readers are
// shallow, tolerant and total: a field that is missing or the wrong
// type simply does not render.

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `250` → `"2.5%"`. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

export function formatLamportsSol(lamports: number): string {
  return `${formatSolCompact(lamports / LAMPORTS_PER_SOL, '0')} SOL`;
}

/**
 * The action payloads of the stored envelope. Immediate proposals store
 * the `ActionPayload` directly; conditional envelopes store `{ir,
 * payloads, predicates}`.
 */
function actionPayloads(canonical: unknown): readonly Record<string, unknown>[] {
  const envelope = asRecord(canonical);
  if (envelope === null) return [];
  const payloads = envelope['payloads'];
  if (Array.isArray(payloads)) {
    return payloads.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  // Immediate: the envelope IS the action payload.
  return 'side' in envelope || 'sizing' in envelope ? [envelope] : [];
}

/** Human sizing text from an `ActionPayload.sizing` block. */
export function sizingText(sizing: unknown): string | null {
  const record = asRecord(sizing);
  if (record === null) return null;
  const lamports = readNumber(record, 'amount_lamports');
  if (lamports !== null) return formatLamportsSol(lamports);
  const baseUnits = readNumber(record, 'amount_base_units');
  if (baseUnits !== null) return `${baseUnits.toLocaleString('en-US')} base units`;
  const pctBps = readNumber(record, 'pct_bps');
  if (pctBps !== null) {
    const denomination = readString(record, 'denomination');
    const of = denomination === null ? 'position' : denomination.replace(/_/g, ' ');
    return `${formatBps(pctBps)} of ${of}`;
  }
  // An unknown sizing kind still names itself rather than vanishing.
  const kind = readString(record, 'kind');
  return kind === null ? null : kind.replace(/_/g, ' ');
}

function scopeText(scope: unknown): string | null {
  const record = asRecord(scope);
  if (record === null) return null;
  const mint = readString(record, 'mint');
  if (mint !== null) return truncateMint(mint);
  const kind = readString(record, 'kind');
  return kind === 'pattern' ? 'any matching token' : kind;
}

/**
 * The scope's mint, UNTRUNCATED — the only thing the token chip needs
 * to reach the image proxy and to look the symbol up. It is never
 * rendered whole; `token` remains the display form.
 */
function scopeMint(scope: unknown): string | null {
  return readString(asRecord(scope), 'mint');
}

function lifetimeTextFromIr(canonical: unknown): string | null {
  const envelope = asRecord(canonical);
  const lifetime = asRecord(asRecord(envelope?.['ir'])?.['lifetime'] ?? envelope?.['lifetime']);
  if (lifetime === null) return null;
  const durationMs = readNumber(lifetime, 'duration_ms');
  if (durationMs !== null) {
    const hours = durationMs / 3_600_000;
    if (hours >= 24) return `${Number((hours / 24).toFixed(1))} days`;
    if (hours >= 1) return `${Number(hours.toFixed(1))} h`;
    return `${Math.round(durationMs / 60_000)} min`;
  }
  const expiresAtMs = readNumber(lifetime, 'expires_at_ms');
  if (expiresAtMs !== null) return `until ${new Date(expiresAtMs).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  return readString(lifetime, 'kind');
}

/**
 * Worst-case exposure the SERVER rendered. There is no browser-side
 * fallback arithmetic here on purpose: an exposure the UI computed
 * itself would be a second, unauthoritative number next to the one the
 * step-up threshold is actually evaluated against.
 */
function exposureText(view: AuthorizationView | undefined, canonical: unknown): string | null {
  if (view !== undefined) {
    const text = typeof view.worst_case?.text === 'string' ? view.worst_case.text : null;
    if (text !== null && text !== '') return text;
    const lamports = view.worst_case?.total_exposure_lamports;
    if (typeof lamports === 'number' && Number.isFinite(lamports)) return formatLamportsSol(lamports);
  }
  // Immediate proposals carry an explicit ceiling on the payload.
  const payload = actionPayloads(canonical)[0] ?? null;
  const maxInput = readNumber(payload, 'max_input_lamports');
  return maxInput === null ? null : formatLamportsSol(maxInput);
}

/**
 * The same worst case as a NUMBER, when the server gave one, so the
 * card can set the amount itself (mono figure + the Solana mark) rather
 * than printing the unit as a word. The server's rendered `text` stays
 * on the model beside it and is what the fine print shows verbatim.
 */
function exposureLamports(view: AuthorizationView | undefined, canonical: unknown): number | null {
  const fromView = view?.worst_case?.total_exposure_lamports;
  if (typeof fromView === 'number' && Number.isFinite(fromView)) return fromView;
  return readNumber(actionPayloads(canonical)[0] ?? null, 'max_input_lamports');
}

/**
 * Predicate families that are UNIMPLEMENTED and must not appear in
 * product UI (owner directive). The card renders no control, chip or
 * label for them; if one ever shows up on a stored envelope it is
 * dropped from the summary rather than advertised.
 */
const HIDDEN_PREDICATE_PREFIXES = [
  'classifier',
  'semantic',
  'enrichment',
  'article',
  'link',
  'vision',
] as const;

export function isHiddenPredicateKind(kind: string): boolean {
  const normalized = kind.toLowerCase();
  return HIDDEN_PREDICATE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}.`),
  );
}

/** Predicate gist. `view` legs first; otherwise the raw predicate kinds. */
function predicateSummary(view: AuthorizationView | undefined, canonical: unknown): readonly string[] {
  if (view !== undefined && Array.isArray(view.legs)) {
    const texts = view.legs
      .map((leg) => (typeof leg?.condition_text === 'string' ? leg.condition_text : ''))
      .filter((text) => text !== '');
    if (texts.length > 0) return texts;
  }
  const predicates = asRecord(asRecord(canonical)?.['predicates']);
  if (predicates === null) return [];
  return Object.keys(predicates)
    .filter((key) => !isHiddenPredicateKind(key))
    .map((key) => key.replace(/_/g, ' '));
}

/**
 * Follow-up and protective behaviour: per-leg guardrail text from the
 * rendered view, else the guardrail kinds on the raw payloads, plus the
 * partial-fill policy when one is set.
 */
function protectiveBehaviour(view: AuthorizationView | undefined, canonical: unknown): readonly string[] {
  const out: string[] = [];
  if (view !== undefined && Array.isArray(view.legs)) {
    for (const leg of view.legs) {
      if (Array.isArray(leg?.guardrail_texts)) {
        for (const text of leg.guardrail_texts) if (typeof text === 'string' && text !== '') out.push(text);
      }
      // Leg 2+ arming on leg-1 settlement IS the follow-up behaviour.
      if (typeof leg?.arm_text === 'string' && leg.leg_no > 1 && leg.arm_text !== '') {
        out.push(`leg ${leg.leg_no}: ${leg.arm_text}`);
      }
    }
  }
  if (out.length === 0) {
    for (const payload of actionPayloads(canonical)) {
      const guardrails = payload['guardrails'];
      if (!Array.isArray(guardrails)) continue;
      for (const guardrail of guardrails) {
        const kind = readString(asRecord(guardrail), 'kind');
        if (kind !== null) out.push(kind.replace(/_/g, ' '));
      }
    }
  }
  const policy = readString(actionPayloads(canonical)[0] ?? null, 'partial_fill_policy');
  if (policy !== null) out.push(`partial fills: ${policy.replace(/_/g, ' ')}`);
  return out;
}

// ───────────────────────── legs ─────────────────────────

/**
 * ONE LEG of the authorization, kept whole.
 *
 * The flattened fields below (`predicates`, `protective`) lost the leg
 * BOUNDARY — leg 2's condition landed in the predicate list and its
 * arming text in the protective list, so the card could not say "and
 * then, once that fills, this". The card renders a `conditions:` /
 * `then:` pair per leg from these; the flattened fields stay for the
 * details drawer, which is what keeps the no-fact-dropped invariant
 * true whatever the shape.
 */
export interface ProposalLeg {
  readonly legNo: number;
  /** The server's condition text(s) for this leg. */
  readonly conditions: readonly string[];
  /** The server's action phrase ("sell the position"), when it rendered one. */
  readonly actionText: string | null;
  /** How this leg arms — DETAILS ONLY; it is not what the leg does. */
  readonly armText: string | null;
  /** Structured action, when a payload for this leg parsed cleanly. */
  readonly side: string | null;
  readonly amount: string | null;
  readonly amountLamports: number | null;
  readonly mint: string | null;
  readonly guardrails: readonly string[];
}

/**
 * The legs the SERVER rendered, joined to their action payloads BY
 * INDEX (`payloads[i]` is leg `i + 1`'s). A leg with no payload of its
 * own — the common case for a protective leg, which sizes off the
 * position rather than an amount — simply keeps the server's phrase.
 *
 * With no rendered view there are no legs to read, so the raw predicate
 * kinds and the first payload become a single leg rather than nothing:
 * degraded, but still a condition and an action.
 */
function buildLegs(view: AuthorizationView | undefined, canonical: unknown): readonly ProposalLeg[] {
  const payloads = actionPayloads(canonical);
  const fromPayload = (payload: Record<string, unknown> | null) => ({
    side: readString(payload, 'side'),
    amount: sizingText(payload?.['sizing']),
    amountLamports: readNumber(asRecord(payload?.['sizing']), 'amount_lamports'),
    mint: readString(asRecord(payload?.['scope']), 'mint'),
  });

  const viewLegs = view !== undefined && Array.isArray(view.legs) ? view.legs : [];
  if (viewLegs.length > 0) {
    return viewLegs.map((leg, index) => {
      const conditionText = typeof leg?.condition_text === 'string' ? leg.condition_text.trim() : '';
      return {
        legNo: typeof leg?.leg_no === 'number' && Number.isFinite(leg.leg_no) ? leg.leg_no : index + 1,
        conditions: conditionText === '' ? [] : [conditionText],
        actionText: typeof leg?.action_text === 'string' && leg.action_text !== '' ? leg.action_text : null,
        armText: typeof leg?.arm_text === 'string' && leg.arm_text !== '' ? leg.arm_text : null,
        guardrails: Array.isArray(leg?.guardrail_texts)
          ? leg.guardrail_texts.filter((text: unknown): text is string => typeof text === 'string' && text !== '')
          : [],
        ...fromPayload(payloads[index] ?? null),
      };
    });
  }

  const payload = payloads[0] ?? null;
  const conditions = predicateSummary(view, canonical);
  if (conditions.length === 0 && payload === null) return [];
  return [
    { legNo: 1, conditions, actionText: null, armText: null, guardrails: [], ...fromPayload(payload) },
  ];
}

// ───────────────────────── the model ─────────────────────────

export interface RevisionLineage {
  readonly kind: ProposalKind;
  readonly conditionalId: string;
  /** Version this proposal produces, when the server named one. */
  readonly version: number | null;
  readonly text: string;
}

export interface ProposalCardModel {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly state: ProposalState;
  readonly phase: ProposalPhase;
  /** Server said something this build does not know — say so, don't guess. */
  readonly unknownState: boolean;
  /** The rendered view was absent; the card is showing raw facts. */
  readonly degradedView: boolean;
  readonly summary: string | null;
  readonly agentWallet: string | null;
  readonly token: string | null;
  /** The scope mint itself, for the token chip's image + symbol lookup. */
  readonly mint: string | null;
  readonly action: string | null;
  readonly amount: string | null;
  /** The size in lamports when the server gave one, so the card can set the mark. */
  readonly amountLamports: number | null;
  readonly slippage: string | null;
  readonly lifetime: string | null;
  readonly maxExposure: string | null;
  /** The worst case in lamports when the server gave a number. */
  readonly maxExposureLamports: number | null;
  readonly qualifier: string | null;
  /** The authorization leg by leg — what the card's sections render. */
  readonly legs: readonly ProposalLeg[];
  readonly predicates: readonly string[];
  readonly protective: readonly string[];
  readonly notices: readonly AuthorizationNotice[];
  /**
   * Compile warnings the envelope was stored with (`canonical_payload
   * .warnings`, F4 item 2): a stop the pump-curve floor makes unreachable,
   * a copy-trade cooldown raised to the floor. Compiler text, rendered as
   * TEXT above the fold — the user must read these BEFORE approving, so
   * they never sit inside `details`. Empty when none.
   */
  readonly warnings: readonly string[];
  readonly lineage: RevisionLineage | null;
  readonly countdown: ExpiryCountdown | null;
  /**
   * The clock this model was built against. The card humanizes the
   * server's timestamps at render (`in 2m`), and it must do so from the
   * SAME instant the countdown used — never from a second `Date.now()`
   * inside the renderer, which would make the card untestable.
   */
  readonly nowMs: number;
  /** Controls are live only while the server record is pending and unexpired. */
  readonly canDecide: boolean;
}

/**
 * Build the card model from the canonical record.
 *
 * @param detail       `GET /api/trade/proposals/:id` — server truth.
 * @param nowMs        clock for the countdown.
 * @param conditionalState the conditional's state AS THE SERVER REPORTED IT,
 *                     or `null`. Never a locally-optimistic value.
 */
export function buildProposalCardModel(
  detail: ProposalDetail,
  nowMs: number,
  conditionalState: ConditionalState | null = null,
): ProposalCardModel {
  const view = detail.view;
  const canonical = detail.canonical_payload;
  const payload = actionPayloads(canonical)[0] ?? null;
  const countdown = typeof detail.expires_at === 'string' ? expiryCountdown(detail.expires_at, nowMs) : null;
  const phase = proposalPhase(detail.state, armedFromServer(conditionalState));

  const lineage: RevisionLineage | null =
    detail.conditional_id === null
      ? null
      : {
          kind: detail.kind,
          conditionalId: detail.conditional_id,
          version: detail.conditional_version,
          text:
            detail.kind === 'conditional_revision'
              ? `revises authorization ${detail.conditional_id.slice(0, 8)}${
                  detail.conditional_version === null ? '' : ` → v${detail.conditional_version}`
                }`
              : `authorization ${detail.conditional_id.slice(0, 8)}${
                  detail.conditional_version === null ? '' : ` v${detail.conditional_version}`
                }`,
        };

  const slippageBps = readNumber(payload, 'slippage_bps');
  const impactBps = readNumber(payload, 'impact_ceiling_bps');

  return {
    proposalId: detail.proposal_id,
    kind: detail.kind,
    state: detail.state,
    phase,
    unknownState: phase === 'unknown',
    // The api omits `view` entirely when `renderView` hit registry
    // drift. Only conditional envelopes ever have one, so an immediate
    // proposal is not "degraded" for lacking it.
    degradedView: view === undefined && detail.kind !== 'immediate',
    summary: view !== undefined && typeof view.summary === 'string' && view.summary !== '' ? view.summary : null,
    agentWallet: readString(payload, 'wallet_account_id'),
    token: scopeText(payload?.['scope']),
    mint: scopeMint(payload?.['scope']),
    action: readString(payload, 'side'),
    amount: sizingText(payload?.['sizing']),
    amountLamports: readNumber(asRecord(payload?.['sizing']), 'amount_lamports'),
    slippage:
      slippageBps === null
        ? null
        : `${formatBps(slippageBps)}${impactBps === null ? '' : ` (impact ≤ ${formatBps(impactBps)})`}`,
    lifetime:
      view !== undefined && typeof view.lifetime_text === 'string' && view.lifetime_text !== ''
        ? view.lifetime_text
        : lifetimeTextFromIr(canonical),
    maxExposure: exposureText(view, canonical),
    maxExposureLamports: exposureLamports(view, canonical),
    qualifier:
      view !== undefined && typeof view.qualifier?.text === 'string' && view.qualifier.text !== ''
        ? view.qualifier.text
        : null,
    legs: buildLegs(view, canonical),
    predicates: predicateSummary(view, canonical),
    protective: protectiveBehaviour(view, canonical),
    notices: view !== undefined && Array.isArray(view.notices) ? view.notices : [],
    warnings: warningTexts(canonical),
    lineage,
    countdown,
    nowMs,
    // Both halves are server-derived: the record must be pending AND
    // the deadline the server stamped must not have passed.
    canDecide: acceptsDecision(phase) && countdown?.expired !== true,
  };
}

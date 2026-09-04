/**
 * Wire types for the trade-control user-facing surface
 * (`api/src/trade-control/plugin.ts`, the `/api/trade/**` routes only).
 *
 * SERVER TRUTH. Every shape here mirrors what the api actually sends; a
 * proposal is fetched BY ID and never reconstructed from chat-embedded
 * content (04-frontend.md invariant 1). Lifecycle states are the server
 * record's states, never derived in the browser.
 *
 * The `/internal/trade-control/**` operator routes are deliberately
 * absent: they must be unreachable from product UI.
 *
 * FORWARD COMPATIBILITY (invariant 3): every server-owned enum is typed
 * as `Known | (string & {})` so an additive backend release widens the
 * value set without breaking a deployed client. Narrow with the
 * `isKnown*` guards in `parse.ts` and render a neutral fallback for the
 * rest — never throw, never assume exhaustiveness.
 */

/**
 * A server enum that MAY carry values this build has never heard of.
 * `string & {}` keeps editor completion on the known members while still
 * accepting anything the server sends.
 */
export type Open<T extends string> = T | (string & Record<never, never>);

// ───────────────────────── proposals ─────────────────────────

/** `trade_control.trade_proposals.kind`. */
export type ProposalKind = Open<'immediate' | 'conditional' | 'conditional_revision'>;

/**
 * `trade_control.trade_proposals.state` (migration 0072 CHECK), as the
 * api renders it: reads apply lazy expiry, so a `pending` row past
 * `expires_at` is served as `expired`.
 */
export type ProposalState = Open<'pending' | 'approved' | 'declined' | 'expired' | 'superseded'>;

/** `POST /api/trade/proposals/:id/decision` body. NOT "reject" — `decline`. */
export type ProposalDecision = 'approve' | 'decline';

/** Who authored the record. */
export type CreatedBy = Open<'chat' | 'ui'>;

/**
 * §7.2 AuthorizationView — the normative human-readable rendering of an
 * authorized conditional, produced server-side from the STORED IR.
 *
 * MAY BE ABSENT. `renderView` swallows registry drift and returns
 * `undefined`, in which case the api omits the key entirely; the read
 * must keep serving (X§1 queryable-at-all-times). Treat a missing view
 * as "cannot render richly", never as an error.
 */
export interface AuthorizationView {
  readonly v: 1;
  /** One line: qualifier + condition gist + action + lifetime. */
  readonly summary: string;
  readonly qualifier: AuthorizationQualifier;
  /** Absolute → UTC timestamp; relative → duration. */
  readonly lifetime_text: string;
  readonly worst_case: { readonly total_exposure_lamports: number; readonly text: string };
  /** Per registered predicate kind name. Open-ended by construction. */
  readonly kinds_counted: Readonly<Record<string, number>>;
  readonly rubrics: ReadonlyArray<AuthorizationRubric>;
  readonly legs: ReadonlyArray<AuthorizationViewLeg>;
  readonly notices: ReadonlyArray<AuthorizationNotice>;
}

export interface AuthorizationQualifier {
  readonly kind: Open<'first_n' | 'every' | 'once'>;
  readonly n?: number;
  readonly cooldown_s?: number;
  readonly text: string;
}

export interface AuthorizationRubric {
  readonly name: string;
  readonly version: string;
  readonly predicate_hash: string;
}

export interface AuthorizationViewLeg {
  readonly leg_no: number;
  /** "arms immediately" | "arms on leg-1 settlement". */
  readonly arm_text: string;
  /** Fragments + operator templates ONLY (§7.3). */
  readonly condition_text: string;
  readonly thresholds: ReadonlyArray<{ readonly label: string; readonly value_text: string }>;
  /** Side, sizing, ceilings, send mode. */
  readonly action_text: string;
  readonly guardrail_texts: ReadonlyArray<string>;
  readonly lifetime_text?: string;
  /** Pattern scope only. */
  readonly universe_text?: string;
}

/** Known notice kinds. Unknown kinds still carry `text` — render that. */
export type AuthorizationNoticeKind = Open<
  | 'universe_choice'
  | 'post_expiry_protective_legs'
  | 'cancel_with_bound_position'
  | 'edit_in_flight_claims'
  | 'withdrawal_auto_pause'
  | 'non_default_knob'
  | 'clamped_knob'
>;

export interface AuthorizationNotice {
  readonly kind: AuthorizationNoticeKind;
  readonly text: string;
}

/**
 * `POST /api/trade/proposals` request body (zod `zCreateBody`).
 *
 * The payload/IR members are `unknown` ON THE SERVER TOO — they are
 * re-validated and re-hashed against the canonical shape after this
 * envelope is parsed, and the ORIGINAL object (never a zod clone) is
 * what gets hashed. Passing them through untouched is required.
 */
export interface CreateProposalRequest {
  /** Creation idempotency key, 8–200 chars. Server generates one if omitted. */
  readonly command_id?: string;
  readonly kind: 'immediate' | 'conditional' | 'conditional_revision';
  /** immediate */
  readonly payload?: unknown;
  readonly quote_snapshot?: unknown;
  readonly risk_snapshot?: unknown;
  /** conditional kinds */
  readonly ir?: unknown;
  readonly payloads?: readonly unknown[];
  readonly predicates?: Readonly<Record<string, unknown>>;
  /** 64 lowercase hex. */
  readonly plan_hash?: string;
  /** revision */
  readonly conditional_id?: string;
  readonly revises_proposal_id?: string;
  readonly revision_op?: 'cancel';
  /** lineage */
  readonly intent_text?: string;
  readonly conversation_id?: string;
  readonly tool_version?: string;
  readonly prompt_version?: string;
  /** Integer seconds, >= 10. */
  readonly expires_in_s?: number;
}

/**
 * `POST /api/trade/proposals` 200/201 body (`creationBody`).
 *
 * `created: false` means the idempotent creation path returned the
 * EXISTING proposal for this `command_id` — a retry, not a new record.
 */
export interface ProposalCreated {
  readonly proposal_id: string;
  readonly command_id: string;
  readonly kind: ProposalKind;
  readonly state: ProposalState;
  readonly payload_hash: string;
  readonly conditional_id: string | null;
  readonly conditional_version: number | null;
  /** ISO-8601. Pending-decision expiry — the countdown source. */
  readonly expires_at: string;
  readonly created: boolean;
  /** Conditional kinds only, and only when the render succeeded. */
  readonly view?: AuthorizationView;
}

/**
 * `GET /api/trade/proposals/:id` — the AuthorizationView SOURCE OF
 * TRUTH. Approve/reject must bind to THIS record, never to a payload
 * embedded in a chat message.
 *
 * Superset of `ProposalCreated` (`created` is always `false` here).
 */
export interface ProposalDetail extends ProposalCreated {
  /** The stored authorized envelope. Opaque to the UI — render `view`. */
  readonly canonical_payload: unknown;
  readonly quote_snapshot: unknown;
}

/** 200 outcome of `POST /api/trade/proposals/:id/decision`. */
export type DecisionResult =
  | DecisionDeclined
  | DecisionApprovedImmediate
  | DecisionApprovedConditional
  | DecisionRepeat;

export interface DecisionDeclined {
  readonly proposal_id: string;
  readonly state: 'declined';
  readonly repeat?: false;
}

export interface DecisionApprovedImmediate {
  readonly proposal_id: string;
  readonly state: 'approved';
  readonly operation_id: string;
  readonly execution_state: ExecutionState;
  readonly repeat?: false;
}

export interface DecisionApprovedConditional {
  readonly proposal_id: string;
  readonly state: 'approved';
  readonly conditional_id?: string;
  readonly conditional_state?: ConditionalState;
  readonly view?: AuthorizationView;
  readonly repeat?: false;
}

/**
 * `repeat: true` — the decision CAS matched no row because the proposal
 * is ALREADY in the requested state. This is a 200, not an error: the
 * server replays the original outcome so a double-click is a no-op.
 */
export interface DecisionRepeat {
  readonly proposal_id: string;
  readonly state: ProposalState;
  readonly repeat: true;
  readonly operation_id?: string;
  readonly execution_state?: ExecutionState;
  readonly conditional_id?: string;
  readonly view?: AuthorizationView;
}

// ───────────────────────── conditionals ─────────────────────────

/**
 * `trade_control.conditionals.state` (migration 0072 CHECK). The durable
 * authorization the product speaks of maps onto this: `armed` = active,
 * `paused`/`budget_paused` = paused, `cancelled` = revoked.
 */
export type ConditionalState = Open<
  | 'draft'
  | 'pending_auth'
  | 'armed'
  | 'paused'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'expiry_pending'
  | 'budget_paused'
>;

/**
 * Product-level rollup of `ConditionalState`, for UI that only needs
 * active / paused / revoked / finished. Unknown server states collapse
 * to `unknown` rather than being guessed at.
 */
export type DurableAuthorizationState = 'active' | 'paused' | 'revoked' | 'finished' | 'pending' | 'unknown';

/** `trade_control.conditional_legs.state`. */
export type LegState = Open<'pending' | 'armed' | 'paused' | 'fired' | 'completed' | 'expired' | 'cancelled'>;

/** `trade_control.firings.state`. */
export type FiringState = Open<
  'claimed' | 'dispatched' | 'guardrail_rejected' | 'filled' | 'failed' | 'unknown' | 'expired'
>;

/** `trade_control.trade_executions.state`. */
export type ExecutionState = Open<
  'pending' | 'dispatched' | 'accepted' | 'unknown' | 'filled' | 'failed' | 'rejected'
>;

/**
 * `trade_control.conditional_events.transition` — an OPEN vocabulary by
 * design (the column is plain `text`, the journal is insert-only). Known
 * members are documentation, not a closed set; timeline UI must render
 * an unknown transition rather than dropping it.
 *
 * `firing_claimed` / `firing_settled` / `partial_abandoned` are the
 * §13.3/§13.6 writers' actual vocabulary, confirmed against the first
 * production execution's journal.
 */
export type ConditionalTransition = Open<
  | 'armed'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'edited'
  | 'budget_paused'
  | 'fired'
  | 'firing_claimed'
  | 'firing_settled'
  | 'partial_abandoned'
>;

/** `trade_control.trade_proposal_events.transition` — also open. */
export type ProposalTransition = Open<
  | 'approved'
  | 'declined'
  | 'expired'
  | 'superseded'
  | 'decision_repeat'
  | 'decision_conflict'
  | 'decision_stepup_stale'
  | 'decision_reauth_required'
  | 'decision_arm_check_failed'
  | 'decision_leg_immutable'
>;

/**
 * Why a `paused` row is paused — the read half of the 0159 funds pause
 * (`api/src/trade-control/queries/reads.ts` `ConditionalPauseInfo`).
 *
 * `state: 'paused'` alone cannot tell a user pause from the system taking
 * an unfundable conditional out of `armed`; this says which, and by how
 * much. Served as an ADDITIVE block, `null` for every non-paused row.
 *
 * LAMPORT AMOUNTS STAY STRINGS end to end — they are `numeric`/BigInt
 * derived server-side and would lose precision as JSON numbers. Every
 * field degrades to `null` independently, so a malformed `pause_detail`
 * still renders a reason.
 */
export interface ConditionalPause {
  /**
   * Machine-readable: `insufficient_funds` (0159) or `exit_failed` (0189).
   * Open by construction.
   */
  readonly reason: Open<'insufficient_funds' | 'exit_failed'>;
  /** The wallet balance this conditional needs to become claimable again. */
  readonly required_lamports: string | null;
  /** What the wallet held when the claim failed. */
  readonly balance_lamports: string | null;
  /** Balance minus fee/tip ceilings and other armed reservations. */
  readonly available_lamports: string | null;
  /** required − balance: the funding gap to close. */
  readonly shortfall_lamports: string | null;
  /** The leg whose claim could not be funded, or whose exit gave up. */
  readonly leg_no: number | null;
  /**
   * 0189 `exit_failed` only, and OPTIONAL on every one of them: the
   * evaluator writes `{attempts, max_attempts, leg_no, last_reason,
   * instance_id}` into `pause_detail`, and an api that does not project a
   * member omits the key entirely. Absent is not zero and not "" — every
   * reader degrades each field on its own, exactly as the lamport ones do.
   */
  readonly attempts?: number | null;
  /** `RETRY_MAX_ATTEMPTS` — the bound the core gave up at. */
  readonly max_attempts?: number | null;
  /** The last §13.7 settlement failure reason, as the engine worded it. */
  readonly last_reason?: string | null;
  /** The evaluator instance that exhausted its attempts. Diagnostic only. */
  readonly instance_id?: string | null;
}

// ───────────────────────── classifier (semantic judge) ─────────────────────────

/**
 * The semantic judge's verdicts, mirrored from `tasks/classifier-live/
 * CONTRACT.md` §4 field for field. `accepted` = match at or above the
 * rubric's confidence floor; `rejected` = no_match OR a match below it;
 * `unknown` = the judge could not say; `pending` = not yet committed.
 */
export type ClassifierOutcome = Open<'accepted' | 'rejected' | 'unknown' | 'pending'>;

export interface ClassifierCandidate {
  readonly predicate_hash: string;
  /** Stream-prefixed, e.g. `tweet:<status_id>`. */
  readonly entity_id: string;
  readonly entity_version: number;
  readonly state: Open<'pending' | 'committed'>;
  readonly verdict: Open<'match' | 'no_match' | 'unknown'> | null;
  readonly confidence_bps: number | null;
  /** `predicates.spec.confidence_min_bps` — the floor a match must clear. */
  readonly confidence_min_bps: number;
  readonly outcome: ClassifierOutcome;
  readonly latency_ms: number | null;
  /** bigint micro-USD as a decimal string. */
  readonly cost_micro: string | null;
  readonly created_at: string;
  readonly committed_at: string | null;
  readonly target: string;
  /** `predicates.spec.rubric.name` — the claim being judged. */
  readonly rubric_name: string;
  /** `https://x.com/i/status/<id>` for tweet entities, else null. */
  readonly link: string | null;
}

export interface ClassifierRubric {
  readonly predicate_hash: string;
  readonly name: string;
  readonly target: string;
  readonly confidence_min_bps: number;
}

export interface ClassifierSummary {
  readonly evaluations: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly unknown: number;
  readonly pending: number;
  /** Sum over ALL evaluations for this conditional's predicates, micro-USD. */
  readonly cost_micro: string;
  readonly last_evaluated_at: string | null;
  readonly model_version: string | null;
  readonly rubrics: readonly ClassifierRubric[];
}

/** Top-level `classifier` on `/state`; degrades independently like `detail`. */
export type ClassifierBlock =
  | {
      readonly available: true;
      readonly summary: ClassifierSummary;
      /** Newest first, LIMIT 200. */
      readonly candidates: readonly ClassifierCandidate[];
    }
  | {
      readonly available: false;
      readonly reason: Open<'no_semantic_predicates' | 'event_plane_unreachable'>;
    };

// ───────────────────────── revision sync ─────────────────────────

/**
 * Is the evaluator on the version you edited? (CONTRACT-3 §B.1.) The
 * platform row's `version` is what the user approved; `armed_version` is
 * the last one the arming sync landed on the event cluster. `in_sync` is
 * the server's verdict — false only for a LIVE plan whose mirror lags (a
 * draft has no mirror by design; an ended plan's is allowed to lag).
 */
/**
 * The per-order notification override (`conditional_notification_prefs.mode`),
 * as the api serves it: `'inherit'` when the plan has no row and follows the
 * user's global per-tier settings — the default, and the reason the default
 * costs zero writes.
 *
 * `'alert'` promotes even trace-tier events on this ONE plan to a toast;
 * `'off'` stops inbox rows for it. Neither loses history — the plan's
 * Activity tab reads the lifecycle journal directly.
 */
export type ConditionalNotificationMode = Open<'inherit' | 'alert' | 'inbox' | 'off'>;

/** Narrow an open server value to the four members this build knows. */
export function isConditionalNotificationMode(v: unknown): v is ConditionalNotificationMode {
  return v === 'inherit' || v === 'alert' || v === 'inbox' || v === 'off';
}

export interface ConditionalSyncState {
  readonly platform_version: number;
  /** `null` when the evaluator has never synced this conditional. */
  readonly armed_version: number | null;
  readonly in_sync: boolean;
  readonly synced_at: string | null;
}

/** One row of `GET /api/trade/conditionals`. */
export interface ConditionalListEconomics {
  readonly spent_lamports: string;
  readonly received_lamports: string;
  readonly net_lamports: string;
  readonly net_bps: number | null;
  readonly open_runs: number;
}

export interface ConditionalSummary {
  readonly conditional_id: string;
  readonly state: ConditionalState;
  /**
   * SERVER-derived display state: `completed` for a spent-but-`armed`
   * row (every leg settlement-completed, nothing can fire again — the
   * stored machine has no armed→completed writer yet). Equal to `state`
   * otherwise. OPTIONAL: an older api omits it; fall back to `state`.
   * Labels/buckets read this; action affordances keep reading `state`.
   */
  readonly effective_state?: ConditionalState;
  readonly version: number;
  readonly qualifier: ConditionalQualifier;
  readonly ast_hash: string;
  readonly created_by: CreatedBy;
  /** ISO-8601, or `null` while the lifetime is unresolved (pre-arm). */
  readonly expires_at: string | null;
  readonly created_at: string;
  /**
   * Why this row is paused, and by how much (0159). `null` for every row
   * that is not paused; OPTIONAL because an older api omits the key.
   */
  readonly pause?: ConditionalPause | null;
  /**
   * How many times this conditional has fired. OPTIONAL BY DESIGN: the
   * ledger's `×n` and its "died at which step" derivation want it, and
   * absent means "no count to show" — never zero. Do not infer one.
   */
  readonly fired_count?: number;
  /**
   * Money over the plan's fills (swap basis): spent / received / net and
   * the runs still open. Optional (older api); null when nothing filled.
   */
  readonly economics?: ConditionalListEconomics | null;
  /**
   * The server-rendered one-line plan (`AuthorizationView.summary`) —
   * qualifier, condition gist, action and lifetime in one string. The
   * list serves TEXT, never the typed IR, so the ledger's WHEN→THEN line
   * is compressed out of this (`components/conditionals/play-line.ts`).
   * OPTIONAL: absent when the render failed or the api predates it.
   */
  readonly summary?: string;
  /** The UNSHORTENED intent (summary is capped at 160 chars). Additive; absent on an older api. */
  readonly source_text?: string | null;
  /**
   * The one token this row's plan resolves to. Additive; absent on an
   * older api, and `null` whenever the plan does not provably name one.
   */
  readonly token?: ConditionalTokenIdentity | null;
  /**
   * The semantic judge's running tally (CONTRACT §4). `null` = no semantic
   * predicates or the event plane was unreachable; OPTIONAL because an
   * older api omits the key.
   */
  readonly classifier?: ClassifierSummary | null;
  /**
   * The evaluator is still on an older version of this plan (CONTRACT-3
   * §B.1). `null` = the event plane was unreachable (unknown, not false);
   * OPTIONAL because an older api omits the key.
   */
  readonly sync_pending?: boolean | null;
  /**
   * The per-order notification override backing this row's bell. Additive;
   * absent on an older api, and `'inherit'` (the default) when the plan
   * follows the user's global per-tier settings.
   */
  readonly notification_mode?: ConditionalNotificationMode;
}

export interface ConditionalQualifier {
  readonly kind: Open<'first_n' | 'every' | 'once'>;
  readonly n?: number;
  readonly cooldown_s?: number;
}

/** `GET /api/trade/conditionals` 200 body. */
export interface ConditionalListResponse {
  readonly conditionals: readonly ConditionalSummary[];
}

/** Query for the list route. `state` is comma-joined server-side. */
export interface ConditionalListQuery {
  readonly state?: readonly ConditionalState[];
  /** Server clamps to 500; defaults to 100. */
  readonly limit?: number;
}

/**
 * One `trade_control.conditional_legs` row as the read routes serve it.
 * `condition_nodes` / `action_payload` are raw stored JSON — render the
 * `AuthorizationView` legs instead of interpreting these.
 *
 * NOTE the wire quirk: `expires_at` here is serialized by the default
 * JSON date encoding of the row, NOT explicitly `.toISOString()`d like
 * the top-level fields. It still arrives as an ISO string.
 */
export interface ConditionalLeg {
  readonly id: string;
  readonly leg_no: number;
  readonly condition_nodes: unknown;
  readonly condition_hash: string;
  readonly action_payload: unknown;
  readonly payload_hash: string;
  readonly position_binding: number | null;
  readonly partial_fill_policy: Open<'re_arm_remainder' | 'market_chase' | 'abandon_alert'> | null;
  readonly state: LegState;
  readonly expires_at: string | null;
}

/** One `trade_control.firings` row. */
export interface ConditionalFiring {
  readonly id: string;
  readonly leg_id: string;
  readonly slot_no: number | null;
  readonly occurrence_seq: number;
  readonly entity_key: string | null;
  readonly plan_run_id: string;
  readonly operation_id: string;
  readonly claimed_version: number;
  readonly state: FiringState;
  readonly claimed_at: string;
  /**
   * The mint THIS firing's frozen order operates on (additive). A
   * pattern-scoped plan fires on tokens the plan-level `token` cannot
   * name, so identity is per firing; the mint alone still draws when the
   * catalog has no symbol. Absent on responses older than this field.
   */
  readonly mint?: string | null;
  readonly token?: ConditionalTokenIdentity | null;
}

/** One `trade_control.trade_executions` row joined through its firing. */
export interface ConditionalExecution {
  readonly operation_id: string;
  readonly firing_id: string | null;
  readonly proposal_id: string | null;
  readonly state: ExecutionState;
  readonly tx_signature: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * One `trade_control.conditional_events` row — the lifecycle timeline.
 * Served oldest-first (the query reads `seq DESC` then reverses).
 */
export interface ConditionalEvent {
  readonly seq: number;
  readonly transition: ConditionalTransition;
  /** User uuid, or a service actor such as `api` / `sweep`. */
  readonly actor: string;
  readonly evidence: unknown;
  readonly created_at: string;
}

/**
 * One `trade_control.trade_execution_events` row for an execution of
 * this conditional. The §13.6 settlement writes `settled_<terminal>`
 * with the reconciliation fill breakdown IN THE SAME TRANSACTION that
 * settles realized spend and releases the unspent reservation
 * (invariant 15) — this row is the server's settlement + release record.
 * Ordered by (operation_id, seq); settlement is NOT always the last row
 * (production shows a dispatcher `rejected_terminal` journaled after a
 * `settled_failed`).
 */
export interface ConditionalExecutionEvent {
  readonly operation_id: string;
  readonly seq: number;
  /** `accepted` / `settled_filled` / `settled_failed` / … — open. */
  readonly transition: Open<
    | 'accepted'
    | 'in_progress'
    | 'guardrail_rejected'
    | 'rejected_terminal'
    | 'dispatch_transport_ambiguous'
    | 'settled_filled'
    | 'settled_failed'
    | 'settled_rejected'
  >;
  readonly reconciliation_result: unknown;
  readonly tx_signature: string | null;
  readonly created_at: string;
}

/**
 * The engine journal (`trading.execution_dedup`, D6): state walks
 * `accepted → signed → broadcast → journaled | failed`, so any state at
 * `signed` or beyond is the engine's own record that signing happened.
 * Degrades independently of the lifecycle (`available: false`), and an
 * operation that never reached the engine has NO entry.
 */
export interface EngineJournalEntry {
  readonly operation_id: string;
  readonly state: Open<'accepted' | 'signed' | 'broadcast' | 'journaled' | 'failed'>;
  readonly accepted_at: string;
  readonly updated_at: string;
}

export type EngineJournal =
  | { readonly available: true; readonly entries: readonly EngineJournalEntry[] }
  | { readonly available: false };

/**
 * True fill time (`trading.fills.confirmed_at_ms`) — the engine's clock at
 * confirm-parse, ~1s after chain. This is the closest the platform gets to
 * when the trade actually landed: Solana `blockTime` is decoded but never
 * persisted on the trade path.
 *
 * It matters because the settlement journal's own `created_at` is written by
 * the reconciliation SWEEP, 8–13s later. Rendering that as "filled" reports
 * trades as far slower than they were.
 */
export interface FillTimeEntry {
  readonly operation_id: string;
  readonly confirmed_at_ms: number;
  readonly fill_count: number;
  /** Additive economics (see the api reader): side + realized amounts. */
  readonly side?: string;
  readonly sol_delta_lamports?: string;
  readonly swap_sol_lamports?: string | null;
  readonly token_delta_base_units?: string;
}

export type FillTimes =
  | { readonly available: true; readonly entries: readonly FillTimeEntry[] }
  | { readonly available: false };

/**
 * The ONE token a plan resolves to, or `null`. Non-null only when the plan
 * PROVABLY names exactly one mint (the api walks both the condition's
 * mint-scoped leaves and the legs' action payloads); two mints, a pattern
 * scope, or an unreadable ast all answer `null`, because unverifiable is
 * not the same as one. `symbol` is `null` when the catalog has no hydrated
 * ticker — the surface then names the token by its mint, never in prose.
 */
export interface ConditionalTokenIdentity {
  readonly mint: string;
  readonly symbol: string | null;
}

/** `GET /api/trade/conditionals/:id` 200 body. */
export interface ConditionalDetail {
  readonly conditional_id: string;
  readonly state: ConditionalState;
  /** See `ConditionalSummary.effective_state`. Optional (older api). */
  readonly effective_state?: ConditionalState;
  /**
   * Why a paused plan is paused, and by how much (0159). The detail route
   * has served this since the same commit the list route did
   * (`conditionalPauseInfo`); the type was the gap, which is why the
   * card's `pauseReason` prop had a TODO(wire) against it.
   */
  readonly pause?: ConditionalPause | null;
  readonly version: number;
  readonly qualifier: ConditionalQualifier;
  readonly ast_hash: string;
  readonly proposal_id: string;
  readonly created_by: CreatedBy;
  readonly source_text: string | null;
  /** The one token this plan resolves to. Optional (older api). */
  readonly token?: ConditionalTokenIdentity | null;
  /**
   * The per-order notification override backing this row's bell. Additive;
   * absent on an older api, and `'inherit'` (the default) when the plan
   * follows the user's global per-tier settings.
   */
  readonly notification_mode?: ConditionalNotificationMode;

  readonly expires_at: string | null;
  readonly legs: readonly ConditionalLeg[];
  readonly firings: readonly ConditionalFiring[];
  /** Omitted when the render failed or the proposal is not a conditional. */
  readonly view?: AuthorizationView;
}

/**
 * ERRATUM E9 DAG detail, read from the EVENT cluster. Independent
 * failure posture: the lifecycle half of `/state` always serves, and
 * `detail` degrades on its own when the event plane is unreachable.
 */
export type ConditionalDagDetail =
  | {
      readonly detail_available: true;
      readonly instances: readonly unknown[];
      readonly progress: readonly unknown[];
      readonly timers: readonly unknown[];
      readonly pending_evaluations: readonly unknown[];
      readonly armed_watches: readonly unknown[];
    }
  | {
      readonly detail_available: false;
      readonly reason: Open<'event_plane_unreachable'>;
    };

// ───────────────────────── positions + proofs ─────────────────────────

/**
 * One exit-leg target (a leaf of the dependent leg), as the api's
 * `buildPositions` reads it off `conditional_progress`.
 */
export interface ConditionalPositionTarget {
  readonly node_idx: number;
  readonly kind: string;
  /** The leaf's registry fragment when the api had one, else the kind. */
  readonly human: string;
  readonly in_zone: boolean | null;
  readonly state: string;
}

/** `exit_leg.state` — open, like every server enum. */
export type PositionExitState = Open<'watching' | 'closing' | 'exited' | 'closed_external' | 'failed' | 'stopped' | 'none'>;

/**
 * One position: an ENTRY firing that reached an execution, its own
 * exit-leg instance, its exit (by this plan or outside it) and the
 * realized PnL (`api/src/trade-control/queries/positions.ts`).
 *
 * LAMPORT / BASE-UNIT AMOUNTS ARE STRINGS — bigint-derived server-side.
 * Every priced field is `null` until the engine's fill is readable.
 */
export interface ConditionalPosition {
  /** The entry operation id. */
  readonly position_id: string;
  readonly mint: string | null;
  readonly token: ConditionalTokenIdentity | null;
  readonly entry: {
    readonly firing_id: string;
    readonly operation_id: string;
    readonly claimed_at: string;
    readonly filled_at: string | null;
    readonly sol_in_lamports: string | null;
    readonly token_base_units: string | null;
    /** Lamports per WHOLE token as an exact rational (num = sol × 1e6, den = base units). */
    readonly price_lamports_per_token: { readonly num: string; readonly den: string } | null;
    /** Entry price × a 1e9 supply — an ESTIMATE for 6-decimal pump mints. */
    readonly mcap_lamports_estimate: string | null;
    /** Market cap AT FILL, micro-USD, off the settlement's own pico-USD stamp. */
    readonly fill_mcap_usd_micros: string | null;
  };
  /**
   * The entry leg's market trigger as a LEVEL — the threshold the plan
   * asked for, never the price the tape read (the exec plane keeps no
   * market payloads). `gap_bps_vs_trigger` is fill MC vs this level when
   * both are numeric.
   */
  readonly trigger: {
    readonly text: string;
    readonly cmp: Open<'gte' | 'lte'> | null;
    readonly mcap_usd_micros: string | null;
    readonly gap_bps_vs_trigger: number | null;
  } | null;
  readonly exit_leg: {
    readonly leg_no: number | null;
    readonly instance_id: string | null;
    readonly state: PositionExitState;
    /** Failed exit attempts before the current state. Optional (older api). */
    readonly failed_attempts?: number;
    readonly targets: readonly ConditionalPositionTarget[];
    readonly last_level_version: number | null;
    readonly updated_at: string | null;
  };
  readonly exit: {
    readonly operation_id: string | null;
    readonly sol_out_lamports: string | null;
    readonly token_base_units: string | null;
    readonly filled_at: string | null;
    readonly source: Open<'conditional' | 'external'>;
    readonly signature: string | null;
  } | null;
  readonly pnl: {
    readonly realized_lamports: string | null;
    readonly realized_bps: number | null;
  };
}

/** The checkable fact behind one condition node of a firing. Open by `type`. */
export type ConditionalProofFact =
  | { readonly type: 'tweet'; readonly url: string; readonly handle: string; readonly id: string; readonly text: string | null; readonly at_ms: number | null }
  | { readonly type: 'deploy'; readonly mint: string; readonly symbol: string | null; readonly creator: string | null; readonly at_ms: number | null }
  | { readonly type: 'join'; readonly mint: string; readonly tweet_id: string | null; readonly tweet_url: string | null }
  | { readonly type: 'market_level'; readonly entity_id: string; readonly entity_version: number; readonly note: string }
  | {
      readonly type: 'wallet_trade';
      readonly wallet: string;
      readonly side: Open<'buy' | 'sell'>;
      readonly sol_lamports: string;
      readonly mint: string | null;
      readonly signature: string;
      readonly solscan_url: string;
      readonly at_ms: number | null;
    }
  | { readonly type: 'event'; readonly stream: string; readonly kind: string; readonly entity_id: string; readonly at_ms: number | null }
  | { readonly type: 'op'; readonly note: string }
  | { readonly type: 'unresolved' };

/** One proof line: what the condition asked, and what the record holds. */
export interface ConditionalProof {
  readonly node_idx: number;
  readonly kind: string;
  readonly claim: string;
  readonly fact: ConditionalProofFact;
}

/** `GET /api/trade/conditionals/:id/state` 200 body. */
export interface ConditionalStateResponse {
  readonly conditional_id: string;
  readonly state: ConditionalState;
  /** See `ConditionalSummary.effective_state`. Optional (older api). */
  readonly effective_state?: ConditionalState;
  /**
   * Why a paused plan is paused (0159), served by the polling state route
   * too — the detail query never refetches, so a pause landing while the
   * page is open is only visible here. Optional (older api).
   */
  readonly pause?: ConditionalPause | null;
  readonly version: number;
  readonly legs: readonly ConditionalLeg[];
  readonly firings: readonly ConditionalFiring[];
  readonly executions: readonly ConditionalExecution[];
  readonly events: readonly ConditionalEvent[];
  /** Execution journal rows. Optional: an older api omits them. */
  readonly execution_events?: readonly ConditionalExecutionEvent[];
  /** Engine journal (D6). Optional: an older api omits it. */
  readonly engine_journal?: EngineJournal;
  /** True fill times. Optional: an older api omits them. */
  readonly fill_times?: FillTimes;
  readonly detail: ConditionalDagDetail;
  /** Per-position read model. Optional: an older api omits it. */
  readonly positions?: readonly ConditionalPosition[];
  /** firing id → proofs, in node order. Optional: an older api omits it. */
  readonly proofs?: Readonly<Record<string, readonly ConditionalProof[]>>;
  /** The semantic judge's tally and candidates (CONTRACT §4). Optional: an older api omits it. */
  readonly classifier?: ClassifierBlock;
  /** Revision sync (CONTRACT-3 §B.1). `null` = event plane unreachable; optional on an older api. */
  readonly sync?: ConditionalSyncState | null;
}

/**
 * 200 body of cancel / resume. `repeat: true` on resume means the
 * conditional was ALREADY armed — idempotent, not an error.
 */
export interface ConditionalMutationResult {
  readonly conditional_id: string;
  readonly state: ConditionalState;
  readonly repeat?: boolean;
}

// ───────────────────────── agent wallet ─────────────────────────

/**
 * Agent-wallet readiness, as `GET /api/v1/me` reports it.
 *
 * READ THE HEADER NOTE IN `client.ts`: this is the USER-level
 * provisioning state (`identity`-scoped), which is what gates whether an
 * agent wallet can be provisioned and trade at all. There is no
 * user-facing per-wallet agent route — the only agent-wallet endpoint is
 * `POST /internal/trade-control/agent-wallet`, which is operator-only
 * and intentionally not in this port.
 *
 * NEVER infer readiness in the browser. `ready_to_trade` is a backend
 * transition with a single production writer.
 */
export type AgentWalletState = Open<
  | 'user_created'
  | 'turnkey_suborg_pending'
  | 'wallet_pending'
  | 'policy_pending'
  | 'wallet_ready_needs_nonce_setup'
  /** @deprecated pre-slice literals; the api normalizes them away. */
  | 'nonces_pending'
  /** @deprecated */
  | 'wallet_ready_needs_backup'
  /** @deprecated */
  | 'wallet_ready_needs_passkey_root'
  | 'ready_to_trade'
  | 'blocked'
>;

/** Normalized readiness for UI gating. Derived, never sent by the server. */
export interface AgentWalletReadiness {
  readonly state: AgentWalletState;
  /** True ONLY for the server's `ready_to_trade`. Never inferred otherwise. */
  readonly readyToTrade: boolean;
  /** Provisioning is still moving; show progress, not an error. */
  readonly provisioning: boolean;
  /** Terminal failure — the user cannot proceed without support. */
  readonly blocked: boolean;
  /** Server sent a state this build does not know. Show a neutral notice. */
  readonly unknown: boolean;
}

// ───────────────────────── errors ─────────────────────────

/**
 * Every trade-control failure body. `error_code` is open — the server
 * adds codes, and an unknown code must still render its `message`.
 */
export type TradeControlErrorCode = Open<
  | 'bad_request'
  | 'invalid_id'
  | 'proposal_not_found'
  | 'conditional_not_found'
  | 'user_not_found'
  | 'decision_conflict'
  | 'proposal_expired'
  | 'step_up_stale'
  | 'reauth_required'
  | 'arm_check_failed'
  | 'stale_revision'
  | 'conditional_not_editable'
  | 'leg_immutable'
  | 'not_resumable'
  | 'exit_failed_terminal'
  | 'agent_wallet_unavailable'
>;

export interface TradeControlErrorBody {
  readonly error_code: TradeControlErrorCode;
  readonly message: string;
  readonly [key: string]: unknown;
}

/**
 * 403 `step_up_stale` — the exposure exceeds
 * `EXEC_STEP_UP_VALUE_THRESHOLD_LAMPORTS` and the session's step-up
 * verification is stale. The proposal is UNTOUCHED and still pending:
 * re-verify, then POST the same decision again.
 *
 * Note the code is `step_up_stale`, not `step_up_required` — a fresh
 * step-up is the fix in both the "never verified" and "verified too long
 * ago" cases.
 */
export interface StepUpStaleError extends TradeControlErrorBody {
  readonly error_code: 'step_up_stale';
  readonly exposure_lamports: number;
}

/**
 * 409 `reauth_required` — the agent wallet's trading authorization does
 * not cover the conditional's lifetime. Proposal stays PENDING; refresh
 * the authorization and approve again. The server names the exact
 * refresh call in `refresh`.
 */
export interface ReauthRequiredError extends TradeControlErrorBody {
  readonly error_code: 'reauth_required';
  readonly reason: Open<'no_active_authorization' | 'authorization_revoked' | 'authorization_expires_too_soon'>;
  readonly wallet_account_id: string;
  /** `null` when there is no authorization to describe. */
  readonly authorization_expires_at_ms: number | null;
  readonly required_until_ms: number;
  readonly shortfall_ms: number | null;
  readonly refresh: {
    readonly method: Open<'POST'>;
    readonly path: string;
    readonly body: { readonly wallet_account_id: string };
  };
}

/** 409 `arm_check_failed` — arm-phase portfolio checks refused. */
export interface ArmCheckFailedError extends TradeControlErrorBody {
  readonly error_code: 'arm_check_failed';
  readonly failures: readonly unknown[];
}

/** 409 `decision_conflict` — already decided; `state` is the current one. */
export interface DecisionConflictError extends TradeControlErrorBody {
  readonly error_code: 'decision_conflict';
  readonly state: ProposalState;
}

/** 409 `proposal_expired` — the pending decision window closed. */
export interface ProposalExpiredError extends TradeControlErrorBody {
  readonly error_code: 'proposal_expired';
  readonly state: 'expired';
}

/** 409 `stale_revision` — a newer revision was approved first. */
export interface StaleRevisionError extends TradeControlErrorBody {
  readonly error_code: 'stale_revision';
  readonly current_proposal_id: string;
}

/** 409 `leg_immutable` — legs with claimed firings cannot be edited. */
export interface LegImmutableError extends TradeControlErrorBody {
  readonly error_code: 'leg_immutable';
  readonly legs: readonly number[];
}

/**
 * 409 `not_resumable` / `conditional_not_editable` / `exit_failed_terminal`
 * — all three carry the state.
 *
 * `exit_failed_terminal` (0189) is the one pause resume REFUSES: the core
 * gave up on a leg, and re-arming would hand back a plan that reads live
 * and protects nothing. Its `message` is written server-side to be shown
 * to the user as it stands.
 */
export interface ConditionalStateError extends TradeControlErrorBody {
  readonly error_code: 'not_resumable' | 'conditional_not_editable' | 'exit_failed_terminal';
  readonly state: ConditionalState;
}

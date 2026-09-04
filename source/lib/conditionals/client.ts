'use client';

/**
 * Typed client for the trade-control USER-FACING routes.
 *
 *   POST /api/trade/proposals                  create
 *   GET  /api/trade/proposals/:id              canonical proposal (source of truth)
 *   POST /api/trade/proposals/:id/decision     approve | decline (+ step-up, re-auth)
 *   GET  /api/trade/conditionals               list
 *   GET  /api/trade/conditionals/:id           detail
 *   GET  /api/trade/conditionals/:id/state     lifecycle + degradable DAG detail
 *   POST /api/trade/conditionals/:id/cancel
 *   POST /api/trade/conditionals/:id/resume
 *   POST /api/trade/conditionals/:id/notifications
 *
 * The `/internal/trade-control/**` operator routes are NOT here and must
 * never be added: they are service-auth'd and unreachable from product UI
 * by design.
 *
 * Conventions match the neighbouring terminal clients: `fetchAuthenticatedApi`
 * from `lib/api/trading` (same-origin or `NEXT_PUBLIC_TRADING_API_BASE`,
 * `credentials: 'include'`, optional Clerk bearer). No new data-fetching
 * library.
 *
 * ERROR DISCIPLINE: every function returns a discriminated `Result` —
 * nothing throws, nothing rejects, nothing is `any`, and no bare string is
 * ever thrown. Network faults and non-JSON bodies become `kind: 'network'`.
 *
 * AGENT-WALLET STATE: it is NOT served here. `GET /api/v1/me` carries the
 * user-level `provisioning.state` (`ready_to_trade` etc.) that gates agent
 * trading, and its wallet list deliberately EXCLUDES agent wallets
 * (`purpose <> 'agent'`). Use `lib/api/me` for that value and
 * `agentWalletReadiness()` from `./parse` to classify it. Readiness is never
 * inferred in the browser.
 */

import { fetchAuthenticatedApi, type AuthenticatedFetchOptions } from '../api/trading';
import { parseErrorBody } from './parse';
import { isConditionalNotificationMode, type ConditionalNotificationMode } from './types';
import type {
  ClassifierBlock,
  ConditionalDetail,
  ConditionalListQuery,
  ConditionalListResponse,
  ConditionalMutationResult,
  ConditionalStateResponse,
  ConditionalSummary,
  ConditionalSyncState,
  CreateProposalRequest,
  DecisionResult,
  ProposalCreated,
  ProposalDecision,
  ProposalDetail,
  TradeControlErrorBody,
} from './types';

/** The api refused with a structured trade-control error body. */
export interface TradeControlApiError {
  readonly kind: 'api';
  readonly status: number;
  readonly body: TradeControlErrorBody;
}

/**
 * The request never produced a usable body: transport failure, abort, or
 * a response that was not JSON (an html error page from a proxy, say).
 */
export interface TradeControlNetworkError {
  readonly kind: 'network';
  readonly reason: 'fetch_failed' | 'aborted' | 'invalid_json' | 'unexpected_shape';
  readonly message: string;
  /** Present when a response arrived but its body was unusable. */
  readonly status?: number;
}

export type TradeControlError = TradeControlApiError | TradeControlNetworkError;

export type TradeControlResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TradeControlError };

export interface TradeControlRequestOptions extends AuthenticatedFetchOptions {
  readonly timeoutMs?: number;
}

/** Narrowing helper for callers that branch on a specific `error_code`. */
export function isApiError(
  error: TradeControlError,
  code?: string,
): error is TradeControlApiError {
  return error.kind === 'api' && (code === undefined || error.body.error_code === code);
}

// ───────────────────────── transport ─────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

function ok<T>(value: T): TradeControlResult<T> {
  return { ok: true, value };
}

function fail<T>(error: TradeControlError): TradeControlResult<T> {
  return { ok: false, error };
}

/**
 * One request. Reads the body EXACTLY once, releases it on the paths that
 * do not need it (Chromium pins an unread body's mojo pipe until GC — the
 * same reason `lib/api/http.ts` cancels error bodies), and hands back a
 * discriminated result.
 *
 * `validate` is where forward compatibility lives: it must accept any
 * superset of the fields it needs and never inspect enum members.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  validate: (json: unknown) => T | null,
  options: TradeControlRequestOptions,
): Promise<TradeControlResult<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      path,
      { ...init, signal },
      { ...(options.authToken === undefined ? {} : { authToken: options.authToken }) },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return fail({
      kind: 'network',
      reason: aborted ? 'aborted' : 'fetch_failed',
      message: err instanceof Error ? err.message : 'fetch failed',
    });
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return fail({
      kind: 'network',
      reason: 'invalid_json',
      message: `http_${response.status} body was not json`,
      status: response.status,
    });
  }

  if (!response.ok) {
    return fail({ kind: 'api', status: response.status, body: parseErrorBody(json) });
  }

  const value = validate(json);
  if (value === null) {
    return fail({
      kind: 'network',
      reason: 'unexpected_shape',
      message: `http_${response.status} body did not match the expected shape`,
      status: response.status,
    });
  }
  return ok(value);
}

function getJson<T>(
  path: string,
  validate: (json: unknown) => T | null,
  options: TradeControlRequestOptions,
): Promise<TradeControlResult<T>> {
  return request(path, { method: 'GET' }, validate, options);
}

function postJson<T>(
  path: string,
  body: unknown,
  validate: (json: unknown) => T | null,
  options: TradeControlRequestOptions,
): Promise<TradeControlResult<T>> {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
    validate,
    options,
  );
}

// ───────────────────── shape guards (structural only) ─────────────────────
//
// Deliberately shallow: they check the fields the UI cannot render without,
// and NEVER check enum membership. A server that adds a state, a notice kind
// or a whole new field must keep passing these.

function asRecord(json: unknown): Record<string, unknown> | null {
  return typeof json === 'object' && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null;
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function validateProposalCreated(json: unknown): ProposalCreated | null {
  const record = asRecord(json);
  if (record === null) return null;
  if (!hasString(record, 'proposal_id') || !hasString(record, 'state')) return null;
  return record as unknown as ProposalCreated;
}

function validateProposalDetail(json: unknown): ProposalDetail | null {
  return validateProposalCreated(json) === null ? null : (json as ProposalDetail);
}

function validateDecisionResult(json: unknown): DecisionResult | null {
  const record = asRecord(json);
  if (record === null) return null;
  if (!hasString(record, 'proposal_id') || !hasString(record, 'state')) return null;
  return record as unknown as DecisionResult;
}

/**
 * Rows that are not objects are DROPPED, not fatal: one malformed row
 * must not blank the whole list.
 */
function validateConditionalList(json: unknown): ConditionalListResponse | null {
  const record = asRecord(json);
  if (record === null) return null;
  const rows = record['conditionals'];
  if (!Array.isArray(rows)) return null;
  const conditionals = rows.filter((row): row is ConditionalSummary => {
    const entry = asRecord(row);
    return entry !== null && hasString(entry, 'conditional_id') && hasString(entry, 'state');
  });
  return { conditionals };
}

function validateConditionalDetail(json: unknown): ConditionalDetail | null {
  const record = asRecord(json);
  if (record === null) return null;
  if (!hasString(record, 'conditional_id') || !hasString(record, 'state')) return null;
  if (!Array.isArray(record['legs']) || !Array.isArray(record['firings'])) return null;
  return record as unknown as ConditionalDetail;
}

/**
 * `detail` degrades independently (X§13). A missing or malformed `detail`
 * is normalised to `{detail_available: false}` so the lifecycle half still
 * renders — losing the event plane must not lose the timeline.
 */
function validateConditionalState(json: unknown): ConditionalStateResponse | null {
  const record = asRecord(json);
  if (record === null) return null;
  if (!hasString(record, 'conditional_id') || !hasString(record, 'state')) return null;
  const detail = asRecord(record['detail']);
  const detailOk = detail !== null && detail['detail_available'] === true;
  // The raw key is taken OFF the spread so a malformed block cannot ride through it.
  const { classifier: rawClassifier, sync: rawSync, ...rest } = record;
  const classifier = validateClassifierBlock(rawClassifier);
  const sync = validateSyncState(rawSync);
  return {
    ...(rest as unknown as ConditionalStateResponse),
    legs: Array.isArray(record['legs']) ? (record['legs'] as ConditionalStateResponse['legs']) : [],
    firings: Array.isArray(record['firings']) ? (record['firings'] as ConditionalStateResponse['firings']) : [],
    executions: Array.isArray(record['executions'])
      ? (record['executions'] as ConditionalStateResponse['executions'])
      : [],
    events: Array.isArray(record['events']) ? (record['events'] as ConditionalStateResponse['events']) : [],
    detail: detailOk
      ? (record['detail'] as ConditionalStateResponse['detail'])
      : { detail_available: false, reason: 'event_plane_unreachable' },
    ...(classifier === undefined ? {} : { classifier }),
    ...(sync === undefined ? {} : { sync }),
  };
}

/**
 * `sync` degrades on its own (CONTRACT-3 §B.1). Absent stays absent, a
 * served `null` (event plane unreachable) passes through, and an object
 * must carry the verdict and the platform version; a malformed one is
 * dropped to `undefined` rather than failing the route.
 */
function validateSyncState(json: unknown): ConditionalSyncState | null | undefined {
  if (json === null) return null;
  const record = asRecord(json);
  if (record === null) return undefined;
  if (typeof record['in_sync'] !== 'boolean' || typeof record['platform_version'] !== 'number') return undefined;
  return record as unknown as ConditionalSyncState;
}

/**
 * `classifier` degrades on its own too (CONTRACT §4). Absent stays absent
 * (`undefined` — an older api), an unavailable block passes through, and an
 * available block must carry a summary object and a candidates array; a
 * malformed one is dropped to `undefined` rather than failing the route.
 */
function validateClassifierBlock(json: unknown): ClassifierBlock | undefined {
  const record = asRecord(json);
  if (record === null) return undefined;
  if (record['available'] === false) return record as unknown as ClassifierBlock;
  if (record['available'] !== true) return undefined;
  if (asRecord(record['summary']) === null || !Array.isArray(record['candidates'])) return undefined;
  return record as unknown as ClassifierBlock;
}

function validateMutationResult(json: unknown): ConditionalMutationResult | null {
  const record = asRecord(json);
  if (record === null) return null;
  if (!hasString(record, 'conditional_id') || !hasString(record, 'state')) return null;
  return record as unknown as ConditionalMutationResult;
}

// ───────────────────────── proposals ─────────────────────────

/**
 * Create a proposal. `command_id` is the idempotency key: retrying the
 * same one returns the SAME proposal with `created: false`, so retries are
 * safe and never mint a second authorization.
 */
export function createProposal(
  body: CreateProposalRequest,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ProposalCreated>> {
  return postJson('/api/trade/proposals', body, validateProposalCreated, options);
}

/**
 * THE source of truth for a proposal card. Always fetch by id; never
 * render a proposal from a payload embedded in a chat message
 * (04-frontend.md invariant 1).
 *
 * `state` already has lazy expiry applied server-side, and `expires_at`
 * is the countdown anchor. `view` may be ABSENT when the server could not
 * render it — show the raw facts, not an error.
 */
export function fetchProposal(
  proposalId: string,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ProposalDetail>> {
  return getJson(`/api/trade/proposals/${encodeURIComponent(proposalId)}`, validateProposalDetail, options);
}

/**
 * Approve or decline. The interesting refusals, all leaving the proposal
 * PENDING and retryable after the user acts:
 *
 *   403 `step_up_stale`     → re-verify step-up, POST again (`StepUpStaleError`)
 *   409 `reauth_required`   → refresh the wallet authorization via the
 *                             `refresh` block the body names, then POST again
 *                             (`ReauthRequiredError`)
 *   409 `arm_check_failed`  → arm-phase portfolio checks refused
 *
 * And the terminal ones: 409 `decision_conflict` (already decided),
 * 409 `proposal_expired`, 409 `stale_revision`.
 *
 * A repeated identical decision is a 200 with `repeat: true`, not an
 * error — double-clicking approve is a no-op.
 */
export function decideProposal(
  proposalId: string,
  decision: ProposalDecision,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<DecisionResult>> {
  return postJson(
    `/api/trade/proposals/${encodeURIComponent(proposalId)}/decision`,
    { decision },
    validateDecisionResult,
    options,
  );
}

// ───────────────────────── conditionals ─────────────────────────

/** List the user's conditionals. Server clamps `limit` to 500 (default 100). */
export function listConditionals(
  query: ConditionalListQuery = {},
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ConditionalListResponse>> {
  const params = new URLSearchParams();
  if (query.state !== undefined && query.state.length > 0) params.set('state', query.state.join(','));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const search = params.toString();
  return getJson(
    `/api/trade/conditionals${search === '' ? '' : `?${search}`}`,
    validateConditionalList,
    options,
  );
}

/** Authorized definition + legs + firings, with the rendered `view` when available. */
export function fetchConditional(
  conditionalId: string,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ConditionalDetail>> {
  return getJson(
    `/api/trade/conditionals/${encodeURIComponent(conditionalId)}`,
    validateConditionalDetail,
    options,
  );
}

/**
 * Live lifecycle: legs, firings, executions and the ordered event
 * timeline, plus DAG `detail` from the event cluster. `detail` degrades
 * on its own — check `detail.detail_available` before reading it.
 */
export function fetchConditionalState(
  conditionalId: string,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ConditionalStateResponse>> {
  return getJson(
    `/api/trade/conditionals/${encodeURIComponent(conditionalId)}/state`,
    validateConditionalState,
    options,
  );
}

/** Cancel. 409 `not_resumable`-style bodies carry the current `state`. */
export function cancelConditional(
  conditionalId: string,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ConditionalMutationResult>> {
  return postJson(
    `/api/trade/conditionals/${encodeURIComponent(conditionalId)}/cancel`,
    {},
    validateMutationResult,
    options,
  );
}

/**
 * Resume a paused conditional. Already-armed answers 200 with
 * `repeat: true`; a non-resumable state answers 409 `not_resumable` with
 * the current `state` on the body.
 */
export function resumeConditional(
  conditionalId: string,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<ConditionalMutationResult>> {
  return postJson(
    `/api/trade/conditionals/${encodeURIComponent(conditionalId)}/resume`,
    {},
    validateMutationResult,
    options,
  );
}

/**
 * THE PER-ORDER BELL. `mode` is the same three positions the global per-tier
 * control uses, plus `inherit` — the DEFAULT, which deletes the override and
 * follows the user's tier settings.
 *
 * `off` stops inbox rows for this plan only. It never loses history: the
 * plan's own Activity tab reads the lifecycle journal directly and stays
 * complete whatever this says.
 */
export function setConditionalNotificationMode(
  conditionalId: string,
  mode: ConditionalNotificationMode,
  options: TradeControlRequestOptions = {},
): Promise<TradeControlResult<{ conditional_id: string; mode: ConditionalNotificationMode }>> {
  return postJson(
    `/api/trade/conditionals/${encodeURIComponent(conditionalId)}/notifications`,
    { mode },
    (json) => {
      if (typeof json !== 'object' || json === null) return null;
      const record = json as Record<string, unknown>;
      const id = record['conditional_id'];
      const served = record['mode'];
      if (typeof id !== 'string') return null;
      return {
        conditional_id: id,
        mode: isConditionalNotificationMode(served) ? served : mode,
      };
    },
    options,
  );
}

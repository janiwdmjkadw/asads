/**
 * Pure parsers for the four agent-wallet responses.
 *
 * Nothing here throws and nothing here decides anything: the server's
 * booleans (`ready_to_trade`, `sufficient`, `complete`, `created`,
 * `revoked`) are carried across verbatim. The only judgement these
 * functions make is "did the body have the shape at all", and the only
 * transformation is snake_case -> camelCase.
 *
 * Enum members are narrowed via {@link enumValue}, which keeps the raw
 * string when the member is unrecognised. A future server enum therefore
 * degrades to an explicit "unrecognised" rendering instead of being
 * coerced into whichever member happens to be first.
 *
 * Fail-closed: a body we cannot read becomes a `shape_mismatch` error,
 * never a partially-populated wallet. A half-parsed agent wallet would
 * be indistinguishable from a real one that is missing capabilities.
 */

import {
  READINESS_BLOCKERS,
  type AgentWalletCreated,
  type AgentWalletDelegation,
  type AgentWalletGrantPayload,
  type AgentWalletResult,
  type AgentWalletRevokePayload,
  type AgentWalletStatus,
  type AgentWalletStatusPayload,
  type BalanceSource,
  type DelegationMode,
  type DelegationState,
  type EnumValue,
  type FundingState,
  type ReadinessBlocker,
  type ReauthReason,
} from './types';

const FUNDING_STATES: readonly FundingState[] = ['unknown', 'unfunded', 'insufficient', 'funded'];
const BALANCE_SOURCES: readonly BalanceSource[] = ['rpc', 'unavailable'];
const DELEGATION_STATES: readonly DelegationState[] = ['active', 'paused', 'revoked'];
const DELEGATION_MODES: readonly DelegationMode[] = ['session', 'durable', 'none'];
export const REAUTH_REASONS: readonly ReauthReason[] = [
  'no_session',
  'session_expired',
  'session_invalid',
];

/** Narrow `raw` against `members`, preserving it either way. */
export function enumValue<T extends string>(raw: unknown, members: readonly T[]): EnumValue<T> {
  const text = typeof raw === 'string' ? raw : '';
  const known = (members as readonly string[]).includes(text) ? (text as T) : null;
  return { known, raw: text };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function intList(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is number => typeof x === 'number' && Number.isInteger(x));
}

function shapeMismatch<T>(): AgentWalletResult<T> {
  return { kind: 'error', errorCode: 'shape_mismatch', message: 'unexpected response shape' };
}

/**
 * The `{reauth_required:true}` / `{error_code}` prefix every route
 * shares. Returns `null` when the body is neither, i.e. when the caller
 * should go on to parse its own success shape.
 */
function parseEnvelope<T>(json: Record<string, unknown>): AgentWalletResult<T> | null {
  if (json['reauth_required'] === true) {
    return { kind: 'reauth', reason: enumValue(json['reason'], REAUTH_REASONS) };
  }
  const code = str(json['error_code']);
  if (code !== null) {
    return {
      kind: 'error',
      errorCode: code,
      message: nullableStr(json['message']) ?? 'request failed',
    };
  }
  return null;
}

export function parseDelegation(value: unknown): AgentWalletDelegation | null {
  const d = record(value);
  if (d === null) return null;
  return {
    state: enumValue(d['state'], DELEGATION_STATES),
    mode: enumValue(d['mode'], DELEGATION_MODES),
    grantedAt: nullableStr(d['granted_at']),
    revokedAt: nullableStr(d['revoked_at']),
    authorizationExpiresAt: nullableStr(d['authorization_expires_at']),
  };
}

function parseAgentWallet(value: unknown): AgentWalletStatus | null {
  const w = record(value);
  if (w === null) return null;

  const walletAccountId = str(w['wallet_account_id']);
  const walletPubkey = str(w['wallet_pubkey']);
  const fundingAddress = str(w['funding_address']);
  const status = str(w['status']);
  const isEnabled = bool(w['is_enabled']);
  const isArchived = bool(w['is_archived']);
  if (
    walletAccountId === null ||
    walletPubkey === null ||
    fundingAddress === null ||
    status === null ||
    isEnabled === null ||
    isArchived === null
  ) {
    return null;
  }

  const balance = record(w['balance']);
  const funding = record(w['funding']);
  const noncePool = record(w['nonce_pool']);
  const delegation = parseDelegation(w['delegation']);
  const readiness = record(w['readiness']);
  if (
    balance === null ||
    funding === null ||
    noncePool === null ||
    delegation === null ||
    readiness === null
  ) {
    return null;
  }

  const requiredLamports = nullableStr(funding['required_lamports']);
  const sufficient = bool(funding['sufficient']);
  const targetCount = intOrNull(noncePool['target_count']);
  const activeCount = intOrNull(noncePool['active_count']);
  const complete = bool(noncePool['complete']);
  // The server's boolean, read once and never re-derived. Absent or
  // non-boolean fails closed to `false`: a UI that shows "ready" because
  // a field went missing is the exact failure this gate exists to stop.
  const readyToTrade = bool(readiness['ready_to_trade']) ?? false;
  if (
    requiredLamports === null ||
    sufficient === null ||
    targetCount === null ||
    activeCount === null ||
    complete === null
  ) {
    return null;
  }

  const blockersRaw = Array.isArray(readiness['blockers']) ? readiness['blockers'] : [];

  return {
    walletAccountId,
    walletPubkey,
    fundingAddress,
    status,
    isEnabled,
    isArchived,
    balance: {
      lamports: nullableStr(balance['lamports']),
      commitment: nullableStr(balance['commitment']) ?? 'confirmed',
      source: enumValue(balance['source'], BALANCE_SOURCES),
    },
    funding: {
      state: enumValue(funding['state'], FUNDING_STATES),
      requiredLamports,
      sufficient,
    },
    noncePool: {
      targetCount,
      activeCount,
      missingSlots: intList(noncePool['missing_slots']),
      failedSlots: intList(noncePool['failed_slots']),
      disabledSlots: intList(noncePool['disabled_slots']),
      complete,
    },
    delegation,
    readiness: {
      readyToTrade,
      blockers: blockersRaw.map(
        (b): EnumValue<ReadinessBlocker> => enumValue(b, READINESS_BLOCKERS),
      ),
    },
  };
}

export function parseStatusResponse(json: unknown): AgentWalletResult<AgentWalletStatusPayload> {
  const body = record(json);
  if (body === null) return shapeMismatch();
  const envelope = parseEnvelope<AgentWalletStatusPayload>(body);
  if (envelope !== null) return envelope;

  const provisioningState = str(body['provisioning_state']);
  if (provisioningState === null || !('agent_wallet' in body)) return shapeMismatch();

  const raw = body['agent_wallet'];
  if (raw === null) {
    return { kind: 'ok', value: { provisioningState, agentWallet: null } };
  }
  const agentWallet = parseAgentWallet(raw);
  if (agentWallet === null) return shapeMismatch();
  return { kind: 'ok', value: { provisioningState, agentWallet } };
}

export function parseCreateResponse(json: unknown): AgentWalletResult<AgentWalletCreated> {
  const body = record(json);
  if (body === null) return shapeMismatch();
  const envelope = parseEnvelope<AgentWalletCreated>(body);
  if (envelope !== null) return envelope;

  const w = record(body['agent_wallet']);
  if (w === null) return shapeMismatch();
  const walletAccountId = str(w['wallet_account_id']);
  const walletPubkey = str(w['wallet_pubkey']);
  const fundingAddress = str(w['funding_address']);
  const created = bool(w['created']);
  if (
    walletAccountId === null ||
    walletPubkey === null ||
    fundingAddress === null ||
    created === null
  ) {
    return shapeMismatch();
  }
  return { kind: 'ok', value: { walletAccountId, walletPubkey, fundingAddress, created } };
}

export function parseRevokeResponse(json: unknown): AgentWalletResult<AgentWalletRevokePayload> {
  const body = record(json);
  if (body === null) return shapeMismatch();
  const envelope = parseEnvelope<AgentWalletRevokePayload>(body);
  if (envelope !== null) return envelope;

  const revoked = bool(body['revoked']);
  const delegation = parseDelegation(body['delegation']);
  if (revoked === null || delegation === null) return shapeMismatch();
  return { kind: 'ok', value: { revoked, delegation } };
}

/**
 * The grant response, which is revoke's mirror image. `step_up_required`
 * arrives here as an ordinary `error_code` via {@link parseEnvelope} —
 * the card renders it as "start over", not as a fault, because a
 * challenge expiring after two minutes is a normal thing to happen.
 */
export function parseGrantResponse(json: unknown): AgentWalletResult<AgentWalletGrantPayload> {
  const body = record(json);
  if (body === null) return shapeMismatch();
  const envelope = parseEnvelope<AgentWalletGrantPayload>(body);
  if (envelope !== null) return envelope;

  const granted = bool(body['granted']);
  const delegation = parseDelegation(body['delegation']);
  if (granted === null || delegation === null) return shapeMismatch();
  return { kind: 'ok', value: { granted, delegation } };
}

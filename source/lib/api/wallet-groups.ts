'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Portfolio page wallets tab": fetch client for the
 * server-persisted wallet-Groups endpoints.
 *
 *   GET    /api/v1/wallets/groups
 *   POST   /api/v1/wallets/groups
 *   PATCH  /api/v1/wallets/groups/:group_id
 *   DELETE /api/v1/wallets/groups/:group_id
 *
 * Same defensive parser + tagged-union pattern as
 * `terminal/lib/api/wallets.ts` and `terminal/lib/api/orders.ts`:
 * every server branch maps to a discrete `kind` so the React-query
 * mutation handlers can pattern-match without re-narrowing.
 */

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface WalletGroup {
  readonly id: string;
  readonly name: string;
  readonly display_order: number;
  readonly wallet_account_ids: ReadonlyArray<string>;
  readonly created_at: string;
  readonly updated_at: string;
}

export type WalletGroupsListResult =
  | { kind: 'ok'; groups: ReadonlyArray<WalletGroup> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export type WalletGroupMutationResult =
  | { kind: 'ok'; group: WalletGroup }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'invalid_input'; reason: string }
  | {
      kind: 'error';
      status: number;
      errorCode: string;
      message: string;
    }
  | { kind: 'network_error'; reason: string };

export type WalletGroupDeleteResult =
  | { kind: 'ok' }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseGroup(raw: unknown): WalletGroup | null {
  if (!isObject(raw)) return null;
  const id = raw['id'];
  const name = raw['name'];
  const displayOrder = raw['display_order'];
  const walletAccountIds = raw['wallet_account_ids'];
  const createdAt = raw['created_at'];
  const updatedAt = raw['updated_at'];
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof displayOrder !== 'number' ||
    !Array.isArray(walletAccountIds) ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }
  const ids: string[] = [];
  for (const v of walletAccountIds) {
    if (typeof v === 'string') ids.push(v);
  }
  return {
    id,
    name,
    display_order: Math.max(0, Math.floor(displayOrder)),
    wallet_account_ids: Object.freeze(ids),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function parseReauth(
  raw: unknown,
): { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' } | null {
  if (!isObject(raw)) return null;
  if (raw['reauth_required'] !== true) return null;
  const r = raw['reason'];
  const reason: 'no_session' | 'session_expired' | 'session_invalid' =
    r === 'no_session' || r === 'session_expired' || r === 'session_invalid'
      ? r
      : 'session_invalid';
  return { kind: 'reauth', reason };
}

function parseError(
  raw: unknown,
  status: number,
): { kind: 'error'; status: number; errorCode: string; message: string } | null {
  if (!isObject(raw)) return null;
  const errorCode = raw['error_code'];
  if (typeof errorCode !== 'string') return null;
  const message = typeof raw['message'] === 'string' ? (raw['message'] as string) : 'request failed';
  return { kind: 'error', status, errorCode, message };
}

export interface ListGroupsOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

export async function listWalletGroups(
  options: ListGroupsOptions = {},
): Promise<WalletGroupsListResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets/groups',
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const reauth = parseReauth(json);
  if (reauth) return reauth;
  if (res.ok && json['reauth_required'] === false) {
    const groupsRaw = json['groups'];
    if (!Array.isArray(groupsRaw)) {
      return {
        kind: 'error',
        status: res.status,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
      };
    }
    const groups: WalletGroup[] = [];
    for (const g of groupsRaw) {
      const parsed = parseGroup(g);
      if (parsed) groups.push(parsed);
    }
    return { kind: 'ok', groups: Object.freeze(groups) };
  }
  const err = parseError(json, res.status);
  return (
    err ?? {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    }
  );
}

export interface CreateGroupInput {
  readonly name: string;
  readonly walletAccountIds: ReadonlyArray<string>;
  readonly displayOrder?: number;
}

export async function createWalletGroup(
  input: CreateGroupInput,
  options: ListGroupsOptions = {},
): Promise<WalletGroupMutationResult> {
  if (input.name.length === 0 || input.name.length > 64) {
    return { kind: 'invalid_input', reason: 'name must be 1..64 chars' };
  }
  if (input.walletAccountIds.length === 0) {
    return { kind: 'invalid_input', reason: 'at least one wallet_account_id is required' };
  }
  if (input.walletAccountIds.length > 128) {
    return { kind: 'invalid_input', reason: 'a group can have at most 128 wallets' };
  }
  for (const id of input.walletAccountIds) {
    if (!UUID_REGEX.test(id)) {
      return { kind: 'invalid_input', reason: 'wallet_account_id must be a UUID' };
    }
  }
  const seen = new Set<string>();
  for (const id of input.walletAccountIds) {
    if (seen.has(id)) {
      return { kind: 'invalid_input', reason: 'duplicate wallet_account_id' };
    }
    seen.add(id);
  }
  const body: Record<string, unknown> = {
    name: input.name,
    wallet_account_ids: [...input.walletAccountIds],
  };
  if (input.displayOrder !== undefined) body['display_order'] = input.displayOrder;
  return submitMutation('POST', '/api/v1/wallets/groups', body, options);
}

export interface UpdateGroupInput {
  readonly groupId: string;
  readonly name?: string;
  readonly walletAccountIds?: ReadonlyArray<string>;
  readonly displayOrder?: number;
}

export async function updateWalletGroup(
  input: UpdateGroupInput,
  options: ListGroupsOptions = {},
): Promise<WalletGroupMutationResult> {
  if (!UUID_REGEX.test(input.groupId)) {
    return { kind: 'invalid_input', reason: 'groupId must be a UUID' };
  }
  if (
    input.name === undefined &&
    input.walletAccountIds === undefined &&
    input.displayOrder === undefined
  ) {
    return { kind: 'invalid_input', reason: 'no fields supplied to update' };
  }
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (input.name.length === 0 || input.name.length > 64) {
      return { kind: 'invalid_input', reason: 'name must be 1..64 chars' };
    }
    body['name'] = input.name;
  }
  if (input.displayOrder !== undefined) body['display_order'] = input.displayOrder;
  if (input.walletAccountIds !== undefined) {
    if (input.walletAccountIds.length === 0) {
      return { kind: 'invalid_input', reason: 'wallet_account_ids must not be empty' };
    }
    if (input.walletAccountIds.length > 128) {
      return { kind: 'invalid_input', reason: 'a group can have at most 128 wallets' };
    }
    const seen = new Set<string>();
    for (const id of input.walletAccountIds) {
      if (!UUID_REGEX.test(id)) {
        return { kind: 'invalid_input', reason: 'wallet_account_id must be a UUID' };
      }
      if (seen.has(id)) {
        return { kind: 'invalid_input', reason: 'duplicate wallet_account_id' };
      }
      seen.add(id);
    }
    body['wallet_account_ids'] = [...input.walletAccountIds];
  }
  return submitMutation(
    'PATCH',
    `/api/v1/wallets/groups/${encodeURIComponent(input.groupId)}`,
    body,
    options,
  );
}

export async function deleteWalletGroup(
  groupId: string,
  options: ListGroupsOptions = {},
): Promise<WalletGroupDeleteResult> {
  if (!UUID_REGEX.test(groupId)) {
    return {
      kind: 'error',
      status: 400,
      errorCode: 'invalid_input',
      message: 'groupId must be a UUID',
    };
  }
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      `/api/v1/wallets/groups/${encodeURIComponent(groupId)}`,
      { method: 'DELETE' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const reauth = parseReauth(json);
  if (reauth) return reauth;
  if (res.ok && json['reauth_required'] === false && json['deleted'] === true) {
    return { kind: 'ok' };
  }
  const err = parseError(json, res.status);
  return (
    err ?? {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    }
  );
}

async function submitMutation(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  options: ListGroupsOptions,
): Promise<WalletGroupMutationResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      path,
      {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const reauth = parseReauth(json);
  if (reauth) return reauth;
  if (res.ok && json['reauth_required'] === false) {
    const parsed = parseGroup(json['group']);
    if (!parsed) {
      return {
        kind: 'error',
        status: res.status,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
      };
    }
    return { kind: 'ok', group: parsed };
  }
  const err = parseError(json, res.status);
  return (
    err ?? {
      kind: 'error',
      status: res.status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    }
  );
}

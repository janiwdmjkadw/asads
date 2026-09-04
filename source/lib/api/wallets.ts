'use client';

import { fetchAuthenticatedApi } from './trading';
import type { MeWalletEntry } from './me';
import { requestSensitiveActionChallenge } from './sensitive-action';
import { checkEvmWithdrawalDestination } from './evm-destination-check';

/**
 * Slice "Terminal wallet selector": `POST /api/v1/wallets` client.
 *
 * Creates a new Solana wallet under the user's Turnkey sub-org. The
 * api/ proxies the actual Turnkey activity through `trading/`'s
 * `/internal/wallet/create`; we never see private key material.
 *
 * `GET /api/v1/wallets` is intentionally NOT wrapped here — the
 * Terminal reads the list off `/me.wallets[]` (same shape, single
 * round-trip) and only POSTs when the user explicitly creates a
 * wallet.
 *
 * Result is a tagged union mirroring `wallet-export.ts` so callers
 * can pattern-match without try/catch.
 */

export interface CreateWalletInput {
  /**
   * Optional user-facing label, 1..40 chars, no control characters.
   * The api/ Ajv schema rejects strings outside the allow-list so
   * we do not validate length here — a defensive trim happens
   * before submit so a stray newline doesn't surprise the user.
   */
  label?: string;
}

export interface ApiWalletWire {
  readonly wallet_account_id: string;
  readonly turnkey_wallet_id: string;
  readonly turnkey_wallet_account_id: string;
  readonly label: string | null;
  readonly wallet_pubkey: string;
  readonly chain: 'solana';
  readonly status: string;
  readonly is_primary: boolean;
  readonly is_enabled: boolean;
  readonly is_archived: boolean;
  readonly display_order: number;
  readonly backup_confirmed_at: string | null;
  readonly nonce_setup: {
    readonly required: boolean;
    readonly target_count: number;
    readonly active_count: number;
  };
  readonly trading_authorization: {
    readonly expires_at: string | null;
  };
  readonly trade_ready: boolean;
}

export type CreateWalletResult =
  | { kind: 'ok'; wallet: ApiWalletWire }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export interface CreateWalletOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensive parser for the `wallet` object returned on success. The
 * api/ Ajv schema is the authoritative gate; this re-narrowing keeps
 * the Terminal honest when a rolling deploy returns a missing field.
 */
function parseApiWallet(raw: unknown): ApiWalletWire | null {
  if (!isObject(raw)) return null;
  const walletAccountId = raw['wallet_account_id'];
  const turnkeyWalletId = raw['turnkey_wallet_id'];
  const turnkeyWalletAccountId = raw['turnkey_wallet_account_id'];
  const label = raw['label'];
  const walletPubkey = raw['wallet_pubkey'];
  const chain = raw['chain'];
  const status = raw['status'];
  const isPrimary = raw['is_primary'];
  const isEnabled = raw['is_enabled'];
  const isArchived = raw['is_archived'];
  const displayOrder = raw['display_order'];
  const backupConfirmedAt = raw['backup_confirmed_at'];
  const nonceSetup = raw['nonce_setup'];
  const tradingAuthorization = raw['trading_authorization'];
  const tradeReady = raw['trade_ready'];
  if (
    typeof walletAccountId !== 'string' ||
    typeof turnkeyWalletId !== 'string' ||
    typeof turnkeyWalletAccountId !== 'string' ||
    typeof walletPubkey !== 'string' ||
    chain !== 'solana' ||
    typeof status !== 'string' ||
    typeof isPrimary !== 'boolean' ||
    typeof isEnabled !== 'boolean' ||
    typeof isArchived !== 'boolean' ||
    typeof displayOrder !== 'number' ||
    !isObject(nonceSetup)
  ) {
    return null;
  }
  const labelTyped = label === null || typeof label === 'string' ? label : null;
  const backupTyped =
    typeof backupConfirmedAt === 'string'
      ? backupConfirmedAt
      : backupConfirmedAt === null
        ? null
        : null;
  const required = nonceSetup['required'];
  const targetCount = nonceSetup['target_count'];
  const activeCount = nonceSetup['active_count'];
  const expiresAt =
    isObject(tradingAuthorization) &&
    (typeof tradingAuthorization['expires_at'] === 'string' ||
      tradingAuthorization['expires_at'] === null)
      ? tradingAuthorization['expires_at']
      : null;
  if (
    typeof required !== 'boolean' ||
    typeof targetCount !== 'number' ||
    typeof activeCount !== 'number'
  ) {
    return null;
  }
  return {
    wallet_account_id: walletAccountId,
    turnkey_wallet_id: turnkeyWalletId,
    turnkey_wallet_account_id: turnkeyWalletAccountId,
    label: labelTyped,
    wallet_pubkey: walletPubkey,
    chain: 'solana',
    status,
    is_primary: isPrimary,
    is_enabled: isEnabled,
    is_archived: isArchived,
    display_order: Math.max(0, Math.floor(displayOrder)),
    backup_confirmed_at: backupTyped,
    nonce_setup: {
      required,
      target_count: Math.max(0, Math.floor(targetCount)),
      active_count: Math.max(0, Math.floor(activeCount)),
    },
    trading_authorization: { expires_at: expiresAt },
    trade_ready: typeof tradeReady === 'boolean' ? tradeReady : false,
  };
}

function parseRetryAfterMs(json: Record<string, unknown>): number | null {
  const raw = json['retry_after_ms'];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return null;
}

/**
 * Pure response parser. Exported for unit tests so the branch table
 * is exercised without spinning up `fetch`.
 */
export function parseCreateWalletResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): CreateWalletResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
        ? raw
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    if (errorCodeRaw === 'wallet_create_rate_limited' || httpStatus === 429) {
      return {
        kind: 'rate_limited',
        retryAfterMs: parseRetryAfterMs(json),
      };
    }
    const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: errorCodeRaw,
      message,
    };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const wallet = parseApiWallet(json['wallet']);
    if (wallet) return { kind: 'ok', wallet };
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    };
  }
  return {
    kind: 'error',
    status: httpStatus,
    errorCode: 'shape_mismatch',
    message: 'unexpected response shape',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Slice "Per-wallet positions / fills + wallet management UI": PATCH
// client. Same defensive parser + tagged-union pattern as createWallet.
// ─────────────────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface PatchWalletInput {
  readonly walletAccountId: string;
  /** `null` clears the label; `undefined` leaves it unchanged. */
  readonly label?: string | null;
  readonly isPrimary?: boolean;
  readonly isArchived?: boolean;
  readonly isEnabled?: boolean;
  readonly displayOrder?: number;
}

/**
 * Every typed error the api/ route can return. See
 * `api/src/routes/wallets/errors.ts` and the patch route's
 * docblock; the union is exhaustive. `wallet_not_found` is the
 * defensive race-only branch. `error` is the open-ended catch-all
 * for forward-compat (e.g. new server error codes).
 */
export type PatchWalletErrorCode =
  | 'wallet_patch_empty'
  | 'wallet_label_invalid'
  | 'wallet_patch_conflicting_fields'
  | 'wallet_not_owned_by_user'
  | 'wallet_not_found'
  | 'wallet_cannot_archive_primary'
  | 'wallet_cannot_archive_only_active'
  | 'wallet_cannot_promote_archived_or_disabled';

export type PatchWalletResult =
  | { kind: 'ok'; wallet: ApiWalletWire }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | {
      kind: 'error';
      status: number;
      errorCode: PatchWalletErrorCode | string;
      message: string;
    }
  | { kind: 'network_error'; reason: string }
  | { kind: 'invalid_input'; reason: string };

export interface PatchWalletOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

interface PatchWalletWireBody {
  label?: string | null;
  is_primary?: boolean;
  is_archived?: boolean;
  is_enabled?: boolean;
  display_order?: number;
}

function buildPatchBody(input: PatchWalletInput): PatchWalletWireBody {
  const body: PatchWalletWireBody = {};
  if (input.label !== undefined) {
    body.label = input.label === null ? null : input.label.normalize('NFC').trim();
  }
  if (input.isPrimary !== undefined) body.is_primary = input.isPrimary;
  if (input.isArchived !== undefined) body.is_archived = input.isArchived;
  if (input.isEnabled !== undefined) body.is_enabled = input.isEnabled;
  if (input.displayOrder !== undefined) {
    body.display_order = Math.max(0, Math.floor(input.displayOrder));
  }
  return body;
}

export function parsePatchWalletResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): PatchWalletResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
        ? raw
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
    return { kind: 'error', status: httpStatus, errorCode: errorCodeRaw, message };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const wallet = parseApiWallet(json['wallet']);
    if (wallet) return { kind: 'ok', wallet };
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    };
  }
  return {
    kind: 'error',
    status: httpStatus,
    errorCode: 'shape_mismatch',
    message: 'unexpected response shape',
  };
}

export async function patchWallet(
  input: PatchWalletInput,
  options: PatchWalletOptions = {},
): Promise<PatchWalletResult> {
  if (!UUID_REGEX.test(input.walletAccountId)) {
    return {
      kind: 'invalid_input',
      reason: 'wallet_account_id must be a UUID',
    };
  }
  const body = buildPatchBody(input);
  if (Object.keys(body).length === 0) {
    return {
      kind: 'invalid_input',
      reason: 'no_updatable_fields',
    };
  }
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      `/api/v1/wallets/${input.walletAccountId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parsePatchWalletResponse(json, res.status);
}

// ─────────────────────────────────────────────────────────────────────
// Slice "Wallet-to-wallet SOL funding": `transferSol` client. The
// route is gated server-side by `WALLET_TRANSFER_ENABLED`; the
// Terminal also gates the UI surface behind
// `NEXT_PUBLIC_TERMINAL_WALLET_TRANSFER_ENABLED`. Tagged-union
// result mirrors `patchWallet` so the caller can pattern-match
// every outcome (`ok`, `reauth`, `in_flight`, `insufficient_balance`,
// typed `error`, `network_error`, `invalid_input`).
// ─────────────────────────────────────────────────────────────────────

const POSITIVE_INT_REGEX = /^[1-9][0-9]*$/;

export interface TransferSolDestination {
  readonly walletAccountId: string;
  /** Decimal string of positive lamports. */
  readonly lamports: string;
}

export interface TransferSolInput {
  readonly sourceWalletAccountId: string;
  readonly clientTransferId: string;
  readonly destinations: ReadonlyArray<TransferSolDestination>;
}

export interface TransferSolIntentDestination {
  readonly destination_wallet_account_id: string;
  readonly destination_wallet_pubkey: string;
  readonly lamports: string;
  readonly ordinal: number;
}

export interface TransferSolIntentSnapshot {
  readonly id: string;
  readonly status: 'reserved' | 'submitted' | 'confirmed' | 'failed';
  readonly total_lamports: string;
  readonly source_wallet_account_id: string;
  readonly signature: string | null;
  readonly slot: number | null;
  readonly terminal_at: string | null;
  readonly transfers: ReadonlyArray<TransferSolIntentDestination>;
}

export type TransferSolErrorCode =
  | 'wallet_transfer_self'
  | 'wallet_not_owned_by_user'
  | 'wallet_chain_unsupported'
  | 'wallet_archived'
  | 'wallet_account_disabled'
  | 'insufficient_balance'
  | 'transfer_in_flight'
  | 'transfer_no_nonce_available'
  | 'no_active_authorization'
  | 'signer_material_missing'
  | 'verifier_rejected'
  | 'wallet_transfer_disabled'
  | 'wallet_transfer_rpc_unavailable'
  | 'wallet_transfer_rpc_failed'
  | 'trading_engine_timeout'
  | 'trading_engine_unavailable'
  | 'trading_engine_shape_invalid'
  | 'turnkey_policy_rejected'
  | 'turnkey_sign_timeout'
  | 'too_many_destinations'
  | 'invalid_lamports'
  | 'invalid_split'
  | 'source_remainder_below_rent_min'
  | 'client_transfer_id_reused'
  | 'transfer_needs_reconcile';

export type TransferSolResult =
  | { kind: 'ok'; intent: TransferSolIntentSnapshot }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'in_flight'; intentId: string }
  | { kind: 'insufficient_balance'; observedLamports: string; requiredLamports: string }
  /**
   * Engine timeout/unavailable: the transfer was dispatched but its outcome
   * is UNKNOWN — it may still land on-chain. NOT a failure; the intent stays
   * non-terminal server-side and recovers via the expiry path. The UI must
   * tell the user to wait/check, never to retry immediately.
   */
  | { kind: 'pending_unconfirmed'; intentId: string | null }
  | {
      kind: 'error';
      status: number;
      errorCode: TransferSolErrorCode | string;
      message: string;
      intentId: string | null;
    }
  | { kind: 'network_error'; reason: string }
  | { kind: 'invalid_input'; reason: string };

export interface TransferSolOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

function parseIntentDestination(raw: unknown): TransferSolIntentDestination | null {
  if (!isObject(raw)) return null;
  const dwa = raw['destination_wallet_account_id'];
  const dwp = raw['destination_wallet_pubkey'];
  const lamports = raw['lamports'];
  const ordinal = raw['ordinal'];
  if (
    typeof dwa !== 'string' ||
    typeof dwp !== 'string' ||
    typeof lamports !== 'string' ||
    typeof ordinal !== 'number'
  ) {
    return null;
  }
  return {
    destination_wallet_account_id: dwa,
    destination_wallet_pubkey: dwp,
    lamports,
    ordinal: Math.max(0, Math.floor(ordinal)),
  };
}

function parseIntentSnapshot(raw: unknown): TransferSolIntentSnapshot | null {
  if (!isObject(raw)) return null;
  const id = raw['id'];
  const status = raw['status'];
  const totalLamports = raw['total_lamports'];
  const sourceWalletAccountId = raw['source_wallet_account_id'];
  const signature = raw['signature'];
  const slot = raw['slot'];
  const terminalAt = raw['terminal_at'];
  const transfersRaw = raw['transfers'];
  if (
    typeof id !== 'string' ||
    (status !== 'reserved' &&
      status !== 'submitted' &&
      status !== 'confirmed' &&
      status !== 'failed') ||
    typeof totalLamports !== 'string' ||
    typeof sourceWalletAccountId !== 'string' ||
    !Array.isArray(transfersRaw)
  ) {
    return null;
  }
  const transfers: TransferSolIntentDestination[] = [];
  for (const t of transfersRaw) {
    const parsed = parseIntentDestination(t);
    if (parsed) transfers.push(parsed);
  }
  return {
    id,
    status,
    total_lamports: totalLamports,
    source_wallet_account_id: sourceWalletAccountId,
    signature: typeof signature === 'string' ? signature : signature === null ? null : null,
    slot: typeof slot === 'number' ? Math.max(0, Math.floor(slot)) : slot === null ? null : null,
    terminal_at:
      typeof terminalAt === 'string' ? terminalAt : terminalAt === null ? null : null,
    transfers,
  };
}

/**
 * Pure parser. Exported for unit tests so the branch table is
 * exercised without `fetch`.
 */
export function parseTransferSolResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): TransferSolResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
        ? raw
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
    const intentIdRaw = json['intent_id'];
    const intentId = typeof intentIdRaw === 'string' ? intentIdRaw : null;
    if (errorCodeRaw === 'transfer_in_flight' && typeof intentIdRaw === 'string') {
      return { kind: 'in_flight', intentId: intentIdRaw };
    }
    if (errorCodeRaw === 'transfer_pending_unconfirmed') {
      return { kind: 'pending_unconfirmed', intentId };
    }
    if (errorCodeRaw === 'insufficient_balance') {
      const observed = json['observed_lamports'];
      const required = json['required_lamports'];
      if (typeof observed === 'string' && typeof required === 'string') {
        return {
          kind: 'insufficient_balance',
          observedLamports: observed,
          requiredLamports: required,
        };
      }
    }
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: errorCodeRaw,
      message,
      intentId,
    };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const intent = parseIntentSnapshot(json['intent']);
    if (intent) return { kind: 'ok', intent };
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
      intentId: null,
    };
  }
  return {
    kind: 'error',
    status: httpStatus,
    errorCode: 'shape_mismatch',
    message: 'unexpected response shape',
    intentId: null,
  };
}

interface TransferSolWireBody {
  source_wallet_account_id: string;
  client_transfer_id: string;
  transfers: Array<{ destination_wallet_account_id: string; lamports: string }>;
}

export async function transferSol(
  input: TransferSolInput,
  options: TransferSolOptions = {},
): Promise<TransferSolResult> {
  if (!UUID_REGEX.test(input.sourceWalletAccountId)) {
    return { kind: 'invalid_input', reason: 'source_wallet_account_id must be a UUID' };
  }
  if (
    typeof input.clientTransferId !== 'string' ||
    input.clientTransferId.length === 0 ||
    input.clientTransferId.length > 128
  ) {
    return { kind: 'invalid_input', reason: 'client_transfer_id must be 1..128 chars' };
  }
  if (input.destinations.length === 0) {
    return { kind: 'invalid_input', reason: 'at least one destination is required' };
  }
  for (const dest of input.destinations) {
    if (!UUID_REGEX.test(dest.walletAccountId)) {
      return { kind: 'invalid_input', reason: 'destination_wallet_account_id must be a UUID' };
    }
    if (!POSITIVE_INT_REGEX.test(dest.lamports)) {
      return { kind: 'invalid_input', reason: 'lamports must be a positive integer string' };
    }
  }
  const body: TransferSolWireBody = {
    source_wallet_account_id: input.sourceWalletAccountId,
    client_transfer_id: input.clientTransferId,
    transfers: input.destinations.map((d) => ({
      destination_wallet_account_id: d.walletAccountId,
      lamports: d.lamports,
    })),
  };
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets/transfer',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseTransferSolResponse(json, res.status);
}

export interface TransferTokensInput {
  sourceWalletAccountId: string;
  clientTransferId: string;
  /** Base58 mint whose tokens (and ONLY whose tokens) move. */
  mint: string;
  destinations: Array<{ walletAccountId: string; amountBaseUnits: string }>;
}

const MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * SPL-token variant of `transferSol`: moves base units of ONE mint
 * between the user's own wallets via the same intents pipeline
 * (`POST /api/v1/wallets/transfer`, token body). The server re-checks
 * ownership, holdings and idempotency; the trading engine's verifier
 * binds every account to the mint before Turnkey signs.
 */
export async function transferTokens(
  input: TransferTokensInput,
  options: TransferSolOptions = {},
): Promise<TransferSolResult> {
  if (!UUID_REGEX.test(input.sourceWalletAccountId)) {
    return { kind: 'invalid_input', reason: 'source_wallet_account_id must be a UUID' };
  }
  if (
    typeof input.clientTransferId !== 'string' ||
    input.clientTransferId.length === 0 ||
    input.clientTransferId.length > 128
  ) {
    return { kind: 'invalid_input', reason: 'client_transfer_id must be 1..128 chars' };
  }
  if (!MINT_REGEX.test(input.mint)) {
    return { kind: 'invalid_input', reason: 'mint must be a base58 pubkey' };
  }
  if (input.destinations.length === 0) {
    return { kind: 'invalid_input', reason: 'at least one destination is required' };
  }
  for (const dest of input.destinations) {
    if (!UUID_REGEX.test(dest.walletAccountId)) {
      return { kind: 'invalid_input', reason: 'destination_wallet_account_id must be a UUID' };
    }
    if (!POSITIVE_INT_REGEX.test(dest.amountBaseUnits)) {
      return { kind: 'invalid_input', reason: 'amount_base_units must be a positive integer string' };
    }
  }
  const body = {
    source_wallet_account_id: input.sourceWalletAccountId,
    client_transfer_id: input.clientTransferId,
    mint: input.mint,
    token_transfers: input.destinations.map((d) => ({
      destination_wallet_account_id: d.walletAccountId,
      amount_base_units: d.amountBaseUnits,
    })),
  };
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets/transfer',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseTransferSolResponse(json, res.status);
}

export async function createWallet(
  input: CreateWalletInput = {},
  options: CreateWalletOptions = {},
): Promise<CreateWalletResult> {
  // Strict request body: only `label` is sent, and only when non-empty.
  // The api/ Ajv schema rejects unknown keys via `additionalProperties: false`.
  const body: { label?: string } = {};
  if (typeof input.label === 'string') {
    const trimmed = input.label.normalize('NFC').trim();
    if (trimmed.length > 0) body.label = trimmed;
  }
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseCreateWalletResponse(json, res.status);
}

// ─────────────────────────────────────────────────────────────────────
// Feature "Import wallet": bring a keypair you already own under Listen.
//
// The counterpart of the export the row already offers: Export hands you
// this wallet's key, Import takes one back. `POST /api/v1/wallets/import`
// with the secret and an optional label; the response is the same
// `wallet` envelope `POST /api/v1/wallets` returns, so the table, the
// selector and the balance readers all pick it up unchanged.
//
// THE SECRET IS NEVER LOGGED, NEVER RETURNED, AND NEVER PUT IN A URL. It
// rides once in the request body and this module keeps no copy of it.
// ─────────────────────────────────────────────────────────────────────

/** What a pasted secret turned out to be, or why it is not one. */
export type WalletSecretShape =
  | { readonly kind: 'base58'; readonly secret: string }
  | { readonly kind: 'byte_array'; readonly secret: string }
  | { readonly kind: 'invalid'; readonly reason: 'empty' | 'not_a_key' | 'wrong_length' };

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * READ THE PASTE BEFORE SENDING IT.
 *
 * A wallet secret arrives in exactly two shapes, and both are what the
 * common exporters produce: base58 (Phantom, Solflare, `solana-keygen`
 * with `--outfile -`) and a JSON array of 64 bytes (the `id.json` the
 * CLI writes). Anything else is a mistake worth catching HERE rather
 * than sending a user's key to a server to be told it is not a key.
 *
 * Length is checked, not the curve: a 64-byte ed25519 secret is 87 or 88
 * base58 characters, and a paste outside that is a truncated copy or a
 * public key pasted into the wrong field.
 */
export function parseWalletSecret(input: string): WalletSecretShape {
  const text = input.trim();
  if (text === '') return { kind: 'invalid', reason: 'empty' };

  if (text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'invalid', reason: 'not_a_key' };
    }
    if (!Array.isArray(parsed)) return { kind: 'invalid', reason: 'not_a_key' };
    const bytes = parsed.every(
      (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255,
    );
    if (!bytes) return { kind: 'invalid', reason: 'not_a_key' };
    if (parsed.length !== 64) return { kind: 'invalid', reason: 'wrong_length' };
    return { kind: 'byte_array', secret: JSON.stringify(parsed) };
  }

  if (!BASE58_ALPHABET.test(text)) return { kind: 'invalid', reason: 'not_a_key' };
  if (text.length < 80 || text.length > 90) return { kind: 'invalid', reason: 'wrong_length' };
  return { kind: 'base58', secret: text };
}

export interface ImportWalletInput {
  readonly secret: string;
  readonly label?: string;
}

export type ImportWalletResult =
  | { readonly kind: 'ok'; readonly wallet: MeWalletEntry }
  | { readonly kind: 'duplicate'; readonly walletAccountId: string | null }
  | { readonly kind: 'invalid_secret' }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'error'; readonly status: number; readonly message: string }
  | { readonly kind: 'network_error'; readonly reason: string };

export interface ImportWalletOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

export async function importWallet(
  input: ImportWalletInput,
  options: ImportWalletOptions = {},
): Promise<ImportWalletResult> {
  const shape = parseWalletSecret(input.secret);
  if (shape.kind === 'invalid') return { kind: 'invalid_secret' };

  const body: { secret: string; label?: string } = { secret: shape.secret };
  if (typeof input.label === 'string') {
    const trimmed = input.label.normalize('NFC').trim();
    if (trimmed.length > 0) body.label = trimmed;
  }

  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/wallets/import',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || json['reauth_required'] === true) return { kind: 'reauth' };
  if (res.status === 409) {
    const id = json['wallet_account_id'];
    return { kind: 'duplicate', walletAccountId: typeof id === 'string' ? id : null };
  }
  if (res.status === 400 || res.status === 422) return { kind: 'invalid_secret' };
  if (!res.ok) {
    const message = typeof json['message'] === 'string' ? json['message'] : 'Import failed';
    return { kind: 'error', status: res.status, message };
  }
  const wallet = json['wallet'];
  if (wallet === null || typeof wallet !== 'object') {
    return { kind: 'error', status: res.status, message: 'Import failed' };
  }
  return { kind: 'ok', wallet: wallet as MeWalletEntry };
}

// ─────────────────────────────────────────────────────────────────────
// Feature "External SOL withdraw": `withdrawSol` client. Sends SOL from
// an owned wallet to an arbitrary external Solana address via
// `POST /api/v1/wallets/:walletAccountId/withdraw`. Tagged-union result
// mirrors `transferSol`.
// ─────────────────────────────────────────────────────────────────────

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface WithdrawalSnapshot {
  readonly id: string;
  readonly status: string;
  readonly lamports: string;
  readonly sourceWalletAccountId: string;
  readonly destinationPubkey: string;
  readonly signature: string | null;
  readonly slot: number | null;
  readonly terminalAt: string | null;
}

export type WithdrawSolResult =
  | { kind: 'ok'; withdrawal: WithdrawalSnapshot }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'in_flight'; intentId: string }
  | { kind: 'insufficient_balance'; observedLamports: string; requiredLamports: string }
  /** Outcome unknown (engine timeout) — may still land. NEVER prompt a retry. */
  | { kind: 'pending_unconfirmed'; intentId: string | null }
  | { kind: 'error'; status: number; errorCode: string; message: string; intentId: string | null }
  | { kind: 'network_error'; reason: string }
  | { kind: 'invalid_input'; reason: string };

export interface WithdrawSolInput {
  readonly sourceWalletAccountId: string;
  readonly destinationPubkey: string;
  /** Positive lamports as a decimal string. */
  readonly lamports: string;
  readonly clientTransferId: string;
}

export interface WithdrawSolOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

export function parseWithdrawSolResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): WithdrawSolResult {
  if (json['reauth_required'] === true) {
    const reason =
      typeof json['reason'] === 'string'
        ? (json['reason'] as 'no_session' | 'session_expired' | 'session_invalid')
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const w = json['withdrawal'];
    if (w && typeof w === 'object') {
      const obj = w as Record<string, unknown>;
      if (
        typeof obj['id'] === 'string' &&
        typeof obj['status'] === 'string' &&
        typeof obj['lamports'] === 'string' &&
        typeof obj['source_wallet_account_id'] === 'string' &&
        typeof obj['destination_pubkey'] === 'string'
      ) {
        return {
          kind: 'ok',
          withdrawal: {
            id: obj['id'],
            status: obj['status'],
            lamports: obj['lamports'],
            sourceWalletAccountId: obj['source_wallet_account_id'],
            destinationPubkey: obj['destination_pubkey'],
            signature: typeof obj['signature'] === 'string' ? obj['signature'] : null,
            slot: typeof obj['slot'] === 'number' ? obj['slot'] : null,
            terminalAt: typeof obj['terminal_at'] === 'string' ? obj['terminal_at'] : null,
          },
        };
      }
    }
    return { kind: 'error', status: httpStatus, errorCode: 'shape_mismatch', message: 'unexpected response shape', intentId: null };
  }
  const errorCode = typeof json['error_code'] === 'string' ? (json['error_code'] as string) : 'unknown';
  const message = typeof json['message'] === 'string' ? (json['message'] as string) : 'request failed';
  const intentId = typeof json['intent_id'] === 'string' ? (json['intent_id'] as string) : null;
  if (errorCode === 'insufficient_balance') {
    const observed = typeof json['observed_lamports'] === 'string' ? (json['observed_lamports'] as string) : '0';
    const required = typeof json['required_lamports'] === 'string' ? (json['required_lamports'] as string) : '0';
    return { kind: 'insufficient_balance', observedLamports: observed, requiredLamports: required };
  }
  if (errorCode === 'transfer_in_flight' && intentId) {
    return { kind: 'in_flight', intentId };
  }
  if (errorCode === 'transfer_pending_unconfirmed') {
    return { kind: 'pending_unconfirmed', intentId };
  }
  return { kind: 'error', status: httpStatus, errorCode, message, intentId };
}

export async function withdrawSol(
  input: WithdrawSolInput,
  options: WithdrawSolOptions = {},
): Promise<WithdrawSolResult> {
  if (!UUID_REGEX.test(input.sourceWalletAccountId)) {
    return { kind: 'invalid_input', reason: 'source_wallet_account_id must be a UUID' };
  }
  if (!BASE58_PUBKEY_REGEX.test(input.destinationPubkey)) {
    return { kind: 'invalid_input', reason: 'destination_pubkey must be a valid Solana address' };
  }
  if (!POSITIVE_INT_REGEX.test(input.lamports)) {
    return { kind: 'invalid_input', reason: 'lamports must be a positive integer string' };
  }
  if (
    typeof input.clientTransferId !== 'string' ||
    input.clientTransferId.length === 0 ||
    input.clientTransferId.length > 128
  ) {
    return { kind: 'invalid_input', reason: 'client_transfer_id must be 1..128 chars' };
  }
  let res: Response;
  try {
    const challenge = await requestSensitiveActionChallenge(
      {
        action: 'wallet_withdraw',
        walletAccountId: input.sourceWalletAccountId,
      },
      { authToken: options.authToken, signal: options.signal },
    );
    if (challenge.kind !== 'ok') {
      if (challenge.kind === 'reauth') return challenge;
      if (challenge.kind === 'network_error') return challenge;
      return {
        kind: 'error',
        status: challenge.kind === 'step_up_required' ? 403 : challenge.status,
        errorCode:
          challenge.kind === 'step_up_required' ? 'step_up_required' : challenge.errorCode,
        message:
          challenge.kind === 'step_up_required'
            ? 'Recent authentication is required before withdrawal.'
            : challenge.message,
        intentId: null,
      };
    }
    res = await fetchAuthenticatedApi(
      `/api/v1/wallets/${encodeURIComponent(input.sourceWalletAccountId)}/withdraw`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination_pubkey: input.destinationPubkey,
          lamports: input.lamports,
          client_transfer_id: input.clientTransferId,
          step_up_challenge_id: challenge.challengeId,
          step_up_challenge_token: challenge.challengeToken,
        }),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseWithdrawSolResponse(json, res.status);
}

export interface EvmWithdrawalSnapshot {
  readonly id: string;
  readonly status: string;
  readonly chain: string;
  readonly nativeOutWei: string;
  readonly nativeSymbol: string;
  readonly destinationAddress: string;
  readonly txHash: string | null;
}

export type WithdrawEvmResult =
  | { kind: 'ok'; withdrawal: EvmWithdrawalSnapshot }
  | { kind: 'reauth' }
  | { kind: 'pending_unconfirmed'; intentId: string | null }
  | { kind: 'error'; errorCode: string; message: string };

export interface WithdrawEvmInput {
  readonly sourceWalletAccountId: string;
  readonly chain: string;
  readonly destinationAddress: string;
  readonly nativeOutWei: string;
  readonly clientTransferId: string;
}

export interface WithdrawEvmOptions extends WithdrawSolOptions {
  /** Status-only replay must remain available when a fresh code probe is down. */
  readonly skipDestinationPreflight?: boolean;
}

export function parseWithdrawEvmResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): WithdrawEvmResult {
  if (json['reauth_required'] === true) return { kind: 'reauth' };
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const raw = json['withdrawal'];
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const withdrawal = raw as Record<string, unknown>;
      if (
        typeof withdrawal['id'] === 'string' && typeof withdrawal['status'] === 'string' &&
        typeof withdrawal['chain'] === 'string' && typeof withdrawal['native_out_wei'] === 'string' &&
        typeof withdrawal['native_symbol'] === 'string' && typeof withdrawal['destination_address'] === 'string'
      ) {
        return { kind: 'ok', withdrawal: {
          id: withdrawal['id'], status: withdrawal['status'], chain: withdrawal['chain'],
          nativeOutWei: withdrawal['native_out_wei'], nativeSymbol: withdrawal['native_symbol'],
          destinationAddress: withdrawal['destination_address'],
          txHash: typeof withdrawal['tx_hash'] === 'string' ? withdrawal['tx_hash'] : null,
        } };
      }
    }
  }
  const errorCode = typeof json['error_code'] === 'string' ? json['error_code'] : 'unknown_error';
  if (
    errorCode === 'transfer_pending_unconfirmed' ||
    errorCode === 'transfer_needs_reconcile' ||
    errorCode === 'transfer_in_flight'
  ) {
    return { kind: 'pending_unconfirmed', intentId: typeof json['intent_id'] === 'string' ? json['intent_id'] : null };
  }
  return {
    kind: 'error', errorCode,
    message: typeof json['message'] === 'string' ? json['message'] : 'Withdrawal failed.',
  };
}

export async function withdrawEvmNative(
  input: WithdrawEvmInput,
  options: WithdrawEvmOptions = {},
): Promise<WithdrawEvmResult> {
  if (options.skipDestinationPreflight !== true) {
    const checked = await checkEvmWithdrawalDestination(input.chain, input.destinationAddress, {
      authToken: options.authToken,
      signal: options.signal,
    });
    if (checked.kind === 'reauth') return { kind: 'reauth' };
    if (checked.kind === 'invalid') {
      return { kind: 'error', errorCode: checked.errorCode, message: checked.message };
    }
    if (checked.kind === 'unavailable') {
      return {
        kind: 'error',
        errorCode: 'destination_check_unavailable',
        message: `${checked.message} No withdrawal was submitted.`,
      };
    }
  }
  const challenge = await requestSensitiveActionChallenge(
    { action: 'wallet_withdraw', walletAccountId: input.sourceWalletAccountId },
    { authToken: options.authToken, signal: options.signal },
  );
  if (challenge.kind !== 'ok') {
    if (challenge.kind === 'reauth') return { kind: 'reauth' };
    if (challenge.kind === 'network_error') {
      return {
        kind: 'error',
        errorCode: 'challenge_unavailable',
        message: 'The authentication challenge could not be created. No withdrawal was submitted.',
      };
    }
    return {
      kind: 'error',
      errorCode: challenge.kind,
      message: 'Recent authentication is required before withdrawal.',
    };
  }
  try {
    const response = await fetchAuthenticatedApi(
      `/api/v1/wallets/${encodeURIComponent(input.sourceWalletAccountId)}/evm-withdraw`,
      {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chain: input.chain, destination_address: input.destinationAddress,
          native_out_wei: input.nativeOutWei, client_transfer_id: input.clientTransferId,
          step_up_challenge_id: challenge.challengeId,
          step_up_challenge_token: challenge.challengeToken,
        }),
      },
      { authToken: options.authToken, signal: options.signal },
    );
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return parseWithdrawEvmResponse(json, response.status);
  } catch {
    // The request may have crossed the signing boundary before the channel
    // failed. Keep the id and force reconciliation rather than inviting a
    // fresh withdrawal that could double-send.
    return { kind: 'pending_unconfirmed', intentId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Feature "Deposit/Withdraw history": read the user's transfer ledger.
// ─────────────────────────────────────────────────────────────────────

export interface WalletTransferHistoryRow {
  readonly id: string;
  readonly walletAccountId: string;
  readonly direction: 'deposit' | 'withdrawal';
  readonly fromPubkey: string;
  readonly toPubkey: string;
  readonly lamports: string;
  readonly signature: string;
  readonly slot: number | null;
  readonly blockTime: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export type ListWalletTransfersResult =
  | { kind: 'ok'; transfers: WalletTransferHistoryRow[] }
  | { kind: 'reauth' }
  | { kind: 'error'; reason: string };

function parseHistoryRow(raw: unknown): WalletTransferHistoryRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const direction = o['direction'];
  if (
    typeof o['id'] !== 'string' ||
    typeof o['wallet_account_id'] !== 'string' ||
    (direction !== 'deposit' && direction !== 'withdrawal') ||
    typeof o['from_pubkey'] !== 'string' ||
    typeof o['to_pubkey'] !== 'string' ||
    typeof o['lamports'] !== 'string' ||
    typeof o['signature'] !== 'string' ||
    typeof o['status'] !== 'string' ||
    typeof o['created_at'] !== 'string'
  ) {
    return null;
  }
  return {
    id: o['id'],
    walletAccountId: o['wallet_account_id'],
    direction,
    fromPubkey: o['from_pubkey'],
    toPubkey: o['to_pubkey'],
    lamports: o['lamports'],
    signature: o['signature'],
    slot: typeof o['slot'] === 'number' ? o['slot'] : null,
    blockTime: typeof o['block_time'] === 'string' ? o['block_time'] : null,
    status: o['status'],
    createdAt: o['created_at'],
  };
}

export async function listWalletTransfers(
  options: { limit?: number; signal?: AbortSignal; authToken?: string | null } = {},
): Promise<ListWalletTransfersResult> {
  const limit = options.limit && options.limit > 0 ? Math.min(500, Math.floor(options.limit)) : 100;
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      `/api/v1/wallets/transfers?limit=${limit}`,
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return { kind: 'error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) return { kind: 'reauth' };
  if (res.ok && Array.isArray(json['transfers'])) {
    const transfers = (json['transfers'] as unknown[])
      .map(parseHistoryRow)
      .filter((r): r is WalletTransferHistoryRow => r !== null);
    return { kind: 'ok', transfers };
  }
  return { kind: 'error', reason: 'unexpected response' };
}

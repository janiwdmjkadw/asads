'use client';

import type { ProvisioningState } from './me';
import { fetchAuthenticatedApi } from './trading';
import { refreshAuthorization } from './wallet-auth';

/**
 * Slice "User-funded nonce setup" Terminal client.
 *
 * Wraps `POST /api/v1/wallet/nonce/setup` (api/src/routes/wallet/nonce-setup.ts).
 * Mirrors `wallet-backup.ts` style: tagged-union result type with one variant
 * per backend response branch, defensive parsing, fail-closed on shape drift.
 *
 * The backend route accepts an optional `{ dry_run: boolean }` body.
 *   - `dry_run: true` -> the route returns a preflight body (no Turnkey calls,
 *     no tx submits). Used by the CTA to show cost/balance/missing-slots
 *     before the user commits.
 *   - `dry_run: false` (default) -> live execute. Trading/ signs 5 sequential
 *     createAccount + nonceInitialize txs from the user's Turnkey wallet and
 *     submits them via RPC. ~5-15s of wall time.
 *
 * NEVER throws. Every code path returns a typed `NonceSetupResult`.
 */

export interface NonceSetupPreflight {
  target_count: number;
  existing_count: number;
  missing_slots: ReadonlyArray<number>;
  estimated_rent_lamports_per_nonce: number;
  estimated_cost_lamports: number;
  wallet_balance_lamports: number;
  sufficient: boolean;
}

export interface NonceSetupReceiptItem {
  slot: number;
  nonce_pubkey: string;
  tx_signature: string;
}

export interface NonceSetupReceipt {
  created_count: number;
  total_count: number;
  target_count: number;
  nonces: ReadonlyArray<NonceSetupReceiptItem>;
}

export interface NonceSetupPartialFailureItem {
  slot: number;
  reason: string;
}

export type NonceSetupResult =
  | { kind: 'reauth' }
  | {
      kind: 'preflight';
      state: ProvisioningState;
      preflight: NonceSetupPreflight;
    }
  | {
      kind: 'ok';
      state: ProvisioningState;
      setup: NonceSetupReceipt;
    }
  | {
      kind: 'insufficient_balance';
      observed_balance_lamports: number;
      required_lamports: number;
    }
  | {
      kind: 'partial_failure';
      created_count: number;
      failures: ReadonlyArray<NonceSetupPartialFailureItem>;
    }
  | { kind: 'wrong_state'; state: string }
  | { kind: 'error'; errorCode: string; message: string };

export interface SetupNoncesOptions {
  dryRun?: boolean;
  /**
   * Slice "Per-wallet nonce setup": when supplied, the client targets
   * the wallet-scoped route
   * `POST /api/v1/wallets/:wallet_account_id/nonce/setup`. When
   * omitted (or `null`), the client falls back to the legacy primary
   * route `POST /api/v1/wallet/nonce/setup` for back-compat with
   * older Terminal calls.
   *
   * The string is validated against a strict UUID regex before the
   * URL is composed so a malformed value cannot path-inject into
   * the request line.
   */
  walletAccountId?: string | null;
  signal?: AbortSignal;
  authToken?: string | null;
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function buildNonceSetupUrl(walletAccountId: string | null | undefined): string | null {
  if (walletAccountId === undefined || walletAccountId === null) {
    return '/api/v1/wallet/nonce/setup';
  }
  if (typeof walletAccountId !== 'string' || !UUID_REGEX.test(walletAccountId)) {
    return null;
  }
  return `/api/v1/wallets/${walletAccountId}/nonce/setup`;
}

export async function setupNonces(
  options: SetupNoncesOptions = {},
): Promise<NonceSetupResult> {
  const url = buildNonceSetupUrl(options.walletAccountId ?? null);
  if (url === null) {
    return {
      kind: 'error',
      errorCode: 'invalid_wallet_account_id',
      message: 'walletAccountId is not a valid UUID',
    };
  }
  const body = options.dryRun === true ? { dry_run: true } : {};
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'error',
      errorCode: 'network_error',
      message: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseNonceSetupResponse(json, res.status);
}

/**
 * `setupNonces` + one-shot recovery for an expired trading
 * authorization. The authorization row is issued during provisioning
 * with a finite TTL and only slides while a tab keeps it warm — a user
 * who pauses mid-onboarding past the TTL gets `no_active_authorization`
 * from the nonce-setup route, and plain retries loop forever. The
 * refresh endpoint can revive an expired-but-unrevoked row, so one
 * slide + one retry turns that dead-end into a silent recovery.
 *
 * Safe for live (non-dry-run) calls: both `no_active_authorization`
 * sites in the route fire BEFORE any Turnkey call or tx submit, so the
 * failed first attempt did no on-chain work and the retry cannot
 * double-execute.
 */
export async function setupNoncesRecoveringAuthorization(
  options: SetupNoncesOptions = {},
): Promise<NonceSetupResult> {
  const first = await setupNonces(options);
  if (first.kind !== 'error' || first.errorCode !== 'no_active_authorization') return first;
  const refreshed = await refreshAuthorization(
    options.signal,
    options.authToken,
    options.walletAccountId ?? null,
  );
  if (refreshed.kind !== 'ok') return first;
  return setupNonces(options);
}

/**
 * Pure parser. Exported for unit tests so the branch table is exercised
 * without spinning up `fetch`.
 *
 * Order of checks matters:
 *   1. typed error_code branches (insufficient_balance, partial_failure,
 *      wallet_not_ready_for_nonce_setup) win over generic error.
 *   2. reauth_required:true short-circuits before shape parsing.
 *   3. live setup body (setup + state) and dry-run preflight body
 *      (preflight + state) are disambiguated by which key is present.
 *   4. anything else falls into a generic error with the raw error_code if
 *      one is present, otherwise 'shape_mismatch'.
 */
export function parseNonceSetupResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): NonceSetupResult {
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    if (errorCodeRaw === 'insufficient_balance') {
      const observed = json['observed_balance_lamports'];
      const required = json['required_lamports'];
      if (typeof observed === 'number' && typeof required === 'number') {
        return {
          kind: 'insufficient_balance',
          observed_balance_lamports: observed,
          required_lamports: required,
        };
      }
      return { kind: 'error', errorCode: 'insufficient_balance', message: extractMessage(json) };
    }
    if (errorCodeRaw === 'nonce_setup_partial_failure') {
      const partial = json['partial'];
      if (
        partial &&
        typeof partial === 'object' &&
        Array.isArray((partial as { failures?: unknown }).failures)
      ) {
        const p = partial as { created_count?: unknown; failures: unknown[] };
        const failures = p.failures
          .map((f): NonceSetupPartialFailureItem | null => {
            if (
              f &&
              typeof f === 'object' &&
              typeof (f as { slot?: unknown }).slot === 'number' &&
              typeof (f as { reason?: unknown }).reason === 'string'
            ) {
              return {
                slot: (f as { slot: number }).slot,
                reason: (f as { reason: string }).reason,
              };
            }
            return null;
          })
          .filter((x): x is NonceSetupPartialFailureItem => x !== null);
        return {
          kind: 'partial_failure',
          created_count: typeof p.created_count === 'number' ? p.created_count : 0,
          failures,
        };
      }
      return {
        kind: 'error',
        errorCode: 'nonce_setup_partial_failure',
        message: extractMessage(json),
      };
    }
    if (errorCodeRaw === 'wallet_not_ready_for_nonce_setup') {
      // The route's message includes the offending state, but we surface
      // it via a typed branch so the UI can render cleanly without
      // string-parsing.
      return { kind: 'wrong_state', state: extractMessage(json) };
    }
    return {
      kind: 'error',
      errorCode: errorCodeRaw,
      message: extractMessage(json),
    };
  }

  if (json['reauth_required'] === true) {
    return { kind: 'reauth' };
  }

  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const stateRaw = json['state'];
    const state = typeof stateRaw === 'string' ? (stateRaw as ProvisioningState) : null;
    const setup = json['setup'];
    const preflight = json['preflight'];
    if (state !== null && setup && typeof setup === 'object') {
      const parsed = parseSetupBody(setup as Record<string, unknown>);
      if (parsed) return { kind: 'ok', state, setup: parsed };
    }
    if (state !== null && preflight && typeof preflight === 'object') {
      const parsed = parsePreflightBody(preflight as Record<string, unknown>);
      if (parsed) return { kind: 'preflight', state, preflight: parsed };
    }
    return { kind: 'error', errorCode: 'shape_mismatch', message: 'unexpected response shape' };
  }

  return { kind: 'error', errorCode: 'shape_mismatch', message: 'unexpected response shape' };
}

function parseSetupBody(setup: Record<string, unknown>): NonceSetupReceipt | null {
  const created = setup['created_count'];
  const total = setup['total_count'];
  const target = setup['target_count'];
  const noncesRaw = setup['nonces'];
  if (
    typeof created !== 'number' ||
    typeof total !== 'number' ||
    typeof target !== 'number' ||
    !Array.isArray(noncesRaw)
  ) {
    return null;
  }
  const nonces = noncesRaw
    .map((n): NonceSetupReceiptItem | null => {
      if (
        n &&
        typeof n === 'object' &&
        typeof (n as { slot?: unknown }).slot === 'number' &&
        typeof (n as { nonce_pubkey?: unknown }).nonce_pubkey === 'string' &&
        typeof (n as { tx_signature?: unknown }).tx_signature === 'string'
      ) {
        const x = n as { slot: number; nonce_pubkey: string; tx_signature: string };
        return { slot: x.slot, nonce_pubkey: x.nonce_pubkey, tx_signature: x.tx_signature };
      }
      return null;
    })
    .filter((x): x is NonceSetupReceiptItem => x !== null);
  return { created_count: created, total_count: total, target_count: target, nonces };
}

function parsePreflightBody(preflight: Record<string, unknown>): NonceSetupPreflight | null {
  const target = preflight['target_count'];
  const existing = preflight['existing_count'];
  const missingRaw = preflight['missing_slots'];
  const rentPer = preflight['estimated_rent_lamports_per_nonce'];
  const cost = preflight['estimated_cost_lamports'];
  const balance = preflight['wallet_balance_lamports'];
  const sufficient = preflight['sufficient'];
  if (
    typeof target !== 'number' ||
    typeof existing !== 'number' ||
    !Array.isArray(missingRaw) ||
    typeof rentPer !== 'number' ||
    typeof cost !== 'number' ||
    typeof balance !== 'number' ||
    typeof sufficient !== 'boolean'
  ) {
    return null;
  }
  const missing = (missingRaw as unknown[]).filter(
    (s): s is number => typeof s === 'number' && Number.isInteger(s),
  );
  return {
    target_count: target,
    existing_count: existing,
    missing_slots: missing,
    estimated_rent_lamports_per_nonce: rentPer,
    estimated_cost_lamports: cost,
    wallet_balance_lamports: balance,
    sufficient,
  };
}

function extractMessage(json: Record<string, unknown>): string {
  const m = json['message'];
  return typeof m === 'string' ? m : 'request failed';
}

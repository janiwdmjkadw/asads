'use client';

/**
 * Typed port over the four user-facing agent-wallet routes.
 *
 *   POST /api/v1/agent-wallet                    create (idempotent)
 *   GET  /api/v1/agent-wallet                    status
 *   POST /api/v1/agent-wallet/nonce/setup        provision nonce accounts
 *   POST /api/v1/agent-wallet/delegation/revoke  end durable delegation
 *   POST /api/v1/agent-wallet/delegation/grant   begin durable delegation
 *
 * GRANT IS ASYMMETRIC WITH REVOKE, on purpose. Revoke is one bare POST.
 * Grant is a two-call ceremony behind a single-use step-up challenge,
 * because it is what lets the agent trade while its owner is signed out.
 * There is no transfer/funding/withdrawal call, and there never
 * will be — the user funds the wallet by sending SOL to the address the
 * status route reports. No `/internal/**` route appears here.
 *
 * No route takes a wallet id: the wallet is a per-user singleton
 * resolved from the Clerk session, so there is no parameter a caller
 * could tamper with and none is accepted.
 *
 * ERROR DISCIPLINE: nothing throws. Every call resolves to an
 * `AgentWalletResult`, and `reauth` is a first-class arm rather than an
 * error — the routes return HTTP 200 with `{reauth_required:true}`.
 */

import { fetchAuthenticatedApi, type AuthenticatedFetchOptions } from '@/lib/api/trading';
import {
  parseNonceSetupResponse,
  type NonceSetupResult,
} from '@/lib/api/wallet-nonce-setup';
import { requestSensitiveActionChallenge } from '@/lib/api/sensitive-action';
import {
  enumValue,
  parseCreateResponse,
  parseGrantResponse,
  parseRevokeResponse,
  parseStatusResponse,
  REAUTH_REASONS,
} from './parse';
import type {
  AgentWalletCreated,
  AgentWalletGrantPayload,
  AgentWalletResult,
  AgentWalletRevokePayload,
  AgentWalletStatusPayload,
} from './types';

export const AGENT_WALLET_PATH = '/api/v1/agent-wallet';
export const AGENT_WALLET_NONCE_SETUP_PATH = '/api/v1/agent-wallet/nonce/setup';
export const AGENT_WALLET_REVOKE_PATH = '/api/v1/agent-wallet/delegation/revoke';
export const AGENT_WALLET_GRANT_PATH = '/api/v1/agent-wallet/delegation/grant';

/** Nonce provisioning signs and submits several txs; give it room. */
const DEFAULT_TIMEOUT_MS = 15_000;
const NONCE_SETUP_TIMEOUT_MS = 60_000;

export interface AgentWalletRequestOptions extends AuthenticatedFetchOptions {
  readonly timeoutMs?: number;
}

/**
 * One request, one body read, one discriminated result. A transport
 * fault or a non-JSON body (a proxy's html error page) becomes an
 * `error` arm rather than a rejection, so no caller needs a try/catch.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  parse: (json: unknown) => T,
  options: AgentWalletRequestOptions,
  fallback: (errorCode: string, message: string) => T,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
    return fallback(
      aborted ? 'aborted' : 'network_error',
      err instanceof Error ? err.message : 'request failed',
    );
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return fallback('invalid_json', `response body was not JSON (http ${response.status})`);
  }
  return parse(json);
}

/**
 * `AgentWalletResult<never>` so one fallback serves every call: the
 * error arm carries no payload, and `never` widens into whichever
 * payload type the caller's parser produces.
 */
function errorResult(errorCode: string, message: string): AgentWalletResult<never> {
  return { kind: 'error', errorCode, message };
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/**
 * Create the agent wallet. Idempotent at the provisioning layer: calling
 * it twice returns one wallet, and `created` is true only for the call
 * that actually made it.
 */
export function createAgentWallet(
  options: AgentWalletRequestOptions = {},
): Promise<AgentWalletResult<AgentWalletCreated>> {
  return request(
    AGENT_WALLET_PATH,
    { method: 'POST', headers: JSON_HEADERS, body: '{}' },
    parseCreateResponse,
    options,
    errorResult,
  );
}

export function fetchAgentWalletStatus(
  options: AgentWalletRequestOptions = {},
): Promise<AgentWalletResult<AgentWalletStatusPayload>> {
  return request(AGENT_WALLET_PATH, { method: 'GET' }, parseStatusResponse, options, errorResult);
}

/**
 * Provision the nonce pool. The route returns the wallet-scoped
 * nonce-setup responses verbatim, so the response is handed to that
 * client's existing pure parser rather than a second copy of the branch
 * table. `dryRun` asks for the preflight (cost + balance, no signing).
 */
export function setupAgentWalletNonces(
  options: AgentWalletRequestOptions & { readonly dryRun?: boolean } = {},
): Promise<NonceSetupResult> {
  const body = options.dryRun === true ? '{"dry_run":true}' : '{}';
  return request(
    AGENT_WALLET_NONCE_SETUP_PATH,
    { method: 'POST', headers: JSON_HEADERS, body },
    (json) =>
      parseNonceSetupResponse(
        (json !== null && typeof json === 'object' ? json : {}) as Record<string, unknown>,
        200,
      ),
    { timeoutMs: NONCE_SETUP_TIMEOUT_MS, ...options },
    (errorCode, message): NonceSetupResult => ({ kind: 'error', errorCode, message }),
  );
}

/**
 * End the durable delegation. `revoked` is true only when this call
 * flipped a live one; a repeat is a no-op that returns the original
 * `revoked_at` rather than rewriting it.
 */
export function revokeAgentWalletDelegation(
  options: AgentWalletRequestOptions = {},
): Promise<AgentWalletResult<AgentWalletRevokePayload>> {
  return request(
    AGENT_WALLET_REVOKE_PATH,
    { method: 'POST', headers: JSON_HEADERS, body: '{}' },
    parseRevokeResponse,
    options,
    errorResult,
  );
}

/**
 * Begin the durable delegation — TWO calls, deliberately.
 *
 * Granting means the agent executes approved conditionals while the
 * owner is signed out, so the api gates it behind the same single-use
 * step-up challenge that wallet export and withdrawal use. This function
 * performs that ceremony: fetch a challenge, then POST the grant
 * carrying it plus an explicit acknowledgement literal. If the challenge
 * step refuses, the grant is NEVER sent.
 *
 * Contrast `revokeAgentWalletDelegation`, one bare POST above: the safe
 * direction must never be the harder one to reach.
 *
 * `granted` is true only when this call turned a non-durable
 * authorization durable; a repeat returns `false` with the original
 * `granted_at` intact.
 */
export async function grantAgentWalletDelegation(
  options: AgentWalletRequestOptions = {},
): Promise<AgentWalletResult<AgentWalletGrantPayload>> {
  const challenge = await requestSensitiveActionChallenge(
    { action: 'agent_wallet_delegation_grant' },
    {
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );

  if (challenge.kind === 'reauth') {
    return { kind: 'reauth', reason: enumValue(challenge.reason, REAUTH_REASONS) };
  }
  if (challenge.kind === 'step_up_required') {
    return {
      kind: 'error',
      errorCode: 'step_up_required',
      message: 'Sign in again to confirm it is you, then re-authorize.',
    };
  }
  if (challenge.kind !== 'ok') {
    return {
      kind: 'error',
      errorCode: challenge.kind === 'network_error' ? 'network_error' : challenge.errorCode,
      message: challenge.kind === 'network_error' ? challenge.reason : challenge.message,
    };
  }

  return request(
    AGENT_WALLET_GRANT_PATH,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        acknowledge_durable_delegation: true,
        step_up_challenge_id: challenge.challengeId,
        step_up_challenge_token: challenge.challengeToken,
      }),
    },
    parseGrantResponse,
    options,
    errorResult,
  );
}

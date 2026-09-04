/**
 * Wire-shaped fixtures for the agent-wallet tests.
 *
 * Deliberately RAW JSON, not view objects: every test then runs the real
 * parser before the real component, so a change that breaks the contract
 * with `api/src/routes/agent-wallet` fails here rather than passing
 * against a hand-built view model that no server would ever send.
 */

export const WALLET_ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
export const FUNDING_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

type Json = Record<string, unknown>;

export function balanceBody(overrides: Json = {}): Json {
  return { lamports: '2000000000', commitment: 'confirmed', source: 'rpc', ...overrides };
}

export function fundingBody(overrides: Json = {}): Json {
  return { state: 'funded', required_lamports: '0', sufficient: true, ...overrides };
}

export function noncePoolBody(overrides: Json = {}): Json {
  return {
    target_count: 5,
    active_count: 5,
    missing_slots: [],
    failed_slots: [],
    disabled_slots: [],
    complete: true,
    ...overrides,
  };
}

export function delegationBody(overrides: Json = {}): Json {
  return {
    state: 'active',
    mode: 'durable',
    granted_at: '2026-08-01T10:00:00.000Z',
    revoked_at: null,
    authorization_expires_at: null,
    ...overrides,
  };
}

/** Never granted: paused, session mode, no grant and no revocation. */
export function neverGrantedDelegationBody(): Json {
  return delegationBody({ state: 'paused', mode: 'session', granted_at: null, revoked_at: null });
}

/** Revoked by the user: an explicit revocation timestamp is present. */
export function revokedDelegationBody(): Json {
  return delegationBody({
    state: 'revoked',
    mode: 'durable',
    revoked_at: '2026-08-04T09:30:00.000Z',
  });
}

export function readinessBody(overrides: Json = {}): Json {
  return { ready_to_trade: true, blockers: [], ...overrides };
}

export function agentWalletBody(overrides: Json = {}): Json {
  return {
    wallet_account_id: WALLET_ACCOUNT_ID,
    wallet_pubkey: FUNDING_ADDRESS,
    funding_address: FUNDING_ADDRESS,
    status: 'active',
    is_enabled: true,
    is_archived: false,
    balance: balanceBody(),
    funding: fundingBody(),
    nonce_pool: noncePoolBody(),
    delegation: delegationBody(),
    readiness: readinessBody(),
    ...overrides,
  };
}

export function statusBody(agentWallet: Json | null = agentWalletBody()): Json {
  return {
    reauth_required: false,
    provisioning_state: 'ready_to_trade',
    agent_wallet: agentWallet,
  };
}

export function reauthBody(reason = 'session_expired'): Json {
  return { reauth_required: true, reason };
}

export function createBody(created = true): Json {
  return {
    reauth_required: false,
    agent_wallet: {
      wallet_account_id: WALLET_ACCOUNT_ID,
      wallet_pubkey: FUNDING_ADDRESS,
      funding_address: FUNDING_ADDRESS,
      created,
    },
  };
}

/**
 * A brand-new agent wallet: created, no SOL in it, no nonce accounts, no
 * delegation. The first state the setup modal ever renders.
 */
export function unfundedStatusBody(): Json {
  return statusBody(
    agentWalletBody({
      balance: balanceBody({ lamports: '0' }),
      funding: fundingBody({
        state: 'unfunded',
        required_lamports: '21000000',
        sufficient: false,
      }),
      nonce_pool: noncePoolBody({
        active_count: 0,
        missing_slots: [0, 1, 2, 3, 4],
        complete: false,
      }),
      delegation: neverGrantedDelegationBody(),
      readiness: readinessBody({
        ready_to_trade: false,
        blockers: ['nonce_pool_incomplete', 'no_active_authorization'],
      }),
    }),
  );
}

/**
 * Funded and provisioned; only the durable delegation is missing. The
 * state where the setup modal's last card becomes pressable.
 */
export function finalStepStatusBody(): Json {
  return statusBody(
    agentWalletBody({
      delegation: neverGrantedDelegationBody(),
      readiness: readinessBody({
        ready_to_trade: false,
        blockers: ['no_active_authorization'],
      }),
    }),
  );
}

/**
 * Slice "No-nonce trading" (D11): funded, NO nonce accounts, no
 * delegation — and the server does NOT count the empty pool against
 * readiness. The only thing left is the authorization, which is exactly
 * what the last card must let the user do.
 */
export function noncelessStatusBody(): Json {
  return statusBody(
    agentWalletBody({
      nonce_pool: noncePoolBody({
        active_count: 0,
        missing_slots: [0, 1, 2, 3, 4],
        complete: false,
      }),
      delegation: neverGrantedDelegationBody(),
      readiness: readinessBody({
        ready_to_trade: false,
        blockers: ['no_active_authorization'],
      }),
    }),
  );
}

/**
 * Everything a browser could look at says "ready" — funded, nonce pool
 * complete, delegation active, wallet enabled and unarchived — and the
 * SERVER says no, because a gate the page never sees (a disabled policy
 * version) is failing. Any UI that re-derives readiness from the visible
 * fields renders "ready to trade" here and is wrong.
 */
export function serverSaysNotReadyBody(): Json {
  return statusBody(
    agentWalletBody({
      readiness: readinessBody({
        ready_to_trade: false,
        blockers: ['policy_version_disabled'],
      }),
    }),
  );
}

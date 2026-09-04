/**
 * Wire + view types for the Component 4 agent-wallet surface.
 *
 * The agent wallet is a per-user SINGLETON resolved from the Clerk
 * session. No route in this port takes a wallet id, so nothing here
 * carries one as a request parameter — `wallet_account_id` appears only
 * as a value the server reported back.
 *
 * SERVER TRUTH: `readiness.ready_to_trade` is the server's boolean and
 * is carried through untouched. Nothing in this directory recomputes it
 * from the other fields, however derivable it looks — the gate ladder
 * lives in `api/src/routes/agent-wallet/state.ts` and it is the trade
 * path that is right when the two disagree.
 *
 * FORWARD COMPATIBILITY: every enum arrives as {@link EnumValue} — the
 * narrowed member when we recognise it, `null` plus the raw string when
 * we do not. An unrecognised value is rendered as an explicit degraded
 * state, never silently coerced into a known one and never dropped.
 */

/** A server enum, narrowed if recognised, preserved verbatim either way. */
export interface EnumValue<T extends string> {
  /** The narrowed member, or `null` when the server sent something new. */
  readonly known: T | null;
  /** Exactly what the server sent, for display in the degraded case. */
  readonly raw: string;
}

export type FundingState = 'unknown' | 'unfunded' | 'insufficient' | 'funded';
export type BalanceSource = 'rpc' | 'unavailable';
export type DelegationState = 'active' | 'paused' | 'revoked';
export type DelegationMode = 'session' | 'durable' | 'none';

/** Mirrors `READINESS_BLOCKERS` in `api/src/routes/agent-wallet/state.ts`. */
export type ReadinessBlocker =
  | 'agent_wallet_missing'
  | 'user_blocked'
  | 'not_provisioned_complete'
  | 'wallet_account_disabled'
  | 'wallet_disabled'
  | 'wallet_archived'
  | 'no_active_authorization'
  | 'policy_version_disabled'
  | 'authorization_revoked'
  | 'authorization_expired'
  | 'nonce_pool_incomplete';

export const READINESS_BLOCKERS: readonly ReadinessBlocker[] = [
  'agent_wallet_missing',
  'user_blocked',
  'not_provisioned_complete',
  'wallet_account_disabled',
  'wallet_disabled',
  'wallet_archived',
  'no_active_authorization',
  'policy_version_disabled',
  'authorization_revoked',
  'authorization_expired',
  'nonce_pool_incomplete',
];

export interface AgentWalletBalance {
  /** Confirmed lamports as a decimal string; `null` when the RPC was silent. */
  readonly lamports: string | null;
  readonly commitment: string;
  readonly source: EnumValue<BalanceSource>;
}

export interface AgentWalletFunding {
  readonly state: EnumValue<FundingState>;
  /** Lamports still needed to finish provisioning, as a decimal string. */
  readonly requiredLamports: string;
  readonly sufficient: boolean;
}

export interface AgentWalletNoncePool {
  readonly targetCount: number;
  readonly activeCount: number;
  readonly missingSlots: readonly number[];
  readonly failedSlots: readonly number[];
  readonly disabledSlots: readonly number[];
  readonly complete: boolean;
}

export interface AgentWalletDelegation {
  readonly state: EnumValue<DelegationState>;
  readonly mode: EnumValue<DelegationMode>;
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
  readonly authorizationExpiresAt: string | null;
}

export interface AgentWalletReadiness {
  /** THE SERVER'S BOOLEAN. Never recomputed in the browser. */
  readonly readyToTrade: boolean;
  readonly blockers: readonly EnumValue<ReadinessBlocker>[];
}

export interface AgentWalletStatus {
  readonly walletAccountId: string;
  readonly walletPubkey: string;
  /**
   * The address the user sends SOL to. Same value as `walletPubkey`,
   * named for what the UI must render it AS: there is no funding
   * endpoint and no transfer control — this string IS the mechanism.
   */
  readonly fundingAddress: string;
  readonly status: string;
  readonly isEnabled: boolean;
  readonly isArchived: boolean;
  readonly balance: AgentWalletBalance;
  readonly funding: AgentWalletFunding;
  readonly noncePool: AgentWalletNoncePool;
  readonly delegation: AgentWalletDelegation;
  readonly readiness: AgentWalletReadiness;
}

export interface AgentWalletCreated {
  readonly walletAccountId: string;
  readonly walletPubkey: string;
  readonly fundingAddress: string;
  /** True only for the call that actually made the wallet. */
  readonly created: boolean;
}

export type ReauthReason = 'no_session' | 'session_expired' | 'session_invalid';

/**
 * Every port call resolves to one of these. `reauth` is a 200 on the
 * wire, not an HTTP error, and must be presented as "sign in again" —
 * never as a failure.
 */
export type AgentWalletResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'reauth'; readonly reason: EnumValue<ReauthReason> }
  | { readonly kind: 'error'; readonly errorCode: string; readonly message: string };

export interface AgentWalletStatusPayload {
  /** User-level provisioning state; a free-form server string. */
  readonly provisioningState: string;
  /** `null` when no agent wallet exists for this user yet. */
  readonly agentWallet: AgentWalletStatus | null;
}

export interface AgentWalletRevokePayload {
  /** True only when THIS call flipped a live durable delegation. */
  readonly revoked: boolean;
  readonly delegation: AgentWalletDelegation;
}

export interface AgentWalletGrantPayload {
  /** True only when THIS call turned a non-durable authorization durable. */
  readonly granted: boolean;
  readonly delegation: AgentWalletDelegation;
}

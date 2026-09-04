'use client';

import { useMe, type MeResponse } from '@/lib/api/me';
import { pickDefaultExportWallet, pickPrimaryWalletEntry } from '@/lib/auth/wallet-export';
import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * One-time "auto-open" dismissal, scoped PER USER. Keyed by the Clerk
 * user id so switching accounts on the same browser does not inherit a
 * prior account's dismissal. Interim per-device flag; the durable
 * cross-device source of truth is the wallet-setup state derived from
 * `/me` (a user with a fully set-up wallet never needs onboarding).
 * A future server `onboarding_completed_at` flag can replace this.
 */
const ONBOARDING_SEEN_PREFIX = 'onboarding:seen:v1:';

function seenKey(userId: string): string {
  return `${ONBOARDING_SEEN_PREFIX}${userId}`;
}

export function hasSeenOnboarding(userId: string | null | undefined): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(seenKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(userId: string | null | undefined): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(seenKey(userId), 'true');
  } catch {
    // localStorage may be unavailable (private mode / restricted context);
    // the modal simply auto-opens again next time, which is acceptable.
  }
}

export interface WalletSetupStatus {
  /** `/me` has not resolved yet — callers should render nothing decisive. */
  loading: boolean;
  /** Wallet provisioned far enough that the onboarding steps function. */
  provisioned: boolean;
  /** Recovery key has been backed up for the primary wallet. */
  recoveryDone: boolean;
  /** Wallet fully set up (deposited + nonce setup) and ready to trade. */
  tradingReady: boolean;
}

const LOADING_STATUS: WalletSetupStatus = {
  loading: true,
  provisioned: false,
  recoveryDone: false,
  tradingReady: false,
};

// Query has settled but `/me` produced no usable payload (error / reauth /
// disabled). Distinct from LOADING_STATUS so callers don't wait forever.
const SETTLED_UNKNOWN_STATUS: WalletSetupStatus = {
  loading: false,
  provisioned: false,
  recoveryDone: false,
  tradingReady: false,
};

/** Pure derivation of wallet-setup state from an `/me` payload. */
export function deriveWalletSetupStatus(me: MeResponse | undefined): WalletSetupStatus {
  if (!me) return LOADING_STATUS;
  if (me.reauth_required) {
    return { loading: false, provisioned: false, recoveryDone: false, tradingReady: false };
  }
  const state = me.provisioning.state;
  const primary = pickPrimaryWalletEntry(me.wallets) ?? pickDefaultExportWallet(me.wallets);
  return {
    loading: false,
    provisioned: state === 'ready_to_trade' || state === 'wallet_ready_needs_nonce_setup',
    recoveryDone: primary?.backup_confirmed_at != null,
    tradingReady: state === 'ready_to_trade',
  };
}

/**
 * React hook wrapper over `deriveWalletSetupStatus`. Reports `loading`
 * only while the `/me` query is genuinely in flight; once settled with
 * no usable payload it returns a non-loading "unknown" status so the UI
 * doesn't hang (the pure helper keeps treating `undefined` as loading,
 * which is what the auto-open gate wants).
 */
export function useWalletSetupStatus(): WalletSetupStatus {
  const { data: me, isLoading } = useMe();
  if (isLoading) return LOADING_STATUS;
  if (!me || me.reauth_required) return SETTLED_UNKNOWN_STATUS;
  return deriveWalletSetupStatus(me);
}

/**
 * Dev-only preview override. On localhost the wallet can't reach
 * `ready_to_trade` (no trading engine to run nonce setup), which hides
 * the navbar SOL balance behind the "Finish Wallet Setup" button. When
 * `NEXT_PUBLIC_FORCE_WALLET_READY=true` (non-production only), the
 * balance renders so the design can be previewed. Hard-gated to
 * non-production so it can never affect the live site.
 */
export function isWalletReadyPreviewForced(): boolean {
  return process.env.NODE_ENV !== 'production' && getRuntimeConfig().forceWalletReady;
}

/** The three agent-wallet setup states worth looking at without a backend. */
export type AgentWalletSetupPreview = 'unfunded' | 'final' | 'ready';

const AGENT_WALLET_SETUP_PREVIEWS: readonly AgentWalletSetupPreview[] = [
  'unfunded',
  'final',
  'ready',
];

/**
 * Dev-only preview override for the agent-wallet setup chip + modal, the
 * sibling of {@link isWalletReadyPreviewForced}. On localhost the agent
 * wallet cannot reach any of these states (no trading engine to run the
 * nonce setup, no chain to fund it), so `NEXT_PUBLIC_FORCE_AGENT_WALLET_SETUP`
 * pins one of them and the surface renders from fixtures instead of the
 * network. Hard-gated to non-production, and an unrecognised value is
 * simply off.
 */
export function agentWalletSetupPreview(): AgentWalletSetupPreview | null {
  if (process.env.NODE_ENV === 'production') return null;
  const value = getRuntimeConfig().forceAgentWalletSetup;
  return AGENT_WALLET_SETUP_PREVIEWS.find((mode) => mode === value) ?? null;
}

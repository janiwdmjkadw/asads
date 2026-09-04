/**
 * Pure derivations behind the agent-wallet setup chip + modal.
 *
 * Nothing here fetches, and nothing here recomputes readiness: the chip
 * appears or not on `readiness.readyToTrade`, the server's boolean,
 * exactly as the rest of this directory does. What IS derived here is
 * how far along the three setup cards are — funding, nonce pool,
 * delegation — which are progress indicators, not gates.
 *
 * FAIL CLOSED: an agent-status query that has not settled, or settled
 * into `reauth`/`error`, is an UNKNOWN state, and unknown must render
 * today's navbar (the balance pill) rather than flashing a setup chip at
 * a user who may have nothing to set up.
 */

import type { AgentWalletSetupPreview } from '@/lib/auth/onboarding-status';
import { lamportsToSol } from './format';
import { parseStatusResponse } from './parse';
import { finalStepStatusBody, statusBody, unfundedStatusBody } from './test-fixtures';
import type { AgentWalletResult, AgentWalletStatus, AgentWalletStatusPayload } from './types';

/**
 * Rent-exempt minimum for a single durable nonce account (80-byte data,
 * ~0.00144768 SOL) — the same estimate the onboarding DepositCard uses.
 * Only consulted when the status route reports no shortfall of its own.
 */
const NONCE_RENT_LAMPORTS_PER_ACCOUNT = 1_447_680;

/** What the one wallet slot in the topnav renders. */
export type NavSlotState = 'none' | 'finish-setup' | 'agent-setup' | 'balance';

export interface NavSlotInput {
  readonly isSignedIn: boolean;
  /** `/me` resolved into a usable, non-reauth payload. */
  readonly meReady: boolean;
  /** The `/me`-derived wallet status is still in flight. */
  readonly walletLoading: boolean;
  readonly tradingReady: boolean;
  /** `null` while the agent-status query has not settled. */
  readonly agentStatus: AgentWalletResult<AgentWalletStatusPayload> | null;
}

/**
 * The whole navbar slot decision in one place. The first three arms are
 * today's behaviour untouched; the only new arm is `agent-setup`, which
 * takes the balance pill's place when the user can trade but their agent
 * wallet is not finished.
 */
export function deriveNavSlotState(input: NavSlotInput): NavSlotState {
  if (!input.isSignedIn) return 'none';
  if (!input.meReady) return 'none';
  if (!input.tradingReady) return input.walletLoading ? 'none' : 'finish-setup';
  return needsAgentSetup(input.agentStatus) ? 'agent-setup' : 'balance';
}

/** True only on a settled, successful status that says work is left. */
function needsAgentSetup(status: AgentWalletResult<AgentWalletStatusPayload> | null): boolean {
  if (status === null) return false;
  switch (status.kind) {
    case 'ok':
      return (
        status.value.agentWallet === null || status.value.agentWallet.readiness.readyToTrade === false
      );
    case 'reauth':
    case 'error':
      return false;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

// ───────── card states ─────────

/** Card 1. The address is always shown; funded collapses it to a receipt. */
export type DepositCardState =
  | { readonly kind: 'awaiting' }
  | { readonly kind: 'funded'; readonly balanceSol: string | null };

/** Card 2. `awaiting-funds` is a pending state, not a barricade. */
export type TradingCardState =
  | { readonly kind: 'awaiting-funds' }
  | { readonly kind: 'ready'; readonly missingCount: number }
  | { readonly kind: 'done'; readonly activeCount: number };

/**
 * Card 3. Since 2026-08-20 agent wallets are BORN with a durable
 * delegation, so `done` is what a new wallet arrives at and the other two
 * arms are the re-grant path after a revocation. `inForce` separates a
 * delegation that is live from one that is granted but waiting on the
 * steps above — both are done, only one is running.
 */
export type AuthorizeCardState =
  | { readonly kind: 'locked' }
  | { readonly kind: 'active' }
  | { readonly kind: 'done'; readonly inForce: boolean };

export interface SetupCards {
  readonly deposit: DepositCardState;
  readonly trading: TradingCardState;
  readonly authorize: AuthorizeCardState;
  /** THE SERVER'S BOOLEAN, carried through untouched. */
  readonly ready: boolean;
  /** One-time setup cost in SOL, or `null` when nothing reports one. */
  readonly setupCostSol: string | null;
  /**
   * Slice "No-nonce trading" (D11): the nonce pool is an offer, not a
   * step — the server does not count it against readiness.
   */
  readonly nonceOptional: boolean;
}

export function deriveSetupCards(wallet: AgentWalletStatus): SetupCards {
  // An unrecognised funding enum is treated as NOT funded — the same
  // fail-closed reading `fundingCopy` gives it.
  const funded = wallet.funding.state.known === 'funded';
  const provisioned = wallet.noncePool.complete;
  // Agent wallets are BORN with a durable delegation (owner, 2026-08-20),
  // so this step is reported, never requested. `paused` + `durable` is
  // the state a brand-new wallet sits in — granted, waiting on the steps
  // above — and treating it as unfinished would ask the user to perform a
  // grant the server answers `granted:false`. What still returns the step
  // to the ladder is the RE-GRANT path: revocation puts the row back in
  // session mode, and `paused` + `session` is a legacy wallet that never
  // had one. An unrecognised state stays fail-closed, as before.
  const delegationState = wallet.delegation.state.known;
  const delegated =
    delegationState === 'active' ||
    (delegationState === 'paused' && wallet.delegation.mode.known === 'durable');
  // Slice "No-nonce trading" (D11): still the SERVER's decision, read
  // off the blocker list rather than recomputed — an incomplete pool
  // that readiness does not blame is nonceless mode. Without this the
  // final card sits locked behind a pool that will never complete, and
  // the wallet can never be authorized.
  const nonceOptional =
    !provisioned &&
    !wallet.readiness.blockers.some((blocker) => blocker.known === 'nonce_pool_incomplete');

  return {
    deposit: funded
      ? { kind: 'funded', balanceSol: lamportsToSol(wallet.balance.lamports) }
      : { kind: 'awaiting' },
    trading: provisioned
      ? { kind: 'done', activeCount: wallet.noncePool.activeCount }
      : funded
        ? { kind: 'ready', missingCount: wallet.noncePool.missingSlots.length }
        : { kind: 'awaiting-funds' },
    authorize: delegated
      ? { kind: 'done', inForce: delegationState === 'active' }
      : provisioned || nonceOptional
        ? { kind: 'active' }
        : { kind: 'locked' },
    ready: wallet.readiness.readyToTrade,
    setupCostSol: setupCostSol(wallet),
    nonceOptional,
  };
}

/**
 * What the on-chain setup costs, in SOL. The status route's shortfall is
 * the real number and wins; once it is zero (funded, or already
 * provisioned) it says nothing about the cost, so the per-nonce rent
 * estimate stands in for the slots still to create.
 */
function setupCostSol(wallet: AgentWalletStatus): string | null {
  const required = lamportsToSol(wallet.funding.requiredLamports);
  if (required !== null && required !== '0') return required;
  const missing = wallet.noncePool.missingSlots.length;
  if (missing === 0) return null;
  return lamportsToSol(String(missing * NONCE_RENT_LAMPORTS_PER_ACCOUNT));
}

// ───────── modal view state ─────────

/**
 * What the modal body renders. `creating` is the auto-create round trip
 * the modal fires when it opens onto a user who has no agent wallet yet.
 */
export type SetupViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'cards'; readonly wallet: AgentWalletStatus; readonly cards: SetupCards };

export function deriveSetupView(
  status: AgentWalletResult<AgentWalletStatusPayload> | null,
): SetupViewState {
  if (status === null) return { kind: 'loading' };
  switch (status.kind) {
    case 'ok':
      return status.value.agentWallet === null
        ? { kind: 'creating' }
        : {
            kind: 'cards',
            wallet: status.value.agentWallet,
            cards: deriveSetupCards(status.value.agentWallet),
          };
    case 'reauth':
      return { kind: 'reauth' };
    case 'error':
      return { kind: 'error', message: status.message };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

// ───────── dev preview ─────────

/**
 * The fixture status behind `NEXT_PUBLIC_FORCE_AGENT_WALLET_SETUP`. It
 * runs the wire fixtures through the REAL parser, so a preview can never
 * show a shape the server could not send. Dev-only by its single caller:
 * `agentWalletSetupPreview()` returns `null` in production.
 */
export function agentWalletSetupPreviewStatus(
  mode: AgentWalletSetupPreview,
): AgentWalletResult<AgentWalletStatusPayload> {
  switch (mode) {
    case 'unfunded':
      return parseStatusResponse(unfundedStatusBody());
    case 'final':
      return parseStatusResponse(finalStepStatusBody());
    case 'ready':
      return parseStatusResponse(statusBody());
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

import type { MeWalletEntry } from '@/lib/api/me';
import type { NonceSetupResult } from '@/lib/api/wallet-nonce-setup';

/**
 * Flash — the productized face of per-wallet nonce setup.
 *
 * A wallet trades fine without it (the default lane). Enabling it pays a
 * one-time on-chain rent out of THAT wallet for five durable nonce
 * accounts, and from then on every order from the wallet races three
 * relays. Nothing about the machinery is new: this module is the pure
 * layer over `lib/api/wallet-nonce-setup` (user wallets) and
 * `components/agent-wallet/client` (the agent wallet), so the modal, the
 * portfolio bolt and the bell entry all agree without rendering React.
 *
 * Kept free of JSX on purpose — the branch table and the derived bell
 * list are the parts worth testing.
 */

/** Mirrors the api's `NONCE_COUNT_PER_USER` default. */
export const FLASH_TARGET_LANES = 5;

/** Typical five-nonce rent + fees; the placeholder shown while the real
 *  preflight cost is still in flight. */
export const FLASH_ESTIMATED_SOL = '0.0073';

/**
 * The identity + lane state Flash needs, normalized across the two
 * wallet sources. User wallets come from `/me`; the agent wallet is
 * deliberately absent from `/me` (the api filters `purpose = 'user'`)
 * and arrives via the agent-wallet status route the agent surfaces
 * already fetch — see `components/portfolio/agentWallet.ts`.
 */
export interface FlashWallet {
  readonly walletAccountId: string;
  readonly pubkey: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
  readonly isAgent: boolean;
  readonly isArchived: boolean;
  readonly targetCount: number;
  readonly activeCount: number;
}

export interface FlashLanes {
  readonly active: number;
  readonly target: number;
}

// ───────── identity ─────────

/**
 * Flash's own wallet naming. Deliberately NOT
 * `WalletSelector.walletDisplayName` — that one says "Primary" /
 * "Wallet 3", which reads as an index in Flash's document voice.
 */
export function flashWalletName(wallet: FlashWallet): string {
  const label = wallet.label?.trim();
  if (label) return label;
  if (wallet.isAgent) return 'Agent wallet';
  if (wallet.isPrimary) return 'Main wallet';
  return 'Wallet';
}

export function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

// ───────── lanes ─────────

export function flashLanes(wallet: FlashWallet): FlashLanes {
  const target =
    Number.isFinite(wallet.targetCount) && wallet.targetCount > 0
      ? Math.floor(wallet.targetCount)
      : FLASH_TARGET_LANES;
  const active =
    Number.isFinite(wallet.activeCount) && wallet.activeCount > 0
      ? Math.min(Math.floor(wallet.activeCount), target)
      : 0;
  return { active, target };
}

/** The pool is complete — Flash is already on for this wallet. */
export function isFlashOn(wallet: FlashWallet): boolean {
  const { active, target } = flashLanes(wallet);
  return active >= target;
}

// ───────── adapters ─────────

export function flashWalletFromEntry(
  entry: MeWalletEntry,
  options: { readonly isAgent?: boolean } = {},
): FlashWallet {
  return {
    walletAccountId: entry.wallet_account_id,
    pubkey: entry.wallet_pubkey,
    label: entry.label,
    isPrimary: entry.is_primary,
    isAgent: options.isAgent === true,
    isArchived: entry.is_archived,
    targetCount: entry.nonce_setup.target_count,
    activeCount: entry.nonce_setup.active_count,
  };
}

// ───────── state machine ─────────

export type FlashState =
  /** Preflight in flight — the offer renders with a placeholder price. */
  | { readonly kind: 'loading' }
  | { readonly kind: 'offer'; readonly costLamports: number | null; readonly notice: string | null }
  | { readonly kind: 'enabling' }
  | {
      readonly kind: 'needs_balance';
      readonly requiredLamports: number;
      readonly balanceLamports: number;
    }
  | { readonly kind: 'on' }
  | { readonly kind: 'partial' };

/**
 * The single branch table, shared by the preflight call and the live
 * execute call. `costLamports` is carried through the failure branches so
 * an error after a good preflight does not blank the price the user was
 * just looking at.
 *
 * Every branch lands on a state the user can act from — a dead-end that
 * leaves the button spinning is the failure mode this shape exists to
 * prevent.
 */
export function nextFlashState(
  result: NonceSetupResult,
  ctx: { readonly costLamports: number | null },
): FlashState {
  switch (result.kind) {
    case 'preflight': {
      const p = result.preflight;
      if (p.target_count > 0 && p.existing_count >= p.target_count) return { kind: 'on' };
      if (!p.sufficient) {
        return {
          kind: 'needs_balance',
          requiredLamports: p.estimated_cost_lamports,
          balanceLamports: p.wallet_balance_lamports,
        };
      }
      return { kind: 'offer', costLamports: p.estimated_cost_lamports, notice: null };
    }
    case 'ok':
      return result.setup.total_count >= result.setup.target_count
        ? { kind: 'on' }
        : { kind: 'partial' };
    case 'insufficient_balance':
      return {
        kind: 'needs_balance',
        requiredLamports: result.required_lamports,
        balanceLamports: result.observed_balance_lamports,
      };
    case 'partial_failure':
      return { kind: 'partial' };
    case 'reauth':
      return {
        kind: 'offer',
        costLamports: ctx.costLamports,
        notice: 'Your session expired. Sign in again to enable Flash.',
      };
    case 'wrong_state':
      return {
        kind: 'offer',
        costLamports: ctx.costLamports,
        notice: 'This wallet is not ready for Flash yet.',
      };
    case 'error':
      return {
        kind: 'offer',
        costLamports: ctx.costLamports,
        notice: flashErrorCopy(result.errorCode),
      };
  }
}

export function flashErrorCopy(errorCode: string): string {
  switch (errorCode) {
    case 'trading_engine_unavailable':
    case 'trading_engine_timeout':
      return 'Trading engine unavailable. Try again in a moment.';
    case 'no_active_authorization':
      return 'Your trading authorization expired. Try again to refresh it.';
    case 'signer_material_missing':
      return 'Wallet signer material is not available. Refresh and try again.';
    case 'nonce_setup_rpc_unavailable':
      return 'Solana RPC is unreachable. Try again in a moment.';
    case 'network_error':
      return 'Network error. Check your connection and try again.';
    case 'shape_mismatch':
      return 'Got an unexpected response. Try again.';
    default:
      return `Could not enable Flash (${errorCode}). Try again.`;
  }
}

/** The state a freshly-opened modal starts in for this wallet. */
export function initialFlashState(wallet: FlashWallet): FlashState {
  return isFlashOn(wallet) ? { kind: 'on' } : { kind: 'loading' };
}

/** True while the flow owns the wallet — the dialog must not close and
 *  the price/offer controls must not be reachable. */
export function isFlashRunning(state: FlashState): boolean {
  return state.kind === 'enabling';
}

/**
 * The single-flight guard. Flash is ONE click — there is no confirm step,
 * so the button that fires the live setup is the same button a user can
 * hit twice in a frame. The second press must issue nothing: the server
 * serializes it on an advisory lock, and the loser holds a connection for
 * the full ten seconds to perform an idempotent no-op.
 */
export function shouldFireEnable(state: FlashState): boolean {
  return state.kind !== 'enabling';
}

// ───────── formatting ─────────

/** Lamports → SOL, fixed 4dp. The modal's price and ledger voice. */
export function formatSol(lamports: number | null, decimals = 4): string {
  if (lamports === null || !Number.isFinite(lamports) || lamports <= 0) {
    return (0).toFixed(decimals);
  }
  return (lamports / 1e9).toFixed(decimals);
}

export function laneLabel(lanes: FlashLanes): string {
  return `LANE ${lanes.active} OF ${lanes.target}`;
}

export function activeLanesLabel(lanes: FlashLanes): string {
  return `${lanes.target} OF ${lanes.target} FLASH LANES ACTIVE`;
}

// ───────── derived notifications ─────────

export interface FlashNotice {
  readonly walletAccountId: string;
  readonly name: string;
  readonly title: string;
  readonly hint: string;
}

export const FLASH_NOTICE_HINT = 'Pay once, trade lightning-fast';

/**
 * The bell's Flash entries are DERIVED, never stored: one per Solana
 * wallet whose lane pool is incomplete. They are not dismissable — the
 * entry exists exactly as long as the condition does, and vanishes on the
 * next `/me` refresh once the pool completes.
 */
export function deriveFlashNotices(
  wallets: ReadonlyArray<FlashWallet>,
): ReadonlyArray<FlashNotice> {
  const notices: FlashNotice[] = [];
  for (const wallet of wallets) {
    if (wallet.isArchived) continue;
    if (isFlashOn(wallet)) continue;
    const name = flashWalletName(wallet);
    notices.push({
      walletAccountId: wallet.walletAccountId,
      name,
      title: `Flash available — ${name}`,
      hint: FLASH_NOTICE_HINT,
    });
  }
  return notices;
}

// ───────── copy ─────────

export const FLASH_COPY = {
  offerTitle: 'Flash',
  offerPitch:
    "Pay once. This wallet's trades go lightning-fast, forever. The fee never goes to Listen.",
  forLabel: 'FOR',
  benefits: [
    'Lightning-fast transactions',
    '3× the routes to every block',
    'Works on every order — automatically, forever',
  ],
  priceCaption: 'one-time · stays on-chain, yours',
  maybeLater: 'Maybe later',
  enableCta: 'Enable Flash',

  enablingTitle: 'Enabling Flash',
  enablingBody:
    'Five small transactions are signing themselves — about ten seconds. Keep this open.',
  enablingCta: 'Enabling…',

  needsBalanceTitle: 'Top up to enable Flash',
  needsBalanceBody:
    'Flash rent comes from this wallet. Add a little SOL and one click enables it.',
  depositCta: 'Deposit SOL',

  onTitle: 'Flash is on',
  onBody:
    'Every order from this wallet now races three relays. Nothing else to do, it works automatically.',
  onFooter: 'Enable it on your other wallets from their wallet panel.',
  onCta: 'Done',

  partialBody: "A lane didn't confirm. Retry finishes the remaining ones.",
  partialCta: 'Retry remaining lanes',
} as const;

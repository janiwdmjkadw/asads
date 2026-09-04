'use client';

/**
 * EVM quickbuy — the one-click buy for chain-bound discover rows.
 *
 * ## The preset is NATIVE-DENOMINATED, per chain, and never converted
 *
 * Solana's quickbuy sizes come from `quickBuyAmountsBySection`, and every one
 * of those amounts is a number of SOL. Spending "0.5" of BNB where the user
 * configured 0.5 SOL is roughly five times the intended value; converting SOL
 * to BNB silently would spend an amount the user never chose at a rate they
 * never saw. So the EVM quickbuy has its OWN preset — a decimal amount of the
 * chain's native coin, keyed per chain, configured explicitly by the user —
 * and until one is configured the control does not spend. No default, no
 * conversion, no fallback: the Solana trade store is untouched.
 *
 * ## The submit is the panel's submit core, not a copy
 *
 * `buildEvmOrderBody` / `submitEvmOrder` / the pending-order correlation
 * record are the SAME functions the trade panel uses, so the wire shape, the
 * retry discipline and the money-safety rules cannot drift between the two
 * surfaces. The pending record is written BEFORE the POST and retained on any
 * unknown outcome, so the token's trade page restores and reconciles the
 * order exactly as it does for its own submits.
 */

import { useSyncExternalStore } from 'react';

import {
  listEvmWalletBalances,
  type EvmWalletBalancesResult,
} from '@/lib/api/evm-wallet-balances';
import { parseDecimalAmount } from '@/lib/evm/amount';
import { EVM_NATIVE_DECIMALS } from '@/lib/evm/money';
import { pickEvmWalletForChain, readEvmWalletSelection } from '@/lib/evm/useEvmWallets';
import {
  buildEvmOrderBody,
  evmOrderFingerprint,
  evmRefusalText,
  fitsWireAmount,
  isEvmRefusalPossiblyLive,
  submitEvmOrder,
} from '@/lib/evm/orderApi';
import {
  browserEvmOrderStorage,
  clearPendingEvmOrder,
  fetchEvmOrderStatus,
  readPendingEvmOrder,
  writePendingEvmOrder,
  type EvmOrderStatus,
} from '@/lib/evm/orderStatusApi';

/**
 * Same tolerance as the trade panel's default (`DEFAULT_SLIPPAGE_BPS`): both
 * wave-1 venues are launchpad markets where a tighter tolerance reverts the
 * order and charges the gas anyway.
 */
export const EVM_QUICKBUY_SLIPPAGE_BPS = 300;

const PRESET_KEY_PREFIX = 'listen.evm.quickbuy-native.v1:';
/** Fired on every preset write so mounted cards re-read without a reload. */
export const EVM_QUICKBUY_CHANGED_EVENT = 'listen:evm-quickbuy-changed';

export function evmQuickbuyStorageKey(chain: string): string {
  return `${PRESET_KEY_PREFIX}${encodeURIComponent(chain)}`;
}

/**
 * The preset text as wei, or `null` when it is not a positive decimal amount.
 * The same string-surgery parser the panel's amount box uses — no floats.
 */
export function parseEvmQuickbuyAmount(text: string): bigint | null {
  const parsed = parseDecimalAmount(text, EVM_NATIVE_DECIMALS);
  if (parsed.kind !== 'ok' || parsed.baseUnits <= 0n) return null;
  if (!fitsWireAmount(parsed.baseUnits.toString(), 'buy')) return null;
  return parsed.baseUnits;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = ReadStorage & Pick<Storage, 'setItem' | 'removeItem'>;

/** The stored preset text, or `null` when unset or unparseable. */
export function readEvmQuickbuyAmountText(
  storage: ReadStorage | null | undefined,
  chain: string,
): string | null {
  if (storage == null) return null;
  try {
    const raw = storage.getItem(evmQuickbuyStorageKey(chain));
    if (raw === null) return null;
    // A corrupted value reads as unset, never as some amount: the control
    // must not spend a figure nobody can parse.
    return parseEvmQuickbuyAmount(raw) === null ? null : raw;
  } catch {
    return null;
  }
}

export type EvmQuickbuyWriteResult = 'saved' | 'cleared' | 'invalid';

export function writeEvmQuickbuyAmountText(
  storage: WriteStorage | null | undefined,
  chain: string,
  text: string,
): EvmQuickbuyWriteResult {
  if (storage == null) return 'invalid';
  const trimmed = text.trim();
  try {
    if (trimmed === '') {
      storage.removeItem(evmQuickbuyStorageKey(chain));
      announcePresetChange();
      return 'cleared';
    }
    if (parseEvmQuickbuyAmount(trimmed) === null) return 'invalid';
    storage.setItem(evmQuickbuyStorageKey(chain), trimmed);
    announcePresetChange();
    return 'saved';
  } catch {
    return 'invalid';
  }
}

function announcePresetChange(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(EVM_QUICKBUY_CHANGED_EVENT));
  }
}

function subscribeToPresetChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVM_QUICKBUY_CHANGED_EVENT, callback);
  // Cross-tab edits arrive as the browser's own storage event.
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVM_QUICKBUY_CHANGED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

/**
 * The configured preset text for a chain, live across same-tab writes and
 * cross-tab storage events. `null` on the server snapshot, so SSR and the
 * hydration pass render the no-preset control and the client corrects after
 * mount — the same client-only-preset pattern the Solana quickbuy uses.
 */
export function useEvmQuickbuyAmountText(chain: string): string | null {
  return useSyncExternalStore(
    subscribeToPresetChanges,
    () =>
      readEvmQuickbuyAmountText(
        browserEvmOrderStorage(),
        chain,
      ),
    () => null,
  );
}

export type EvmQuickbuyOutcome =
  /** Receipt observed; the pending record stays for finality reconciliation. */
  | { kind: 'accepted'; clientOrderId: string; txHash: string | null }
  | { kind: 'reauth' }
  | { kind: 'no_wallet'; text: string }
  /** The wallet READ failed — says nothing about whether wallets exist. */
  | { kind: 'wallets_unreadable'; text: string }
  /** A proven refusal: nothing was sent. */
  | { kind: 'refused'; code: string; text: string }
  /**
   * The outcome is UNKNOWN — the transaction may be live. The pending record
   * is retained; the token's trade page restores it and reconciles against
   * the authoritative order status. Callers must not offer a retry.
   */
  | { kind: 'unresolved'; text: string }
  /** An earlier order for this exact chain/token still owns the recovery slot. */
  | { kind: 'duplicate_pending'; clientOrderId: string; text: string }
  | { kind: 'storage_unavailable'; text: string };

export type EvmQuickbuyFinalityOutcome =
  | { kind: 'filled'; txHash: string | null }
  | { kind: 'refused'; text: string }
  | { kind: 'unresolved'; text: string };

export type EvmQuickbuyFinalityTransition =
  | { kind: 'finalizing'; txHash: string | null }
  | { kind: 'reorged'; text: string };

export interface WaitForEvmQuickbuyFinalityInput {
  readonly chain: string;
  readonly token: string;
  readonly clientOrderId: string;
  readonly storage?: Pick<Storage, 'removeItem'> & Partial<Pick<Storage, 'getItem'>> | null;
  readonly statusLoader?: (
    chain: string,
    clientOrderId: string,
    token?: string,
  ) => Promise<EvmOrderStatus>;
  readonly wait?: () => Promise<void>;
  readonly maxAttempts?: number;
  readonly onTransition?: (transition: EvmQuickbuyFinalityTransition) => void;
}

const ROBINHOOD_FINALITY_POLL_MS = 5_000;
const ROBINHOOD_FINALITY_WINDOW_MS = 20 * 60_000;
const BSC_FINALITY_POLL_MS = 1_000;
const BSC_FINALITY_WINDOW_MS = 60_000;

/**
 * A mined receipt is not the terminal outcome. Poll the EVM-specific durable
 * order record until the canonical fill exists, the order is proved refused,
 * or the bounded foreground wait expires. The pending browser record remains
 * on every unresolved branch so the trade page can continue reconciliation.
 */
export async function waitForEvmQuickbuyFinality(
  input: WaitForEvmQuickbuyFinalityInput,
): Promise<EvmQuickbuyFinalityOutcome> {
  const load = input.statusLoader ?? (
    (chain: string, clientOrderId: string, token?: string) =>
      fetchEvmOrderStatus(chain, clientOrderId, undefined, token)
  );
  const pollMs = input.chain === 'robinhood_chain'
    ? ROBINHOOD_FINALITY_POLL_MS
    : BSC_FINALITY_POLL_MS;
  const windowMs = input.chain === 'robinhood_chain'
    ? ROBINHOOD_FINALITY_WINDOW_MS
    : BSC_FINALITY_WINDOW_MS;
  const wait = input.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, pollMs)));
  const attempts = input.maxAttempts ?? Math.ceil(windowMs / pollMs);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await load(input.chain, input.clientOrderId, input.token);
    if (status.kind === 'order' && status.state === 'filled') {
      if (input.storage != null) {
        clearPendingEvmOrder(input.storage, {
          chain: input.chain,
          clientOrderId: input.clientOrderId,
        });
      }
      return { kind: 'filled', txHash: status.txHash };
    }
    if (
      status.kind === 'order' &&
      (status.state === 'refused' || (status.safeToRetry && !status.mayBeLive))
    ) {
      if (input.storage != null) {
        clearPendingEvmOrder(input.storage, {
          chain: input.chain,
          clientOrderId: input.clientOrderId,
        });
      }
      return {
        kind: 'refused',
        text: status.refusedReason ?? 'The order was not filled. Nothing is pending on chain.',
      };
    }
    if (
      status.kind === 'order'
      && (status.state === 'pending_dispatch' || status.state === 'pending_finality')
    ) {
      input.onTransition?.({ kind: 'finalizing', txHash: status.txHash });
    } else if (status.kind === 'order' && status.state === 'indeterminate') {
      input.onTransition?.({
        kind: 'reorged',
        text: status.refusedReason
          ?? 'The included transaction is no longer canonical. Finality reconciliation is continuing.',
      });
    }
    if (attempt + 1 < attempts) await wait();
  }
  return {
    kind: 'unresolved',
    text: 'A receipt was observed, but canonical finality is still pending. Open the token page to keep checking; do not place the order again.',
  };
}

export interface SubmitEvmQuickbuyInput {
  /** Storage tag — `bsc` | `robinhood_chain`. */
  readonly chain: string;
  /** Lowercase 0x token address. */
  readonly address: string;
  /** The preset, already parsed to wei. */
  readonly amountWei: bigint;
  readonly authToken?: string | null;
  /** Injected by tests. Production uses `window.localStorage`. */
  readonly storage?: WriteStorage | null;
  readonly submitImpl?: typeof submitEvmOrder;
  readonly walletsLoader?: () => Promise<EvmWalletBalancesResult>;
  readonly newClientOrderId?: () => string;
}

const ACTIVE_QUICKBUY_SUBJECTS = new Set<string>();

function defaultClientOrderId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `evmqb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Submit one quickbuy. One press = one order = one fresh id; there is no
 * retry surface here at all — an unknown outcome parks behind the pending
 * record and the trade page's reconciliation, exactly like the panel.
 */
export async function submitEvmQuickbuy(
  input: SubmitEvmQuickbuyInput,
): Promise<EvmQuickbuyOutcome> {
  const storage =
    input.storage !== undefined
      ? input.storage
      : browserEvmOrderStorage();
  const subject = `${input.chain}:${input.address.toLowerCase()}`;
  if (storage !== null) {
    const pending = readPendingEvmOrder(storage, { chain: input.chain, token: input.address });
    if (pending !== null) {
      return {
        kind: 'duplicate_pending',
        clientOrderId: pending.clientOrderId,
        text: 'An order for this token is already included or still reconciling. Wait for finality before submitting again.',
      };
    }
  }
  if (ACTIVE_QUICKBUY_SUBJECTS.has(subject)) {
    return {
      kind: 'duplicate_pending',
      clientOrderId: '',
      text: 'An order for this token is already being submitted. Wait for its outcome.',
    };
  }
  ACTIVE_QUICKBUY_SUBJECTS.add(subject);
  try {
  const wallets = await (input.walletsLoader ?? (() => listEvmWalletBalances()))();
  if (wallets.kind === 'reauth') return { kind: 'reauth' };
  if (wallets.kind !== 'ok') {
    return {
      kind: 'wallets_unreadable',
      text: 'Your wallets could not be read, so the order was not sent. This says nothing about whether they exist.',
    };
  }
  const wallet = pickEvmWalletForChain(
    wallets.balances,
    input.chain,
    readEvmWalletSelection(storage, input.chain),
  );
  if (wallet === null) {
    return {
      kind: 'no_wallet',
      text: 'No trade-eligible wallet on this chain yet, so the order was not sent.',
    };
  }

  const clientOrderId = (input.newClientOrderId ?? defaultClientOrderId)();
  const body = buildEvmOrderBody({
    clientOrderId,
    chain: input.chain,
    side: 'buy',
    token: input.address,
    walletAccountId: wallet.wallet_account_id,
    baseUnits: input.amountWei,
    slippageBps: EVM_QUICKBUY_SLIPPAGE_BPS,
    clientTsMs: Date.now(),
  });

  if (
    storage === null ||
    !writePendingEvmOrder(storage, {
      chain: input.chain,
      token: input.address,
      clientOrderId,
      fingerprint: evmOrderFingerprint(body),
      walletAccountId: wallet.wallet_account_id,
      walletAddress: wallet.wallet_pubkey,
    })
  ) {
    // Same rule as the panel: no durable correlation id, no order. A spend
    // whose outcome this browser cannot later reconcile is not placeable
    // from a fire-and-forget control.
    return {
      kind: 'storage_unavailable',
      text: 'This browser cannot preserve the order correlation id, so the order was not submitted.',
    };
  }

  const result = await (input.submitImpl ?? submitEvmOrder)(body, {
    authToken: input.authToken,
  });
  switch (result.kind) {
    case 'accepted':
      // The record is RETAINED: receipt inclusion is not canonical finality,
      // and the token's trade page keeps polling this id until the durable
      // fill exists (or restores it after a reload).
      return { kind: 'accepted', clientOrderId, txHash: result.ack.txHash };
    case 'reauth':
      clearPendingEvmOrder(storage, { chain: input.chain, clientOrderId });
      return { kind: 'reauth' };
    case 'refused':
      if (isEvmRefusalPossiblyLive(result)) {
        return { kind: 'unresolved', text: evmRefusalText(result) };
      }
      clearPendingEvmOrder(storage, { chain: input.chain, clientOrderId });
      return { kind: 'refused', code: result.errorCode, text: evmRefusalText(result) };
    case 'may_be_live':
      return { kind: 'unresolved', text: result.reason };
    case 'indeterminate':
      return { kind: 'unresolved', text: result.reason };
  }
  } finally {
    ACTIVE_QUICKBUY_SUBJECTS.delete(subject);
  }
}

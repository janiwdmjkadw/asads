'use client';

/**
 * EVM wallets panel — addresses and native balances for every EVM wallet the
 * user owns.
 *
 * The gap this closes: WP-202 mints secp256k1 addresses and
 * `GET /api/v1/wallets/evm-balances` has served their balances since the EVM
 * wave, but nothing in the terminal called it and nothing rendered the
 * addresses. A user with a provisioned EVM wallet had no way to see it, and
 * `/me.wallets`' EVM rows are dropped by that parser on purpose (see
 * `lib/api/me.ts`). This panel is the surface.
 *
 * Rendering doctrine:
 * - **`null` wei is UNKNOWN, and which kind of unknown is said out loud.**
 *   `unconfigured` = this chain has no RPC configured, `unavailable` = the
 *   read failed. Neither is "0" — telling a user with a funded wallet that
 *   it is empty is the worst possible error on this screen.
 * - **Per-row degradation.** One chain's RPC being down leaves the other
 *   chain's real balances intact, exactly as the route computes them.
 * - **No balance touches a JS number.** `formatUnits` is BigInt-only, and
 *   the decimals come from the wire rather than from an assumption (this
 *   endpoint, unlike the ingestion read API, serves `native_decimals`).
 * - **Deposit addresses have separate authority.** Balance-row addresses are
 *   storage identity only. The panel displays and copies a server-validated
 *   target only after an exact wallet-account/chain join; every mismatch or
 *   request failure removes the address and copy action.
 * - **A session failure is not an infrastructure failure.** `reauth` used to
 *   collapse into "Couldn't read your EVM wallets", which sends a user whose
 *   session merely expired to look for an outage. The three reauth reasons
 *   the client already distinguishes are surfaced.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, useClerk, useReverification } from '@clerk/nextjs';

import {
  EVM_WALLETS_CHANGED_EVENT,
  listEvmWalletBalances,
  repairEvmWallets,
  reconcileEvmWalletsAfterCreation,
  type EvmWalletBalance,
  type EvmWalletBalancesResult,
  type EvmWalletRepairResult,
} from '@/lib/api/evm-wallet-balances';
import {
  findEvmDepositTarget,
  indexEvmDepositTargets,
  listEvmDepositTargets,
  type EvmDepositTarget,
  type EvmDepositTargetsResult,
} from '@/lib/api/evm-deposit-addresses';
import { formatUnits, formatWeiUsd } from '@/lib/evm/money';
import {
  discoverHrefForChain,
  parseDiscoverChain,
} from '@/lib/evm/chains';
import { parseDecimalAmount } from '@/lib/evm/amount';
import {
  withdrawEvmNative,
  type WithdrawEvmInput,
  type WithdrawEvmOptions,
  type WithdrawEvmResult,
} from '@/lib/api/wallets';
import {
  clearPendingEvmWithdrawal,
  readPendingEvmWithdrawal,
  replayPendingEvmWithdrawal,
  withdrawalAmountText,
  withdrawalRecoveryDisposition,
  writePendingEvmWithdrawal,
} from '@/lib/evm/withdrawalRecovery';
import {
  toEvmWithdrawalReverification,
  withdrawalVerificationFailureUi,
} from '@/lib/evm/withdrawalReverification';

const CHAIN_LABELS: Record<string, string> = {
  bsc: 'BSC',
  robinhood_chain: 'Robinhood',
  ethereum: 'Ethereum',
  base: 'Base',
};

export function evmWithdrawalRequestOptions(
  authToken: string | null,
  checking: boolean,
): WithdrawEvmOptions {
  return checking
    ? { authToken, skipDestinationPreflight: true }
    : { authToken };
}

export interface EvmWalletsPanelProps {
  /** Injected by tests; production uses the module's authenticated fetch. */
  loader?: () => Promise<EvmWalletBalancesResult>;
  depositLoader?: () => Promise<EvmDepositTargetsResult>;
  repairer?: () => Promise<EvmWalletRepairResult>;
}

export interface EvmWalletPanelState {
  readonly result: EvmWalletBalancesResult | null;
  readonly deposits: EvmDepositTargetsResult | null;
}

export type EvmWalletPanelEvent =
  | { readonly type: 'load_started' }
  | {
      readonly type: 'load_finished';
      readonly result: EvmWalletBalancesResult;
      readonly deposits: EvmDepositTargetsResult;
    };

export const EVM_WALLET_PANEL_INITIAL_STATE: EvmWalletPanelState = {
  result: null,
  deposits: null,
};

export function evmWalletPanelReducer(
  _state: EvmWalletPanelState,
  event: EvmWalletPanelEvent,
): EvmWalletPanelState {
  if (event.type === 'load_started') return EVM_WALLET_PANEL_INITIAL_STATE;
  return { result: event.result, deposits: event.deposits };
}

export function EvmWalletsPanel({ loader, depositLoader, repairer }: EvmWalletsPanelProps) {
  const [{ result, deposits }, dispatch] = useReducer(
    evmWalletPanelReducer,
    EVM_WALLET_PANEL_INITIAL_STATE,
  );
  const resultRef = useRef<EvmWalletBalancesResult | null>(null);
  resultRef.current = result;
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  const loadBalances = useCallback(
    (signal?: AbortSignal) => (loader ?? (() => listEvmWalletBalances({ signal })))(),
    [loader],
  );
  const loadDeposits = useCallback(
    (signal?: AbortSignal) => (depositLoader ?? (() => listEvmDepositTargets({ signal })))(),
    [depositLoader],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // Drop every previous target before either request begins. A slow,
      // failed, or aborted refresh can never leave a stale address copyable.
      dispatch({ type: 'load_started' });
      const [next, nextDeposits] = await Promise.all([
        loadBalances(signal),
        loadDeposits(signal),
      ]);
      if (signal?.aborted !== true) {
        dispatch({ type: 'load_finished', result: next, deposits: nextDeposits });
      }
    },
    [loadBalances, loadDeposits],
  );

  const repair = useCallback(async () => {
    if (repairing) return;
    setRepairing(true);
    setRepairMessage(null);
    try {
      const outcome = await (repairer ?? repairEvmWallets)();
      if (outcome.kind === 'ok' && outcome.repaired > 0) {
        if (outcome.failed > 0) {
          setRepairMessage(
            `Some EVM wallets completed; ${outcome.failed} still need retry. Refreshing balances...`,
          );
        } else {
          setRepairMessage(
            outcome.status === 'repaired'
              ? 'EVM wallet setup completed. Refreshing balances…'
              : 'EVM wallet setup is complete. Refreshing balances…',
          );
        }
        await load();
      } else if (outcome.kind === 'ok' && outcome.status === 'already_complete') {
        setRepairMessage('EVM wallet setup is complete. Refreshing balances…');
        await load();
      } else if (outcome.kind === 'reauth') {
        setRepairMessage('Sign in again to finish EVM wallet setup.');
      } else if (outcome.kind === 'network_error') {
        setRepairMessage('EVM wallet setup could not be reached. Try again shortly.');
      } else {
        setRepairMessage('EVM wallet setup did not complete. Try again shortly.');
      }
    } catch {
      setRepairMessage('EVM wallet setup could not be reached. Try again shortly.');
    } finally {
      setRepairing(false);
    }
  }, [load, repairer, repairing]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const refresh = (reconcile: boolean) => {
      // Wallet creation can race the initial read. Abort the older request so
      // its pre-create response cannot land after the fresh one and erase the
      // new companion wallets from the panel.
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      if (!reconcile) {
        void load(signal);
        return;
      }
      dispatch({ type: 'load_started' });
      void reconcileEvmWalletsAfterCreation({
        previous: resultRef.current,
        load: () => loadBalances(signal),
        signal,
      }).then(async (next) => {
        if (next === null || signal.aborted) return;
        const nextDeposits = await loadDeposits(signal);
        if (!signal.aborted) {
          dispatch({ type: 'load_finished', result: next, deposits: nextDeposits });
        }
      });
    };
    const onWalletsChanged = () => refresh(true);
    refresh(false);
    globalThis.addEventListener(EVM_WALLETS_CHANGED_EVENT, onWalletsChanged);
    return () => {
      globalThis.removeEventListener(EVM_WALLETS_CHANGED_EVENT, onWalletsChanged);
      controller?.abort();
    };
  }, [load, loadBalances, loadDeposits]);

  if (result === null || deposits === null) {
    return (
      <section
        aria-label="EVM wallets"
        data-testid="evm-wallets-loading"
        className="rounded-lg border p-3 text-xs text-muted-foreground"
      >
        Loading EVM wallets…
      </section>
    );
  }

  const reauth = result.kind === 'reauth' ? result : deposits.kind === 'reauth' ? deposits : null;
  if (reauth !== null) {
    /* A SESSION problem, said as one. Collapsing this into the generic read
       failure below sends a user whose session expired to look for an
       outage — the remedy is signing in again, and nothing else. */
    return (
      <section
        aria-label="EVM wallets"
        data-testid="evm-wallets-reauth"
        className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
      >
        <h3 className="text-sm font-semibold">EVM wallets</h3>
        <p className="mt-1">
          {reauth.reason === 'no_session'
            ? 'You are not signed in, so your wallets were not read.'
            : reauth.reason === 'session_expired'
              ? 'Your session expired, so your wallets were not read. Sign in again.'
              : 'Your session was rejected, so your wallets were not read. Sign in again.'}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold"
          data-testid="evm-wallets-reauth-retry"
        >
          Retry
        </button>
      </section>
    );
  }

  if (result.kind !== 'ok') {
    return (
      <section
        aria-label="EVM wallets"
        data-testid="evm-wallets-error"
        className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
      >
        <h3 className="text-sm font-semibold">EVM wallets</h3>
        <p className="mt-1">
          {/* NOT rendered as "no EVM wallets". A failed read says nothing
              about whether the user has one. */}
          Couldn&apos;t read your EVM wallets
          {result.kind === 'error' ? ` (HTTP ${result.status})` : ''}. This says
          nothing about whether they exist.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold"
          data-testid="evm-wallets-error-retry"
        >
          Retry
        </button>
      </section>
    );
  }

  if (result.balances.length === 0) {
    return (
      <section
        aria-label="EVM wallets"
        data-testid="evm-wallets-empty"
        className="rounded-lg border p-3 text-xs text-muted-foreground"
      >
        <h3 className="text-sm font-semibold">EVM wallets</h3>
        <p className="mt-1">No EVM wallets provisioned for this account.</p>
        <p className="mt-1" data-testid="evm-wallets-empty-how">
          EVM wallets are created automatically alongside your Solana wallets. If the initial setup
          missed this account, finish it securely here now.
        </p>
        <button
          type="button"
          onClick={() => void repair()}
          disabled={repairing}
          className="mt-2 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold"
          data-testid="evm-wallets-empty-repair"
        >
          {repairing ? 'Finishing setup…' : 'Finish EVM setup'}
        </button>
        {repairMessage !== null && (
          <p className="mt-1" role="status" data-testid="evm-wallets-repair-status">
            {repairMessage}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-label="EVM wallets" data-testid="evm-wallets" className="rounded-lg border p-3">
      <h3 className="mb-2 text-sm font-semibold">EVM wallets</h3>
      <EvmWalletRows
        balances={result.balances}
        deposits={deposits}
        onConfirmed={() => void load()}
      />
      <p className="mt-2 text-[10px] text-muted-foreground">
        Deposit only to a checksummed address shown above.{' '}
        <strong>Each address is chain-scoped:</strong> if an address is unavailable, do not send.
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground" data-testid="evm-wallets-withdraw-note">
        Native sends require a recent authentication challenge. One-to-one transfers to another
        owned wallet use the same verified withdrawal path. Advanced orders and multi-wallet
        distribute/consolidate are not available for EVM yet; quick-buy and equal-split market
        batches are configured on the trade surfaces.
      </p>
    </section>
  );
}

export function EvmWalletRows({
  balances,
  deposits,
  onConfirmed,
}: {
  readonly balances: ReadonlyArray<EvmWalletBalance>;
  readonly deposits: EvmDepositTargetsResult;
  readonly onConfirmed: () => void;
}) {
  const indexed =
    deposits.kind === 'ok'
      ? indexEvmDepositTargets(deposits.targets)
      : new Map<string, EvmDepositTarget>();
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {balances.map((balance) => (
          <EvmWalletRow
            key={`${balance.chain}:${balance.wallet_account_id}`}
            balance={balance}
            depositTarget={findEvmDepositTarget(indexed, balance.wallet_account_id, balance.chain)}
            ownedTargets={ownedEvmTransferTargets(indexed, balance)}
            onConfirmed={onConfirmed}
          />
        ))}
      </ul>
      {deposits.kind !== 'ok' && deposits.kind !== 'reauth' ? (
        <p className="mt-2 text-[10px] text-muted-foreground" data-testid="evm-deposit-unavailable">
          Deposit addresses could not be verified. Do not send funds until retry succeeds.
        </p>
      ) : null}
    </>
  );
}

function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={`evm-wallet-copy-${address}`}
      aria-label={`Copy ${address}`}
      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold"
      onClick={() => {
        // Best-effort: a blocked clipboard must not throw into render. The
        // full address is on screen either way, so failure degrades to
        // "select it yourself" rather than to a broken panel.
        void globalThis.navigator?.clipboard
          ?.writeText(address)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

function EvmWalletRow({
  balance,
  depositTarget,
  ownedTargets,
  onConfirmed,
}: {
  balance: EvmWalletBalance;
  depositTarget: EvmDepositTarget | null;
  ownedTargets: ReadonlyArray<EvmDepositTarget>;
  onConfirmed: () => void;
}) {
  const [withdrawing, setWithdrawing] = useState(false);
  const chainLabel = CHAIN_LABELS[balance.chain] ?? balance.chain;
  const amount = formatUnits(balance.wei, balance.native_decimals, 6);
  const usdAmount = formatWeiUsd(balance.wei, balance.native_usd_nano);
  const discoverChain = parseDiscoverChain(balance.chain);
  return (
    <li
      className="flex flex-wrap items-baseline gap-2 text-xs"
      data-testid={`evm-wallet-${balance.chain}-${balance.wallet_account_id}`}
      data-status={balance.status}
    >
      <span className="w-20 shrink-0 font-semibold">{chainLabel}</span>
      {depositTarget === null ? (
        <span
          className="text-muted-foreground"
          data-testid={`evm-wallet-deposit-unavailable-${balance.chain}-${balance.wallet_account_id}`}
        >
          Deposit address unavailable
        </span>
      ) : (
        <>
          <span className="break-all font-mono" data-testid="evm-wallet-deposit-address">
            {depositTarget.address}
          </span>
          <CopyAddressButton address={depositTarget.address} />
        </>
      )}
      {discoverChain === null ? (
        /* An unserved EVM chain must never fall through to the default Solana
           board. That makes one wallet's trade action navigate to an
           unrelated chain. Refuse visibly rather than guessing. */
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          data-testid={`evm-wallet-trade-unavailable-${balance.chain}`}
        >
          trade unavailable
        </span>
      ) : (
        <Link
          href={discoverHrefForChain(discoverChain)}
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold"
          data-testid={`evm-wallet-trade-${balance.chain}`}
        >
          trade
        </Link>
      )}
      {balance.trade_eligible ? (
        <button type="button" onClick={() => setWithdrawing((value) => !value)} className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
          withdraw
        </button>
      ) : null}
      <span className="ml-auto flex shrink-0 flex-col items-end tabular-nums">
        {amount === null ? (
          /* THE rule. `unconfigured` and `unavailable` are different
             unknowns, and neither is zero. */
          <span
            className="text-muted-foreground"
            title={
              balance.status === 'unconfigured'
                ? `No RPC is configured for ${chainLabel}, so this balance was not read. The address is still real and still depositable.`
                : `The ${chainLabel} balance read failed. This is not a zero balance — it is an unread one.`
            }
          >
            — {balance.native_symbol}
          </span>
        ) : (
          <>
            {amount} {balance.native_symbol}
          </>
        )}
        <span
          className="text-[10px] text-muted-foreground"
          data-testid={`evm-wallet-usd-${balance.chain}-${balance.wallet_account_id}`}
          title={
            usdAmount === null
              ? balance.usd_unavailable_reason ?? 'Native USD value is unavailable.'
              : `Oracle publish time: ${balance.native_usd_publish_time_sec ?? 'unknown'}`
          }
        >
          {usdAmount ?? '$—'}
        </span>
      </span>
      {withdrawing ? (
        <EvmWithdrawForm
          balance={balance}
          ownedTargets={ownedTargets}
          onConfirmed={onConfirmed}
        />
      ) : null}
    </li>
  );
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_GAS_HEADROOM_WEI = 2_000_000_000_000_000n;

/**
 * Same-chain destinations whose checksummed addresses came from the deposit
 * authority. The source account and any duplicate-source address are omitted
 * before the form can offer them.
 */
export function ownedEvmTransferTargets(
  indexed: ReadonlyMap<string, EvmDepositTarget>,
  source: EvmWalletBalance,
): ReadonlyArray<EvmDepositTarget> {
  const sourceTarget = findEvmDepositTarget(indexed, source.wallet_account_id, source.chain);
  return [...indexed.values()]
    .filter((target) =>
      target.chain === source.chain
      && target.walletAccountId !== source.wallet_account_id
      && target.addressLowercase !== sourceTarget?.addressLowercase,
    )
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return (left.label ?? left.addressLowercase).localeCompare(
        right.label ?? right.addressLowercase,
      );
    });
}

function ownedTargetLabel(target: EvmDepositTarget): string {
  const name = target.label?.trim()
    || (target.isPrimary ? 'Primary wallet' : 'Owned wallet');
  return `${name} · ${target.address.slice(0, 8)}…${target.address.slice(-6)}`;
}

export function EvmWithdrawForm({
  balance,
  ownedTargets,
  onConfirmed,
}: {
  balance: EvmWalletBalance;
  ownedTargets: ReadonlyArray<EvmDepositTarget>;
  onConfirmed: () => void;
}) {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [pendingRequest, setPendingRequest] = useState<WithdrawEvmInput | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'checking' | 'pending' | 'confirmed' | 'error'
  >('idle');
  const [message, setMessage] = useState('');

  const dispatchWithReverification = useReverification(
    async (request: WithdrawEvmInput, checking: boolean) => {
      const authToken = await getToken({ skipCache: true });
      const result = checking
        ? await replayPendingEvmWithdrawal(request, (exactRequest) =>
            withdrawEvmNative(exactRequest, evmWithdrawalRequestOptions(authToken, true)))
        : await withdrawEvmNative(request, evmWithdrawalRequestOptions(authToken, false));
      return toEvmWithdrawalReverification(result);
    },
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const restored = readPendingEvmWithdrawal(window.localStorage, {
      chain: balance.chain,
      sourceWalletAccountId: balance.wallet_account_id,
    });
    if (restored === null) return;
    const restoredAmount = withdrawalAmountText(restored.nativeOutWei, balance.native_decimals);
    if (restoredAmount === null) return;
    setPendingRequest(restored);
    setDestination(restored.destinationAddress);
    setAmount(restoredAmount);
    setStatus('pending');
    setMessage('Outcome unknown. Use Check outcome; a new withdrawal is disabled.');
  }, [balance.chain, balance.native_decimals, balance.wallet_account_id]);

  const parsed = parseDecimalAmount(amount, balance.native_decimals);
  let observed: bigint | null = null;
  try { observed = balance.wei === null ? null : BigInt(balance.wei); } catch { observed = null; }
  const max = observed === null || observed <= EVM_GAS_HEADROOM_WEI ? 0n : observed - EVM_GAS_HEADROOM_WEI;
  const busy = status === 'submitting' || status === 'checking';
  const valid = EVM_ADDRESS.test(destination.trim()) && parsed.kind === 'ok' &&
    parsed.baseUnits <= max && !busy && status !== 'pending';
  const selectedOwnedAddress = ownedTargets.find(
    (target) => target.addressLowercase === destination.trim().toLowerCase(),
  )?.address ?? '';

  const runRequest = async (request: WithdrawEvmInput, checking: boolean) => {
    setStatus(checking ? 'checking' : 'submitting');
    let result: WithdrawEvmResult;
    try {
      result = await dispatchWithReverification(request, checking);
    } catch {
      const failure = withdrawalVerificationFailureUi(checking);
      if (!checking) {
        if (typeof window !== 'undefined') clearPendingEvmWithdrawal(window.localStorage, request);
        setPendingRequest(null);
      }
      setStatus(failure.status);
      setMessage(failure.message);
      return;
    }
    if (result.kind === 'reauth') {
      clerk.openSignIn();
      if (checking) {
        setStatus('pending');
        setMessage('Sign in to check this outcome. The original withdrawal remains locked.');
      } else {
        if (typeof window !== 'undefined') clearPendingEvmWithdrawal(window.localStorage, request);
        setPendingRequest(null);
        setStatus('idle');
      }
      return;
    }
    const disposition = withdrawalRecoveryDisposition(result, checking);
    if (disposition === 'pending') {
      setPendingRequest(request);
      setStatus('pending');
      setMessage(
        result.kind === 'pending_unconfirmed'
          ? 'Outcome is still pending. Use Check outcome again; a new withdrawal is disabled.'
          : 'The outcome check failed. The original withdrawal remains locked; try Check outcome again.',
      );
      return;
    }
    if (disposition === 'confirmed' && result.kind === 'ok') {
      if (typeof window !== 'undefined') clearPendingEvmWithdrawal(window.localStorage, request);
      setPendingRequest(null);
      setStatus('confirmed');
      setMessage(`Confirmed${result.withdrawal.txHash ? `: ${result.withdrawal.txHash}` : ''}`);
      onConfirmed();
      return;
    }
    if (result.kind === 'ok') {
      if (typeof window !== 'undefined') clearPendingEvmWithdrawal(window.localStorage, request);
      setPendingRequest(null);
      setStatus('error');
      setMessage(`Withdrawal ended with status ${result.withdrawal.status}. No new withdrawal was sent.`);
      return;
    }
    if (typeof window !== 'undefined') clearPendingEvmWithdrawal(window.localStorage, request);
    setPendingRequest(null);
    setStatus('error');
    setMessage(result.kind === 'error' ? result.message : 'Withdrawal was not confirmed.');
  };

  const submit = async () => {
    if (!valid || parsed.kind !== 'ok') return;
    const request: WithdrawEvmInput = {
      sourceWalletAccountId: balance.wallet_account_id,
      chain: balance.chain,
      destinationAddress: destination.trim(),
      nativeOutWei: parsed.baseUnits.toString(),
      clientTransferId: crypto.randomUUID(),
    };
    if (
      typeof window === 'undefined' ||
      !writePendingEvmWithdrawal(window.localStorage, request)
    ) {
      setStatus('error');
      setMessage('This browser cannot preserve the withdrawal recovery id, so nothing was submitted.');
      return;
    }
    setPendingRequest(request);
    await runRequest(request, false);
  };

  const checkOutcome = async () => {
    if (pendingRequest === null || busy) return;
    await runRequest(pendingRequest, true);
  };

  return (
    <div className="basis-full rounded border border-[var(--hairline)] p-2" aria-label={`Withdraw ${balance.native_symbol}`}>
      {ownedTargets.length > 0 ? (
        <label className="block text-[10px]">
          Transfer to owned wallet
          <select
            disabled={status === 'pending' || busy}
            value={selectedOwnedAddress}
            onChange={(event) => setDestination(event.target.value)}
            className="mt-1 w-full rounded border bg-transparent px-2 py-1"
            data-testid={`evm-owned-transfer-target-${balance.wallet_account_id}`}
          >
            <option value="">External address</option>
            {ownedTargets.map((target) => (
              <option key={`${target.chain}:${target.walletAccountId}`} value={target.address}>
                {ownedTargetLabel(target)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={ownedTargets.length > 0 ? 'mt-2 block text-[10px]' : 'block text-[10px]'}>Destination address<input disabled={status === 'pending' || busy} value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono" /></label>
      <label className="mt-2 block text-[10px]">Amount ({balance.native_symbol})<input disabled={status === 'pending' || busy} value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded border bg-transparent px-2 py-1" inputMode="decimal" /></label>
      <div className="mt-2 flex items-center gap-2">
        {status === 'pending' || status === 'checking' ? (
          <button type="button" disabled={busy} onClick={() => void checkOutcome()} className="rounded bg-muted px-2 py-1 text-[10px] font-semibold disabled:opacity-40">
            {status === 'checking' ? 'Checking…' : 'Check outcome'}
          </button>
        ) : (
          <button type="button" disabled={!valid} onClick={() => void submit()} className="rounded bg-muted px-2 py-1 text-[10px] font-semibold disabled:opacity-40">
            {status === 'submitting' ? 'Withdrawing…' : 'Confirm withdrawal'}
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">Max after gas reserve: {formatUnits(max.toString(), balance.native_decimals, 6) ?? '0'}</span>
      </div>
      {message ? <p className="mt-2 text-[10px] text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ArrowUp, Solana, Usdc } from '@/components/listen/icons/Icons';
import { useWalletBalance } from '@/components/listen/useWalletBalance';
import { withdrawSol, type WithdrawSolResult } from '@/lib/api/wallets';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DepositAddress } from './DepositAddress';

/**
 * Navbar wallet modal opened from the SOL balance pill. A Deposit /
 * Withdraw segmented toggle (defaults to Deposit). Deposit shows the
 * wallet's QR + address; Withdraw sends SOL to an external address via
 * `withdrawSol` (mirrors Move SOL, but to an arbitrary pubkey).
 *
 * Dismissible (X / Esc / backdrop).
 */

import './wallet-modal-v2.css';
type WalletTab = 'deposit' | 'withdraw';

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LAMPORTS_PER_SOL = 1_000_000_000n;
// Headroom left on Max to cover the on-chain fee (matches the api's
// TRANSFER_FEE_BUFFER_LAMPORTS default, with a touch extra).
const FEE_BUFFER_LAMPORTS = 15_000n;
/**
 * Rent-exempt minimum for a 0-data system account (~0.00089 SOL).
 * The Solana runtime rejects a withdrawal that leaves the source
 * with a balance in (0, RENT_MIN) — the account would no longer be
 * rent-exempt — so Max keeps this amount behind to keep the wallet
 * alive. Mirrors the api's RENT_EXEMPT_MIN_LAMPORTS.
 */
export const RENT_MIN_LAMPORTS = 890_880n;

/**
 * Max withdrawable lamports: balance − fee buffer − rent minimum,
 * floored at 0. Pure bigint math on the RAW lamports balance (never
 * the display-rounded label).
 */
export function computeMaxWithdrawLamports(balanceLamports: bigint): bigint {
  const max = balanceLamports - FEE_BUFFER_LAMPORTS - RENT_MIN_LAMPORTS;
  return max > 0n ? max : 0n;
}

export type WithdrawAmountIssue = 'exceeds_balance' | 'rent_strand' | null;

/**
 * Validates a user-entered amount against the raw balance:
 *   - 'exceeds_balance': amount + fee buffer is more than the balance.
 *   - 'rent_strand': amount fits, but would leave the source with
 *     0 < remainder < RENT_MIN — the runtime would reject the tx.
 */
export function classifyWithdrawAmount(
  balanceLamports: bigint,
  amountLamports: bigint,
): WithdrawAmountIssue {
  const spendable = balanceLamports - FEE_BUFFER_LAMPORTS;
  if (amountLamports > spendable) return 'exceeds_balance';
  const remainder = spendable - amountLamports;
  if (remainder > 0n && remainder < RENT_MIN_LAMPORTS) return 'rent_strand';
  return null;
}

/** `AbCd…WxYz` — compact pubkey for the wallet dropdown. */
function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 9) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

interface WalletBalanceModalProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly pubkey: string | null;
  readonly walletAccountId: string | null;
  /**
   * Tab to land on. The balances popover opens this modal from two
   * different buttons, and sending Withdraw to the Deposit tab would
   * make the user re-state what they already said. Defaults to
   * `deposit` so existing call sites are unchanged.
   */
  readonly initialTab?: WalletTab;
}

export function WalletBalanceModal({
  open,
  onOpenChange,
  pubkey,
  walletAccountId,
  initialTab = 'deposit',
}: WalletBalanceModalProps): React.ReactElement {
  const [tab, setTab] = useState<WalletTab>(initialTab);

  // Re-seed on OPEN only: re-running when `initialTab` changes would
  // yank the tab out from under a user who switched it by hand.
  useEffect(() => {
    if (open) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        /* The hook every rule in `wallet-modal-v2.css` hangs off. An
           attribute rather than a class so it cannot collide with the
           utility classes already on this element. */
        data-wallet-modal=""
        className={cn(
          'w-[calc(100vw-2rem)] max-w-md gap-0 rounded-2xl p-6',
          'border-[var(--hairline-2)] bg-[var(--surface-1)] shadow-[var(--shadow-modal)]',
        )}
      >
        <div className="flex items-center justify-between gap-3 pr-6">
          <DialogTitle className="m-0 text-[16px] font-semibold leading-none text-[var(--ink-0)]">
            Wallet
          </DialogTitle>
          <WalletBalancesChip walletAccountId={walletAccountId} active={open} />
        </div>

        <SegmentedToggle tab={tab} onChange={setTab} />

        {/* Fixed height locks the modal so toggling Deposit/Withdraw never
            resizes it. Both tabs stretch their card to fill this height, so
            neither shows a dead zone. */}
        <div className="mt-5 flex h-[420px] flex-col">
          {tab === 'deposit' ? (
            <DepositTab pubkey={pubkey} />
          ) : (
            <WithdrawTab
              walletAccountId={walletAccountId}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────── balances chip ─────────

/** Format raw micro-USDC to "{whole}.{2dp}" dollars ('—' when null). */
function usdcMicroLabel(micro: string | null): string {
  if (micro === null) return '—';
  try {
    const value = BigInt(micro);
    const whole = value / 1_000_000n;
    const frac = (value % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
    return `${whole.toString()}.${frac}`;
  } catch {
    return '—';
  }
}

/**
 * Compact SOL | USDC balance chip for the modal header — same visual
 * vocabulary as the topnav pill (icon + mono numeral, hairline divider).
 */
function WalletBalancesChip({
  walletAccountId,
  active,
}: {
  walletAccountId: string | null;
  active: boolean;
}): React.ReactElement {
  const balance = useWalletBalance(walletAccountId, { includeUsdc: true, enabled: active });
  return (
    <span
      className="inline-flex h-[26px] items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--input-bg)] pl-2.5 pr-2.5"
      aria-label="Wallet balances"
    >
      <span className="inline-flex items-center gap-1">
        <Solana style={{ width: 12, height: 12 }} />
        <span className="font-[family-name:var(--mono)] text-[12px] tabular-nums text-[var(--ink-0)]">
          {balance.label}
        </span>
      </span>
      <span aria-hidden className="my-[5px] w-px self-stretch" style={{ background: 'var(--hairline-2)' }} />
      <span className="inline-flex items-center gap-1">
        <Usdc style={{ width: 12, height: 12 }} />
        <span className="font-[family-name:var(--mono)] text-[12px] tabular-nums text-[var(--ink-0)]">
          {usdcMicroLabel(balance.usdcMicro)}
        </span>
      </span>
    </span>
  );
}

// ───────── segmented toggle ─────────

function SegmentedToggle({
  tab,
  onChange,
}: {
  tab: WalletTab;
  onChange: (next: WalletTab) => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Deposit or withdraw"
      className="relative mt-5 grid grid-cols-2 rounded-xl border border-[var(--hairline)] bg-[var(--input-bg)] p-1"
    >
      {/* Sliding active indicator. */}
      <motion.span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]"
        initial={false}
        animate={{ x: tab === 'deposit' ? 0 : '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      />
      <ToggleButton active={tab === 'deposit'} onClick={() => onChange('deposit')}>
        Deposit
      </ToggleButton>
      <ToggleButton active={tab === 'withdraw'} onClick={() => onChange('withdraw')}>
        Withdraw
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors',
        active ? 'text-[var(--ink-0)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]',
      )}
    >
      {children}
    </button>
  );
}

// ───────── deposit ─────────

function DepositTab({ pubkey }: { pubkey: string | null }): React.ReactElement {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex w-full flex-1 flex-col gap-4 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--ink-0)_4%,transparent)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[var(--ink-1)]">Your deposit address</span>
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-3)]">
            <Solana style={{ width: 13, height: 13 }} />
            Solana network
          </span>
        </div>
        <DepositAddress pubkey={pubkey} qrSize={200} fill />
      </div>
      <div className="px-1 pt-4">
        <p className="m-0 text-center text-[11px] leading-relaxed text-[var(--ink-3)]">
          Only send SOL on the Solana network to this address.
        </p>
      </div>
    </div>
  );
}

// ───────── withdraw ─────────

/**
 * Parse a decimal SOL string to lamports. Returns null on bad input.
 * Accepts a leading-dot shorthand like `.5` (== `0.5`) and a trailing
 * dot like `5.`, matching the buy/sell amount inputs. A bare `.` or empty
 * string is rejected.
 */
export function solToLamports(sol: string): bigint | null {
  const match = sol.trim().match(/^(\d*)(?:\.(\d{0,9}))?$/);
  if (!match) return null;
  const wholeStr = match[1] ?? '';
  const fracStr = match[2] ?? '';
  if (wholeStr === '' && fracStr === '') return null;
  const whole = BigInt(wholeStr === '' ? '0' : wholeStr);
  const frac = fracStr.padEnd(9, '0');
  return whole * LAMPORTS_PER_SOL + BigInt(frac);
}

function lamportsToSolString(lamports: bigint): string {
  if (lamports <= 0n) return '0';
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

type WithdrawStage =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; signature: string | null }
  | { kind: 'error'; message: string };

function WithdrawTab({
  walletAccountId,
  onClose,
}: {
  walletAccountId: string | null;
  onClose: () => void;
}): React.ReactElement {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const clerk = useClerk();
  const { getToken } = useAuth();

  const wallets = useMemo<ReadonlyArray<MeWalletEntry>>(
    () => (me && !me.reauth_required ? me.wallets.filter((w) => !w.is_archived) : []),
    [me],
  );

  // Local "From" selection (independent of the app-wide selected wallet).
  // The source id falls back to the `walletAccountId` the modal was opened
  // with (the navbar primary) so Withdraw stays usable even before `/me`
  // resolves the full wallet list — otherwise the button gets wrongly
  // stuck disabled when the dropdown list is momentarily empty.
  const [selectedId, setSelectedId] = useState<string | null>(walletAccountId);
  const sourceAccountId = selectedId ?? walletAccountId;
  const sourceWallet = useMemo<MeWalletEntry | null>(
    () => wallets.find((w) => w.wallet_account_id === sourceAccountId) ?? null,
    [wallets, sourceAccountId],
  );
  const sourcePk = sourceWallet?.wallet_pubkey ?? null;
  const { label: balanceLabel, lamports: balanceLamportsRaw } =
    useWalletBalance(sourceAccountId);

  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<WithdrawStage>({ kind: 'idle' });

  // Raw lamports balance (bigint) — Max and validation never derive
  // from the 3-decimal truncated display label.
  const balanceLamports = useMemo(() => {
    if (balanceLamportsRaw === null) return null;
    try {
      return BigInt(balanceLamportsRaw);
    } catch {
      return null;
    }
  }, [balanceLamportsRaw]);
  const maxLamports = useMemo(
    () => (balanceLamports === null ? null : computeMaxWithdrawLamports(balanceLamports)),
    [balanceLamports],
  );

  const amountLamports = useMemo(() => (amount.trim() ? solToLamports(amount) : null), [amount]);
  const addressTrimmed = address.trim();
  const addressValid = BASE58_PUBKEY_REGEX.test(addressTrimmed) && addressTrimmed !== sourcePk;
  const amountValid = amountLamports !== null && amountLamports > 0n;
  const amountIssue: WithdrawAmountIssue =
    amountValid && balanceLamports !== null
      ? classifyWithdrawAmount(balanceLamports, amountLamports)
      : null;
  const exceedsBalance = amountIssue === 'exceeds_balance';
  const rentStrand = amountIssue === 'rent_strand';

  // Idempotency: the client_transfer_id is bound to the form contents.
  // A retry of the SAME address+amount (e.g. after a timeout) reuses
  // the id so the server replays/flags in-flight instead of double-
  // sending; editing the form mints a fresh id.
  const [clientTransferId, setClientTransferId] = useState<string>(() => crypto.randomUUID());
  useEffect(() => {
    setClientTransferId(crypto.randomUUID());
  }, [sourceAccountId, addressTrimmed, amount]);

  // A null balance ('—' label) means we cannot validate the amount yet
  // — hold submit until the balance resolves instead of skipping the check.
  const canSubmit =
    !!sourceAccountId &&
    addressValid &&
    amountValid &&
    maxLamports !== null &&
    amountIssue === null &&
    stage.kind !== 'submitting';

  async function handleSubmit(): Promise<void> {
    if (!sourceAccountId || !amountLamports) return;
    setStage({ kind: 'submitting' });
    const input = {
      sourceWalletAccountId: sourceAccountId,
      destinationPubkey: addressTrimmed,
      lamports: amountLamports.toString(),
      clientTransferId,
    };
    let result: WithdrawSolResult = await withdrawSol(
      input,
      { authToken: await getToken() },
    );
    if (result.kind === 'error' && result.errorCode === 'step_up_required') {
      result = await withdrawSol(
        input,
        { authToken: await getToken({ skipCache: true }) },
      );
    }
    if (result.kind === 'error' && result.errorCode === 'step_up_required') {
      clerk.openSignIn();
      setStage({ kind: 'idle' });
      return;
    }
    // Definitive terminal outcomes mint a fresh id so a deliberate
    // retry of the same form actually retries (a reused id would just
    // replay the cached failure). Ambiguous outcomes (pending /
    // network / in-flight) KEEP the id — the attempt may have landed
    // and the same id is the only safe way to re-ask.
    const rotateId = (): void => setClientTransferId(crypto.randomUUID());
    switch (result.kind) {
      case 'ok':
        if (result.withdrawal.status === 'confirmed') {
          setStage({ kind: 'success', signature: result.withdrawal.signature });
          await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
          break;
        }
        // A 200 carrying a non-confirmed intent is a replay of a
        // previous attempt (e.g. a cached FAILED outcome) — never
        // render it as "sent".
        rotateId();
        setStage({
          kind: 'error',
          message:
            result.withdrawal.status === 'failed'
              ? 'The previous attempt with these details failed. Submit again to retry.'
              : 'Withdrawal is still processing. Check back in a moment.',
        });
        break;
      case 'reauth':
        clerk.openSignIn();
        setStage({ kind: 'idle' });
        break;
      case 'in_flight':
        setStage({ kind: 'error', message: 'A withdrawal is still processing. Try again in a moment.' });
        break;
      case 'insufficient_balance':
        rotateId();
        setStage({
          kind: 'error',
          message: `Not enough SOL. You can withdraw up to ${maxLamports ? lamportsToSolString(maxLamports) : '0'} SOL.`,
        });
        break;
      case 'invalid_input':
        rotateId();
        setStage({ kind: 'error', message: 'Please check the address and amount.' });
        break;
      case 'network_error':
        setStage({ kind: 'error', message: 'Network error. Check your connection and try again.' });
        break;
      case 'pending_unconfirmed':
        // Outcome unknown — the withdrawal may still land on-chain. Never
        // prompt an immediate retry (a fresh attempt could double-send).
        setStage({
          kind: 'error',
          message:
            'Withdrawal submitted but not yet confirmed — it may still complete. Check the destination in a few minutes before trying again.',
        });
        break;
      default:
        rotateId();
        setStage({ kind: 'error', message: withdrawErrorCopy(result.errorCode) });
        break;
    }
  }

  if (stage.kind === 'success') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--up)_18%,transparent)]">
          <ArrowUp className="h-6 w-6 text-[var(--up)]" />
        </div>
        <span className="text-[15px] font-semibold text-[var(--ink-0)]">Withdrawal sent</span>
        <p className="m-0 max-w-xs text-[13px] leading-relaxed text-[var(--ink-2)]">
          Your SOL is on its way. It will appear in the destination wallet shortly.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 rounded-full border border-[var(--hairline-2)] px-6 py-2 text-[13px] font-medium text-[var(--ink-1)] hover:text-[var(--ink-0)]"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex w-full flex-1 flex-col justify-between gap-6 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--ink-0)_4%,transparent)] p-6">
        {/* From — source wallet */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--ink-2)]">From</span>
          <Select
            value={sourceAccountId ?? undefined}
            onValueChange={setSelectedId}
            disabled={wallets.length === 0}
          >
            <SelectTrigger aria-label="Source wallet">
              <SelectValue placeholder="Select a wallet" />
            </SelectTrigger>
            {/*
              * The list is PORTALLED to the body, so it is outside
              * `[data-wallet-modal]` and none of the panel's scoped
              * palette reaches it: it kept rendering as the app's black
              * dropdown on a white dialog. Its own hook carries the
              * light look in `wallet-modal-v2.css`.
              */}
            <SelectContent data-wallet-select="">
              {wallets.map((w) => (
                <SelectItem key={w.wallet_account_id} value={w.wallet_account_id}>
                  <span className="flex items-center gap-2">
                    <Solana style={{ width: 13, height: 13 }} />
                    <span className="text-[var(--ink-0)]">{walletDisplayName(w)}</span>
                    <span className="font-[family-name:var(--mono)] text-[11.5px] text-[var(--ink-3)]">
                      {shortPubkey(w.wallet_pubkey)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Destination address */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--ink-2)]">Destination address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Solana wallet address"
            spellCheck={false}
            autoComplete="off"
            /* An address is read character by character, so it is one of
               the two places on this panel that takes the mono face. The
               amount beside it is a quantity and does not. */
            data-address-input=""
            className="h-12 w-full rounded-xl border border-[var(--hairline)] bg-[var(--input-bg)] px-3 font-[family-name:var(--mono)] text-[12.5px] text-[var(--ink-0)] outline-none transition-colors placeholder:text-[var(--ink-3)] focus:border-[var(--hairline-2)]"
          />
          {addressTrimmed.length > 0 && !addressValid ? (
            <span className="text-[12px] text-[var(--down)]">
              {addressTrimmed === sourcePk
                ? 'Cannot withdraw to this same wallet.'
                : 'Enter a valid Solana address.'}
            </span>
          ) : null}
        </label>

        {/* Amount */}
        <label className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[var(--ink-2)]">Amount</span>
            <span className="flex items-center gap-1 text-[12px] text-[var(--ink-3)]">
              Balance:
              <Solana style={{ width: 12, height: 12 }} />
              <span className="text-[var(--ink-1)]">{balanceLabel}</span>
            </span>
          </div>
          <div className="flex h-12 items-center gap-2 rounded-xl border border-[var(--hairline)] bg-[var(--input-bg)] px-3 transition-colors focus-within:border-[var(--hairline-2)]">
            <Solana style={{ width: 14, height: 14 }} />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.0"
              className="min-w-0 flex-1 bg-transparent font-[family-name:var(--mono)] text-[14px] text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]"
            />
            <button
              type="button"
              onClick={() => maxLamports !== null && setAmount(lamportsToSolString(maxLamports))}
              disabled={maxLamports === null}
              data-wallet-max=""

              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-primary)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] disabled:opacity-40"
            >
              Max
            </button>
          </div>
          {exceedsBalance ? (
            <span className="text-[12px] text-[var(--down)]">Amount exceeds your available balance.</span>
          ) : null}
          {rentStrand ? (
            <span className="text-[12px] text-[var(--down)]">
              {`This amount would leave less than the rent-exempt minimum (~${lamportsToSolString(RENT_MIN_LAMPORTS)} SOL) behind. Use Max (${maxLamports !== null ? lamportsToSolString(maxLamports) : '0'} SOL) instead.`}
            </span>
          ) : null}
        </label>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          data-wallet-cta=""

          className={cn(
            'w-full rounded-xl px-6 py-3 text-center text-[14px] font-semibold text-[var(--accent-ink)]',
            'bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))]',
            'shadow-[0_8px_24px_-12px_var(--accent-primary)] transition-opacity',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
          )}
        >
          {stage.kind === 'submitting' ? 'Sending…' : 'Withdraw'}
        </button>

        {stage.kind === 'error' ? (
          <p className="m-0 text-center text-[12.5px] text-[var(--down)]">{stage.message}</p>
        ) : (
          <p className="m-0 text-center text-[12px] leading-relaxed text-[var(--ink-3)]">
            Sends on the Solana network.
          </p>
        )}
      </div>
    </div>
  );
}

function withdrawErrorCopy(errorCode: string): string {
  switch (errorCode) {
    case 'wallet_withdraw_disabled':
      return 'Withdrawals are temporarily unavailable.';
    case 'destination_off_curve':
      return 'That address cannot receive a direct SOL transfer.';
    case 'source_remainder_below_rent_min':
      return 'This amount would leave the wallet below the rent-exempt minimum. Use Max or reduce the amount.';
    case 'client_transfer_id_reused':
      return 'This request conflicts with a previous one. Edit the amount or address and try again.';
    case 'transfer_needs_reconcile':
      return 'A previous withdrawal attempt is unresolved. Verify your balances before trying again.';
    case 'no_active_authorization':
      return 'Your trading session expired. Sign in again to continue.';
    case 'wallet_transfer_rpc_unavailable':
    case 'wallet_transfer_rpc_failed':
      return 'Solana network is unreachable right now. Try again shortly.';
    case 'trading_engine_unavailable':
    case 'trading_engine_timeout':
      return 'The signer is busy. Try again in a moment.';
    default:
      return `Withdrawal failed (${errorCode}). Try again.`;
  }
}

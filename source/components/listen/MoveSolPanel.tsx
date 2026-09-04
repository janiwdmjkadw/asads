'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import {
  transferSol,
  type TransferSolDestination,
  type TransferSolResult,
} from '@/lib/api/wallets';
import { isEligibleWallet } from '@/lib/state/selected-wallet-store';
import { useWalletBalance } from './useWalletBalance';
import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * Slice "Wallet-to-wallet SOL funding": Move SOL modal mounted as a
 * sibling of `WalletRecoveryKeyPanel` from `WalletPanel`. Lists the
 * user's OTHER eligible wallets, accepts per-wallet amounts or an
 * equal-split helper, and posts via `transferSol`. On success it
 * invalidates `['api','v1','me']` and the wallet-balance / position
 * surfaces re-poll automatically.
 *
 * Hidden behind `NEXT_PUBLIC_TERMINAL_WALLET_TRANSFER_ENABLED` for
 * staged rollout; the api/ also requires `WALLET_TRANSFER_ENABLED`.
 */

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface MoveSolPanelProps {
  open: boolean;
  onClose: () => void;
  sourceWalletAccountId: string;
}

export function isMoveSolEnabled(): boolean {
  return getRuntimeConfig().walletTransferEnabled;
}

/**
 * Deterministic equal-split helper. Returns `n` lamport amounts that
 * sum exactly to `total`, with the remainder distributed to the
 * first `total % n` slots. Mirrors the api/-side normaliser so the
 * preview the user sees matches what the server will compute.
 */
export function computeEqualSplit(total: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  if (total <= 0n) return [];
  const base = total / BigInt(n);
  const remainder = total - base * BigInt(n);
  const out: bigint[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(base + (BigInt(i) < remainder ? 1n : 0n));
  }
  return out;
}

/**
 * Returns the user's other eligible wallets (excluding the source +
 * any archived/disabled/non-active rows). Order mirrors the api/
 * `/me.wallets` ordering (primary first, then display_order ASC).
 */
export function pickEligibleDestinations(
  wallets: ReadonlyArray<MeWalletEntry>,
  sourceWalletAccountId: string,
): MeWalletEntry[] {
  return wallets.filter(
    (w) => w.wallet_account_id !== sourceWalletAccountId && isEligibleWallet(w),
  );
}

function makeClientTransferId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `move-sol-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Outcomes where the transfer MAY have landed on-chain (or may still
 * be running). The client_transfer_id must be KEPT for these so a
 * retry replays / surfaces in-flight server-side instead of double-
 * sending. Every other outcome is terminal and should mint a fresh
 * id before the next attempt.
 */
export function isAmbiguousTransferOutcome(kind: TransferSolResult['kind']): boolean {
  return kind === 'pending_unconfirmed' || kind === 'network_error' || kind === 'in_flight';
}

/**
 * Copy for a 200 response carrying a NON-confirmed intent: this is an
 * idempotency replay of a previous attempt (e.g. a cached FAILED
 * outcome) and must never render as "Sent".
 */
export function copyForNonConfirmedIntentStatus(
  status: 'reserved' | 'submitted' | 'confirmed' | 'failed',
): string {
  if (status === 'failed') {
    return 'A previous attempt of this transfer failed. Send again to retry.';
  }
  return 'This transfer is still processing. Check balances in a moment.';
}

export function copyForTransferError(result: TransferSolResult): string {
  switch (result.kind) {
    case 'reauth':
      return 'Your session expired. Sign in again to move SOL.';
    case 'network_error':
      return 'Network error. Check your connection and try again.';
    case 'invalid_input':
      return result.reason;
    case 'insufficient_balance':
      return `Not enough SOL. Required ${formatSol(result.requiredLamports)} SOL; available ${formatSol(result.observedLamports)} SOL.`;
    case 'in_flight':
      return 'A previous transfer with this id is still in flight; retry once it terminates.';
    case 'pending_unconfirmed':
      // Outcome unknown — the transfer may still land. Never tell the user
      // to retry here; a retry with a fresh id could double-send.
      return 'Transfer submitted but not yet confirmed — it may still complete. Check balances in a minute before trying again.';
    case 'error':
      switch (result.errorCode) {
        case 'wallet_transfer_self':
          return 'Source and destination must be different wallets.';
        case 'wallet_not_owned_by_user':
          return 'One of the wallets does not belong to you. Refresh and try again.';
        case 'wallet_archived':
          return 'A selected wallet is archived. Un-archive it or pick a different one.';
        case 'wallet_account_disabled':
          return 'A selected wallet is disabled. Pick a different one.';
        case 'wallet_chain_unsupported':
          return 'Only Solana wallets are supported.';
        case 'transfer_no_nonce_available':
          return 'Source wallet has no nonce available. Try again in a moment.';
        case 'no_active_authorization':
        case 'signer_material_missing':
          return 'Wallet authorization is not ready. Refresh and try again.';
        case 'wallet_transfer_disabled':
          return 'Wallet-to-wallet transfer is currently disabled.';
        case 'wallet_transfer_rpc_unavailable':
        case 'wallet_transfer_rpc_failed':
          return 'Solana RPC is unreachable. Try again in a moment.';
        case 'trading_engine_timeout':
        case 'trading_engine_unavailable':
          return 'Trading engine unavailable. Try again in a moment.';
        case 'turnkey_sign_timeout':
          return 'Signing timed out. Try again.';
        case 'turnkey_policy_rejected':
          return 'Signing was rejected by policy.';
        case 'verifier_rejected':
          return 'Transfer verification failed. Please retry.';
        case 'too_many_destinations':
          return 'Too many destinations. Pick fewer wallets.';
        case 'invalid_lamports':
        case 'invalid_split':
          return 'Invalid amount. Check the values and try again.';
        case 'source_remainder_below_rent_min':
          return 'This amount would leave the source wallet below the rent-exempt minimum. Reduce the amount slightly.';
        case 'client_transfer_id_reused':
          return 'This request conflicts with a previous one. Adjust the amounts and try again.';
        case 'transfer_needs_reconcile':
          return 'A previous transfer attempt is unresolved. Verify balances before sending again.';
        default:
          return `Could not move SOL (${result.errorCode}). Try again.`;
      }
    case 'ok':
      return '';
  }
}

function formatSol(lamportsDecimal: string): string {
  let raw: bigint;
  try {
    raw = BigInt(lamportsDecimal);
  } catch {
    return '0';
  }
  const sign = raw < 0n ? '-' : '';
  const abs = raw < 0n ? -raw : raw;
  const sol = abs / 1_000_000_000n;
  const frac = abs % 1_000_000_000n;
  const fracStr = frac.toString().padStart(9, '0').slice(0, 4);
  return `${sign}${sol.toString()}.${fracStr}`;
}

function parseSolInput(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const padded = frac.padEnd(9, '0').slice(0, 9);
  try {
    const lamports = BigInt(whole ?? '0') * 1_000_000_000n + BigInt(padded || '0');
    return lamports > 0n ? lamports : null;
  } catch {
    return null;
  }
}

type Mode = 'per_wallet' | 'equal_split';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; signature: string | null }
  | { kind: 'error'; message: string };

export function MoveSolPanel(props: MoveSolPanelProps): React.ReactElement | null {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const sourceBalance = useWalletBalance(
    props.open ? props.sourceWalletAccountId : null,
  );

  const eligible = useMemo(() => {
    if (!me || me.reauth_required) return [];
    return pickEligibleDestinations(me.wallets, props.sourceWalletAccountId);
  }, [me, props.sourceWalletAccountId]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>('per_wallet');
  const [totalSol, setTotalSol] = useState('');
  const [clientTransferId, setClientTransferId] = useState<string>('');
  const [sendState, setSendState] = useState<SendState>({ kind: 'idle' });

  // Reset when the modal (re-)opens.
  useEffect(() => {
    if (!props.open) return;
    setSelected({});
    setAmounts({});
    setMode('per_wallet');
    setTotalSol('');
    setClientTransferId(makeClientTransferId());
    setSendState({ kind: 'idle' });
  }, [props.open, props.sourceWalletAccountId]);

  // Escape to close.
  const propsOpen = props.open;
  const propsOnClose = props.onClose;
  useEffect(() => {
    if (!propsOpen) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') propsOnClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [propsOpen, propsOnClose]);

  const selectedWallets = useMemo(
    () => eligible.filter((w) => selected[w.wallet_account_id] === true),
    [eligible, selected],
  );

  // Derive the destinations the request will carry.
  const destinations: TransferSolDestination[] = useMemo(() => {
    if (selectedWallets.length === 0) return [];
    if (mode === 'equal_split') {
      const totalLamports = parseSolInput(totalSol);
      if (totalLamports === null) return [];
      const splits = computeEqualSplit(totalLamports, selectedWallets.length);
      if (splits.length === 0) return [];
      return selectedWallets.map((w, idx) => ({
        walletAccountId: w.wallet_account_id,
        lamports: (splits[idx] ?? 0n).toString(),
      }));
    }
    const out: TransferSolDestination[] = [];
    for (const w of selectedWallets) {
      const lamports = parseSolInput(amounts[w.wallet_account_id] ?? '');
      if (lamports === null) return [];
      out.push({ walletAccountId: w.wallet_account_id, lamports: lamports.toString() });
    }
    return out;
  }, [selectedWallets, mode, amounts, totalSol]);

  const totalLamports = useMemo(
    () => destinations.reduce<bigint>((acc, d) => acc + BigInt(d.lamports), 0n),
    [destinations],
  );

  // The idempotency id is bound to the form contents: any edit to the
  // destination set or amounts mints a fresh id. (A stale id would
  // make the server replay a PREVIOUS attempt's cached intent for a
  // request the user just edited.)
  const destinationsFingerprint = useMemo(
    () => destinations.map((d) => `${d.walletAccountId}:${d.lamports}`).join('|'),
    [destinations],
  );
  useEffect(() => {
    setClientTransferId(makeClientTransferId());
  }, [props.sourceWalletAccountId, destinationsFingerprint]);

  const canSend =
    props.open &&
    sendState.kind !== 'sending' &&
    destinations.length > 0 &&
    UUID_REGEX.test(props.sourceWalletAccountId) &&
    UUID_REGEX.test(destinations[0]!.walletAccountId);

  const runSend = useCallback(async () => {
    if (!canSend) return;
    setSendState({ kind: 'sending' });
    const token = await getToken();
    const result = await transferSol(
      {
        sourceWalletAccountId: props.sourceWalletAccountId,
        clientTransferId,
        destinations,
      },
      { authToken: token },
    );
    if (result.kind === 'ok' && result.intent.status === 'confirmed') {
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      setSendState({ kind: 'success', signature: result.intent.signature });
      // Terminal outcome: a fresh id so a subsequent send from this
      // modal is a NEW transfer, not a replay of this one.
      setClientTransferId(makeClientTransferId());
      return;
    }
    if (result.kind === 'ok') {
      // 200 with a non-confirmed intent = idempotency replay of a
      // previous attempt (e.g. a cached FAILED outcome). Never show
      // "Sent" for it.
      setSendState({
        kind: 'error',
        message: copyForNonConfirmedIntentStatus(result.intent.status),
      });
      setClientTransferId(makeClientTransferId());
      return;
    }
    setSendState({ kind: 'error', message: copyForTransferError(result) });
    // Definitive failures mint a fresh id so a retry actually retries
    // (a reused id would replay the cached FAILED intent as a 200).
    // Ambiguous outcomes KEEP the id — the transfer may have landed
    // and re-asking with the same id is the only safe retry.
    if (!isAmbiguousTransferOutcome(result.kind)) {
      setClientTransferId(makeClientTransferId());
    }
  }, [canSend, getToken, props.sourceWalletAccountId, clientTransferId, destinations, queryClient]);

  if (!props.open) return null;
  if (!isMoveSolEnabled()) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move SOL"
        data-testid="move-sol-panel-disabled"
        className="fixed inset-0 z-[60] flex items-center justify-center"
        onClick={props.onClose}
        style={{
          background: 'var(--modal-backdrop)',
          backdropFilter: 'var(--modal-blur)',
          WebkitBackdropFilter: 'var(--modal-blur)',
        }}
      >
        <div
          className="relative w-full max-w-md rounded-2xl p-5 sm:p-6"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--hairline-2)',
            boxShadow: 'var(--shadow-modal)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ color: 'var(--ink-1)', margin: 0 }}>
            Move SOL is currently disabled.
          </p>
        </div>
      </div>
    );
  }

  const sourceWallet = me && !me.reauth_required
    ? me.wallets.find((w) => w.wallet_account_id === props.sourceWalletAccountId) ?? null
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move SOL"
      data-testid="move-sol-panel"
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={props.onClose}
      style={{
        background: 'var(--modal-backdrop)',
        backdropFilter: 'var(--modal-blur)',
        WebkitBackdropFilter: 'var(--modal-blur)',
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-5 sm:p-6"
        style={{
          // `--surface-1` keeps the modal opaque under the zen
          // parchment theme where `--surface` is transparent.
          background: 'var(--surface-1)',
          border: '1px solid var(--hairline-2)',
          boxShadow: 'var(--shadow-modal)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close move SOL panel"
          data-testid="move-sol-close"
          onClick={props.onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            color: 'var(--ink-3)',
            fontSize: 18,
            border: 'none',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ✕
        </button>

        <h2 style={{ color: 'var(--ink-0)', fontSize: 16, margin: 0, marginBottom: 6 }}>
          Move SOL
        </h2>
        <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: 0, marginBottom: 12 }}>
          Send SOL from this wallet to your other wallets. Only your own
          wallets are allowed.
        </p>

        {sourceWallet !== null ? (
          <div
            data-testid="move-sol-source"
            style={{
              padding: '8px 10px',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              marginBottom: 10,
              fontSize: 12,
              color: 'var(--ink-1)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>
              Source: {labelForWallet(sourceWallet)}
            </span>
            <span style={{ color: 'var(--ink-3)' }}>{sourceBalance.label} SOL</span>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            data-testid="move-sol-mode-per-wallet"
            onClick={() => setMode('per_wallet')}
            style={modeButtonStyle(mode === 'per_wallet')}
          >
            Per-wallet amounts
          </button>
          <button
            type="button"
            data-testid="move-sol-mode-equal-split"
            onClick={() => setMode('equal_split')}
            style={modeButtonStyle(mode === 'equal_split')}
          >
            Equal split
          </button>
        </div>

        {mode === 'equal_split' ? (
          <div style={{ marginBottom: 10 }}>
            <label
              htmlFor="move-sol-total"
              style={{ color: 'var(--ink-3)', fontSize: 11 }}
            >
              Total SOL
            </label>
            <input
              id="move-sol-total"
              data-testid="move-sol-total-input"
              type="text"
              inputMode="decimal"
              value={totalSol}
              onChange={(e) => setTotalSol(e.target.value)}
              placeholder="0.0"
              style={{
                width: '100%',
                background: 'var(--input-bg)',
                border: '1px solid var(--hairline)',
                borderRadius: 8,
                padding: '6px 8px',
                color: 'var(--ink-0)',
                fontSize: 12,
                marginTop: 4,
              }}
            />
          </div>
        ) : null}

        {eligible.length === 0 ? (
          <p data-testid="move-sol-empty" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
            No other eligible wallets. Create a second wallet to enable Move SOL.
          </p>
        ) : (
          <div
            data-testid="move-sol-destinations"
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {eligible.map((w, idx) => {
              const isChecked = selected[w.wallet_account_id] === true;
              const lamports =
                mode === 'equal_split'
                  ? selectedWallets.includes(w)
                    ? (computeEqualSplit(
                        parseSolInput(totalSol) ?? 0n,
                        selectedWallets.length,
                      )[selectedWallets.indexOf(w)] ?? 0n)
                    : 0n
                  : null;
              return (
                <div
                  key={w.wallet_account_id}
                  data-testid={`move-sol-row-${w.wallet_account_id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 120px',
                    gap: 8,
                    alignItems: 'center',
                    padding: '6px 8px',
                    border: '1px solid var(--hairline)',
                    borderRadius: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`move-sol-check-${w.wallet_account_id}`}
                    checked={isChecked}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        [w.wallet_account_id]: e.target.checked,
                      }))
                    }
                  />
                  <span style={{ color: 'var(--ink-1)', fontSize: 12 }}>
                    {labelForWallet(w, idx)}
                  </span>
                  {mode === 'per_wallet' ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid={`move-sol-amount-${w.wallet_account_id}`}
                      disabled={!isChecked}
                      value={amounts[w.wallet_account_id] ?? ''}
                      placeholder="0.0 SOL"
                      onChange={(e) =>
                        setAmounts((prev) => ({
                          ...prev,
                          [w.wallet_account_id]: e.target.value,
                        }))
                      }
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--hairline)',
                        borderRadius: 6,
                        padding: '4px 6px',
                        color: 'var(--ink-0)',
                        fontSize: 12,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: 'var(--ink-3)',
                        fontSize: 12,
                        textAlign: 'right',
                      }}
                    >
                      {isChecked ? `${formatSol(lamports!.toString())} SOL` : '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {destinations.length > 0 ? (
          <div
            data-testid="move-sol-preview"
            style={{
              marginTop: 12,
              padding: '8px 10px',
              border: '1px solid var(--hairline-2)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--ink-1)',
            }}
          >
            <div>
              Total: <strong>{formatSol(totalLamports.toString())} SOL</strong> across{' '}
              {destinations.length} wallet{destinations.length === 1 ? '' : 's'}
            </div>
            <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 4 }}>
              Excludes Solana fee + a small buffer (~0.00001 SOL).
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            data-testid="move-sol-cancel"
            onClick={props.onClose}
            style={ghostButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="move-sol-send"
            onClick={() => void runSend()}
            disabled={!canSend}
            style={canSend ? primaryButtonStyle : disabledButtonStyle}
          >
            {sendState.kind === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>

        {sendState.kind === 'success' ? (
          <p
            data-testid="move-sol-success"
            style={{
              color: 'var(--up)',
              fontSize: 12,
              marginTop: 10,
              wordBreak: 'break-all',
            }}
          >
            Sent. Signature: {sendState.signature ?? '—'}
          </p>
        ) : null}

        {sendState.kind === 'error' ? (
          <p
            data-testid="move-sol-error"
            style={{
              color: 'var(--down)',
              fontSize: 12,
              marginTop: 10,
            }}
          >
            {sendState.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function labelForWallet(w: MeWalletEntry, idx?: number): string {
  if (w.label !== null && w.label.length > 0) return w.label;
  if (w.is_primary) return 'Primary';
  if (typeof idx === 'number') return `Wallet ${idx + 1}`;
  return `Wallet ${w.display_order + 1}`;
}

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--ink-0)' : 'var(--ink-1)',
    border: '1px solid var(--hairline)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
  };
}

const primaryButtonStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
  flex: 1,
};

const ghostButtonStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-1)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
};

const disabledButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: 'var(--input-bg)',
  color: 'var(--ink-3)',
  cursor: 'not-allowed',
};

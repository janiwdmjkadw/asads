'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useOpenSetupForWallet } from '@/lib/state/wallet-setup-store';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import {
  isEligibleWallet,
  useSelectedWalletStore,
} from '@/lib/state/selected-wallet-store';
import { AgentBadge } from '@/components/portfolio/AgentBadge';
import { AGENT_WALLET_LABEL, AGENT_WALLET_SETUP_HREF } from '@/components/portfolio/agentWallet';
import { createWallet, type CreateWalletResult } from '@/lib/api/wallets';
import { announceEvmWalletsChanged } from '@/lib/api/evm-wallet-balances';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * Slice "Terminal wallet selector": compact selector + dropdown for
 * the user's wallets. The trigger renders the active wallet's label
 * + short pubkey + per-wallet readiness; the dropdown lists every
 * eligible wallet for selection.
 *
 * Archived / disabled / non-Solana wallets are filtered out — they
 * cannot be selected via the picker even if the store somehow holds
 * their id (the store's sync hook would reconcile away from them).
 *
 * Create-wallet affordance lives at the bottom of the dropdown and
 * is gated on `NEXT_PUBLIC_TERMINAL_WALLET_CREATE_ENABLED`; rename /
 * archive / set-primary are deferred to a later slice.
 */

export interface WalletSelectorProps {
  /**
   * Visual variant. `panel` widens the trigger for inside the
   * WalletPanel modal; `compact` shrinks it for the TradePanel /
   * InstantTradeBox surfaces.
   */
  variant?: 'panel' | 'compact';
  /** Optional className passthrough for layout. */
  className?: string;
  /** Optional inline style passthrough. */
  style?: CSSProperties;
  /**
   * Optional callback fired when the user selects a wallet. The
   * store is already updated by the time this runs; consumers can
   * use it to close a parent surface or scroll, etc.
   */
  onSelect?: (walletAccountId: string) => void;
}

function isCreateWalletEnabled(): boolean {
  return getRuntimeConfig().walletCreateEnabled;
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

export function walletDisplayName(wallet: MeWalletEntry): string {
  if (wallet.label !== null && wallet.label.length > 0) return wallet.label;
  // Before the generic `Wallet N` fallback: the agent wallet carries
  // its own `display_order`, so an unlabelled one would otherwise
  // collide with a user wallet's name in the very lists where telling
  // them apart matters most.
  if (wallet.purpose === 'agent') return AGENT_WALLET_LABEL;
  if (wallet.is_primary) return 'Primary';
  return `Wallet ${wallet.display_order + 1}`;
}

interface UseWalletsResult {
  readonly eligible: ReadonlyArray<MeWalletEntry>;
  readonly selected: MeWalletEntry | null;
  readonly hasReauth: boolean;
}

function useEligibleWallets(): UseWalletsResult {
  const { data } = useMe();
  const selectedWalletAccountId = useSelectedWalletStore(
    (s) => s.selectedWalletAccountId,
  );
  return useMemo<UseWalletsResult>(() => {
    if (!data || data.reauth_required) {
      return { eligible: [], selected: null, hasReauth: data?.reauth_required === true };
    }
    const eligible = data.wallets.filter(isEligibleWallet);
    const selected =
      eligible.find((w) => w.wallet_account_id === selectedWalletAccountId) ??
      null;
    return { eligible, selected, hasReauth: false };
  }, [data, selectedWalletAccountId]);
}

export function WalletSelector(props: WalletSelectorProps = {}): React.ReactElement | null {
  const variant = props.variant ?? 'compact';
  const { eligible, selected, hasReauth } = useEligibleWallets();
  const setSelectedWalletAccountId = useSelectedWalletStore(
    (s) => s.setSelectedWalletAccountId,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = useCallback(
    (walletAccountId: string) => {
      setSelectedWalletAccountId(walletAccountId);
      setOpen(false);
      if (props.onSelect) props.onSelect(walletAccountId);
    },
    [setSelectedWalletAccountId, props],
  );

  if (hasReauth) return null;
  if (eligible.length === 0) return null;

  const triggerLabel =
    selected !== null ? walletDisplayName(selected) : 'Select wallet';
  const triggerPubkey = selected !== null ? shortPubkey(selected.wallet_pubkey) : '';

  return (
    <div
      ref={rootRef}
      className={props.className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        ...props.style,
      }}
      data-testid="wallet-selector"
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="wallet-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 2,
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          borderRadius: 10,
          padding: variant === 'panel' ? '8px 12px' : '6px 10px',
          color: 'var(--ink-0)',
          fontSize: 12,
          minWidth: variant === 'panel' ? 220 : 160,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            width: '100%',
          }}
        >
          <span style={{ fontWeight: 500 }}>{triggerLabel}</span>
          {selected !== null ? (
            <span
              data-testid="wallet-selector-trigger-status"
              style={{
                color: selected.trade_ready ? 'var(--up)' : 'var(--ink-3)',
                fontSize: 11,
              }}
            >
              {selected.trade_ready ? 'ready' : 'setup'}
            </span>
          ) : null}
        </span>
        {triggerPubkey ? (
          <span
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
            }}
          >
            {triggerPubkey}
          </span>
        ) : null}
      </button>

      {open ? (
        <DropdownPanel
          wallets={eligible}
          selectedId={selected?.wallet_account_id ?? null}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface DropdownPanelProps {
  wallets: ReadonlyArray<MeWalletEntry>;
  selectedId: string | null;
  onSelect: (walletAccountId: string) => void;
  onClose: () => void;
}

function DropdownPanel({
  wallets,
  selectedId,
  onSelect,
  onClose,
}: DropdownPanelProps): React.ReactElement {
  const createEnabled = isCreateWalletEnabled();
  return (
    <div
      role="listbox"
      aria-label="Wallets"
      data-testid="wallet-selector-dropdown"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        zIndex: 70,
        minWidth: 260,
        // `--surface-1` keeps the dropdown opaque under the zen
        // parchment theme where `--surface` is transparent.
        background: 'var(--surface-1)',
        border: '1px solid var(--hairline-2)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-dropdown)',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {wallets.map((wallet) => (
        <WalletRow
          key={wallet.wallet_account_id}
          wallet={wallet}
          isSelected={wallet.wallet_account_id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {createEnabled ? (
        <>
          <div
            style={{
              height: 1,
              background: 'var(--hairline)',
              margin: '4px 0',
            }}
          />
          <CreateWalletInline onClose={onClose} />
        </>
      ) : null}
    </div>
  );
}

function WalletRow({
  wallet,
  isSelected,
  onSelect,
}: {
  wallet: MeWalletEntry;
  isSelected: boolean;
  onSelect: (walletAccountId: string) => void;
}): React.ReactElement {
  const openSetupFor = useOpenSetupForWallet();
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-testid={`wallet-selector-option-${wallet.wallet_account_id}`}
      onClick={() => onSelect(wallet.wallet_account_id)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        background: isSelected
          ? 'color-mix(in srgb, var(--ink-0) 10%, transparent)'
          : 'transparent',
        border: '1px solid',
        borderColor: isSelected ? 'var(--hairline-2)' : 'transparent',
        borderRadius: 8,
        padding: '8px 10px',
        color: 'var(--ink-0)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13 }}>
          {walletDisplayName(wallet)}
          {wallet.purpose === 'agent' ? <AgentBadge /> : null}
          {wallet.is_primary ? (
            <span
              aria-hidden
              style={{
                marginLeft: 8,
                color: 'var(--ink-3)',
                fontSize: 11,
              }}
            >
              (primary)
            </span>
          ) : null}
        </span>
        <span
          style={{
            color: 'var(--ink-3)',
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {shortPubkey(wallet.wallet_pubkey)}
        </span>
      </span>
      {wallet.trade_ready ? (
        <span style={{ color: 'var(--up)', fontSize: 11 }}>ready</span>
      ) : (
        /* Click-through to the SAME nonce-setup modal Portfolio → Wallets
           uses (global host). span+role, not <button> — this row IS a
           button and nesting is invalid; stopPropagation keeps the click
           from also selecting the wallet.

           The agent wallet routes to its OWN ceremony instead: its
           readiness is grant/revoke plus an agent-scoped nonce pool,
           none of which the per-user-wallet modal can provision. */
        <span
          role="button"
          tabIndex={0}
          title={
            wallet.purpose === 'agent'
              ? 'Finish agent wallet setup'
              : 'Set up this wallet for trading'
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openSetupFor(wallet);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              openSetupFor(wallet);
            }
          }}
          className="hover:underline"
          style={{ color: 'var(--accent-primary)', fontSize: 11, cursor: 'pointer' }}
        >
          needs setup
        </span>
      )}
    </button>
  );
}

function CreateWalletInline({
  onClose,
}: {
  onClose: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const setSelectedWalletAccountId = useSelectedWalletStore(
    (s) => s.setSelectedWalletAccountId,
  );

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    const trimmed = label.normalize('NFC').trim();
    const input = trimmed.length > 0 ? { label: trimmed } : {};
    const token = await resolveOrderAuthToken(getToken);
    const result: CreateWalletResult = await createWallet(input, { authToken: token });
    setBusy(false);
    if (result.kind === 'ok') {
      setSelectedWalletAccountId(result.wallet.wallet_account_id);
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'wallets', 'balances'] });
      announceEvmWalletsChanged();
      setLabel('');
      onClose();
      return;
    }
    setErrorMessage(copyForCreateError(result));
  }, [busy, label, getToken, queryClient, setSelectedWalletAccountId, onClose]);

  return (
    <div
      data-testid="wallet-selector-create"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 8px 8px',
      }}
    >
      <label
        htmlFor="wallet-selector-create-label"
        style={{ color: 'var(--ink-3)', fontSize: 11 }}
      >
        New wallet
      </label>
      <input
        id="wallet-selector-create-label"
        data-testid="wallet-selector-create-label"
        type="text"
        placeholder="Optional label"
        maxLength={40}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={busy}
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          borderRadius: 8,
          padding: '6px 8px',
          color: 'var(--ink-0)',
          fontSize: 12,
        }}
      />
      <button
        type="button"
        data-testid="wallet-selector-create-submit"
        onClick={() => {
          void submit();
        }}
        disabled={busy}
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          border: 'none',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Creating…' : 'Create wallet'}
      </button>
      {errorMessage !== null ? (
        <p
          data-testid="wallet-selector-create-error"
          style={{ color: 'var(--down)', fontSize: 11, margin: 0 }}
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function copyForCreateError(result: CreateWalletResult): string {
  switch (result.kind) {
    case 'reauth':
      return 'Your session expired. Sign in again to create a wallet.';
    case 'rate_limited':
      return 'Too many wallets created recently. Try again in a moment.';
    case 'network_error':
      return 'Network error. Check your connection and try again.';
    case 'error':
      switch (result.errorCode) {
        case 'wallet_quota_exceeded':
          return 'You have reached the maximum number of wallets allowed.';
        case 'wallet_label_invalid':
          return 'Label must be 1–40 characters with no control characters.';
        case 'wallet_create_not_ready':
          return 'Wallet creation is only available after initial setup.';
        case 'shape_mismatch':
          return 'Got an unexpected response from the server. Try again.';
        default:
          return `Could not create wallet (${result.errorCode}). Try again.`;
      }
    case 'ok':
      return '';
  }
}

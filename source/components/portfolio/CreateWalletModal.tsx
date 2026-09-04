'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { createWallet, type CreateWalletResult } from '@/lib/api/wallets';
import { copyForCreateError } from '@/components/listen/WalletSelector';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { announceEvmWalletsChanged } from '@/lib/api/evm-wallet-balances';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { WalletFieldSheet } from './wallet-modal-fields';

/**
 * Slice "Portfolio page wallets tab": modal wrapper around the
 * existing `createWallet()` API client. Mirrors the inline create
 * form that lives inside `WalletSelector` but as a standalone
 * dialog so the Portfolio header's "+ Wallet" CTA can open it.
 *
 * On success: invalidate `useMe()` so the new wallet shows up in
 * the table, then select the newly-created wallet so any
 * downstream consumers (the trade page wallet-count button etc.)
 * follow the user's most recent intent.
 */

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CreateWalletModal(props: Props): React.ReactElement | null {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const setSelectedWalletAccountId = useSelectedWalletStore(
    (s) => s.setSelectedWalletAccountId,
  );
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      setLabel('');
      setError(null);
      setBusy(false);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props, busy]);

  if (!props.open) return null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = label.normalize('NFC').trim();
      const input = trimmed.length > 0 ? { label: trimmed } : {};
      // Clerk can still be bootstrapping immediately after navigation. Bound
      // that wait so a wallet-creation press cannot sit on "Creating…"
      // forever; a missing token is then handled by the API's reauth result.
      const token = await resolveOrderAuthToken(getToken);
      const result: CreateWalletResult = await createWallet(input, { authToken: token });
      if (result.kind === 'ok') {
        setSelectedWalletAccountId(result.wallet.wallet_account_id);
        // The POST is the create authority. A slow refetch must not keep the
        // successful dialog open or delay EVM companion reconciliation.
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'wallets', 'balances'] });
        announceEvmWalletsChanged();
        props.onClose();
        return;
      }
      setError(copyForCreateError(result));
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create wallet"
      data-testid="create-wallet-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => {
        if (!busy) props.onClose();
      }}
      style={{
        background: 'var(--modal-backdrop)',
        backdropFilter: 'var(--modal-blur)',
        WebkitBackdropFilter: 'var(--modal-blur)',
      }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl p-5 sm:p-6"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--hairline-2)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Same field rule as the import dialog: the border carries the
            state, and the browser's amber ring never appears. */}
        <WalletFieldSheet />
        <h2
          style={{
            fontSize: 16,
            margin: 0,
            marginBottom: 12,
            color: 'var(--ink-0)',
            fontFamily: 'var(--sans)',
          }}
        >
          Create wallet
        </h2>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Optional label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="e.g. Trading"
            data-testid="create-wallet-label-input"
            disabled={busy}
            className="wm-field"
          />
        </label>
        {error ? (
          <p style={{ color: 'var(--down)', fontSize: 12, margin: 0, marginBottom: 8 }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            className="wm-ghost"
            style={ghostStyle(busy)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="create-wallet-submit"
            className="wm-plain"
            style={busy ? disabledStyle : primaryStyle}
          >
            {busy ? 'Creating…' : 'Create wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--sans)',
} as const;

const disabledStyle = {
  ...primaryStyle,
  background: 'var(--input-bg)',
  color: 'var(--ink-3)',
  cursor: 'not-allowed',
} as const;

function ghostStyle(disabled: boolean) {
  return {
    background: 'transparent',
    color: disabled ? 'var(--ink-3)' : 'var(--ink-1)',
    border: '1px solid var(--hairline)',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--sans)' as const,
  };
}

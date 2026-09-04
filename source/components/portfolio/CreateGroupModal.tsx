'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import { isEligibleWallet } from '@/lib/state/selected-wallet-store';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import { useCreateWalletGroup } from '@/lib/state/wallet-groups-store';

/**
 * Slice "Portfolio page wallets tab": dialog for `POST /api/v1/wallets/groups`.
 * Body:
 *   - text input for `name` (1..64 chars)
 *   - inline checkbox list of the user's eligible wallets
 *   - Cancel / Create buttons
 *
 * On success the parent closes the dialog; the react-query
 * invalidation in `useCreateWalletGroup` repaints the wallets table.
 */

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Optional preselected wallet ids (e.g. "create from current selection"). */
  readonly initialWalletAccountIds?: ReadonlyArray<string>;
}

export function CreateGroupModal(props: Props): React.ReactElement | null {
  const { data: me } = useMe();
  const eligible = useMemo<ReadonlyArray<MeWalletEntry>>(() => {
    if (!me || me.reauth_required) return [];
    return me.wallets.filter(isEligibleWallet);
  }, [me]);

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(props.initialWalletAccountIds ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateWalletGroup();

  useEffect(() => {
    if (props.open) {
      setName('');
      setSelected(new Set(props.initialWalletAccountIds ?? []));
      setError(null);
    }
  }, [props.open, props.initialWalletAccountIds]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props]);

  if (!props.open) return null;

  const toggle = (walletAccountId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(walletAccountId)) next.delete(walletAccountId);
      else next.add(walletAccountId);
      return next;
    });
  };

  const canSubmit =
    name.trim().length >= 1 && name.trim().length <= 64 && selected.size >= 1 && !mutation.isPending;

  const onSubmit = async () => {
    setError(null);
    const result = await mutation.mutateAsync({
      name: name.trim(),
      walletAccountIds: eligible
        .filter((w) => selected.has(w.wallet_account_id))
        .map((w) => w.wallet_account_id),
    });
    if (result.kind === 'ok') {
      props.onClose();
      return;
    }
    if (result.kind === 'invalid_input' || result.kind === 'error') {
      setError(result.kind === 'invalid_input' ? result.reason : result.message);
      return;
    }
    if (result.kind === 'reauth') {
      setError('Session expired. Sign in again to create the group.');
      return;
    }
    setError('Network error. Try again.');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create wallet group"
      data-testid="create-group-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
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
        <h2
          style={{
            fontSize: 16,
            margin: 0,
            marginBottom: 12,
            color: 'var(--ink-0)',
            fontFamily: 'var(--sans)',
          }}
        >
          Create wallet group
        </h2>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Trading bots"
            maxLength={64}
            data-testid="create-group-name-input"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border, var(--hairline))',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--ink-0)',
              fontFamily: 'var(--sans)',
            }}
          />
        </label>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
          Wallets ({selected.size} / {eligible.length} selected)
        </div>
        <div
          role="listbox"
          aria-label="Wallets to include in this group"
          style={{
            maxHeight: 280,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            marginBottom: 12,
          }}
        >
          {eligible.map((w) => {
            const isChecked = selected.has(w.wallet_account_id);
            return (
              <label
                key={w.wallet_account_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: isChecked ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(w.wallet_account_id)}
                  style={{ accentColor: 'var(--accent-primary)' }}
                />
                <span style={{ fontSize: 13, color: 'var(--ink-0)' }}>
                  {walletDisplayName(w)}
                  {w.is_primary ? (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-3)' }}>
                      (primary)
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: w.trade_ready ? 'var(--up)' : 'var(--ink-3)',
                  }}
                >
                  {w.trade_ready ? 'ready' : 'setup'}
                </span>
              </label>
            );
          })}
        </div>
        {error ? (
          <p
            style={{
              color: 'var(--down)',
              fontSize: 12,
              margin: 0,
              marginBottom: 8,
            }}
          >
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={props.onClose}
            style={ghostButtonStyle}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            data-testid="create-group-submit"
            style={canSubmit ? primaryButtonStyle : disabledButtonStyle}
          >
            {mutation.isPending ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle = {
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--sans)',
} as const;

const disabledButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--input-bg)',
  color: 'var(--ink-3)',
  cursor: 'not-allowed',
} as const;

const ghostButtonStyle = {
  background: 'transparent',
  color: 'var(--ink-1)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--sans)',
} as const;

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import { isEligibleWallet } from '@/lib/state/selected-wallet-store';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import type { WalletGroup } from '@/lib/api/wallet-groups';
import {
  useDeleteWalletGroup,
  useUpdateWalletGroup,
} from '@/lib/state/wallet-groups-store';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Slice "Portfolio page wallets tab": rename / edit-members / delete
 * dialog for an existing group. Reuses the same checkbox list and
 * theme tokens as `CreateGroupModal` so the two surfaces feel like a
 * matched pair.
 */

interface Props {
  readonly group: WalletGroup | null;
  readonly onClose: () => void;
}

export function EditGroupModal(props: Props): React.ReactElement | null {
  const { data: me } = useMe();
  const eligible = useMemo<ReadonlyArray<MeWalletEntry>>(() => {
    if (!me || me.reauth_required) return [];
    return me.wallets.filter(isEligibleWallet);
  }, [me]);

  const updateMutation = useUpdateWalletGroup();
  const deleteMutation = useDeleteWalletGroup();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.group) return;
    setName(props.group.name);
    setSelected(new Set(props.group.wallet_account_ids));
    setError(null);
  }, [props.group]);

  useEffect(() => {
    if (!props.group) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.group, props]);

  if (!props.group) return null;
  const group = props.group;

  const toggle = (walletAccountId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(walletAccountId)) next.delete(walletAccountId);
      else next.add(walletAccountId);
      return next;
    });
  };

  const canSave =
    name.trim().length >= 1 &&
    name.trim().length <= 64 &&
    selected.size >= 1 &&
    !updateMutation.isPending &&
    !deleteMutation.isPending;

  const onSave = async () => {
    setError(null);
    const ids = eligible
      .filter((w) => selected.has(w.wallet_account_id))
      .map((w) => w.wallet_account_id);
    const result = await updateMutation.mutateAsync({
      groupId: group.id,
      name: name.trim(),
      walletAccountIds: ids,
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
      setError('Session expired. Sign in again to save.');
      return;
    }
    setError('Network error. Try again.');
  };

  /* Gated by `ConfirmDialog` rather than `window.confirm` — see that
     component for why the browser's own sheet had to go. */
  const [confirming, setConfirming] = useState(false);

  const onDelete = async () => {
    setError(null);
    setConfirming(false);
    const result = await deleteMutation.mutateAsync(group.id);
    if (result.kind === 'ok') {
      props.onClose();
      return;
    }
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    if (result.kind === 'reauth') {
      setError('Session expired. Sign in again to delete.');
      return;
    }
    setError('Network error. Try again.');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit group ${group.name}`}
      data-testid="edit-group-modal"
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
          Edit group
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
            maxLength={64}
            data-testid="edit-group-name-input"
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
          Members ({selected.size} / {eligible.length} selected)
        </div>
        <div
          role="listbox"
          aria-label="Group members"
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
        <ConfirmDialog
          open={confirming}
          title={`Delete ${group.name}?`}
          body="The wallets in it are not affected."
          confirmLabel="Delete group"
          destructive
          busy={deleteMutation.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void onDelete()}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleteMutation.isPending}
            data-testid="edit-group-delete"
            style={dangerButtonStyle}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete group'}
          </button>
          <div style={{ display: 'inline-flex', gap: 8 }}>
            <button
              type="button"
              onClick={props.onClose}
              style={ghostButtonStyle}
              disabled={updateMutation.isPending || deleteMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!canSave}
              data-testid="edit-group-save"
              style={canSave ? primaryButtonStyle : disabledButtonStyle}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
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

const dangerButtonStyle = {
  background: 'transparent',
  color: 'var(--down)',
  border: '1px solid color-mix(in srgb, var(--down) 30%, var(--hairline))',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--sans)',
} as const;

'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import {
  patchWallet,
  type PatchWalletResult,
} from '@/lib/api/wallets';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';

/**
 * Slice "Per-wallet positions / fills + wallet management UI":
 * a small inline settings strip inside `WalletPanel` for the
 * currently-selected wallet.
 *
 * Three actions:
 *   - Rename (text input, server validates label).
 *   - Set as primary (visible only when the selected wallet is
 *     `trade_ready === true` and is NOT already the primary).
 *   - Archive (visible only when the user has ≥ 2 unarchived
 *     wallets and the selected wallet is not the primary).
 *
 * `enable/disable` is intentionally NOT surfaced — the backend
 * supports it but the product story is unexercised.
 *
 * On success we invalidate `['api','v1','me']`. Archive of the
 * currently-selected wallet causes the slice-6
 * `useSyncSelectedWallet` reconciliation to swap selection to
 * the user's primary (or first eligible) wallet automatically.
 */

type LabelInputState =
  | { kind: 'idle' }
  | { kind: 'editing'; value: string }
  | { kind: 'saving' };

type ActionState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

interface WalletSettingsHelpersInput {
  wallets: ReadonlyArray<MeWalletEntry>;
  selected: MeWalletEntry;
}

export interface WalletSettingsAffordances {
  /** True iff the selected wallet may be promoted to primary. */
  readonly canSetPrimary: boolean;
  /** True iff the selected wallet may be archived. */
  readonly canArchive: boolean;
}

/**
 * Pure decision helpers; the WalletPanel uses these directly in
 * unit tests. The backend is the authoritative gate — these flags
 * just hide affordances the user would always see fail with a
 * `wallet_cannot_*` error.
 */
export function deriveAffordances(
  input: WalletSettingsHelpersInput,
): WalletSettingsAffordances {
  const otherActive = input.wallets.filter(
    (w) => w.wallet_account_id !== input.selected.wallet_account_id && !w.is_archived,
  );
  const canSetPrimary =
    !input.selected.is_primary &&
    !input.selected.is_archived &&
    input.selected.is_enabled &&
    input.selected.status === 'active' &&
    input.selected.trade_ready;
  const canArchive =
    !input.selected.is_primary &&
    !input.selected.is_archived &&
    otherActive.length >= 1;
  return { canSetPrimary, canArchive };
}

/** Map a tagged `PatchWalletResult` into user-facing inline copy. */
export function copyForPatchError(result: PatchWalletResult): string {
  switch (result.kind) {
    case 'reauth':
      return 'Your session expired. Sign in again to update this wallet.';
    case 'network_error':
      return 'Network error. Check your connection and try again.';
    case 'invalid_input':
      return result.reason === 'no_updatable_fields'
        ? 'Nothing to update.'
        : 'Could not update wallet. Try again.';
    case 'error':
      switch (result.errorCode) {
        case 'wallet_label_invalid':
          return 'Label must be 1–40 characters with no control characters.';
        case 'wallet_cannot_archive_primary':
          return 'Cannot archive the primary wallet. Set another wallet as primary first.';
        case 'wallet_cannot_archive_only_active':
          return 'Cannot archive your only active wallet.';
        case 'wallet_cannot_promote_archived_or_disabled':
          return 'Wallet must be active and enabled before it can become primary.';
        case 'wallet_not_owned_by_user':
        case 'wallet_not_found':
          return 'Wallet not available. Refresh and try again.';
        case 'wallet_patch_empty':
          return 'Nothing to update.';
        case 'wallet_patch_conflicting_fields':
          return 'Conflicting settings. Try one change at a time.';
        case 'shape_mismatch':
          return 'Unexpected response from server. Try again.';
        default:
          return `Could not update wallet (${result.errorCode}). Try again.`;
      }
    case 'ok':
      return '';
  }
}

interface Props {
  walletAccountId: string;
  /**
   * Slice "Wallet-to-wallet SOL funding": optional callback fired
   * when the user clicks "Move SOL". `WalletPanel` owns the modal
   * state (`moveSolOpen`) and passes a handler that toggles it.
   * When omitted (legacy callers / tests), the button hides.
   */
  onOpenMoveSol?: (walletAccountId: string) => void;
}

export function WalletSettingsPanel({
  walletAccountId,
  onOpenMoveSol,
}: Props): React.ReactElement | null {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const setSelectedWalletAccountId = useSelectedWalletStore(
    (s) => s.setSelectedWalletAccountId,
  );

  const { selected, affordances } = useMemo(() => {
    if (!me || me.reauth_required) {
      return { selected: null as MeWalletEntry | null, affordances: null as WalletSettingsAffordances | null };
    }
    const selectedEntry =
      me.wallets.find((w) => w.wallet_account_id === walletAccountId) ?? null;
    if (selectedEntry === null) return { selected: null, affordances: null };
    return {
      selected: selectedEntry,
      affordances: deriveAffordances({
        wallets: me.wallets,
        selected: selectedEntry,
      }),
    };
  }, [me, walletAccountId]);

  const [labelState, setLabelState] = useState<LabelInputState>({ kind: 'idle' });
  const [primaryState, setPrimaryState] = useState<ActionState>({ kind: 'idle' });
  const [archiveState, setArchiveState] = useState<ActionState>({ kind: 'idle' });
  const [archiveConfirm, setArchiveConfirm] = useState<boolean>(false);

  const runRename = useCallback(
    async (nextLabel: string | null) => {
      if (selected === null) return;
      setLabelState({ kind: 'saving' });
      const token = await getToken();
      const result = await patchWallet(
        { walletAccountId: selected.wallet_account_id, label: nextLabel },
        { authToken: token },
      );
      if (result.kind === 'ok') {
        await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        setLabelState({ kind: 'idle' });
        return;
      }
      setLabelState({ kind: 'editing', value: nextLabel ?? '' });
      setPrimaryState({ kind: 'error', message: copyForPatchError(result) });
    },
    [selected, getToken, queryClient],
  );

  const runSetPrimary = useCallback(async () => {
    if (selected === null) return;
    setPrimaryState({ kind: 'saving' });
    const token = await getToken();
    const result = await patchWallet(
      { walletAccountId: selected.wallet_account_id, isPrimary: true },
      { authToken: token },
    );
    if (result.kind === 'ok') {
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      setPrimaryState({ kind: 'done' });
      return;
    }
    setPrimaryState({ kind: 'error', message: copyForPatchError(result) });
  }, [selected, getToken, queryClient]);

  const runArchive = useCallback(async () => {
    if (selected === null) return;
    setArchiveState({ kind: 'saving' });
    const token = await getToken();
    const result = await patchWallet(
      { walletAccountId: selected.wallet_account_id, isArchived: true },
      { authToken: token },
    );
    if (result.kind === 'ok') {
      // The slice-6 reconcile hook will swap selection away from
      // this wallet on the next /me refresh; clear here too so the
      // store does not briefly point at an archived id.
      setSelectedWalletAccountId(null);
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      setArchiveState({ kind: 'done' });
      setArchiveConfirm(false);
      return;
    }
    setArchiveState({ kind: 'error', message: copyForPatchError(result) });
  }, [selected, getToken, queryClient, setSelectedWalletAccountId]);

  if (selected === null || affordances === null) return null;

  return (
    <div
      data-testid="wallet-settings-panel"
      style={{
        marginTop: 12,
        padding: '10px 12px',
        border: '1px solid var(--hairline)',
        borderRadius: 10,
        background: 'var(--input-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--ink-0)', fontWeight: 500 }}>
        Wallet settings
      </div>

      <LabelEditor
        currentLabel={selected.label}
        state={labelState}
        onStart={() => setLabelState({ kind: 'editing', value: selected.label ?? '' })}
        onChange={(value) => setLabelState({ kind: 'editing', value })}
        onCancel={() => setLabelState({ kind: 'idle' })}
        onSave={(value) => {
          const trimmed = value.normalize('NFC').trim();
          void runRename(trimmed.length === 0 ? null : trimmed);
        }}
      />

      {affordances.canSetPrimary ? (
        <button
          type="button"
          data-testid="wallet-settings-set-primary"
          onClick={() => void runSetPrimary()}
          disabled={primaryState.kind === 'saving'}
          style={primaryButtonStyle}
        >
          {primaryState.kind === 'saving' ? 'Setting primary…' : 'Set as primary'}
        </button>
      ) : null}

      {primaryState.kind === 'error' ? (
        <p data-testid="wallet-settings-primary-error" style={errorTextStyle}>
          {primaryState.message}
        </p>
      ) : null}

      {/*
       * Slice "Wallet-to-wallet SOL funding": Move SOL button. Hidden
       * when the parent does not supply `onOpenMoveSol` (legacy
       * mounts / tests) so this slice can ship dark without
       * affecting existing tests.
       */}
      {onOpenMoveSol !== undefined ? (
        <button
          type="button"
          data-testid="wallet-settings-move-sol"
          onClick={() => onOpenMoveSol(selected.wallet_account_id)}
          style={ghostButtonStyle}
        >
          Move SOL
        </button>
      ) : null}

      {affordances.canArchive ? (
        archiveConfirm ? (
          <div
            data-testid="wallet-settings-archive-confirm"
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <p style={{ color: 'var(--ink-1)', fontSize: 12, margin: 0 }}>
              Archive this wallet?
            </p>
            <button
              type="button"
              data-testid="wallet-settings-archive-confirm-yes"
              onClick={() => void runArchive()}
              disabled={archiveState.kind === 'saving'}
              style={dangerButtonStyle}
            >
              {archiveState.kind === 'saving' ? 'Archiving…' : 'Archive'}
            </button>
            <button
              type="button"
              data-testid="wallet-settings-archive-confirm-cancel"
              onClick={() => setArchiveConfirm(false)}
              style={ghostButtonStyle}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="wallet-settings-archive"
            onClick={() => setArchiveConfirm(true)}
            style={ghostButtonStyle}
          >
            Archive wallet
          </button>
        )
      ) : null}

      {archiveState.kind === 'error' ? (
        <p data-testid="wallet-settings-archive-error" style={errorTextStyle}>
          {archiveState.message}
        </p>
      ) : null}
    </div>
  );
}

interface LabelEditorProps {
  currentLabel: string | null;
  state: LabelInputState;
  onStart: () => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}

function LabelEditor(props: LabelEditorProps): React.ReactElement {
  const display =
    props.currentLabel !== null && props.currentLabel.length > 0
      ? props.currentLabel
      : '(no label)';
  if (props.state.kind === 'idle') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>Label</span>
        <span style={{ color: 'var(--ink-1)', fontSize: 12, flex: 1 }}>{display}</span>
        <button
          type="button"
          data-testid="wallet-settings-rename"
          onClick={props.onStart}
          style={ghostButtonStyle}
        >
          Rename
        </button>
      </div>
    );
  }
  const value = props.state.kind === 'editing' ? props.state.value : '';
  const saving = props.state.kind === 'saving';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>Label</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          data-testid="wallet-settings-rename-input"
          type="text"
          maxLength={40}
          value={value}
          disabled={saving}
          onChange={(e) => props.onChange(e.target.value)}
          style={{
            flex: 1,
            // `--input-bg` is the canonical input-control surface in
            // both dark and zen palettes (rather than `--surface`,
            // which is transparent in zen).
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: 8,
            padding: '6px 8px',
            color: 'var(--ink-0)',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          data-testid="wallet-settings-rename-save"
          onClick={() => props.onSave(value)}
          disabled={saving}
          style={primaryButtonStyle}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          data-testid="wallet-settings-rename-cancel"
          onClick={props.onCancel}
          disabled={saving}
          style={ghostButtonStyle}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const primaryButtonStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: 'none',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

const ghostButtonStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-1)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

const dangerButtonStyle: CSSProperties = {
  background: 'var(--down)',
  color: 'var(--ink-0)',
  border: 'none',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

const errorTextStyle: CSSProperties = {
  color: 'var(--down)',
  fontSize: 11,
  margin: 0,
};

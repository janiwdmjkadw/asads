'use client';

import { useEffect, useMemo, useState } from 'react';
import { WalletExportIframe } from './WalletExportIframe';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import {
  isExportableWalletEntry,
  pickDefaultExportWallet,
} from '@/lib/auth/wallet-export';

interface WalletRecoveryKeyPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Fires when the iframe successfully reveals the mnemonic. The
   * parent decides whether to auto-confirm backup (pre-backup state)
   * or do nothing (re-export from ready_to_trade). The handler MUST
   * NOT receive any key material — same security contract as
   * `WalletExportIframe`.
   */
  onSuccess: () => void | Promise<void>;
  /** Optional error hook. Same redaction contract: no key material. */
  onError?: (errorCode: string, message: string) => void;
  /**
   * Slice "Terminal wallet selector": when provided, the picker
   * opens with this wallet selected by default (instead of falling
   * back to `pickDefaultExportWallet`). Used by `WalletPanel` so the
   * recovery iframe targets the user's currently-selected wallet.
   *
   * If the supplied id is not eligible (archived / disabled /
   * unknown), we fall back to the legacy primary-first default so
   * the modal still renders something usable.
   */
  initialWalletAccountId?: string | null;
}

/**
 * Short truncated pubkey for the picker display ("So1L...wxyz"). The
 * Aurora `wallet_pubkey` is always >= 32 chars; defensive slice
 * keeps the helper safe even for unexpectedly-short strings.
 */
function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

/**
 * Wallet-picker selection state. Lives inside the modal so the
 * picker has no responsibility outside the recovery flow.
 */
function useExportableWallets(): {
  wallets: ReadonlyArray<MeWalletEntry>;
  defaultWallet: MeWalletEntry | null;
} {
  const { data } = useMe();
  return useMemo(() => {
    if (!data || data.reauth_required) {
      return { wallets: [], defaultWallet: null };
    }
    const eligible = data.wallets.filter(isExportableWalletEntry);
    return {
      wallets: eligible,
      defaultWallet: pickDefaultExportWallet(data.wallets),
    };
  }, [data]);
}

/**
 * Slice T4'-C2: standalone recovery-key modal.
 *
 * Intentionally separated from `WalletPanel`. The deposit address and
 * the recovery key are different sensitivity levels with different
 * audit semantics, so they never share a UI surface:
 *   - `WalletPanel` handles deposit (QR / address / copy / status).
 *   - `WalletRecoveryKeyPanel` is the ONLY surface that mounts the
 *     Turnkey export iframe.
 *
 * The iframe itself is the security boundary: plaintext mnemonic
 * renders only inside the `export.turnkey.com` origin. This wrapper's
 * job is layout + warning copy + close affordance. It never touches
 * key material.
 */
export function WalletRecoveryKeyPanel({
  open,
  onClose,
  onSuccess,
  onError,
  initialWalletAccountId,
}: WalletRecoveryKeyPanelProps): React.ReactElement | null {
  const { wallets, defaultWallet } = useExportableWallets();
  const [selectedWalletAccountId, setSelectedWalletAccountId] = useState<string | null>(
    null,
  );

  // Reset selection when the modal opens / when /me's wallets list
  // changes shape (e.g. a new wallet was created mid-session).
  // Slice "Terminal wallet selector": when the parent supplies
  // `initialWalletAccountId`, prefer it over the legacy primary
  // default. We only honor it when the id resolves to an eligible
  // entry in `wallets` (defence in depth — `wallets` is already
  // filtered by `isExportableWalletEntry`).
  useEffect(() => {
    if (!open) {
      setSelectedWalletAccountId(null);
      return;
    }
    if (selectedWalletAccountId === null) {
      const initialEligible =
        typeof initialWalletAccountId === 'string'
          ? wallets.find((w) => w.wallet_account_id === initialWalletAccountId)
              ?.wallet_account_id ?? null
          : null;
      setSelectedWalletAccountId(
        initialEligible ?? defaultWallet?.wallet_account_id ?? null,
      );
      return;
    }
    const stillEligible = wallets.some(
      (w) => w.wallet_account_id === selectedWalletAccountId,
    );
    if (!stillEligible) {
      setSelectedWalletAccountId(defaultWallet?.wallet_account_id ?? null);
    }
  }, [open, wallets, defaultWallet, selectedWalletAccountId, initialWalletAccountId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const showPicker = wallets.length > 1;
  const activeWalletId = selectedWalletAccountId ?? defaultWallet?.wallet_account_id ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recovery Key"
      data-testid="wallet-recovery-key-panel"
      // Render above WalletPanel (which uses z-50).
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
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
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close recovery key panel"
          data-testid="wallet-recovery-key-close"
          onClick={onClose}
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

        <h2
          style={{
            color: 'var(--ink-0)',
            fontSize: 16,
            margin: 0,
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          Recovery Key
        </h2>

        {showPicker ? (
          <div
            data-testid="wallet-recovery-picker"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 14,
            }}
          >
            <p
              style={{
                color: 'var(--ink-3)',
                fontSize: 12,
                margin: 0,
                letterSpacing: '0.02em',
              }}
            >
              Wallet
            </p>
            <div
              role="radiogroup"
              aria-label="Wallet to reveal"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                background: 'var(--input-bg)',
                border: '1px solid var(--hairline)',
                borderRadius: 10,
                padding: 6,
              }}
            >
              {wallets.map((w) => {
                const isSelected = w.wallet_account_id === activeWalletId;
                const labelText =
                  w.label !== null && w.label.length > 0
                    ? w.label
                    : w.is_primary
                      ? 'Primary'
                      : `Wallet ${w.display_order + 1}`;
                return (
                  <button
                    key={w.wallet_account_id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`wallet-recovery-option-${w.wallet_account_id}`}
                    onClick={() => setSelectedWalletAccountId(w.wallet_account_id)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--ink-0) 12%, transparent)'
                        : 'transparent',
                      color: 'var(--ink-0)',
                      border: '1px solid',
                      borderColor: isSelected ? 'var(--hairline-2)' : 'transparent',
                      borderRadius: 8,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 13 }}>
                      {labelText}
                      {w.is_primary ? (
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
                      {w.backup_confirmed_at !== null ? (
                        <span
                          aria-hidden
                          style={{
                            marginLeft: 8,
                            color: 'var(--ink-3)',
                            fontSize: 11,
                          }}
                        >
                          backed up
                        </span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        color: 'var(--ink-3)',
                        fontSize: 12,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {shortPubkey(w.wallet_pubkey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeWalletId !== null ? (
          <WalletExportIframe
            // Re-mount the iframe stamper when the user switches
            // wallets so the ephemeral keypair binds to the new
            // export request. Without the keyed remount, the
            // initial wallet's target_public_key would be reused
            // across selections.
            key={activeWalletId}
            walletAccountId={activeWalletId}
            onSuccess={onSuccess}
            {...(onError ? { onError } : {})}
          />
        ) : (
          <p
            data-testid="wallet-recovery-no-wallet"
            style={{
              color: 'var(--ink-3)',
              fontSize: 13,
              textAlign: 'center',
              padding: 24,
            }}
          >
            No exportable wallets available.
          </p>
        )}
      </div>
    </div>
  );
}

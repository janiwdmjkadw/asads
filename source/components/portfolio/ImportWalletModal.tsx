'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { importWallet, parseWalletSecret, type ImportWalletResult } from '@/lib/api/wallets';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { announceEvmWalletsChanged } from '@/lib/api/evm-wallet-balances';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { WalletFieldSheet } from './wallet-modal-fields';

/**
 * IMPORT A WALLET YOU ALREADY OWN.
 *
 * The counterpart of the export the row already offers: Export hands you
 * a wallet's key, this takes one back. The header's Import button has
 * been a tooltip reading "Coming soon" since the tab shipped.
 *
 * ── THE PASTE IS READ BEFORE IT IS SENT ──────────────────────────────
 *
 * `parseWalletSecret` knows the two shapes a Solana secret arrives in —
 * base58 and the CLI's 64-number array — and says which one it got. A
 * paste that is neither is caught HERE, so a mistyped or truncated key
 * never leaves the machine to be told by a server that it is not a key.
 * The line under the field says what it recognised, live, which is also
 * the only feedback that tells you the paste landed whole.
 *
 * ── AND IT IS TREATED LIKE A SECRET ──────────────────────────────────
 *
 * Masked by default, `autoComplete` and spellcheck off so no browser
 * dictionary or password manager reads it, and the field is wiped on
 * close and on success rather than left in a closed dialog's state. It
 * rides once in a POST body: never a query string, never a log line,
 * never back down the wire.
 *
 * The warning is one sentence and it is true: anyone holding this key
 * can move the funds, so a key you did not export yourself is somebody
 * else's wallet.
 */

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ImportWalletModal(props: Props): React.ReactElement | null {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const setSelectedWalletAccountId = useSelectedWalletStore((s) => s.setSelectedWalletAccountId);

  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every open starts clean, and closing takes the key out of state
  // rather than leaving it in a dialog that merely stopped rendering.
  useEffect(() => {
    setSecret('');
    setLabel('');
    setReveal(false);
    setError(null);
    setBusy(false);
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

  const shape = parseWalletSecret(secret);
  const ready = shape.kind !== 'invalid' && !busy;

  /* What the field has understood, said as it is typed. Empty says
     nothing: a form that scolds you before you have finished the first
     paste is noise. */
  const readout =
    shape.kind === 'base58'
      ? 'Reads as a base58 secret key.'
      : shape.kind === 'byte_array'
        ? 'Reads as a 64 byte key file.'
        : shape.reason === 'empty'
          ? null
          : shape.reason === 'wrong_length'
            ? 'That is the right alphabet but the wrong length, so the paste is probably cut short.'
            : 'That is not a secret key. Paste the base58 key or the contents of a key file.';

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const token = await resolveOrderAuthToken(getToken);
      const trimmed = label.normalize('NFC').trim();
      const result: ImportWalletResult = await importWallet(
        trimmed.length > 0 ? { secret, label: trimmed } : { secret },
        { authToken: token },
      );
      if (result.kind === 'ok') {
        setSecret('');
        setSelectedWalletAccountId(result.wallet.wallet_account_id);
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'wallets'] });
        void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'wallets', 'balances'] });
        announceEvmWalletsChanged();
        props.onClose();
        return;
      }
      setError(copyForImportError(result));
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
      aria-label="Import wallet"
      data-testid="import-wallet-modal"
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
        className="relative w-full max-w-md rounded-2xl p-5 sm:p-6"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--hairline-2)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <WalletFieldSheet />
        <h2
          style={{
            fontSize: 16,
            margin: 0,
            color: 'var(--ink-0)',
            fontFamily: 'var(--sans)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          Import wallet
        </h2>
        <p
          style={{
            margin: '6px 0 16px',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-3)',
            fontFamily: 'var(--sans)',
          }}
        >
          Paste the secret key of a wallet you own. Anyone holding it can move the funds, so only
          paste a key you exported yourself.
        </p>

        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Secret key</span>
          <div style={{ position: 'relative' }}>
            <textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              rows={3}
              placeholder="Base58 key, or the [1,2,3,…] contents of a key file"
              aria-label="Secret key"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-testid="import-wallet-secret"
              disabled={busy}
              className="wm-field"
              style={{
                resize: 'none',
                paddingRight: 54,
                lineHeight: 1.5,
                /* Masked without a password input: a `type=password`
                   textarea does not exist, and a single line input turns
                   an 88 character key into a slit you cannot check. */
                WebkitTextSecurity: reveal ? 'none' : 'disc',
                textSecurity: reveal ? 'none' : 'disc',
              } as React.CSSProperties}
            />
            {secret === '' ? null : (
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-pressed={reveal}
                data-testid="import-wallet-reveal"
                className="wm-plain"
                style={{
                  position: 'absolute',
                  top: 7,
                  right: 8,
                  border: 0,
                  background: 'transparent',
                  color: 'var(--ink-3)',
                  fontSize: 11,
                  fontFamily: 'var(--sans)',
                  cursor: 'pointer',
                  padding: 2,
                }}
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          {readout === null ? null : (
            <span
              data-testid="import-wallet-readout"
              style={{
                fontSize: 11,
                lineHeight: 1.45,
                color: shape.kind === 'invalid' ? 'var(--ink-1)' : 'var(--ink-3)',
              }}
            >
              {readout}
            </span>
          )}
        </label>

        <label style={{ ...fieldStyle, marginBottom: 16 }}>
          <span style={fieldLabelStyle}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Optional"
            data-testid="import-wallet-label"
            disabled={busy}
            className="wm-field"
          />
        </label>

        {error ? (
          <p
            data-testid="import-wallet-error"
            style={{ color: 'var(--down)', fontSize: 12, margin: '0 0 10px', lineHeight: 1.45 }}
          >
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
            disabled={!ready}
            data-testid="import-wallet-submit"
            className="wm-plain"
            style={ready ? primaryStyle : disabledStyle}
          >
            {busy ? 'Importing…' : 'Import wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every failure the client can hand back, in words, with a way out. */
function copyForImportError(result: ImportWalletResult): string {
  switch (result.kind) {
    case 'duplicate':
      return 'That wallet is already here. Check the list before importing again.';
    case 'invalid_secret':
      return 'That key was not accepted. Check you pasted the whole thing.';
    case 'reauth':
      return 'Your session expired. Sign in again and retry.';
    case 'network_error':
      return 'Network error. Try again.';
    case 'error':
      return result.message;
    default:
      return 'Import failed. Try again.';
  }
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  marginBottom: 12,
} as const;

const fieldLabelStyle = { fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--sans)' } as const;

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

'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import { EnableTradingPanel } from '@/components/listen/EnableTradingPanel';

/**
 * Slice "Portfolio page wallets tab": per-wallet nonce-setup modal.
 * Opened by clicking a wallet row's "needs setup" pill — the same
 * preflight → confirm → execute flow the onboarding WalletPanel runs
 * for the primary wallet, targeted at THIS wallet via the
 * wallet-scoped route (`EnableTradingPanel walletAccountId`).
 *
 * Lifecycle: on success the panel invalidates `/me`; the refetched
 * wallet's `trade_ready` flips true, which auto-closes this modal and
 * fires a confirmation toast. Closing mid-execute is safe — the
 * server route is idempotent, and re-opening resumes with only the
 * still-missing nonce slots.
 */

interface Props {
  /** The wallet being set up; `null` = modal closed. */
  readonly wallet: MeWalletEntry | null;
  readonly onClose: () => void;
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

export function WalletSetupModal(props: Props): React.ReactElement | null {
  const { wallet, onClose } = props;
  const open = wallet !== null;
  // Completion = nonces provisioned (the pill's own signal), not
  // `trade_ready` — a disabled wallet that finishes provisioning would
  // otherwise never flip trade_ready and the modal would hang open.
  const ready =
    wallet !== null && (wallet.trade_ready || !wallet.nonce_setup.required);

  // Auto-close once /me refetches with the wallet ready — mirrors the
  // onboarding CTA unmounting itself. The ref guards the toast against
  // an already-ready wallet somehow reaching this modal.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !ready) wasOpenRef.current = true;
    if (open && ready && wasOpenRef.current) {
      wasOpenRef.current = false;
      toast('Wallet ready for trading', {
        description: wallet ? walletDisplayName(wallet) : undefined,
      });
      onClose();
    }
  }, [open, ready, wallet, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!wallet) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set up wallet for trading"
      data-testid="wallet-setup-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
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
        <h2
          style={{
            fontSize: 16,
            margin: 0,
            marginBottom: 4,
            color: 'var(--ink-0)',
            fontFamily: 'var(--sans)',
          }}
        >
          Set up wallet
        </h2>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 14,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: 'var(--ink-1)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {walletDisplayName(wallet)}
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              fontFamily: 'var(--mono)',
              whiteSpace: 'nowrap',
            }}
          >
            {shortPubkey(wallet.wallet_pubkey)}
          </span>
        </div>
        {/* Keyed by wallet so preflight/error state can never leak
            across wallets; target count comes from THIS wallet's own
            per-wallet nonce status (the top-level me.nonce_setup is the
            primary wallet's legacy mirror). */}
        <EnableTradingPanel
          key={wallet.wallet_account_id}
          walletAccountId={wallet.wallet_account_id}
          targetCount={
            wallet.nonce_setup.target_count > 0 ? wallet.nonce_setup.target_count : undefined
          }
        />
        <button
          type="button"
          onClick={onClose}
          data-testid="wallet-setup-close"
          style={{
            marginTop: 12,
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--hairline)',
            color: 'var(--ink-2)',
            padding: '7px 12px',
            borderRadius: 8,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

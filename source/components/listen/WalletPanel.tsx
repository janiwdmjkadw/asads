'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import {
  isPendingBackupState,
  useMe,
  type BackupMethod,
  type ProvisioningState,
} from '@/lib/api/me';
import { confirmBackup, type ConfirmBackupResult } from '@/lib/api/wallet-backup';
import { shouldAutoConfirmBackup } from '@/lib/auth/wallet-export';
import { nonceSetupSurface } from '@/lib/auth/nonce-setup-surface';
import {
  getSelectedWallet,
  useSelectedWalletStore,
} from '@/lib/state/selected-wallet-store';
import { WalletRecoveryKeyPanel } from './WalletRecoveryKeyPanel';
import { EnableTradingPanel } from './EnableTradingPanel';
import { FlashOfferPanel } from '@/components/flash/FlashOfferPanel';
import { WalletSelector } from './WalletSelector';
import { WalletSettingsPanel } from './WalletSettingsPanel';
import { MoveSolPanel, isMoveSolEnabled } from './MoveSolPanel';
import { getRuntimeConfig } from '@/lib/runtime-config';

interface WalletPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Slice T4'-A + T4'-C + T4'-C2: backup-before-deposit Wallet panel.
 *
 * IMPORTANT product invariant: this panel is the DEPOSIT surface only.
 * The recovery-key/mnemonic flow lives in `WalletRecoveryKeyPanel`, a
 * completely separate modal that owns the Turnkey export iframe. We
 * never co-locate the deposit UI and the recovery-key reveal on the
 * same surface — different sensitivity, different audit semantics.
 *
 * Two render branches keyed on the user's `provisioning.state`:
 *
 *  - **Pre-backup** (`wallet_ready_needs_backup` or the legacy
 *    `wallet_ready_needs_passkey_root` alias): the deposit address,
 *    QR code, and copy button are HIDDEN. The panel renders a single
 *    `Back up wallet` CTA which opens `WalletRecoveryKeyPanel`. On
 *    successful mnemonic reveal there, we auto-call
 *    `POST /api/v1/wallet/backup/confirm` (state-aware: only when
 *    state still indicates pending-backup; see
 *    `shouldAutoConfirmBackup`). The checkbox fallback (T4'-A) is
 *    available behind the api/'s `WALLET_BACKUP_CHECKBOX_FALLBACK_ENABLED`
 *    env flag; the terminal reads `me.backup.methods.includes('checkbox')`
 *    to decide whether to render the fallback UI.
 *
 *  - **Post-backup** (`ready_to_trade`): full deposit UI -- QR + pubkey
 *    + copy button + `Wallet is ready to trade.` badge. A small
 *    `Recovery key` button opens `WalletRecoveryKeyPanel` for re-export;
 *    re-export does NOT flip the state machine.
 *
 * Defence in depth: the address section only renders when
 * `wallet.pubkey != null && state === 'ready_to_trade'`. The server's
 * `/me` route is the authoritative gate (it strips the pubkey before
 * sending pre-backup), so even a forged client cannot pull the address.
 */
export function WalletPanel({ open, onClose }: WalletPanelProps): React.ReactElement | null {
  const { getToken } = useAuth();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const selectedWalletAccountId = useSelectedWalletStore(
    (s) => s.selectedWalletAccountId,
  );
  // Slice "Terminal wallet selector": the panel now keys every
  // surface off the user-selected wallet. The legacy `me.wallet`
  // (primary-only) is used ONLY as the pre-state fallback when the
  // /me wallets list is empty (provisioning hasn't completed yet).
  const selectedWallet =
    !me || me.reauth_required
      ? null
      : getSelectedWallet(me.wallets, selectedWalletAccountId);
  const wallet = !me || me.reauth_required
    ? null
    : selectedWallet !== null
      ? { pubkey: selectedWallet.wallet_pubkey, status: selectedWallet.status }
      : me.wallet;
  const state: ProvisioningState | null =
    !me || me.reauth_required ? null : me.provisioning.state;
  const backupMethods: ReadonlyArray<BackupMethod> =
    !me || me.reauth_required ? ['iframe'] : me.backup.methods;
  const checkboxFallbackAllowed = backupMethods.includes('checkbox');

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pasting, setPasting] = useState<'idle' | 'copied'>('idle');
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [lastResult, setLastResult] = useState<ConfirmBackupResult | null>(null);
  // T4'-C2: separate recovery-key modal. Opened by either the
  // pre-backup `Back up wallet` CTA or the ready-state `Recovery key`
  // affordance. Owned entirely by `WalletRecoveryKeyPanel`.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // Slice "Wallet-to-wallet SOL funding": Move SOL modal state owned
  // by this panel so it survives transient unmounts of the inner
  // settings strip (e.g. an archive flow that re-renders the row).
  const [moveSolOpen, setMoveSolOpen] = useState(false);
  const [moveSolSource, setMoveSolSource] = useState<string | null>(null);
  // T4'-C: track auto-confirm outcomes from the iframe success path.
  const [exportConfirmStatus, setExportConfirmStatus] = useState<'idle' | 'confirming' | 'done' | { kind: 'error'; code: string }>('idle');

  useEffect(() => {
    if (!wallet?.pubkey) {
      setQrDataUrl(null);
      return;
    }
    const pubkey = wallet.pubkey;
    let cancelled = false;
    // QR foreground / background pulled from CSS tokens so a future
    // light theme can recolour the QR pair without touching this file.
    //
    // CRITICAL: the tokens are scoped to `.listen-root[data-theme-id="…"]`,
    // NOT to `:root`. Reading from `document.documentElement` returns
    // empty for both vars, and the previous fallback chain produced
    // an unreliable pair on first render. Look up the nearest
    // listen-root element and read the tokens THAT have the active
    // theme's overrides applied.
    const scope = (typeof document !== 'undefined'
      ? (document.querySelector('.listen-root') as HTMLElement | null)
      : null) ?? (typeof document !== 'undefined' ? document.documentElement : null);
    const computed = scope ? getComputedStyle(scope) : null;
    const dark =
      (computed?.getPropertyValue('--qr-dark').trim() || '#0b0d12');
    const light =
      (computed?.getPropertyValue('--qr-light').trim() || '#ffffff');
    // The encoder is lazy-loaded so `qrcode` stays out of the shell
    // bundle — it's only needed once a pubkey is actually rendered.
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(pubkey, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 192,
          color: { dark, light },
        }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wallet?.pubkey]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset the checkbox + last error every time the panel re-opens so
  // a benign close/re-open does not leave the button enabled.
  useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setLastResult(null);
      setRecoveryOpen(false);
      setMoveSolOpen(false);
      setMoveSolSource(null);
      setExportConfirmStatus('idle');
    }
  }, [open]);

  if (!open) return null;

  async function handleCopy() {
    if (!wallet?.pubkey) return;
    try {
      await navigator.clipboard.writeText(wallet.pubkey);
      setPasting('copied');
      setTimeout(() => setPasting('idle'), 1200);
    } catch {
      // best-effort
    }
  }

  async function handleConfirm() {
    if (busy || !acknowledged) return;
    setBusy(true);
    setLastResult(null);
    const result = await confirmBackup({
      source: 'checkbox_fallback',
      authToken: await getToken(),
    });
    setLastResult(result);
    setBusy(false);
    if (result.kind === 'ok') {
      // Refresh /me so the topnav pill flips to "Ready" and the panel
      // re-renders with the deposit UI.
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
  }

  /**
   * T4'-C2: called by `WalletRecoveryKeyPanel`'s iframe after the user
   * has seen their mnemonic inside the export.turnkey.com iframe. We
   * auto-confirm the backup IFF the state is still pre-backup (first
   * export); re-exports from `ready_to_trade` do nothing here.
   *
   * After auto-confirm, we close the recovery modal so the user lands
   * back on `WalletPanel` which re-renders with the deposit view.
   */
  async function handleExportSuccess() {
    if (state === null) return;
    if (!shouldAutoConfirmBackup(state)) {
      // Re-export from ready_to_trade — nothing to do.
      return;
    }
    setExportConfirmStatus('confirming');
    const result = await confirmBackup({
      source: 'export_iframe',
      authToken: await getToken(),
    });
    if (result.kind === 'ok') {
      setExportConfirmStatus('done');
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      setRecoveryOpen(false);
    } else {
      const code =
        result.kind === 'reauth'
          ? 'reauth_required'
          : result.kind === 'error'
            ? result.errorCode
            : 'unknown';
      setExportConfirmStatus({ kind: 'error', code });
    }
  }

  const isReady = state === 'ready_to_trade';
  const needsBackup = state !== null && isPendingBackupState(state);
  // Slice "User-funded nonce setup": the deposit address is server-side
  // visible at BOTH `ready_to_trade` AND `wallet_ready_needs_nonce_setup`
  // (see `withVisibleWallet` in api/src/db/queries/wallets.ts). Mirror
  // that here so the panel shows the deposit UI + Enable Trading CTA
  // during the pre-trade-enable window. The server is the authoritative
  // gate; this client-side check is defence-in-depth on a non-null
  // pubkey.
  const showDepositSurface =
    state === 'ready_to_trade' || state === 'wallet_ready_needs_nonce_setup';
  const showAddress = showDepositSurface && wallet?.pubkey != null;

  // Slice "Terminal wallet selector": every wallet-bearing surface
  // below keys off the SELECTED wallet's `nonce_setup` /
  // `trade_ready`, not the legacy sub-org-wide `me.nonce_setup`
  // (which now reports the primary's view for back-compat). When no
  // wallet has been resolved yet (pre-state / empty list) fall back
  // to the sub-org value so the loading UX is unchanged.
  const nonceSetupRequired =
    selectedWallet !== null
      ? selectedWallet.nonce_setup.required
      : me && !me.reauth_required
        ? me.nonce_setup.required
        : false;
  // Slice "No-nonce trading" (D10): with the api reporting setup
  // optional the wallet already trades, so the CTA stops being a gate —
  // but it stays REACHABLE here, as a faster-lanes offer, because this
  // is the only place a user can still choose to run it.
  const nonceSetupOptional =
    selectedWallet !== null && nonceSetupSurface(selectedWallet.nonce_setup) === 'optional';
  const enableTradingTargetCount =
    selectedWallet?.nonce_setup.target_count ??
    (me && !me.reauth_required ? me.nonce_setup.target_count : 5);
  const enableTradingWalletAccountId = selectedWallet?.wallet_account_id ?? null;
  const hasMultipleEligibleWallets =
    me && !me.reauth_required ? me.wallets.filter((w) => !w.is_archived && w.is_enabled && w.status === 'active').length > 1 : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Wallet"
      data-testid="wallet-panel"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      style={{
        background: 'var(--modal-backdrop)',
        backdropFilter: 'var(--modal-blur)',
        WebkitBackdropFilter: 'var(--modal-blur)',
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-5 sm:p-6 overflow-hidden"
        style={{
          // `--surface` is transparent in zen so the parchment shows
          // through the modal — use `--surface-1` for an opaque
          // elevated card that follows the theme (rice paper in zen,
          // dark in cyan / sunset / etc.).
          background: 'var(--surface-1)',
          border: '1px solid var(--hairline-2)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/*
         * Theme-aware accent decoration so the modal visibly belongs
         * to whichever accent pair the user picked in Tweaks:
         *
         *   - A 2px cinnabar / cyan / hot-pink / etc. scanline along
         *     the top edge (uses the active accent gradient).
         *   - A subtle accent-wash radial in the top corners so the
         *     surface picks up a hint of the active theme without
         *     overpowering content readability.
         *
         * Mirrors the `.panel::before` + `.panel::after` treatment
         * the trade rail uses in listen.css, but inlined here so the
         * modal doesn't need its own panel class.
         */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 0,
            height: 2,
            borderRadius: 999,
            background:
              'linear-gradient(90deg, transparent, var(--accent-primary), transparent)',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        />
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(420px 140px at 0% 0%, color-mix(in srgb, var(--accent-primary) 10%, transparent), transparent 60%), radial-gradient(420px 160px at 100% 100%, color-mix(in srgb, var(--accent-secondary) 8%, transparent), transparent 60%)',
          }}
        />
        <button
          type="button"
          aria-label="Close wallet panel"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            color: 'var(--ink-3)',
            fontSize: 14,
            border: '1px solid var(--hairline)',
            borderRadius: 8,
            padding: '2px 8px',
          }}
        >
          Esc
        </button>

        <h2
          style={{
            color: 'var(--ink-0)',
            fontSize: 16,
            margin: 0,
            marginBottom: 12,
          }}
        >
          {needsBackup ? 'Back up wallet' : 'Wallet'}
        </h2>

        {/*
         * Slice "Terminal wallet selector": the selector sits above
         * the deposit UI so the user always knows WHICH wallet they
         * are looking at.
         *
         * Visibility:
         *   - shown when the user has ≥2 eligible wallets (the
         *     original "single wallet need not pick" intent)
         *   - ALSO shown when the create-wallet feature is enabled,
         *     even with 1 wallet — the selector's dropdown footer
         *     is the only entry point to `POST /api/v1/wallets`.
         *     Without this, a user with exactly one wallet has no
         *     UI affordance to add Wallet 2 / Wallet 3.
         */}
        {(hasMultipleEligibleWallets || getRuntimeConfig().walletCreateEnabled) ? (
          <div style={{ marginBottom: 12 }}>
            <WalletSelector variant="panel" />
          </div>
        ) : null}

        {needsBackup ? (
          <PreBackupBranch
            busy={busy}
            acknowledged={acknowledged}
            onToggle={setAcknowledged}
            onConfirm={handleConfirm}
            lastResult={lastResult}
            checkboxFallbackAllowed={checkboxFallbackAllowed}
            onOpenRecovery={() => setRecoveryOpen(true)}
            exportConfirmStatus={exportConfirmStatus}
          />
        ) : showAddress ? (
          <>
            <ReadyBranch
              pubkey={wallet!.pubkey}
              qrDataUrl={qrDataUrl}
              pasting={pasting}
              onCopy={handleCopy}
              onOpenRecovery={() => setRecoveryOpen(true)}
              nonceSetupRequired={nonceSetupRequired}
              nonceSetupOptional={nonceSetupOptional}
              isFullyReady={isReady}
              enableTradingWalletAccountId={enableTradingWalletAccountId}
              enableTradingTargetCount={enableTradingTargetCount}
            />
            {/*
             * Slice "Per-wallet positions / fills + wallet
             * management UI": rename / set-primary / archive UI
             * for the currently-selected wallet. Hidden when no
             * wallet has been resolved yet (pre-state).
             */}
            {selectedWalletAccountId !== null ? (
              <WalletSettingsPanel
                walletAccountId={selectedWalletAccountId}
                {...(isMoveSolEnabled()
                  ? {
                      onOpenMoveSol: (id: string) => {
                        setMoveSolSource(id);
                        setMoveSolOpen(true);
                      },
                    }
                  : {})}
              />
            ) : null}
          </>
        ) : (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
            Wallet is still provisioning. Refresh in a moment.
          </p>
        )}
      </div>

      {/*
       * Sibling modal. Stacked above this panel via z-[60]. Owns the
       * Turnkey export iframe; never co-located with the deposit UI.
       */}
      <WalletRecoveryKeyPanel
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onSuccess={handleExportSuccess}
        initialWalletAccountId={selectedWalletAccountId}
      />
      {/*
       * Slice "Wallet-to-wallet SOL funding": Move SOL modal,
       * z-[60] sibling. Owns its own state lifecycle; sourceWalletAccountId
       * is set when the user clicks the settings-panel button.
       */}
      {moveSolOpen && moveSolSource !== null ? (
        <MoveSolPanel
          open={moveSolOpen}
          onClose={() => {
            setMoveSolOpen(false);
            setMoveSolSource(null);
          }}
          sourceWalletAccountId={moveSolSource}
        />
      ) : null}
    </div>
  );
}

function PreBackupBranch({
  busy,
  acknowledged,
  onToggle,
  onConfirm,
  lastResult,
  checkboxFallbackAllowed,
  onOpenRecovery,
  exportConfirmStatus,
}: {
  busy: boolean;
  acknowledged: boolean;
  onToggle: (next: boolean) => void;
  onConfirm: () => Promise<void>;
  lastResult: ConfirmBackupResult | null;
  checkboxFallbackAllowed: boolean;
  onOpenRecovery: () => void;
  exportConfirmStatus:
    | 'idle'
    | 'confirming'
    | 'done'
    | { kind: 'error'; code: string };
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3" data-testid="wallet-pre-backup">
      <p style={{ color: 'var(--ink-1)', fontSize: 13, margin: 0 }}>
        Back up your wallet before depositing funds. The recovery key is the
        only way to access this wallet outside the app.
      </p>
      <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: 0 }}>
        Your deposit address appears after you save your recovery key.
      </p>

      <button
        type="button"
        data-testid="wallet-open-recovery"
        onClick={onOpenRecovery}
        style={{
          background:
            'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          color: 'var(--ink-0)',
          border: '1px solid var(--hairline-2)',
          padding: '10px 14px',
          borderRadius: 10,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Back up wallet
      </button>

      {exportConfirmStatus === 'confirming' ? (
        <p
          data-testid="wallet-export-confirm-status"
          style={{ color: 'var(--ink-3)', fontSize: 12, margin: 0 }}
        >
          Enabling trading...
        </p>
      ) : null}
      {typeof exportConfirmStatus === 'object' && exportConfirmStatus.kind === 'error' ? (
        <p
          data-testid="wallet-export-confirm-error"
          style={{ color: 'var(--down)', fontSize: 12, margin: 0 }}
        >
          Couldn&apos;t confirm backup: {exportConfirmStatus.code}
        </p>
      ) : null}

      {/* T4'-A checkbox fallback (only when the api/ env flag is on). */}
      {checkboxFallbackAllowed ? (
        <div
          data-testid="wallet-checkbox-fallback"
          style={{
            borderTop: '1px dashed var(--hairline)',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <p style={{ color: 'var(--ink-3)', fontSize: 11, margin: 0 }}>
            Dev fallback: confirm without the export iframe.
          </p>
          <label
            htmlFor="wallet-backup-ack"
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              color: 'var(--ink-1)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <input
              id="wallet-backup-ack"
              data-testid="wallet-backup-ack"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={busy}
              style={{ marginTop: 2 }}
            />
            <span>I understand I should back up this wallet before depositing.</span>
          </label>
          <button
            type="button"
            data-testid="wallet-finish-security"
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy || !acknowledged}
            style={{
              background:
                'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              color: 'var(--ink-0)',
              border: '1px solid var(--hairline-2)',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 13,
              cursor: busy || !acknowledged ? 'not-allowed' : 'pointer',
              opacity: busy || !acknowledged ? 0.6 : 1,
            }}
          >
            {busy ? 'Enabling trading…' : 'Confirm and enable trading'}
          </button>
          {lastResult && lastResult.kind !== 'ok' ? (
            <p
              data-testid="wallet-finish-error"
              style={{ color: 'var(--down)', fontSize: 12 }}
            >
              {lastResult.kind === 'reauth'
                ? 'Session expired. Sign in again to continue.'
                : `Error: ${lastResult.errorCode}${
                    lastResult.message && lastResult.message !== lastResult.errorCode
                      ? ` (${lastResult.message})`
                      : ''
                  }`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReadyBranch({
  pubkey,
  qrDataUrl,
  pasting,
  onCopy,
  onOpenRecovery,
  nonceSetupRequired,
  nonceSetupOptional,
  isFullyReady,
  enableTradingWalletAccountId,
  enableTradingTargetCount,
}: {
  pubkey: string;
  qrDataUrl: string | null;
  pasting: 'idle' | 'copied';
  onCopy: () => Promise<void>;
  onOpenRecovery: () => void;
  /**
   * Slice "User-funded nonce setup": when true, the wallet exists but
   * the user has not yet created per-user durable nonce accounts. The
   * Enable Trading CTA renders under the deposit address and unmounts
   * automatically once `/me` reports `required: false`.
   */
  nonceSetupRequired: boolean;
  /**
   * Slice "No-nonce trading" (D10): the wallet trades already but its
   * nonce pool is unprovisioned, so the SAME panel renders as an
   * optional "faster trading lanes" offer. Mutually exclusive with
   * `nonceSetupRequired`.
   */
  nonceSetupOptional: boolean;
  /**
   * Slice "User-funded nonce setup": true only when state ===
   * `ready_to_trade`. The "Wallet is ready to trade" badge renders
   * only when fully ready; for the pre-trade-enable window we render
   * the deposit address + the Enable Trading CTA WITHOUT the green
   * ready badge so the UI doesn't claim readiness prematurely.
   */
  isFullyReady: boolean;
  /**
   * Slice "Per-wallet nonce setup": optional wallet UUID to target the
   * wallet-scoped nonce-setup route. When `null`, the EnableTradingPanel
   * falls back to the legacy primary route.
   */
  enableTradingWalletAccountId: string | null;
  /**
   * Slice "Per-wallet nonce setup": target nonce-count from the primary
   * wallet's per-wallet `nonce_setup.target_count`, falling back to the
   * sub-org `me.nonce_setup.target_count` on older api/ responses.
   */
  enableTradingTargetCount: number;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4" data-testid="wallet-ready-branch">
      <div className="flex flex-col items-center gap-2">
        {/*
         * Frame the QR in a theme-aware card so the high-contrast
         * paint (white / dark blue, required by the QR algorithm for
         * scanning reliability) reads as a deliberate deposit chip
         * instead of a stark white box on whatever the page surface
         * happens to be. Padding + token border + token radius keeps
         * the chip consistent with the rest of the modal under both
         * the dark and zen themes.
         */}
        {qrDataUrl ? (
          <div
            style={{
              padding: 8,
              borderRadius: 12,
              background: 'var(--qr-light)',
              border: '1px solid var(--hairline-2)',
            }}
          >
            <img
              src={qrDataUrl}
              width={176}
              height={176}
              alt="Deposit address QR"
              data-testid="wallet-qr"
              style={{ display: 'block', borderRadius: 6 }}
            />
          </div>
        ) : (
          <div
            style={{
              width: 192,
              height: 192,
              background: 'var(--input-bg)',
              borderRadius: 12,
              border: '1px solid var(--hairline)',
            }}
          />
        )}
        <code
          data-testid="wallet-pubkey"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--ink-1)',
            wordBreak: 'break-all',
            textAlign: 'center',
            padding: '4px 8px',
          }}
        >
          {pubkey}
        </code>
        <button
          type="button"
          onClick={() => {
            void onCopy();
          }}
          data-testid="wallet-copy"
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--hairline)',
            color: 'var(--ink-1)',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {pasting === 'copied' ? 'Copied!' : 'Copy address'}
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--hairline)' }} />

      {/*
        Slice "User-funded nonce setup": deposit + balance area is above
        this point; the CTA lives directly under it per the approved
        placement. Renders when /me says setup is needed, or (D10) when
        it is merely available; on success the component invalidates
        /me, the pool reads complete, and this branch unmounts.
      */}
      {nonceSetupRequired ? (
        <EnableTradingPanel
          walletAccountId={enableTradingWalletAccountId}
          targetCount={enableTradingTargetCount}
        />
      ) : nonceSetupOptional ? (
        // The OFFER now goes through Flash — same flow, one price, one
        // click. The required path above is a gate, not an upgrade, and
        // keeps its inline preflight → confirm panel.
        <FlashOfferPanel walletAccountId={enableTradingWalletAccountId} />
      ) : null}

      {isFullyReady ? (
        <div
          data-testid="wallet-ready"
          style={{
            background: 'color-mix(in srgb, var(--up) 8%, transparent)',
            color: 'var(--ink-0)',
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 12,
            border:
              '1px solid color-mix(in srgb, var(--up) 36%, transparent)',
          }}
        >
          Wallet is ready to trade. Your backup is the only way to recover funds outside the app.
        </div>
      ) : null}

      <button
        type="button"
        data-testid="wallet-open-recovery"
        onClick={onOpenRecovery}
        style={{
          background: 'transparent',
          border: '1px solid var(--hairline)',
          color: 'var(--ink-1)',
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 12,
          alignSelf: 'flex-start',
        }}
      >
        Recovery key
      </button>
    </div>
  );
}

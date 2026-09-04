'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/nextjs';
import {
  setupNoncesRecoveringAuthorization,
  type NonceSetupPartialFailureItem,
  type NonceSetupPreflight,
  type NonceSetupResult,
} from '@/lib/api/wallet-nonce-setup';

/**
 * Slice "User-funded nonce setup": CTA inside `WalletPanel.tsx`.
 *
 * Two-step UX:
 *   1. User clicks `Enable trading` -> dry-run preflight via
 *      `setupNonces({ dryRun: true })`. We show balance / cost /
 *      missing count.
 *   2. User clicks `Confirm setup` -> live execute via `setupNonces({})`.
 *      Trading signs 5 sequential createAccount + nonceInitialize txs;
 *      typical wall time 5-15s.
 *
 * On success the component invalidates the `['api','v1','me']` React
 * Query so `WalletPanel` re-renders and this CTA unmounts (because
 * `me.nonce_setup.required` flips to false).
 *
 * Error branches that map to UX state:
 *   - `reauth` -> open Clerk sign-in modal.
 *   - `insufficient_balance` -> show the SOL shortfall the user needs
 *     to deposit, then re-enable the button so they can re-preflight
 *     after they top up.
 *   - `partial_failure` -> show "X of N created. Retry to finish setup."
 *     with a Retry button. Calls `setupNonces({})` again; the backend
 *     route's `listMissingSlots` only returns slots still absent, so
 *     retries are idempotent.
 *   - `wrong_state` / generic error / network -> show sanitized copy.
 */

// ───────── pure helpers (test seams) ─────────

export type EnableTradingStage =
  | { kind: 'idle' }
  | { kind: 'preflight_loading' }
  | { kind: 'preflight_ready'; preflight: NonceSetupPreflight }
  | { kind: 'executing' }
  | { kind: 'error'; copy: string; retryable: boolean }
  | { kind: 'partial'; createdCount: number; targetCount: number; failures: ReadonlyArray<NonceSetupPartialFailureItem> };

/**
 * Format a lamport count as a short SOL string. Mirrors what users see
 * elsewhere in the dashboard: trailing zeros stripped, 6-dp max.
 */
export function formatSolFromLamports(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports <= 0) return '0';
  const sol = lamports / 1e9;
  // 6 decimals is enough for nonce-setup costs; trim trailing zeros.
  return sol.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Translate a `NonceSetupResult` into the next `EnableTradingStage`.
 * Pure so tests can assert the branch table without rendering React.
 *
 * Returns `null` when the caller should NOT re-render — e.g. on the
 * `ok` branch we trigger React Query invalidation instead and let
 * `WalletPanel` decide whether this component should still mount.
 */
export function pickStageFromResult(
  result: NonceSetupResult,
  ctx: { targetCount: number },
): EnableTradingStage | null {
  switch (result.kind) {
    case 'preflight':
      return { kind: 'preflight_ready', preflight: result.preflight };
    case 'ok':
      // Caller invalidates /me; no local state needed.
      return null;
    case 'partial_failure':
      return {
        kind: 'partial',
        createdCount: result.created_count,
        targetCount: ctx.targetCount,
        failures: result.failures,
      };
    case 'insufficient_balance': {
      const shortfallLamports = Math.max(
        0,
        result.required_lamports - result.observed_balance_lamports,
      );
      return {
        kind: 'error',
        copy: `Not enough SOL in your wallet. Deposit at least ${formatSolFromLamports(
          shortfallLamports,
        )} more SOL and try again.`,
        retryable: true,
      };
    }
    case 'wrong_state':
      return {
        kind: 'error',
        copy: `Your wallet is not ready for setup yet. ${result.state}`,
        retryable: false,
      };
    case 'reauth':
      return {
        kind: 'error',
        copy: 'Your session expired. Sign in again to continue.',
        retryable: false,
      };
    case 'error':
      return { kind: 'error', copy: copyForErrorCode(result.errorCode), retryable: true };
  }
}

export function copyForErrorCode(errorCode: string): string {
  switch (errorCode) {
    case 'trading_engine_unavailable':
    case 'trading_engine_timeout':
      return 'Trading engine unavailable. Try again in a moment.';
    case 'no_active_authorization':
      // Reaching the user means the automatic refresh-and-retry in
      // `setupNoncesRecoveringAuthorization` also failed, so "sign in
      // again" would be a lie — the fix is another retry (transient) or
      // support (revoked).
      return 'Your trading authorization expired. Retry to refresh it.';
    case 'signer_material_missing':
      return 'Wallet signer material is not available. Refresh and try again.';
    case 'nonce_setup_rpc_unavailable':
      return 'Solana RPC is unreachable. Try again in a moment.';
    case 'network_error':
      return 'Network error. Check your connection and try again.';
    case 'shape_mismatch':
      return 'Got an unexpected response from the server. Try again.';
    default:
      return `Setup failed (${errorCode}). Try again.`;
  }
}

/**
 * Resolved when the user has confirmed setup. The supporting copy is
 * carried separately so the component prop can be string-literal-typed.
 */
export const ENABLE_TRADING_COPY = {
  title: 'Enable trading',
  description:
    'This one-time setup creates nonce accounts for faster, reliable trading. It costs a small amount of SOL from this wallet.',
  buttonIdle: 'Enable trading',
  buttonConfirm: 'Confirm setup',
  buttonCancel: 'Cancel',
  buttonRetry: 'Retry',
  executing: 'Creating nonce accounts…',
  executingDetail: 'This may take 10–20 seconds.',
} as const;

/**
 * Slice "No-nonce trading" (D10): the same flow, framed as the offer it
 * is once `/me` reports setup optional — the wallet already trades, so
 * nothing here is a step the user owes anyone.
 */
export const ENABLE_TRADING_OPTIONAL_COPY = {
  title: 'Faster trading lanes',
  description:
    'Optional: this one-time setup gives this wallet its own nonce accounts, for faster and more reliable execution. It costs a small amount of SOL from this wallet.',
  buttonIdle: 'Set up faster lanes',
} as const;

// ───────── React component ─────────

export interface EnableTradingPanelProps {
  /**
   * Slice "Per-wallet nonce setup": when provided, the panel targets
   * the wallet-scoped nonce-setup route for this specific wallet.
   * When omitted, the panel falls back to the legacy primary route
   * (`POST /api/v1/wallet/nonce/setup`).
   *
   * The Terminal's `WalletPanel` passes the primary wallet's id here
   * once `me.wallets` is populated, so the per-wallet route is
   * exercised end-to-end in the default flow.
   */
  walletAccountId?: string | null;
  /**
   * Optional override for the target nonce count. Defaults to `5` to
   * mirror the api/'s `NONCE_COUNT_PER_USER` default. When the caller
   * has `me.nonce_setup.target_count`, pass it here so the UX copy
   * stays in sync with the server.
   */
  targetCount?: number;
  /**
   * Slice "No-nonce trading" (D10): the wallet is already trade-ready
   * without a nonce pool, so this panel is an offer rather than a gate.
   * Copy only — the flow it runs is identical.
   */
  optional?: boolean;
}

const DEFAULT_TARGET_COUNT = 5;

export function EnableTradingPanel(
  props: EnableTradingPanelProps = {},
): React.ReactElement {
  const walletAccountId = props.walletAccountId ?? null;
  const targetCount =
    typeof props.targetCount === 'number' && Number.isFinite(props.targetCount) && props.targetCount > 0
      ? Math.floor(props.targetCount)
      : DEFAULT_TARGET_COUNT;
  const copy =
    props.optional === true
      ? { ...ENABLE_TRADING_COPY, ...ENABLE_TRADING_OPTIONAL_COPY }
      : ENABLE_TRADING_COPY;
  const [stage, setStage] = useState<EnableTradingStage>({ kind: 'idle' });
  const queryClient = useQueryClient();
  const clerk = useClerk();
  const { getToken } = useAuth();
  // Mirrors `stage` for the runLive re-entry guard: a same-frame
  // double-click would otherwise issue two live setupNonces POSTs (the
  // server advisory lock serializes them, but the second waits the
  // full 10-20s holding a connection for an idempotent no-op).
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Every exit must land on a real stage: a reauth/throw that left the
  // stage at `preflight_loading`/`executing` wedged the panel forever
  // (the re-entry guard blocks clicks; nothing re-drives the state).
  const runPreflight = useCallback(async () => {
    setStage({ kind: 'preflight_loading' });
    try {
      const result = await setupNoncesRecoveringAuthorization({
        dryRun: true,
        authToken: await getToken(),
        walletAccountId,
      });
      if (result.kind === 'reauth') {
        setStage({
          kind: 'error',
          copy: 'Your session expired. Sign in again to continue.',
          retryable: true,
        });
        clerk.openSignIn();
        return;
      }
      const next = pickStageFromResult(result, { targetCount });
      if (next) setStage(next);
    } catch {
      setStage({
        kind: 'error',
        copy: 'Network error. Check your connection and try again.',
        retryable: true,
      });
    }
  }, [clerk, getToken, walletAccountId, targetCount]);

  const runLive = useCallback(async () => {
    if (stageRef.current.kind === 'executing') return;
    stageRef.current = { kind: 'executing' };
    setStage({ kind: 'executing' });
    const fail = (copy: string): void => {
      const next = { kind: 'error', copy, retryable: true } as const;
      stageRef.current = next;
      setStage(next);
    };
    try {
      const result = await setupNoncesRecoveringAuthorization({
        authToken: await getToken(),
        walletAccountId,
      });
      if (result.kind === 'reauth') {
        fail('Your session expired. Sign in again to continue.');
        clerk.openSignIn();
        return;
      }
      if (result.kind === 'ok') {
        // The /me query will re-fetch and `me.nonce_setup.required` flips
        // to false, which causes WalletPanel to unmount this component.
        await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
        return;
      }
      const next = pickStageFromResult(result, { targetCount });
      if (next) setStage(next);
    } catch {
      fail('Network error. Check your connection and try again.');
    }
  }, [clerk, getToken, queryClient, walletAccountId, targetCount]);

  const reset = useCallback(() => setStage({ kind: 'idle' }), []);

  return (
    <div
      data-testid="enable-trading-panel"
      className="flex flex-col gap-2"
      style={{
        background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        borderRadius: 10,
        padding: '10px 12px',
        color: 'var(--ink-0)',
        fontSize: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{copy.title}</div>
      <p style={{ color: 'var(--ink-2)', margin: 0 }}>{copy.description}</p>

      {stage.kind === 'idle' ? (
        <button
          type="button"
          data-testid="enable-trading-cta"
          onClick={() => void runPreflight()}
          style={primaryButtonStyle}
        >
          {copy.buttonIdle}
        </button>
      ) : null}

      {stage.kind === 'preflight_loading' ? (
        <p data-testid="enable-trading-preflight-loading" style={{ color: 'var(--ink-3)' }}>
          Checking balance…
        </p>
      ) : null}

      {stage.kind === 'preflight_ready' ? (
        <PreflightSummary
          preflight={stage.preflight}
          onConfirm={() => void runLive()}
          onCancel={reset}
        />
      ) : null}

      {stage.kind === 'executing' ? (
        <div data-testid="enable-trading-executing" style={{ color: 'var(--ink-1)' }}>
          <div>{copy.executing}</div>
          <div style={{ color: 'var(--ink-3)' }}>{copy.executingDetail}</div>
        </div>
      ) : null}

      {stage.kind === 'error' ? (
        <div data-testid="enable-trading-error">
          <p style={{ color: 'var(--down)', margin: 0 }}>{stage.copy}</p>
          {stage.retryable ? (
            <button type="button" onClick={() => void runPreflight()} style={primaryButtonStyle}>
              {copy.buttonRetry}
            </button>
          ) : null}
        </div>
      ) : null}

      {stage.kind === 'partial' ? (
        <div data-testid="enable-trading-partial">
          <p style={{ color: 'var(--down)', margin: 0 }}>
            {stage.createdCount} of {stage.targetCount} nonce accounts created. Retry to finish
            setup.
          </p>
          <button type="button" onClick={() => void runLive()} style={primaryButtonStyle}>
            {copy.buttonRetry}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PreflightSummary({
  preflight,
  onConfirm,
  onCancel,
}: {
  preflight: NonceSetupPreflight;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const missingCount = preflight.missing_slots.length;
  return (
    <div data-testid="enable-trading-preflight" className="flex flex-col gap-1">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, color: 'var(--ink-1)' }}>
        <li>
          Wallet balance:{' '}
          <strong>{formatSolFromLamports(preflight.wallet_balance_lamports)} SOL</strong>
        </li>
        <li>
          Estimated setup cost:{' '}
          <strong>{formatSolFromLamports(preflight.estimated_cost_lamports)} SOL</strong>
        </li>
        <li>
          Nonce accounts:{' '}
          <strong>
            {preflight.existing_count} of {preflight.target_count}
          </strong>{' '}
          (missing {missingCount})
        </li>
      </ul>
      <div className="flex gap-2" style={{ marginTop: 4 }}>
        <button
          type="button"
          data-testid="enable-trading-confirm"
          onClick={onConfirm}
          disabled={!preflight.sufficient}
          style={preflight.sufficient ? primaryButtonStyle : disabledButtonStyle}
        >
          {ENABLE_TRADING_COPY.buttonConfirm}
        </button>
        <button
          type="button"
          data-testid="enable-trading-cancel"
          onClick={onCancel}
          style={ghostButtonStyle}
        >
          {ENABLE_TRADING_COPY.buttonCancel}
        </button>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: 'none',
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'var(--input-bg)',
  color: 'var(--ink-3)',
  cursor: 'not-allowed',
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-1)',
  border: '1px solid var(--hairline)',
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

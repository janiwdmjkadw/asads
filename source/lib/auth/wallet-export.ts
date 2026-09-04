'use client';

import type { MeWalletEntry, ProvisioningState } from '../api/me';

/**
 * Slice T4'-C decision helpers (pure functions). Extracted so the
 * WalletPanel render branches can be unit-tested without React
 * Testing Library; the terminal repo ships `bun test` only.
 */

/**
 * True when the export iframe is the right surface for this state.
 * Pre-backup (`wallet_ready_needs_backup` / legacy alias),
 * `wallet_ready_needs_nonce_setup` (a freshly-created secondary
 * wallet in slice "Per-wallet export / recovery" lands here while
 * its own nonces are still pending), AND post-backup
 * (`ready_to_trade`) all allow export.
 */
export function isExportableState(state: ProvisioningState): boolean {
  return (
    state === 'wallet_ready_needs_backup' ||
    state === 'wallet_ready_needs_passkey_root' ||
    state === 'wallet_ready_needs_nonce_setup' ||
    state === 'ready_to_trade'
  );
}

/**
 * True iff a successful iframe export should AUTO-CALL
 * `/api/v1/wallet/backup/confirm`. Only fires on the FIRST export
 * (state still pre-backup). Re-exports from `ready_to_trade` skip
 * the call so we don't re-emit `provisioning.ready_to_trade`.
 */
export function shouldAutoConfirmBackup(state: ProvisioningState): boolean {
  return state === 'wallet_ready_needs_backup' || state === 'wallet_ready_needs_passkey_root';
}

/**
 * Slice "Per-wallet export / recovery": true iff a wallet entry
 * from `me.wallets[]` can be selected for export. Archived,
 * disabled, or non-active wallets are excluded — the api/ would
 * reject the request anyway, and excluding them client-side keeps
 * the picker honest.
 */
export function isExportableWalletEntry(w: MeWalletEntry): boolean {
  return !w.is_archived && w.is_enabled && w.status === 'active';
}

/**
 * Picks the default wallet to show selected when the recovery
 * modal opens. Prefers `is_primary === true`; falls back to the
 * first exportable entry in display order; returns `null` when no
 * eligible wallet exists.
 */
export function pickDefaultExportWallet(
  wallets: ReadonlyArray<MeWalletEntry>,
): MeWalletEntry | null {
  const eligible = wallets.filter(isExportableWalletEntry);
  if (eligible.length === 0) return null;
  const primary = eligible.find((w) => w.is_primary);
  if (primary) return primary;
  // Already sorted by api/ in primary-first / display_order / created
  // order; the first element is the deterministic default.
  return eligible[0] ?? null;
}

/**
 * Slice "Per-wallet nonce setup": picks the primary wallet entry
 * from `me.wallets[]`, or `null` when no primary is present.
 * Filters to entries that pass the per-wallet liveness check so an
 * archived/disabled primary does not match; the api/'s sort
 * guarantees a single `is_primary === true` row when one exists.
 *
 * The Terminal's `WalletPanel` uses this to thread the primary's
 * `wallet_account_id` and `nonce_setup.target_count` into the
 * `EnableTradingPanel` so the per-wallet nonce-setup route is
 * exercised end-to-end.
 */
export function pickPrimaryWalletEntry(
  wallets: ReadonlyArray<MeWalletEntry>,
): MeWalletEntry | null {
  const primary = wallets.find((w) => w.is_primary && isExportableWalletEntry(w));
  return primary ?? null;
}

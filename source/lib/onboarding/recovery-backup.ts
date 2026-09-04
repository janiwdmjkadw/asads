'use client';

import { confirmBackup } from '@/lib/api/wallet-backup';

/**
 * Persist the recovery-key backup after a successful reveal, shared by the
 * classic onboarding modal and the full-screen `/welcome` flow so both
 * record it the same way.
 *
 * Carries the wallet id so the api/ stamps the per-wallet
 * `backup_confirmed_at` (the prefetched export deliberately skipped it).
 * Idempotent server-side; one retry on transient failure so a dropped
 * request doesn't silently burn another export token next session.
 *
 * Returns whether the server accepted it — the caller invalidates `/me`.
 */
export async function persistRecoveryBackup(input: {
  readonly getToken: () => Promise<string | null>;
  readonly walletAccountId: string | null;
}): Promise<boolean> {
  const { getToken, walletAccountId } = input;
  let result = await confirmBackup({
    source: 'export_iframe',
    authToken: await getToken(),
    walletAccountId,
  });
  if (result.kind !== 'ok') {
    result = await confirmBackup({
      source: 'export_iframe',
      authToken: await getToken(),
      walletAccountId,
    });
  }
  return result.kind === 'ok';
}

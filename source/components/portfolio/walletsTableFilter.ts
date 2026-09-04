import type { MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';

/**
 * Slice "Portfolio page wallets tab": pure filter helper for the
 * Wallets table search box + "Show archived" toggle. Extracted so we
 * can unit-test the filter logic without rendering React.
 *
 *   - `search` matches case-insensitively against the wallet's
 *     display name (`walletDisplayName(...)`) AND its full
 *     `wallet_pubkey`. Empty / whitespace-only search returns all.
 *   - `showArchived` controls whether archived wallets are included.
 */
export function filterWalletsForTable(
  wallets: ReadonlyArray<MeWalletEntry>,
  opts: { readonly search: string; readonly showArchived: boolean },
): MeWalletEntry[] {
  const needle = opts.search.trim().toLowerCase();
  return wallets.filter((w) => {
    if (!opts.showArchived && w.is_archived) return false;
    if (needle.length === 0) return true;
    const label = walletDisplayName(w).toLowerCase();
    const pubkey = w.wallet_pubkey.toLowerCase();
    return label.includes(needle) || pubkey.includes(needle);
  });
}

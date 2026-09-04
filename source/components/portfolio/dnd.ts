/**
 * Slice "Portfolio page wallets tab": shared react-dnd item types
 * for wallet drag-drop between the WalletsTable and the TransferRail.
 *
 * Single item-type keeps the drop-target accept lists simple. The
 * dragged payload carries just enough to render a drag preview
 * without re-fetching wallet metadata at drop time.
 */

export const WALLET_DND_TYPE = 'portfolio:wallet';

/**
 * Where the dragged row originated. Drop targets use this to decide
 * whether to add, move (remove from previous zone + add), or no-op:
 *   - 'main'        — main wallets list on the left
 *   - 'source'      — From Wallet zone on the right rail
 *   - 'destination' — To Wallet zone on the right rail
 */
export type WalletDndOrigin = 'main' | 'source' | 'destination';

export interface WalletDndItem {
  readonly walletAccountId: string;
  readonly label: string;
  readonly walletPubkey: string;
  readonly origin: WalletDndOrigin;
}

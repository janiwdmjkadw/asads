/**
 * Equal-split SOL-amount sell sizing — the multi-wallet counterpart of the
 * equal-split buy. The total SOL target is divided EVENLY across the
 * selected wallets (sell 3 SOL across 3 wallets = 1 SOL from each), and each
 * wallet sells the token-equivalent of its share at the live spot price,
 * capped at its own balance so it can never oversell.
 *
 * Returns per-wallet token base units; wallets that would sell zero (no
 * balance) are omitted. Pure + framework-free so both the TradePanel and the
 * Instant Trade box share one implementation.
 */
export function equalSplitSolSellTokens(
  solTarget: number,
  walletIds: ReadonlyArray<string>,
  balanceBaseUnitsByWallet: ReadonlyMap<string, bigint>,
  priceLamportsPerBaseUnit: number,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const walletCount = walletIds.length;
  if (walletCount === 0) return out;
  if (!Number.isFinite(solTarget) || solTarget <= 0) return out;
  if (!Number.isFinite(priceLamportsPerBaseUnit) || priceLamportsPerBaseUnit <= 0) return out;

  const lamportsPerWallet = (solTarget / walletCount) * 1e9;
  const targetTokens = BigInt(Math.floor(lamportsPerWallet / priceLamportsPerBaseUnit));
  if (targetTokens <= 0n) return out;

  for (const walletId of walletIds) {
    const balance = balanceBaseUnitsByWallet.get(walletId) ?? 0n;
    const tokens = targetTokens > balance ? balance : targetTokens;
    if (tokens > 0n) out.set(walletId, tokens);
  }
  return out;
}

export interface SolSellFanOutPlan {
  /** Wallets that will actually sell (those with a positive amount). */
  readonly walletIds: string[];
  /** Per-wallet absolute token amount (base-units string), keyed by
   *  wallet_account_id — the `sellTokensInByWallet` the batch endpoint takes. */
  readonly sellTokensInByWallet: Record<string, string>;
}

/**
 * Build the multi-wallet SOL-sell batch plan shared by both trade surfaces:
 * equal-split the SOL target across the wallets, cap each at its live
 * (chain + optimistic-floor) balance, and project the result into the
 * `walletIds` + `sellTokensInByWallet` the batch endpoint consumes. Returns
 * `null` when nothing is sellable. `balanceHints` is the per-wallet display
 * balance map from `mergeSellHintsWithFloors` (base-units strings).
 */
export function planSolSellFanOut(
  solTarget: number,
  walletIds: ReadonlyArray<string>,
  balanceHints: Readonly<Record<string, string>>,
  priceLamportsPerBaseUnit: number,
): SolSellFanOutPlan | null {
  const balanceByWallet = new Map<string, bigint>();
  for (const id of walletIds) {
    const raw = balanceHints[id];
    if (raw === undefined) continue;
    try {
      balanceByWallet.set(id, BigInt(raw));
    } catch {
      // Malformed entry contributes zero (wallet simply won't sell).
    }
  }
  const tokensByWallet = equalSplitSolSellTokens(
    solTarget,
    walletIds,
    balanceByWallet,
    priceLamportsPerBaseUnit,
  );
  if (tokensByWallet.size === 0) return null;
  return {
    walletIds: [...tokensByWallet.keys()],
    sellTokensInByWallet: Object.fromEntries(
      [...tokensByWallet].map(([id, tokens]) => [id, tokens.toString()]),
    ),
  };
}

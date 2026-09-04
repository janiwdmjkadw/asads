/**
 * Slice "Per-mint token split/aggregate": pure planners for the
 * multi-wallet selector's Split Tokens / Aggregate buttons. Both
 * operate on ONE mint's per-wallet balances (base units) and emit
 * per-SOURCE transfer plans — each plan maps to one atomic
 * `transferTokens` call (one durable-nonce tx signed by that source).
 *
 * Rounding contract: integer base units only. Split targets
 * `floor(total / n)` per wallet; the remainder (< n base units) stays
 * with the largest holder, deterministically. Nothing is ever burned
 * or minted: every plan's sends equal its receives.
 */

export interface WalletTokenHolding {
  readonly walletAccountId: string;
  readonly balanceBaseUnits: bigint;
}

export interface PlannedTransfer {
  readonly sourceWalletAccountId: string;
  readonly destinations: ReadonlyArray<{
    readonly walletAccountId: string;
    readonly amountBaseUnits: bigint;
  }>;
}

/**
 * Even out one mint's holdings across the given wallets. Senders are
 * wallets above the floor target; receivers are wallets below it.
 * Greedy matching in deterministic (input) order; the sub-`n`
 * remainder stays with the largest pre-split holder (ties: first in
 * input order) so repeated splits converge instead of oscillating.
 */
export function computeSplitPlan(
  holdings: ReadonlyArray<WalletTokenHolding>,
): PlannedTransfer[] {
  const wallets = holdings.filter((h) => h.balanceBaseUnits >= 0n);
  if (wallets.length < 2) return [];
  const total = wallets.reduce<bigint>((acc, h) => acc + h.balanceBaseUnits, 0n);
  if (total <= 0n) return [];
  const target = total / BigInt(wallets.length);
  const remainder = total - target * BigInt(wallets.length);

  // The remainder rides with the largest holder.
  let largestIdx = 0;
  for (let i = 1; i < wallets.length; i += 1) {
    if (wallets[i]!.balanceBaseUnits > wallets[largestIdx]!.balanceBaseUnits) largestIdx = i;
  }
  const targets = wallets.map(
    (_, idx) => target + (idx === largestIdx ? remainder : 0n),
  );

  const senders: Array<{ walletAccountId: string; excess: bigint }> = [];
  const receivers: Array<{ walletAccountId: string; deficit: bigint }> = [];
  wallets.forEach((h, idx) => {
    const delta = h.balanceBaseUnits - targets[idx]!;
    if (delta > 0n) senders.push({ walletAccountId: h.walletAccountId, excess: delta });
    else if (delta < 0n) receivers.push({ walletAccountId: h.walletAccountId, deficit: -delta });
  });

  const plans: PlannedTransfer[] = [];
  let r = 0;
  for (const sender of senders) {
    const destinations: Array<{ walletAccountId: string; amountBaseUnits: bigint }> = [];
    let excess = sender.excess;
    while (excess > 0n && r < receivers.length) {
      const receiver = receivers[r]!;
      const amount = excess < receiver.deficit ? excess : receiver.deficit;
      if (amount > 0n) {
        destinations.push({ walletAccountId: receiver.walletAccountId, amountBaseUnits: amount });
        excess -= amount;
        receiver.deficit -= amount;
      }
      if (receiver.deficit === 0n) r += 1;
    }
    if (destinations.length > 0) {
      plans.push({ sourceWalletAccountId: sender.walletAccountId, destinations });
    }
  }
  return plans;
}

/**
 * Sweep one mint's FULL balance from every listed wallet into the
 * target (primary) wallet. The target itself never sends; zero
 * balances are skipped. One plan per source.
 */
export function computeAggregatePlan(
  holdings: ReadonlyArray<WalletTokenHolding>,
  targetWalletAccountId: string,
): PlannedTransfer[] {
  const plans: PlannedTransfer[] = [];
  for (const holding of holdings) {
    if (holding.walletAccountId === targetWalletAccountId) continue;
    if (holding.balanceBaseUnits <= 0n) continue;
    plans.push({
      sourceWalletAccountId: holding.walletAccountId,
      destinations: [
        {
          walletAccountId: targetWalletAccountId,
          amountBaseUnits: holding.balanceBaseUnits,
        },
      ],
    });
  }
  return plans;
}

/** Total base units a plan set moves (for confirm copy). */
export function planTotal(plans: ReadonlyArray<PlannedTransfer>): bigint {
  return plans.reduce<bigint>(
    (acc, plan) =>
      acc + plan.destinations.reduce<bigint>((a, d) => a + d.amountBaseUnits, 0n),
    0n,
  );
}

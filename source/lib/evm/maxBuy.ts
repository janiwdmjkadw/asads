const BPS_DENOMINATOR = 10_000n;
const PLATFORM_FEE_BPS = 100n;
const TRADE_GAS_LIMIT = 400_000n;
const PLATFORM_FEE_GAS_LIMIT = 21_000n;
const MIN_FEE_BEARING_SPEND_WEI = 100n;

const MAX_FEE_PER_GAS_WEI: Readonly<Record<string, bigint>> = {
  bsc: 50_000_000_000n,
  robinhood_chain: 5_000_000_000n,
};

/** Worst-case authority for the trade and separate platform-fee leg. */
export function maxBuyGasAuthorityWei(chain: string): bigint | null {
  const maxFeePerGas = MAX_FEE_PER_GAS_WEI[chain];
  return maxFeePerGas === undefined
    ? null
    : (TRADE_GAS_LIMIT + PLATFORM_FEE_GAS_LIMIT) * maxFeePerGas;
}

export function maxBuyRequiredBalanceWei(spendWei: bigint, chain: string): bigint | null {
  const gasAuthority = maxBuyGasAuthorityWei(chain);
  if (gasAuthority === null || spendWei < 0n) return null;
  const platformFeeWei = (spendWei * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  return spendWei + platformFeeWei + gasAuthority;
}

/** Largest fee-bearing spend whose complete worst-case authority fits. */
export function maxBuySpendWei(balanceWei: bigint, chain: string): bigint {
  const gasAuthority = maxBuyGasAuthorityWei(chain);
  if (gasAuthority === null || balanceWei <= gasAuthority) return 0n;

  const availableForSpendAndFee = balanceWei - gasAuthority;
  let spend = (availableForSpendAndFee * BPS_DENOMINATOR)
    / (BPS_DENOMINATOR + PLATFORM_FEE_BPS);

  // The fee is floored, so the division above can be one wei conservative.
  while (
    spend < availableForSpendAndFee
    && spend + 1n + ((spend + 1n) * PLATFORM_FEE_BPS) / BPS_DENOMINATOR
      <= availableForSpendAndFee
  ) {
    spend += 1n;
  }
  while (spend + (spend * PLATFORM_FEE_BPS) / BPS_DENOMINATOR > availableForSpendAndFee) {
    spend -= 1n;
  }
  return spend >= MIN_FEE_BEARING_SPEND_WEI ? spend : 0n;
}

'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMe } from '@/lib/api/me';
import { isEligibleWallet } from '@/lib/state/selected-wallet-store';
import {
  formatLamportsBigInt,
  formatUsdcMicroBigInt,
  useMultiWalletSolBalance,
} from './useMultiWalletSolBalance';

interface WalletBalanceDisplay {
  /** Aggregate SOL across eligible wallets, "{whole}.{3dp}" or "—". */
  readonly sol: string;
  /** Aggregate USDC across the same wallets, "{whole}.{2dp}" or "—". */
  readonly usdc: string;
}

const WalletBalanceContext = createContext<WalletBalanceDisplay | null>(null);

/**
 * Topnav balance pill source-of-truth.
 *
 * The topnav pill is account-wide chrome: it sums every eligible
 * wallet from `/me.wallets` (SOL and USDC alike), independent of the
 * current trading selection. Selected-wallet state is intentionally
 * used only by trade surfaces where exact SPL sell sizing matters.
 */
export function WalletBalanceProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const allWalletIds = useMemo(
    () =>
      me && !me.reauth_required
        ? me.wallets.filter(isEligibleWallet).map((wallet) => wallet.wallet_account_id)
        : [],
    [me],
  );
  const aggregate = useMultiWalletSolBalance(allWalletIds);

  const ready = allWalletIds.length > 0 && aggregate.status === 'ready';
  const display = useMemo<WalletBalanceDisplay>(
    () => ({
      sol: ready ? formatLamportsBigInt(aggregate.totalLamports) : '—',
      usdc: ready ? formatUsdcMicroBigInt(aggregate.totalUsdcMicro) : '—',
    }),
    [ready, aggregate.totalLamports, aggregate.totalUsdcMicro],
  );

  return (
    <WalletBalanceContext.Provider value={display}>
      {children}
    </WalletBalanceContext.Provider>
  );
}

/** Aggregate SOL display string (legacy single-value consumers). */
export function useWalletBalanceContext(): string {
  return useWalletBalancesContext().sol;
}

/** Aggregate SOL + USDC display strings. */
export function useWalletBalancesContext(): WalletBalanceDisplay {
  const value = useContext(WalletBalanceContext);
  if (value == null) {
    throw new Error('useWalletBalancesContext must be used inside WalletBalanceProvider');
  }
  return value;
}

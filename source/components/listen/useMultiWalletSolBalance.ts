'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  coldBootRetry,
  COLD_BOOT_RETRY_DELAY_MS,
  throwOnColdBootReauth,
  withColdBootAuth,
} from '@/lib/api/cold-boot-auth';
import {
  listWalletBalances,
  type WalletBalancesResult,
} from '@/lib/api/wallet-balances';

/**
 * Aggregate SOL balance across a caller-supplied wallet set.
 *
 * Backed by the same `/api/v1/wallets/balances` bulk endpoint the
 * portfolio page already polls via React Query. We re-use the same
 * `queryKey` so the cache is shared — the portfolio tab and the
 * topnav pill drive a single network roundtrip.
 *
 * Cadence is the bulk endpoint's 8s staleTime / 12s refetchInterval.
 * This is intentional: account-wide chrome is a snapshot indicator,
 * not a settlement-feedback channel. Trade surfaces use selected
 * wallet token/SPL balance hooks for exact sell sizing.
 */

const WALLET_BALANCES_KEY = ['api', 'v1', 'wallets', 'balances'] as const;

export interface MultiWalletSolBalance {
  readonly totalLamports: bigint;
  readonly perWallet: ReadonlyMap<string, bigint>;
  /** Aggregate USDC across the same wallet set (micro-USDC, 6dp). */
  readonly totalUsdcMicro: bigint;
  readonly perWalletUsdcMicro: ReadonlyMap<string, bigint>;
  readonly status: 'loading' | 'ready' | 'error';
}

const EMPTY: MultiWalletSolBalance = Object.freeze({
  totalLamports: 0n,
  perWallet: new Map<string, bigint>(),
  totalUsdcMicro: 0n,
  perWalletUsdcMicro: new Map<string, bigint>(),
  status: 'loading',
});

/**
 * Sum the lamports of the wallets in `walletIds` using the bulk
 * `/api/v1/wallets/balances` query as the source of truth. Wallets
 * not present in the response (or whose lamports field is malformed)
 * are silently treated as 0n — same as the portfolio page's existing
 * `totalSolDisplay` aggregator.
 */
export function useMultiWalletSolBalance(
  walletIds: ReadonlyArray<string>,
): MultiWalletSolBalance {
  // Only mounts inside the auth-gated terminal shell (WalletBalanceProvider),
  // so fire immediately with the session COOKIE (null token → cookie auth)
  // instead of waiting for clerk.browser.js; bail only on positive signed-out.
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const query = useQuery<WalletBalancesResult>({
    queryKey: WALLET_BALANCES_KEY,
    // Cold-boot + stale-mirror recovery (mirrors useMe): a token-less
    // first tick or a mirrored JWT that went stale used to resolve
    // `reauth` → status 'error' → the topnav pill rendered "—" for up
    // to several 12s cycles with nothing forcing a token re-mint.
    queryFn: async ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await listWalletBalances({ authToken: token, signal }), token),
      ),
    enabled: isSignedIn !== false,
    staleTime: 8_000,
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => coldBootRetry(failureCount, error as Error),
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });

  // Stable key for the wallet-id array so the memo only re-runs when
  // the actual set of selected wallets changes (not on every
  // `multiSelectedWalletAccountIds` reference identity flip).
  const idsKey = walletIds.slice().sort().join('|');

  return useMemo<MultiWalletSolBalance>(() => {
    if (walletIds.length === 0) return EMPTY;
    const data = query.data;
    if (!data) {
      return { ...EMPTY, status: 'loading' };
    }
    if (data.kind !== 'ok') {
      return { ...EMPTY, status: 'error' };
    }
    const aggregated = sumWalletLamports(data.balances, walletIds);
    const usdc = sumWalletUsdcMicro(data.balances, walletIds);
    return {
      totalLamports: aggregated.totalLamports,
      perWallet: aggregated.perWallet,
      totalUsdcMicro: usdc.totalUsdcMicro,
      perWalletUsdcMicro: usdc.perWallet,
      status: 'ready',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, idsKey]);
}

/**
 * Pure sum helper exported for unit tests. Given the bulk balances
 * payload and a list of wanted wallet ids, returns the per-wallet
 * map (id → lamports BigInt) and the total. Malformed `lamports`
 * strings (non-decimal, negative literal, etc.) are silently
 * treated as `0n` — same as the portfolio page's aggregator.
 */
export interface SumWalletLamportsResult {
  readonly totalLamports: bigint;
  readonly perWallet: ReadonlyMap<string, bigint>;
}

interface WalletLamportsRow {
  readonly wallet_account_id: string;
  readonly lamports: string;
}

export function sumWalletLamports(
  balances: ReadonlyArray<WalletLamportsRow>,
  walletIds: ReadonlyArray<string>,
): SumWalletLamportsResult {
  const wanted = new Set(walletIds);
  const perWallet = new Map<string, bigint>();
  let total = 0n;
  for (const b of balances) {
    if (!wanted.has(b.wallet_account_id)) continue;
    try {
      const lam = BigInt(b.lamports);
      if (lam < 0n) continue;
      perWallet.set(b.wallet_account_id, lam);
      total += lam;
    } catch {
      // skip malformed entries (treat as 0n)
    }
  }
  return { totalLamports: total, perWallet };
}

interface WalletUsdcRow {
  readonly wallet_account_id: string;
  readonly usdc_micro?: string;
}

/**
 * Sum micro-USDC across the wanted wallets — same aggregation pattern
 * (and the same malformed-row tolerance) as `sumWalletLamports`.
 */
export function sumWalletUsdcMicro(
  balances: ReadonlyArray<WalletUsdcRow>,
  walletIds: ReadonlyArray<string>,
): { totalUsdcMicro: bigint; perWallet: ReadonlyMap<string, bigint> } {
  const wanted = new Set(walletIds);
  const perWallet = new Map<string, bigint>();
  let total = 0n;
  for (const b of balances) {
    if (!wanted.has(b.wallet_account_id)) continue;
    try {
      const micro = BigInt(b.usdc_micro ?? '0');
      if (micro < 0n) continue;
      perWallet.set(b.wallet_account_id, micro);
      total += micro;
    } catch {
      // skip malformed entries (treat as 0n)
    }
  }
  return { totalUsdcMicro: total, perWallet };
}

/**
 * Format micro-USDC as a plain "{whole}.{2dp}" dollar string (no `$`,
 * the caller renders the adornment) — mirrors `formatLamportsBigInt`.
 */
export function formatUsdcMicroBigInt(micro: bigint): string {
  if (micro < 0n) return '—';
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

/**
 * Format a lamports `BigInt` as a "{whole}.{3dp}" SOL string —
 * identical format to the legacy `useWalletBalance.formatLamports`
 * so the topnav pill renders consistently regardless of which path
 * (single hot poll vs multi-wallet sum) feeds it.
 */
export function formatLamportsBigInt(lamports: bigint): string {
  if (lamports < 0n) return '—';
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n)
    .toString()
    .padStart(9, '0')
    .slice(0, 3);
  return `${whole.toString()}.${frac}`;
}

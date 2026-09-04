'use client';

import { useQuery, type Query } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';

// Wallet funding provenance for the Discover dev hover card. Backed by
// ingestion `/wallet/:wallet/funding`: current SOL balance plus the
// wallet's FIRST inbound native-SOL transfer (funder address, exchange
// label when the funder is a known CEX hot wallet, timestamp, amount).
// The trace is immutable server-side; only the balance moves.

export interface FundingHop {
  /** The wallet this hop funded. `chain[0].wallet` is the dev wallet. */
  wallet: string;
  funder: string;
  /** Exchange/bridge label when the funder is a known hot wallet. */
  label: string | null;
  fundedAtMs: number | null;
  amountLamports: number | null;
}

export interface WalletFunding {
  wallet: string;
  /** Native SOL balance; null when the chain read failed. */
  solBalanceLamports: number | null;
  solUsd: number;
  /** First inbound transfer sender; null when unknown / none found. */
  funder: string | null;
  /** Exchange label ("Binance", "Coinbase", ...) when the funder is a
   *  known CEX hot wallet; null otherwise (show the funder address). */
  fundingSource: string | null;
  fundedAtMs: number | null;
  fundingAmountLamports: number | null;
  /** False when the history walk hit its page cap before the wallet's
   *  genesis — funding fields are unknown, not absent. */
  complete: boolean;
  /** Funding chain walked funder-to-funder until a labeled CEX/bridge
   *  wallet, a dead end, or the hop cap. `chain[0]` is the wallet's own
   *  funding hop. */
  chain: FundingHop[];
  /** Exchange label at the END of the chain (null when the walk dead-
   *  ended unlabeled). With `originHops > 1` the money moved through
   *  fresh intermediary wallets: "Binance · 2 hops". */
  originSource: string | null;
  /** Hops between this wallet and `originSource` (1 = direct funding). */
  originHops: number;
  /** True when the server hit its request-time budget mid-chain and is
   *  finishing the walk in the background — refetch shortly for the
   *  full origin (the hook does this automatically). */
  chainTruncated: boolean;
}

/**
 * Query options shared by the hook and imperative prefetch, so a trace
 * warmed anywhere (trade-table cell, hover-intent prefetch) is a cache
 * hit everywhere with the same `withBalance` flavor.
 */
export function walletFundingQueryOptions(wallet: string, withBalance: boolean) {
  return {
    queryKey: ['ingestion', 'wallet-funding', wallet, withBalance] as const,
    // The balance-free flavor (trade-table cells) never refetches a
    // COMPLETE trace WITH a funder — that pair is immutable server-side.
    // Funder-less traces are a statement about NOW (a fresh wallet's
    // first funding can land later; the server TTLs them too), and
    // incomplete traces (history walk hit its page cap) keep the 60s
    // remount retry so "Unknown" rows can still resolve.
    // The hover-card flavor shows the live balance, so it stays at 60s.
    staleTime: withBalance
      ? 60_000
      : (query: Query<WalletFunding>) =>
          query.state.data?.complete && query.state.data.funder !== null ? Infinity : 60_000,
    // Keep balance-free traces cached across tab flips and pagination
    // round-trips within a session (default gcTime is 5 minutes).
    ...(withBalance ? {} : { gcTime: 30 * 60_000 }),
    retry: 1,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => {
      const suffix = withBalance ? '' : '?balance=0';
      const url = ingestionApiUrl(`/api/wallet/${encodeURIComponent(wallet)}/funding${suffix}`);
      const res = await fetch(url, { cache: 'no-store', signal });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new Error(`http_${res.status}`);
      }
      return (await res.json()) as WalletFunding;
    },
  };
}

/**
 * Fetch a wallet's funding profile. `enabled` gates on the hover card
 * being open so idle cards never fetch. The funding trace never changes,
 * so a long staleTime is safe (balance staleness is acceptable in a
 * hover context). `withBalance: false` (trade-table cells) skips the
 * server's live `getBalance` RPC entirely — the cell never shows it.
 */
export function useWalletFunding(
  wallet: string | null,
  enabled: boolean,
  opts?: { withBalance?: boolean },
): {
  data: WalletFunding | null;
  loading: boolean;
  error: string | null;
} {
  const withBalance = opts?.withBalance ?? true;
  const query = useQuery<WalletFunding>({
    ...walletFundingQueryOptions(wallet ?? '', withBalance),
    enabled: enabled && wallet !== null && wallet.length > 0 && isIngestionApiConfigured(),
    // A truncated chain means the server is still walking hops in the
    // background; poll briefly until the full origin lands in its cache.
    // Ceiling (~20 refetches ≈ 30s): with multi-hop walking paused server-side,
    // chainTruncated can be a terminal state — an open hover card must not
    // poll it forever.
    refetchInterval: (query) =>
      query.state.data?.chainTruncated && query.state.dataUpdateCount < 20 ? 1_500 : false,
  });
  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? ((query.error as Error).message ?? 'failed') : null,
  };
}

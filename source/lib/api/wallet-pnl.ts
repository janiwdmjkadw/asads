'use client';

import { useQuery } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';

// Wallet PnL profile for the address-profile modal. Backed by the
// ingestion `/wallet/:wallet/pnl` fold over our persisted pump.fun tape
// (scope: what we've ingested — no external indexer). Every SOL figure is
// a cost-basis derivation; the client only formats + slices by timeframe.

export type WalletPnlTimeframe = '1d' | '7d' | '30d' | 'max';

export interface WalletPnlPoint {
  tMs: number;
  realizedSol: number;
}

export interface WalletPnlWindow {
  id: WalletPnlTimeframe;
  realizedPnlSol: number;
  txns: number;
  buys: number;
  sells: number;
  volumeSol: number;
  /** [>500%, 200~500%, 0~200%, 0~-50%, <-50%] position counts. */
  buckets: [number, number, number, number, number];
}

export interface WalletPnlPosition {
  mint: string;
  symbol: string | null;
  name: string | null;
  boughtSol: number;
  soldSol: number;
  boughtTokens: number;
  soldTokens: number;
  remainingTokens: number;
  remainingValueSol: number | null;
  realizedPnlSol: number;
  unrealizedPnlSol: number | null;
  totalPnlSol: number;
  pnlPct: number | null;
  trades: number;
  buys: number;
  sells: number;
  firstTradeAtMs: number;
  lastTradeAtMs: number;
}

export interface WalletPnlTrade {
  mint: string;
  symbol: string | null;
  isBuy: boolean;
  sol: number;
  tMs: number;
}

export interface WalletPnl {
  wallet: string;
  solUsd: number;
  computedAtMs: number;
  tradesAnalyzed: number;
  truncated: boolean;
  firstTradeAtMs: number | null;
  totalRealizedPnlSol: number;
  totalUnrealizedPnlSol: number;
  holdingsValueSol: number;
  /** Native SOL balance (on-chain); null when the chain read was down. */
  solBalanceLamports: number | null;
  series: WalletPnlPoint[];
  windows: WalletPnlWindow[];
  positions: WalletPnlPosition[];
  recentTrades: WalletPnlTrade[];
}

/**
 * Fetch a wallet's PnL profile. `enabled` lets callers gate on the modal
 * being open so a closed profile never fetches. Bounded, cacheable
 * (server sends `max-age=30`), and safe to key off the raw address.
 */
export function useWalletPnl(
  wallet: string | null,
  enabled: boolean,
): {
  data: WalletPnl | null;
  loading: boolean;
  error: string | null;
} {
  const query = useQuery<WalletPnl>({
    queryKey: ['ingestion', 'wallet-pnl', wallet],
    enabled: enabled && wallet !== null && wallet.length > 0 && isIngestionApiConfigured(),
    // Empty dossiers go stale fast: a wallet's first trades reach the
    // tape seconds after they happen, and pinning "no data" for 30s is
    // exactly the "I clicked a wallet and nothing loads" complaint.
    staleTime: (query) => (query.state.data?.tradesAnalyzed === 0 ? 2_000 : 30_000),
    // Fail fast: the default 3 retries × a slow upstream turned into
    // minutes of spinner. One retry, then surface the error state.
    retry: 1,
    queryFn: async ({ signal }) => {
      const url = ingestionApiUrl(`/api/wallet/${encodeURIComponent(wallet!)}/pnl`);
      const res = await fetch(url, { cache: 'no-store', signal });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new Error(`http_${res.status}`);
      }
      return (await res.json()) as WalletPnl;
    },
  });
  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? ((query.error as Error).message ?? 'failed') : null,
  };
}

import type { CandleResolution } from '@/components/trade/types';

export const queryKeys = {
  token: {
    snapshot: (mint: string | null, hydrateIdentity: boolean) =>
      ['token', 'snapshot', mint, hydrateIdentity] as const,
    /** Healthy-stream lite poll (scalars only). Deliberately NOT matched by
     *  the stream's invalidation predicates — repair paths refetch the full
     *  snapshot; this query only ticks on its own interval. */
    snapshotLite: (mint: string | null) =>
      ['token', 'snapshot-lite', mint] as const,
    historyTrades: (
      mint: string | null,
      pageSize: number,
      pageIndex: number,
      refreshKey: string | null,
    ) => ['token', 'history-trades', mint, pageSize, pageIndex, refreshKey] as const,
    candles: (mint: string | null, resolution: CandleResolution, beforeSec: number | null) =>
      ['token', 'candles', mint, resolution, beforeSec] as const,
    topHolders: (mint: string | null, page: number) =>
      ['token', 'top-holders', mint, page] as const,
    listenHolders: (mint: string | null) =>
      ['token', 'listen-holders', mint] as const,
    topTraders: (mint: string | null, page: number) =>
      ['token', 'top-traders', mint, page] as const,
    search: (query: string, sort: string, graduated: boolean) =>
      ['token', 'search', query, sort, graduated] as const,
  },
  trade: {
    positions: (mint: string | null) => ['trade', 'positions', mint] as const,
    tokenBalance: (mint: string | null) => ['trade', 'token-balance', mint] as const,
    inFlight: () => ['trade', 'in-flight'] as const,
    walletBalance: () => ['trade', 'wallet-balance'] as const,
  },
} as const;

'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import type { LiveNewPair } from '@/components/discover/useLiveNewPairs';

export const DEV_TOKENS_PAGE_SIZE = 100;

const DEV_TOKENS_POLL_MS = 60_000;

/** Per-mint row extras served alongside the page's cards. */
export interface DevTokenStats {
  athMarketCapUsd?: number;
  vol1hUsd?: number;
  liquidityUsd?: number;
  /** The creator's own PnL on this coin, USD. */
  devPnlUsd?: number;
}

interface CreatorTokensWire {
  items?: LiveNewPair[];
  total?: number;
  totalPages?: number;
  stats?: Record<string, DevTokenStats>;
}

/**
 * One page of a creator's deploys — the trade page's "Dev Tokens" tab.
 * Backed by the ingestion catalog's `/creator/:address/tokens?page=N`
 * (indexed on creator, newest first, uncapped across pages at 100 per
 * page, DiscoverCard wire shape shared with /search and the Discover
 * feeds). The creator address comes off the token snapshot, so this is
 * automatic for every mint — no user tracking.
 */
export function useDevTokens(
  creator: string | null,
  page: number,
  /** FALSE while the Dev Tokens tab is unselected or the persistent pane
   *  is hidden — pauses the poll without dropping cached rows (they
   *  render instantly on reveal). */
  active: boolean,
): {
  tokens: LiveNewPair[];
  stats: Record<string, DevTokenStats>;
  total: number | null;
  totalPages: number | null;
  loading: boolean;
  error: string | null;
} {
  const enabled = creator !== null && creator.length > 0 && isIngestionApiConfigured();
  const query = useQuery<CreatorTokensWire>({
    queryKey: ['ingestion', 'creator-tokens', creator, page],
    enabled,
    // A deploy list changes when the dev launches or a coin bonds — a
    // minute of staleness is fine and keeps tab flips free. The poll runs
    // only while the tab is visible, so the pane's lifetime never fans
    // out background creator fetches.
    staleTime: 60_000,
    refetchInterval: active ? DEV_TOKENS_POLL_MS : false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const url = ingestionApiUrl(
        `/api/creator/${encodeURIComponent(creator!)}/tokens?page=${page}`,
      );
      const res = await fetch(url, { cache: 'no-store', signal });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new Error(`http_${res.status}`);
      }
      return (await res.json()) as CreatorTokensWire;
    },
  });

  // Tab re-activation heal (mirrors useTopHolders/useTopTraders): the
  // interval timer restarts from zero on the false→true flip and
  // react-query never fires eagerly on it — reopening the Dev Tokens tab
  // could show a deploy list up to a full poll period old (or, before the
  // interval existed, one frozen since the creator first resolved).
  // Refetch right away when reactivated with data older than one period.
  const refetch = query.refetch;
  const wasActiveRef = useRef(active);
  const dataUpdatedAt = query.dataUpdatedAt;
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active || wasActive || !enabled) return;
    if (Date.now() - dataUpdatedAt < DEV_TOKENS_POLL_MS) return;
    void refetch();
  }, [active, enabled, refetch, dataUpdatedAt]);

  return {
    tokens: Array.isArray(query.data?.items) ? query.data.items : EMPTY_TOKENS,
    stats: query.data?.stats ?? EMPTY_STATS,
    total: typeof query.data?.total === 'number' ? query.data.total : null,
    totalPages: typeof query.data?.totalPages === 'number' ? query.data.totalPages : null,
    loading: query.isPending,
    error: query.error ? ((query.error as Error).message ?? 'failed') : null,
  };
}

const EMPTY_TOKENS: LiveNewPair[] = [];
const EMPTY_STATS: Record<string, DevTokenStats> = {};

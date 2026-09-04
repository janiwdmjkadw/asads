import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchIngestionJson, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';

// Per-mint wallet classification (dev / sniper / bundler) from the
// ingestion engine's holder-metrics fold — the badge map rendered next to
// wallet names in the trades / holders / top-traders rows.

export type WalletClass = 'dev' | 'sniper' | 'bundler';

interface WalletClassesResponse {
  v: string;
  mint: string;
  dev: string | null;
  snipers: string[];
  bundlers: string[];
}

const EMPTY: Record<string, WalletClass> = {};

/// Classifications only CHANGE during a coin's early life (snipers are
/// creation-slot by definition; bundlers resolve within seconds of their
/// bundle block), so the poll adapts: near-instant while the coin is
/// young, lazy afterwards. The endpoint is an in-memory engine read with
/// a 2s edge cache, so fast polls coalesce per mint at the CDN — a crowd
/// on a viral launch costs the origin one request per mint per 2s.
const YOUNG_COIN_MS = 15 * 60_000;
const YOUNG_POLL_MS = 2_500;
const SETTLED_POLL_MS = 30_000;

export function useWalletClasses(
  mint: string | undefined,
  createdAtMs?: number | null,
  /** FALSE while the persistent trade pane is hidden — pauses the poll
   *  without dropping the cached badge map (renders instantly on reveal). */
  active = true,
): Record<string, WalletClass> {
  const enabled = Boolean(mint) && isIngestionApiConfigured();
  const young =
    createdAtMs != null && Number.isFinite(createdAtMs)
      ? Date.now() - createdAtMs < YOUNG_COIN_MS
      : true; // unknown age: assume young (fresh coins matter most)
  const query = useQuery({
    queryKey: ['token', 'wallet-classes', mint ?? null],
    enabled,
    refetchInterval: active ? (young ? YOUNG_POLL_MS : SETTLED_POLL_MS) : false,
    refetchOnWindowFocus: false,
    staleTime: young ? 2_000 : 15_000,
    placeholderData: keepPreviousDataForMint(mint ?? null, 2),
    queryFn: ({ signal }) =>
      fetchIngestionJson<WalletClassesResponse>(
        `/api/token/${encodeURIComponent(mint ?? '')}/wallet-classes`,
        { signal, timeoutMs: 10_000 },
      ),
  });

  return useMemo(() => {
    const data = query.data;
    if (!data) return EMPTY;
    const map: Record<string, WalletClass> = {};
    // Order matters: dev wins over sniper/bundler for the same wallet
    // (a dev who snipes their own launch still reads as the dev).
    for (const wallet of data.bundlers) map[wallet] = 'bundler';
    for (const wallet of data.snipers) map[wallet] = 'sniper';
    if (data.dev) map[data.dev] = 'dev';
    return map;
  }, [query.data]);
}

'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  MAX_WATCHED_TOKENS,
  addWatchedToken,
  fetchWatchlist,
  removeWatchedToken,
  type WatchedToken,
} from '@/lib/api/watchlist';

const KEY = ['watchlist'] as const;

export interface WatchlistApi {
  tokens: WatchedToken[];
  mintSet: ReadonlySet<string>;
  /** True once the user is at the server cap — the star disables adding. */
  atCap: boolean;
  /** False for signed-out visitors — the star hides, the query never fires. */
  signedIn: boolean;
  add: (mint: string) => Promise<void>;
  remove: (mint: string) => void;
  isMutating: boolean;
  isLoading: boolean;
}

/**
 * The per-user token watchlist (trade-page star + navbar chip strip).
 * Shared react-query cache so every star and the strip agree instantly;
 * optimistic add/remove mirrors useTrackedAccounts.
 */
export function useWatchlist(): WatchlistApi {
  const qc = useQueryClient();
  // Signed-out gate (mirrors useSpotHoldings): the star mounts on every
  // public trade page, and an ungated query is two 401s (fetch + retry)
  // per anonymous view of the app's highest-traffic route.
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const enabled = mirrorSignedIn !== false;
  // Slow-moving list: 30s staleTime so star/strip remounts reuse the cache.
  const query = useQuery({ queryKey: KEY, queryFn: fetchWatchlist, staleTime: 30_000, enabled });
  const tokens = useMemo(() => query.data ?? [], [query.data]);

  const addMutation = useMutation({
    mutationFn: (mint: string) => addWatchedToken(mint),
    // Optimistic: the star fills on click, not a round trip later.
    onMutate: async (mint: string) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<WatchedToken[]>(KEY);
      qc.setQueryData<WatchedToken[]>(KEY, (cur) => {
        const list = cur ?? [];
        if (list.some((t) => t.mint === mint)) return list;
        return [{ mint, createdAtMs: Date.now() }, ...list];
      });
      return { prev };
    },
    onError: (_e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const removeMutation = useMutation({
    mutationFn: (mint: string) => removeWatchedToken(mint),
    onMutate: async (mint: string) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<WatchedToken[]>(KEY);
      qc.setQueryData<WatchedToken[]>(KEY, (cur) => (cur ?? []).filter((t) => t.mint !== mint));
      return { prev };
    },
    onError: (_e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return {
    tokens,
    mintSet: useMemo(() => new Set(tokens.map((t) => t.mint)), [tokens]),
    atCap: tokens.length >= MAX_WATCHED_TOKENS,
    signedIn: enabled,
    add: (mint: string) => addMutation.mutateAsync(mint).then(() => undefined),
    remove: (mint: string) => removeMutation.mutate(mint),
    isMutating: addMutation.isPending || removeMutation.isPending,
    isLoading: query.isLoading,
  };
}

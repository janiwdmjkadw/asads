'use client';

import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  addHiddenToken,
  fetchHiddenTokens,
  removeAllHiddenTokens,
  removeHiddenToken,
  type HiddenToken,
} from '@/lib/api/hidden-tokens';

const KEY = ['hidden-tokens'] as const;

// Optimistic mutation options, shared between the full hook (Discover page
// + filters modal) and the per-card action hook so every surface mutates
// the same cache the same way — a hidden card disappears on click, not a
// round trip later (mirrors useWatchlist).
function hideMutationOptions(qc: QueryClient) {
  return {
    mutationFn: (mint: string) => addHiddenToken(mint),
    onMutate: async (mint: string) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<HiddenToken[]>(KEY);
      qc.setQueryData<HiddenToken[]>(KEY, (cur) => {
        const list = cur ?? [];
        if (list.some((t) => t.mint === mint)) return list;
        return [{ mint, createdAtMs: Date.now() }, ...list];
      });
      return { prev };
    },
    onError: (_e: unknown, _m: string, ctx?: { prev?: HiddenToken[] }) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  };
}

function unhideMutationOptions(qc: QueryClient) {
  return {
    mutationFn: (mint: string) => removeHiddenToken(mint),
    onMutate: async (mint: string) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<HiddenToken[]>(KEY);
      qc.setQueryData<HiddenToken[]>(KEY, (cur) => (cur ?? []).filter((t) => t.mint !== mint));
      return { prev };
    },
    onError: (_e: unknown, _m: string, ctx?: { prev?: HiddenToken[] }) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  };
}

export interface HiddenTokensApi {
  /** Mints the user has hidden — the Discover rows filter against this. */
  mintSet: ReadonlySet<string>;
  /** False for signed-out visitors — the hide button hides, no query fires. */
  signedIn: boolean;
  hide: (mint: string) => void;
  unhide: (mint: string) => void;
  unhideAll: () => void;
  isMutating: boolean;
  isLoading: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * The per-user hidden-token set (Discover hide button). One shared
 * react-query cache so every card, the row filters, and the modal's
 * "Unhide all" agree instantly. Subscribe from the FEW places that need
 * the set (the Discover page, the filters modal) — cards use
 * `useHideTokenAction` below, which mutates without subscribing.
 */
export function useHiddenTokens(): HiddenTokensApi {
  const qc = useQueryClient();
  // Signed-out gate (mirrors useWatchlist): an ungated query is two 401s
  // per anonymous visitor on the app's landing surface.
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const enabled = mirrorSignedIn !== false;
  const query = useQuery({ queryKey: KEY, queryFn: fetchHiddenTokens, staleTime: 30_000, enabled });
  const tokens = query.data;

  const hideMutation = useMutation(hideMutationOptions(qc));
  const unhideMutation = useMutation(unhideMutationOptions(qc));
  const unhideAllMutation = useMutation({
    mutationFn: () => removeAllHiddenTokens(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<HiddenToken[]>(KEY);
      qc.setQueryData<HiddenToken[]>(KEY, []);
      return { prev };
    },
    onError: (_e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return {
    mintSet: useMemo(
      () => (tokens && tokens.length > 0 ? new Set(tokens.map((t) => t.mint)) : EMPTY_SET),
      [tokens],
    ),
    signedIn: enabled,
    hide: (mint: string) => hideMutation.mutate(mint),
    unhide: (mint: string) => unhideMutation.mutate(mint),
    unhideAll: () => unhideAllMutation.mutate(),
    isMutating:
      hideMutation.isPending || unhideMutation.isPending || unhideAllMutation.isPending,
    isLoading: query.isLoading,
  };
}

export interface HideTokenAction {
  /** True only once Clerk reports signed-in — the button hides otherwise. */
  signedIn: boolean;
  hide: (mint: string) => void;
  unhide: (mint: string) => void;
}

/**
 * Mutation-only slice for the per-card hide button: no query subscription,
 * so hiding one coin re-renders the Discover rows (which DO subscribe) but
 * not every other card's media island.
 */
export function useHideTokenAction(): HideTokenAction {
  const qc = useQueryClient();
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const hideMutation = useMutation(hideMutationOptions(qc));
  const unhideMutation = useMutation(unhideMutationOptions(qc));
  return {
    signedIn: mirrorSignedIn === true,
    hide: (mint: string) => hideMutation.mutate(mint),
    unhide: (mint: string) => unhideMutation.mutate(mint),
  };
}

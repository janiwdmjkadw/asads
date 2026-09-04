'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import { playTweetChime } from '@/components/discover/attentionSounds';
import type { TweetDTO } from '@/lib/api/tweet';
import {
  addTrackedAccount,
  addTrackedWallet,
  fetchTrackerWalletActivityForMint,
  fetchTrackableAccounts,
  fetchTrackedAccounts,
  fetchTrackedWallets,
  fetchTrackerTweets,
  removeTrackedAccount,
  removeTrackedWallet,
  trackAllAccounts,
  trackerTweetsStreamUrl,
  untrackAllAccounts,
  type TrackableAccount,
  type TrackedAccount,
  type TrackedWalletRow,
  type TrackerWalletActivityEvent,
} from '@/lib/api/tracker';

const KEY = {
  available: ['tracker', 'available'] as const,
  accounts: ['tracker', 'accounts'] as const,
  wallets: ['tracker', 'wallets'] as const,
  tweets: (handlesKey: string) => ['tracker', 'tweets', handlesKey] as const,
  walletActivityForMint: (mint: string | null, walletsKey: string) =>
    ['tracker', 'wallet-activity', mint ?? '', walletsKey] as const,
};

/** The set of handles we can track (have captured tweets for). */
export function useTrackableAccounts(): {
  accounts: TrackableAccount[];
  handleSet: ReadonlySet<string>;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: KEY.available,
    queryFn: fetchTrackableAccounts,
    staleTime: 60_000,
  });
  const accounts = query.data ?? [];
  const handleSet = useMemo(() => new Set(accounts.map((a) => a.handle)), [accounts]);
  return { accounts, handleSet, isLoading: query.isLoading };
}

export interface TrackedAccountsApi {
  accounts: TrackedAccount[];
  handles: string[];
  add: (handle: string) => Promise<void>;
  remove: (handle: string) => void;
  /** Track every available handle (most-tweeted first) up to the cap. */
  addAll: () => Promise<void>;
  /** Untrack every handle. */
  removeAll: () => Promise<void>;
  isMutating: boolean;
  isLoading: boolean;
}

export function useTrackedAccounts(): TrackedAccountsApi {
  const qc = useQueryClient();
  // Slow-moving list: 30s staleTime so popover/page remounts reuse the cache
  // instead of refetching on the 2s default.
  const query = useQuery({ queryKey: KEY.accounts, queryFn: fetchTrackedAccounts, staleTime: 30_000 });
  const accounts = query.data ?? [];

  const addMutation = useMutation({
    mutationFn: (handle: string) => addTrackedAccount(handle),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.accounts }),
  });
  const removeMutation = useMutation({
    mutationFn: (handle: string) => removeTrackedAccount(handle),
    // Optimistic remove so the chip disappears instantly.
    onMutate: async (handle: string) => {
      await qc.cancelQueries({ queryKey: KEY.accounts });
      const prev = qc.getQueryData<TrackedAccount[]>(KEY.accounts);
      qc.setQueryData<TrackedAccount[]>(KEY.accounts, (cur) =>
        (cur ?? []).filter((a) => a.handle !== handle),
      );
      return { prev };
    },
    onError: (_e, _h, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.accounts, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.accounts }),
  });
  const addAllMutation = useMutation({
    mutationFn: () => trackAllAccounts(),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.accounts }),
  });
  const removeAllMutation = useMutation({
    mutationFn: () => untrackAllAccounts(),
    // Optimistic clear so the feed empties instantly.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: KEY.accounts });
      const prev = qc.getQueryData<TrackedAccount[]>(KEY.accounts);
      qc.setQueryData<TrackedAccount[]>(KEY.accounts, []);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.accounts, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.accounts }),
  });

  return {
    accounts,
    handles: useMemo(() => accounts.map((a) => a.handle), [accounts]),
    add: (handle: string) => addMutation.mutateAsync(handle).then(() => undefined),
    remove: (handle: string) => removeMutation.mutate(handle),
    addAll: () => addAllMutation.mutateAsync().then(() => undefined),
    removeAll: () => removeAllMutation.mutateAsync().then(() => undefined),
    isMutating:
      addMutation.isPending
      || removeMutation.isPending
      || addAllMutation.isPending
      || removeAllMutation.isPending,
    isLoading: query.isLoading,
  };
}

export interface TrackedWalletsApi {
  wallets: TrackedWalletRow[];
  addressSet: ReadonlySet<string>;
  add: (address: string, label?: string) => Promise<void>;
  remove: (address: string) => void;
  isMutating: boolean;
  isLoading: boolean;
}

export function useTrackerWallets(): TrackedWalletsApi {
  const qc = useQueryClient();
  // Slow-moving list: 30s staleTime so popover/page remounts reuse the cache
  // instead of refetching on the 2s default.
  const query = useQuery({ queryKey: KEY.wallets, queryFn: fetchTrackedWallets, staleTime: 30_000 });
  const wallets = query.data ?? [];

  const addMutation = useMutation({
    mutationFn: ({ address, label }: { address: string; label?: string }) =>
      addTrackedWallet(address, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.wallets }),
  });
  const removeMutation = useMutation({
    mutationFn: (address: string) => removeTrackedWallet(address),
    onMutate: async (address: string) => {
      await qc.cancelQueries({ queryKey: KEY.wallets });
      const prev = qc.getQueryData<TrackedWalletRow[]>(KEY.wallets);
      qc.setQueryData<TrackedWalletRow[]>(KEY.wallets, (cur) =>
        (cur ?? []).filter((w) => w.address !== address),
      );
      return { prev };
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.wallets, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY.wallets }),
  });

  return {
    wallets,
    addressSet: useMemo(() => new Set(wallets.map((w) => w.address)), [wallets]),
    add: (address: string, label?: string) =>
      addMutation.mutateAsync({ address, label }).then(() => undefined),
    remove: (address: string) => removeMutation.mutate(address),
    isMutating: addMutation.isPending || removeMutation.isPending,
    isLoading: query.isLoading,
  };
}

/** Initial fetch + Aurora LISTEN/NOTIFY SSE for tracked handles (newest first). */
export function useTrackerTweets(handles: string[]): { tweets: TweetDTO[]; isLoading: boolean } {
  const sorted = useMemo(() => [...handles].sort(), [handles]);
  const handlesKey = sorted.join(',');
  // Bfcache restore bumps the generation, re-running the connect effect — a
  // `pageshow persisted` restore leaves the EventSource silently CLOSED and
  // no effect re-runs on its own (same pattern as useLiveNewPairs).
  const streamGeneration = useStreamGeneration();
  const [streamTweets, setStreamTweets] = useState<TweetDTO[]>([]);
  const query = useQuery({
    queryKey: KEY.tweets(handlesKey),
    queryFn: () => fetchTrackerTweets(sorted, 60),
    enabled: sorted.length > 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setStreamTweets([]);
  }, [handlesKey]);

  useEffect(() => {
    const url = trackerTweetsStreamUrl(sorted);
    if (!url || typeof EventSource === 'undefined') return;
    let cancelled = false;
    let stream: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefetchAtMs = 0;

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 3_000);
    };

    const connect = () => {
      if (cancelled) return;
      stream?.close();
      const source = new EventSource(url);
      stream = source;
      source.addEventListener('tweet', (event) => {
        try {
          const tweet = JSON.parse((event as MessageEvent).data) as TweetDTO;
          if (!tweet || typeof tweet.id !== 'string') return;
          // Ring for genuinely fresh tweets only — a late upsert of an old
          // tweet (edit, backfill) must not chime. playTweetChime itself
          // dedupes by id across the feed's several mounts.
          if (
            typeof tweet.createdAtMs === 'number'
            && Date.now() - tweet.createdAtMs < 10 * 60_000
          ) {
            playTweetChime(tweet.id);
          }
          setStreamTweets((current) => {
            const next = [tweet, ...current.filter((t) => t.id !== tweet.id)];
            if (next.length > 80) next.length = 80;
            return next;
          });
        } catch {
          // Malformed frame; the initial/refocus fetch can recover.
        }
      });
      source.onerror = () => {
        // Gap-fill at most once per outage window; the browser retries
        // transient errors itself and onerror fires every few seconds.
        const now = Date.now();
        if (now - lastRefetchAtMs >= 30_000) {
          lastRefetchAtMs = now;
          void query.refetch();
        }
        // The browser never retries a CLOSED stream — reconnect manually
        // (same pattern as useDiscoverFeedIngestion).
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          if (stream === source) stream = null;
          scheduleReconnect();
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream?.close();
      stream = null;
    };
  }, [handlesKey, query.refetch, sorted, streamGeneration]);

  const tweets = useMemo(() => {
    const byId = new Map<string, TweetDTO>();
    for (const tweet of query.data ?? []) byId.set(tweet.id, tweet);
    for (const tweet of streamTweets) byId.set(tweet.id, tweet);
    return [...byId.values()].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  }, [query.data, streamTweets]);
  return { tweets, isLoading: query.isLoading && sorted.length > 0 };
}

/** Persisted tracked-wallet trades for one token, used to hydrate chart bubbles. */
export function useTrackerWalletActivityForMint(
  mint: string | null | undefined,
  wallets: ReadonlySet<string>,
): { events: TrackerWalletActivityEvent[]; isLoading: boolean } {
  const walletList = useMemo(() => [...wallets].sort(), [wallets]);
  const walletsKey = walletList.join(',');
  const cleanMint = mint?.trim() || null;
  const query = useQuery({
    queryKey: KEY.walletActivityForMint(cleanMint, walletsKey),
    queryFn: () => fetchTrackerWalletActivityForMint(cleanMint, walletList, 1000),
    enabled: Boolean(cleanMint) && walletList.length > 0,
    staleTime: 30_000,
  });
  return { events: query.data ?? [], isLoading: query.isLoading };
}

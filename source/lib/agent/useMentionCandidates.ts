'use client';

/**
 * Candidate sources for the composer's `@`/`$` autocomplete.
 *
 * Local-first by design: tracked wallets and the user's own fleet are already
 * in memory (the tracker store hydrates app-wide, `useMe` is fetched on load),
 * so the popover paints on the first keystroke with zero network. Remote
 * sources — token search and people search — are debounced, only fire from two
 * characters, and merge in when they land. Nothing here blocks rendering.
 *
 * The agent never receives this list. It receives only the bindings the user
 * actually picked, which is the whole point: a thousand tracked wallets cost
 * nothing in context.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTrackedWalletsContext } from '@/components/discover/TrackedWalletsProvider';
import { displayName } from '@/components/discover/trackedWallets';
import { useMe } from '@/lib/api/me';
import { useFrenSearch } from '@/lib/api/frens';
import { ingestionApiUrl } from '@/lib/api/ingestion';
import { compactUsdWhole } from '@/lib/format';
import { queryKeys } from '@/lib/query/keys';
import {
  MIN_REMOTE_QUERY_LEN,
  shortenId,
  type MentionCandidate,
  type MentionQuery,
} from './mentions';

const REMOTE_DEBOUNCE_MS = 140;
const TOKEN_RESULT_LIMIT = 8;
const USER_RESULT_LIMIT = 8;

interface SearchCard {
  mint?: unknown;
  ticker?: unknown;
  name?: unknown;
  symbol?: unknown;
  marketCapUsd?: unknown;
  /** Trailing 24h; absent while the engine's 24h window is cold-seeding. */
  vol24hUsd?: unknown;
  /** 5m volume — the documented fallback when vol24h has no value yet. */
  volumeUsd?: unknown;
}

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The disambiguating line under a token suggestion.
 *
 * Ticker collisions are the norm, not the exception — a search for "jim"
 * returns several tokens all labelled `jim`, and a name-only hint repeats the
 * label instead of separating them, so the user has to guess and can pick the
 * wrong mint. Market cap and 24h volume are what actually tell them apart, so
 * they lead; the name follows only when it adds something the label did not.
 */
function tokenHint(card: SearchCard, label: string): string {
  const parts: string[] = [];
  const mcap = numOrNull(card.marketCapUsd);
  if (mcap !== null) parts.push(`${compactUsdWhole(mcap, '—')} mc`);
  // vol24h is optional upstream; volumeUsd (5m) is the sanctioned fallback,
  // and it is labelled honestly rather than passed off as a 24h number.
  const vol24 = numOrNull(card.vol24hUsd);
  const vol5m = numOrNull(card.volumeUsd);
  if (vol24 !== null) parts.push(`${compactUsdWhole(vol24, '—')} 24h`);
  else if (vol5m !== null) parts.push(`${compactUsdWhole(vol5m, '—')} 5m`);
  const name = typeof card.name === 'string' ? card.name : null;
  if (name !== null && name.toLowerCase() !== label.toLowerCase()) parts.push(name);
  return parts.length > 0
    ? parts.join(' · ')
    : shortenId(typeof card.mint === 'string' ? card.mint : '');
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Everything the popover may offer for the query in progress. Returns local
 * candidates immediately and appends remote ones as they resolve.
 */
export function useMentionCandidates(active: MentionQuery | null): MentionCandidate[] {
  const { wallets } = useTrackedWalletsContext();
  const me = useMe();

  const trigger = active?.trigger ?? null;
  const rawQuery = active?.query ?? '';
  const debouncedQuery = useDebounced(rawQuery, REMOTE_DEBOUNCE_MS);
  const remoteReady = debouncedQuery.length >= MIN_REMOTE_QUERY_LEN;

  const tokenSearch = useQuery({
    queryKey: queryKeys.token.search(debouncedQuery, 'relevance', false),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q: debouncedQuery, limit: String(TOKEN_RESULT_LIMIT) });
      const res = await fetch(ingestionApiUrl(`/api/search?${params.toString()}`), { signal });
      if (!res.ok) return { items: [] as SearchCard[] };
      return (await res.json()) as { items?: SearchCard[] };
    },
    enabled: trigger === '$' && remoteReady,
    staleTime: 15_000,
  });

  const userSearch = useFrenSearch(debouncedQuery, {
    enabled: trigger === '@' && remoteReady,
    limit: USER_RESULT_LIMIT,
  });

  const tracked = useMemo<MentionCandidate[]>(
    () =>
      wallets.map((w) => ({
        kind: 'wallet' as const,
        source: 'tracked' as const,
        label: displayName(w),
        id: w.address,
        hint: shortenId(w.address),
        ...(w.emoji === undefined ? {} : { emoji: w.emoji }),
      })),
    [wallets],
  );

  const mine = useMemo<MentionCandidate[]>(() => {
    const data = me.data;
    const entries = data !== undefined && data.reauth_required === false ? data.wallets : [];
    return entries
      .filter((w) => !w.is_archived && w.chain === 'solana')
      .map((w) => ({
        kind: 'wallet' as const,
        source: 'mine' as const,
        label: w.label ?? (w.is_primary ? 'main' : shortenId(w.wallet_pubkey)),
        id: w.wallet_pubkey,
        hint: `my wallet · ${shortenId(w.wallet_pubkey)}`,
      }));
  }, [me.data]);

  const tokens = useMemo<MentionCandidate[]>(() => {
    const items = tokenSearch.data?.items ?? [];
    const out: MentionCandidate[] = [];
    for (const item of items) {
      if (typeof item.mint !== 'string') continue;
      const ticker = typeof item.ticker === 'string' ? item.ticker : null;
      const symbol = typeof item.symbol === 'string' ? item.symbol : null;
      const name = typeof item.name === 'string' ? item.name : null;
      const label = ticker ?? symbol ?? name ?? shortenId(item.mint);
      out.push({
        kind: 'token',
        source: 'token',
        label,
        id: item.mint,
        hint: tokenHint(item, label),
      });
    }
    return out;
  }, [tokenSearch.data]);

  const users = useMemo<MentionCandidate[]>(() => {
    const result = userSearch.data;
    if (result === undefined || result.kind !== 'ok') return [];
    // Bind the wallet when the fren has a public primary one — that is the id
    // the analytics tools take, so "@someone what did they buy" is one hop.
    // Otherwise bind the user id, which reads their platform profile instead.
    // The KIND says which, so the agent never has to guess what it was handed.
    return result.data.map((row) =>
      row.primary_wallet_pubkey === null
        ? {
            kind: 'user' as const,
            source: 'user' as const,
            label: row.slug ?? row.label,
            id: row.user_id,
            hint: 'listen user',
          }
        : {
            kind: 'wallet' as const,
            source: 'user' as const,
            label: row.slug ?? row.label,
            id: row.primary_wallet_pubkey,
            hint: `listen user · ${shortenId(row.primary_wallet_pubkey)}`,
          },
    );
  }, [userSearch.data]);

  return useMemo(
    () => [...tracked, ...mine, ...tokens, ...users],
    [tracked, mine, tokens, users],
  );
}

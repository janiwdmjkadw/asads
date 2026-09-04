'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { fetchAuthenticatedApi } from './trading';
import { queryKeys } from '@/lib/query/keys';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';

// Slice "Listen holders": client for GET /api/v1/token/:mint/listen-holders —
// the Listen-platform holders of a mint (balance-desc, capped at 100,
// privacy-filtered server-side). Feeds the Holders tab's toggleable card
// view. Same origin + auth conventions as ./frens.ts; polling stays off
// until the view is actually visible (the `enabled` option).

export interface ListenHolder {
  user_id: string;
  label: string;
  slug: string | null;
  avatar_thumb_data_url: string | null;
  tokens_ui: number;
  value_usd: number | null;
  invested_usd: number | null;
  avg_entry_price_usd: number | null;
  unrealized_pnl_usd: number | null;
  unrealized_pnl_pct: number | null;
  realized_pnl_usd: number | null;
  wallet_count: number;
  last_fill_at_ms: number | null;
  thesis: string | null;
  thesis_created_at_ms: number | null;
  call_id: string | null;
}

export interface ListenHoldersData {
  holders: ListenHolder[];
  total: number;
  price_usd: number | null;
  sol_price_usd: number | null;
  generated_at_ms: number;
}

/** Reauth is a distinct non-error state (the view shows a sign-in note). */
export type ListenHoldersResult = { kind: 'ok'; data: ListenHoldersData } | { kind: 'reauth' };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function parseHolder(item: unknown): ListenHolder | null {
  if (!isObject(item)) return null;
  if (typeof item['user_id'] !== 'string' || typeof item['label'] !== 'string') return null;
  return {
    user_id: item['user_id'],
    label: item['label'],
    slug: strOrNull(item['slug']),
    avatar_thumb_data_url: strOrNull(item['avatar_thumb_data_url']),
    tokens_ui: numOrNull(item['tokens_ui']) ?? 0,
    value_usd: numOrNull(item['value_usd']),
    invested_usd: numOrNull(item['invested_usd']),
    avg_entry_price_usd: numOrNull(item['avg_entry_price_usd']),
    unrealized_pnl_usd: numOrNull(item['unrealized_pnl_usd']),
    unrealized_pnl_pct: numOrNull(item['unrealized_pnl_pct']),
    realized_pnl_usd: numOrNull(item['realized_pnl_usd']),
    wallet_count: numOrNull(item['wallet_count']) ?? 1,
    last_fill_at_ms: numOrNull(item['last_fill_at_ms']),
    thesis: strOrNull(item['thesis']),
    thesis_created_at_ms: numOrNull(item['thesis_created_at_ms']),
    call_id: strOrNull(item['call_id']),
  };
}

async function fetchListenHolders(
  mint: string,
  opts: { authToken?: string | null; signal?: AbortSignal },
): Promise<ListenHoldersResult> {
  const res = await fetchAuthenticatedApi(
    `/api/v1/token/${encodeURIComponent(mint)}/listen-holders`,
    {},
    opts,
  );
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  const obj = isObject(body) ? body : {};
  if (obj['reauth_required'] === true) return { kind: 'reauth' };
  if (res.status !== 200) throw new Error(`http_${res.status}`);
  const rawHolders = obj['holders'];
  const holders: ListenHolder[] = [];
  if (Array.isArray(rawHolders)) {
    for (const item of rawHolders) {
      const holder = parseHolder(item);
      if (holder) holders.push(holder);
    }
  }
  return {
    kind: 'ok',
    data: {
      holders,
      total: numOrNull(obj['total']) ?? holders.length,
      price_usd: numOrNull(obj['price_usd']),
      sol_price_usd: numOrNull(obj['sol_price_usd']),
      generated_at_ms: numOrNull(obj['generated_at_ms']) ?? 0,
    },
  };
}

export function useListenHolders(
  mint: string | undefined,
  options: { enabled: boolean },
): {
  holders: ListenHolder[];
  total: number | null;
  priceUsd: number | null;
  loading: boolean;
  error: string | null;
  reauth: boolean;
} {
  const { getToken } = useAuth();
  const enabled = Boolean(mint) && options.enabled;
  const query = useQuery({
    queryKey: queryKeys.token.listenHolders(mint ?? null),
    enabled,
    // Listen holders move on fill cadence, not tick cadence — 15s is
    // plenty, and the query is disabled entirely while the view is hidden.
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    // Keep the current cards visible during background refetches, but never
    // paint the previous mint's holders under a new mint (key index 2).
    placeholderData: keepPreviousDataForMint(mint ?? null, 2),
    queryFn: async ({ signal }) =>
      fetchListenHolders(mint ?? '', { authToken: await getToken(), signal }),
  });

  const data = query.data?.kind === 'ok' ? query.data.data : null;
  // Stable identity per fetch result — the card list re-renders only when
  // the payload actually changes.
  const holders = useMemo(() => data?.holders ?? [], [data]);

  return {
    holders,
    total: data?.total ?? null,
    priceUsd: data?.price_usd ?? null,
    loading: enabled && query.isLoading,
    error: query.error ? toShortReason(query.error) : null,
    reauth: query.data?.kind === 'reauth',
  };
}

function toShortReason(err: Error): string {
  return err.message.slice(0, 64) || 'error';
}

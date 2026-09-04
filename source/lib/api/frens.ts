'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { fetchAuthenticatedApi } from './trading';

// Slice "Frens": client for /api/v1/frens/* — the caller's profile
// (bio / avatar / banner / visibility, username = referral slug) and the
// public leaderboard (trading windows + best calls). Username claiming
// reuses `claimReferralCode` from ./referral — one identity, one writer.

export type ReauthReason = 'no_session' | 'session_expired' | 'session_invalid';

export type Result<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export interface FrenProfile {
  label: string;
  slug: string | null;
  bio: string | null;
  avatar_data_url: string | null;
  banner_data_url: string | null;
  visibility: 'public' | 'private';
}

export type FrenWindow = '1d' | '7d' | '30d' | 'all';

/** One CALL (not one caller): the Best Calls list rows. */
export interface TopCall {
  call_id: string;
  user_id: string;
  label: string;
  avatar_data_url: string | null;
  primary_wallet_pubkey: string | null;
  mint: string;
  ticker: string | null;
  image_url: string | null;
  thesis: string;
  created_at: string;
  pct: number;
}

export interface FrenLeaderboard {
  rows: FrenLeaderboardRow[];
  topCalls: TopCall[];
}

export interface FrenLeaderboardRow {
  user_id: string;
  label: string;
  slug: string | null;
  avatar_data_url: string | null;
  bio: string | null;
  primary_wallet_pubkey: string | null;
  pnl_lamports: string;
  volume_lamports: string;
  trades: number;
  buys: number;
  sells: number;
  positions: number;
  wins: number;
  losses: number;
  best_call_pct: number | null;
  best_call_id: string | null;
  best_call_mint: string | null;
  best_call_ticker: string | null;
  best_call_image_url: string | null;
  best_call_thesis: string | null;
  best_call_at: string | null;
  calls_count: number;
}

interface FetchOpts {
  authToken?: string | null;
  signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function getJson(
  path: string,
  opts: FetchOpts,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> } | { networkError: string }> {
  try {
    const res = await fetchAuthenticatedApi(path, init, {
      authToken: opts.authToken,
      signal: opts.signal,
    });
    let body: unknown = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch (err) {
    return { networkError: err instanceof Error ? err.message : 'network_error' };
  }
}

function reauthOf(body: Record<string, unknown>): ReauthReason | null {
  if (body['reauth_required'] !== true) return null;
  const reason = body['reason'];
  return reason === 'no_session' || reason === 'session_expired' || reason === 'session_invalid'
    ? reason
    : 'session_invalid';
}

function parseProfile(raw: unknown): FrenProfile | null {
  if (!isObject(raw)) return null;
  const visibility = raw['visibility'];
  return {
    label: typeof raw['label'] === 'string' ? raw['label'] : '',
    slug: typeof raw['slug'] === 'string' ? raw['slug'] : null,
    bio: typeof raw['bio'] === 'string' ? raw['bio'] : null,
    avatar_data_url: typeof raw['avatar_data_url'] === 'string' ? raw['avatar_data_url'] : null,
    banner_data_url: typeof raw['banner_data_url'] === 'string' ? raw['banner_data_url'] : null,
    visibility: visibility === 'private' ? 'private' : 'public',
  };
}

export async function fetchFrenProfile(opts: FetchOpts): Promise<Result<FrenProfile>> {
  const r = await getJson('/api/v1/frens/profile', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) return { kind: 'error', reason: `http_${r.status}` };
  const profile = parseProfile(r.body['profile']);
  if (!profile) return { kind: 'error', reason: 'malformed_profile' };
  return { kind: 'ok', data: profile };
}

export interface PatchFrenProfileInput {
  bio?: string | null;
  avatarDataUrl?: string | null;
  /** Tiny list-surface thumb, generated client-side from the avatar. */
  avatarThumbDataUrl?: string | null;
  bannerDataUrl?: string | null;
  visibility?: 'public' | 'private';
}

export async function patchFrenProfile(
  input: PatchFrenProfileInput,
  opts: FetchOpts,
): Promise<Result<FrenProfile>> {
  const body: Record<string, unknown> = {};
  if (input.bio !== undefined) body.bio = input.bio;
  if (input.avatarDataUrl !== undefined) body.avatar_data_url = input.avatarDataUrl;
  if (input.avatarThumbDataUrl !== undefined) body.avatar_thumb_data_url = input.avatarThumbDataUrl;
  if (input.bannerDataUrl !== undefined) body.banner_data_url = input.bannerDataUrl;
  if (input.visibility !== undefined) body.visibility = input.visibility;
  const r = await getJson('/api/v1/frens/profile', opts, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) {
    const message = typeof r.body['message'] === 'string' ? r.body['message'] : `http_${r.status}`;
    return { kind: 'error', reason: message };
  }
  const profile = parseProfile(r.body['profile']);
  if (!profile) return { kind: 'error', reason: 'malformed_profile' };
  return { kind: 'ok', data: profile };
}

function parseTopCall(item: unknown): TopCall | null {
  if (!isObject(item)) return null;
  if (
    typeof item['call_id'] !== 'string' ||
    typeof item['user_id'] !== 'string' ||
    typeof item['label'] !== 'string' ||
    typeof item['mint'] !== 'string' ||
    typeof item['thesis'] !== 'string' ||
    typeof item['created_at'] !== 'string' ||
    typeof item['pct'] !== 'number'
  ) {
    return null;
  }
  return {
    call_id: item['call_id'],
    user_id: item['user_id'],
    label: item['label'],
    avatar_data_url: typeof item['avatar_data_url'] === 'string' ? item['avatar_data_url'] : null,
    primary_wallet_pubkey:
      typeof item['primary_wallet_pubkey'] === 'string' ? item['primary_wallet_pubkey'] : null,
    mint: item['mint'],
    ticker: typeof item['ticker'] === 'string' ? item['ticker'] : null,
    image_url: typeof item['image_url'] === 'string' ? item['image_url'] : null,
    thesis: item['thesis'],
    created_at: item['created_at'],
    pct: item['pct'],
  };
}

export async function fetchFrenLeaderboard(
  window: FrenWindow,
  opts: FetchOpts,
): Promise<Result<FrenLeaderboard>> {
  const r = await getJson(`/api/v1/frens/leaderboard?window=${encodeURIComponent(window)}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) return { kind: 'error', reason: `http_${r.status}` };
  const raw = r.body['rows'];
  const rows: FrenLeaderboardRow[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObject(item)) continue;
      if (typeof item['user_id'] !== 'string' || typeof item['label'] !== 'string') continue;
      rows.push({
        user_id: item['user_id'],
        label: item['label'],
        slug: typeof item['slug'] === 'string' ? item['slug'] : null,
        avatar_data_url:
          typeof item['avatar_data_url'] === 'string' ? item['avatar_data_url'] : null,
        bio: typeof item['bio'] === 'string' ? item['bio'] : null,
        primary_wallet_pubkey:
          typeof item['primary_wallet_pubkey'] === 'string' ? item['primary_wallet_pubkey'] : null,
        pnl_lamports: typeof item['pnl_lamports'] === 'string' ? item['pnl_lamports'] : '0',
        volume_lamports:
          typeof item['volume_lamports'] === 'string' ? item['volume_lamports'] : '0',
        trades: typeof item['trades'] === 'number' ? item['trades'] : 0,
        buys: typeof item['buys'] === 'number' ? item['buys'] : 0,
        sells: typeof item['sells'] === 'number' ? item['sells'] : 0,
        positions: typeof item['positions'] === 'number' ? item['positions'] : 0,
        wins: typeof item['wins'] === 'number' ? item['wins'] : 0,
        losses: typeof item['losses'] === 'number' ? item['losses'] : 0,
        best_call_pct: typeof item['best_call_pct'] === 'number' ? item['best_call_pct'] : null,
        best_call_id: typeof item['best_call_id'] === 'string' ? item['best_call_id'] : null,
        best_call_mint: typeof item['best_call_mint'] === 'string' ? item['best_call_mint'] : null,
        best_call_ticker:
          typeof item['best_call_ticker'] === 'string' ? item['best_call_ticker'] : null,
        best_call_image_url:
          typeof item['best_call_image_url'] === 'string' ? item['best_call_image_url'] : null,
        best_call_thesis:
          typeof item['best_call_thesis'] === 'string' ? item['best_call_thesis'] : null,
        best_call_at: typeof item['best_call_at'] === 'string' ? item['best_call_at'] : null,
        calls_count: typeof item['calls_count'] === 'number' ? item['calls_count'] : 0,
      });
    }
  }
  const rawCalls = r.body['top_calls'];
  const topCalls: TopCall[] = [];
  if (Array.isArray(rawCalls)) {
    for (const item of rawCalls) {
      const call = parseTopCall(item);
      if (call) topCalls.push(call);
    }
  }
  return { kind: 'ok', data: { rows, topCalls } };
}

export interface FrenTradingAgg {
  pnl_lamports: string;
  volume_lamports: string;
  trades: number;
}

export interface FrenDetail {
  user_id: string;
  label: string;
  bio: string | null;
  avatar_data_url: string | null;
  banner_data_url: string | null;
  primary_wallet_pubkey: string | null;
  trading: { all: FrenTradingAgg; d30: FrenTradingAgg; d7: FrenTradingAgg };
  wins: number;
  losses: number;
  calls_count: number;
  calls_2x: number;
  best_call_pct: number | null;
  top_calls: TopCall[];
}

function parseAgg(raw: unknown): FrenTradingAgg {
  const obj = isObject(raw) ? raw : {};
  return {
    pnl_lamports: typeof obj['pnl_lamports'] === 'string' ? obj['pnl_lamports'] : '0',
    volume_lamports: typeof obj['volume_lamports'] === 'string' ? obj['volume_lamports'] : '0',
    trades: typeof obj['trades'] === 'number' ? obj['trades'] : 0,
  };
}

export async function fetchFrenDetail(
  userId: string,
  opts: FetchOpts,
): Promise<Result<FrenDetail>> {
  const r = await getJson(`/api/v1/frens/detail?user_id=${encodeURIComponent(userId)}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) return { kind: 'error', reason: `http_${r.status}` };
  const raw = r.body['detail'];
  if (!isObject(raw) || typeof raw['user_id'] !== 'string' || typeof raw['label'] !== 'string') {
    return { kind: 'error', reason: 'malformed_detail' };
  }
  const trading = isObject(raw['trading']) ? raw['trading'] : {};
  const rawCalls = raw['top_calls'];
  const topCalls: TopCall[] = [];
  if (Array.isArray(rawCalls)) {
    for (const item of rawCalls) {
      const call = parseTopCall(item);
      if (call) topCalls.push(call);
    }
  }
  return {
    kind: 'ok',
    data: {
      user_id: raw['user_id'],
      label: raw['label'],
      bio: typeof raw['bio'] === 'string' ? raw['bio'] : null,
      avatar_data_url: typeof raw['avatar_data_url'] === 'string' ? raw['avatar_data_url'] : null,
      banner_data_url: typeof raw['banner_data_url'] === 'string' ? raw['banner_data_url'] : null,
      primary_wallet_pubkey:
        typeof raw['primary_wallet_pubkey'] === 'string' ? raw['primary_wallet_pubkey'] : null,
      trading: {
        all: parseAgg(trading['all']),
        d30: parseAgg(trading['d30']),
        d7: parseAgg(trading['d7']),
      },
      wins: typeof raw['wins'] === 'number' ? raw['wins'] : 0,
      losses: typeof raw['losses'] === 'number' ? raw['losses'] : 0,
      calls_count: typeof raw['calls_count'] === 'number' ? raw['calls_count'] : 0,
      calls_2x: typeof raw['calls_2x'] === 'number' ? raw['calls_2x'] : 0,
      best_call_pct: typeof raw['best_call_pct'] === 'number' ? raw['best_call_pct'] : null,
      top_calls: topCalls,
    },
  };
}

export type CallBadge = 'banger' | 'semi_fumble' | 'fumble' | 'loss' | 'holding';

export interface CallCard {
  call_id: string;
  caller_user_id: string;
  caller_label: string;
  caller_avatar_data_url: string | null;
  mint: string;
  ticker: string | null;
  name: string | null;
  image_url: string | null;
  thesis: string;
  created_at: string;
  called_mc_usd: number;
  peak_mc_usd: number;
  current_mc_usd: number | null;
  sold_mc_usd: number | null;
  badge: CallBadge;
  /** Chart bubbles: the caller's fills on this mint, time-ordered. */
  caller_trades: Array<{ t_ms: number; side: 'buy' | 'sell' }>;
}

export async function fetchCallCard(callId: string, opts: FetchOpts): Promise<Result<CallCard>> {
  const r = await getJson(`/api/v1/frens/call?call_id=${encodeURIComponent(callId)}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) return { kind: 'error', reason: `http_${r.status}` };
  const raw = r.body['call'];
  if (
    !isObject(raw) ||
    typeof raw['call_id'] !== 'string' ||
    typeof raw['mint'] !== 'string' ||
    typeof raw['thesis'] !== 'string' ||
    typeof raw['created_at'] !== 'string' ||
    typeof raw['called_mc_usd'] !== 'number' ||
    typeof raw['peak_mc_usd'] !== 'number'
  ) {
    return { kind: 'error', reason: 'malformed_call' };
  }
  const badge = raw['badge'];
  return {
    kind: 'ok',
    data: {
      call_id: raw['call_id'],
      caller_user_id: typeof raw['caller_user_id'] === 'string' ? raw['caller_user_id'] : '',
      caller_label: typeof raw['caller_label'] === 'string' ? raw['caller_label'] : '',
      caller_avatar_data_url:
        typeof raw['caller_avatar_data_url'] === 'string' ? raw['caller_avatar_data_url'] : null,
      mint: raw['mint'],
      ticker: typeof raw['ticker'] === 'string' ? raw['ticker'] : null,
      name: typeof raw['name'] === 'string' ? raw['name'] : null,
      image_url: typeof raw['image_url'] === 'string' ? raw['image_url'] : null,
      thesis: raw['thesis'],
      created_at: raw['created_at'],
      called_mc_usd: raw['called_mc_usd'],
      peak_mc_usd: raw['peak_mc_usd'],
      current_mc_usd: typeof raw['current_mc_usd'] === 'number' ? raw['current_mc_usd'] : null,
      sold_mc_usd: typeof raw['sold_mc_usd'] === 'number' ? raw['sold_mc_usd'] : null,
      badge:
        badge === 'banger' || badge === 'semi_fumble' || badge === 'fumble' || badge === 'loss'
          ? badge
          : 'holding',
      caller_trades: Array.isArray(raw['caller_trades'])
        ? raw['caller_trades'].flatMap((t) =>
            isObject(t) && typeof t['t_ms'] === 'number' && (t['side'] === 'buy' || t['side'] === 'sell')
              ? [{ t_ms: t['t_ms'], side: t['side'] }]
              : [],
          )
        : [],
    },
  };
}

// ───────── hooks ─────────

const FREN_PROFILE_QUERY_KEY = ['api', 'v1', 'frens', 'profile'] as const;

export function useFrenProfile(options: { enabled?: boolean } = {}): UseQueryResult<Result<FrenProfile>> {
  const { getToken } = useAuth();
  return useQuery<Result<FrenProfile>>({
    queryKey: FREN_PROFILE_QUERY_KEY,
    queryFn: async ({ signal }) =>
      fetchFrenProfile({ authToken: await getToken(), signal }),
    enabled: options.enabled !== false,
    staleTime: 30_000,
  });
}

export function useInvalidateFrenProfile(): () => void {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: FREN_PROFILE_QUERY_KEY });
}

export function useFrenLeaderboard(
  window: FrenWindow,
  options: { enabled?: boolean } = {},
): UseQueryResult<Result<FrenLeaderboard>> {
  const { getToken } = useAuth();
  return useQuery<Result<FrenLeaderboard>>({
    queryKey: ['api', 'v1', 'frens', 'leaderboard', window],
    queryFn: async ({ signal }) =>
      fetchFrenLeaderboard(window, { authToken: await getToken(), signal }),
    enabled: options.enabled !== false,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/** One `@`-mention suggestion: a public identity the agent can be pointed at. */
export interface FrenSearchRow {
  user_id: string;
  label: string;
  slug: string | null;
  avatar_data_url: string | null;
  primary_wallet_pubkey: string | null;
}

export async function fetchFrenSearch(
  query: string,
  limit: number,
  opts: FetchOpts,
): Promise<Result<FrenSearchRow[]>> {
  const r = await getJson(
    `/api/v1/frens/search?q=${encodeURIComponent(query)}&limit=${String(limit)}`,
    opts,
  );
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status !== 200) return { kind: 'error', reason: `http_${r.status}` };
  const raw = r.body['rows'];
  const rows: FrenSearchRow[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObject(item)) continue;
      if (typeof item['user_id'] !== 'string' || typeof item['label'] !== 'string') continue;
      rows.push({
        user_id: item['user_id'],
        label: item['label'],
        slug: typeof item['slug'] === 'string' ? item['slug'] : null,
        avatar_data_url:
          typeof item['avatar_data_url'] === 'string' ? item['avatar_data_url'] : null,
        primary_wallet_pubkey:
          typeof item['primary_wallet_pubkey'] === 'string' ? item['primary_wallet_pubkey'] : null,
      });
    }
  }
  return { kind: 'ok', data: rows };
}

/**
 * `@` autocomplete people search. Disabled below two characters so typing a
 * label that resolves locally (a tracked wallet) never costs a round trip;
 * results are cached long enough that repeating a prefix is free.
 */
export function useFrenSearch(
  query: string,
  options: { enabled?: boolean; limit?: number } = {},
): UseQueryResult<Result<FrenSearchRow[]>> {
  const { getToken } = useAuth();
  const limit = options.limit ?? 8;
  return useQuery<Result<FrenSearchRow[]>>({
    queryKey: ['api', 'v1', 'frens', 'search', query, limit],
    queryFn: async ({ signal }) =>
      fetchFrenSearch(query, limit, { authToken: await getToken(), signal }),
    enabled: options.enabled !== false && query.length >= 2,
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

export function useFrenDetail(
  userId: string | null,
): UseQueryResult<Result<FrenDetail>> {
  const { getToken } = useAuth();
  return useQuery<Result<FrenDetail>>({
    queryKey: ['api', 'v1', 'frens', 'detail', userId],
    queryFn: async ({ signal }) =>
      fetchFrenDetail(userId!, { authToken: await getToken(), signal }),
    enabled: userId !== null,
    staleTime: 30_000,
  });
}

export function useCallCard(callId: string | null): UseQueryResult<Result<CallCard>> {
  const { getToken } = useAuth();
  return useQuery<Result<CallCard>>({
    queryKey: ['api', 'v1', 'frens', 'call', callId],
    queryFn: async ({ signal }) =>
      fetchCallCard(callId!, { authToken: await getToken(), signal }),
    enabled: callId !== null,
    staleTime: 15_000,
  });
}

// ───────── client-side image downscaling ─────────

/**
 * Downscale a picked file to a bounded JPEG data URL. `maxEdge` bounds the
 * long edge; quality steps down until the encoded payload fits `maxChars`
 * (the api enforces the same caps server-side). Null when the file can't
 * be decoded as an image.
 */
export async function fileToBoundedDataUrl(
  file: File,
  maxEdge: number,
  maxChars: number,
): Promise<string | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = objectUrl;
    });
    if (!image || image.width === 0 || image.height === 0) return null;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= maxChars) return url;
    }
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Re-encode an existing data URL at thumbnail size — used to derive the
 * list-surface avatar thumb from the full avatar at save time.
 */
export async function dataUrlToBoundedThumb(
  dataUrl: string,
  maxEdge: number,
  maxChars: number,
): Promise<string | null> {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!image || image.width === 0 || image.height === 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  for (const quality of [0.75, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= maxChars) return url;
  }
  return null;
}

/** Server caps mirrored for the client-side encoder. */
export const AVATAR_MAX_EDGE = 192;
export const AVATAR_MAX_CHARS = 90_000;
export const AVATAR_THUMB_MAX_EDGE = 48;
export const AVATAR_THUMB_MAX_CHARS = 16_000;
export const BANNER_MAX_EDGE = 1200;
export const BANNER_MAX_CHARS = 520_000;

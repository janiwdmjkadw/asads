'use client';

import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  coldBootRetry,
  throwOnColdBootReauth,
  withColdBootAuth,
} from './cold-boot-auth';
import { fetchAuthenticatedApi } from './trading';
import type { ReauthReason } from './referral';
import { NOTIFICATIONS_QUERY_KEY } from './notifications';
import {
  acquireAlphaCallsStream,
  isAlphaCallsStreamConnected,
} from '@/lib/state/alpha-calls-stream';
import { applyCallToFeed, parseAlphaCall, type AlphaCall } from './alpha-calls-shared';

// Slice "Call This Coin": client for /api/v1/alpha/*. The feed backs the
// Discover alpha lane; the mutation backs the trade-page "Call this coin"
// dialog. Delivery is EVENT-DRIVEN: the SSE push channel injects calls into
// the query cache the moment they commit, and the REST fetch runs only as
// the initial load, the reconnect catch-up, and a degraded-mode poll while
// the stream is down.

export type Result<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export type CallRejectReason =
  | 'invalid_mint'
  | 'thesis_empty'
  | 'thesis_too_long'
  | 'thesis_charset'
  | 'thesis_links'
  // One call per (caller, mint), ever — edit the existing call instead.
  | 'already_called'
  // Legacy wire value from pre-permanence servers; treated like
  // already_called.
  | 'cooldown'
  | 'insufficient_holding'
  | 'rate_limited';

export type EditCallRejectReason =
  | 'not_found'
  | 'thesis_empty'
  | 'thesis_too_long'
  | 'thesis_charset'
  | 'thesis_links'
  | 'rate_limited';

export type EditCallOutcome =
  | { accepted: true; editedAt: string }
  | { accepted: false; reason: EditCallRejectReason };

export type PostCallOutcome =
  | { accepted: true; callId: string; notified: number }
  | { accepted: false; reason: CallRejectReason; retryAfterMs: number | null };

export interface PostCallInput {
  mint: string;
  thesis: string;
  token: {
    ticker: string;
    name: string;
    imageUrl: string;
    marketCap: string;
    /** Numeric USD MC at call time — the "since call" %-perf baseline. */
    marketCapUsd: number | null;
    volume: string;
    price: string;
    score: number;
    txns: number;
  };
}

interface FetchOpts {
  authToken?: string | null;
  signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reauthOf(body: Record<string, unknown>): ReauthReason | null {
  if (body.reauth_required === true) {
    const r = body.reason;
    if (r === 'no_session' || r === 'session_expired' || r === 'session_invalid') return r;
    return 'session_invalid';
  }
  return null;
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
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch (err) {
    return { networkError: (err as Error)?.message ?? 'network_error' };
  }
}

async function fetchCallAudience(opts: FetchOpts): Promise<Result<number>> {
  const r = await getJson('/api/v1/alpha/audience', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status === 200 && typeof r.body.count === 'number') {
    return { kind: 'ok', data: r.body.count };
  }
  return { kind: 'error', reason: `status_${r.status}` };
}

/**
 * How many frens (slug signups + wallet trackers) a call from the
 * current user would notify — backs the call dialog's headline
 * ("Call X to N frens"). Fetched only while the dialog is open;
 * returns null while loading / signed out / on error so the headline
 * degrades to plain "Call X".
 */
export function useCallAudience(enabled: boolean): number | null {
  const { getToken } = useAuth();
  const query = useQuery({
    queryKey: ['api', 'v1', 'alpha', 'audience'],
    queryFn: async ({ signal }) =>
      fetchCallAudience({ authToken: await getToken(), signal }),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return query.data?.kind === 'ok' ? query.data.data : null;
}

export async function fetchAlphaFeed(opts: FetchOpts): Promise<Result<AlphaCall[]>> {
  const r = await getJson('/api/v1/alpha/feed?limit=30', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };

  const rows = Array.isArray(r.body.calls) ? r.body.calls : [];
  return {
    kind: 'ok',
    data: rows.map(parseAlphaCall).filter((c): c is AlphaCall => c !== null),
  };
}

export async function postCoinCall(
  input: PostCallInput,
  opts: FetchOpts,
): Promise<Result<PostCallOutcome>> {
  const r = await getJson('/api/v1/alpha/calls', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mint: input.mint,
      thesis: input.thesis,
      token: {
        ticker: input.token.ticker,
        name: input.token.name,
        image_url: input.token.imageUrl,
        market_cap: input.token.marketCap,
        // Schema rejects null (type 'number', additionalProperties false) —
        // omit the key when the snapshot had no numeric MC.
        ...(input.token.marketCapUsd != null
          ? { market_cap_usd: input.token.marketCapUsd }
          : {}),
        volume: input.token.volume,
        price: input.token.price,
        score: input.token.score,
        txns: input.token.txns,
      },
    }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status === 429) {
    return {
      kind: 'ok',
      data: { accepted: false, reason: 'rate_limited', retryAfterMs: null },
    };
  }
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };

  if (r.body.accepted === true) {
    return {
      kind: 'ok',
      data: {
        accepted: true,
        callId: typeof r.body.call_id === 'string' ? r.body.call_id : '',
        notified: typeof r.body.notified === 'number' ? r.body.notified : 0,
      },
    };
  }
  const reason = r.body.reason;
  return {
    kind: 'ok',
    data: {
      accepted: false,
      reason:
        reason === 'invalid_mint' ||
        reason === 'thesis_empty' ||
        reason === 'thesis_too_long' ||
        reason === 'thesis_charset' ||
        reason === 'thesis_links' ||
        reason === 'already_called' ||
        reason === 'cooldown' ||
        reason === 'insufficient_holding'
          ? reason
          : 'invalid_mint',
      retryAfterMs: typeof r.body.retry_after_ms === 'number' ? r.body.retry_after_ms : null,
    },
  };
}

/** PATCH the thesis of the viewer's own call (server enforces ownership). */
export async function editCoinCall(
  callId: string,
  thesis: string,
  opts: FetchOpts,
): Promise<Result<EditCallOutcome>> {
  const r = await getJson(`/api/v1/alpha/calls/${encodeURIComponent(callId)}`, opts, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thesis }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status === 429) {
    return { kind: 'ok', data: { accepted: false, reason: 'rate_limited' } };
  }
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };

  if (r.body.accepted === true) {
    return {
      kind: 'ok',
      data: {
        accepted: true,
        editedAt: typeof r.body.edited_at === 'string' ? r.body.edited_at : '',
      },
    };
  }
  const reason = r.body.reason;
  return {
    kind: 'ok',
    data: {
      accepted: false,
      reason:
        reason === 'not_found' ||
        reason === 'thesis_empty' ||
        reason === 'thesis_too_long' ||
        reason === 'thesis_charset' ||
        reason === 'thesis_links'
          ? reason
          : 'not_found',
    },
  };
}

const ALPHA_FEED_QUERY_KEY = ['api', 'v1', 'alpha', 'feed'] as const;

export function useAlphaFeed(): UseQueryResult<Result<AlphaCall[]>> {
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const qc = useQueryClient();
  const [streamUp, setStreamUp] = useState(isAlphaCallsStreamConnected);

  // Primary delivery: the coin-call push channel. Events land in the query
  // cache directly (no refetch); the bell refetch is jittered so one call
  // fanned out to N clients doesn't turn into N synchronized /notifications
  // requests hitting the api in the same instant.
  useEffect(() => {
    if (isSignedIn === false) return undefined;
    return acquireAlphaCallsStream({
      onCall: (call) => {
        qc.setQueryData<Result<AlphaCall[]>>(ALPHA_FEED_QUERY_KEY, (prev) => {
          if (!prev || prev.kind !== 'ok') return { kind: 'ok', data: [call] };
          const next = applyCallToFeed(prev.data, call);
          // Duplicate frame (reconnect replay): same reference in → same
          // object out, so react-query skips the update entirely.
          return next === prev.data ? prev : { kind: 'ok', data: next };
        });
        window.setTimeout(
          () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
          Math.random() * 10_000,
        );
      },
      onConnect: () => {
        setStreamUp(true);
        // Catch-up fetch: anything posted while this client was away or the
        // stream was down. Runs once per (re)connect, then push takes over.
        void qc.invalidateQueries({ queryKey: ALPHA_FEED_QUERY_KEY });
      },
      onDisconnect: () => setStreamUp(false),
    });
  }, [isSignedIn, qc]);

  return useQuery<Result<AlphaCall[]>>({
    queryKey: ALPHA_FEED_QUERY_KEY,
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchAlphaFeed({ authToken: token, signal }), token),
      ),
    enabled: isSignedIn !== false,
    staleTime: 10_000,
    // Degraded mode only: while the push channel is healthy AND the last
    // fetch succeeded there is NO interval — the cache is event-driven. The
    // 15s poll bridges stream outages and retries a failed catch-up fetch
    // (fetchAlphaFeed resolves errors as data, so react-query's own retry
    // never sees them); it stops again once both are healthy.
    refetchInterval: (query) => {
      const lastOk = query.state.data?.kind === 'ok';
      return streamUp && lastOk ? false : 15_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !streamUp,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function usePostCoinCall(): UseMutationResult<
  Result<PostCallOutcome>,
  Error,
  PostCallInput
> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostCallInput) =>
      postCoinCall(input, { authToken: await getToken() }),
    onSuccess: (result) => {
      // The caller sees their own call in the feed — refresh it so the lane
      // reflects the post without waiting a poll tick.
      if (result.kind === 'ok' && result.data.accepted) {
        void qc.invalidateQueries({ queryKey: ALPHA_FEED_QUERY_KEY });
      }
    },
  });
}

export function useEditCoinCall(): UseMutationResult<
  Result<EditCallOutcome>,
  Error,
  { callId: string; thesis: string }
> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ callId, thesis }) =>
      editCoinCall(callId, thesis, { authToken: await getToken() }),
    onSuccess: (result) => {
      // The editor doesn't receive their own push frame (a caller is never
      // in their own audience) — refetch so their lane shows the rewrite.
      if (result.kind === 'ok' && result.data.accepted) {
        void qc.invalidateQueries({ queryKey: ALPHA_FEED_QUERY_KEY });
      }
    },
  });
}

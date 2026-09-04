'use client';

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

// Slice "Referral & Rewards": client for /api/v1/referral/*. Mirrors the
// tagged-union parse + Clerk-token posture of lib/api/me.ts / trade-fills.ts.
// All money fields are lamport strings (preserve precision; format in UI).

export type ReauthReason = 'no_session' | 'session_expired' | 'session_invalid';

export type ReferralWindow = 'daily' | 'weekly' | 'monthly' | 'lifetime';
export type LeaderboardMetric = 'volume' | 'earnings';

export interface ReferralStats {
  refereeCount: number;
  volumeLamports: string;
  platformFeeLamports: string;
  referralFeeLamports: string;
}

export interface ReferralBalance {
  accruedLamports: string;
  claimedLamports: string;
  pendingLamports: string;
  claimableLamports: string;
}

export interface EvmPendingReward {
  readonly chain: string;
  readonly accruedWei: string;
  readonly claimAvailable: false;
}

export interface ReferralMe {
  enabled: boolean;
  code: { slug: string; link: string; createdAt: string } | null;
  /** The fren (referrer) slug this user signed up through, if any. */
  referredBy: { slug: string } | null;
  /**
   * Active partner override, or null. `economics.referralShareBps` already
   * reflects the effective (override-aware) rate; this flags partner status.
   */
  partner: { referralShareBps: number } | null;
  economics: { platformFeeBps: number; referralShareBps: number; minClaimLamports: number };
  lifetime: ReferralStats;
  balance: ReferralBalance;
  evmPending: readonly EvmPendingReward[];
}

export interface RefereeEntry {
  label: string;
  volumeLamports: string;
  referralFeeLamports: string;
  tradeCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  label: string;
  volumeLamports: string;
  referralFeeLamports: string;
  refereeCount: number;
  isMe: boolean;
}

export interface PayoutEntry {
  id: string;
  amountLamports: string;
  status: string;
  signature: string | null;
  createdAt: string;
  terminalAt: string | null;
}

type Result<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'disabled' }
  | { kind: 'error'; reason: string };

interface FetchOpts {
  authToken?: string | null;
  signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = '0'): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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

function parseStats(raw: unknown): ReferralStats {
  const o = isObject(raw) ? raw : {};
  return {
    refereeCount: num(o.referee_count),
    volumeLamports: str(o.volume_lamports),
    platformFeeLamports: str(o.platform_fee_lamports),
    referralFeeLamports: str(o.referral_fee_lamports),
  };
}

function parseBalance(raw: unknown): ReferralBalance {
  const o = isObject(raw) ? raw : {};
  return {
    accruedLamports: str(o.accrued_lamports),
    claimedLamports: str(o.claimed_lamports),
    pendingLamports: str(o.pending_lamports),
    claimableLamports: str(o.claimable_lamports),
  };
}

// ───────── fetchers ─────────

export async function fetchReferralMe(opts: FetchOpts): Promise<Result<ReferralMe>> {
  const r = await getJson('/api/v1/referral/me', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const b = r.body;
  const code = isObject(b.code)
    ? { slug: str(b.code.slug, ''), link: str(b.code.link, ''), createdAt: str(b.code.created_at, '') }
    : null;
  const referredBy =
    isObject(b.referred_by) && typeof b.referred_by.slug === 'string' && b.referred_by.slug.length > 0
      ? { slug: b.referred_by.slug }
      : null;
  const eco = isObject(b.economics) ? b.economics : {};
  const partner = isObject(b.partner) ? b.partner : null;
  return {
    kind: 'ok',
    data: {
      enabled: b.enabled === true,
      code,
      referredBy,
      partner: partner ? { referralShareBps: num(partner.referral_share_bps) } : null,
      economics: {
        platformFeeBps: num(eco.platform_fee_bps, 100),
        referralShareBps: num(eco.referral_share_bps, 2000),
        minClaimLamports: num(eco.min_claim_lamports, 0),
      },
      lifetime: parseStats(b.lifetime),
      balance: parseBalance(b.balance),
      evmPending: Array.isArray(b.evm_pending)
        ? b.evm_pending.filter(isObject).flatMap((row) =>
            typeof row.chain === 'string' && typeof row.accrued_wei === 'string'
              ? [{ chain: row.chain, accruedWei: row.accrued_wei, claimAvailable: false as const }]
              : [])
        : [],
    },
  };
}

export async function fetchReferralStats(
  window: ReferralWindow,
  opts: FetchOpts,
): Promise<Result<{ stats: ReferralStats; balance: ReferralBalance }>> {
  const r = await getJson(`/api/v1/referral/stats?window=${window}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  return { kind: 'ok', data: { stats: parseStats(r.body.stats), balance: parseBalance(r.body.balance) } };
}

export async function fetchReferees(
  window: ReferralWindow,
  opts: FetchOpts,
): Promise<Result<RefereeEntry[]>> {
  const r = await getJson(`/api/v1/referral/referees?window=${window}&limit=100`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const rows = Array.isArray(r.body.referees) ? r.body.referees : [];
  return {
    kind: 'ok',
    data: rows.filter(isObject).map((o) => ({
      label: str(o.label, 'Fren'),
      volumeLamports: str(o.volume_lamports),
      referralFeeLamports: str(o.referral_fee_lamports),
      tradeCount: num(o.trade_count),
    })),
  };
}

export async function fetchLeaderboard(
  window: ReferralWindow,
  metric: LeaderboardMetric,
  opts: FetchOpts,
): Promise<Result<LeaderboardEntry[]>> {
  const r = await getJson(`/api/v1/referral/leaderboard?window=${window}&metric=${metric}&limit=50`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const rows = Array.isArray(r.body.rows) ? r.body.rows : [];
  return {
    kind: 'ok',
    data: rows.filter(isObject).map((o) => ({
      rank: num(o.rank),
      label: str(o.label, 'Fren'),
      volumeLamports: str(o.volume_lamports),
      referralFeeLamports: str(o.referral_fee_lamports),
      refereeCount: num(o.referee_count),
      isMe: o.is_me === true,
    })),
  };
}

export async function fetchPayouts(opts: FetchOpts): Promise<Result<PayoutEntry[]>> {
  const r = await getJson('/api/v1/referral/payouts', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const rows = Array.isArray(r.body.payouts) ? r.body.payouts : [];
  return {
    kind: 'ok',
    data: rows.filter(isObject).map((o) => ({
      id: str(o.id, ''),
      amountLamports: str(o.amount_lamports),
      status: str(o.status, 'pending'),
      signature: typeof o.signature === 'string' ? o.signature : null,
      createdAt: str(o.created_at, ''),
      terminalAt: typeof o.terminal_at === 'string' ? o.terminal_at : null,
    })),
  };
}

/** Public — a logged-out /fren visitor validates a slug. No auth token. */
export async function resolveReferralSlug(slug: string, signal?: AbortSignal): Promise<boolean> {
  const r = await getJson(`/api/v1/referral/resolve?slug=${encodeURIComponent(slug)}`, { signal });
  if ('networkError' in r) return false;
  return r.body.valid === true;
}

export type ClaimCodeResult =
  | { kind: 'ok'; slug: string; link: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export async function claimReferralCode(slug: string, opts: FetchOpts): Promise<ClaimCodeResult> {
  const r = await getJson('/api/v1/referral/code', opts, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  // 503 = program disabled; without this it would fall through to a
  // misleading `rejected: invalid` ("Invalid name. Try another.").
  if (r.status === 503) return { kind: 'error', reason: str(r.body.error_code, 'referral_disabled') };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.body.accepted === true) {
    return { kind: 'ok', slug: str(r.body.slug, slug), link: str(r.body.link, '') };
  }
  return { kind: 'rejected', reason: str(r.body.reason, 'invalid') };
}

export type BindResult =
  | { kind: 'ok' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export async function bindReferral(slug: string, opts: FetchOpts): Promise<BindResult> {
  const r = await getJson('/api/v1/referral/bind', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'error', reason: str(r.body.error_code, 'referral_disabled') };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.body.bound === true) return { kind: 'ok' };
  const reason = str(r.body.reason, '');
  return reason ? { kind: 'rejected', reason } : { kind: 'error', reason: 'unexpected_bind_response' };
}

export type ClaimRewardsResult =
  | { kind: 'ok'; payoutId: string; amountLamports: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export async function claimReferralRewards(
  clientClaimId: string,
  opts: FetchOpts,
): Promise<ClaimRewardsResult> {
  const r = await getJson('/api/v1/referral/claim', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_claim_id: clientClaimId }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.body.accepted === true) {
    return { kind: 'ok', payoutId: str(r.body.payout_id, ''), amountLamports: str(r.body.amount_lamports) };
  }
  return { kind: 'rejected', reason: str(r.body.reason, 'nothing_to_claim') };
}

// ───────── React Query hooks ─────────

// These hooks only mount inside the auth-gated terminal shell (rewards page),
// so fire immediately with the session COOKIE (null mirror token → cookie auth)
// instead of waiting ~300-800ms for clerk.browser.js; bail only on a POSITIVE
// signed-out from the Clerk session mirror.
function useNotSignedOut(): boolean {
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  return isSignedIn !== false;
}

export function useReferralMe(options: { enabled?: boolean } = {}): UseQueryResult<Result<ReferralMe>> {
  const notSignedOut = useNotSignedOut();
  const enabled = (options.enabled ?? true) && notSignedOut;
  return useQuery<Result<ReferralMe>>({
    queryKey: ['api', 'v1', 'referral', 'me'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchReferralMe({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useReferralStats(
  window: ReferralWindow,
): UseQueryResult<Result<{ stats: ReferralStats; balance: ReferralBalance }>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: ['api', 'v1', 'referral', 'stats', window],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchReferralStats(window, { authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useReferees(window: ReferralWindow): UseQueryResult<Result<RefereeEntry[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: ['api', 'v1', 'referral', 'referees', window],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchReferees(window, { authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useLeaderboard(
  window: ReferralWindow,
  metric: LeaderboardMetric,
): UseQueryResult<Result<LeaderboardEntry[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: ['api', 'v1', 'referral', 'leaderboard', window, metric],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchLeaderboard(window, metric, { authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function usePayouts(): UseQueryResult<Result<PayoutEntry[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: ['api', 'v1', 'referral', 'payouts'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchPayouts({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

const REFERRAL_KEY_PREFIX = ['api', 'v1', 'referral'];

export function useClaimCode(): UseMutationResult<ClaimCodeResult, Error, string> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => claimReferralCode(slug, { authToken: await getToken() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REFERRAL_KEY_PREFIX });
    },
  });
}

export function useClaimRewards(): UseMutationResult<ClaimRewardsResult, Error, string> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientClaimId: string) =>
      claimReferralRewards(clientClaimId, { authToken: await getToken() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REFERRAL_KEY_PREFIX });
    },
  });
}

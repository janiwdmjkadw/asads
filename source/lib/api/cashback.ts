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

// Slice "Cashback & Points": client for /api/v1/cashback/* + /api/v1/points/*.
// Same tagged-union + Clerk-token posture as lib/api/referral.ts.

export type ReauthReason = 'no_session' | 'session_expired' | 'session_invalid';
export type CashbackWindow = 'daily' | 'weekly' | 'monthly' | 'lifetime';

export interface CashbackTierMeta {
  index: number;
  key: string;
  minVolumeLamports: string;
  cashbackBps: number;
}

export interface CashbackBalance {
  accruedLamports: string;
  claimedLamports: string;
  pendingLamports: string;
  claimableLamports: string;
}

export interface EvmPendingCashback {
  readonly chain: string;
  readonly accruedWei: string;
  readonly claimAvailable: false;
}

export interface CashbackMe {
  tier: { index: number; key: string; cashbackBps: number };
  /** Active partner override (replaces the tier rate), or null. */
  partner: { cashbackShareBps: number; referralShareBps: number } | null;
  lifetimeVolumeLamports: string;
  nextTier: { key: string; minVolumeLamports: string; remainingLamports: string; cashbackBps: number } | null;
  balance: CashbackBalance;
  minClaimLamports: number;
  tiers: CashbackTierMeta[];
  evmPending: readonly EvmPendingCashback[];
}

export interface CashbackWallet {
  walletPubkey: string;
  label: string | null;
  isPrimary: boolean;
  volumeLamports: string;
  cashbackLamports: string;
  tradeCount: number;
}

export interface PayoutEntry {
  id: string;
  amountLamports: string;
  status: string;
  signature: string | null;
  createdAt: string;
  terminalAt: string | null;
}

export type AccoladeStatus = 'locked' | 'unlocked' | 'claimed';

export interface Accolade {
  key: string;
  name: string;
  description: string;
  icon: string;
  bonusPoints: number;
  status: AccoladeStatus;
  progress: number;
}

export interface PointsMe {
  points: { volumePoints: number; bonusPoints: number; lifetimePoints: number };
  accolades: Accolade[];
  partnerActive: boolean;
}

export interface PointsLeaderboardEntry {
  rank: number;
  label: string;
  lifetimePoints: number;
  isMe: boolean;
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
    const res = await fetchAuthenticatedApi(path, init, { authToken: opts.authToken, signal: opts.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch (err) {
    return { networkError: (err as Error)?.message ?? 'network_error' };
  }
}

function parseBalance(raw: unknown): CashbackBalance {
  const o = isObject(raw) ? raw : {};
  return {
    accruedLamports: str(o.accrued_lamports),
    claimedLamports: str(o.claimed_lamports),
    pendingLamports: str(o.pending_lamports),
    claimableLamports: str(o.claimable_lamports),
  };
}

// ───────── fetchers ─────────

export async function fetchCashbackMe(opts: FetchOpts): Promise<Result<CashbackMe>> {
  const r = await getJson('/api/v1/cashback/me', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const b = r.body;
  const tier = isObject(b.tier) ? b.tier : {};
  const nt = isObject(b.next_tier) ? b.next_tier : null;
  const tiers = Array.isArray(b.tiers) ? b.tiers : [];
  const partner = isObject(b.partner) ? b.partner : null;
  return {
    kind: 'ok',
    data: {
      tier: { index: num(tier.index), key: str(tier.key, 'clay'), cashbackBps: num(tier.cashback_bps, 1000) },
      partner: partner
        ? {
            cashbackShareBps: num(partner.cashback_share_bps),
            referralShareBps: num(partner.referral_share_bps),
          }
        : null,
      lifetimeVolumeLamports: str(b.lifetime_volume_lamports),
      nextTier: nt
        ? {
            key: str(nt.key, ''),
            minVolumeLamports: str(nt.min_volume_lamports),
            remainingLamports: str(nt.remaining_lamports),
            cashbackBps: num(nt.cashback_bps),
          }
        : null,
      balance: parseBalance(b.balance),
      minClaimLamports: num(b.min_claim_lamports),
      tiers: tiers.filter(isObject).map((t) => ({
        index: num(t.index),
        key: str(t.key, ''),
        minVolumeLamports: str(t.min_volume_lamports),
        cashbackBps: num(t.cashback_bps),
      })),
      evmPending: Array.isArray(b.evm_pending)
        ? b.evm_pending.filter(isObject).flatMap((row) =>
            typeof row.chain === 'string' && typeof row.accrued_wei === 'string'
              ? [{ chain: row.chain, accruedWei: row.accrued_wei, claimAvailable: false as const }]
              : [])
        : [],
    },
  };
}

export async function fetchCashbackWallets(
  window: CashbackWindow,
  opts: FetchOpts,
): Promise<Result<CashbackWallet[]>> {
  const r = await getJson(`/api/v1/cashback/wallets?window=${window}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const rows = Array.isArray(r.body.wallets) ? r.body.wallets : [];
  return {
    kind: 'ok',
    data: rows.filter(isObject).map((o) => ({
      walletPubkey: str(o.wallet_pubkey, ''),
      label: typeof o.label === 'string' ? o.label : null,
      isPrimary: o.is_primary === true,
      volumeLamports: str(o.volume_lamports),
      cashbackLamports: str(o.cashback_lamports),
      tradeCount: num(o.trade_count),
    })),
  };
}

export async function fetchCashbackPayouts(opts: FetchOpts): Promise<Result<PayoutEntry[]>> {
  const r = await getJson('/api/v1/cashback/payouts', opts);
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

export async function fetchPointsMe(opts: FetchOpts): Promise<Result<PointsMe>> {
  const r = await getJson('/api/v1/points/me', opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  if (r.status === 503) return { kind: 'disabled' };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  const p = isObject(r.body.points) ? r.body.points : {};
  const accolades = Array.isArray(r.body.accolades) ? r.body.accolades : [];
  return {
    kind: 'ok',
    data: {
      partnerActive: r.body.partner_active === true,
      points: {
        volumePoints: num(p.volume_points),
        bonusPoints: num(p.bonus_points),
        lifetimePoints: num(p.lifetime_points),
      },
      accolades: accolades.filter(isObject).map((a) => ({
        key: str(a.key, ''),
        name: str(a.name, ''),
        description: str(a.description, ''),
        icon: str(a.icon, 'star'),
        bonusPoints: num(a.bonus_points),
        status: (a.status === 'unlocked' || a.status === 'claimed' ? a.status : 'locked') as AccoladeStatus,
        progress: num(a.progress),
      })),
    },
  };
}

export async function fetchPointsLeaderboard(opts: FetchOpts): Promise<Result<PointsLeaderboardEntry[]>> {
  const r = await getJson('/api/v1/points/leaderboard', opts);
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
      lifetimePoints: num(o.lifetime_points),
      isMe: o.is_me === true,
    })),
  };
}

export type CashbackClaimResult =
  | { kind: 'ok'; payoutId: string; amountLamports: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export async function claimCashback(clientClaimId: string, opts: FetchOpts): Promise<CashbackClaimResult> {
  const r = await getJson('/api/v1/cashback/claim', opts, {
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

export type AccoladeClaimResult =
  | { kind: 'ok'; bonusPoints: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

export async function claimAccolade(accoladeKey: string, opts: FetchOpts): Promise<AccoladeClaimResult> {
  const r = await getJson('/api/v1/points/accolades/claim', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accolade_key: accoladeKey }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.body.accepted === true) return { kind: 'ok', bonusPoints: num(r.body.bonus_points) };
  return { kind: 'rejected', reason: str(r.body.reason, 'not_unlocked') };
}

// ───────── React Query hooks ─────────

const CASHBACK_KEY = ['api', 'v1', 'cashback'];
const POINTS_KEY = ['api', 'v1', 'points'];

// These hooks only mount inside the auth-gated terminal shell (rewards page),
// so fire immediately with the session COOKIE (null mirror token → cookie auth)
// instead of waiting ~300-800ms for clerk.browser.js; bail only on a POSITIVE
// signed-out from the Clerk session mirror.
function useNotSignedOut(): boolean {
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  return isSignedIn !== false;
}

export function useCashbackMe(): UseQueryResult<Result<CashbackMe>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: [...CASHBACK_KEY, 'me'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchCashbackMe({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useCashbackWallets(window: CashbackWindow): UseQueryResult<Result<CashbackWallet[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: [...CASHBACK_KEY, 'wallets', window],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchCashbackWallets(window, { authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useCashbackPayouts(): UseQueryResult<Result<PayoutEntry[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: [...CASHBACK_KEY, 'payouts'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchCashbackPayouts({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function usePointsMe(): UseQueryResult<Result<PointsMe>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: [...POINTS_KEY, 'me'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchPointsMe({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function usePointsLeaderboard(): UseQueryResult<Result<PointsLeaderboardEntry[]>> {
  const enabled = useNotSignedOut();
  return useQuery({
    queryKey: [...POINTS_KEY, 'leaderboard'],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchPointsLeaderboard({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 15_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useClaimCashback(): UseMutationResult<CashbackClaimResult, Error, string> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientClaimId: string) => claimCashback(clientClaimId, { authToken: await getToken() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CASHBACK_KEY });
    },
  });
}

export function useClaimAccolade(): UseMutationResult<AccoladeClaimResult, Error, string> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accoladeKey: string) => claimAccolade(accoladeKey, { authToken: await getToken() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: POINTS_KEY });
    },
  });
}

'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useMe, type MeResponse, type ProvisioningState } from '@/lib/api/me';
import { refreshAuthorization } from '@/lib/api/wallet-auth';
import { useConnectionStore, type TradingAuthState } from '@/lib/state/connection-store';

const ME_QUERY_KEY = ['api', 'v1', 'me'] as const;
export const TRADING_AUTH_REFRESH_AHEAD_MS = 5 * 60_000;
const TRADING_AUTH_REFRESH_POLL_MS = 30_000;

/**
 * Provisioning states in which the trading authorization may (and must)
 * be kept warm. The authorization row is issued during provisioning
 * with a finite TTL, so a user who pauses mid-onboarding at
 * `wallet_ready_needs_nonce_setup` needs the same background slide as a
 * fully-provisioned user — otherwise the row expires and onboarding
 * step 2 dead-ends on `no_active_authorization`. Legacy aliases are
 * normalized server-side but kept here for rolling-deploy safety.
 */
export const AUTH_REFRESHABLE_PROVISIONING_STATES: ReadonlySet<ProvisioningState> = new Set([
  'ready_to_trade',
  'wallet_ready_needs_nonce_setup',
  'nonces_pending',
  'wallet_ready_needs_backup',
  'wallet_ready_needs_passkey_root',
]);

export function shouldRefreshTradingAuthorization(
  expiresAt: string | null,
  nowMs = Date.now(),
  refreshAheadMs = TRADING_AUTH_REFRESH_AHEAD_MS,
): boolean {
  if (expiresAt === null) return false;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs - nowMs <= refreshAheadMs;
}

/**
 * Every reason this loop declines to refresh, plus each refresh
 * outcome. The loop used to go quiet on its first early return, so a
 * user could sit signed-in and active while ZERO refresh attempts were
 * made and nothing anywhere said why. Each path now reports a distinct
 * reason.
 *
 * Reasons are enum-like constants — never a token, session id, wallet
 * key, email or any other identifier.
 */
export type TradingAuthSyncReason =
  // Gate (effect entry)
  | 'clerk_loading'
  | 'clerk_signed_out'
  | 'me_unavailable'
  | 'reauth_required'
  | 'provisioning_not_refreshable'
  // Per-tick
  | 'refresh_in_flight'
  | 'no_authorization_targets'
  | 'authorization_current'
  | 'refresh_backoff'
  | 'token_unavailable'
  | 'refresh_ok'
  | 'refresh_partial'
  | 'refresh_threw';

let lastReason: TradingAuthSyncReason | null = null;

/**
 * Emit on CHANGE only: the loop ticks every 30s, so reporting every
 * tick would be pure console spam and the steady state ('refresh_ok',
 * 'authorization_current') would drown the transition that matters.
 * Console tag matches the repo's `[tag] detail` convention.
 */
export function reportTradingAuthSync(reason: TradingAuthSyncReason): void {
  if (reason === lastReason) return;
  lastReason = reason;
  console.debug(`[trading-auth] ${reason}`);
}

/** Latest reported reason — readable from tests and a console probe. */
export function lastTradingAuthSyncReason(): TradingAuthSyncReason | null {
  return lastReason;
}

/** Test-only: clear the change-detection latch between cases. */
export function __resetTradingAuthSyncReasonForTests(): void {
  lastReason = null;
}

export type TradingAuthGate =
  | { eligible: true; me: MeResponse }
  | { eligible: false; reason: TradingAuthSyncReason; tradingAuth: TradingAuthState | null };

/**
 * Decides whether the background refresh loop may run.
 *
 * Takes Clerk's OWN `useAuth()` state. It previously gated on the
 * `ClerkSessionSync` Zustand mirror, which that store's own docs
 * describe as best-effort and "never the source of truth": while the
 * mirror sat stale (`isSignedIn: null` after a `clear()`, or during the
 * ~1-3s clerk.browser.js cold boot) this loop never started, and the
 * trading authorization lapsed under a signed-in, actively trading user.
 *
 * `isLoaded === false` is a WAIT, not a failure — hence
 * `tradingAuth: null`, meaning "leave the connection store alone"
 * rather than flipping it to 'stale' on every cold boot.
 */
export function tradingAuthGate(
  clerkIsLoaded: boolean,
  clerkIsSignedIn: boolean | undefined,
  me: MeResponse | undefined,
): TradingAuthGate {
  if (!clerkIsLoaded) return { eligible: false, reason: 'clerk_loading', tradingAuth: null };
  if (clerkIsSignedIn !== true) {
    return { eligible: false, reason: 'clerk_signed_out', tradingAuth: 'stale' };
  }
  if (!me) return { eligible: false, reason: 'me_unavailable', tradingAuth: 'stale' };
  if (me.reauth_required) return { eligible: false, reason: 'reauth_required', tradingAuth: 'stale' };
  if (!AUTH_REFRESHABLE_PROVISIONING_STATES.has(me.provisioning.state)) {
    return { eligible: false, reason: 'provisioning_not_refreshable', tradingAuth: 'stale' };
  }
  return { eligible: true, me };
}

interface AuthorizationRefreshTarget {
  walletAccountId: string | null;
  expiresAt: string | null;
  isPrimary: boolean;
}

export function authorizationRefreshTargets(me: MeResponse): AuthorizationRefreshTarget[] {
  if (me.reauth_required) return [];
  const targets: AuthorizationRefreshTarget[] = [];
  for (const wallet of me.wallets) {
    if (wallet.status !== 'active' || !wallet.is_enabled || wallet.is_archived) continue;
    // Null expiry means no active authorization row exists for this wallet.
    // The refresh endpoint can only SLIDE an existing active authorization
    // (`refreshTradingAuthorizationTtl` returns `no_active_authorization`
    // for null-expiry rows) — it can never establish one, so these wallets
    // are not refresh targets. Authorization creation happens in the
    // provisioning/backup flow, not here.
    if (wallet.trading_authorization.expires_at === null) continue;
    targets.push({
      walletAccountId: wallet.wallet_account_id,
      expiresAt: wallet.trading_authorization.expires_at,
      isPrimary: wallet.is_primary,
    });
  }
  if (targets.length > 0) return targets;
  // No per-wallet target AND no legacy primary expiry: the user has no
  // active authorization row at all. Reporting a null-expiry target
  // here made the sync mark tradingAuth 'ready' for a user who cannot
  // trade — masking a genuinely broken-provisioning signal.
  if (me.trading_authorization.expires_at === null) return [];
  return [
    {
      walletAccountId: null,
      expiresAt: me.trading_authorization.expires_at,
      isPrimary: true,
    },
  ];
}

function withUpdatedTradingAuthorization(
  previous: MeResponse | undefined,
  walletAccountId: string | null,
  isPrimary: boolean,
  expiresAt: string,
): MeResponse | undefined {
  if (!previous || previous.reauth_required) return previous;
  const wallets =
    walletAccountId === null
      ? previous.wallets
      : previous.wallets.map((wallet) =>
          wallet.wallet_account_id === walletAccountId
            ? {
                ...wallet,
                trading_authorization: {
                  ...wallet.trading_authorization,
                  expires_at: expiresAt,
                },
              }
            : wallet,
        );
  return {
    ...previous,
    wallets,
    ...(isPrimary
      ? {
          trading_authorization: {
            ...previous.trading_authorization,
            expires_at: expiresAt,
          },
        }
      : {}),
  };
}

/**
 * Keeps the Turnkey trading authorization warm before latency-critical
 * submits run. This is separate from ClerkSessionSync: Clerk owns the
 * user session JWT, while this slides api/'s wallet trading authorization
 * expiry in the background.
 */
export function TradingAuthorizationSync(): null {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data: me } = useMe({ enabled: isLoaded && isSignedIn === true });
  const setTradingAuth = useConnectionStore((s) => s.setTradingAuth);
  const inFlightRef = useRef(false);
  // Failure backoff: a user whose refresh keeps failing (revoked row,
  // api 5xx) otherwise force-mints a JWT + fires N POSTs every 30s
  // forever. Doubles 30s → capped 10min, resets on any success.
  const consecutiveFailuresRef = useRef(0);
  const nextAttemptAtMsRef = useRef(0);

  useEffect(() => {
    const gate = tradingAuthGate(isLoaded, isSignedIn, me);
    if (!gate.eligible) {
      reportTradingAuthSync(gate.reason);
      if (gate.tradingAuth !== null) setTradingAuth(gate.tradingAuth);
      return;
    }
    const gatedMe = gate.me;

    let cancelled = false;

    const maybeRefresh = async (): Promise<void> => {
      if (cancelled) return;
      if (inFlightRef.current) {
        reportTradingAuthSync('refresh_in_flight');
        return;
      }
      const allTargets = authorizationRefreshTargets(gatedMe);
      if (allTargets.length === 0) {
        reportTradingAuthSync('no_authorization_targets');
        setTradingAuth('stale');
        return;
      }
      const targets = allTargets.filter((target) => shouldRefreshTradingAuthorization(target.expiresAt));
      if (targets.length === 0) {
        reportTradingAuthSync('authorization_current');
        setTradingAuth('ready');
        return;
      }
      if (Date.now() < nextAttemptAtMsRef.current) {
        reportTradingAuthSync('refresh_backoff');
        return;
      }

      // Single-flight: latch BEFORE the first await so the interval and
      // a re-run of this effect can't interleave two refresh passes
      // while getToken() is still pending.
      inFlightRef.current = true;
      try {
        // This is a background maintenance path, not a latency-critical
        // click path, so use Clerk as source of truth rather than the
        // synchronous mirror. The mirror can go stale while a tab sits
        // idle; using it here marks trading auth stale and cascades into
        // missing wallets/settings even though Clerk can mint a fresh JWT.
        const token = await getToken({ skipCache: true });
        if (cancelled) return;
        if (!token) {
          reportTradingAuthSync('token_unavailable');
          setTradingAuth('stale');
          return;
        }

        setTradingAuth('refreshing');
        // Each wallet's refresh is independent — run them in parallel.
        const results = await Promise.allSettled(
          targets.map((target) => refreshAuthorization(undefined, token, target.walletAccountId)),
        );
        if (cancelled) return;
        let ok = 0;
        let reauthRequired = false;
        for (let i = 0; i < targets.length; i += 1) {
          const settled = results[i];
          const target = targets[i];
          if (!settled || !target || settled.status !== 'fulfilled') continue;
          const result = settled.value;
          if (result.kind === 'reauth') {
            reauthRequired = true;
            continue;
          }
          if (result.kind !== 'ok') continue;
          ok += 1;
          queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (previous) =>
            withUpdatedTradingAuthorization(
              previous,
              target.walletAccountId,
              target.isPrimary,
              result.expiresAt,
            ),
          );
        }
        if (reauthRequired) {
          reportTradingAuthSync('reauth_required');
          // Session is gone; further per-wallet retries are pointless.
          // Refresh /me so the trading-ready gate flips to needs_sign_in.
          setTradingAuth('stale');
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
          return;
        }
        if (ok > 0) {
          // The optimistic patch above only rewrites `expires_at`;
          // server-computed fields derived from the expiry — most
          // importantly per-wallet `trade_ready` — stay stale. If the
          // authorization had ALREADY lapsed before this slide (idle
          // tab, overnight), the cached `/me` says `trade_ready: false`
          // and every Buy click opens the deposit panel even though
          // the server would now accept the order. Refetch so the gate
          // sees the recomputed truth.
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        }
        if (ok === targets.length) {
          reportTradingAuthSync('refresh_ok');
          consecutiveFailuresRef.current = 0;
          nextAttemptAtMsRef.current = 0;
        } else {
          reportTradingAuthSync('refresh_partial');
          consecutiveFailuresRef.current += 1;
          nextAttemptAtMsRef.current =
            Date.now() +
            Math.min(TRADING_AUTH_REFRESH_POLL_MS * 2 ** consecutiveFailuresRef.current, 10 * 60_000);
        }
        setTradingAuth(ok === targets.length ? 'ready' : 'stale');
      } finally {
        inFlightRef.current = false;
      }
    };

    // getToken() can reject (e.g. Clerk network failure) — without the
    // catch this is an unhandled-rejection crash class on every tick.
    const run = (): void => {
      maybeRefresh().catch(() => {
        if (cancelled) return;
        reportTradingAuthSync('refresh_threw');
        consecutiveFailuresRef.current += 1;
        nextAttemptAtMsRef.current =
          Date.now() +
          Math.min(TRADING_AUTH_REFRESH_POLL_MS * 2 ** consecutiveFailuresRef.current, 10 * 60_000);
        setTradingAuth('stale');
      });
    };

    run();
    const timer = window.setInterval(run, TRADING_AUTH_REFRESH_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // `tokenVersion` is deliberately NOT a dependency: this loop's own
    // `getToken({skipCache:true})` rotates the JWT, which bumps
    // tokenVersion via ClerkSessionSync's mirror — re-arming on it made
    // the effect re-run and fire again immediately after every refresh
    // pass (a self-feeding force-mint loop when refreshes kept failing).
    // The 30s interval already covers genuine rotations.
  }, [isLoaded, isSignedIn, me, queryClient, setTradingAuth]);

  return null;
}

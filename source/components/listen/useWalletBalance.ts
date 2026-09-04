import { useEffect, useRef, useState } from 'react';
import { fetchHotTradePoll, isTradingApiConfigured } from '@/lib/api/trading';
import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import { forceClerkMirrorRefresh, getClerkSession } from '@/lib/state/clerk-session-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';

const POLL_MS = 3_000;

interface WalletBalanceResponse {
  readonly lamports?: string;
  /** Present only on `include_usdc=1` requests. String micro-USDC;
   *  "0" = no ATA; null = read failed. */
  readonly usdc_micro?: string | null;
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Composes the `/api/v1/trade/wallet-balance` URL. When the caller
 * supplies a valid UUID for `walletAccountId`, the api/ resolves
 * that specific wallet (verifying ownership / Solana / active /
 * not archived / enabled) instead of falling back to the user's
 * primary. Exported for unit tests.
 */
export function buildWalletBalanceUrl(
  walletAccountId: string | null,
  includeUsdc = false,
): string {
  const params = new URLSearchParams();
  if (walletAccountId !== null && UUID_REGEX.test(walletAccountId)) {
    params.set('wallet_account_id', walletAccountId);
  }
  if (includeUsdc) params.set('include_usdc', '1');
  const query = params.toString();
  return query ? `/api/v1/trade/wallet-balance?${query}` : '/api/v1/trade/wallet-balance';
}

export interface WalletBalanceState {
  /** Display label, 3-decimal truncated ('—' while unresolved). */
  readonly label: string;
  /**
   * Raw lamports as a decimal string, or `null` while unresolved.
   * Money math (Max, exceeds-balance checks) MUST use this, never
   * the display-rounded label.
   */
  readonly lamports: string | null;
  /**
   * Raw micro-USDC as a decimal string when the poll ran with
   * `includeUsdc`. "0" = no ATA; `null` = not requested, unresolved,
   * or the api/'s read failed.
   */
  readonly usdcMicro: string | null;
}

const UNRESOLVED: WalletBalanceState = { label: '—', lamports: null, usdcMicro: null };

export interface UseWalletBalanceOptions {
  /** Ask the api/ for the wallet's USDC ATA balance too. Off by
   *  default so non-USDC surfaces pay zero extra read cost. */
  readonly includeUsdc?: boolean;
  /** When false the hook idles entirely (no poll). Lets USDC-only
   *  consumers mount the hook unconditionally and enable it only
   *  while a USDC surface is visible. */
  readonly enabled?: boolean;
}

/**
 * Returns the SOL balance of the wallet identified by
 * `walletAccountId` as `{ label, lamports }`. When `null` (legacy /
 * signed-out / unresolved selection) the api/ falls back to the
 * user's primary wallet.
 *
 * The hook uses a slow display cadence and re-runs immediately when
 * this tab receives one of its order events. Order execution and sell
 * sizing use their own fresher paths; the topnav pill is display-only.
 */
export function useWalletBalance(
  walletAccountId: string | null = null,
  options: UseWalletBalanceOptions = {},
): WalletBalanceState {
  const { includeUsdc = false, enabled = true } = options;
  // Seeded auth: the SOL pill renders from the first frame on cold starts
  // (server-seeded session mirror) instead of waiting for clerk.browser.js.
  const { isLoaded, isSignedIn } = useSeededAuth();
  const [state, setState] = useState<WalletBalanceState>(UNRESOLVED);
  const inFlightRef = useRef(false);
  const lastWalletIdRef = useRef(walletAccountId);
  const orderEventCount = useTradeActivityStore((s) => s.orderEvents.length);

  useEffect(() => {
    if (!enabled || !isTradingApiConfigured() || !isLoaded || isSignedIn !== true) {
      setState(UNRESOLVED);
      return;
    }
    // Reset the displayed balance only when the user actually switches
    // wallets, so a stale value doesn't render under the new wallet's id —
    // order-event re-runs keep the last balance instead of blanking it.
    if (lastWalletIdRef.current !== walletAccountId) {
      lastWalletIdRef.current = walletAccountId;
      setState(UNRESOLVED);
    }
    let cancelled = false;
    const url = buildWalletBalanceUrl(walletAccountId, includeUsdc);
    const fetchBalance = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // Per-user wallet tracking: the /api/v1/ endpoint is
        // Clerk-gated on the api/ Fastify service. When
        // `wallet_account_id` is supplied (Slice "Terminal wallet
        // selector") the api/ resolves THAT specific wallet via
        // `getWalletAccountByIdForUser` with full ownership +
        // state gates. When absent, the api/ falls back to the
        // user's primary wallet for back-compat with legacy
        // callers.
        const session = getClerkSession();
        const resp = await fetchHotTradePoll(url, { authToken: session.token });
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as WalletBalanceResponse;
        if (cancelled) return;
        if ((data as { reauth_required?: boolean }).reauth_required === true) {
          // A reauth to a request that CARRIED a bearer means the
          // mirrored JWT went stale between syncs — self-heal by
          // force-minting (single-flight) so the next 3s tick carries a
          // live token, and KEEP the last displayed balance: this value
          // feeds Max sizing and the insufficient-spend check, and
          // blanking it on every stale poll left the pill at "—"
          // indefinitely (nothing here routes to sign-in).
          if (session.token !== null) void forceClerkMirrorRefresh();
          return;
        }
        setState(toBalanceState(data.lamports, includeUsdc ? data.usdc_micro : null));
      } catch {
        // Keep the last displayed balance; one slow poll should not blank the hot UI.
      } finally {
        inFlightRef.current = false;
      }
    };

    // Pause the poll while the tab is hidden (the pill isn't visible anyway)
    // and refresh immediately when the tab regains focus.
    const tick = () => {
      if (document.hidden) return;
      void fetchBalance();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) void fetchBalance();
    };
    void fetchBalance();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, includeUsdc, isLoaded, isSignedIn, orderEventCount, walletAccountId]);

  return state;
}

function toBalanceState(
  raw: string | undefined,
  usdcMicroRaw: string | null | undefined = null,
): WalletBalanceState {
  // The wire's usdc_micro is a digit string; anything else (null =
  // read failed, absent = not requested) collapses to null.
  const usdcMicro =
    typeof usdcMicroRaw === 'string' && /^\d+$/.test(usdcMicroRaw) ? usdcMicroRaw : null;
  if (!raw) return usdcMicro === null ? UNRESOLVED : { ...UNRESOLVED, usdcMicro };
  try {
    const lamports = BigInt(raw);
    const whole = lamports / 1_000_000_000n;
    const frac = (lamports % 1_000_000_000n).toString().padStart(9, '0').slice(0, 3);
    return { label: `${whole.toString()}.${frac}`, lamports: lamports.toString(), usdcMicro };
  } catch {
    return usdcMicro === null ? UNRESOLVED : { ...UNRESOLVED, usdcMicro };
  }
}

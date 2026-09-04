'use client';

import { useClerk } from '@clerk/nextjs';
import { useCallback } from 'react';
import { useMe, type MeResponse, type MeWalletEntry } from '@/lib/api/me';
import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import {
  getSelectedWallet,
  pickDefaultSelectedWallet,
  reconcileMultiSelection,
  useSelectedWalletStore,
} from '@/lib/state/selected-wallet-store';
import { useConnectionStore, type TradingAuthState, type TradingConnectionState } from '@/lib/state/connection-store';
import { useWalletPanel } from '@/lib/wallet-panel-context';

// T5 + Slice "Terminal wallet selector": combines Clerk signed-in
// check with /me's `provisioning.state` AND the per-wallet readiness
// of the user's currently-selected wallet.
//
// When the user is signed out → opens the Clerk modal (existing UX).
// When the user is signed in but the sub-org is not `ready_to_trade`
// → opens the shared WalletPanel.
// When the sub-org is ready but the SELECTED wallet is not, or has
// been archived/disabled, opens the WalletPanel so the user can
// either enable trading for that wallet or re-select.

export type TradingReadyDecision =
  | { kind: 'ready'; walletAccountId: string | null }
  | { kind: 'needs_sign_in' }
  | { kind: 'needs_wallet_setup'; state: string }
  | { kind: 'needs_wallet_selection' }
  | { kind: 'needs_per_wallet_setup'; walletAccountId: string }
  | { kind: 'wallet_unavailable'; reason: 'archived' | 'disabled' | 'inactive_status' }
  | { kind: 'trading_disconnected'; state: TradingConnectionState }
  | { kind: 'authorization_not_ready'; state: TradingAuthState }
  | { kind: 'loading' };

export interface DecideRequireTradingReadyInput {
  isLoaded: boolean;
  isSignedIn: boolean | null | undefined;
  me: MeResponse | undefined;
  tradingConnection?: TradingConnectionState;
  tradingAuth?: TradingAuthState;
  /**
   * Slice "Terminal wallet selector": when provided, the decision
   * also gates on per-wallet readiness for the selected wallet.
   * When `null` AND the user owns at least one eligible wallet, the
   * decision is `needs_wallet_selection`. Callers that pre-date the
   * selector (no selectedWallet supplied) get the original sub-org
   * gate semantics for back-compat.
   */
  selectedWallet?: MeWalletEntry | null;
  selectedWallets?: ReadonlyArray<MeWalletEntry | null>;
}

function decisionForWallet(wallet: MeWalletEntry | null): TradingReadyDecision | null {
  if (wallet === null) return { kind: 'needs_wallet_selection' };
  if (wallet.is_archived) {
    return { kind: 'wallet_unavailable', reason: 'archived' };
  }
  if (!wallet.is_enabled) {
    return { kind: 'wallet_unavailable', reason: 'disabled' };
  }
  if (wallet.status !== 'active') {
    return { kind: 'wallet_unavailable', reason: 'inactive_status' };
  }
  if (!wallet.trade_ready) {
    return {
      kind: 'needs_per_wallet_setup',
      walletAccountId: wallet.wallet_account_id,
    };
  }
  return null;
}

/** Pure decision helper for tests. */
export function decideRequireTradingReady(
  input: DecideRequireTradingReadyInput,
): TradingReadyDecision {
  if (!input.isLoaded) return { kind: 'loading' };
  if (!input.isSignedIn) return { kind: 'needs_sign_in' };
  const me = input.me;
  if (!me) return { kind: 'loading' };
  // Clerk positively reports signed-in but the cached `/me` says reauth:
  // that contradiction is a cold-boot artifact (the cookie-optimistic /me
  // fired before a bearer token existed), not a real signed-out session.
  // Treat it as still-loading so optimistic submits proceed and we never
  // pop the sign-in modal at a signed-in user; a genuine reauth flows
  // through once Clerk itself flips isSignedIn.
  if (me.reauth_required) {
    return input.isSignedIn === true ? { kind: 'loading' } : { kind: 'needs_sign_in' };
  }
  if (me.provisioning.state !== 'ready_to_trade') {
    return { kind: 'needs_wallet_setup', state: me.provisioning.state };
  }
  if (input.tradingConnection !== undefined && input.tradingConnection !== 'connected') {
    return { kind: 'trading_disconnected', state: input.tradingConnection };
  }
  // `refreshing` is a background maintenance state. Do not block
  // click -> submit on it; order intake remains the authoritative
  // gate and will reject if the authorization is actually invalid.
  if (input.tradingAuth !== undefined && input.tradingAuth === 'stale') {
    return { kind: 'authorization_not_ready', state: input.tradingAuth };
  }
  // Per-wallet gates only apply when the caller threaded a
  // `selectedWallet`. Back-compat callers fall through to ready.
  if (input.selectedWallet !== undefined) {
    const selected = input.selectedWallet;
    const selectedDecision = decisionForWallet(selected);
    if (selectedDecision) return selectedDecision;
    for (const wallet of input.selectedWallets ?? []) {
      const decision = decisionForWallet(wallet);
      if (decision) return decision;
    }
    if (selected === null) return { kind: 'needs_wallet_selection' };
    return { kind: 'ready', walletAccountId: selected.wallet_account_id };
  }
  return { kind: 'ready', walletAccountId: null };
}

/**
 * Resolve the effective selection used for the trading-ready gate, applying the
 * cold-boot fallback. The selection store hydrates/reconciles in an effect that
 * runs after `/me.wallets` is available, so for a brief window after a cold
 * login the store selection is empty while wallets exist. In that window we
 * resolve to the reconciled default (primary-first) so the gate matches the
 * wallet the store is about to settle on — instead of reporting
 * `needs_wallet_selection` and opening the wallet panel on the first quick-buy.
 *
 * Multi-wallet aware: a non-empty multi-selection is preserved verbatim; only a
 * fully-empty set falls back to `[default]`. When the user has no eligible
 * wallets, the result is empty/null and the normal setup gating applies.
 *
 * Pure + exported for unit tests.
 */
export function resolveColdBootSelection(
  selectedWalletAccountId: string | null,
  multiSelectedWalletAccountIds: ReadonlyArray<string>,
  wallets: ReadonlyArray<MeWalletEntry>,
): { selectedWalletAccountId: string | null; multiIds: ReadonlyArray<string> } {
  // Mirror the reconciler (`decideSyncSelectedWallet`): drop persisted
  // ids that no longer resolve to an eligible wallet BEFORE deciding
  // whether the selection is empty. A localStorage set carrying a
  // stale/foreign id would otherwise survive as "non-empty", resolve
  // to `null` entries, and gate the first quick-buy into the wallet
  // panel — for the one render before the reconcile effect lands on
  // exactly the fallback computed here.
  const reconciledMulti =
    multiSelectedWalletAccountIds.length > 0
      ? reconcileMultiSelection(wallets, multiSelectedWalletAccountIds)
      : multiSelectedWalletAccountIds;
  const storedSelectedId =
    selectedWalletAccountId !== null &&
    getSelectedWallet(wallets, selectedWalletAccountId) !== null
      ? selectedWalletAccountId
      : null;
  const effectiveSelectedId =
    storedSelectedId ??
    (reconciledMulti.length > 0
      ? reconciledMulti[0] ?? null
      : wallets.length > 0
        ? pickDefaultSelectedWallet(wallets)?.wallet_account_id ?? null
        : null);
  const effectiveMultiIds =
    reconciledMulti.length > 0
      ? reconciledMulti
      : effectiveSelectedId
        ? [effectiveSelectedId]
        : [];
  return { selectedWalletAccountId: effectiveSelectedId, multiIds: effectiveMultiIds };
}

export interface UseRequireTradingReadyResult {
  decision: TradingReadyDecision;
  /**
   * Returns true if the caller may proceed with the trade. Otherwise
   * opens the appropriate gate UI (Clerk modal or WalletPanel) and
   * returns false.
   */
  requireTradingReady(): boolean;
}

export interface UseRequireTradingReadyOptions {
  /** Override the post-sign-in redirect target. */
  redirectUrl?: string;
  /**
   * Gate on the live trading SSE connection. Trade-page buy/sell surfaces
   * enable this so no reconnect/reauth work leaks into the submit path.
   * Discover quick-buy does not mount `useTradeStream`, so it leaves this
   * off and relies on the api/trading request itself.
   */
  requireTradingConnection?: boolean;
  /**
   * Optimistic submit gate. When true, a click is NOT pre-gated on the
   * cold-boot auth waterfall: as long as Clerk is initialised and the user
   * is signed in (so a session token exists), the submit proceeds while
   * `/me` is still in flight or the trading authorization is still `stale`.
   * Order intake is the authoritative gate and surfaces a reauth/setup
   * prompt only if the order actually needs it. States that genuinely
   * require user action up front (signed out, wallet not set up) still open
   * the Clerk modal / wallet panel. This is what keeps Quickbuy pressable
   * the instant a trade page renders, instead of waiting seconds for the
   * `/me` round-trip and authorization sync to complete.
   */
  optimistic?: boolean;
}

export function useRequireTradingReady(
  options: UseRequireTradingReadyOptions = {},
): UseRequireTradingReadyResult {
  // Cold-start fast path: the server-seeded session mirror (see
  // lib/auth/session-seed.ts) is an authoritative "signed in + bearer ready"
  // answer that arrives frames before clerk.browser.js. Merging it here lets
  // optimistic submits proceed immediately on a cold load instead of gating
  // until Clerk JS finishes booting. Once Clerk reports, its answer wins.
  const { isLoaded, isSignedIn } = useSeededAuth();
  const clerk = useClerk();
  const { data: me } = useMe({ enabled: isSignedIn === true });
  const wallet = useWalletPanel();
  const tradingConnection = useConnectionStore((s) => s.trading);
  const tradingAuth = useConnectionStore((s) => s.tradingAuth);
  // Slice "Terminal wallet selector": resolve the selected wallet
  // against the live /me.wallets list. If a stored id no longer
  // points to an eligible wallet, this returns `null` and the
  // decision flips to `needs_wallet_selection`.
  const selectedWalletAccountId = useSelectedWalletStore(
    (s) => s.selectedWalletAccountId,
  );
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  // Cold-boot race guard (see `resolveColdBootSelection`): fall back to the
  // reconciled default when the selection store hasn't hydrated yet, so the
  // first Discover quick-buy after a cold login isn't gated into the wallet
  // panel. A genuinely selected wallet that is archived/disabled/not
  // `trade_ready` still flows through the normal per-wallet block below.
  const walletsAvailable = !!me && !me.reauth_required && me.wallets.length > 0;
  const meWallets = me && !me.reauth_required ? me.wallets : [];
  const { selectedWalletAccountId: effectiveSelectedWalletAccountId, multiIds: effectiveMultiIds } =
    resolveColdBootSelection(selectedWalletAccountId, multiSelectedWalletAccountIds, meWallets);
  const selectedWallet = walletsAvailable
    ? getSelectedWallet(meWallets, effectiveSelectedWalletAccountId)
    : null;
  const selectedWallets = walletsAvailable
    ? effectiveMultiIds.map((id) => getSelectedWallet(meWallets, id))
    : [];
  const decision = decideRequireTradingReady({
    isLoaded,
    isSignedIn,
    me,
    ...(options.requireTradingConnection === true ? { tradingConnection } : {}),
    tradingAuth,
    // Only thread the selected wallet when /me has populated a
    // wallets list. Pre-state (empty wallets) keeps back-compat
    // sub-org-only semantics so the gate doesn't fire prematurely.
    ...(walletsAvailable ? { selectedWallet } : {}),
    ...(walletsAvailable ? { selectedWallets } : {}),
  });

  const optimistic = options.optimistic === true;
  const requireTradingReady = useCallback((): boolean => {
    if (decision.kind === 'ready') return true;
    if (decision.kind === 'loading') {
      // Pre-Clerk-init there is no session token yet, so a submit cannot
      // authenticate — wait. But once Clerk is loaded and signed in, an
      // optimistic caller proceeds while `/me` is still resolving (the
      // common cold-refresh case): the order POST carries the session token
      // and intake validates server-side.
      return optimistic && isLoaded && isSignedIn === true;
    }
    if (decision.kind === 'needs_sign_in') {
      const redirect =
        options.redirectUrl ??
        (typeof window !== 'undefined' ? window.location.pathname : '/');
      clerk.openSignIn({ forceRedirectUrl: redirect });
      return false;
    }
    if (decision.kind === 'trading_disconnected' || decision.kind === 'authorization_not_ready') {
      // A stale/refreshing/disconnected authorization is not a hard stop for
      // an optimistic caller: intake re-validates the authorization and the
      // caller surfaces a reauth prompt only if the order is actually
      // rejected. Pre-gating here is exactly what made Quickbuy a no-op for
      // the first seconds after a hard refresh.
      return optimistic;
    }
    // needs_wallet_setup / needs_wallet_selection /
    // needs_per_wallet_setup / wallet_unavailable all open the
    // wallet panel — the panel renders the appropriate inline UX
    // (sub-org-wide setup, wallet selector, or per-wallet enable
    // trading CTA). These are genuine "needs user action" states (only
    // reachable AFTER /me resolves), so optimistic mode still prompts.
    wallet.openWalletPanel();
    return false;
  }, [decision, clerk, wallet, options.redirectUrl, optimistic, isLoaded, isSignedIn]);

  return { decision, requireTradingReady };
}

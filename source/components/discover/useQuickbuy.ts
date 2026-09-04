'use client';

import { useCallback, type MouseEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useTokenTradePrewarm } from '@/components/trade/useTokenTradePrewarm';
import { unlockTradeSuccessSound } from '@/components/trade/tradeSound';
import {
  deriveChildClientOrderId,
  submitBatchOrder,
  submitOrder,
  type BatchOrderInput,
  type BatchOrderResult,
} from '@/lib/api/orders';
import { routeForWalletCount } from '@/components/trade/walletCountRoute';
import { resolveFailedBatchChildren } from '@/components/trade/batchChildToasts';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import {
  resolveOrderAuthToken,
  orderTokenErrorMessage,
  warmOrderAuthToken,
} from '@/lib/auth/orderAuthToken';
import {
  quickBuyLamports,
  selectActivePresetForSection,
  useTradeStore,
  type QuickBuySectionId,
} from '@/lib/state/trade-store';
import { isUsdcPair } from '@/lib/trade/spend-currency';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';

function buildQuickbuyClientOrderId(mint: string): string {
  // Format: qb-<mint-first-8>-<timestamp>-<rand>. Unique per click,
  // short enough to fit api/'s 128-char cap, traceable in logs.
  const shortMint = mint.slice(0, 8);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `qb-${shortMint}-${ts}-${rand}`;
}

// Bounded cold-window token resolution shared with every trade submit
// surface — see lib/auth/orderAuthToken.ts.
const quickbuyAuthToken = resolveOrderAuthToken;
const quickbuyTokenErrorMessage = orderTokenErrorMessage;

/** The card-shape-independent fields a quickbuy order needs. */
export interface QuickbuyTarget {
  /** Mint base58; undefined for static fixture rows (quickbuy stays off). */
  mint: string | undefined;
  ticker: string;
  name: string;
  /** Monotonic Discover/DB marker; when true trading must not route BC. */
  graduated: boolean;
  /** Quote mint base58 for non-SOL pairs (USDC). Absent/null = SOL pair. */
  quoteMint: string | null | undefined;
}

/**
 * Per-card quickbuy submit + trade-page prewarm for the Alpha lane. This is
 * a hook-shaped extraction of CoinCard's inline quickbuy handler (kept
 * inline there — the standard rows are untouched); the two MUST stay
 * behaviorally in sync. Owns the two independent gates:
 *
 *   - `hasMint` (card navigation + prewarm + heartbeat): only requires a
 *     real mint. The chart should always be reachable; a missing QuickBuy
 *     amount must not block navigation.
 *   - `quickbuyEnabled` (the lightning button): requires BOTH a mint AND a
 *     configured per-section amount. Without an amount the button is
 *     disabled, the hover state renders only the lightning glyph, and a
 *     click is a no-op (no toast, no fallback default).
 *
 * Quickbuy is fire-and-forget by design — the button label NEVER changes
 * after a click. Per-card progress lives in the global top-of-screen toast
 * stack (see `<TradeActivityToasts />` in `<TerminalShell />`) so a user
 * can spam-click without the chip morphing under their pointer.
 *
 * Routing forks on `routeForWalletCount(multi.length)`:
 *   - 'single' → POST /api/v1/trade/orders with explicit
 *     `wallet_account_id` (no more "silently falls back to primary" bug).
 *   - 'batch'  → POST /api/v1/trade/batch-orders with equal split across
 *     the selected wallets, total = the QuickBuy preset.
 */
export function useQuickbuy(target: QuickbuyTarget, sectionId: QuickBuySectionId) {
  const mint = target.mint;
  const quickBuyAmountSol = useTradeStore(
    (s) => s.quickBuyAmountsBySection[sectionId],
  );
  /* USDC pair: quick-buy is pair-native — it spends USDC from the
     `usdc_trade.default_buy_usdc_micro` preset regardless of the
     global mode, and the hover amount renders in dollars. */
  const pairIsUsdc = isUsdcPair(target.quoteMint);
  const defaultBuyUsdcMicro = useTradeStore((s) => s.usdcTrade.default_buy_usdc_micro);
  const hasMint = typeof mint === 'string' && mint.length > 0;
  const hasQuickBuyAmount = quickBuyAmountSol != null;
  // USDC pairs are always pressable: the server-defaulted
  // `default_buy_usdc_micro` is the amount, no per-section setup needed.
  const quickbuyEnabled = hasMint && (pairIsUsdc || hasQuickBuyAmount);
  const { prewarmNow, startHeartbeat, stopHeartbeat, visibleRef } = useTokenTradePrewarm(
    hasMint ? mint : null,
    { graduated: target.graduated },
  );
  const { getToken } = useAuth();
  // Optimistic quickbuy: a click attempts the order as soon as Clerk is
  // signed in, without waiting on the /me round-trip or trading-authorization
  // sync; intake validates server-side and prompts only if truly needed.
  const { decision: tradingReadyDecision, requireTradingReady } = useRequireTradingReady({
    optimistic: true,
  });
  const pushPendingActivity = useTradeActivityStore((s) => s.pushPending);
  const markActivityError = useTradeActivityStore((s) => s.markError);
  const dismissActivity = useTradeActivityStore((s) => s.dismiss);
  // Slice "Multi-wallet split buy/sell orders": QuickBuy honors the
  // current multi-wallet selection. With 1 wallet selected we pass
  // `wallet_account_id` explicitly (previously the field was
  // omitted, which made the api/ silently fall back to the user's
  // primary even when a non-primary wallet was selected). With 2+
  // wallets, we route through `/api/v1/trade/batch-orders` with
  // equal split — total spend equals the QuickBuy preset, divided
  // across selected wallets, same semantics as the Buy tab.
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );

  const handleQuickbuy = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    // Latency head stamp: capture the press clock before any other work so
    // the trace's `clickedAtMs` is the true press time (matches TradePanel /
    // InstantTradeBox sending `clientTsMs`). The performance.now() twin
    // feeds the e2e waterfall (durations never use Date.now()).
    const clickedAtMs = Date.now();
    const pressPerfAtMs = performance.now();
    e.stopPropagation();
    if (!quickbuyEnabled || typeof mint !== 'string') return;
    // Press-time token warm (fire-and-forget, single-flight): quickbuy
    // submits at pointerdown; a cold Clerk mint starts here so the
    // submit's `resolveOrderAuthToken` joins the same in-flight request.
    warmOrderAuthToken(getToken);
    /* `quickbuyEnabled` already implies a non-null amount for SOL
       pairs, but TypeScript can't see through the composite boolean.
       Re-narrow explicitly so the rest of the handler can do
       arithmetic on a `number`. USDC pairs size from the
       `default_buy_usdc_micro` preset instead (read at click time
       below), so they skip this gate. */
    if (!pairIsUsdc && quickBuyAmountSol == null) return;
    /* Trading-presets slice: every buy trade reads its slippage,
       priority fee, bribe, and send mode from the per-section ACTIVE
       preset's `buy` block. Read at CLICK time via
       getState() — these values are only used to build the order body,
       never rendered, so subscribing ~200 mounted cards to every store
       update was pure overhead (same pattern as QuickBuyPanel's preset
       click handler). The resolver prefers the
       `active_by_section[sectionId]` override, falling back to the
       global `active_index` for sections without an override. */
    const tradeState = useTradeStore.getState();
    const buyPreset = tradeState.tradePresets.presets[
      selectActivePresetForSection(tradeState.tradePresets, sectionId)
    ].buy;
    const slippageBps = buyPreset.slippage_bps;
    const priorityLamports = buyPreset.priority_lamports;
    const bribeLamports = buyPreset.bribe_lamports;
    const sendMode = buyPreset.send_mode;
    // Self-warm: fire an IMMEDIATE prewarm before any other work so the
    // engine's quote/cashback caches start warming in parallel with the
    // order POST. The card's pointer-down already warms on mouse clicks
    // (~80ms head start), but this also covers keyboard/programmatic
    // clicks that never emit pointer-down — and the order path no longer
    // depends on a bubbled event firing first. The TRAILING_REFIRE_MS
    // cooldown dedups it against a recent pointer-down warm, so no
    // double POST.
    prewarmNow();
    // The press IS the user gesture — arm the success chime now so the
    // async confirmation (TradeActivityToasts) is allowed to play it.
    unlockTradeSuccessSound();
    // Synchronous gate check — opens Clerk modal / wallet panel when
    // needed. Already-cached useMe() makes this an in-memory check.
    if (!requireTradingReady()) return;

    // On a cold boot the multi-selection store may not have hydrated yet. The
    // readiness gate above already resolved (and approved) the effective wallet
    // via the same reconciled default, so submit against THAT wallet rather
    // than letting the empty set fall through to api/'s implicit primary
    // resolution — this stays correct even when the default eligible wallet is
    // not the primary (e.g. primary archived). A real multi-selection is used
    // as-is.
    const walletIds =
      multiSelectedWalletAccountIds.length > 0
        ? multiSelectedWalletAccountIds
        : tradingReadyDecision.kind === 'ready' && tradingReadyDecision.walletAccountId !== null
          ? [tradingReadyDecision.walletAccountId]
          : multiSelectedWalletAccountIds;
    const route = routeForWalletCount(walletIds.length);
    const ticker = (target.ticker || '').replace(/^\$/, '') || target.name;
    // USDC pair: spend the micro-USDC preset (read at click time, like
    // the fee preset above). SOL pair: the per-section SOL amount.
    const totalUsdcMicro = pairIsUsdc
      ? String(tradeState.usdcTrade.default_buy_usdc_micro)
      : null;
    const totalLamports = pairIsUsdc ? '0' : quickBuyLamports(quickBuyAmountSol!);
    // Activity toasts display SOL; USDC quickbuys omit the amount.
    const toastSolAmount = pairIsUsdc ? null : quickBuyAmountSol;

    if (route === 'batch') {
      // Equal-split batch quickbuy. Pre-derive each child's
      // clientOrderId and push one pending activity entry per child
      // BEFORE firing the HTTP call so the global toast stack shows
      // one row per wallet immediately (matches the TradePanel batch
      // buy flow).
      const clientParentId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `qb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const perChildSol =
        toastSolAmount === null ? null : toastSolAmount / walletIds.length;
      const input: BatchOrderInput = {
        side: 'buy',
        clientParentId,
        walletAccountIds: [...walletIds],
        mint,
        graduated: target.graduated,
        ...(pairIsUsdc
          ? { amountUsdcMicro: totalUsdcMicro! }
          : { amountLamports: totalLamports }),
        maxSlippageBps: slippageBps,
        priorityLamports,
        bribeLamports,
        sendMode,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
      };
      // The POST body only needs `clientParentId` (child ids are derived
      // server-side with the same SHA-256 scheme), so fire it IMMEDIATELY
      // and run the SubtleCrypto child-id derivation + toast pushes
      // concurrently — the order no longer serializes behind digest work.
      const resultPromise: Promise<BatchOrderResult | null> = (async () => {
        const authToken = await quickbuyAuthToken(getToken);
        if (authToken === null) return null;
        // E2E waterfall press stamps (monotonic clock), token resolve just
        // settled on this line.
        return submitBatchOrder(
          {
            ...input,
            timing: {
              pressAtMs: pressPerfAtMs,
              surface: 'quickbuy',
              tokenReadyAtMs: performance.now(),
            },
          },
          { authToken },
        );
      })();
      void (async () => {
        let childIds: string[];
        try {
          childIds = await Promise.all(
            walletIds.map((wid) => deriveChildClientOrderId(clientParentId, wid)),
          );
        } catch (err) {
          // Couldn't compute child ids (SubtleCrypto missing). Fall
          // back to a single pending entry surfacing the error.
          resultPromise.catch(() => undefined);
          const fallbackId = buildQuickbuyClientOrderId(mint);
          pushPendingActivity({
            id: fallbackId,
            mint,
            ticker,
            side: 'buy',
            solAmount: toastSolAmount,
          });
          markActivityError(fallbackId, (err as Error).message ?? 'network error');
          return;
        }
        childIds.forEach((cid, i) => {
          pushPendingActivity({
            id: cid,
            mint,
            ticker,
            side: 'buy',
            solAmount: perChildSol,
            walletAccountId: walletIds[i] ?? null,
          });
        });
        try {
          const result = await resultPromise;
          if (result === null) {
            const msg = quickbuyTokenErrorMessage();
            for (const cid of childIds) markActivityError(cid, msg);
            return;
          }
          if (result.kind === 'reauth') {
            // Context-aware copy: mid-bootstrap users get "still signing
            // in — tap again" instead of a misleading 'sign in required'.
            const msg = quickbuyTokenErrorMessage();
            for (const cid of childIds) markActivityError(cid, msg);
          } else if (result.kind === 'invalid_input') {
            for (const cid of childIds) markActivityError(cid, result.reason);
          } else if (result.kind === 'error') {
            for (const cid of childIds) markActivityError(cid, result.errorCode);
          } else if (result.kind === 'network_error') {
            for (const cid of childIds) markActivityError(cid, 'network error');
          } else if (result.kind === 'unknown_outcome') {
            // B3: aborted batch POST — the engine may be filling the
            // children. Leave every toast PENDING; the reconciliation
            // flow (fills lookup + order-status fallback) resolves the
            // real outcome. Marking failed here baited double-buys.
          } else if (result.kind === 'failed') {
            const code = result.parent.error_code ?? 'failed';
            for (const cid of childIds) markActivityError(cid, code);
          } else if (result.kind === 'partial_failed') {
            // Children rejected BEFORE engine accept (failed /
            // gate_rejected states) never produce SSE events — resolve
            // their toasts from the POST result (mirrors
            // TradePanel.markFailedBatchChildren). Dispatched children
            // still advance via the SSE feed.
            resolveFailedBatchChildren(result.children, {
              markError: markActivityError,
              dismiss: dismissActivity,
            });
          }
          // 'ok': SSE feed will drive child toasts through
          // submitted → confirmed → filled.
        } catch (err) {
          const msg = (err as Error).message ?? 'network error';
          for (const cid of childIds) markActivityError(cid, msg);
        }
      })();
      return;
    }

    // Single-wallet path (route === 'single' or 'none'). When 'none'
    // (zero selected wallets — shouldn't happen in practice given the
    // store invariant), fall through to api/'s primary-wallet
    // resolution by omitting `wallet_account_id`.
    const clientOrderId = buildQuickbuyClientOrderId(mint);
    const walletAccountId = walletIds[0];
    pushPendingActivity({
      id: clientOrderId,
      mint,
      ticker,
      side: 'buy',
      solAmount: toastSolAmount,
      walletAccountId: walletAccountId ?? null,
    });
    const body = {
      client_order_id: clientOrderId,
      side: 'buy' as const,
      mint,
      graduated: target.graduated,
      ...(pairIsUsdc
        ? { amount_usdc_micro: totalUsdcMicro!, spend_currency: 'usdc' as const }
        : { amount_lamports: totalLamports }),
      slippage_bps: slippageBps,
      priority_lamports: priorityLamports,
      bribe_lamports: bribeLamports,
      send_mode: sendMode,
      origin: 'manual_ui' as const,
      background_ack: true,
      client_ts: clickedAtMs,
      ...(typeof walletAccountId === 'string' && walletAccountId.length > 0
        ? { wallet_account_id: walletAccountId }
        : {}),
    };
    // Fire-and-forget. The handler returns synchronously to the click
    // event so the button is never "busy" — subsequent clicks queue
    // their own orders independently.
    void (async () => {
      try {
        const authToken = await quickbuyAuthToken(getToken);
        if (authToken === null) {
          markActivityError(clientOrderId, quickbuyTokenErrorMessage());
          return;
        }
        const result = await submitOrder(body, {
          authToken,
          // E2E waterfall press stamps; the token resolve settled on the
          // line above.
          timing: {
            pressAtMs: pressPerfAtMs,
            surface: 'quickbuy',
            tokenReadyAtMs: performance.now(),
          },
        });
        if (result.kind === 'reauth') {
          markActivityError(clientOrderId, quickbuyTokenErrorMessage());
        } else if (result.kind === 'error') {
          markActivityError(clientOrderId, result.errorCode);
        } else if (result.kind === 'network_error') {
          markActivityError(clientOrderId, 'network error');
        }
        // result.kind === 'ok' just means api/ acked. The SSE feed
        // will drive the toast through submitted → confirmed →
        // filled. Nothing else to do here.
      } catch (err) {
        markActivityError(clientOrderId, (err as Error).message ?? 'network error');
      }
    })();
  }, [
    quickbuyEnabled,
    target.graduated,
    target.name,
    target.ticker,
    markActivityError,
    dismissActivity,
    mint,
    multiSelectedWalletAccountIds,
    pairIsUsdc,
    prewarmNow,
    pushPendingActivity,
    quickBuyAmountSol,
    requireTradingReady,
    tradingReadyDecision,
    sectionId,
    getToken,
  ]);

  return {
    hasMint,
    quickbuyEnabled,
    quickBuyAmountSol,
    pairIsUsdc,
    usdcDollars: pairIsUsdc ? defaultBuyUsdcMicro / 1_000_000 : null,
    handleQuickbuy,
    prewarmNow,
    startHeartbeat,
    stopHeartbeat,
    visibleRef,
  };
}

'use client';

import { useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  submitOrder,
  submitBatchOrder,
  deriveChildClientOrderId,
  type BatchOrderResult,
} from '@/lib/api/orders';
import { orderTokenErrorMessage, resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import { useTradeStore } from '@/lib/state/trade-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import type { PositionItem } from './usePositionsStream';

/** 100% of the position, in basis points. */
const SELL_ALL_BPS = 10_000;

function buildSellId(mint: string): string {
  const shortMint = mint.slice(0, 8);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sellall-${shortMint}-${ts}-${rand}`;
}

/** Mark every child toast that did not dispatch, by its derived client_order_id. */
function applyBatchErrors(
  result: BatchOrderResult,
  childIds: ReadonlyArray<string>,
  markError: (id: string, error: string) => void,
): void {
  if (result.kind === 'reauth') {
    childIds.forEach((id) => markError(id, 'sign in required'));
    return;
  }
  if (result.kind === 'network_error') {
    childIds.forEach((id) => markError(id, 'network error'));
    return;
  }
  if (result.kind === 'error' || result.kind === 'invalid_input') {
    const message = result.kind === 'error' ? result.errorCode : result.reason;
    childIds.forEach((id) => markError(id, message));
    return;
  }
  if (
    result.kind !== 'ok' &&
    result.kind !== 'partial_failed' &&
    result.kind !== 'failed' &&
    result.kind !== 'cancelled'
  ) {
    // e.g. `in_flight` (idempotency collision) — leave the toasts to the
    // already-running batch's SSE lifecycle.
    return;
  }
  // Mirror TradePanel's batch handler (TradePanel.tsx:1172): flag ONLY the
  // children that genuinely failed. `idempotency_conflict` (a lost-response
  // retry of an already-live child) and `pending` resolve through the global
  // trade SSE lifecycle — rendering them as errors here shows a false failure
  // for an order that is actually live (finding #18).
  for (const child of result.children) {
    if (child.state === 'failed' || child.state === 'gate_rejected') {
      markError(child.client_order_id, child.error_code ?? child.state);
    }
  }
}

/**
 * One-click "sell all" for a position pill. Sells 100% of the holding
 * across EVERY wallet that contributes to the aggregated position:
 *
 *   - 1 contributor  -> single-wallet `submitOrder` (one activity toast).
 *   - N contributors -> `submitBatchOrder` fan-out, one child per wallet.
 *     Child client_order_ids are pre-derived (same SHA-256 scheme as
 *     api/) so each wallet's toast exists before the SSE `accepted`
 *     event arrives and the global activity feed lights up per child.
 *
 * Fees/slippage come from the GLOBAL active preset's `sell` block; each
 * contributor's `amountRaw` is forwarded as that wallet's balance hint so
 * the engine sizes off the UI balance instead of a cold chain read.
 * `graduated` is intentionally omitted — the engine resolves the venue
 * from chain state since the holdings snapshot doesn't carry that marker.
 */
export function useSellAllPosition(): (item: PositionItem) => void {
  // Optimistic like the other trade surfaces: don't let a cold-boot
  // `loading`/`stale` auth state turn a Sell-All click into a silent no-op;
  // attempt the order and let intake validate, prompting only when needed.
  const { requireTradingReady } = useRequireTradingReady({ optimistic: true });
  const { getToken } = useAuth();
  const slippageBps = useTradeStore(
    (s) => s.tradePresets.presets[s.tradePresets.active_index].sell.slippage_bps,
  );
  const priorityLamports = useTradeStore(
    (s) => s.tradePresets.presets[s.tradePresets.active_index].sell.priority_lamports,
  );
  const bribeLamports = useTradeStore(
    (s) => s.tradePresets.presets[s.tradePresets.active_index].sell.bribe_lamports,
  );
  const sendMode = useTradeStore(
    (s) => s.tradePresets.presets[s.tradePresets.active_index].sell.send_mode,
  );
  const pushPending = useTradeActivityStore((s) => s.pushPending);
  const markError = useTradeActivityStore((s) => s.markError);

  return useCallback(
    (item: PositionItem) => {
      // Auth + wallet-setup gate (opens Clerk modal / wallet panel if needed).
      if (!requireTradingReady()) return;
      const contributors = item.contributors;
      if (contributors.length === 0) return;
      const ticker = item.symbol ?? item.mint.slice(0, 6);
      // USDC-mode proceeds preference. The position snapshot carries no
      // quoteMint/graduated context, so attach the marker whenever the
      // global mode is USDC and let the engine route it: native USDC
      // pairs settle USDC anyway (no-op), and SOL pairs append the
      // SOL→USDC proceeds swap on BOTH venues (BC + AMM cross-quote).
      const sellSpendCurrency =
        useTradeStore.getState().usdcTrade.trade_quote_mode === 'usdc'
          ? ('usdc' as const)
          : undefined;

      if (contributors.length === 1) {
        const only = contributors[0]!;
        const clientOrderId = buildSellId(item.mint);
        // Latency-trace head stamp (parity with every other submit
        // surface — this was the one seller leaving clickedAtMs blank
        // in traces.jsonl, hiding its true e2e).
        const clickedAtMs = Date.now();
        pushPending({
          id: clientOrderId,
          mint: item.mint,
          ticker,
          side: 'sell',
          solAmount: null,
          walletAccountId: only.walletAccountId,
        });
        void (async () => {
          try {
            // Cold-window safe (mirrors every other submit surface): the
            // warm token mirror resolves synchronously; right after a
            // refresh this races Clerk's getToken() against a 1s bound
            // instead of silently no-opping on a null mirror.
            const authToken = await resolveOrderAuthToken(getToken);
            if (authToken === null) {
              markError(clientOrderId, orderTokenErrorMessage());
              return;
            }
            const result = await submitOrder(
              {
                client_order_id: clientOrderId,
                side: 'sell',
                mint: item.mint,
                client_ts: clickedAtMs,
                sell_percent_bps: SELL_ALL_BPS,
                sell_token_balance_hint: only.amountRaw,
                ...(sellSpendCurrency ? { spend_currency: sellSpendCurrency } : {}),
                slippage_bps: slippageBps,
                priority_lamports: priorityLamports,
                bribe_lamports: bribeLamports,
                send_mode: sendMode,
                origin: 'manual_ui',
                background_ack: true,
                wallet_account_id: only.walletAccountId,
              },
              { authToken },
            );
            if (result.kind === 'reauth') markError(clientOrderId, 'sign in required');
            else if (result.kind === 'error') markError(clientOrderId, result.errorCode);
            else if (result.kind === 'network_error') markError(clientOrderId, 'network error');
          } catch (err) {
            markError(clientOrderId, (err as Error).message ?? 'network error');
          }
        })();
        return;
      }

      // Multi-wallet fan-out.
      const clickedAtMs = Date.now();
      const clientParentId = buildSellId(item.mint);
      const walletAccountIds = contributors.map((c) => c.walletAccountId);
      const sellTokenBalanceHints: Record<string, string> = {};
      for (const c of contributors) sellTokenBalanceHints[c.walletAccountId] = c.amountRaw;

      // Fire the POST FIRST — the body only needs `clientParentId` (child
      // ids are server-derived with the same SHA-256 scheme), so the order
      // never serializes behind the SubtleCrypto child-id derivation. Ids
      // and toasts are produced concurrently and correlated after. `null`
      // marks the cold-window "no auth token" outcome.
      const resultPromise: Promise<BatchOrderResult | null> = (async () => {
        // Same cold-window-safe token resolution as the single path.
        const authToken = await resolveOrderAuthToken(getToken);
        if (authToken === null) return null;
        return submitBatchOrder(
          {
            side: 'sell',
            clientParentId,
            walletAccountIds,
            mint: item.mint,
            clientTsMs: clickedAtMs,
            sellPercentBps: SELL_ALL_BPS,
            ...(sellSpendCurrency ? { spendCurrency: sellSpendCurrency } : {}),
            maxSlippageBps: slippageBps,
            priorityLamports,
            bribeLamports,
            sendMode,
            origin: 'manual_ui',
            sellTokenBalanceHints,
          },
          { authToken },
        );
      })();
      void (async () => {
        let childIds: string[];
        try {
          childIds = await Promise.all(
            contributors.map((c) => deriveChildClientOrderId(clientParentId, c.walletAccountId)),
          );
        } catch {
          resultPromise.catch(() => undefined);
          return;
        }
        contributors.forEach((c, i) => {
          const id = childIds[i];
          if (id === undefined) return;
          pushPending({
            id,
            mint: item.mint,
            ticker,
            side: 'sell',
            solAmount: null,
            walletAccountId: c.walletAccountId,
          });
        });
        try {
          const result = await resultPromise;
          if (result === null) {
            childIds.forEach((id) => markError(id, orderTokenErrorMessage()));
            return;
          }
          applyBatchErrors(result, childIds, markError);
        } catch (err) {
          childIds.forEach((id) => markError(id, (err as Error).message ?? 'network error'));
        }
      })();
    },
    [
      requireTradingReady,
      getToken,
      slippageBps,
      priorityLamports,
      bribeLamports,
      sendMode,
      pushPending,
      markError,
    ],
  );
}

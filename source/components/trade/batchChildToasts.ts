// Shared resolution for batch children that terminated BEFORE engine
// accept (`failed` / `gate_rejected` states from
// api/src/routes/trade/batch-orders.ts — e.g. gate rejects,
// engine_unavailable). Those children never produce SSE events, so any
// pending toast for them must be resolved from the batch POST result
// itself or it hangs on "sending…" forever. Extracted from
// TradePanel.markFailedBatchChildren so the quickbuy surfaces
// (useQuickbuy + CoinCard's synced inline copy) share the exact logic.

export interface FailedBatchChildLike {
  readonly client_order_id: string;
  readonly state: string;
  readonly error_code: string | null;
  readonly error_kind: string | null;
}

export function resolveFailedBatchChildren(
  children: ReadonlyArray<FailedBatchChildLike>,
  handlers: {
    markError: (clientOrderId: string, error: string) => void;
    dismiss: (clientOrderId: string) => void;
  },
): void {
  for (const child of children) {
    const error = child.error_code ?? child.error_kind ?? child.state;
    if (error === 'cancel.sell balance pending' || error === 'cancel.no sellable balance') {
      handlers.dismiss(child.client_order_id);
      continue;
    }
    if (child.state === 'failed' || child.state === 'gate_rejected') {
      handlers.markError(child.client_order_id, error);
    }
  }
}

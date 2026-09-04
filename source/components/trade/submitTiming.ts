// Dev-only breadcrumb for the pre-submit critical path (press →
// gates-clear → token-ready → POST). A live trace showed a sell spending
// ~2s between button press and the api receiving the POST (bounded gate
// wait serialized with a cold Clerk token mint); this makes any future
// stall diagnosable straight from the browser console. Deliberately NOT
// wire telemetry: the api's order schema strips undeclared fields, and
// adding one would ripple through the engine intent.

export interface PreSubmitStamps {
  /** Button-press clock (the order's `clientTsMs`). */
  pressAtMs: number;
  /** When the price/balance gate reported clear (fan-out sells only). */
  gatesClearAtMs?: number;
  /** When the order auth-token resolve settled. */
  tokenReadyAtMs?: number;
  /** Just before the order POST is handed to fetch. */
  postStartAtMs: number;
}

/** Pure formatter (exported for unit tests). Deltas are from press time. */
export function formatPreSubmitTiming(label: string, stamps: PreSubmitStamps): string {
  const parts: string[] = [];
  if (stamps.gatesClearAtMs !== undefined) {
    parts.push(`gates+${stamps.gatesClearAtMs - stamps.pressAtMs}ms`);
  }
  if (stamps.tokenReadyAtMs !== undefined) {
    parts.push(`token+${stamps.tokenReadyAtMs - stamps.pressAtMs}ms`);
  }
  parts.push(`post+${stamps.postStartAtMs - stamps.pressAtMs}ms`);
  return `[trade] ${label} press→ ${parts.join(' ')}`;
}

export function logPreSubmitTiming(label: string, stamps: PreSubmitStamps): void {
  if (process.env.NODE_ENV === 'production') return;
  console.debug(formatPreSubmitTiming(label, stamps));
}

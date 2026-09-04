// Coalescing gate for the terminal-order-event render fast-path.
//
// When a TERMINAL lifecycle event (confirmed/filled/…) arrives over SSE,
// TradeActivityProvider force-commits the store update with
// `ReactDOM.flushSync` so the confirmation paints on the next frame
// instead of waiting out React's default render scheduling (~5-15ms of
// scheduler delay before the commit even starts). flushSync is a sync
// layout pass, so it must stay rare: a 5-wallet batch emits a burst of
// confirmed/filled events within ~1s, and five sync passes back-to-back
// would cost more main-thread time than the scheduling they save.
//
// Policy: at most ONE sync flush per FLUSH_WINDOW_MS. The first terminal
// event of a burst takes the fast path (that's the paint the user is
// watching for); the rest ride React's normal batched scheduling exactly
// as they do today — no burst regression by construction.

/** Kinds that advance the confirmation UI to a terminal phase (mirrors
 *  TERMINAL_SSE_KINDS in lib/telemetry/tradeTiming.ts). High-frequency
 *  intermediate kinds (accepted/resolved/submitted) and non-order streams
 *  never qualify. */
const TERMINAL_ORDER_KINDS: ReadonlySet<string> = new Set([
  'confirmed',
  'fill_pending',
  'filled',
  'partial',
  'failed',
  'cancelled',
]);

/** Minimum spacing between sync flushes: sized to the ~1s multi-wallet
 *  burst so one burst can claim at most one sync layout pass. */
export const FLUSH_WINDOW_MS = 1_000;

let lastFlushAtMs: number | null = null;

export function isTerminalOrderKind(kind: string): boolean {
  return TERMINAL_ORDER_KINDS.has(kind);
}

/**
 * Returns true (and stamps the window) when a sync flush is allowed NOW —
 * i.e. no other sync flush was claimed in the last FLUSH_WINDOW_MS.
 * Callers must only claim when they will actually flush.
 */
export function claimTerminalFlush(nowMs: number): boolean {
  if (lastFlushAtMs !== null && nowMs - lastFlushAtMs < FLUSH_WINDOW_MS) {
    return false;
  }
  lastFlushAtMs = nowMs;
  return true;
}

/** Test-only: clears the coalescing window between tests. */
export function _resetTerminalFlushForTests(): void {
  lastFlushAtMs = null;
}

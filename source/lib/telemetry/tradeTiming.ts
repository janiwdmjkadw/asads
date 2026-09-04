// End-to-end trade-latency instrumentation: one in-memory record per
// clientOrderId tracking the FULL click→confirmation waterfall on a
// monotonic clock (performance.now() for every duration; Date.now() is
// captured only as paired wall stamps for the clock-offset estimate).
//
// Waterfall stamp points (perf.now unless noted):
//   pressAtMs        — per-surface button press (TradePanel CTA
//                      pointerdown, InstantTradeBox chip handler entry,
//                      Discover quickbuy handler entry)
//   gatesClearAtMs   — pre-submit gates done (fan-out sells only)
//   tokenReadyAtMs   — order auth-token resolve settled
//   fetchStartAtMs   — just before the order POST is handed to fetch()
//   firstByteAtMs    — fetch() resolved (response headers available)
//   ackParsedAtMs    — accepted ack parsed from the response body
//   sseSubmittedAtMs — SSE `submitted` lifecycle event received
//   sseTerminalAtMs  — first SSE event that advances the confirmation UI
//                      to a terminal phase (confirmed/fill_pending/
//                      filled/partial → success; failed/cancelled → error)
//   commitAtMs       — React committed the state update driving the
//                      confirmation UI (layout effect in
//                      TradeTimingPaintProbe, same commit batch as the
//                      toast/status subscribers of the activity store)
//   paintAtMs        — first opportunity after the browser painted that
//                      commit (rAF → setTimeout(0); see stampConfirmCommit)
//
// Clock offset: offset ≈ serverReceivedAtMs − (fetchStartWall+firstByteWall)/2,
// using the `server_received_at_ms` stamp echoed by the api's order ack.
// Client wall clocks are skewed ±150ms vs the server; the RTT midpoint
// estimate bounds the error at half the POST round trip.
//
// One compact beacon per order POSTs to /api/telemetry/trade-timing on
// the terminal SSE event's paint (or a 15s timeout), via
// navigator.sendBeacon / keepalive fetch — fire-and-forget, never on the
// trade hot path (all bookkeeping is Map writes; the beacon fires after
// terminal state; nothing awaits any of this).

export interface TradePressTiming {
  /** performance.now() at the button press — the per-surface stamp. */
  pressAtMs: number;
  /** Submit surface: 'panel' | 'instant' | 'quickbuy' (free-form). */
  surface: string;
  /** perf.now when pre-submit gates cleared (fan-out sells). */
  gatesClearAtMs?: number;
  /** perf.now when the order auth-token resolve settled. */
  tokenReadyAtMs?: number;
}

/** Fetch-attempt stamps captured by the batch POST (children records are
 *  begun only at ack time, when their ids are first known client-side). */
export interface OrderFetchStamps {
  fetchStartAtMs?: number;
  fetchStartWallMs?: number;
  firstByteAtMs?: number;
  firstByteWallMs?: number;
  ackParsedAtMs?: number;
  serverReceivedAtMs?: number;
}

export interface TradeTimingRecord {
  cid: string;
  mint: string;
  side: string;
  surface: string;
  pressAtMs: number;
  gatesClearAtMs?: number;
  tokenReadyAtMs?: number;
  fetchStartAtMs?: number;
  fetchStartWallMs?: number;
  firstByteAtMs?: number;
  firstByteWallMs?: number;
  ackParsedAtMs?: number;
  serverReceivedAtMs?: number;
  sseSubmittedAtMs?: number;
  sseTerminalAtMs?: number;
  /** Terminal SSE kind ('filled'/'failed'/…) or a POST-failure code. */
  outcome?: string;
  commitAtMs?: number;
  paintAtMs?: number;
}

/** Compact per-order beacon. All segments are rounded ms; -1 = missing. */
export interface TradeTimingBeacon {
  kind: 'trade-timing';
  cid: string;
  mint: string;
  side: string;
  surface: string;
  outcome: string;
  press2gates: number;
  press2token: number;
  press2post: number;
  post2fb: number;
  fb2ack: number;
  post2ack: number;
  ack2sub: number;
  ack2sse: number;
  sse2commit: number;
  commit2paint: number;
  sse2paint: number;
  total: number;
  offset: number;
  timedOut: boolean;
}

const BEACON_PATH = '/api/telemetry/trade-timing';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Hard cap so an SSE outage can never grow the map unbounded. */
const MAX_TRACKED = 200;

interface TrackedOrder extends TradeTimingRecord {
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  finalized: boolean;
}

const records = new Map<string, TrackedOrder>();
/** cids whose terminal SSE event landed but whose commit/paint stamps
 *  are still pending (consumed by stampConfirmCommit). */
const awaitingCommit = new Set<string>();

type BeaconSender = (payload: TradeTimingBeacon) => void;
let beaconSenderOverride: BeaconSender | null = null;

/** Monotonic now — exported so callers stamp with the same clock. */
export function tradeTimingNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function wallNow(): number {
  return Date.now();
}

/**
 * Clock-offset estimate joining client and server timelines:
 * the server's receive stamp minus the wall-clock midpoint of the POST's
 * request→first-byte window. Error is bounded by half the round trip.
 */
export function computeClockOffsetMs(
  serverReceivedAtMs: number,
  fetchStartWallMs: number,
  firstByteWallMs: number,
): number {
  return Math.round(serverReceivedAtMs - (fetchStartWallMs + firstByteWallMs) / 2);
}

function delta(from: number | undefined, to: number | undefined): number {
  if (from === undefined || to === undefined) return -1;
  return Math.max(0, Math.round(to - from));
}

/** Pure payload builder (exported for unit tests). */
export function buildTradeTimingBeacon(
  record: TradeTimingRecord,
  timedOut: boolean,
): TradeTimingBeacon {
  const offset =
    record.serverReceivedAtMs !== undefined &&
    record.fetchStartWallMs !== undefined &&
    record.firstByteWallMs !== undefined
      ? computeClockOffsetMs(
          record.serverReceivedAtMs,
          record.fetchStartWallMs,
          record.firstByteWallMs,
        )
      : -1;
  // Total ends at the last stamp we actually reached (paint on the happy
  // path; on timeout, whatever the waterfall got to).
  const lastAt =
    record.paintAtMs ??
    record.commitAtMs ??
    record.sseTerminalAtMs ??
    record.sseSubmittedAtMs ??
    record.ackParsedAtMs ??
    record.firstByteAtMs ??
    record.fetchStartAtMs;
  return {
    kind: 'trade-timing',
    cid: record.cid,
    mint: record.mint,
    side: record.side,
    surface: record.surface,
    outcome: record.outcome ?? (timedOut ? 'timeout' : 'unknown'),
    press2gates: delta(record.pressAtMs, record.gatesClearAtMs),
    press2token: delta(record.pressAtMs, record.tokenReadyAtMs),
    press2post: delta(record.pressAtMs, record.fetchStartAtMs),
    post2fb: delta(record.fetchStartAtMs, record.firstByteAtMs),
    fb2ack: delta(record.firstByteAtMs, record.ackParsedAtMs),
    post2ack: delta(record.fetchStartAtMs, record.ackParsedAtMs),
    ack2sub: delta(record.ackParsedAtMs, record.sseSubmittedAtMs),
    ack2sse: delta(record.ackParsedAtMs, record.sseTerminalAtMs),
    sse2commit: delta(record.sseTerminalAtMs, record.commitAtMs),
    commit2paint: delta(record.commitAtMs, record.paintAtMs),
    sse2paint: delta(record.sseTerminalAtMs, record.paintAtMs),
    total: delta(record.pressAtMs, lastAt),
    offset,
    timedOut,
  };
}

function sendBeaconPayload(payload: TradeTimingBeacon): void {
  if (beaconSenderOverride !== null) {
    beaconSenderOverride(payload);
    return;
  }
  try {
    const body = JSON.stringify(payload);
    // String body keeps sendBeacon a "simple" request (no CORS preflight)
    // — same pattern as the chart-load / perf beacons.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(BEACON_PATH, body);
    } else if (typeof fetch === 'function') {
      void fetch(BEACON_PATH, { method: 'POST', body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

function finalize(record: TrackedOrder, timedOut: boolean): void {
  if (record.finalized) return;
  record.finalized = true;
  if (record.timeoutHandle !== null) clearTimeout(record.timeoutHandle);
  awaitingCommit.delete(record.cid);
  records.delete(record.cid);
  const payload = buildTradeTimingBeacon(record, timedOut);
  sendBeaconPayload(payload);
  if (process.env.NODE_ENV !== 'production') {
    // Dev breadcrumb mirroring the beacon (complements the pre-submit
    // console breadcrumb in components/trade/submitTiming.ts).
    console.debug(
      `[trade-timing] cid=${payload.cid} outcome=${payload.outcome} ` +
        `press2post=${payload.press2post} post2ack=${payload.post2ack} ` +
        `ack2sse=${payload.ack2sse} sse2paint=${payload.sse2paint} ` +
        `total=${payload.total} offset=${payload.offset}`,
    );
  }
}

/**
 * Start tracking an order. Called at the shared submit seams
 * (`submitOrder`; batch children at ack) with the per-surface press
 * timing. Arms the timeout beacon so an order that never reaches a
 * terminal SSE event still reports its partial waterfall.
 */
export function beginOrderTiming(
  cid: string,
  info: { mint: string; side: string; press: TradePressTiming },
  opts: { timeoutMs?: number } = {},
): void {
  if (cid.length === 0 || records.size >= MAX_TRACKED) return;
  const existing = records.get(cid);
  if (existing !== undefined) return; // retries reuse the first record
  const record: TrackedOrder = {
    cid,
    mint: info.mint,
    side: info.side,
    surface: info.press.surface,
    pressAtMs: info.press.pressAtMs,
    ...(info.press.gatesClearAtMs !== undefined
      ? { gatesClearAtMs: info.press.gatesClearAtMs }
      : {}),
    ...(info.press.tokenReadyAtMs !== undefined
      ? { tokenReadyAtMs: info.press.tokenReadyAtMs }
      : {}),
    timeoutHandle: null,
    finalized: false,
  };
  record.timeoutHandle = setTimeout(() => {
    finalize(record, true);
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // Never keep a Node/test process alive over telemetry.
  (record.timeoutHandle as { unref?: () => void }).unref?.();
  records.set(cid, record);
}

/** Just before the order POST is handed to fetch(). Overwrites on retry
 *  so the stamps describe the attempt that actually succeeded. */
export function stampFetchStart(cid: string): void {
  const r = records.get(cid);
  if (r === undefined) return;
  r.fetchStartAtMs = tradeTimingNow();
  r.fetchStartWallMs = wallNow();
}

/** fetch() resolved — response headers (first byte) are in. */
export function stampFirstByte(cid: string): void {
  const r = records.get(cid);
  if (r === undefined) return;
  r.firstByteAtMs = tradeTimingNow();
  r.firstByteWallMs = wallNow();
}

/** Accepted ack parsed; `serverReceivedAtMs` is the api's echoed
 *  handler-entry stamp (null when the server didn't send one). */
export function stampAckParsed(cid: string, serverReceivedAtMs: number | null): void {
  const r = records.get(cid);
  if (r === undefined) return;
  r.ackParsedAtMs = tradeTimingNow();
  if (serverReceivedAtMs !== null) r.serverReceivedAtMs = serverReceivedAtMs;
}

/** Copy batch-POST fetch stamps onto a child record begun at ack time. */
export function applyOrderFetchStamps(cid: string, stamps: OrderFetchStamps): void {
  const r = records.get(cid);
  if (r === undefined) return;
  if (stamps.fetchStartAtMs !== undefined) r.fetchStartAtMs = stamps.fetchStartAtMs;
  if (stamps.fetchStartWallMs !== undefined) r.fetchStartWallMs = stamps.fetchStartWallMs;
  if (stamps.firstByteAtMs !== undefined) r.firstByteAtMs = stamps.firstByteAtMs;
  if (stamps.firstByteWallMs !== undefined) r.firstByteWallMs = stamps.firstByteWallMs;
  if (stamps.ackParsedAtMs !== undefined) r.ackParsedAtMs = stamps.ackParsedAtMs;
  if (stamps.serverReceivedAtMs !== undefined) r.serverReceivedAtMs = stamps.serverReceivedAtMs;
}

/** SSE kinds that advance the confirmation UI to a terminal phase
 *  (mirrors the trade-activity store's toast transitions). */
const TERMINAL_SSE_KINDS = new Set([
  'confirmed',
  'fill_pending',
  'filled',
  'partial',
  'failed',
  'cancelled',
]);

/**
 * Order lifecycle event received on the SSE stream (called from
 * TradeActivityProvider with the resolved clientOrderId). First-write-wins:
 * a `filled` replayed after `confirmed` keeps the earlier terminal stamp.
 */
export function recordOrderSseEvent(cid: string, kind: string): void {
  const r = records.get(cid);
  if (r === undefined) return;
  if (kind === 'submitted') {
    if (r.sseSubmittedAtMs === undefined) r.sseSubmittedAtMs = tradeTimingNow();
    return;
  }
  if (TERMINAL_SSE_KINDS.has(kind) && r.sseTerminalAtMs === undefined) {
    r.sseTerminalAtMs = tradeTimingNow();
    r.outcome = kind;
    awaitingCommit.add(cid);
  }
}

/**
 * The order POST itself ended without an SSE lifecycle ('reauth',
 * rejection error code, network error): finalize immediately with the
 * partial waterfall instead of waiting out the 15s timeout.
 */
export function finalizeOrderTimingFailure(cid: string, outcome: string): void {
  const r = records.get(cid);
  if (r === undefined) return;
  r.outcome = `post_${outcome}`;
  finalize(r, false);
}

/**
 * Called from TradeTimingPaintProbe's layout effect — which runs inside
 * the same React commit batch as every confirmation-UI subscriber of the
 * trade-activity store (zustand notifies all subscribers synchronously
 * and React 18 batches them into one commit). Stamps `commitAtMs` for
 * every record whose terminal SSE event just landed, then captures
 * `paintAtMs` via requestAnimationFrame → setTimeout(0):
 *
 *   - the rAF callback runs immediately BEFORE the browser paints the
 *     frame containing this commit;
 *   - the zero-delay macrotask scheduled inside it runs right AFTER that
 *     frame is presented — the first moment we know pixels changed.
 *
 * Why not PerformanceObserver paint entries: 'paint' entries only emit
 * first-paint / first-contentful-paint (never subsequent repaints), and
 * event-timing entries require a discrete input event — an SSE-driven
 * update has neither. rAF+macrotask is the only primitive that brackets
 * an arbitrary repaint, and its error is bounded by one frame.
 *
 * In a hidden tab rAF never fires; the 15s timeout beacon covers that
 * (reported with commit but no paint).
 */
export function stampConfirmCommit(): void {
  if (awaitingCommit.size === 0) return;
  const now = tradeTimingNow();
  const batch: TrackedOrder[] = [];
  for (const cid of awaitingCommit) {
    const r = records.get(cid);
    if (r === undefined) continue;
    if (r.commitAtMs === undefined) r.commitAtMs = now;
    batch.push(r);
  }
  awaitingCommit.clear();
  if (batch.length === 0) return;
  const capturePaint = () => {
    setTimeout(() => {
      const paintAt = tradeTimingNow();
      for (const r of batch) {
        if (r.paintAtMs === undefined) r.paintAtMs = paintAt;
        finalize(r, false);
      }
    }, 0);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(capturePaint);
  } else {
    capturePaint();
  }
}

// ───────── test hooks ─────────

export function _setTradeTimingBeaconSenderForTests(sender: BeaconSender | null): void {
  beaconSenderOverride = sender;
}

export function _resetTradeTimingForTests(): void {
  for (const r of records.values()) {
    if (r.timeoutHandle !== null) clearTimeout(r.timeoutHandle);
  }
  records.clear();
  awaitingCommit.clear();
}

/** Test-only view of a live record. */
export function _getTradeTimingRecordForTests(cid: string): TradeTimingRecord | undefined {
  return records.get(cid);
}

/**
 * Search latency diagnosis + telemetry: every stage between a keystroke and
 * painted results is timed, logged as one compact console line per request,
 * and (sampled) beaconed to the server so real-user search latency lands in
 * journald next to the `[search]` origin lines:
 *
 *   [search] "sol" keystroke→data 412ms | debounce 48ms | fetch 320ms
 *     (ttfb 311, dl 3) | edge=Miss age=- | server path=text pg=45 sim=0
 *     slot=0 ch=40 asm=1 total=90 | items=20
 *   [search] "sol" data→painted +14ms
 *
 * Server stages come from the daemon's `Server-Timing` response header
 * (idx = in-memory index, hitc = per-mint cache hits, pg = the database,
 * sim = trigram supplement, slot = the analytics store queue wait, ch = the analytics store
 * aggregates, asm = response assembly); `edge` is CloudFront's x-cache.
 * The fetch happens here (not via fetchJson) because the diagnosis needs
 * the response headers.
 *
 * Beacon policy (search fires on every keystroke, unlike chart opens): only
 * slow searches always beacon; fast ones are 1-in-N sampled for a baseline.
 * Fire-and-forget via navigator.sendBeacon — never blocks the UI, no
 * retries, drops silently on failure. Mirrors the `[chart-load]` beacon in
 * trade/useCandleHistory.ts.
 */

import { ingestionApiUrl } from '@/lib/api/ingestion';
import { ApiHttpError } from '@/lib/api/http';
import { verboseLogsEnabled } from '@/lib/dev/verboseLogs';

/** Searches at or above this total always beacon (the population we hunt). */
const SLOW_BEACON_MS = 400;
/** Fast searches beacon 1-in-N for a baseline distribution. */
const FAST_BEACON_SAMPLE = 10;

interface SearchBeaconDraft {
  qLen: number;
  items: number;
  totalMs: number | null;
  debounceMs: number | null;
  requestMs: number;
  parseMs: number;
  serverMs: number | null;
  serverPath: string;
  edge: string;
  startedAtEpochMs: number;
}

interface PendingRender {
  query: string;
  dataAt: number;
  draft: SearchBeaconDraft;
}

let lastRenderMark: PendingRender | null = null;

/** Millisecond timestamp of the user's most recent keystroke, set by the
 *  modal's input onChange. */
let lastKeystrokeAt: number | null = null;
/** When the debounce fired for the in-flight query (measures debounce cost). */
let debounceFiredAt: number | null = null;
/** First beacon of this page session tags `cold=true` — it carries the
 *  code-path warmup + empty caches population. */
let sessionSearchCount = 0;

export function markSearchKeystroke(): void {
  lastKeystrokeAt = performance.now();
}

export function markSearchDebounceFired(): void {
  debounceFiredAt = performance.now();
}

/** Fetch the search URL with an 8s cap, timing every observable stage. */
export async function fetchSearchTimed<T>(
  url: string,
  query: string,
  signal: AbortSignal,
): Promise<T> {
  const fetchStarted = performance.now();
  const keystrokeAt = lastKeystrokeAt;
  const debounceAt = debounceFiredAt;
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new ApiHttpError(response.status, response.statusText);
  }
  const headersAt = performance.now();
  const data = (await response.json()) as T;
  const dataAt = performance.now();

  const fetchMs = Math.round(dataAt - fetchStarted);
  const keystrokeToData = keystrokeAt != null ? Math.round(dataAt - keystrokeAt) : null;
  const debounceMs =
    keystrokeAt != null && debounceAt != null && debounceAt >= keystrokeAt
      ? Math.round(debounceAt - keystrokeAt)
      : null;
  const edge = response.headers.get('x-cache') ?? '-';
  const age = response.headers.get('age') ?? '-';
  const serverTiming = response.headers.get('server-timing') ?? '-';
  const items = countItems(data);

  const draft: SearchBeaconDraft = {
    qLen: query.length,
    items: typeof items === 'number' ? items : -1,
    totalMs: keystrokeToData,
    debounceMs,
    // Dispatch → response headers (network + origin serve)...
    requestMs: Math.round(headersAt - fetchStarted),
    // ...then body download + JSON parse.
    parseMs: Math.round(dataAt - headersAt),
    serverMs: serverTimingDur(serverTiming, 'total'),
    serverPath: serverTimingDesc(serverTiming) ?? '-',
    edge: shortEdge(edge),
    startedAtEpochMs: Date.now(),
  };
  if (typeof items === 'number' && items > 0) {
    // Render commit closes this trace (markSearchRenderCommit).
    lastRenderMark = { query, dataAt, draft };
  } else {
    // Zero-result pages never commit rows — report them here, no render.
    reportSearchLoad(draft, null);
  }

  // Browser-side network breakdown (TTFB vs download) from resource
  // timing; the entry lands asynchronously, so read it a frame later.
  // Console mirror is opt-in (localStorage listen:verbose-logs=1) — the
  // beacon above is the always-on record.
  if (verboseLogsEnabled()) {
    requestAnimationFrame(() => {
      const entry = performance
        .getEntriesByType('resource')
        .reverse()
        .find((candidate) => candidate.name === url || candidate.name.endsWith(url)) as
        | PerformanceResourceTiming
        | undefined;
      const ttfb = entry ? Math.round(entry.responseStart - entry.startTime) : null;
      const download = entry ? Math.round(entry.responseEnd - entry.responseStart) : null;

      console.info(
        `[search] "${query}" keystroke→data ${keystrokeToData ?? '?'}ms | debounce ${debounceMs ?? '?'}ms | ` +
          `fetch ${fetchMs}ms (ttfb ${ttfb ?? '?'}, dl ${download ?? '?'}) | edge=${shortEdge(edge)} age=${age} | ` +
          `server ${compactServerTiming(serverTiming)} | items=${items}`,
      );
    });
  }

  return data;
}

/** Called by the modal when a result set commits — logs data→paint and
 *  finalizes the telemetry beacon for this search. */
export function markSearchRenderCommit(query: string): void {
  const mark = lastRenderMark;
  if (!mark || mark.query !== query) return;
  lastRenderMark = null;
  const renderMs = Math.round(performance.now() - mark.dataAt);
  if (verboseLogsEnabled()) {
    console.info(`[search] "${query}" data→painted +${renderMs}ms`);
  }
  reportSearchLoad(mark.draft, renderMs);
}

/** Sample, buffer, and beacon one finished search trace. */
function reportSearchLoad(draft: SearchBeaconDraft, renderMs: number | null): void {
  if (typeof window === 'undefined') return;
  sessionSearchCount += 1;
  const payload = {
    kind: 'search',
    qLen: draft.qLen,
    items: draft.items,
    // First search of the page session: cold code path + empty caches.
    cold: sessionSearchCount === 1,
    startedAt: new Date(draft.startedAtEpochMs).toISOString(),
    totalMs: renderMs != null && draft.totalMs != null ? draft.totalMs + renderMs : draft.totalMs,
    debounceMs: draft.debounceMs,
    requestMs: draft.requestMs,
    parseMs: draft.parseMs,
    renderMs,
    serverMs: draft.serverMs,
    serverPath: draft.serverPath,
    edge: draft.edge,
  };
  const w = window as unknown as { __searchLoads?: unknown[] };
  if (!w.__searchLoads) w.__searchLoads = [];
  w.__searchLoads.push(payload);
  if (w.__searchLoads.length > 50) w.__searchLoads.splice(0, w.__searchLoads.length - 50);
  // Volume control: keystrokes fire searches constantly, so only slow ones
  // always beacon; fast ones are sampled for the baseline. Cold (first of
  // session) always beacons — it's the population most worth watching.
  const slow = (payload.totalMs ?? 0) >= SLOW_BEACON_MS;
  const sampled = Math.random() < 1 / FAST_BEACON_SAMPLE;
  if (!payload.cold && !slow && !sampled) return;
  // Fire-and-forget telemetry beacon (see [chart-load]): sendBeacon never
  // blocks rendering or navigation; a string body keeps it a "simple"
  // request (no preflight). Best-effort by design.
  try {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number };
    };
    const url = ingestionApiUrl('/api/telemetry/search-load');
    if (url && typeof nav.sendBeacon === 'function') {
      nav.sendBeacon(
        url,
        JSON.stringify({
          ...payload,
          sampled: !payload.cold && !slow,
          conn: nav.connection?.effectiveType ?? null,
          downlinkMbps: nav.connection?.downlink ?? null,
        }),
      );
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

function countItems(data: unknown): number | string {
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: unknown[] }).items.length;
  }
  return '?';
}

/** "Miss from cloudfront" → "Miss". */
function shortEdge(edge: string): string {
  return edge.split(' ')[0] ?? edge;
}

/** Extract one `name;dur=<ms>` value from a Server-Timing header. */
function serverTimingDur(header: string, name: string): number | null {
  const match = new RegExp(`(?:^|,)\\s*${name};dur=([\\d.]+)`).exec(header);
  return match?.[1] != null ? Math.round(Number(match[1])) : null;
}

/** Serving tier: the first `;desc=` token (`index`, `text`, `cache`…). */
function serverTimingDesc(header: string): string | null {
  return /desc=([^;,\s"]+)/.exec(header)?.[1] ?? null;
}

/** `path;desc=text, pg;dur=45, …` → `path=text pg=45 …`. */
function compactServerTiming(header: string): string {
  if (header === '-') return '-';
  return header
    .split(',')
    .map((part) => {
      const name = part.trim().split(';')[0];
      const desc = /desc=([^;,]+)/.exec(part)?.[1];
      const dur = /dur=([\d.]+)/.exec(part)?.[1];
      return `${name}=${desc ?? dur ?? '?'}`;
    })
    .join(' ');
}

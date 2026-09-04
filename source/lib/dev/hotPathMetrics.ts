/**
 * Dev-only hot-path counters for the Discover live feed / token-hint
 * pipeline. Lets us verify locally (before/after a change) that idle
 * storage writes and token-hint events drop near zero while the live feed
 * keeps streaming.
 *
 * DISABLED BY DEFAULT. Enabled only on the client when `?hotpath=1` is in
 * the URL (persisted to `localStorage['terminal:hotpath']`) or that key is
 * already `'1'`; `?hotpath=0` clears it. When disabled, every public call
 * is a single boolean early-return, so production and normal dev sessions
 * are unaffected and the hot path stays allocation-free.
 *
 * Usage: open `/discover?hotpath=1`, idle, and read the once-per-second
 * `console.table`. Counters are per-second rates; `applyMs` reports the
 * summed + max self-time of the SSE apply loop in that window.
 */

const FLAG_KEY = 'terminal:hotpath';
const REPORT_INTERVAL_MS = 1_000;

type CounterName =
  | 'frames'
  | 'items'
  | 'rememberLiveTokenMint'
  | 'hintStorageWrites'
  | 'tokenHintEvents'
  | 'tradePageHintReactions';

type ByteCounterName = 'hintStorageBytes';

type TimeCounterName = 'applyMs';

interface TimeAccumulator {
  sum: number;
  max: number;
}

let enabled: boolean | null = null;
let reporterStarted = false;
const counters = new Map<string, number>();
const byteCounters = new Map<string, number>();
const timeCounters = new Map<string, TimeAccumulator>();

/**
 * Resolve the flag once and cache it. Reads `?hotpath` first (and persists
 * the choice), then falls back to the stored value. Server-side and
 * storage-restricted contexts resolve to `false`.
 */
function resolveEnabled(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === 'undefined') {
    // Don't memoize on the server: the same module instance is reused
    // across requests in dev, and the client must re-resolve post-hydration.
    return false;
  }
  let result = false;
  try {
    const param = new URLSearchParams(window.location.search).get('hotpath');
    if (param === '1') {
      window.localStorage.setItem(FLAG_KEY, '1');
      result = true;
    } else if (param === '0') {
      window.localStorage.removeItem(FLAG_KEY);
      result = false;
    } else {
      result = window.localStorage.getItem(FLAG_KEY) === '1';
    }
  } catch {
    result = false;
  }
  enabled = result;
  if (result) startReporter();
  return result;
}

export function isHotPathMetricsEnabled(): boolean {
  return resolveEnabled();
}

export function metricCount(name: CounterName, n = 1): void {
  if (!resolveEnabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + n);
}

export function metricBytes(name: ByteCounterName, n: number): void {
  if (!resolveEnabled()) return;
  byteCounters.set(name, (byteCounters.get(name) ?? 0) + n);
}

export function metricTime(name: TimeCounterName, ms: number): void {
  if (!resolveEnabled()) return;
  const prev = timeCounters.get(name);
  if (prev) {
    prev.sum += ms;
    if (ms > prev.max) prev.max = ms;
  } else {
    timeCounters.set(name, { sum: ms, max: ms });
  }
}

function startReporter(): void {
  if (reporterStarted || typeof window === 'undefined') return;
  reporterStarted = true;
  window.setInterval(report, REPORT_INTERVAL_MS);
}

function report(): void {
  const row: Record<string, number | string> = {};
  for (const [name, value] of counters) row[`${name}/s`] = value;
  for (const [name, value] of byteCounters) row[`${name}/s`] = value;
  for (const [name, acc] of timeCounters) {
    row[`${name} sum`] = Number(acc.sum.toFixed(2));
    row[`${name} max`] = Number(acc.max.toFixed(2));
  }
  counters.clear();
  byteCounters.clear();
  timeCounters.clear();

  const heapMB = sampleHeapMB();
  if (heapMB != null) row['heapMB'] = heapMB;
  const domNodes = sampleDomNodes();
  if (domNodes != null) row['domNodes'] = domNodes;

  if (Object.keys(row).length === 0) return;
  // eslint-disable-next-line no-console -- dev-only diagnostic, gated by flag
  console.table({ 'hotpath/1s': row });
}

interface PerformanceMemory {
  usedJSHeapSize?: number;
}

function sampleHeapMB(): number | null {
  if (typeof performance === 'undefined') return null;
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  const used = memory?.usedJSHeapSize;
  if (typeof used !== 'number') return null;
  return Number((used / (1024 * 1024)).toFixed(1));
}

function sampleDomNodes(): number | null {
  if (typeof document === 'undefined') return null;
  try {
    return document.getElementsByTagName('*').length;
  } catch {
    return null;
  }
}

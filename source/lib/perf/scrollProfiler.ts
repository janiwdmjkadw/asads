/**
 * Scroll-burst JS self-profiler — the DevTools-free answer to "what is
 * actually inside a dropped scroll frame?".
 *
 * The perf beacon's other collectors are blind below 50ms (longtask/LoAF
 * thresholds) and blind to non-script main-thread work entirely, which is
 * exactly where sustained 51-57 FPS scrolling lives. Chrome's JS
 * Self-Profiling API (`new Profiler(...)`, requires the
 * `Document-Policy: js-profiling` response header — see next.config.ts)
 * samples this page's main thread from a dedicated profiler thread at
 * ~10ms granularity with negligible overhead.
 *
 * A profiler runs ONLY while the scroll frame sampler is active (same
 * burst lifecycle — zero cost while idle). At burst end the trace is
 * intersected with the window's dropped-frame intervals and reduced to:
 *
 *   - gapJsMs / gapNonJsMs: inside dropped frames, how much time was the
 *     main thread executing JS vs NOT executing JS (GC, style/layout,
 *     paint, raster hand-off, or genuinely starved) — the split that
 *     tells us whether to keep optimizing script or go after the engine
 *     side.
 *   - top leaf functions (by sampled self-time inside dropped frames),
 *     with their script chunk — names are minified in prod but the
 *     chunk + position is enough to attribute.
 *
 * The reduction ships in the beacon as one compact `scrollProf` token
 * string (see formatScrollProf). Unsupported browsers/policies resolve to
 * null once and cost one cached check per burst thereafter.
 */

/** Minimal structural type for the wicg-js-self-profiling trace. */
export interface ProfilerTrace {
  resources: string[];
  frames: Array<{ name: string; resourceId?: number }>;
  stacks: Array<{ frameId: number; parentId?: number }>;
  samples: Array<{ timestamp: number; stackId?: number }>;
}

/** One dropped-frame interval, page-relative ms (from the rAF sampler:
 *  a gap ending at `t` spans [t - gap, t]). */
export interface GapInterval {
  start: number;
  end: number;
}

export interface ScrollProfSummary {
  /** Sampled JS self-time across the whole burst (ms). */
  jsMs: number;
  /** Inside dropped-frame intervals: sampled JS time (ms). */
  gapJsMs: number;
  /** Inside dropped-frame intervals: sampled NON-JS time (ms) — GC,
   *  style/layout/paint, raster hand-off, or a starved main thread. */
  gapNonJsMs: number;
  /** Top leaf functions by self-time inside dropped frames. */
  top: Array<{ name: string; ms: number }>;
}

/** Cap between-sample deltas: a huge delta means the profiler thread was
 *  descheduled (tab hidden etc.), not a 500ms leaf frame. */
const MAX_SAMPLE_DELTA_MS = 40;
const TOP_KEEP = 6;

/** Leaf-frame label: `fnName@chunk.js` (chunk basename only). */
function leafLabel(trace: ProfilerTrace, stackId: number): string {
  const stack = trace.stacks[stackId];
  if (!stack) return '?';
  const frame = trace.frames[stack.frameId];
  if (!frame) return '?';
  const name = frame.name || 'anon';
  const resource =
    frame.resourceId !== undefined ? (trace.resources[frame.resourceId] ?? '') : '';
  const chunk = resource.split('?')[0]?.split('/').pop() ?? '';
  // `name(chunk)` — stays inside the ingestion beacon_str charset
  // allowlist (alnum plus -_/:.,() ), unlike name@chunk.
  return chunk ? `${name}(${chunk.slice(0, 40)})` : name;
}

function insideAnyGap(t: number, gaps: readonly GapInterval[]): boolean {
  for (const gap of gaps) {
    if (t >= gap.start && t <= gap.end) return true;
  }
  return false;
}

/** Reduce one trace against the window's dropped-frame intervals. Pure. */
export function summarizeTrace(
  trace: ProfilerTrace,
  gaps: readonly GapInterval[],
  sampleIntervalMs: number,
): ScrollProfSummary {
  let jsMs = 0;
  let gapJsMs = 0;
  let gapNonJsMs = 0;
  const topMs = new Map<string, number>();
  let prevTimestamp: number | null = null;
  for (const sample of trace.samples) {
    const delta =
      prevTimestamp === null
        ? sampleIntervalMs
        : Math.min(sample.timestamp - prevTimestamp, MAX_SAMPLE_DELTA_MS);
    prevTimestamp = sample.timestamp;
    if (delta <= 0) continue;
    const hasJs = sample.stackId !== undefined;
    if (hasJs) jsMs += delta;
    if (!insideAnyGap(sample.timestamp, gaps)) continue;
    if (hasJs) {
      gapJsMs += delta;
      const label = leafLabel(trace, sample.stackId as number);
      topMs.set(label, (topMs.get(label) ?? 0) + delta);
    } else {
      gapNonJsMs += delta;
    }
  }
  return {
    jsMs: Math.round(jsMs),
    gapJsMs: Math.round(gapJsMs),
    gapNonJsMs: Math.round(gapNonJsMs),
    top: [...topMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_KEEP)
      .map(([name, ms]) => ({ name, ms: Math.round(ms) })),
  };
}

/** Accumulate burst summaries into one per-window aggregate. */
export function mergeSummaries(into: ScrollProfSummary, add: ScrollProfSummary): void {
  into.jsMs += add.jsMs;
  into.gapJsMs += add.gapJsMs;
  into.gapNonJsMs += add.gapNonJsMs;
  const topMs = new Map<string, number>(into.top.map((t) => [t.name, t.ms]));
  for (const t of add.top) topMs.set(t.name, (topMs.get(t.name) ?? 0) + t.ms);
  into.top = [...topMs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEEP)
    .map(([name, ms]) => ({ name, ms }));
}

export function emptySummary(): ScrollProfSummary {
  return { jsMs: 0, gapJsMs: 0, gapNonJsMs: 0, top: [] };
}

/** Compact beacon token: `js:..,gapJs:..,gapNonJs:../leaf:ms,leaf:ms`.
 *  Head/top separated by `/`; every character sits inside the ingestion
 *  beacon_str sanitizer allowlist so the token survives verbatim. Empty
 *  string when the burst never profiled (unsupported/no scroll). */
export function formatScrollProf(s: ScrollProfSummary): string {
  if (s.jsMs === 0 && s.gapJsMs === 0 && s.gapNonJsMs === 0) return '';
  const head = `js:${s.jsMs},gapJs:${s.gapJsMs},gapNonJs:${s.gapNonJsMs}`;
  const top = s.top.map((t) => `${t.name}:${t.ms}`).join(',');
  return (top ? `${head}/${top}` : head).slice(0, 480);
}

interface ProfilerCtor {
  new (options: { sampleInterval: number; maxBufferSize: number }): {
    stop(): Promise<ProfilerTrace>;
    sampleInterval: number;
  };
}

const SAMPLE_INTERVAL_MS = 10;
/** ~2.5 minutes of continuous scrolling at 10ms — bursts are seconds. */
const MAX_BUFFER_SAMPLES = 15_000;

/** null = checked and unavailable (API missing or document policy absent). */
let profilerSupported: boolean | null = null;

export interface BurstProfiler {
  /** Stop sampling and reduce against the dropped-frame intervals seen
   *  during the burst. Resolves null when the trace is unusable. */
  stop(gaps: readonly GapInterval[]): Promise<ScrollProfSummary | null>;
}

/** Start sampling the main thread for one scroll burst. Returns null when
 *  the API is unavailable (verdict cached after the first attempt). */
export function startBurstProfiler(): BurstProfiler | null {
  if (profilerSupported === false) return null;
  const Ctor = (globalThis as { Profiler?: ProfilerCtor }).Profiler;
  if (typeof Ctor !== 'function') {
    profilerSupported = false;
    return null;
  }
  try {
    const profiler = new Ctor({
      sampleInterval: SAMPLE_INTERVAL_MS,
      maxBufferSize: MAX_BUFFER_SAMPLES,
    });
    profilerSupported = true;
    return {
      async stop(gaps) {
        try {
          const trace = await profiler.stop();
          return summarizeTrace(trace, gaps, profiler.sampleInterval || SAMPLE_INTERVAL_MS);
        } catch {
          return null;
        }
      },
    };
  } catch {
    // Constructor throws when the js-profiling document policy is absent.
    profilerSupported = false;
    return null;
  }
}

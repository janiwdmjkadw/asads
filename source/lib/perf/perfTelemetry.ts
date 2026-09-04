/**
 * Site-wide frontend performance telemetry — the DevTools-free answer to
 * "is the main thread clogged, by what, and how bad is memory?". Same
 * methodology as the [search-load] / [chart-load] beacons: browser-side
 * PerformanceObservers aggregate into a window, one sampled sendBeacon per
 * window POSTs to /telemetry/perf, and the daemon emits ONE greppable
 * [perf-beacon] journald line. No storage, no DB — journald is the sink.
 *
 * What each window (30s foreground) captures:
 * - Long tasks (>50ms main-thread blocks): count, total ms, worst ms.
 *   This is the exact "JavaScript queue" number — any timer/fetch/input
 *   handled during one of these waited that long.
 * - Long animation frames (Chrome): same blocks but WITH attribution —
 *   the top offending script (source URL + ms) per window, so a clogged
 *   thread names the code responsible.
 * - Event timing: worst input→next-paint latency (INP-style) and the
 *   event type, i.e. how sluggish interaction actually felt.
 * - JS heap (Chrome `performance.memory`): used/limit MB at window close,
 *   plus the delta since the previous window (leak signal when it only
 *   ever grows).
 * - Context: page path (route shape only), window length, whether the tab
 *   was visible the whole window.
 *
 * Volume policy: one beacon per window at most, and quiet windows (no long
 * tasks, no slow interactions) only report 1-in-6 as a healthy baseline.
 * Final window flushes on pagehide. All fire-and-forget; failures drop
 * silently.
 *
 * Every beacon also carries correlation + context fields:
 * - sid: random per-page-load session id, so one user's windows chain
 *   together across a session.
 * - build: the deployed git sha (NEXT_PUBLIC_BUILD_SHA), so regressions
 *   pin to the exact deploy that introduced them.
 * - dev/cores/memGb/dpr/vw/vh/touch/conn: device class and capability,
 *   so "is it slow" separates into "slow on what hardware".
 * - frames: the individual dropped scroll frames ("tMs:gapMs" tokens),
 *   i.e. the user's actual frame history while scrolling, not just
 *   window totals. `nowMs` anchors those page-relative times to the
 *   server's receive clock.
 */

import { ingestionApiUrl } from '@/lib/api/ingestion';
import {
  emptySummary,
  formatScrollProf,
  mergeSummaries,
  startBurstProfiler,
  type BurstProfiler,
  type ScrollProfSummary,
} from './scrollProfiler';

const WINDOW_MS = 30_000;
/** Quiet windows (nothing slow happened) sample 1-in-N for the baseline. */
const QUIET_SAMPLE = 6;
/** A window is "interesting" (always beacons) past any of these. */
const INTERESTING_LONGTASK_TOTAL_MS = 200;
const INTERESTING_WORST_EVENT_MS = 200;
const INTERESTING_SCROLL_FPS = 55;

/** One slow frame, kept for the per-task breakdown: start time (page-
 *  relative ms, correlates with `frames` tokens), total duration, how
 *  much was script vs style/layout, and the top script + invoker. */
interface SlowFrame {
  t: number;
  dur: number;
  scriptMs: number;
  layoutMs: number;
  top: string;
}

/** One dropped scroll frame: page-relative time and the rAF gap in ms. */
export interface DroppedFrame {
  t: number;
  gap: number;
}

export interface PerfWindow {
  startedAt: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskWorstMs: number;
  /** Blocking ms per script source (from long-animation-frame entries). */
  scriptBlameMs: Map<string, number>;
  /** Worst individual frames (bounded), for the task-level breakdown. */
  slowFrames: SlowFrame[];
  worstEventMs: number;
  worstEventType: string;
  /** Scroll-time frame stats (rAF gaps sampled only while scrolling):
   *  the direct "FPS drops while scrolling" measurement. */
  scrollFrames: number;
  scrollDroppedFrames: number;
  scrollWorstGapMs: number;
  /** Total sampled scroll time (sum of all rAF gaps): with scrollFrames
   *  this yields effective scroll FPS, the number an on-screen FPS meter
   *  shows. Headline hitch metrics ignore the 25-50ms band entirely, so
   *  sustained 51-57 FPS scrolling was recorded but invisible — these
   *  fields make it first-class. */
  scrollTimeMs: number;
  /** Dropped-gap histogram: (25,50] single/double frame slips, (50,100]
   *  multi-frame stumbles, >100 user-visible hitches. Sums to
   *  scrollDroppedFrames. */
  scrollGap25: number;
  scrollGap50: number;
  scrollGap100: number;
  /** Individual dropped scroll frames (bounded): the per-frame history. */
  droppedFrames: DroppedFrame[];
  /** Scroll-burst self-profiler aggregate: JS vs non-JS time inside
   *  dropped frames + top leaf functions (see scrollProfiler.ts). */
  scrollProf: ScrollProfSummary;
  hidden: boolean;
}

/** Frames below this aren't individually itemized (still counted in totals). */
const SLOW_FRAME_MIN_MS = 50;
const SLOW_FRAME_KEEP = 5;
/** Dropped-frame history cap per window: 60 tokens ≈ 700 bytes worst case. */
const DROPPED_FRAME_KEEP = 60;

/** Random per-page-load id — chains one user's windows into a session. */
const SESSION_ID = Math.random().toString(36).slice(2, 10);

interface ChromeMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

let current: PerfWindow | null = null;
let flushTimer: number | null = null;
let lastHeapUsedMb: number | null = null;
let windowSeq = 0;
let started = false;

export function startPerfTelemetry(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return;
  }
  started = true;
  current = newWindow();

  observe('longtask', (entries) => {
    const w = current;
    if (!w) return;
    for (const entry of entries) {
      w.longTaskCount += 1;
      w.longTaskTotalMs += entry.duration;
      w.longTaskWorstMs = Math.max(w.longTaskWorstMs, entry.duration);
    }
  });

  // Long animation frames: Chrome 123+. Script attribution turns "the
  // thread was blocked" into "THIS file blocked it".
  observe('long-animation-frame', (entries) => {
    const w = current;
    if (!w) return;
    for (const entry of entries) {
      const loaf = entry as unknown as {
        duration: number;
        styleAndLayoutDuration?: number;
        scripts?: LoafScript[];
      };
      const scripts = loaf.scripts ?? [];
      let frameScriptMs = 0;
      let topScript: LoafScript | null = null;
      for (const script of scripts) {
        const src = shortScriptSource(script);
        if (!src) continue;
        const ms = script.duration ?? 0;
        frameScriptMs += ms;
        if (topScript == null || ms > (topScript.duration ?? 0)) topScript = script;
        w.scriptBlameMs.set(src, (w.scriptBlameMs.get(src) ?? 0) + ms);
      }
      // Itemize the worst frames so the beacon carries a task-level
      // breakdown, not just window totals: total / script / style+layout
      // split plus the dominant script's source AND invoker (the function
      // or listener that ran, e.g. "1222-xxx.js.EventSource.onmessage").
      if (loaf.duration >= SLOW_FRAME_MIN_MS) {
        const frame: SlowFrame = {
          t: Math.round(entry.startTime),
          dur: Math.round(loaf.duration),
          scriptMs: Math.round(frameScriptMs),
          layoutMs: Math.round(loaf.styleAndLayoutDuration ?? 0),
          top: topScript ? `${shortScriptSource(topScript) ?? '?'}.${invokerName(topScript)}` : '?',
        };
        w.slowFrames.push(frame);
        if (w.slowFrames.length > SLOW_FRAME_KEEP) {
          w.slowFrames.sort((a, b) => b.dur - a.dur);
          w.slowFrames.length = SLOW_FRAME_KEEP;
        }
      }
    }
  });

  observe(
    'event',
    (entries) => {
      const w = current;
      if (!w) return;
      for (const entry of entries) {
        if (entry.duration > w.worstEventMs) {
          w.worstEventMs = entry.duration;
          w.worstEventType = entry.name;
        }
      }
    },
    // Only interactions >=100ms are worth attributing (default is 104).
    { durationThreshold: 100 },
  );

  startScrollFrameSampler();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Tab going to background: flush what we have (last chance to send),
      // and mark the next window as background-tainted.
      flushWindow('pagehide');
    } else if (current) {
      current.hidden = true;
    }
  });
  scheduleFlush();
}

function newWindow(): PerfWindow {
  return {
    startedAt: performance.now(),
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longTaskWorstMs: 0,
    scriptBlameMs: new Map(),
    slowFrames: [],
    worstEventMs: 0,
    worstEventType: '',
    scrollFrames: 0,
    scrollDroppedFrames: 0,
    scrollWorstGapMs: 0,
    scrollTimeMs: 0,
    scrollGap25: 0,
    scrollGap50: 0,
    scrollGap100: 0,
    droppedFrames: [],
    scrollProf: emptySummary(),
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
  };
}

/** A frame gap past this missed at least one 60Hz frame (with jitter room). */
const SCROLL_DROPPED_GAP_MS = 25;
/** How long after the last scroll event the sampler keeps running. */
const SCROLL_SAMPLE_TAIL_MS = 100;
/** Gaps past this are tab freezes/suspends, not rendering jank — rAF stops
 *  entirely in background tabs, so counting the resume gap fabricated
 *  absurd "worst gap" values (96s was observed). Discard, don't record. */
const SCROLL_GAP_SUSPEND_MS = 10_000;

/** Fold one scroll-time rAF gap into the window: totals, worst, and the
 *  bounded per-frame history. Pure — exported for tests. */
export function recordScrollGap(w: PerfWindow, frameAt: number, gap: number): void {
  if (gap > SCROLL_GAP_SUSPEND_MS) return;
  w.scrollFrames += 1;
  w.scrollTimeMs += gap;
  if (gap > SCROLL_DROPPED_GAP_MS) {
    w.scrollDroppedFrames += 1;
    if (gap > 100) w.scrollGap100 += 1;
    else if (gap > 50) w.scrollGap50 += 1;
    else w.scrollGap25 += 1;
    if (w.droppedFrames.length < DROPPED_FRAME_KEEP) {
      w.droppedFrames.push({ t: Math.round(frameAt), gap: Math.round(gap) });
    }
  }
  if (gap > w.scrollWorstGapMs) w.scrollWorstGapMs = gap;
}

/** Effective scroll FPS — what an on-screen FPS meter reads while the
 *  user scrolls. 0 when there was no meaningful scrolling. Pure. */
export function effectiveScrollFps(w: Pick<PerfWindow, 'scrollFrames' | 'scrollTimeMs'>): number {
  if (w.scrollTimeMs <= 0) return 0;
  return Math.round((w.scrollFrames / w.scrollTimeMs) * 1000 * 10) / 10;
}

/** Compact "tMs:gapMs" tokens — the frame history the beacon ships. */
export function formatDroppedFrames(frames: DroppedFrame[]): string {
  return frames.map((f) => `${f.t}:${f.gap}`).join(',');
}

/**
 * Scroll-time frame sampler: a rAF loop that runs ONLY while the user is
 * scrolling (any element — capture-phase listener) and records inter-frame
 * gaps into the current window. Answers "how many frames drop while
 * scrolling" directly, where long tasks/LoAF only catch the >50ms cases.
 * Idle cost is zero: no scroll events, no rAF loop.
 */
function startScrollFrameSampler(): void {
  let activeUntil = 0;
  let rafId: number | null = null;
  let lastFrameAt = 0;
  let profiler: BurstProfiler | null = null;
  /** Dropped-frame intervals of THIS burst — the window's own history is
   *  capped/reset independently, so the profiler keeps its own list. */
  let burstGaps: Array<{ start: number; end: number }> = [];

  const endBurst = () => {
    if (profiler === null) return;
    const p = profiler;
    const gaps = burstGaps;
    profiler = null;
    burstGaps = [];
    void p.stop(gaps).then((summary) => {
      // Attribute to whichever window is current when the trace resolves
      // (bursts spanning a flush skew by at most one burst — acceptable).
      if (summary !== null && current) mergeSummaries(current.scrollProf, summary);
    });
  };

  const onFrame = (frameAt: number) => {
    const w = current;
    if (lastFrameAt > 0) {
      const gap = frameAt - lastFrameAt;
      if (w) recordScrollGap(w, frameAt, gap);
      if (gap > SCROLL_DROPPED_GAP_MS && gap <= SCROLL_GAP_SUSPEND_MS) {
        burstGaps.push({ start: frameAt - gap, end: frameAt });
      }
    }
    lastFrameAt = frameAt;
    if (performance.now() < activeUntil) {
      rafId = requestAnimationFrame(onFrame);
    } else {
      rafId = null;
      lastFrameAt = 0;
      endBurst();
    }
  };
  window.addEventListener(
    'scroll',
    () => {
      activeUntil = performance.now() + SCROLL_SAMPLE_TAIL_MS;
      if (rafId == null) {
        rafId = requestAnimationFrame(onFrame);
        if (profiler === null) profiler = startBurstProfiler();
      }
    },
    { capture: true, passive: true },
  );
}

function scheduleFlush(): void {
  if (flushTimer != null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => flushWindow('interval'), WINDOW_MS);
}

function flushWindow(reason: 'interval' | 'pagehide'): void {
  const w = current;
  current = newWindow();
  if (reason === 'interval') scheduleFlush();
  if (!w) return;
  const windowMs = Math.round(performance.now() - w.startedAt);
  if (windowMs < 1_000) return; // pagehide right after a flush: nothing meaningful

  const memory = (performance as unknown as { memory?: ChromeMemory }).memory;
  const heapUsedMb = memory ? Math.round(memory.usedJSHeapSize / 1_048_576) : null;
  const heapLimitMb = memory ? Math.round(memory.jsHeapSizeLimit / 1_048_576) : null;
  const heapDeltaMb =
    heapUsedMb != null && lastHeapUsedMb != null ? heapUsedMb - lastHeapUsedMb : null;
  if (heapUsedMb != null) lastHeapUsedMb = heapUsedMb;

  windowSeq += 1;
  const scrollFps = effectiveScrollFps(w);
  const interesting =
    w.longTaskTotalMs >= INTERESTING_LONGTASK_TOTAL_MS ||
    w.worstEventMs >= INTERESTING_WORST_EVENT_MS ||
    w.scrollWorstGapMs >= 100 ||
    // Sustained sub-55 FPS scrolling (>=1s sampled): the "meter dips to
    // 51" band that individual-hitch gates never catch.
    (w.scrollTimeMs >= 1_000 && scrollFps > 0 && scrollFps < INTERESTING_SCROLL_FPS) ||
    (heapDeltaMb ?? 0) >= 50;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  const payload = {
    kind: 'perf',
    sid: SESSION_ID,
    build: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
    seq: windowSeq,
    page: routeShape(window.location.pathname),
    windowMs,
    reason,
    hidden: w.hidden,
    // Wall-clock at flush: anchors the page-relative `frames`/`tasks`
    // times to an absolute clock for cross-session history queries.
    nowMs: Date.now(),
    // Device class: separates "the code got slower" from "slower devices
    // showed up". Coarse tokens only — no full UA string.
    ua: uaShort(navigator.userAgent),
    cores: nav.hardwareConcurrency ?? 0,
    memGb: nav.deviceMemory ?? 0,
    dpr: Math.round(window.devicePixelRatio * 100) / 100,
    vw: window.innerWidth,
    vh: window.innerHeight,
    touch: (nav.maxTouchPoints ?? 0) > 0,
    conn: nav.connection?.effectiveType ?? '',
    longTasks: w.longTaskCount,
    longTaskTotalMs: Math.round(w.longTaskTotalMs),
    longTaskWorstMs: Math.round(w.longTaskWorstMs),
    blame: topBlame(w.scriptBlameMs, 3),
    // Worst individual frames: "t:dur(js/layout)source.invoker" per task.
    // The leading t (page-relative ms) lines these up against `frames`.
    tasks: w.slowFrames
      .sort((a, b) => b.dur - a.dur)
      .map((f) => `${f.t}:${f.dur}(${f.scriptMs}/${f.layoutMs})${f.top}`)
      .join(','),
    worstEventMs: Math.round(w.worstEventMs),
    worstEventType: w.worstEventType,
    scrollFrames: w.scrollFrames,
    scrollDroppedFrames: w.scrollDroppedFrames,
    scrollWorstGapMs: Math.round(w.scrollWorstGapMs),
    scrollTimeMs: Math.round(w.scrollTimeMs),
    scrollGap25: w.scrollGap25,
    scrollGap50: w.scrollGap50,
    scrollGap100: w.scrollGap100,
    scrollFps,
    // Self-profiler split of dropped scroll frames: JS(+top functions)
    // vs non-JS engine time — see scrollProfiler.ts.
    scrollProf: formatScrollProf(w.scrollProf),
    // Per-frame history: every dropped scroll frame this window as
    // "tMs:gapMs" tokens (bounded) — the direct answer to "show me the
    // user's frames as they scrolled".
    frames: formatDroppedFrames(w.droppedFrames),
    heapUsedMb,
    heapLimitMb,
    heapDeltaMb,
    interesting,
  };

  const global = window as unknown as { __perfWindows?: unknown[] };
  if (!global.__perfWindows) global.__perfWindows = [];
  global.__perfWindows.push(payload);
  if (global.__perfWindows.length > 40) {
    global.__perfWindows.splice(0, global.__perfWindows.length - 40);
  }

  if (!interesting && windowSeq % QUIET_SAMPLE !== 1) return;
  try {
    const url = ingestionApiUrl('/api/telemetry/perf');
    if (url && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, JSON.stringify(payload));
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

interface LoafScript {
  duration?: number;
  sourceURL?: string;
  invokerType?: string;
  invoker?: string;
}

/** Top-N blocking scripts as "chunk.js:123ms" style compact tokens. */
function topBlame(blame: Map<string, number>, n: number): string {
  return [...blame.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([src, ms]) => `${src}:${Math.round(ms)}`)
    .join(',');
}

/** Last path segment of the script URL — enough to find the chunk without
 *  shipping full URLs into logs. */
function shortScriptSource(script: LoafScript): string | null {
  const raw = script.sourceURL || script.invoker || script.invokerType || '';
  if (!raw) return null;
  const cleaned = raw.split('?')[0] ?? raw;
  const segment = cleaned.split('/').pop() ?? cleaned;
  return segment.slice(0, 48) || null;
}

/** The function/listener that ran, e.g. "EventSource.onmessage" or
 *  "TimerHandler" — the piece that turns a chunk name into a lead. */
function invokerName(script: LoafScript): string {
  const raw = script.invoker || script.invokerType || '';
  // Invoker can itself be a URL (script blocks); keep only symbol-ish ones.
  if (!raw || raw.includes('/')) return script.invokerType?.slice(0, 32) ?? '?';
  return raw.slice(0, 40);
}

/** Coarse OS+browser token like "mac/chrome138" or "ios/safari17" —
 *  enough to split perf by platform without shipping full UA strings. */
export function uaShort(ua: string): string {
  const os = /iphone|ipad|ipod/i.test(ua)
    ? 'ios'
    : /android/i.test(ua)
      ? 'android'
      : /mac os x/i.test(ua)
        ? 'mac'
        : /windows/i.test(ua)
          ? 'win'
          : /linux/i.test(ua)
            ? 'linux'
            : 'other';
  let browser = 'other';
  let match: RegExpExecArray | null;
  if ((match = /edg\/(\d+)/i.exec(ua))) browser = `edge${match[1]}`;
  else if ((match = /chrome\/(\d+)/i.exec(ua))) browser = `chrome${match[1]}`;
  else if ((match = /firefox\/(\d+)/i.exec(ua))) browser = `firefox${match[1]}`;
  else if ((match = /version\/(\d+).*safari/i.exec(ua))) browser = `safari${match[1]}`;
  return `${os}/${browser}`;
}

/** Collapse dynamic segments so pages group: /trade/<mint> → /trade/:mint. */
function routeShape(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (segment.length >= 30 ? ':mint' : segment))
    .join('/')
    .slice(0, 64);
}

function observe(
  type: string,
  handler: (entries: PerformanceEntry[]) => void,
  extra?: Record<string, unknown>,
): void {
  try {
    const observer = new PerformanceObserver((list) => handler(list.getEntries()));
    observer.observe({ type, buffered: false, ...extra } as PerformanceObserverInit);
  } catch {
    // Entry type unsupported in this browser — skip silently.
  }
}

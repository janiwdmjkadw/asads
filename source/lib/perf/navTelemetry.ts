'use client';

/**
 * Per-navigation latency telemetry — the field version of the perf-harness
 * latency waterfall. Every in-app route transition (Discover→Trade card
 * click, Trade→Discover nav tab, back/forward, programmatic pushes) emits
 * ONE `[nav-beacon]` journald line with a ms-level stage breakdown:
 *
 *   input → navAccepted   main-thread queue delay before the click handler
 *                         ran (a clogged thread shows up HERE first)
 *   navAccepted → push    router work until the URL committed
 *   push → paint          first frame of the destination route painted
 *   paint → ready         destination-specific readiness (see READY_MARKS):
 *                         Trade = chart shows real candles; Discover = the
 *                         persistent pane re-activated. Routes without a
 *                         readiness mark are "ready" at paint.
 *
 * plus long-task totals *during* the navigation window, so a slow stage is
 * immediately attributable to main-thread blocking vs network/render.
 *
 * Cost discipline (this must never add the delays it measures): capture
 * listeners only store a timestamp; stage sources are the performance.mark
 * calls the app already makes (observed via PerformanceObserver, off the
 * hot path); the paint probe is a double-rAF that only runs while a
 * navigation is in flight; delivery is one fire-and-forget sendBeacon per
 * navigation (navigations are user-paced — no sampling needed).
 *
 * The pure state machine (`NavTraceMachine`) is separated from the DOM glue
 * (`startNavTelemetry`) so the stage logic is unit-testable without a
 * browser (same pattern as discover/deltaWire.ts).
 */

import { ingestionApiUrl } from '@/lib/api/ingestion';
import { feedApplyCount } from '@/lib/perf/navActivity';
import { TERMINAL_NAVIGATE_EVENT } from '@/lib/navigation-events';

export type NavTrigger = 'click' | 'key' | 'pop' | 'program';

export interface NavTraceReport {
  kind: 'nav';
  /** Route shapes (dynamic segments collapsed), never raw mints. */
  from: string;
  to: string;
  trigger: NavTrigger;
  /** t0 (input or nav accept) → ready. */
  totalMs: number;
  inputToNavMs: number | null;
  navToPushMs: number | null;
  pushToPaintMs: number | null;
  paintToReadyMs: number | null;
  /** Which signal closed the trace: a mark name, 'paint', or 'none'. */
  readyMark: string;
  /** Long-task blocking observed while the navigation was in flight. */
  blockedMs: number;
  blockedWorstMs: number;
  longTasks: number;
  /** Trace closed by the 10s backstop instead of a readiness signal. */
  timeout: boolean;
  /** A newer navigation started before this one finished. */
  superseded: boolean;
  hidden: boolean;
  /** Time spent on the origin page before this navigation (last route
   *  commit → t0). Diagnoses prefetch staleness: Next expires router
   *  prefetches after ~30s, so slow navToPush clustering at dwell > 30s
   *  implicates an on-navigation RSC refetch. */
  dwellMs: number;
  /** Duration of the destination's RSC payload fetch observed during the
   *  navigation window (null = served from the router cache, no network).
   *  Splits navToPush: network wait (rscMs ≈ navToPush) vs client-side
   *  transition render (no fetch, or rscMs << navToPush). */
  rscMs: number | null;
  /** Stage decomposition of that fetch as "dns/connect/ttfb/download" in ms
   *  (connect includes TLS; 0/0 = reused connection). Distinguishes a cold
   *  connection re-handshake from origin/server wait on slow fetches. */
  rscDetail: string | null;
  /** Accumulated event-loop lag (timer drift) during the trace. Long tasks
   *  only see >=50ms blocks; this catches the death-by-a-thousand-cuts case
   *  — many sub-50ms tasks starving the transition (blockedMs ~0 but lagMs
   *  large). Sampled ~16ms only while a trace is open; hidden-tab throttled
   *  intervals are excluded. */
  lagMs: number;
  /** Static asset (script/css chunk) fetches that started inside the trace
   *  window: count + total wall ms. A cold code-split route chunk load
   *  hides inside navToPush with nothing else attributing it. */
  chunkMs: number;
  chunks: number;
  /** Feed-store snapshot applies that ran during the trace (both Discover
   *  stores). High applies + low blockedMs = sub-threshold feed churn
   *  interrupting the transition render. */
  applies: number;
}

/** Destination-specific readiness marks (any one closes the trace). These
 *  are marks the app ALREADY emits — navTelemetry adds no new mark sites. */
function readyMarksFor(path: string): string[] {
  if (path.startsWith('/trade/')) return ['trade:chart-first-data'];
  if (path.startsWith('/discover')) return ['discover:pane-active', 'discover:first-frame'];
  if (path.startsWith('/tracker') || path.startsWith('/portfolio') || path.startsWith('/rewards')) {
    return ['tab:pane-active'];
  }
  return [];
}

/** Input older than this is unrelated to the navigation (hover dwell etc.). */
const INPUT_ATTRIBUTION_MS = 3_000;
/** Backstop: a trace that never reaches readiness still reports. */
const TRACE_TIMEOUT_MS = 10_000;

interface ActiveTrace {
  from: string;
  to: string;
  /** Raw destination pathname (unshaped) — matches RSC fetch URLs. */
  toPath: string;
  trigger: NavTrigger;
  t0: number;
  navAt: number | null;
  pushAt: number | null;
  paintAt: number | null;
  readyMarks: string[];
  blockedMs: number;
  blockedWorstMs: number;
  longTasks: number;
  hidden: boolean;
  dwellMs: number;
  rscMs: number | null;
  rscDetail: string | null;
  lagMs: number;
  chunkMs: number;
  chunks: number;
  /** Feed-apply counter value at trace start (delta computed at finalize). */
  appliesAt0: number;
  cancelTimeout: () => void;
}

export interface NavTraceMachineOptions {
  emit(report: NavTraceReport): void;
  now(): number;
  /** Route shape of the CURRENT location (called at trace start). */
  currentPage(): string;
  /** Collapse a destination href to its route shape. */
  pageShape(href: string): string;
  /** Monotonic feed-apply counter (see lib/perf/navActivity). Snapshot at
   *  trace start, delta reported at finalize. Defaults to 0 (applies=0). */
  activityCount?(): number;
  /** Test seam; defaults to setTimeout. Returns a cancel function. */
  schedule?(fn: () => void, ms: number): () => void;
}

export class NavTraceMachine {
  private trace: ActiveTrace | null = null;
  private lastInputAt: number | null = null;
  private lastInputType: 'click' | 'key' = 'click';
  /** When the user arrived on the current page (construction = page load;
   *  updated at every route commit). Feeds the dwellMs field. */
  private pageArrivedAt: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly options: NavTraceMachineOptions) {
    this.pageArrivedAt = options.now();
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
  }

  /** pointerdown/keydown, capture phase: just a timestamp. */
  onInput(type: 'click' | 'key'): void {
    this.lastInputAt = this.options.now();
    this.lastInputType = type;
  }

  /** TERMINAL_NAVIGATE_EVENT: the app accepted a navigation to `href`. */
  onNavigate(href: string): void {
    const now = this.options.now();
    this.begin(this.options.pageShape(href), now, { navAt: now, toPath: pathOf(href) });
  }

  /** URL committed (pushState patch or popstate). `fromPath` is the
   *  pre-commit location — at commit time `location.pathname` has already
   *  flipped to the destination, so the glue must carry the origin. */
  onRouteCommit(path: string, viaPop: boolean, fromPath?: string): void {
    const now = this.options.now();
    const to = this.options.pageShape(path);
    const trace = this.trace;
    if (trace && trace.pushAt === null && (trace.to === to || !viaPop)) {
      // The commit for the in-flight navigation. Non-pop commits adopt the
      // committed path even if it differs from the accepted href (redirects).
      trace.to = to;
      trace.toPath = path;
      trace.pushAt = now;
      trace.readyMarks = readyMarksFor(path);
      this.pageArrivedAt = now;
      return;
    }
    // No pending trace (browser back/forward, programmatic push): start one
    // here; the commit itself is t=0 unless recent input explains it.
    this.begin(to, now, { pushAt: now, viaPop, path, fromPath, toPath: path });
  }

  /** An RSC payload fetch observed by the glue's resource observer. Only
   *  a fetch for the in-flight destination that started inside the trace
   *  window counts — it IS the network wait inside navToPush. */
  onRscFetch(pathname: string, startedAt: number, durationMs: number, detail?: string): void {
    const trace = this.trace;
    if (!trace || pathname !== trace.toPath) return;
    if (startedAt < trace.t0 - 50) return; // pre-click prefetch, not this nav
    trace.rscMs = Math.round(durationMs);
    trace.rscDetail = detail ?? null;
  }

  /** A static script/css chunk fetch that started inside the trace window
   *  (code-split route chunks — otherwise invisible inside navToPush). */
  onChunkFetch(startedAt: number, durationMs: number): void {
    const trace = this.trace;
    if (!trace || startedAt < trace.t0 - 50) return;
    trace.chunks += 1;
    trace.chunkMs += durationMs;
  }

  /** One event-loop lag sample from the glue's during-trace interval:
   *  observed drift past the expected tick spacing. */
  onLagSample(driftMs: number): void {
    const trace = this.trace;
    if (!trace || driftMs <= 0) return;
    trace.lagMs += driftMs;
  }

  /** Glue's lag sampler keys its lifetime off this. */
  hasActiveTrace(): boolean {
    return this.trace !== null;
  }

  /** First frame after the route commit painted (glue's double-rAF). */
  onPaint(): void {
    const trace = this.trace;
    if (!trace || trace.pushAt === null || trace.paintAt !== null) return;
    trace.paintAt = this.options.now();
    if (trace.readyMarks.length === 0) this.finalize('paint', false);
  }

  /** Any performance.mark the glue's observer sees. `at` is the mark's own
   *  startTime — observer delivery lags on a blocked main thread, and the
   *  mark time is the truthful stage end. */
  onMark(name: string, at?: number): void {
    const trace = this.trace;
    if (!trace || trace.pushAt === null) return;
    if (trace.readyMarks.includes(name)) this.finalize(name, false, false, at);
  }

  onLongTask(durationMs: number): void {
    const trace = this.trace;
    if (!trace) return;
    trace.longTasks += 1;
    trace.blockedMs += durationMs;
    trace.blockedWorstMs = Math.max(trace.blockedWorstMs, durationMs);
  }

  onHidden(): void {
    if (this.trace) this.trace.hidden = true;
  }

  private begin(
    to: string,
    now: number,
    seed: {
      navAt?: number;
      pushAt?: number;
      viaPop?: boolean;
      path?: string;
      fromPath?: string;
      toPath?: string;
    },
  ): void {
    if (this.trace) this.finalizeAsSuperseded();
    const inputRecent = this.lastInputAt !== null && now - this.lastInputAt <= INPUT_ATTRIBUTION_MS;
    const t0 = inputRecent ? (this.lastInputAt as number) : now;
    const trigger: NavTrigger = seed.viaPop ? 'pop' : inputRecent ? this.lastInputType : 'program';
    this.lastInputAt = null; // one navigation per input
    const dwellMs = Math.max(0, Math.round(t0 - this.pageArrivedAt));
    // A begin() that carries the commit (popstate path) IS the arrival on
    // the destination; dwell above was measured against the old page.
    if (seed.pushAt !== undefined) this.pageArrivedAt = seed.pushAt;
    const trace: ActiveTrace = {
      from:
        seed.fromPath !== undefined
          ? this.options.pageShape(seed.fromPath)
          : this.options.currentPage(),
      to,
      toPath: seed.toPath ?? '',
      trigger,
      t0,
      navAt: seed.navAt ?? null,
      pushAt: seed.pushAt ?? null,
      paintAt: null,
      readyMarks: seed.path !== undefined ? readyMarksFor(seed.path) : [],
      blockedMs: 0,
      blockedWorstMs: 0,
      longTasks: 0,
      hidden: false,
      dwellMs,
      rscMs: null,
      rscDetail: null,
      lagMs: 0,
      chunkMs: 0,
      chunks: 0,
      appliesAt0: this.options.activityCount?.() ?? 0,
      cancelTimeout: () => {},
    };
    trace.cancelTimeout = this.schedule(() => this.finalize('none', true), TRACE_TIMEOUT_MS);
    this.trace = trace;
  }

  private finalizeAsSuperseded(): void {
    this.finalize('none', false, true);
  }

  private finalize(readyMark: string, timeout: boolean, superseded = false, endAt?: number): void {
    const trace = this.trace;
    if (!trace) return;
    this.trace = null;
    trace.cancelTimeout();
    const now = endAt ?? this.options.now();
    const rel = (t: number | null): number | null =>
      t === null ? null : Math.max(0, Math.round(t - trace.t0));
    const stageDelta = (a: number | null, b: number | null): number | null =>
      a === null || b === null ? null : Math.max(0, Math.round(b - a));
    this.options.emit({
      kind: 'nav',
      from: trace.from,
      to: trace.to,
      trigger: trace.trigger,
      totalMs: Math.max(0, Math.round(now - trace.t0)),
      inputToNavMs: rel(trace.navAt),
      navToPushMs: stageDelta(trace.navAt, trace.pushAt),
      pushToPaintMs: stageDelta(trace.pushAt, trace.paintAt),
      paintToReadyMs:
        readyMark === 'none' || readyMark === 'paint'
          ? null
          : stageDelta(trace.paintAt ?? trace.pushAt, now),
      readyMark,
      blockedMs: Math.round(trace.blockedMs),
      blockedWorstMs: Math.round(trace.blockedWorstMs),
      longTasks: trace.longTasks,
      timeout,
      superseded,
      hidden: trace.hidden,
      dwellMs: trace.dwellMs,
      rscMs: trace.rscMs,
      rscDetail: trace.rscDetail,
      lagMs: Math.round(trace.lagMs),
      chunkMs: Math.round(trace.chunkMs),
      chunks: trace.chunks,
      applies: Math.max(0, (this.options.activityCount?.() ?? 0) - trace.appliesAt0),
    });
  }
}

/** Path portion of an href (no query/hash). */
export function pathOf(href: string): string {
  return href.split('?')[0]?.split('#')[0] ?? href;
}

// ---------------------------------------------------------------------------
// DOM glue

let started = false;

/** Collapse dynamic segments so pages group: /trade/<mint> → /trade/:mint. */
function routeShape(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (segment.length >= 30 ? ':mint' : segment))
    .join('/')
    .slice(0, 64);
}

function pageShapeFromHref(href: string): string {
  const path = href.split('?')[0]?.split('#')[0] ?? href;
  return routeShape(path);
}

function sendNavBeacon(report: NavTraceReport): void {
  const global = window as unknown as { __navLoads?: unknown[] };
  if (!global.__navLoads) global.__navLoads = [];
  global.__navLoads.push(report);
  if (global.__navLoads.length > 50) {
    global.__navLoads.splice(0, global.__navLoads.length - 50);
  }
  try {
    const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
    const url = ingestionApiUrl('/api/telemetry/perf');
    if (url && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        url,
        JSON.stringify({ ...report, conn: nav.connection?.effectiveType ?? null }),
      );
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

/**
 * Start site-wide navigation telemetry. Idempotent; called once from
 * Providers next to startPerfTelemetry, so every page is covered.
 */
export function startNavTelemetry(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return;
  }
  started = true;

  const machine = new NavTraceMachine({
    emit: sendNavBeacon,
    now: () => performance.now(),
    currentPage: () => routeShape(window.location.pathname),
    pageShape: pageShapeFromHref,
    activityCount: feedApplyCount,
  });

  // Event-loop lag sampler: a ~16ms interval that runs ONLY while a trace
  // is open (self-stops otherwise), accumulating drift past the expected
  // spacing. Catches sub-50ms churn that long tasks can't see. Hidden tabs
  // throttle timers to >=1s ticks — those samples are skipped (the trace
  // already carries `hidden`).
  const LAG_TICK_MS = 16;
  let lagTimer: ReturnType<typeof setInterval> | null = null;
  let lastTickAt = 0;
  const stopLagSampler = () => {
    if (lagTimer !== null) clearInterval(lagTimer);
    lagTimer = null;
  };
  const startLagSampler = () => {
    if (lagTimer !== null) return;
    lastTickAt = performance.now();
    lagTimer = setInterval(() => {
      const now = performance.now();
      const drift = now - lastTickAt - LAG_TICK_MS;
      lastTickAt = now;
      if (!machine.hasActiveTrace()) {
        stopLagSampler();
        return;
      }
      // Background-tab timer throttling produces ~1s ticks that are not
      // main-thread contention — don't count them as lag.
      if (!document.hidden && drift < 900) machine.onLagSample(drift);
    }, LAG_TICK_MS);
  };

  window.addEventListener('pointerdown', () => machine.onInput('click'), {
    capture: true,
    passive: true,
  });
  window.addEventListener('keydown', () => machine.onInput('key'), {
    capture: true,
    passive: true,
  });

  // The app's navigation bridge event (card clicks, nav tabs) — marks the
  // moment the click handler accepted the navigation.
  window.addEventListener(TERMINAL_NAVIGATE_EVENT, (event) => {
    const href = (event as CustomEvent<{ href?: string }>).detail?.href;
    if (href) {
      machine.onNavigate(href);
      startLagSampler();
    }
  });

  // URL commits: Next's router uses history.pushState under the hood.
  const schedulePaintProbe = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => machine.onPaint()));
  };
  // At commit time location.pathname is already the destination — the
  // origin page must come from the tracked previous path.
  const onCommit = (viaPop: boolean, fromPath: string) => {
    machine.onRouteCommit(window.location.pathname, viaPop, fromPath);
    startLagSampler();
    schedulePaintProbe();
  };
  let lastPath = window.location.pathname;
  const patchHistory = (method: 'pushState' | 'replaceState') => {
    const original = history[method].bind(history);
    history[method] = ((...args: Parameters<History['pushState']>) => {
      const result = original(...args);
      try {
        if (window.location.pathname !== lastPath) {
          const fromPath = lastPath;
          lastPath = window.location.pathname;
          onCommit(false, fromPath);
        }
      } catch {
        // Observation only — never interfere with the navigation itself.
      }
      return result;
    }) as History['pushState'];
  };
  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', () => {
    if (window.location.pathname === lastPath) return;
    const fromPath = lastPath;
    lastPath = window.location.pathname;
    onCommit(true, fromPath);
  });

  // Readiness marks the app already emits (chart first data, pane actives).
  try {
    const markObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) machine.onMark(entry.name, entry.startTime);
    });
    markObserver.observe({ type: 'mark', buffered: false });
  } catch {
    // 'mark' observation unsupported — traces close via paint/timeout.
  }

  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) machine.onLongTask(entry.duration);
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
  } catch {
    // Long-task observation unsupported — blockedMs stays 0.
  }

  // RSC payload fetches (Next tags them with a `_rsc` query param). Feeding
  // these to the machine splits navToPush into network wait vs client work,
  // and the stage decomposition (same-origin, so full timing is exposed)
  // separates cold-connection re-handshakes from origin/server wait.
  try {
    const resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Code-split chunk loads (script/css) started inside the trace —
        // a cold route chunk otherwise hides inside navToPush.
        if (entry.name.includes('/_next/static/')) {
          machine.onChunkFetch(entry.startTime, entry.duration);
          continue;
        }
        if (!entry.name.includes('_rsc=')) continue;
        try {
          const url = new URL(entry.name);
          const r = entry as PerformanceResourceTiming;
          const ms = (a: number, b: number) => Math.max(0, Math.round(b - a));
          // dns/connect(incl TLS)/ttfb/download; zeros for a reused
          // connection. Slash-separated to survive the daemon's char filter.
          const detail =
            r.requestStart > 0
              ? [
                  ms(r.domainLookupStart, r.domainLookupEnd),
                  ms(r.connectStart, r.connectEnd),
                  ms(r.requestStart, r.responseStart),
                  ms(r.responseStart, r.responseEnd),
                ].join('/')
              : undefined;
          machine.onRscFetch(url.pathname, entry.startTime, entry.duration, detail);
        } catch {
          // Unparseable URL — skip.
        }
      }
    });
    resourceObserver.observe({ type: 'resource', buffered: false });
  } catch {
    // Resource observation unsupported — rscMs stays null.
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') machine.onHidden();
  });
}

'use client';

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import type { SpotPerfPoint, SpotRange } from '@/lib/api/portfolio-performance';
import { formatUsdFull } from './format';

/**
 * Slice "Portfolio Spot tab": bespoke SVG performance chart.
 *
 * Pure React + SVG. No third-party charting library (and therefore no
 * vendor watermark). Design beats:
 *
 *   - cyan → purple gradient line stroke at 1.75px, capped + joined
 *     for that liquid Apple-Stocks feel
 *   - matching area gradient that softly fades from 38 % to 0 % alpha
 *   - dotted horizontal gridlines (5 ticks) drawn behind, so the
 *     numbers always stay readable even on dark surface
 *   - smart time axis: each range picks its own tick density and
 *     label format
 *   - floating crosshair with frosted-glass readout that snaps to the
 *     nearest point — the readout repositions to stay inside the
 *     panel, and the value label flips above/below the marker so it
 *     never escapes the viewport
 *   - "tracking since" + range-summary captions overlaid in the
 *     corners so the chart never looks empty, even with one point
 *
 * Range-aware:
 *   1d  → "h a"  (e.g. "2 PM") with hourly tick spacing
 *   30d → "MMM d" with ~6 ticks across
 *   90d → "MMM d" with ~5 ticks across
 *   max → "MMM yyyy" / "MMM d" depending on span
 */

/* `stop-color` transitions, so crossing the break-even point while
   scrubbing fades the chart from red to green instead of cutting. */
const TONE_EASE: CSSProperties = { transition: 'stop-color 260ms ease' };

interface Props {
  readonly points: ReadonlyArray<SpotPerfPoint>;
  readonly range: SpotRange;
  readonly partial: boolean;
  readonly trackingStartedMs: number | null;
  /** True while a single wallet is filtered — tunes the empty copy. */
  readonly walletFiltered?: boolean;
  readonly className?: string;
}

interface NormalizedPoint {
  readonly t: number; // ms
  readonly v: number;
}

interface ChartLayout {
  readonly w: number;
  readonly h: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

const TARGET_TICKS = 5;

export function PerformanceChart(props: Props): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track the wrap container size. We avoid lightweight-charts'
  // observer pattern and use a simple ResizeObserver because we only
  // need to re-render an SVG.
  useLayoutEffect(() => {
    if (!wrapRef.current) return undefined;
    const el = wrapRef.current;
    const apply = (): void => {
      // offsetWidth/Height are layout px (immune to the low-DPI page zoom);
      // getBoundingClientRect returns zoom-multiplied px, which would size
      // the SVG larger than its wrap on scaled screens.
      setSize({
        w: Math.max(0, el.offsetWidth),
        h: Math.max(0, el.offsetHeight),
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo<ReadonlyArray<NormalizedPoint>>(() => {
    const seen = new Set<number>();
    const out: NormalizedPoint[] = [];
    for (const p of props.points) {
      if (!Number.isFinite(p.t_ms) || !Number.isFinite(p.total_usd)) continue;
      if (seen.has(p.t_ms)) continue;
      seen.add(p.t_ms);
      out.push({ t: p.t_ms, v: p.total_usd });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [props.points]);

  // Layout numbers — padding is tight on the left so the gradient
  // reaches the panel edge. The y-axis labels sit inside the chart
  // body, top-right aligned, in muted ink.
  // padRight reserves a dedicated right-hand gutter for the y-axis
  // price labels. The plotted series (and therefore the line's last
  // point + the "now" beacon) map into [padLeft, w - padRight], so they
  // stay clear of the labels living in that gutter — no overlap ever.
  const layout: ChartLayout = useMemo(
    () => ({
      w: size.w,
      h: size.h,
      padLeft: 14,
      padRight: 58,
      padTop: 18,
      padBottom: 22,
    }),
    [size],
  );

  // y-domain with a soft 6 % top headroom so the line never kisses
  // the panel border.
  const { minV, maxV } = useMemo(() => {
    if (data.length === 0) return { minV: 0, maxV: 1 };
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of data) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    if (lo === hi) {
      const pad = Math.max(1, Math.abs(lo) * 0.08);
      return { minV: lo - pad, maxV: hi + pad };
    }
    const headroom = (hi - lo) * 0.08;
    return { minV: Math.max(0, lo - headroom), maxV: hi + headroom };
  }, [data]);

  const minT = data[0]?.t ?? Date.now() - 24 * 60 * 60 * 1000;
  const maxT = data[data.length - 1]?.t ?? Date.now();

  const x = useCallback(
    (t: number): number => {
      const innerW = Math.max(1, layout.w - layout.padLeft - layout.padRight);
      const span = Math.max(1, maxT - minT);
      return layout.padLeft + ((t - minT) / span) * innerW;
    },
    [layout, minT, maxT],
  );
  const y = useCallback(
    (v: number): number => {
      const innerH = Math.max(1, layout.h - layout.padTop - layout.padBottom);
      const span = Math.max(1e-9, maxV - minV);
      return layout.padTop + (1 - (v - minV) / span) * innerH;
    },
    [layout, minV, maxV],
  );

  // SVG path: a Catmull-Rom-to-Bezier smoothing pass. Subtle smoothing
  // keeps the curve organic without overshoot for sparse data.
  const linePath = useMemo(
    () => smoothPath(data, x, y),
    [data, x, y],
  );
  const areaPath = useMemo(() => {
    if (linePath === '' || data.length === 0) return '';
    const baseline = layout.h - layout.padBottom;
    const first = data[0]!;
    const last = data[data.length - 1]!;
    return `${linePath} L ${x(last.t).toFixed(2)} ${baseline.toFixed(2)} L ${x(first.t).toFixed(2)} ${baseline.toFixed(2)} Z`;
  }, [linePath, data, layout, x]);

  const yTicks = useMemo(() => {
    if (data.length === 0) return [] as Array<{ v: number; y: number }>;
    const n = 4;
    const span = maxV - minV;
    const step = span / n;
    return Array.from({ length: n + 1 }, (_, i) => {
      const v = minV + step * i;
      return { v, y: y(v) };
    });
  }, [data, minV, maxV, y]);

  const xTicks = useMemo(() => {
    if (data.length === 0) return [] as Array<{ t: number; x: number; label: string }>;
    const targets = TARGET_TICKS;
    const out: Array<{ t: number; x: number; label: string }> = [];
    for (let i = 0; i <= targets; i += 1) {
      const t = minT + ((maxT - minT) * i) / targets;
      out.push({ t, x: x(t), label: formatTick(t, props.range, maxT - minT) });
    }
    return out;
  }, [data, minT, maxT, props.range, x]);

  // Hover state. We snap to the nearest point so the floating label
  // always sits on a real datum.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (data.length === 0) {
        setHoverIdx(null);
        return;
      }
      const svg = e.currentTarget;
      const r = svg.getBoundingClientRect();
      // rect and clientX are zoom-multiplied px; x() yields SVG-local px.
      // Normalize by the rendered width so the low-DPI page zoom cancels.
      const cx = ((e.clientX - r.left) / r.width) * size.w;
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < data.length; i += 1) {
        const px = x(data[i]!.t);
        const d = Math.abs(px - cx);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      setHoverIdx(bestIdx);
    },
    [data, x, size.w],
  );
  const onPointerLeave = useCallback(() => setHoverIdx(null), []);

  const hoverPoint =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.length
      ? data[hoverIdx]
      : null;

  const empty = data.length === 0;
  const headerValue = hoverPoint?.v ?? data[data.length - 1]?.v ?? null;
  const headerTimestamp = hoverPoint?.t ?? data[data.length - 1]?.t ?? null;

  // Floating readout: parked top-left by default, but while hovering it
  // glides to follow the crosshair so the value sits right next to the
  // point you're inspecting. Centered on the point (translateX(-50%)),
  // clamped inside the panel, and flipped below the point when there's
  // no room above.
  const readoutFloat = hoverPoint
    ? (() => {
        const hx = x(hoverPoint.t);
        const hy = y(hoverPoint.v);
        const halfW = 108;
        const left = Math.max(
          halfW + 8,
          Math.min(layout.w - halfW - 8, hx),
        );
        const placeAbove = hy - 46 > layout.padTop;
        const top = placeAbove ? hy - 46 : hy + 18;
        return { left, top };
      })()
    : null;

  const trend =
    data.length >= 2 ? Math.sign(data[data.length - 1]!.v - data[0]!.v) : 0;

  /*
   * ── THE LINE IS THE COLOUR OF THE ANSWER ──────────────────────────
   *
   * Green if you are up over the range, red if you are down, white if
   * it did not move. The stroke, the wash under it, the crosshair and
   * both markers all take it, so the chart reads before it is read.
   *
   * ── AND IT FOLLOWS THE POINTER ────────────────────────────────────
   *
   * The comparison is always against the FIRST point in the range, not
   * against the point before the one you are on. Scrubbing back to a
   * moment when you were down turns the whole chart red, and forward
   * into profit turns it green, because at that moment "am I up" had a
   * different answer — which is the question the colour answers.
   *
   * Point to point would be a different chart entirely: it would flip
   * on every wiggle and tell you the slope of one step rather than
   * where you stand.
   *
   * ── WHY THERE IS A DEAD BAND ──────────────────────────────────────
   *
   * `flat` is not `delta === 0`, which essentially never happens on a
   * float. Anything inside five hundredths of a percent of where you
   * started is white, so a book that has not really moved does not sit
   * there glowing red over a rounding error.
   *
   * ── AND WHY IT IS `--up` / `--down` ───────────────────────────────
   *
   * These are the product's own gain and loss tokens, already on every
   * figure in the header above this chart, so the line agrees with the
   * number it is a picture of. This is the one place on the page where
   * a hue IS the meaning rather than decoration — the opposite of the
   * wallet switch two tabs over, which went white for exactly that
   * reason.
   */
  const FLAT_BAND = 0.0005;
  const baseline = data.length > 0 ? data[0]!.v : null;
  const reference = hoverPoint?.v ?? data[data.length - 1]?.v ?? null;

  const tone: 'up' | 'down' | 'flat' = (() => {
    if (baseline === null || reference === null || data.length < 2) return 'flat';
    const delta = reference - baseline;
    const band = Math.abs(baseline) > 0 ? Math.abs(baseline) * FLAT_BAND : 0.01;
    if (delta > band) return 'up';
    if (delta < -band) return 'down';
    return 'flat';
  })();

  const ink = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--d-performancechart-1, #0b0e14)';

  /* The wash is a floor for the line, not a colour for the page — and
     over paper it takes far less to be one. At 12% into 3.5% the green
     read as a field the chart was standing in; these numbers put the
     tint just past the point where you would call it white, and it is
     gone by the middle of the pane rather than lingering to the axis. */
  const washTop = tone === 'flat' ? 0.07 : 0.08;
  const washMid = tone === 'flat' ? 0.015 : 0.018;

  // Re-key the draw-in animation whenever the series identity changes
  // (range switch or fresh data) so the line re-draws itself.
  const drawKey = `${props.range}:${data.length}:${data[0]?.t ?? 0}:${
    data[data.length - 1]?.t ?? 0
  }`;
  const lastPoint = data.length > 0 ? data[data.length - 1]! : null;

  return (
    <div
      ref={wrapRef}
      className={props.className ?? ''}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Backdrop glow — subtle, gives the chart depth and that
          "Apple-iWork" gloss against the panel background. */}
      <div aria-hidden style={backdropGlowStyle} />

      <svg
        role="img"
        aria-label="Portfolio performance over time"
        width={layout.w}
        height={layout.h}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <defs>
          {/* Kept as a gradient with one colour in it rather than
              swapped for a flat stroke: every `stroke="url(#spot-line)"`
              in this file goes on pointing at the same id.

              `stop-color` is a transitionable property, so easing it
              here is what makes the chart CHANGE colour as you scrub
              across the point where you broke even, rather than
              snapping between two charts. */}
          <linearGradient id="spot-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={ink} style={TONE_EASE} stopOpacity="0.92" />
            <stop offset="100%" stopColor={ink} style={TONE_EASE} stopOpacity="0.92" />
          </linearGradient>
          <linearGradient id="spot-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ink} style={TONE_EASE} stopOpacity={washTop} />
            <stop offset="46%" stopColor={ink} style={TONE_EASE} stopOpacity={washMid} />
            <stop offset="100%" stopColor={ink} style={TONE_EASE} stopOpacity="0" />
          </linearGradient>
          <filter id="spot-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
        </defs>

        {/* y-axis dotted gridlines + right-aligned price labels */}
        {!empty
          ? yTicks.map((tick, i) => (
              <g key={`y-${i}`}>
                <line
                  x1={layout.padLeft}
                  x2={layout.w - layout.padRight}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--d-performancechart-2, rgba(11, 14, 20, 0.07))"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
                <text
                  x={layout.w - 6}
                  y={tick.y - 4}
                  textAnchor="end"
                  fontFamily="var(--sans)"
                  fontSize={10}
                  fill="var(--ink-3)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatYTick(tick.v)}
                </text>
              </g>
            ))
          : null}

        {/* x-axis tick labels along the bottom */}
        {!empty
          ? xTicks.map((tick, i) => (
              <text
                key={`x-${i}`}
                x={tick.x}
                y={layout.h - 6}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                fontFamily="var(--sans)"
                fontSize={10}
                fill="var(--ink-3)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {tick.label}
              </text>
            ))
          : null}

        {/* area gradient under the line — fades in on (re)draw */}
        {!empty ? (
          <path
            key={`area-${drawKey}`}
            d={areaPath}
            fill="url(#spot-area)"
            className="spot-area-in"
          />
        ) : null}

        {/*
          * ── NO GLOW UNDER THE LINE ──────────────────────────────────
          *
          * There was a 3.5px gaussian blurred copy of the path at 45%
          * beneath the stroke. On a dark panel that is how a thin line
          * gets presence; over paper it is a green haze following every
          * move the line makes, and it is the single thing that made
          * this chart look processed rather than drawn.
          *
          * The stroke carries itself now. `spot-glow` stays defined —
          * nothing else uses it, but it costs nothing and it is the
          * thing to reach for if the dark theme comes back.
          */}
        {/* primary line — draws itself in on mount / range change */}
        {!empty ? (
          <path
            key={`line-${drawKey}`}
            d={linePath}
            pathLength={1}
            fill="none"
            stroke="url(#spot-line)"
            /* 1.9, from 1.75. With the bloom gone the stroke is doing
               all the work on its own, and a hair more weight is what
               keeps it as present as it was — without the halo. */
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="spot-line-draw"
          />
        ) : null}

        {/* "now" pulse — always-on beacon at the latest point, hidden
            while the user is crosshairing so the two never collide. */}
        {lastPoint && !hoverPoint ? (
          <g pointerEvents="none">
            <circle
              cx={x(lastPoint.t)}
              cy={y(lastPoint.v)}
              r={3}
              fill="none"
              stroke={ink}
              strokeOpacity={0.7}
              strokeWidth={1.25}
              className="spot-now-ripple"
            />
            <circle
              cx={x(lastPoint.t)}
              cy={y(lastPoint.v)}
              r={3.25}
              fill={ink}
              fillOpacity={0.9}
              className="spot-now-core"
            />
            <circle
              cx={x(lastPoint.t)}
              cy={y(lastPoint.v)}
              r={1.4}
              fill="var(--ink-0)"
            />
          </g>
        ) : null}

        {/* crosshair + hovered point marker
            Pulses constantly and slowly: two staggered ripple rings
            emanate outward, a halo breathes in/out, and the core stroke
            drifts between cyan and purple — all on long ~3.6s / 7.2s
            cycles so it feels meta-spatial, never twitchy. */}
        {hoverPoint ? (
          <g pointerEvents="none">
            <line
              x1={x(hoverPoint.t)}
              x2={x(hoverPoint.t)}
              y1={layout.padTop}
              y2={layout.h - layout.padBottom}
              stroke={ink}
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            {/*
              * ── THE MARKER IS A DOT ────────────────────────────────
              *
              * It was four stacked circles: two ripple rings expanding
              * on staggered 3.6s cycles in opposite hues, a halo
              * breathing under them, and a core whose stroke drifted
              * between cyan and purple on a 7.2s loop. Five animations
              * on the thing that follows your cursor, on a chart you
              * are reading numbers off.
              *
              * One white dot with a ring. It is where the pointer is.
              */}
            <circle
              cx={x(hoverPoint.t)}
              cy={y(hoverPoint.v)}
              r={4}
              fill={ink}
              /* A ring of the page's own ground, not a lighter version
                 of the dot. On a coloured line a translucent ring just
                 makes the dot look blurred; one in the page's own paper
                 cuts it out of the stroke it is sitting on. */
              stroke="var(--d-performancechart-3, #ffffff)"
              strokeWidth={1.5}
            />
          </g>
        ) : null}
      </svg>

      <style>{MARKER_PULSE_CSS}</style>

      {/*
        * ── THE PARKED READOUT IS GONE ────────────────────────────────
        *
        * A chip sat at the top left of the chart at all times reading
        * the last value and the word `now` — the same figure as the
        * hero total two inches above it, in a smaller box, with a
        * different label. Two copies of one number on one screen, and
        * the smaller copy was the one with a border round it.
        *
        * It only appears under the pointer now, where it is answering a
        * question: what was it worth THEN. That is the one reading the
        * page does not already give you.
        */}
      {readoutFloat && headerValue !== null ? (
        <div
          className="spot-readout-float"
          style={{
            ...readoutBaseStyle,
            left: readoutFloat.left,
            top: readoutFloat.top,
            transform: 'translateX(-50%)',
            transition:
              'left 90ms var(--ease-out, ease), top 90ms var(--ease-out, ease)',
            borderColor: 'color-mix(in srgb, var(--ink-0) 22%, var(--hairline))',
          }}
        >
          <span style={readoutValueStyle}>{formatUsdFull(headerValue)}</span>
          {headerTimestamp !== null ? (
            <span style={readoutTimeStyle}>
              {formatHoverTime(headerTimestamp, props.range)}
            </span>
          ) : null}
        </div>
      ) : null}

      {props.partial ? (
        <div aria-label="History backfill in progress" style={partialChipStyle}>
          <span style={pulseDotStyle} />
          filling history…
        </div>
      ) : null}

      {empty ? (
        <div style={emptyStateStyle}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            {props.walletFiltered
              ? 'This wallet starts recording history now.'
              : 'History is building from your on-chain activity.'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
            {props.walletFiltered
              ? 'Per-wallet history accrues from this point — check back shortly.'
              : props.trackingStartedMs == null
                ? 'Initial backfill runs once when you open this tab.'
                : `Tracking since ${new Date(props.trackingStartedMs).toLocaleDateString()}.`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// -------- helpers ------------------------------------------------------

/**
 * Catmull-Rom → cubic-Bezier smoothing. Tension 0.5 gives a gentle
 * Apple Stocks-style curve. Returns "" when fewer than 2 points so
 * the area-path math can early-out.
 */
function smoothPath(
  data: ReadonlyArray<NormalizedPoint>,
  px: (t: number) => number,
  py: (v: number) => number,
): string {
  if (data.length === 0) return '';
  if (data.length === 1) {
    const p = data[0]!;
    const cx = px(p.t).toFixed(2);
    const cy = py(p.v).toFixed(2);
    // Render a tiny horizontal stub so the user still sees the line.
    return `M ${cx} ${cy} L ${(Number(cx) + 1).toFixed(2)} ${cy}`;
  }
  const pts = data.map((p) => ({ x: px(p.t), y: py(p.v) }));
  let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const t = 0.5;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * t * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * t * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * t * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * t * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function formatYTick(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function formatTick(tMs: number, range: SpotRange, spanMs: number): string {
  const d = new Date(tMs);
  if (range === '1d' || spanMs <= 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric' });
  }
  if (range === '30d' || spanMs <= 30 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (range === '90d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  // max: month/year for >180d spans, otherwise month/day
  if (spanMs > 180 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * ── THE READOUT SHOWS A DATE. NEVER A TIME. ──────────────────────────
 *
 * The first pass at this kept the clock on `1d` on the theory that
 * intraday buckets make it the whole answer. They do not here: every
 * point in the series carries the same time of day, so `1d` read
 * `12:53 PM` wherever you put the pointer — the exact stuck figure this
 * was meant to remove, left in the one range nobody had checked.
 *
 * A date on every range. `range` stays in the signature because the day
 * a real intraday series exists this is the one line that has to know
 * about it.
 */
function formatHoverTime(tMs: number, _range: SpotRange): string {
  return new Date(tMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


// -------- pulse animation (scoped CSS, theme-reactive) ---------------

/**
 * Keyframes for the hover marker. We use CSS (not SMIL) so that fills
 * and strokes interpolate through the live theme variables — when the
 * user switches themes, the pulse colors shift with them.
 *
 * ── THE HOVER MARKER'S ANIMATIONS ARE GONE ───────────────────────────
 *
 * There were four of them on the dot that follows your cursor: two
 * ripple rings expanding on staggered 3.6s cycles, a halo breathing on
 * 5.4s, and a 7.2s hue drift between cyan and purple applied to both
 * the fill and the stroke. The marker is one white dot now, so
 * `spot-marker-*` has nothing left to animate and the keyframes went
 * with it.
 *
 * What is still here animates something a reader actually asked for:
 * the line unspooling on a range change, and the beacon on the live
 * edge saying the series is current.
 *
 * `transform-box: fill-box` + `transform-origin: center` lets us scale
 * each circle around its own center inside the SVG coordinate system.
 */
const MARKER_PULSE_CSS = `
/* Line draw-in: the stroke unspools from left to right on mount and on
   every range change. pathLength={1} normalizes the dash math so the
   timing is identical regardless of the curve's true length. */
@keyframes spot-line-draw {
  from { stroke-dashoffset: 1; }
  to   { stroke-dashoffset: 0; }
}
.spot-line-draw {
  stroke-dasharray: 1 1;
  animation: spot-line-draw 1100ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
@keyframes spot-area-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.spot-area-in {
  animation: spot-area-in 1100ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

/* "Now" beacon — a slow ripple ring + a gently breathing core that
   sits on the live edge of the line so the chart always feels awake. */
@keyframes spot-now-ripple {
  0%   { transform: scale(1); opacity: 0.5; }
  80%  { opacity: 0; }
  100% { transform: scale(2); opacity: 0; }
}
@keyframes spot-now-breathe {
  0%, 100% { opacity: 0.95; }
  50%      { opacity: 0.55; }
}
.spot-now-ripple {
  transform-box: fill-box;
  transform-origin: center;
  animation: spot-now-ripple 3s ease-out infinite;
  will-change: transform, opacity;
}
.spot-now-core {
  animation: spot-now-breathe 3s ease-in-out infinite;
}

/*
 * The floating readout. It carried an accent halo that BREATHED on a
 * 2.4s loop while it tracked the pointer — a light source pulsing under
 * a box of digits you are trying to read, in the one hue this page no
 * longer has. One drop, no animation, no glow.
 */
.spot-readout-float {
  box-shadow: 0 10px 26px -14px rgba(11, 14, 20, 0.3);
}

@media (prefers-reduced-motion: reduce) {
  .spot-now-ripple,
  .spot-now-core { animation: none; }
  .spot-line-draw { stroke-dasharray: none; animation: none; }
  .spot-area-in { opacity: 1; animation: none; }
}
`;

// -------- styles -------------------------------------------------------

const backdropGlowStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  /* Was a 14% accent radial washing up from the bottom of the panel —
     a coloured light behind the chart, on a page that now has one ink
     scale. Ink at 3.5%, which still gives the line something to sit
     against without tinting it. */
  background:
    'radial-gradient(120% 60% at 50% 110%, var(--d-performancechart-4, rgba(11, 14, 20, 0.022)) 0%, transparent 70%)',
  opacity: 1,
};

// Base readout chrome (no position — the caller places it: parked
// top-left by default, or following the crosshair while hovering).
const readoutBaseStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 7,
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '4px 10px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  background: 'color-mix(in srgb, var(--surface-1) 78%, transparent)',
  border: '1px solid var(--hairline)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  fontFamily: 'var(--sans)',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};

const readoutValueStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink-0)',
};

const readoutTimeStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--ink-3)',
  letterSpacing: '0.02em',
};

const partialChipStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 14,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--surface-1) 70%, transparent)',
  border: '1px solid var(--hairline)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  color: 'var(--ink-3)',
  fontSize: 10,
};

const pulseDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'var(--d-performancechart-5, rgba(11, 14, 20, 0.7))',
};

const emptyStateStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 16,
  pointerEvents: 'none',
};

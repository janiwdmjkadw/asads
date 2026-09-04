'use client';

import { useEffect, useMemo, useState } from 'react';

import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import {
  EVM_PERFORMANCE_RANGES,
  fetchEvmPerformance,
  type EvmPerformancePoint,
  type EvmPerformanceRange,
  type EvmPerformanceResult,
} from '@/lib/api/evm-performance';
import type { EvmPortfolioChain } from '@/lib/api/evm-positions';
import { formatBigIntUnits, parseWireSigned } from '@/lib/evm/money';

const RANGE_LABELS: Record<EvmPerformanceRange, string> = {
  '1d': '1D',
  '30d': '30D',
  '90d': '90D',
  max: 'MAX',
};

export function EvmPerformancePanel({ chain }: { readonly chain: EvmPortfolioChain }) {
  const [range, setRange] = useState<EvmPerformanceRange>('30d');
  const [result, setResult] = useState<EvmPerformanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const { isLoaded, isSignedIn } = useSeededAuth();

  useEffect(() => {
    if (!isLoaded || isSignedIn !== true) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchEvmPerformance({ chain, range }, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setResult(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [chain, isLoaded, isSignedIn, range]);

  return (
    <section className="panel portfolio-panel mb-3 overflow-hidden" aria-label="EVM spot performance">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Performance</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Chain-scoped, as-observed USD snapshots. Tracking starts when this feature records its first sample.
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Performance range">
          {EVM_PERFORMANCE_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              className={`rounded px-2.5 py-1 text-[10px] font-semibold ${
                range === value
                  ? 'bg-[var(--ink-0)] text-[var(--surface-0)]'
                  : 'bg-[var(--input-bg)] text-muted-foreground'
              }`}
              onClick={() => setRange(value)}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <EvmPerformanceView result={result} loading={loading} />
    </section>
  );
}

export function EvmPerformanceView({
  result,
  loading,
}: {
  readonly result: EvmPerformanceResult | null;
  readonly loading: boolean;
}) {
  const plot = useMemo(
    () => result?.kind === 'ok' ? buildPlot(result.points) : null,
    [result],
  );
  if (loading) {
    return <p className="p-4 text-xs text-muted-foreground">Loading performance history...</p>;
  }
  if (result === null) {
    return <p className="p-4 text-xs text-muted-foreground">Sign in to read performance history.</p>;
  }
  if (result.kind !== 'ok') {
    const detail = result.kind === 'error'
      ? result.errorCode
      : result.kind === 'reauth'
        ? result.reason
        : result.kind === 'shape_mismatch'
          ? result.reason
          : result.reason;
    return (
      <p className="p-4 text-xs text-amber-600" role="status">
        Performance history is unavailable ({detail}). This is not a zero-value result.
      </p>
    );
  }

  const last = result.points.at(-1) ?? null;
  const valueComplete = last !== null && last.valueMeasuredCount === last.positionCount;
  const pnlComplete = last !== null && last.pnlMeasuredCount === last.positionCount;
  const valueText = last === null ? null : exactUsd(last.measuredValueUsdAtto);
  const pnlText = last === null ? null : exactUsd(last.measuredUnrealizedPnlUsdAtto);
  const changeText = exactUsd(result.changeValueUsdAtto);
  const pnlChangeText = exactUsd(result.changeUnrealizedPnlUsdAtto);
  const reasons = [...new Set(result.points.flatMap((point) => point.unavailableReasons))];

  return (
    <div className="p-4" data-testid="evm-performance-series">
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <PerformanceMetric
          label={valueComplete ? 'Current value' : 'Measured value subtotal'}
          value={valueText ?? 'Unavailable'}
          note={last === null ? 'No observations' : `${last.valueMeasuredCount}/${last.positionCount} positions measured`}
        />
        <PerformanceMetric
          label={pnlComplete ? 'Unrealized PnL' : 'Measured PnL subtotal'}
          value={pnlText ?? 'Unavailable'}
          note={last === null ? 'No observations' : `${last.pnlMeasuredCount}/${last.positionCount} positions measured`}
        />
        <PerformanceMetric label="Value change" value={changeText ?? 'Unavailable'} note="Complete endpoints only" />
        <PerformanceMetric label="PnL change" value={pnlChangeText ?? 'Unavailable'} note="Complete endpoints only" />
      </div>

      {plot === null ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-[var(--hairline)] bg-[var(--input-bg)] px-4 text-center text-xs text-muted-foreground">
          {result.points.length === 0
            ? 'No observations in this range yet.'
            : 'No fully measured observations are available to plot.'}
        </div>
      ) : (
        <div className="relative h-56 rounded-lg border border-[var(--hairline)] bg-[var(--input-bg)] p-2">
          <svg
            className="h-full w-full"
            viewBox="0 0 1000 220"
            preserveAspectRatio="none"
            role="img"
            aria-label="Exact EVM portfolio value history; incomplete observations appear as gaps"
          >
            <defs>
              <linearGradient id="evm-performance-stroke" x1="0" x2="1">
                <stop offset="0%" stopColor="var(--accent-primary)" />
                <stop offset="100%" stopColor="var(--accent-secondary)" />
              </linearGradient>
            </defs>
            {[25, 75, 125, 175].map((y) => (
              <line key={y} x1="18" x2="982" y1={y} y2={y} stroke="var(--hairline)" strokeDasharray="3 6" />
            ))}
            {plot.segments.map((segment, index) => segment.length === 1 ? (
              <circle key={index} cx={segment[0]!.x} cy={segment[0]!.y} r="3" fill="var(--accent-primary)" />
            ) : (
              <polyline
                key={index}
                points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke="url(#evm-performance-stroke)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <span className="absolute left-3 top-2 font-mono text-[9px] text-muted-foreground">{plot.maxText}</span>
          <span className="absolute bottom-2 left-3 font-mono text-[9px] text-muted-foreground">{plot.minText}</span>
          <span className="absolute bottom-2 right-3 text-[9px] text-muted-foreground">
            {formatTimestamp(plot.lastMs)}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-[10px] text-muted-foreground">
        <p data-testid="evm-performance-forward-only">
          Forward-only, as observed{result.trackingStartedMs === null
            ? '; tracking has not started.'
            : `; tracking since ${formatTimestamp(result.trackingStartedMs)}.`}
          {' '}No earlier balances are reconstructed.
        </p>
        {result.chartPartial ? (
          <p className="max-w-xl text-right text-amber-600" role="status">
            Partial coverage creates chart gaps; missing positions are not counted as zero.
            {reasons.length > 0 ? ` Reasons: ${reasons.join(', ')}.` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PerformanceMetric({ label, value, note }: { readonly label: string; readonly value: string; readonly note: string }) {
  const down = value.startsWith('-');
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--input-bg)] px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums" style={{ color: down ? 'var(--down)' : 'var(--ink-0)' }}>
        {value}
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">{note}</p>
    </div>
  );
}

function exactUsd(raw: string | null): string | null {
  if (raw === null) return null;
  const value = parseWireSigned(raw);
  if (value === null) return null;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? '-' : ''}$${formatBigIntUnits(magnitude, 18, 6)}`;
}

interface PlotPoint { readonly x: number; readonly y: number }
interface Plot {
  readonly segments: ReadonlyArray<ReadonlyArray<PlotPoint>>;
  readonly minText: string;
  readonly maxText: string;
  readonly lastMs: number;
}

function buildPlot(points: ReadonlyArray<EvmPerformancePoint>): Plot | null {
  const complete = points.filter((point) => point.valueMeasuredCount === point.positionCount);
  if (complete.length === 0) return null;
  const values = complete.map((point) => BigInt(point.measuredValueUsdAtto));
  const min = values.reduce((left, right) => left < right ? left : right);
  const max = values.reduce((left, right) => left > right ? left : right);
  const firstMs = points[0]!.tMs;
  const lastMs = points.at(-1)!.tMs;
  const duration = Math.max(1, lastMs - firstMs);
  const span = max - min;
  const segments: PlotPoint[][] = [];
  let active: PlotPoint[] = [];
  for (const point of points) {
    if (point.valueMeasuredCount !== point.positionCount) {
      if (active.length > 0) segments.push(active);
      active = [];
      continue;
    }
    const value = BigInt(point.measuredValueUsdAtto);
    const normalized = span === 0n ? 500_000n : ((value - min) * 1_000_000n) / span;
    active.push({
      x: 18 + ((point.tMs - firstMs) / duration) * 964,
      y: 202 - (Number(normalized) / 1_000_000) * 184,
    });
  }
  if (active.length > 0) segments.push(active);
  return {
    segments,
    minText: exactUsd(min.toString(10)) ?? 'Unavailable',
    maxText: exactUsd(max.toString(10)) ?? 'Unavailable',
    lastMs,
  };
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

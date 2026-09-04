'use client';

/**
 * The REAL Solana chart, mounted on the EVM trade page (phase 1 of the
 * trade-page unification).
 *
 * This replaces `EvmCandleChart` (the deliberate 279-line static-SVG fork)
 * with the exact stack the Solana page runs:
 *
 *   `GET /evm/candles` (native resolution)
 *     → `adaptEvmCandles`                (lib/evm/chartAdapter — basis-scaled floats)
 *     → `applyProvisionalTip`            (tape-synthesized tip ahead of canonical)
 *     → `renderAppendOnly`               (settled bars are write-once)
 *     → `createCandleAggregator`         (client-side 5s/4h/12h/1d folding)
 *     → `<PriceChart>`                   (lightweight-charts: zoom/pan/crosshair)
 *
 * What each stage buys the EVM page:
 * - **Derived timeframes for free.** The server speaks 1s/1m/5m/15m/1h;
 *   `timeframeFetchPlan` maps 5s/4h/12h/1d onto a native base and the
 *   aggregator folds client-side — identical to Solana.
 * - **A live tip between candle refetches.** The EVM stream has no candle
 *   frames, so the tip is synthesized from trade frames (the tape), exactly
 *   the Solana provisional-tip doctrine: provisional data lives only at/ahead
 *   of the canonical watermark and never settles anything.
 * - **Render stability.** Settled bars are write-once per session; reorg
 *   recomputes land through `refetchEpoch` (the page bumps it on
 *   `stage`/`reverted`/resnapshot), which rebuilds the settled base.
 *
 * The BASIS (USD market cap → USD price → native price → bare ratio) is
 * resolved per wire capability and latched: oracle wobble below 0.1% never
 * reprices settled history, a real move rebuilds everything once at a
 * consistent rate (the Solana `settledSolUsd` latch, applied to the whole
 * factor). The basis line under the toolbar says which one the chart is in —
 * a USD figure is never fabricated from a stale or absent oracle.
 */

import { useMemo, useRef } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';

import {
  nativeSymbolForChain,
  type EvmCardView,
  type EvmTradeHeader,
} from '@/lib/evm/discoverAdapter';
import {
  adaptEvmCandles,
  evmCanonicalThroughSec,
  resolveEvmChartBasis,
  synthesizeEvmTipCandles,
  type EvmChartBasis,
} from '@/lib/evm/chartAdapter';
import { quoteUnitsWithheldText, type EvmCandleSeries } from '@/lib/evm/tradeApi';
import type { EvmTapeEntry } from '@/lib/evm/tape';
import { PriceChart } from './PriceChart';
import { emptyAppendOnlyState, renderAppendOnly, type AppendOnlyState } from './appendOnlyRenderer';
import { applyProvisionalTip } from './useCandleHistory';
import {
  CHART_TIMEFRAMES,
  chartTimeframeSeconds,
  createCandleAggregator,
  timeframeFetchPlan,
  type ChartTimeframe,
} from './timeframes';
import type { MockToken, OHLCSnapshot } from './mockTrade';

/** Latch advance threshold — the Solana settled-rate rule (0.1% cumulative). */
const BASIS_DRIFT_EPSILON = 0.001;

const EMPTY_OHLC: OHLCSnapshot = { o: 0, h: 0, l: 0, c: 0, change: 0, changePct: 0 };

export interface EvmPriceChartProps {
  /** The native-resolution series the page fetched (`timeframeFetchPlan`). */
  series: EvmCandleSeries;
  header: EvmTradeHeader;
  view: EvmCardView;
  chain: string;
  address: string;
  timeframe: ChartTimeframe;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  /** Merged tape (live edge + page) — the provisional tip's source. */
  tape: readonly EvmTapeEntry[];
  /**
   * The page's snapshot-refetch epoch (`refetchToken`): bumped on
   * `stage`/`reverted` frames and stream resnapshots. Folded into the
   * append-only stable key so a reorg's recompute actually re-renders
   * settled bars.
   */
  refetchEpoch: number;
}

export function EvmPriceChart({
  series,
  header,
  view,
  chain,
  address,
  timeframe,
  onTimeframeChange,
  tape,
  refetchEpoch,
}: EvmPriceChartProps) {
  const plan = timeframeFetchPlan(timeframe);
  const subjectKey = `${chain}:${address}:${plan.resolution}`;

  const rawBasis = useMemo(
    () =>
      resolveEvmChartBasis({
        quoteIsNative: view.quote.isNative,
        usdUnavailableReason: header.usdUnavailableReason ?? null,
        nativeUsdNano: header.nativeUsdNano ?? null,
        totalSupply: header.totalSupply ?? null,
        tokenDecimals: view.tokenDecimals,
      }),
    [
      header.nativeUsdNano,
      header.totalSupply,
      header.usdUnavailableReason,
      view.quote.isNative,
      view.tokenDecimals,
    ],
  );
  // Latch the basis per subject: the oracle print wobbles per header refetch,
  // and settled bars are write-once — repricing them every wobble would fight
  // the append-only renderer. Advance only on a kind change or >=0.1% factor
  // drift; each advance bumps the epoch, which rebuilds the settled base at
  // the new rate (both tip and settled use the SAME latched basis, so the
  // series is always internally consistent).
  const basisRef = useRef<{ key: string; basis: EvmChartBasis; epoch: number }>({
    key: subjectKey,
    basis: rawBasis,
    epoch: 0,
  });
  if (basisRef.current.key !== subjectKey) {
    basisRef.current = { key: subjectKey, basis: rawBasis, epoch: 0 };
  } else {
    const current = basisRef.current;
    const drift =
      current.basis.factor > 0 && rawBasis.factor > 0
        ? Math.abs(rawBasis.factor / current.basis.factor - 1)
        : rawBasis.factor === current.basis.factor
          ? 0
          : Number.POSITIVE_INFINITY;
    if (rawBasis.kind !== current.basis.kind || drift >= BASIS_DRIFT_EPSILON) {
      basisRef.current = { key: subjectKey, basis: rawBasis, epoch: current.epoch + 1 };
    }
  }
  const basis = basisRef.current.basis;
  const basisEpoch = basisRef.current.epoch;

  const baseCandles = useMemo(
    () => adaptEvmCandles(series.candles, basis),
    [series.candles, basis],
  );
  const canonicalThrough = evmCanonicalThroughSec(baseCandles);
  const stepSec = chartTimeframeSeconds(plan.resolution);
  const tipCandles = useMemo(
    () => synthesizeEvmTipCandles(tape, stepSec, canonicalThrough, basis),
    [basis, canonicalThrough, stepSec, tape],
  );
  const withTip = useMemo(
    () => applyProvisionalTip(baseCandles, tipCandles, canonicalThrough),
    [baseCandles, canonicalThrough, tipCandles],
  );

  // Append-only renderer: settled bars are write-once until the stable key
  // changes (subject/resolution switch, reorg refetch, basis advance).
  const stableKey = `${subjectKey}#${refetchEpoch}#${basisEpoch}`;
  const appendRef = useRef<AppendOnlyState>(emptyAppendOnlyState(stableKey));
  const nativeCandles = useMemo(() => {
    const { state, bars } = renderAppendOnly(
      appendRef.current,
      withTip,
      stableKey,
      canonicalThrough,
    );
    appendRef.current = state;
    return bars;
  }, [canonicalThrough, stableKey, withTip]);

  // Display timeframe folding — one aggregator per chart instance (its cache
  // is single-slot; see `createCandleAggregator`).
  const aggregatorRef = useRef<ReturnType<typeof createCandleAggregator> | null>(null);
  if (aggregatorRef.current === null) aggregatorRef.current = createCandleAggregator();
  const displayCandles = useMemo(
    () => aggregatorRef.current!(nativeCandles, timeframe),
    [nativeCandles, timeframe],
  );

  // The O/H/L/C strip must describe the candle actually plotted (the Solana
  // page applies the same rule on aggregated timeframes).
  const ohlc = useMemo<OHLCSnapshot>(() => {
    const last = displayCandles[displayCandles.length - 1];
    if (!last) return EMPTY_OHLC;
    const change = last.close - last.open;
    return {
      o: last.open,
      h: last.high,
      l: last.low,
      c: last.close,
      change,
      changePct: last.open > 0 ? (change / last.open) * 100 : 0,
    };
  }, [displayCandles]);

  // PriceChart reads `mintAddress` (cache keys) and `ticker` (watermark); the
  // rest of the MockToken contract is filled honestly from the view — and
  // chain-qualified, so two chains sharing an address space cannot share a key.
  const token = useMemo<MockToken>(
    () => ({
      mintAddress: `${chain}:${address}`,
      symbol: view.ticker,
      ticker: view.ticker,
      name: view.name,
      imageUrl: view.imageUrl ?? '',
      imageFallbackUrl: null,
      twitterUrl: null,
      telegramUrl: null,
      websiteUrl: null,
      ageLabel: '',
      price: view.priceUsdText ?? '—',
      liquidity: '—',
      marketCap: view.marketCapUsdText ?? '—',
      marketCapUsd: view.marketCapUsdValue,
      ath: '—',
      platform: chain,
      source: 'chain-indexer',
      mintShort: `${address.slice(0, 6)}…${address.slice(-4)}`,
      // Contract-required numbers PriceChart never renders; the page's own
      // stats section is the honest surface for these.
      txns: view.tradeCount ?? 0,
      score: view.score ?? 0,
      graduated: view.stage === 'graduated',
      graduatedAtMs: view.graduatedAtMs,
      quoteMint: null,
      solUsd: null,
      hasWebsite: false,
      hasLink: false,
      hasAgent: false,
      isMayhem: false,
      isCashback: false,
    }),
    [address, chain, view],
  );

  const undrawnBuckets = series.candles.length - baseCandles.length;
  const emptyMessage =
    displayCandles.length > 0
      ? null
      : series.candles.length === 0
        ? 'No candles for this token yet at this resolution.'
        : `${series.candles.length} bucket(s) recorded, none with a defined price yet.`;

  return (
    <section
      aria-label="Chart"
      data-testid="evm-price-chart"
      data-basis={basis.kind}
      data-graduated-at-ms={view.graduatedAtMs ?? undefined}
      /* Frameless: hosted inside the page's chart `.panel` (phase-2 layout),
         so the border is the panel's. Fills the panel on lg+. */
      className="flex min-h-0 flex-col lg:flex-1"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Chart</h2>
        <BasisNote basis={basis} chain={chain} />
        <div className="ml-auto flex flex-wrap gap-1" role="tablist" aria-label="Timeframe">
          {CHART_TIMEFRAMES.map((tag) => (
            <button
              key={tag}
              type="button"
              role="tab"
              aria-selected={tag === timeframe}
              onClick={() => onTimeframeChange(tag)}
              className={
                tag === timeframe
                  ? 'rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground'
                  : 'rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'
              }
            >
              {tag}
            </button>
          ))}
        </div>
      </header>

      {/* PriceChart's root is `flex-1 min-h-0`; this box gives it a height:
          fixed in the stacked (<lg) layout, panel-filling when the section
          is inside the viewport-locked PanelStack. */}
      <div className="flex h-[380px] min-h-0 flex-col lg:h-auto lg:min-h-[240px] lg:flex-1">
        <PriceChart
          token={token}
          ohlc={ohlc}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          candles={displayCandles}
          rebuildEpoch={refetchEpoch * 1_000_000 + basisEpoch}
          valueScale={1}
          displayUnit={basis.displayUnit}
          displayMode={basis.displayMode}
          emptyMessage={emptyMessage}
          graduatedAtMs={view.graduatedAtMs}
        />
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[10px] text-muted-foreground">
        <ChartNote label="buckets" value={`${series.count} of ${series.total}`} />
        {series.truncated && (
          <ChartNote label="capped" value="showing the newest slice, not the whole history" />
        )}
        {series.stale && (
          <ChartNote
            label="stale"
            value="a reorg invalidated at least one bucket; the recompute has not landed"
          />
        )}
        {undrawnBuckets > 0 && (
          <ChartNote
            label="gaps"
            value={`${undrawnBuckets} bucket(s) have no defined price and are omitted rather than drawn at zero`}
          />
        )}
      </dl>
    </section>
  );
}

/**
 * WHAT THE PLOTTED LEVELS MEAN — the one line that keeps the fallback chain
 * honest. `PriceChart` prints `$` only on the USD bases; the two unlabelled
 * bases say here what their figures are (or that no absolute level exists).
 */
function BasisNote({ basis, chain }: { basis: EvmChartBasis; chain: string }) {
  switch (basis.kind) {
    case 'usd-mc':
      return (
        <span className="text-[10px] text-muted-foreground" data-testid="evm-chart-basis">
          USD market cap
        </span>
      );
    case 'usd-price':
      return (
        <span className="text-[10px] text-muted-foreground" data-testid="evm-chart-basis">
          USD per token — no total supply on the wire, so market cap is unavailable
        </span>
      );
    case 'native-price':
      return (
        <span className="text-[10px] text-muted-foreground" data-testid="evm-chart-basis">
          {nativeSymbolForChain(chain)} per token — no fresh USD oracle basis, so USD levels
          are withheld rather than computed from a stale rate
        </span>
      );
    case 'quote-ratio':
      return (
        <span className="text-[10px] text-muted-foreground" data-testid="evm-chart-basis">
          {quoteUnitsWithheldText('chart')}
        </span>
      );
  }
}

function ChartNote({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <dt className="inline font-semibold">{label}:</dt>{' '}
      <dd className="inline">{value}</dd>
    </span>
  );
}

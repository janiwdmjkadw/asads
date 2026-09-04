import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandlestickData, Time } from 'lightweight-charts';
import { releaseResponseBody } from '@/lib/api/http';
import { fetchIngestionJson, ingestionApiUrl } from '@/lib/api/ingestion';
import { verboseLogsEnabled } from '@/lib/dev/verboseLogs';
import { queryKeys } from '@/lib/query/keys';
import { chartTimeframeSeconds } from './timeframes';
import {
  emptyAppendOnlyState,
  renderAppendOnly,
  type AppendOnlyState,
} from './appendOnlyRenderer';
import { adaptSnapshotCandleBuckets } from './snapshotAdapter';
import type { CandleResolution, SnapshotCandle, TokenCandlesResponse } from './types';

const OLDER_CHUNK_LIMIT = 500;
// Initial page sized for the visible viewport plus generous scrollback —
// parsing 5k candles on the main thread at paint time was pure jank; deeper
// history arrives via the `loadOlder` (beforeSec) pages on demand.
// MUST stay equal to CANDLE_LATEST_LIMIT in useTokenTradePrewarm.ts (the
// prewarm prefetch shares this query key, so the pages must be identical).
const LATEST_CHUNK_LIMIT = 1_500;
const NO_BUCKETS: SnapshotCandle[] = [];

// ── chart-load trace ──────────────────────────────────────────────────────
// One-shot, per mint+timeframe timing of the two user-visible chart phases:
// phase 1 = seed candles painted (snapshot live ring), phase 2 = full cold
// history painted. Reported once as `[chart-load]` (console + a small
// window buffer) when phase 2 first renders, so a slow open in a real
// session decomposes into hydrate-gate wait vs history fetch vs client
// render without a debugger attached. Steady-state renders only touch a
// couple of ref fields — no allocation, no effects, no extra work.
interface ChartLoadTrace {
  key: string;
  startedAtEpochMs: number;
  t0: number;
  hydrateAt: number | null;
  fetchStartAt: number | null;
  dataAt: number | null;
  seedRenderAt: number | null;
  reported: boolean;
}

function traceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function newChartLoadTrace(key: string): ChartLoadTrace {
  return {
    key,
    startedAtEpochMs: Date.now(),
    t0: traceNow(),
    hydrateAt: null,
    fetchStartAt: null,
    dataAt: null,
    seedRenderAt: null,
    reported: false,
  };
}

function reportChartLoad(
  trace: ChartLoadTrace,
  info: {
    mint: string;
    timeframe: string;
    bars: number;
    historyCandles: number;
    coldBackfill: boolean;
  },
): void {
  if (typeof window === 'undefined') return;
  const doneAt = traceNow();
  const since = (from: number | null, to: number | null): number | null =>
    from == null || to == null ? null : Math.round(to - from);
  const payload = {
    mint: info.mint,
    timeframe: info.timeframe,
    startedAt: new Date(trace.startedAtEpochMs).toISOString(),
    // Gate wait: mount → hydrate policy allowed the history fetch.
    hydrateWaitMs: since(trace.t0, trace.hydrateAt),
    // Network: fetch dispatched → response parsed into the query cache.
    // Null when the prewarm/query cache already had the page (no fetch).
    fetchMs: since(trace.fetchStartAt, trace.dataAt),
    // Client: response in cache → full history actually rendered as bars.
    renderMs: since(trace.dataAt, doneAt),
    // The user-visible "few candles → full history" adjustment gap.
    seedToHistoryMs: since(trace.seedRenderAt, doneAt),
    totalMs: since(trace.t0, doneAt),
    fromCache: trace.fetchStartAt == null,
    // Truly-cold token: this open triggered/awaited a genesis backfill, so
    // its timings belong to a separate (physics-bound) population.
    coldBackfill: info.coldBackfill,
    bars: info.bars,
    historyCandles: info.historyCandles,
  };
  // Console mirror is opt-in (localStorage listen:verbose-logs=1) — the
  // window buffer + beacon below are the always-on record.
  if (verboseLogsEnabled()) console.info('[chart-load]', payload);
  const w = window as unknown as { __chartLoads?: unknown[] };
  if (!w.__chartLoads) w.__chartLoads = [];
  w.__chartLoads.push(payload);
  if (w.__chartLoads.length > 50) w.__chartLoads.splice(0, w.__chartLoads.length - 50);
  // Fire-and-forget telemetry beacon: one tiny background POST per chart
  // open so real-user load times land in the server logs. sendBeacon never
  // blocks rendering or navigation; a string body keeps it a "simple"
  // request (no preflight). Best-effort by design.
  try {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number };
    };
    const url = ingestionApiUrl('/api/telemetry/chart-load');
    if (url && typeof nav.sendBeacon === 'function') {
      nav.sendBeacon(
        url,
        JSON.stringify({
          ...payload,
          conn: nav.connection?.effectiveType ?? null,
          downlinkMbps: nav.connection?.downlink ?? null,
        }),
      );
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

export function useCandleHistory({
  mint,
  timeframe,
  seed,
  liveCandles = [],
  hydrateLatest = true,
  solUsd,
  totalSupplyBaseUnits,
  rebuildSignal = 0,
  coldBackfill = false,
}: {
  mint: string | undefined;
  timeframe: CandleResolution;
  seed: CandlestickData<Time>[];
  liveCandles?: SnapshotCandle[];
  hydrateLatest?: boolean;
  solUsd: number | null;
  totalSupplyBaseUnits: string | null;
  /** Bump to force a settled-base rebuild (stream resync / gap repair). */
  rebuildSignal?: number;
  /** True when this open triggered/awaited a genesis backfill (truly-cold
   *  token). Tagged onto the chart-load beacon so the cold-token population
   *  can be segmented from the main latency distribution. */
  coldBackfill?: boolean;
}): {
  candles: CandlestickData<Time>[];
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  loadOlder: () => void;
  /** Settled-rate epoch (#12): fold into PriceChart's rebuildEpoch — see the return site. */
  rateEpoch: number;
} {
  const liveSeed = useMemo(() => {
    // `solUsd <= 0` is a failed price feed, not a price: adapting with it
    // would reprice the live tip to zero (see marketCapUsdFromRatio).
    if (!totalSupplyBaseUnits || solUsd == null || solUsd <= 0 || liveCandles.length === 0) {
      return [];
    }
    return adaptSnapshotCandleBuckets(
      liveCandles.filter((candle) => candle.resolution === timeframe),
      { solUsd, totalSupplyBaseUnits },
    );
  }, [liveCandles, solUsd, timeframe, totalSupplyBaseUnits]);
  // Canonical-only seam for the YOUNG-COIN path (no cold history yet — the
  // chart renders snapshot frames directly): snapshot candles are the
  // engine's merged view whose provisional tip is estimate-bucketed (it can
  // collapse several wall seconds into one bucket until block time lands and
  // re-spreads them — the "candles combining" artifact). Once the SSE
  // overlay (canonical-owned) is alive, the snapshot seed may contribute
  // only buckets STRICTLY OLDER than the overlay's coverage; the canonical
  // overlay owns the live window outright.
  const mergedSeed = useMemo(() => {
    if (liveSeed.length === 0) return seed;
    const overlayStart = Number(liveSeed[0]!.time);
    const older = seed.filter((candle) => Number(candle.time) < overlayStart);
    return mergeCandles(older, liveSeed);
  }, [liveSeed, seed]);
  const [historyBuckets, setHistoryBuckets] = useState<SnapshotCandle[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // The fetch identity is ONLY mint+timeframe — those are what determine which
  // candles to load. `solUsd`/`totalSupplyBaseUnits` are adaptation inputs (not
  // fetch inputs), and `hydrateLatest` is snapshot-derived and oscillates: the
  // 1s REST poll and the live SSE `setQueryData` disagree on `graduated` /
  // `stateKind` mid-rehydration, so folding any of them into `key` made it churn
  // every tick — wiping `historyBuckets` and aborting the in-flight 5000-candle
  // fetch before it landed, leaving only the ~8 seed candles on the chart.
  const key = `${mint ?? ''}:${timeframe}`;
  // Latch the hydrate decision monotonically per mint+timeframe: once a coin is
  // eligible for cold hydration it STAYS eligible, so a transient
  // `hydrateLatest=false` (snapshot flip-flop) can never abort or reset an
  // in-flight hydration. Reset only when the mint/timeframe actually changes.
  const hydrateLatchRef = useRef<{ key: string; latched: boolean }>({ key, latched: hydrateLatest });
  if (hydrateLatchRef.current.key !== key) {
    hydrateLatchRef.current = { key, latched: hydrateLatest };
  } else if (hydrateLatest) {
    hydrateLatchRef.current.latched = true;
  }
  const effectiveHydrate = hydrateLatchRef.current.latched;
  // Chart-load trace (see ChartLoadTrace above): ref-only writes during
  // render, idempotent (first-write-wins), reported once per key.
  const traceRef = useRef<ChartLoadTrace>(newChartLoadTrace(key));
  if (traceRef.current.key !== key) {
    traceRef.current = newChartLoadTrace(key);
  }
  const trace = traceRef.current;
  if (effectiveHydrate && trace.hydrateAt == null) {
    trace.hydrateAt = traceNow();
  }
  // Latch the cold-backfill flag (it can flip true after mount, when the
  // backfill status lands) so the one-shot report sees it regardless of
  // ordering. Per-key like the trace itself.
  const coldBackfillRef = useRef<{ key: string; seen: boolean }>({ key, seen: coldBackfill });
  if (coldBackfillRef.current.key !== key) {
    coldBackfillRef.current = { key, seen: coldBackfill };
  } else if (coldBackfill) {
    coldBackfillRef.current.seen = true;
  }
  const queryClient = useQueryClient();
  const keyRef = useRef(key);
  const inFlightRef = useRef(false);
  const loadOlderControllerRef = useRef<AbortController | null>(null);
  const mergedSeedLengthRef = useRef(mergedSeed.length);
  const keyMatchesState = keyRef.current === key;

  // The "latest" page lives in React Query under the SAME key the prewarm
  // prefetches (warmTokenPanels) and the selected-token SSE stream patches
  // (`queryKeys.token.candles(mint, resolution, null)`): one download serves
  // hover-warm, mount, and return navigation, and live trades keep the cached
  // entry current for free while the chart is open.
  const latestQuery = useQuery({
    queryKey: queryKeys.token.candles(mint ?? null, timeframe, null),
    enabled: effectiveHydrate && Boolean(mint),
    queryFn: async ({ signal }) => {
      // Incremental reconcile: the 30s invalidation in useSelectedTokenStream
      // re-runs this queryFn just to heal provisional drift in the recent
      // tail, but a full refetch re-downloads all 1500 candles for it. With a
      // warm cached page, ask the server only for the heal window
      // (sinceBucketStartSec) and splice it over the cache; a cold/empty
      // cache still takes the full fetch, byte-identical to before.
      const cached = queryClient.getQueryData<TokenCandlesResponse>(
        queryKeys.token.candles(mint ?? null, timeframe, null),
      );
      const plan = planCandleReconcile(cached, chartTimeframeSeconds(timeframe));
      const fresh = await fetchIngestionJson<TokenCandlesResponse>(
        `/api/token/${encodeURIComponent(mint ?? '')}/candles?resolution=${encodeURIComponent(timeframe)}&limit=${LATEST_CHUNK_LIMIT}${plan ? `&sinceBucketStartSec=${plan.sinceBucketStartSec}` : ''}`,
        { signal },
      );
      return plan && cached ? mergeReconciledCandles(cached, fresh) : fresh;
    },
    // Avoid a loading flicker on key change; mismatched placeholder data is
    // filtered out below by the mint/resolution check.
    placeholderData: keepPreviousData,
    // The SSE patcher rewrites this entry on every canonical candles event
    // (~400ms slot cadence) — deep-comparing a 5k-candle array per patch is
    // wasted main-thread work.
    structuralSharing: false,
  });
  // Gate consumption on `effectiveHydrate` as well as the key match: prewarm
  // prefetches candles for every hovered card, so without the gate a cached
  // entry would leak the latest page into hot-only coins the hydration policy
  // deliberately keeps on the snapshot path.
  const latestData = effectiveHydrate ? latestQuery.data : undefined;
  if (latestQuery.fetchStatus === 'fetching' && trace.fetchStartAt == null) {
    trace.fetchStartAt = traceNow();
  }
  if (trace.dataAt == null && mint && latestData?.mint === mint && latestData.resolution === timeframe) {
    trace.dataAt = traceNow();
  }
  const latestBuckets = useMemo(() => {
    if (!mint || !latestData || latestData.mint !== mint || latestData.resolution !== timeframe) {
      return NO_BUCKETS;
    }
    const buckets = latestData.candles ?? NO_BUCKETS;
    // Sub-minute tip trim: the latest page's newest bucket is the server's
    // MERGED view, whose forming tip can be provisional (estimate-bucketed,
    // can shift ±1s when block time lands). Rendering it from refetches
    // would re-seed exactly the bucket-shift artifact the SSE layer now
    // avoids (canonical-only events). The live tip is owned by the SSE
    // overlay; dropping one bucket here costs nothing while connected and
    // at most one bucket of lag when fully disconnected.
    if (timeframe === '1s' && buckets.length > 1) {
      return buckets.slice(0, buckets.length - 1);
    }
    return buckets;
  }, [latestData, mint, timeframe]);
  // Reconnect resilience (#15): the newest refetched 1s bucket is trimmed out
  // of the SETTLED latest page above (its forming tip can bucket-shift), but
  // rather than DROP it we STAGE it into the provisional-tip channel below.
  // Provisional buckets never settle and are ceded to canonical
  // (applyProvisionalTip drops/merges them once SSE events resume), so a
  // reconnect no longer blanks the 1s tip while the bucket-shift/write-once
  // poisoning the trim guards against still cannot return.
  const stagedTipCandles = useMemo(() => {
    if (timeframe !== '1s') return NO_BUCKETS;
    if (!mint || !latestData || latestData.mint !== mint || latestData.resolution !== timeframe) {
      return NO_BUCKETS;
    }
    const buckets = latestData.candles ?? NO_BUCKETS;
    if (buckets.length <= 1) return NO_BUCKETS; // nothing was trimmed
    return [buckets[buckets.length - 1]!];
  }, [latestData, mint, timeframe]);
  // Adapt the staged tip with the FRESH price (like liveSeed),
  // not the settled latch — it is a live tip, not settled history.
  const stagedTipSeed = useMemo(() => {
    if (!totalSupplyBaseUnits || solUsd == null || solUsd <= 0 || stagedTipCandles.length === 0) {
      return [];
    }
    return adaptSnapshotCandleBuckets(stagedTipCandles, { solUsd, totalSupplyBaseUnits });
  }, [stagedTipCandles, solUsd, totalSupplyBaseUnits]);
  // Latch the first valid SOL/USD print per mint+timeframe for settled-history
  // adaptation (same reasoning as PriceChart's solUsdRef): the Pyth float
  // wobbles at 1–2 Hz, and with raw `solUsd` in the deps every wobble
  // re-merged, re-sorted, spike-filtered and BigInt-reparsed the entire
  // settled history — work the append-only renderer then discarded, since
  // settled bars are write-once. The live tip keeps the fresh price via
  // `liveSeed`/`stagedTipSeed`, which win the merge at/ahead of the
  // watermark. First-paint is unchanged: a valid first print latches on the
  // same render it arrives (`solUsd <= 0` is a failed feed, never latched).
  const settledSolUsdRef = useRef<{ key: string; value: number | null; epoch: number }>({ key, value: null, epoch: 0 });
  if (settledSolUsdRef.current.key !== key) {
    settledSolUsdRef.current = { key, value: null, epoch: 0 };
  }
  // Advance the latched settled rate on the FIRST valid print, then only when
  // cumulative drift crosses 0.1% — Pyth wobble (±bps @ 1–2 Hz) never trips it,
  // but a genuine SOL regime move re-adapts settled history once instead of
  // freezing the session's first price forever. Each advance bumps `epoch`,
  // folded into `stableKey` below so the append-only renderer (settled bars are
  // write-once) rebuilds its base against the new rate rather than silently
  // ignoring the re-adapted values. The first valid print still latches on the
  // render it arrives, so cold first-paint is byte-identical.
  {
    const cur = settledSolUsdRef.current;
    if (solUsd != null && solUsd > 0 && (cur.value == null || Math.abs(solUsd / cur.value - 1) >= 0.001)) {
      cur.value = solUsd;
      cur.epoch += 1;
    }
  }
  const settledSolUsd = settledSolUsdRef.current.value;
  const rateEpoch = settledSolUsdRef.current.epoch;
  const historyCandles = useMemo(() => {
    if (!totalSupplyBaseUnits || settledSolUsd == null) return [];
    const buckets = mergeSnapshotCandles(historyBuckets, latestBuckets);
    if (buckets.length === 0) return [];
    return adaptSnapshotCandleBuckets(buckets, { solUsd: settledSolUsd, totalSupplyBaseUnits });
  }, [historyBuckets, latestBuckets, settledSolUsd, totalSupplyBaseUnits]);
  // Append-only renderer (see appendOnlyRenderer.ts): settled bars are
  // write-once; only the forming tip is mutable. The stable key folds in the
  // rebuild signal so a stream resync rebuilds the base deterministically
  // (reconnect gap-repairs can insert their healed windows).
  const stableRef = useRef<AppendOnlyState>(emptyAppendOnlyState(key));
  const stableKey = `${key}#${rebuildSignal}#${rateEpoch}`;
  const visibleCandles = useMemo(() => {
    // Canonical source selection: once the history query has real data,
    // the chart renders history + the SSE live overlay ONLY (the snapshot
    // poll's merged tail is just the pre-history bootstrap).
    const merged = !keyMatchesState
      ? mergedSeed
      : historyCandles.length > 0
        ? mergeCandles(historyCandles, liveSeed)
        : mergedSeed;
    // The canonical watermark: what renderAppendOnly settles against, so
    // the reconnect-staged tip (#15, below) can never prove a canonical
    // bucket complete. NOTE: the per-trade provisional tip that used to
    // ride here (provisionalTip.ts, Jul 9) was reverted — its guessed
    // buckets ahead of the watermark visibly re-formed when canonical
    // arrived, the "candles repaint at finalize" regression.
    const canonicalThrough = merged.length > 0
      ? Number(merged[merged.length - 1]!.time)
      : Number.NEGATIVE_INFINITY;
    // Reconnect-staged server tip (#15): the newest refetched 1s bucket,
    // staged as mutable-only so a reconnect doesn't blank the tip.
    const withTip = keyMatchesState
      ? applyProvisionalTip(merged, stagedTipSeed, canonicalThrough)
      : merged;
    const { state, bars } = renderAppendOnly(
      stableRef.current,
      withTip,
      stableKey,
      canonicalThrough,
    );
    stableRef.current = state;
    // Chart-load trace bookkeeping: mark the phase-1 (seed-only) paint, and
    // report once when the full cold history first renders.
    if (keyMatchesState && !trace.reported) {
      if (historyCandles.length === 0) {
        if (trace.seedRenderAt == null && bars.length > 0) {
          trace.seedRenderAt = traceNow();
        }
      } else {
        trace.reported = true;
        reportChartLoad(trace, {
          mint: mint ?? '',
          timeframe,
          bars: bars.length,
          historyCandles: historyCandles.length,
          coldBackfill: coldBackfillRef.current.seen,
        });
      }
    }
    return bars;
  }, [historyCandles, keyMatchesState, liveSeed, mergedSeed, stagedTipSeed, stableKey]);
  const visibleHasMoreOlder = keyMatchesState ? hasMoreOlder : mergedSeed.length > 0;
  const visibleLoadingOlder = keyMatchesState ? loadingOlder : false;

  useEffect(() => {
    mergedSeedLengthRef.current = mergedSeed.length;
    if (keyRef.current !== key) {
      keyRef.current = key;
      setHistoryBuckets([]);
      setHasMoreOlder(mergedSeed.length > 0);
      setLoadingOlder(false);
      inFlightRef.current = false;
      // A `loadOlder` page for the old mint/timeframe is useless now.
      loadOlderControllerRef.current?.abort();
      loadOlderControllerRef.current = null;
    }
  }, [key, mergedSeed]);

  // Unmount: abort any in-flight loadOlder page.
  useEffect(() => {
    return () => {
      loadOlderControllerRef.current?.abort();
      loadOlderControllerRef.current = null;
    };
  }, []);

  // Apply the latest page's `hasMoreOlder` once per mint+timeframe. The SSE
  // patcher rewrites the query entry on every live trade, so re-applying on
  // each data identity change would clobber what `loadOlder` learned from
  // deeper (beforeSec) pages.
  const hasMoreOlderAppliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (keyRef.current !== key) return;
    if (!mint || !latestData || latestData.mint !== mint || latestData.resolution !== timeframe) {
      return;
    }
    if (hasMoreOlderAppliedKeyRef.current === key) return;
    hasMoreOlderAppliedKeyRef.current = key;
    const latest = latestData.candles ?? [];
    setHasMoreOlder(Boolean(latestData.hasMoreOlder) || (latest.length === 0 && mergedSeedLengthRef.current > 0));
  }, [key, latestData, mint, timeframe]);

  const oldestSec = useMemo(() => {
    if (visibleCandles.length === 0) return null;
    return Number(visibleCandles[0]?.time);
  }, [visibleCandles]);

  const loadOlder = useCallback(() => {
    if (!mint || !totalSupplyBaseUnits || oldestSec == null) return;
    if (keyRef.current !== key) return;
    if (!hasMoreOlder || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoadingOlder(true);
    const controller = new AbortController();
    loadOlderControllerRef.current = controller;
    const requestKey = keyRef.current;
    const load = async () => {
      try {
        const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/candles?resolution=${encodeURIComponent(timeframe)}&limit=${OLDER_CHUNK_LIMIT}&beforeSec=${oldestSec}`);
        if (!url) return;
        // Historical (beforeSec) pages are closed buckets; let the browser/CDN honor
        // the origin's Cache-Control (max-age) so scrollback is served off-origin.
        // The latest page stays no-store (it carries the live tail).
        const resp = await fetch(url, { cache: 'default', signal: controller.signal });
        if (!resp.ok) {
          releaseResponseBody(resp);
          throw new Error(`http_${resp.status}`);
        }
        const data = (await resp.json()) as TokenCandlesResponse;
        if (keyRef.current !== requestKey) return;
        const older = data.candles ?? [];
        setHistoryBuckets((current) => mergeSnapshotCandles(older, current));
        setHasMoreOlder(Boolean(data.hasMoreOlder) && older.length > 0);
      } catch {
        // Keep the chart stable; the next left-edge gesture can retry.
      } finally {
        if (loadOlderControllerRef.current === controller) {
          loadOlderControllerRef.current = null;
        }
        if (keyRef.current === requestKey) {
          inFlightRef.current = false;
          setLoadingOlder(false);
        }
      }
    };
    void load();
  }, [hasMoreOlder, key, mint, oldestSec, timeframe, totalSupplyBaseUnits]);

  return {
    candles: visibleCandles,
    loadingOlder: visibleLoadingOlder,
    hasMoreOlder: visibleHasMoreOlder,
    loadOlder,
    // Settled-rate epoch (#12): bumps when the latched SOL/USD advances. The
    // re-adapted settled bars keep the same times/length/shape, so PriceChart's
    // shape-only fast paths (scaledCandles prefix reuse + the series update
    // fence) would silently swallow the rebuild — the caller must fold this
    // into `rebuildEpoch` so a rate advance forces the full setData path.
    rateEpoch,
  };
}


/**
 * Compose the provisional tip onto the canonical series. Both inputs are
 * ascending; `canonicalThrough` is the newest canonical bucket time.
 *   - provisional bucket >  canonicalThrough → appended (mutable extension)
 *   - provisional bucket == canonicalThrough → combined into the canonical
 *     tip: canonical open, widened high/low, provisional close (the freshest
 *     trade — provisional folds every trade SEEN, canonical only those
 *     FINALIZED, so its close is at least as new)
 *   - provisional bucket <  canonicalThrough → dropped (canonical owns it)
 * Returns `canonical` by identity when nothing applies. Exported for tests.
 */
export function applyProvisionalTip(
  canonical: CandlestickData<Time>[],
  provisional: CandlestickData<Time>[],
  canonicalThrough: number,
): CandlestickData<Time>[] {
  if (provisional.length === 0) return canonical;
  const ahead = provisional.filter((candle) => Number(candle.time) > canonicalThrough);
  const atTip = provisional.find((candle) => Number(candle.time) === canonicalThrough);
  if (ahead.length === 0 && atTip === undefined) return canonical;
  let out = canonical;
  if (atTip !== undefined && canonical.length > 0) {
    const tip = canonical[canonical.length - 1]!;
    out = canonical.slice(0, canonical.length - 1);
    out.push({
      time: tip.time,
      open: tip.open,
      high: Math.max(tip.high, atTip.high),
      low: Math.min(tip.low, atTip.low),
      close: atTip.close,
    });
  } else if (out === canonical && ahead.length > 0) {
    out = canonical.slice();
  }
  for (const candle of ahead) out.push(candle);
  return out;
}

// Both inputs are always time-sorted ascending (every producer runs through
// `toSortedCandles`), so a linear two-pointer merge yields the same sorted, deduped result
// as the old Map+full-sort — but O(n+m) instead of O((n+m)·log(n+m)). This runs on every
// live trade (via `mergedSeed`/`visibleCandles`), so it's a hot path at scale. On equal
// time, `b` wins (matching the old "insert a, then overwrite with b" semantics).
function mergeCandles(
  a: CandlestickData<Time>[],
  b: CandlestickData<Time>[],
): CandlestickData<Time>[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out: CandlestickData<Time>[] = [];
  let i = 0;
  let j = 0;
  const pushCandle = (candle: CandlestickData<Time>): void => {
    const last = out[out.length - 1];
    if (last !== undefined && Number(last.time) === Number(candle.time)) {
      out[out.length - 1] = candle; // collapse duplicate time, keep latest
    } else {
      out.push(candle);
    }
  };
  while (i < a.length && j < b.length) {
    const ta = Number(a[i].time);
    const tb = Number(b[j].time);
    if (ta < tb) {
      pushCandle(a[i]);
      i += 1;
    } else if (tb < ta) {
      pushCandle(b[j]);
      j += 1;
    } else {
      pushCandle(b[j]); // equal time → b wins
      i += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    pushCandle(a[i]);
    i += 1;
  }
  while (j < b.length) {
    pushCandle(b[j]);
    j += 1;
  }
  return out;
}

// Same two-pointer replacement as `mergeCandles` above, for the snapshot
// bucket layer: both inputs are always sorted ascending by `bucketStartSec`
// (server pages, prior merges, SSE patches), and every bucket in this hook
// shares the fetch resolution (`resolution=${timeframe}` on both pages), so
// the old `${resolution}:${bucketStartSec}` Map key degenerates to the
// numeric field — O(n+m) instead of Map + full sort per candles event. On
// equal bucket, `b` wins (matching the old "insert a, then overwrite with b"
// semantics). Exported for tests.
export function mergeSnapshotCandles(
  a: SnapshotCandle[],
  b: SnapshotCandle[],
): SnapshotCandle[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out: SnapshotCandle[] = [];
  let i = 0;
  let j = 0;
  const pushBucket = (candle: SnapshotCandle): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.bucketStartSec === candle.bucketStartSec) {
      out[out.length - 1] = candle; // collapse duplicate bucket, keep latest
    } else {
      out.push(candle);
    }
  };
  while (i < a.length && j < b.length) {
    const ta = a[i]!.bucketStartSec;
    const tb = b[j]!.bucketStartSec;
    if (ta < tb) {
      pushBucket(a[i]!);
      i += 1;
    } else if (tb < ta) {
      pushBucket(b[j]!);
      j += 1;
    } else {
      pushBucket(b[j]!); // equal bucket → b wins
      i += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    pushBucket(a[i]!);
    i += 1;
  }
  while (j < b.length) {
    pushBucket(b[j]!);
    j += 1;
  }
  return out;
}

/**
 * Decide whether a latest-page refetch can be incremental. With a cached
 * page holding candles, returns the `sinceBucketStartSec` cutoff (fetch only
 * buckets at/after it); null means full fetch (no cache / empty cache).
 * The heal window must cover the region the SSE live-overlay has been
 * patching since the last reconcile (30s cadence, with margin) — those
 * newest cached buckets are provisional, and the reconcile's purpose is
 * healing drift in that tail. `stepSec` is the NATIVE fetch resolution's
 * bucket step. Exported for tests.
 */
export function planCandleReconcile(
  cached: TokenCandlesResponse | undefined,
  stepSec: number,
): { sinceBucketStartSec: number } | null {
  const candles = cached?.candles;
  if (!candles || candles.length === 0) return null;
  const windowBuckets = Math.min(Math.max(Math.ceil(90 / stepSec), 8), 120);
  const lastBucketStartSec = candles[candles.length - 1]!.bucketStartSec;
  return {
    sinceBucketStartSec: Math.max(0, lastBucketStartSec - windowBuckets * stepSec),
  };
}

/**
 * Splice an incremental reconcile body over the cached page: cached rows
 * keep the deep history, fresh server rows win on overlapping buckets (they
 * are the canonical heal), and `hasMoreOlder` is preserved from the cached
 * full page — the incremental body is short by construction, so the
 * server-computed value on the fresh response is not meaningful for
 * pagination (dropping it would break the scrollback affordance).
 * Exported for tests.
 */
export function mergeReconciledCandles(
  cached: TokenCandlesResponse,
  fresh: TokenCandlesResponse,
): TokenCandlesResponse {
  return {
    ...fresh,
    // `b` wins on equal bucket in mergeSnapshotCandles — fresh must be `b`.
    candles: mergeSnapshotCandles(cached.candles, fresh.candles),
    hasMoreOlder: cached.hasMoreOlder,
  };
}

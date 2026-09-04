'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TOKENS_BATCH_MAX_MINTS,
  fetchTokenSnapshotsBatch,
} from '@/components/trade/tokenSnapshotFetch';
import { isStubSnapshot } from '@/components/trade/types';
import type { SnapshotCandle, TokenCandlesResponse } from '@/components/trade/types';
import { ingestionApiUrl } from '@/lib/api/ingestion';

/**
 * Market data for the navbar watchlist chips: market cap + 24h % change
 * per watched mint.
 *
 * Two cadences, deliberately (cheap at scale — no per-mint SSE streams,
 * no fan-out of trade-page-grade costs onto a chip strip):
 *
 * - FAST (30s): one lite `GET /api/tokens` batch per 30 mints — scalar
 *   header stats only (market cap + the exact price rational). Mirrors
 *   useAlphaLiveStats' polling rationale; skips hidden tabs and stacked
 *   ticks.
 * - SLOW (10min): the 24h REFERENCE price per mint, from one
 *   `/candles?resolution=1h&limit=25` read each — the reference barely
 *   moves (it slides one hour-bucket per hour), so re-reading it every
 *   fast tick would be pure waste. For coins younger than 24h the oldest
 *   candle is the launch price, so the figure honestly degrades to
 *   "change since launch".
 *
 * The % change is computed in RATIO space (lamports-of-quote per base
 * unit): the snapshot's `priceLamports_num/_den` and the candle's
 * `open_num/_den` share that basis, so no USD conversion of a historical
 * price (which we don't have) is needed and the figure matches the
 * chart's own change convention.
 */
const FAST_POLL_MS = 30_000;
const REF_REFRESH_MS = 10 * 60_000;
const REF_FETCH_CONCURRENCY = 3;

export interface WatchlistQuote {
  marketCapUsd: number | null;
  /** 24h price change (percent, e.g. +42.5). Null until the reference
   *  candle resolves — and null for coins with NO trade in the last 24h
   *  (no in-window reference exists) — render an em-dash, never a fake
   *  0 and never a change measured over a longer, mislabeled span. */
  change24hPct: number | null;
  symbol: string | null;
}

const EMPTY_QUOTES: ReadonlyMap<string, WatchlistQuote> = new Map();

function ratioToNumber(num: string | undefined, den: string | undefined): number | null {
  if (!num || !den) return null;
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0 || n < 0) return null;
  return n / d;
}

function candleOpenRatio(candle: SnapshotCandle | undefined): number | null {
  if (!candle) return null;
  return ratioToNumber(candle.open_num, candle.open_den);
}

export function useWatchlistQuotes(
  mints: readonly string[],
  paused: boolean,
): ReadonlyMap<string, WatchlistQuote> {
  const [quotes, setQuotes] = useState<ReadonlyMap<string, WatchlistQuote>>(EMPTY_QUOTES);
  const inFlight = useRef(false);
  // mint → { ratio (24h-ago open), fetchedAtMs }. Kept in a ref: reference
  // updates must not re-render on their own — the fast tick folds them in.
  const refPriceRef = useRef<Map<string, { ratio: number | null; atMs: number }>>(new Map());
  const refInFlight = useRef(false);
  // Latest live price ratio per mint, so a slow-loop completion can
  // recompute change% without waiting for the next fast tick.
  const liveRatioRef = useRef<Map<string, number>>(new Map());
  // Mirror of the committed map for the slow tick's fold-in (state reads
  // inside the closure would be stale; the ref always holds the latest).
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  // Key the effect on membership, not array identity (useAlphaLiveStats).
  const mintsKey = mints.join(',');

  useEffect(() => {
    const mintList = mintsKey.length > 0 ? mintsKey.split(',') : [];
    const keep = new Set(mintList);
    // Drop state for mints that left the watchlist so maps stay bounded.
    for (const map of [refPriceRef.current, liveRatioRef.current]) {
      for (const mint of [...map.keys()]) {
        if (!keep.has(mint)) map.delete(mint);
      }
    }
    setQuotes((prev) => {
      if (![...prev.keys()].some((mint) => !keep.has(mint))) return prev;
      const next = new Map<string, WatchlistQuote>();
      for (const [mint, value] of prev) {
        if (keep.has(mint)) next.set(mint, value);
      }
      return next;
    });
    if (paused || mintList.length === 0) return undefined;

    let disposed = false;
    const controller = new AbortController();

    const changePctFor = (mint: string): number | null => {
      const live = liveRatioRef.current.get(mint);
      const ref = refPriceRef.current.get(mint)?.ratio;
      if (live == null || ref == null || ref <= 0) return null;
      return (live / ref - 1) * 100;
    };

    const applyQuotes = (fresh: Array<[string, WatchlistQuote]>) => {
      if (disposed || fresh.length === 0) return;
      setQuotes((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [mint, value] of fresh) {
          const before = prev.get(mint);
          if (
            !before ||
            before.marketCapUsd !== value.marketCapUsd ||
            before.change24hPct !== value.change24hPct ||
            before.symbol !== value.symbol
          ) {
            next.set(mint, value);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const fastTick = async () => {
      if (inFlight.current || document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        const fresh: Array<[string, WatchlistQuote]> = [];
        // The watchlist cap (50) exceeds one batch (30): sequential chunks,
        // never parallel batches (mirrors the cohort-tools rule — burst
        // concurrency is how shared backends fall over).
        for (let i = 0; i < mintList.length && !disposed; i += TOKENS_BATCH_MAX_MINTS) {
          const chunk = mintList.slice(i, i + TOKENS_BATCH_MAX_MINTS);
          let batched;
          try {
            batched = await fetchTokenSnapshotsBatch(chunk, controller.signal, true);
          } catch {
            continue; // chip keeps previous values until the next tick
          }
          for (const mint of chunk) {
            const snap = batched.get(mint);
            if (!snap || isStubSnapshot(snap)) continue;
            const live = ratioToNumber(snap.priceLamports_num, snap.priceLamports_den);
            if (live != null) liveRatioRef.current.set(mint, live);
            fresh.push([
              mint,
              {
                marketCapUsd: Number.isFinite(snap.marketCapUsd) ? snap.marketCapUsd : null,
                change24hPct: changePctFor(mint),
                symbol: snap.symbol || null,
              },
            ]);
          }
        }
        applyQuotes(fresh);
      } finally {
        inFlight.current = false;
      }
    };

    const refTick = async () => {
      if (refInFlight.current || document.visibilityState === 'hidden') return;
      refInFlight.current = true;
      try {
        const now = Date.now();
        const due = mintList.filter((mint) => {
          const entry = refPriceRef.current.get(mint);
          return !entry || now - entry.atMs >= REF_REFRESH_MS;
        });
        for (let i = 0; i < due.length && !disposed; i += REF_FETCH_CONCURRENCY) {
          const chunk = due.slice(i, i + REF_FETCH_CONCURRENCY);
          await Promise.all(
            chunk.map(async (mint) => {
              try {
                // Candle buckets are SPARSE (a bucket exists only for a
                // traded hour), so "the oldest of 25" could be days or
                // weeks old on a quiet coin — a mislabeled span. Bound the
                // window server-side instead: only buckets from the last
                // 24h come back, so candles[0] is the oldest IN-WINDOW
                // trade (the launch candle for coins younger than 24h),
                // and a coin with no trade in 24h has no reference — the
                // chip renders an em-dash rather than a wrong number.
                const sinceBucketStartSec =
                  Math.floor((Date.now() / 1000 - 24 * 3600) / 3600) * 3600;
                const url = ingestionApiUrl(
                  `/api/token/${encodeURIComponent(mint)}/candles?resolution=1h&limit=25&sinceBucketStartSec=${sinceBucketStartSec}`,
                );
                const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) {
                  void response.body?.cancel().catch(() => undefined);
                  return;
                }
                const payload = (await response.json()) as TokenCandlesResponse;
                const oldest = payload.candles?.find(
                  (candle) => candle.bucketStartSec >= sinceBucketStartSec,
                );
                refPriceRef.current.set(mint, {
                  ratio: candleOpenRatio(oldest),
                  atMs: Date.now(),
                });
              } catch {
                // Missing reference: the chip renders an em-dash for the %
                // until a later pass succeeds.
              }
            }),
          );
        }
        // Fold fresh references into visible change% without waiting for
        // the next fast tick.
        applyQuotes(
          mintList.flatMap((mint): Array<[string, WatchlistQuote]> => {
            const current = quotesRef.current.get(mint);
            if (!current) return [];
            const pct = changePctFor(mint);
            if (pct === current.change24hPct) return [];
            return [[mint, { ...current, change24hPct: pct }]];
          }),
        );
      } finally {
        refInFlight.current = false;
      }
    };

    void fastTick().then(() => void refTick());
    const fastTimer = window.setInterval(() => void fastTick(), FAST_POLL_MS);
    const refTimer = window.setInterval(() => void refTick(), 60_000);
    // Ticks skip while hidden — refresh immediately on tab return instead
    // of showing up-to-30s-stale caps until the next interval fires.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void fastTick().then(() => void refTick());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(fastTimer);
      window.clearInterval(refTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mintsKey, paused]);

  return quotes;
}

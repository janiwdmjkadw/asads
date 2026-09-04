import { useEffect, useRef, useState } from 'react';
import { releaseResponseBody } from '@/lib/api/http';
import { ingestionApiUrl } from '@/lib/api/ingestion';
import type { TokenTrade } from './types';
import type { ChartTimeframe } from './timeframes';

export interface CandleTradeSelection {
  timeframe: ChartTimeframe;
  bucketStartSec: number;
}

interface CandleTradesResponse {
  trades?: TokenTrade[];
}

interface UseCandleTradesResult {
  trades: TokenTrade[];
  loading: boolean;
  error: string | null;
}

// A hot mint ticks `refreshKey` on EVERY live trade; coalesce the silent
// revalidations to one trailing fetch per window instead of a fetch (and an
// abort of the previous one) per trade. New selections still fetch instantly.
const REFRESH_DEBOUNCE_MS = 400;

export function useCandleTrades(
  mint: string | null | undefined,
  selection: CandleTradeSelection | null,
  refreshKey: number | string | null | undefined,
): UseCandleTradesResult {
  const [trades, setTrades] = useState<TokenTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mint || !selection) {
      setTrades([]);
      setLoading(false);
      setError(null);
      selectionKeyRef.current = null;
      return;
    }

    // A `refreshKey` tick is a new live trade on the SAME selected candle — revalidate
    // silently (keep the current rows, no loading flicker). Only a genuinely new bucket
    // (mint/timeframe/bucket changed) clears rows and shows the loading state, so a hot
    // mint's per-trade ticks can't pin the drilldown on a spinner or abort-refetch loop.
    const selectionKey = `${mint}:${selection.timeframe}:${selection.bucketStartSec}`;
    const isNewSelection = selectionKeyRef.current !== selectionKey;
    selectionKeyRef.current = selectionKey;

    const controller = new AbortController();
    let cancelled = false;
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    if (isNewSelection) {
      setTrades([]);
      setLoading(true);
    }
    setError(null);

    const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/trades`
      + `?resolution=${encodeURIComponent(selection.timeframe)}`
      + `&bucketStartSec=${encodeURIComponent(String(selection.bucketStartSec))}`);
    if (!url) {
      setTrades([]);
      setLoading(false);
      setError(null);
      return;
    }

    const run = () => {
      void fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(async (resp) => {
          if (!resp.ok) {
            releaseResponseBody(resp);
            throw new Error(`http_${resp.status}`);
          }
          return (await resp.json()) as CandleTradesResponse;
        })
        .then((body) => {
          if (cancelled) return;
          setTrades(Array.isArray(body.trades) ? body.trades : []);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled || controller.signal.aborted) return;
          setError(err instanceof Error ? err.message.slice(0, 64) : 'error');
          setLoading(false);
        });
    };
    if (isNewSelection) {
      run();
    } else {
      // refreshKey tick: trailing debounce so a burst of live trades on the
      // same candle collapses into one revalidation (each newer tick's effect
      // cleanup cancels the previous pending timer).
      debounceHandle = setTimeout(run, REFRESH_DEBOUNCE_MS);
    }

    return () => {
      cancelled = true;
      if (debounceHandle !== null) clearTimeout(debounceHandle);
      controller.abort();
    };
  }, [mint, refreshKey, selection]);

  return { trades, loading, error };
}

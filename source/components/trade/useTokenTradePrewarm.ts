'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { timeframeFetchPlan } from './timeframes';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { prefetchToken } from '@/components/listen/navigation';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import {
  fetchIngestionJson,
  isIngestionApiConfigured,
} from '@/lib/api/ingestion';
import { useTradeStore } from '@/lib/state/trade-store';
import { holdersSyncKey, type HoldersSyncState } from './holdersTopDelta';
import type {
  TokenCandlesResponse,
  TokenHoldersResponse,
  TokenTopTradersResponse,
} from './types';
import { fetchTokenSnapshotForCache } from './tokenSnapshotFetch';

const SNAPSHOT_FRESH_MS = 1_500;
const WARM_THROTTLE_MS = 1_000;
// Panels (candles / holders / top-traders) are heavier to warm than the snapshot
// (the analytics store aggregation + holder/balance RPC), so we throttle them harder and warm
// them only on real engage intent. `PANEL_FRESH_MS` keeps the prefetched React Query
// entries fresh just long enough that the click reuses them without an immediate
// refetch; each panel hook then takes over its own 5s polling.
const PANEL_WARM_THROTTLE_MS = 2_500;
const PANEL_FRESH_MS = 2_500;
const PANEL_LIMIT = 100;
// The throttle maps only need entries younger than their throttle window;
// prune expired ones once the map grows past this (same pattern as
// warm-mints.ts) so a long session over a churning feed stays bounded.
const WARM_MAP_MAX_ENTRIES = 1_000;

function pruneWarmMap(map: Map<string, number>, now: number, ttlMs: number): void {
  if (map.size <= WARM_MAP_MAX_ENTRIES) return;
  for (const [key, warmedAt] of map) {
    if (now - warmedAt >= ttlMs) map.delete(key);
  }
}
// MUST stay equal to LATEST_CHUNK_LIMIT in useCandleHistory.ts (shared
// query key — the prefetched page must match what the chart consumes).
const CANDLE_LATEST_LIMIT = 1_500;
const lastPanelWarmAtByMint = new Map<string, number>();
// Dwell re-warm cadence while a card stays actively engaged (hover /
// focus held). The heavy data warms (full snapshot + holders +
// top-traders + the 1,500-candle page) only need one warm copy per
// engagement for the click to paint instantly, but their freshness
// windows (1-2.5s) lapse during a long dwell — re-run them every 30s so
// the eventual click still lands warm. There is deliberately NO
// the backend service quote keepalive on these ticks: the engine's cold read is
// a ~1ms loopback snapshot and the click path re-reads at click time
// anyway, so a periodic quote touch buys nothing.
const DWELL_REWARM_INTERVAL_MS = 30_000;
const lastWarmAtByKey = new Map<string, number>();

export function warmTokenTradeData(
  queryClient: QueryClient,
  mint: string,
  options: { hydrateIdentity?: boolean; graduated?: boolean } = {},
): void {
  if (!mint) return;
  const hydrateIdentity = options.hydrateIdentity === true;
  const queryKey = queryKeys.token.snapshot(mint, hydrateIdentity);
  const state = queryClient.getQueryState(queryKey);
  const now = Date.now();
  if (state?.dataUpdatedAt && now - state.dataUpdatedAt <= SNAPSHOT_FRESH_MS) return;

  const warmKey = `${mint}:${hydrateIdentity ? 'identity' : 'snapshot'}`;
  const lastWarmAt = lastWarmAtByKey.get(warmKey) ?? 0;
  if (now - lastWarmAt < WARM_THROTTLE_MS) return;
  lastWarmAtByKey.set(warmKey, now);
  pruneWarmMap(lastWarmAtByKey, now, WARM_THROTTLE_MS);

  void queryClient.prefetchQuery({
    queryKey,
    staleTime: SNAPSHOT_FRESH_MS,
    queryFn: ({ signal }) => fetchTokenSnapshotForCache(mint, hydrateIdentity, signal),
  }).catch(() => undefined);
}

/**
 * Warm the trade page's data panels so a click renders them instantly instead of
 * paying the cold cost on mount:
 *  - holders + top-traders are React Query–backed, so a `prefetchQuery` primes BOTH
 *    the client cache (instant first paint) and the server-side Redis aggregate;
 *  - the candle chart's "latest" page is React Query–backed too (same key the
 *    selected-token SSE patcher keeps live), so its `prefetchQuery` equally primes
 *    the client cache and the server-side Redis chart key in one download.
 *
 * Throttled per mint so a dwell/heartbeat can't fan the analytics store + holder/balance RPC
 * out across every tick. Best-effort: failures never surface.
 */
export function warmTokenPanels(queryClient: QueryClient, mint: string): void {
  if (!mint || !isIngestionApiConfigured()) return;
  const now = Date.now();
  const lastWarmAt = lastPanelWarmAtByMint.get(mint) ?? 0;
  if (now - lastWarmAt < PANEL_WARM_THROTTLE_MS) return;
  lastPanelWarmAtByMint.set(mint, now);
  pruneWarmMap(lastPanelWarmAtByMint, now, PANEL_WARM_THROTTLE_MS);

  void queryClient
    .prefetchQuery({
      queryKey: queryKeys.token.topHolders(mint, 1),
      staleTime: PANEL_FRESH_MS,
      queryFn: async ({ signal }) => {
        const body = await fetchIngestionJson<TokenHoldersResponse>(
          `/api/token/${encodeURIComponent(mint)}/holders?limit=${PANEL_LIMIT}&page=1`,
          { signal },
        );
        // This body is UNVERSIONED truth from its own moment, but the
        // mint's sync record (holdersTopDelta.ts) may still claim the last
        // `?v=` fetch's version — a stream top-delta with that baseVersion
        // would then apply onto a base it wasn't computed against and
        // silently corrupt balances/supplyPct/ranks. Re-mark the record
        // exactly as useTopHolders does for a versionless fetch: deltas
        // refuse to apply until the next versioned fetch re-establishes it.
        queryClient.setQueryData<HoldersSyncState>(holdersSyncKey(mint), {
          appliedVersion: null,
          enrichedAtMs: Date.now(),
        });
        return body;
      },
    })
    .catch(() => undefined);

  void queryClient
    .prefetchQuery({
      queryKey: queryKeys.token.topTraders(mint, 1),
      staleTime: PANEL_FRESH_MS,
      queryFn: ({ signal }) =>
        fetchIngestionJson<TokenTopTradersResponse>(
          `/api/token/${encodeURIComponent(mint)}/top-traders?limit=${PANEL_LIMIT}&page=1`,
          { signal },
        ),
    })
    .catch(() => undefined);

  // Warm the same candle resolution the chart will open with (persisted store
  // default), at the exact `limit` the latest fetch uses, under the exact query key
  // `useCandleHistory` reads (and the selected-token SSE stream patches) — so the
  // click reuses this download instead of re-fetching the identical payload.
  const resolution = timeframeFetchPlan(useTradeStore.getState().chartInterval).resolution;
  void queryClient
    .prefetchQuery({
      queryKey: queryKeys.token.candles(mint, resolution, null),
      staleTime: PANEL_FRESH_MS,
      queryFn: ({ signal }) =>
        fetchIngestionJson<TokenCandlesResponse>(
          `/api/token/${encodeURIComponent(mint)}/candles?resolution=${encodeURIComponent(resolution)}&limit=${CANDLE_LATEST_LIMIT}`,
          { signal },
        ),
    })
    .catch(() => undefined);
}

export function useTokenTradePrewarm(
  mint: string | null | undefined,
  options: { hydrateIdentity?: boolean; graduated?: boolean } = {},
): {
  prewarm: () => void;
  prewarmNow: () => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  visibleRef: RefObject<HTMLDivElement | null>;
} {
  const queryClient = useQueryClient();
  const visibleRef = useRef<HTMLDivElement | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydrateIdentity = options.hydrateIdentity === true;
  // Heavy data warms only (snapshot + panels) — what the dwell interval
  // re-runs. Hidden-tab guard: alt-tab with the cursor parked on a card
  // fires neither pointerleave nor blur, so the interval keeps ticking;
  // skipping here makes those ticks no-ops and the visibilitychange
  // handler below re-warms the instant we're back.
  const heavyDataWarm = useCallback(() => {
    if (!mint) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    warmTokenTradeData(queryClient, mint, { hydrateIdentity });
    // Prime the chart + holders + top-traders so the trade page renders them
    // instantly on click instead of fetching cold on mount. Throttled per mint.
    // Fully isolated from the quote/nonce warm in prewarmImpl: it only issues
    // best-effort GETs against the ingestion read API, and a guard guarantees
    // an unexpected throw here can never skip the the backend service prewarm.
    try {
      warmTokenPanels(queryClient, mint);
    } catch {
      // best-effort panel warm only
    }
  }, [hydrateIdentity, mint, queryClient]);
  // `immediate` bypasses the 250ms client coalesce so the warm POST
  // leaves the instant a buy is intended (pointer-down on the quickbuy
  // chip / the order handler self-warm), giving the warm a head start
  // on the order POST.
  const prewarmImpl = useCallback((immediate: boolean) => {
    if (!mint) return;
    // Same hidden-tab rationale as heavyDataWarm.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    /* Route-RSC prefetch only on COMMIT intent (pointer-down / order
       self-warm), not on hover dwell: on Next 15.5 every prefetched URL
       permanently pins ~1.6MB of renderer-native memory (see
       app/providers.tsx), so hovering across a churning feed must not fan
       it out. The data warms below are what make the trade page paint
       instantly and they stay on hover; the route fetch overlapping the
       click costs no visible latency. */
    if (immediate) prefetchToken(mint);
    heavyDataWarm();
    // Quickbuy/prewarm wire: one touch of the the backend service active-quote +
    // active-prewarm caches per engagement. The engine's cold read is a
    // ~1ms loopback snapshot (no keepalive needed); the touch mostly
    // matters for the graduated hint, which triggers AMM pool discovery.
    //
    // Synchronous read from the Clerk session mirror — no Promise,
    // no microtask. `<ClerkSessionSync />` keeps this fresh; when
    // it's stale, api/ returns 401 → user reauths.
    const session = getClerkSession();
    if (session.isSignedIn === true) {
      prewarmMints([mint], session.token, {
        graduatedMints: options.graduated === true ? [mint] : [],
        ...(immediate ? { immediate: true } : {}),
      });
    }
  }, [heavyDataWarm, mint, options.graduated]);
  // Coalesced warm — used by the hover/focus heartbeat where a 250ms
  // batch is fine (the user is dwelling, not racing a click).
  const prewarm = useCallback(() => prewarmImpl(false), [prewarmImpl]);
  // Immediate warm — used on explicit buy intent (pointer-down /
  // handler self-warm) to give the warm a head start on the order POST.
  const prewarmNow = useCallback(() => prewarmImpl(true), [prewarmImpl]);

  // Dwell re-warm: one FULL warm on engagement start (heavy data warms +
  // a single the backend service quote touch), then heavy-data-only re-runs every
  // DWELL_REWARM_INTERVAL_MS while the engagement holds. No quote touch
  // on the interval ticks — the engine no longer needs a keepalive (its
  // cold read is a ~1ms loopback snapshot and the click path re-reads at
  // click time), so the periodic work is purely keeping the UI data
  // caches paint-ready.
  // Refocus listener rides the heartbeat lifecycle: this hook mounts per
  // card (~180 on a full Discover page), and at most one card is hovered —
  // registering document-level listeners only while a heartbeat is live
  // keeps it to at most one listener instead of one per card.
  const visibilityListenerRef = useRef<(() => void) | null>(null);

  const startHeartbeat = useCallback(() => {
    if (!mint) return;
    if (heartbeatRef.current !== null) return;
    // Engagement start: full warm (heavy data + one quote touch).
    prewarmImpl(false);
    heartbeatRef.current = setInterval(heavyDataWarm, DWELL_REWARM_INTERVAL_MS);
    // Refocus with the cursor still parked on the card: the interval's
    // ticks were skipped while hidden, so re-warm immediately instead of
    // waiting up to one interval (mirrors TradePage's visibilitychange
    // re-warm). Full warm INCLUDING the quote touch — refocus is a fresh
    // engagement, same signal strength as the first warm — but still
    // coalesced and with no route-RSC prefetch (not a commit signal).
    if (visibilityListenerRef.current === null) {
      const onVisibilityChange = (): void => {
        if (document.hidden) return;
        if (heartbeatRef.current === null) return;
        prewarmImpl(false);
      };
      visibilityListenerRef.current = onVisibilityChange;
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }, [mint, prewarmImpl, heavyDataWarm]);

  const stopHeartbeat = useCallback(() => {
    if (visibilityListenerRef.current !== null) {
      document.removeEventListener('visibilitychange', visibilityListenerRef.current);
      visibilityListenerRef.current = null;
    }
    if (heartbeatRef.current === null) return;
    clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }, []);

  // Safety net: if the component unmounts while hovered (route change,
  // virtualized list scroll), the heartbeat must die with it.
  useEffect(() => {
    return () => {
      if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      if (visibilityListenerRef.current !== null) {
        document.removeEventListener('visibilitychange', visibilityListenerRef.current);
        visibilityListenerRef.current = null;
      }
    };
  }, []);

  return { prewarm, prewarmNow, startHeartbeat, stopHeartbeat, visibleRef };
}

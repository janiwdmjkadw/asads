'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TOKENS_BATCH_MAX_MINTS,
  fetchTokenSnapshotForCache,
  fetchTokenSnapshotsBatch,
} from '@/components/trade/tokenSnapshotFetch';
import { normalizeSocialUrl, normalizeWebsiteUrl } from '@/components/trade/snapshotAdapter';
import { isStubSnapshot } from '@/components/trade/types';
import type { TokenSnapshot } from '@/components/trade/types';
import type { AlphaLiveTokenStats } from '@/lib/api/alpha-calls-shared';

/**
 * Keeps the Discover alpha lane ALIVE: polls the ingestion read API's
 * per-mint snapshot for every called coin and returns a mint → live-stats
 * map the lane overlays onto its call-time snapshots (market cap, 5m
 * volume, txn count, and the since-call % baseline comparison).
 *
 * Polling, not streaming, on purpose: called coins are arbitrary mints so
 * they aren't guaranteed to be in the top-N Discover feed frames, and one
 * SSE stream per card (`/token/:mint/stream`) is a trade-page-grade cost
 * the lane must not fan out ×30. The lane is bounded at MAX_FEED_CALLS
 * (30) mints; a 5s tick over warm snapshot reads is cheap on both sides.
 *
 * Pauses whenever the Discover pane is hidden (`paused` — trade-page
 * dwell) or the tab is backgrounded, and skips a tick while the previous
 * one is still in flight so slow networks never stack requests. Map
 * identity is stable across no-change ticks, so downstream memos skip.
 */
const POLL_INTERVAL_MS = 5_000;
const FETCH_CONCURRENCY = 6;

const EMPTY_STATS: ReadonlyMap<string, AlphaLiveTokenStats> = new Map();

function statsFromSnapshot(snap: TokenSnapshot): AlphaLiveTokenStats {
  return {
    marketCapUsd: snap.marketCapUsd,
    vol5mUsd: snap.vol5mUsd,
    vol24hUsd: typeof snap.vol24hUsd === 'number' ? snap.vol24hUsd : null,
    txns: snap.tradeCount,
    buys: snap.buyCount,
    graduated: snap.graduated === true || snap.graduatedAtMs != null,
    quoteMint: snap.quoteMint ?? null,
    // Same normalizers the trade header uses, so a bare "@handle" or
    // schemeless domain becomes a real href.
    twitterUrl: normalizeSocialUrl(snap.metadata?.twitter, 'twitter'),
    telegramUrl: normalizeSocialUrl(snap.metadata?.telegram, 'telegram'),
    websiteUrl: normalizeWebsiteUrl(snap.metadata?.website),
  };
}

export function useAlphaLiveStats(
  mints: readonly string[],
  paused: boolean,
): ReadonlyMap<string, AlphaLiveTokenStats> {
  const [stats, setStats] = useState<ReadonlyMap<string, AlphaLiveTokenStats>>(EMPTY_STATS);
  const inFlight = useRef(false);
  // Key the effect on membership, not array identity — the page re-derives
  // the mints array every feed tick and a restart would reset the timer.
  const mintsKey = mints.join(',');

  useEffect(() => {
    const mintList = mintsKey.length > 0 ? mintsKey.split(',') : [];
    // Drop stats for mints that left the lane (call aged out of the feed
    // window) so the map stays bounded by the lane, not the session.
    setStats((prev) => {
      const keep = new Set(mintList);
      if (![...prev.keys()].some((mint) => !keep.has(mint))) return prev;
      const next = new Map<string, AlphaLiveTokenStats>();
      for (const [mint, value] of prev) {
        if (keep.has(mint)) next.set(mint, value);
      }
      return next;
    });
    if (paused || mintList.length === 0) return undefined;

    let disposed = false;
    const controller = new AbortController();

    const tick = async () => {
      if (inFlight.current || document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        const fresh: Array<[string, AlphaLiveTokenStats]> = [];
        // One batched GET /api/tokens per tick instead of one GET per mint
        // (30x fewer requests — the lane was the page's biggest per-user
        // request multiplier). A missing/stub mint keeps its previous
        // stats, exactly like the per-mint path's catch. On batch failure
        // (endpoint down, proxy error) fall back to the per-mint fetches
        // so the lane never goes stale behind a single broken route.
        let batched: Map<string, TokenSnapshot> | null = null;
        try {
          batched = await fetchTokenSnapshotsBatch(
            mintList.slice(0, TOKENS_BATCH_MAX_MINTS),
            controller.signal,
          );
        } catch {
          batched = null;
        }
        if (batched !== null) {
          for (const mint of mintList) {
            const snap = batched.get(mint);
            // Stubs carry no real economics yet — keep call-time values.
            if (!snap || isStubSnapshot(snap)) continue;
            fresh.push([mint, statsFromSnapshot(snap)]);
          }
        } else {
          for (let i = 0; i < mintList.length && !disposed; i += FETCH_CONCURRENCY) {
            const chunk = mintList.slice(i, i + FETCH_CONCURRENCY);
            const results = await Promise.all(
              chunk.map(async (mint): Promise<[string, AlphaLiveTokenStats] | null> => {
                try {
                  const snap = await fetchTokenSnapshotForCache(mint, false, controller.signal);
                  // Stubs carry no real economics yet — keep call-time values.
                  if (isStubSnapshot(snap)) return null;
                  return [mint, statsFromSnapshot(snap)];
                } catch {
                  // Best-effort: a failed mint keeps its previous stats (or
                  // its call-time snapshot) until the next tick.
                  return null;
                }
              }),
            );
            for (const entry of results) {
              if (entry) fresh.push(entry);
            }
          }
        }
        if (disposed || fresh.length === 0) return;
        setStats((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [mint, value] of fresh) {
            const before = prev.get(mint);
            if (
              !before ||
              before.marketCapUsd !== value.marketCapUsd ||
              before.vol5mUsd !== value.vol5mUsd ||
              before.vol24hUsd !== value.vol24hUsd ||
              before.txns !== value.txns ||
              before.buys !== value.buys ||
              before.graduated !== value.graduated ||
              before.quoteMint !== value.quoteMint ||
              before.twitterUrl !== value.twitterUrl ||
              before.telegramUrl !== value.telegramUrl ||
              before.websiteUrl !== value.websiteUrl
            ) {
              next.set(mint, value);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [mintsKey, paused]);

  return stats;
}

'use client';

import { useEffect, useState } from 'react';

import { fetchEvmCandles, type EvmCandleSeries } from '@/lib/evm/tradeApi';
import { toSparkline, sparklinePoints, type EvmSparkline } from '@/lib/evm/sparkline';

/**
 * A candle sparkline for a chain-bound discover row.
 *
 * WHY A QUEUE RATHER THAN A FETCH PER CARD. The discover lanes cap at 100
 * cards per stage and all four render at once, so a naive `useEffect(fetch)`
 * on mount is up to 400 concurrent candle requests at every lane snapshot —
 * against a proxy that forwards each one to the ingestion box. The queue below
 * bounds in-flight requests to {@link MAX_IN_FLIGHT} regardless of how many
 * cards mount, and a module-level cache with a TTL means a card that unmounts
 * and remounts (a lane re-sort, a chain flip and back) costs nothing.
 *
 * WHY IT DRAWS NOTHING RATHER THAN A PLACEHOLDER SHAPE. A sparkline is a claim
 * about price history. A token with fewer than two priced buckets has no
 * history to claim — the `new` lane is made of them — and a flat line or a
 * shimmering skeleton in the shape of a chart both read as "here is the
 * trend". Absence is the honest render, and it is also why this component
 * occupies no space until it has something: a reserved empty box would imply
 * a chart is coming for tokens where one never will.
 */

/** Candle resolution for the card. 1m over ~48 buckets is ~45 minutes of
 *  shape, which is the window a discover row is actually about. */
const RESOLUTION = '1m' as const;
const MAX_IN_FLIGHT = 3;
/** A card sparkline is ambient; a minute-stale shape is not misleading and
 *  refetching every lane snapshot would defeat the queue entirely. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  readonly at: number;
  readonly sparkline: EvmSparkline | null;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<EvmSparkline | null>>();
let inFlight = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight -= 1;
  const next = queue.shift();
  if (next !== undefined) next();
}

/**
 * One in-flight request per key, shared by every card asking for it.
 *
 * The same token appears in at most one lane, but a chain flip can remount the
 * whole board while the previous request is still queued; without this the
 * queue fills with duplicates and the visible cards wait behind them.
 */
async function loadSparkline(
  apiBase: string,
  chain: string,
  address: string,
): Promise<EvmSparkline | null> {
  const key = `${chain}:${address}`;
  const cached = cache.get(key);
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.sparkline;
  }
  const existing = pending.get(key);
  if (existing !== undefined) return existing;

  const task = (async () => {
    await acquire();
    try {
      const result = await fetchEvmCandles({
        apiBase,
        chain,
        address,
        resolution: RESOLUTION,
      });
      /* Any non-`ok` read caches a `null`. That is deliberate: a 404 for a
         token the indexer does not hold is a stable answer, and retrying it on
         every render would turn the cheapest possible outcome into the most
         expensive. The TTL is the retry. */
      const sparkline =
        result.kind === 'ok' ? toSparkline(result.value as EvmCandleSeries) : null;
      cache.set(key, { at: Date.now(), sparkline });
      return sparkline;
    } catch {
      cache.set(key, { at: Date.now(), sparkline: null });
      return null;
    } finally {
      release();
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

/** Exported for tests: drop everything so one case cannot see another's. */
export function __resetSparklineCache(): void {
  cache.clear();
  pending.clear();
}

const WIDTH = 64;
const HEIGHT = 18;

/** Same wiring as every other EVM read: unset means same-origin through the
 *  api's `/api/v1/evm/*` proxy; the env var is a dev-rig override. Defaulted
 *  here so a card does not have to thread it. */
const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_EVM_INGEST_BASE ?? '';

export function EvmSparkline({
  chain,
  address,
  apiBase = DEFAULT_API_BASE,
}: {
  chain: string;
  address: string;
  apiBase?: string;
}) {
  const [sparkline, setSparkline] = useState<EvmSparkline | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSparkline(apiBase, chain, address).then((next) => {
      if (!cancelled) setSparkline(next);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, chain, address]);

  if (sparkline === null) return null;

  const points = sparklinePoints(sparkline.values, WIDTH, HEIGHT);
  if (points === '') return null;
  /* The card's own up/down tokens, so an EVM row's line reads the same as
     every other rise-and-fall signal on the board. */
  const stroke = sparkline.up ? 'var(--up)' : 'var(--down)';

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      data-testid="evm-card-sparkline"
      data-stale={sparkline.stale ? 'true' : undefined}
      aria-label={
        sparkline.stale
          ? 'Recent price shape. Some buckets are awaiting recomputation after a chain reorganisation.'
          : 'Recent price shape.'
      }
      /* A STALE series is drawn at reduced opacity rather than hidden. Hiding
         it destroys the evidence that a recompute is owed; drawing it at full
         strength presents a figure a reorg already invalidated. */
      style={{ opacity: sparkline.stale ? 0.45 : 1, overflow: 'visible' }}
      className="pointer-events-none shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

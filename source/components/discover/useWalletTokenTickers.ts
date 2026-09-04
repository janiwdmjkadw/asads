import { useEffect, useRef, useState } from 'react';
import { rememberMintCreatedAt } from './walletToastPresentation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  rememberTokenNavigationHint,
  tokenTickerFromNavigationHint,
} from '@/components/listen/navigation';
import { releaseResponseBody } from '@/lib/api/http';
import { ingestionApiUrl } from '@/lib/api/ingestion';
import { queryKeys } from '@/lib/query/keys';
import type { TokenSnapshot } from '@/components/trade/types';
import type { WalletActivityEvent } from './useWalletActivity';

// First retry comes FAST. A brand-new coin's identity typically hydrates
// on the ingestion side within a second or two of the mint (Metaplex JSON
// fetch); a 5s first retry meant the toast wore "UNKNOWN" for most of its
// 6.5s life even though the answer arrived at ~1.5s. 1.5s/3s/6s/12s…
// reaches the same 5min cap for genuinely dead mints in two extra steps.
const RETRY_AFTER_MS = 1_500;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const MAX_RESOLVES_PER_TICK = 8;

interface TickerAttempt {
  at: number;
  tries: number;
}

/**
 * Capped exponential backoff for unresolvable mints (1.5s, 3s, 6s, …
 * capped at 5min). Without it a dead mint in the recent-events window was
 * refetched constantly for the whole session; the cap (instead of a hard
 * give-up) still heals transient outages and late-hydrating identities.
 */
export function tickerRetryDelayMs(tries: number): number {
  return Math.min(RETRY_AFTER_MS * 2 ** tries, MAX_RETRY_AFTER_MS);
}

export function useWalletTokenTickers(
  events: WalletActivityEvent[],
  knownTickers: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const queryClient = useQueryClient();
  const [resolved, setResolved] = useState<Map<string, string>>(() => new Map());
  const attemptedAt = useRef<Map<string, TickerAttempt>>(new Map());
  // One controller for the hook's lifetime: effect re-runs (new events,
  // fresh resolutions) must not abort other in-flight ticker fetches.
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (events.length === 0) return;
    controllerRef.current ??= new AbortController();
    const controller = controllerRef.current;
    const now = Date.now();
    const mints = uniqueMissingMints(events, knownTickers, resolved, attemptedAt.current, now);

    const markResolved = (mint: string, ticker: string) => {
      setResolved((current) => {
        if (current.get(mint) === ticker) return current;
        const next = new Map(current);
        next.set(mint, ticker);
        return next;
      });
    };

    for (const mint of mints.slice(0, MAX_RESOLVES_PER_TICK)) {
      const prior = attemptedAt.current.get(mint);
      attemptedAt.current.set(mint, { at: now, tries: prior ? prior.tries + 1 : 0 });
      // Cheap path first: a token snapshot already in the React Query cache
      // (the user opened this token, or it was prewarmed) carries the
      // identity — no need to download the full snapshot again for a ticker.
      const cachedTicker = tickerFromCachedSnapshot(queryClient, mint);
      if (cachedTicker) {
        markResolved(mint, cachedTicker);
        continue;
      }
      void resolveTicker(mint, controller.signal).then((ticker) => {
        if (!ticker) {
          // Aborted fetches were never real attempts; let them retry.
          if (controller.signal.aborted) attemptedAt.current.delete(mint);
          return;
        }
        markResolved(mint, ticker);
      });
    }
  }, [events, knownTickers, queryClient, resolved]);

  return resolved;
}

function uniqueMissingMints(
  events: WalletActivityEvent[],
  knownTickers: ReadonlyMap<string, string>,
  resolved: ReadonlyMap<string, string>,
  attemptedAt: ReadonlyMap<string, TickerAttempt>,
  now: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const event of events.slice(0, 40)) {
    if (seen.has(event.mint)) continue;
    seen.add(event.mint);
    if (knownTickers.has(event.mint) || resolved.has(event.mint) || tokenTickerFromNavigationHint(event.mint)) {
      continue;
    }
    const attempt = attemptedAt.get(event.mint);
    if (attempt && now - attempt.at < tickerRetryDelayMs(attempt.tries)) continue;
    out.push(event.mint);
  }
  return out;
}

/** Snapshot-ish shape carrying token identity (full SSE/REST snapshot or
 *  the raw `/api/token/:mint` JSON — both fit structurally). */
interface SnapshotIdentity {
  name?: string | null;
  symbol?: string | null;
  metadata?: {
    name?: string | null;
    symbol?: string | null;
    image?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
  } | null;
}

/** Extract a clean ticker from a snapshot and remember the identity as a
 *  navigation hint (so future lookups hit the hint cache instead). */
function tickerFromSnapshotIdentity(mint: string, snap: SnapshotIdentity): string | null {
  const symbol = cleanTicker(snap.symbol, mint) ?? cleanTicker(snap.metadata?.symbol, mint);
  const name = cleanTicker(snap.name, mint) ?? cleanTicker(snap.metadata?.name, mint);
  const ticker = symbol ?? name;
  if (!ticker) return null;
  rememberTokenNavigationHint(mint, {
    name: snap.name ?? snap.metadata?.name ?? null,
    symbol: ticker,
    imageUrl: snap.metadata?.image ?? null,
    twitterUrl: snap.metadata?.twitter ?? null,
    telegramUrl: snap.metadata?.telegram ?? null,
    websiteUrl: snap.metadata?.website ?? null,
  });
  return ticker;
}

/** Read the ticker from an already-cached token snapshot (either
 *  `hydrateIdentity` variant of the query key), if one exists. */
function tickerFromCachedSnapshot(queryClient: QueryClient, mint: string): string | null {
  for (const hydrateIdentity of [true, false]) {
    const snap = queryClient.getQueryData<TokenSnapshot | null>(
      queryKeys.token.snapshot(mint, hydrateIdentity),
    );
    if (!snap) continue;
    const ticker = tickerFromSnapshotIdentity(mint, snap);
    if (ticker) return ticker;
  }
  return null;
}

async function resolveTicker(mint: string, signal: AbortSignal): Promise<string | null> {
  try {
    const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}?hydrateIdentity=1`);
    if (!url) return null;
    const resp = await fetch(url, {
      cache: 'no-store',
      signal,
    });
    if (!resp.ok) {
      // Release the unread body — pinned mojo pipes on this per-event path
      // compound across a long session (see lib/api/http.ts).
      releaseResponseBody(resp);
      return null;
    }
    const snap = await resp.json() as SnapshotIdentity;
    // The identity payload carries the creation time — feed the toast age
    // registry so even coins outside every live lane get an age badge.
    rememberMintCreatedAt(mint, (snap as { createdAtMs?: number | null }).createdAtMs);
    return tickerFromSnapshotIdentity(mint, snap);
  } catch {
    return null;
  }
}

function cleanTicker(value: string | null | undefined, mint: string): string | null {
  const cleaned = value?.trim().replace(/^\$/, '');
  if (!cleaned) return null;
  if (cleaned === mint) return null;
  if (/^(unknown|loading|loading metadata)$/i.test(cleaned)) return null;
  return cleaned;
}

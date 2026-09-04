'use client';

import { useQuery } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';

// Creator coin counts for the discover card crown badge ("48/149"):
// how many coins this dev has deployed and how many of them migrated
// (graduated). Backed by ingestion `GET /creator/:creator/coins`, which
// runs one indexed catalog aggregate behind a 60s server cache.

export interface CreatorCoinStats {
  created: number;
  migrated: number;
}

// ── Batched fetch (dataloader) ─────────────────────────────────────────
// Every card with a creator mounts its own useCreatorCoinStats query; on a
// full Discover page that used to fire up to ~150 individual GETs per page
// load (and one more per new mint entering a lane) — the page's biggest
// per-user request multiplier. The per-wallet react-query entries stay
// (cache, staleTime, dedupe all unchanged); only the FETCH coalesces:
// wallets requested within one short window ride a single
// POST /api/creator/coins (server cap 50/request, shares the same 60s
// per-wallet server cache as the single GET). Same coalescer idiom as
// lib/api/warm-mints.ts.
const BATCH_WINDOW_MS = 25;
const BATCH_MAX_WALLETS = 50;

interface PendingCreatorLookup {
  wallet: string;
  resolve: (stats: CreatorCoinStats) => void;
  reject: (err: unknown) => void;
}

let pendingLookups: PendingCreatorLookup[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function fetchCreatorCoinStatsBatched(wallet: string): Promise<CreatorCoinStats> {
  return new Promise((resolve, reject) => {
    pendingLookups.push({ wallet, resolve, reject });
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushPendingLookups();
      }, BATCH_WINDOW_MS);
    }
  });
}

async function flushPendingLookups(): Promise<void> {
  const batch = pendingLookups;
  pendingLookups = [];
  const byWallet = new Map<string, PendingCreatorLookup[]>();
  for (const lookup of batch) {
    const group = byWallet.get(lookup.wallet);
    if (group) group.push(lookup);
    else byWallet.set(lookup.wallet, [lookup]);
  }
  const wallets = [...byWallet.keys()];
  for (let i = 0; i < wallets.length; i += BATCH_MAX_WALLETS) {
    const chunk = wallets.slice(i, i + BATCH_MAX_WALLETS);
    try {
      const res = await fetch(ingestionApiUrl('/api/creator/coins'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallets: chunk }),
      });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new Error(`http_${res.status}`);
      }
      const payload = (await res.json()) as {
        coins?: Record<string, CreatorCoinStats | null>;
      };
      for (const wallet of chunk) {
        const stats = payload.coins?.[wallet] ?? null;
        for (const lookup of byWallet.get(wallet) ?? []) {
          // null = invalid/failed wallet server-side; reject so the query
          // lands in error state exactly like the old per-wallet 4xx/5xx.
          if (stats) lookup.resolve(stats);
          else lookup.reject(new Error('creator_coins_miss'));
        }
      }
    } catch (err) {
      for (const wallet of chunk) {
        for (const lookup of byWallet.get(wallet) ?? []) lookup.reject(err);
      }
    }
  }
}

export function useCreatorCoinStats(creator: string | null | undefined): CreatorCoinStats | null {
  const wallet = creator?.trim() || null;
  const query = useQuery<CreatorCoinStats>({
    queryKey: ['ingestion', 'creator-coins', wallet],
    enabled: wallet !== null && isIngestionApiConfigured(),
    // Counts move only when the dev deploys or graduates another coin —
    // match the server's 60s cache and keep card churn cheap.
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: () => fetchCreatorCoinStatsBatched(wallet!),
  });
  return query.data ?? null;
}

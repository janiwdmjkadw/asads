'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { keepPreviousDataForMint } from '@/lib/query/placeholder';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';

// Chart bubble seed: the COMPLETE per-wallet trade history for one mint
// from the ingestion mirror (`/token/:mint/wallet-trades`). Unlike the
// trades-table page (a 100-row slice) or the hot tape tail, this is the
// same full record for every coin type — new pair, ripening, graduated —
// so dev/self/tracked bubbles render identically everywhere. The live
// tape overlays on top for sub-second freshness; both sides dedupe by
// signature downstream.

/** Total wallet budget across all chunked requests. Sized to the tracker's
 *  MAX_TRACKED_WALLETS (1000) so a power user's bubbles cover every tracked
 *  wallet instead of silently truncating at 200 (cap-mismatch fix, Jul 2026).
 *  The coupled SERVER cap (`MINT_WALLET_TRADES_MAX_WALLETS` in
 *  the backend source, 200) is PER REQUEST — it silently
 *  `.take()`s the first N of one request's list, which would destroy the
 *  client's priority order (dev → self → tracked → snipers → bundlers).
 *  The real invariant is WALLET_TRADES_URL_CHUNK_SIZE <= the server cap;
 *  each chunk stays well under it. */
export const MINT_WALLET_TRADES_MAX_WALLETS = 1_000;

/** URL budget per request. CloudFront hard-rejects URLs over 8,192 bytes
 *  and the edge's default request-line buffer is also 8K; at the 200-wallet
 *  cap one comma-joined `wallets=` query string is ~9.5KB, so the request
 *  would 413 and EVERY bubble (dev/self/tracked included) vanished on
 *  exactly the hottest launches. 100 wallets (100 × ~45 chars + separators
 *  ≈ 4.8KB) stays safely under 8K — do NOT raise past 100. Side benefit:
 *  the server's per-request budgets (≤8,000 rows, per-wallet LIMIT 120)
 *  then apply per chunk. */
export const WALLET_TRADES_URL_CHUNK_SIZE = 100;

/** Split a wallet list into ≤`size`-wallet chunks, preserving order — an
 *  exact partition (`chunks.flat()` === `wallets`). Exported for tests. */
export function chunkWalletList(
  wallets: readonly string[],
  size: number = WALLET_TRADES_URL_CHUNK_SIZE,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < wallets.length; i += size) {
    chunks.push(wallets.slice(i, i + size));
  }
  return chunks;
}

interface MintWalletTradeWire {
  signature?: string;
  wallet?: string;
  isBuy?: boolean;
  solLamports?: string;
  tokens?: string;
  blockTimeMs?: number;
}

export function useMintWalletTrades(
  mint: string | null,
  /** Sorted, comma-joined base58 wallet list (stable identity = stable key). */
  walletsKey: string,
  /** FALSE while the persistent trade pane is hidden — pauses the 30s poll
   *  (up to 10 chunked requests per tick) without dropping cached rows, so
   *  bubbles still paint instantly on reveal (`enabled` stays true). */
  active = true,
): WalletActivityEvent[] {
  const query = useQuery<MintWalletTradeWire[]>({
    queryKey: ['ingestion', 'mint-wallet-trades', mint, walletsKey],
    enabled: mint !== null && mint.length > 0 && walletsKey.length > 0 && isIngestionApiConfigured(),
    // History only grows; the live tape covers the gap between refetches.
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    refetchOnWindowFocus: false,
    // Young coins reclassify wallets on a ~2.5s poll; every new wallet
    // changes `walletsKey` → a brand-new query key → cache miss, which
    // blanked ALL historical bubbles until the refetch landed. Keep the
    // previous wallet-set's rows painted while the superset refetches —
    // same mint only (index 2 of the query key above).
    placeholderData: keepPreviousDataForMint(mint, 2),
    queryFn: async ({ signal }) => {
      // Chunked GETs (not one giant GET, not POST) keep each URL under the
      // 8K CDN/the edge limit while CloudFront still caches per chunk. The
      // query key stays the FULL sorted list, so cache identity is
      // unchanged. Promise.all is deliberately all-or-nothing: a failed
      // chunk rejects the whole query instead of silently hiding a subset
      // of wallets' bubbles, keeping the existing retry semantics honest.
      const chunks = chunkWalletList(walletsKey.split(','));
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const url = ingestionApiUrl(
            `/api/token/${encodeURIComponent(mint!)}/wallet-trades?wallets=${encodeURIComponent(chunk.join(','))}`,
          );
          const res = await fetch(url, { cache: 'no-store', signal });
          if (!res.ok) {
            void res.body?.cancel().catch(() => undefined);
            throw new Error(`http_${res.status}`);
          }
          const body = (await res.json()) as { trades?: MintWalletTradeWire[] };
          return Array.isArray(body.trades) ? body.trades : [];
        }),
      );
      // Plain concat merge — downstream dedupes by (signature, wallet).
      return results.flat();
    },
  });
  return useMemo<WalletActivityEvent[]>(() => {
    const rows = query.data;
    if (!rows || rows.length === 0 || !mint) return EMPTY_EVENTS;
    const events: WalletActivityEvent[] = [];
    for (const row of rows) {
      if (
        typeof row.signature !== 'string'
        || typeof row.wallet !== 'string'
        || typeof row.isBuy !== 'boolean'
        || typeof row.blockTimeMs !== 'number'
      ) {
        continue;
      }
      events.push({
        signature: row.signature,
        slot: 0,
        blockTimeMs: row.blockTimeMs,
        wallet: row.wallet,
        mint,
        isBuy: row.isBuy,
        solLamports: row.solLamports ?? '0',
        tokens: row.tokens ?? '0',
        venue: 'bonding_curve',
        receivedAtMs: row.blockTimeMs,
      });
    }
    return events;
  }, [mint, query.data]);
}

const EMPTY_EVENTS: WalletActivityEvent[] = [];

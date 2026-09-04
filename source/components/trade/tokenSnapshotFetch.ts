import { ingestionApiUrl } from '@/lib/api/ingestion';
import type { TokenSnapshot } from './types';
import { normalizeTokenSnapshot } from './wire';

export async function fetchTokenSnapshotForCache(
  mint: string,
  hydrateIdentity: boolean,
  signal?: AbortSignal,
): Promise<TokenSnapshot> {
  const response = await fetchTokenSnapshotResponse(mint, hydrateIdentity, signal);
  if (!response.ok) {
    // Release the unread body so its mojo data pipe doesn't sit pinned in
    // renderer-native memory until GC (hot path: one warm per feed mint).
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`http_${response.status}`);
  }
  return normalizeTokenSnapshot(await response.json() as TokenSnapshot);
}

export function fetchTokenSnapshotResponse(
  mint: string,
  hydrateIdentity: boolean,
  signal?: AbortSignal,
  /** `?lite=1`: scalar header stats only — candles/recentTrades arrive
   *  empty. The healthy-stream steady-state poll body (see
   *  useTokenSnapshot's lite poll). */
  lite = false,
): Promise<Response> {
  const params = new URLSearchParams();
  if (hydrateIdentity) params.set('hydrateIdentity', '1');
  if (lite) params.set('lite', '1');
  const query = params.toString();
  const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}${query ? `?${query}` : ''}`);
  return fetch(url, {
    cache: 'no-store',
    signal,
  });
}

/** Server cap on `GET /api/tokens` (ingestion rejects larger lists). */
export const TOKENS_BATCH_MAX_MINTS = 30;

/** Batched sibling of `fetchTokenSnapshotForCache`: one GET /api/tokens
 *  for up to TOKENS_BATCH_MAX_MINTS mints. The response is
 *  `{ v: "1", tokens: { [mint]: snapshot } }` with misses OMITTED —
 *  per-mint bytes are identical to the single GET, so the same
 *  normalizer applies. Throws on transport/HTTP failure so callers can
 *  fall back to per-mint fetches; a mint absent from the map is a miss
 *  (callers keep previous state for it). */
export async function fetchTokenSnapshotsBatch(
  mints: readonly string[],
  signal?: AbortSignal,
  /** `?lite=1`: scalar header stats only per body — same contract as the
   *  single GET's lite poll. Chip-strip pollers (watchlist) want this;
   *  callers that read candles/recentTrades must not pass it. */
  lite = false,
): Promise<Map<string, TokenSnapshot>> {
  const url = ingestionApiUrl(
    `/api/tokens?mints=${mints.map(encodeURIComponent).join(',')}${lite ? '&lite=1' : ''}`,
  );
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`http_${response.status}`);
  }
  const payload = (await response.json()) as {
    v?: string;
    tokens?: Record<string, TokenSnapshot>;
  };
  const out = new Map<string, TokenSnapshot>();
  for (const [mint, snap] of Object.entries(payload.tokens ?? {})) {
    out.set(mint, normalizeTokenSnapshot(snap));
  }
  return out;
}

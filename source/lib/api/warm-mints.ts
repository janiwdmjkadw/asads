import { fetchIngestionJson } from './ingestion';

// Debounce window to batch rapid calls (e.g. a search-results render that fires per row).
const FLUSH_DEBOUNCE_MS = 150;
// Server honors ≤32 mints per request; keep the POST small.
const MAX_PER_REQUEST = 32;
// Skip re-warming a mint warmed within this window — the server keeps it hot anyway, so a
// re-render / re-hover shouldn't re-POST it.
const RECENTLY_WARMED_TTL_MS = 30_000;
const MAX_RECENTLY_WARMED = 1_000;
const REQUEST_TIMEOUT_MS = 4_000;

/**
 * Pure batching policy: from `incoming`, pick the mints worth warming — trim, dedupe, drop
 * any warmed within `ttlMs`, cap at `max`. Exported so the policy is unit-testable without
 * timers / network. Order is preserved (callers pass results most-relevant first).
 */
export function selectMintsToWarm(
  incoming: readonly string[],
  recentlyWarmed: ReadonlyMap<string, number>,
  now: number,
  ttlMs: number,
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    if (out.length >= max) break;
    const mint = raw?.trim();
    if (!mint || seen.has(mint)) continue;
    const warmedAt = recentlyWarmed.get(mint);
    if (warmedAt != null && now - warmedAt < ttlMs) continue;
    seen.add(mint);
    out.push(mint);
  }
  return out;
}

const pending = new Set<string>();
const recentlyWarmed = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Search prewarm: register a batch of mints in ingestion's live working set + warm their
 * snapshot, so a click that follows a search lands on a warm cache instead of a cold
 * the analytics store read. Best-effort, deduped (skips mints warmed in the last 30s), and
 * debounced/batched into a single POST. Call with the visible / hovered search-result mints;
 * safe to call repeatedly (re-renders are cheap no-ops). No-op during SSR.
 */
export function warmMints(mints: Iterable<string>): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const fresh = selectMintsToWarm(
    [...mints],
    recentlyWarmed,
    now,
    RECENTLY_WARMED_TTL_MS,
    Number.MAX_SAFE_INTEGER,
  );
  for (const mint of fresh) pending.add(mint);
  if (pending.size === 0 || flushTimer != null) return;
  flushTimer = setTimeout(flushWarmQueue, FLUSH_DEBOUNCE_MS);
}

/** Convenience for a single mint (e.g. hovering one search row). */
export function warmMint(mint: string): void {
  warmMints([mint]);
}

function flushWarmQueue(): void {
  flushTimer = null;
  if (pending.size === 0) return;
  const now = Date.now();
  const batch = [...pending].slice(0, MAX_PER_REQUEST);
  for (const mint of batch) {
    pending.delete(mint);
    recentlyWarmed.set(mint, now);
  }
  pruneRecentlyWarmed(now);
  void fetchIngestionJson<{ accepted?: number }>('/api/warm', {
    method: 'POST',
    body: { mints: batch },
    timeoutMs: REQUEST_TIMEOUT_MS,
  }).catch(() => {
    // Best-effort: a failed prewarm just means the click pays the (coalesced) cold read.
  });
  // More than one batch queued → schedule the next flush so nothing is dropped.
  if (pending.size > 0 && flushTimer == null) {
    flushTimer = setTimeout(flushWarmQueue, FLUSH_DEBOUNCE_MS);
  }
}

function pruneRecentlyWarmed(now: number): void {
  if (recentlyWarmed.size <= MAX_RECENTLY_WARMED) return;
  for (const [mint, warmedAt] of recentlyWarmed) {
    if (now - warmedAt >= RECENTLY_WARMED_TTL_MS) recentlyWarmed.delete(mint);
  }
}

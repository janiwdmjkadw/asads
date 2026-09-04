/**
 * Predictive token-image preload.
 *
 * A new mint's image URL is known the instant its SSE frame arrives, but the
 * browser historically only started downloading once React mounted the card.
 * Preloading at frame arrival overlaps the network fetch (and the decode)
 * with the mount, so the card paints with its artwork instead of flashing
 * from placeholder to image a beat later.
 *
 * Bounded: one preload per mint per session via an insertion-order set
 * (same pattern as the router-prefetch dedupe). Image objects are released
 * immediately after decode — the payoff lives in the browser's HTTP and
 * decoded-image caches, not in retained JS.
 */

const PRELOADED_CAP = 1_024;
const preloadedUrls = new Set<string>();
/** Cap concurrent preloads per frame — the visible lane shows ~10 cards. */
const MAX_PER_FRAME = 16;

function shouldPreload(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('data:')) return false; // inline placeholder
  if (preloadedUrls.has(url)) return false;
  return true;
}

function remember(url: string): void {
  preloadedUrls.add(url);
  if (preloadedUrls.size > PRELOADED_CAP) {
    const oldest = preloadedUrls.values().next().value;
    if (oldest !== undefined) preloadedUrls.delete(oldest);
  }
}

/** Kick fetch+decode for not-yet-seen coin images. Cheap (set lookups) on
 *  repeat frames; actual work happens only for genuinely new URLs. */
export function preloadCoinImages(
  coins: ReadonlyArray<{ imageUrl?: string | null }>,
): void {
  if (typeof window === 'undefined') return;
  let started = 0;
  for (const coin of coins) {
    if (started >= MAX_PER_FRAME) break;
    const url = coin.imageUrl;
    if (!shouldPreload(url)) continue;
    remember(url);
    started += 1;
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    // decode() warms the decoded-image cache off the main paint path; failures
    // (404 thumb not yet generated, gateway hiccup) are the card's onError
    // fallback chain's job, not ours.
    void image.decode?.().catch(() => undefined);
  }
}

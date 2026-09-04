'use client';

import { fetchAuthenticatedApi } from './trading';
import { forceClerkMirrorRefresh, getClerkSession } from '@/lib/state/clerk-session-store';

/**
 * Quickbuy/prewarm wire — client side.
 *
 * `prewarmMints(mints, getToken)` enqueues mints into a module-level
 * coalesce buffer that flushes a single POST `/api/v1/trade/prewarm`
 * once every COALESCE_MS. The backend forwards to the backend service which
 * calls `activeQuotes.touchMint(mint)` + `activePrewarm.touchMint(mint)`
 * for each entry. The engine's cold read is a ~1ms loopback read of
 * ingestion's materialized snapshot (and the click path re-reads at
 * click time anyway), so the touch mostly matters for `graduatedMints`:
 * a graduation hint triggers AMM pool discovery on the backend service — the one
 * remaining multi-hundred-ms cold path.
 *
 * Why coalesce client-side too:
 *   - pointerEnter / pointerDown / focus can all fire `prewarm()` on
 *     the same card during a real user interaction, so without
 *     coalescing we'd issue repeated POSTs for the same mint.
 *   - The the backend service active TTL is 5000ms, so warming "once per
 *     COALESCE_MS while hot" is plenty.
 *
 * Failure model: prewarm is best-effort. Network failures, 503s,
 * timeouts — none surface to the caller. The engine has a live-RPC
 * fallback inside `executeIntent`; a missed warm just means the next
 * order pays the cold cost.
 */

const COALESCE_MS = 250;
// Per-mint cooldown between upstream sends. A real interaction
// (hover → pointer-down → click) fires several engagement signals in
// quick succession; one send covers them all. 500ms gives ~2
// sends/sec/mint max per client tab — way below what a sustained
// interaction would actually demand.
const TRAILING_REFIRE_MS = 500;
const MAX_MINTS_PER_REQUEST = 32;

interface PendingState {
  mints: Set<string>;
  graduatedMints: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  authTokenAtFlush: string | null;
  // Last time a particular mint was sent upstream — used so a card
  // that re-fires `prewarm()` during the same interaction
  // doesn't flood requests; we drop the duplicate locally.
  lastSentAt: Map<string, number>;
}

const state: PendingState = {
  mints: new Set(),
  graduatedMints: new Set(),
  flushTimer: null,
  authTokenAtFlush: null,
  lastSentAt: new Map(),
};

function shouldEnqueue(mint: string, nowMs: number): boolean {
  const last = state.lastSentAt.get(mint) ?? 0;
  return nowMs - last >= TRAILING_REFIRE_MS;
}

function scheduleFlush(authToken: string | null): void {
  // Always update to the latest token: Clerk may have refreshed
  // between two enqueue calls inside the same coalesce window, and
  // a stale token would 401 the batch. The trailing edge wins.
  state.authTokenAtFlush = authToken;
  if (state.flushTimer !== null) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flushNow(state.authTokenAtFlush);
  }, COALESCE_MS);
}

function flushImmediately(authToken: string | null): void {
  // Skip the COALESCE_MS wait entirely. Any mints already queued for
  // the pending coalesced flush ride along in this send (flushNow
  // drains the whole buffer), so we cancel the timer to avoid a
  // redundant second POST.
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.authTokenAtFlush = authToken;
  void flushNow(authToken);
}

async function flushNow(authToken: string | null): Promise<void> {
  if (state.mints.size === 0) return;
  // Grab the batch and delete ONLY its entries (not the whole buffer) so
  // an overflow beyond MAX_MINTS_PER_REQUEST stays queued for the next
  // flush instead of being silently dropped.
  const batch = Array.from(state.mints).slice(0, MAX_MINTS_PER_REQUEST);
  const graduatedBatch = Array.from(state.graduatedMints)
    .filter((mint) => batch.includes(mint));
  for (const mint of batch) {
    state.mints.delete(mint);
    state.graduatedMints.delete(mint);
  }
  const now = Date.now();
  for (const mint of batch) {
    state.lastSentAt.set(mint, now);
  }
  try {
    const response = await fetchAuthenticatedApi(
      '/api/v1/trade/prewarm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mints: batch,
          graduated_mints: graduatedBatch,
        }),
      },
      { authToken },
    );
    if (!response.ok && response.status !== 503) {
      // 503 = upstream prewarm unavailable, expected during cold
      // start. Anything else means the request was rejected by
      // api/ (validation). Drop the success record so the
      // next attempt re-warms — otherwise a single reauth blip
      // would silently disable warming for TRAILING_REFIRE_MS.
      for (const mint of batch) state.lastSentAt.delete(mint);
    } else if (response.ok && (await isReauthRequiredBody(response))) {
      // A stale session comes back as HTTP 200 + { reauth_required: true }
      // (api/src/routes/trade/prewarm.ts), so the !ok branch above never
      // sees the auth failure and would stamp the warm as a success.
      // Un-stamp the batch and retry once with a force-refreshed mirror
      // token so the warm lands now instead of on the next heartbeat.
      for (const mint of batch) state.lastSentAt.delete(mint);
      void reflushAfterReauth(batch, graduatedBatch);
    }
  } catch {
    // Network errors: forget we sent so the next call retries.
    for (const mint of batch) state.lastSentAt.delete(mint);
  }
  if (state.lastSentAt.size > 256) {
    pruneOldEntries(Date.now());
  }
  // Overflow left in the buffer (batch was capped): schedule another
  // coalesced flush so the remainder doesn't sit until the next enqueue.
  if (state.mints.size > 0) scheduleFlush(state.authTokenAtFlush);
}

async function isReauthRequiredBody(response: Response): Promise<boolean> {
  // Best-effort background parse. An unparseable body is treated as a
  // normal success — exactly the pre-check behavior.
  try {
    const body = (await response.json()) as { reauth_required?: unknown } | null;
    return body !== null && typeof body === 'object' && body.reauth_required === true;
  } catch {
    return false;
  }
}

// Single-retry latch for the reauth path: if the refreshed token ALSO
// reauths, the nested flush finds the latch still set and gives up, so
// a persistently dead session can't loop mint→flush→reauth forever.
// The un-stamped lastSentAt entries let the next heartbeat start over.
let reauthReflushInFlight = false;

async function reflushAfterReauth(
  batch: ReadonlyArray<string>,
  graduatedBatch: ReadonlyArray<string>,
): Promise<void> {
  if (reauthReflushInFlight) return;
  reauthReflushInFlight = true;
  try {
    // Single-flight: reuses the visibility-return mint when one is
    // already in flight instead of paying a second FAPI round trip.
    await forceClerkMirrorRefresh();
    const session = getClerkSession();
    if (session.isSignedIn !== true || session.token === null) return;
    for (const mint of batch) state.mints.add(mint);
    for (const mint of graduatedBatch) state.graduatedMints.add(mint);
    await flushNow(session.token);
  } finally {
    reauthReflushInFlight = false;
  }
}

function pruneOldEntries(nowMs: number): void {
  for (const [mint, t] of state.lastSentAt) {
    if (nowMs - t > TRAILING_REFIRE_MS * 8) {
      state.lastSentAt.delete(mint);
    }
  }
}

/**
 * Enqueue one or more mints for prewarm. Idempotent within
 * COALESCE_MS — calling with the same mint many times in the
 * same frame collapses to a single upstream entry. Calling
 * within TRAILING_REFIRE_MS of a previous send for the same mint
 * is a no-op (the server keeps a touched mint active for
 * activeTtlMs = 5000ms, so a 500ms refire floor loses nothing).
 *
 * Callers fire this on real engagement signals — hover / focus /
 * pointer-down / graduated-card first sight — never on a periodic
 * keepalive: the engine's cold read is a ~1ms loopback snapshot
 * and the click path re-reads at click time regardless.
 *
 * `options.immediate` skips the COALESCE_MS wait and POSTs right
 * away. Use it on explicit buy intent (quickbuy pointer-down /
 * the order handler self-warm) so the warm gets a head start on
 * the order POST. The TRAILING_REFIRE_MS cooldown still applies,
 * so an immediate request for a mint warmed <500ms ago is a
 * no-op — it's already warm.
 */
export function prewarmMints(
  mints: ReadonlyArray<string>,
  authToken: string | null,
  options: {
    graduatedMints?: ReadonlyArray<string>;
    immediate?: boolean;
  } = {},
): void {
  // No SSR guard needed: the module is `'use client'` and callers
  // are event handlers / effects, never render paths.
  if (mints.length === 0) return;
  // Offline: every POST is guaranteed to fail, and the catch path in
  // flushNow clears the lastSentAt stamps — so repeated engagement
  // signals would refire doomed requests for the whole offline
  // stretch. Skip enqueueing entirely; the first call after reconnect
  // warms normally. (`typeof` guard keeps this safe under SSR/test
  // runners without a `navigator` global.)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const immediate = options.immediate === true;
  const now = Date.now();
  let added = 0;
  for (const mint of mints) {
    if (!mint) continue;
    if (!shouldEnqueue(mint, now)) continue;
    if (state.mints.has(mint)) continue;
    state.mints.add(mint);
    added += 1;
    if (state.mints.size >= MAX_MINTS_PER_REQUEST) break;
  }
  // Record graduated markers BEFORE the added===0 early return: a mint
  // already queued by an earlier call in this coalesce window would
  // otherwise flush WITHOUT its graduated flag when this call carried it.
  // Only queued mints are recorded — a marker for a cooldown-skipped mint
  // would never be sent and would just leak in the set.
  for (const mint of options.graduatedMints ?? []) {
    if (!mint) continue;
    if (!state.mints.has(mint)) continue;
    state.graduatedMints.add(mint);
  }
  if (added === 0) {
    // Nothing new to enqueue (the mint is already queued, or it's
    // within the refire cooldown). If the caller demanded an
    // immediate warm and there are still mints waiting on the
    // coalesce timer, flush them NOW rather than let an engaged mint
    // sit behind the 250ms delay. If everything is on cooldown the
    // mint was warmed <500ms ago — already hot, so do nothing.
    if (immediate && state.mints.size > 0) flushImmediately(authToken);
    return;
  }
  if (immediate) {
    flushImmediately(authToken);
  } else {
    scheduleFlush(authToken);
  }
}

/** For unit tests — clears the module-level coalesce state. */
export function _resetPrewarmForTests(): void {
  if (state.flushTimer !== null) clearTimeout(state.flushTimer);
  state.flushTimer = null;
  state.mints.clear();
  state.graduatedMints.clear();
  state.lastSentAt.clear();
  state.authTokenAtFlush = null;
  reauthReflushInFlight = false;
}

/** For unit tests — exposes coalesce timing knobs. */
export const PREWARM_INTERNALS = {
  COALESCE_MS,
  TRAILING_REFIRE_MS,
  MAX_MINTS_PER_REQUEST,
};

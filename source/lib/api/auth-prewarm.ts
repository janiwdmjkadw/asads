'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Fire `POST /api/v1/trade/auth-prewarm` with the live Clerk token.
 * Warms every in-process cache on api/'s critical path so the FIRST
 * order click pays only the unavoidable Aurora idempotency write.
 *
 * Failure is silent — the warmup is purely a perf side request, not
 * a gate on trading. If the call rejects (network, timeout, 503),
 * the order path still works cold.
 */
export async function warmAuthCaches(authToken: string): Promise<void> {
  const controller = new AbortController();
  // Defensive timeout — a warming call must never hang a tab.
  const timer = window.setTimeout(() => controller.abort(), 3_000);
  try {
    await fetchAuthenticatedApi(
      '/api/v1/trade/auth-prewarm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      { authToken, signal: controller.signal },
    );
  } catch {
    // ignored.
  } finally {
    window.clearTimeout(timer);
  }
}

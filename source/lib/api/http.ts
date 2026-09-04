export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  body?: object;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = options.timeoutMs == null
    ? null
    : setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
    if (!response.ok) {
      /* Release the body before throwing: an unread Response body keeps its
         mojo data pipe (renderer-native shared memory) alive until GC gets
         around to it. On hot error paths (per-mint warms against a churning
         feed) that pinned native memory adds up — same leak class as the
         Next 15.5 unclosing prefetch streams (see app/providers.tsx). */
      void response.body?.cancel().catch(() => undefined);
      throw new ApiHttpError(response.status, response.statusText);
    }
    return await response.json() as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Release an error Response's unread body. Chromium keeps the mojo data pipe
 * (renderer-native shared memory) of an unread body pinned until GC; on hot
 * fetch paths (per-mint warms, per-event ticker lookups) call this before
 * throwing/returning on `!response.ok` so native memory stays bounded.
 */
export function releaseResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Body already consumed/locked — nothing to release.
  }
}

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`http_${status}`);
    this.name = 'ApiHttpError';
  }
}
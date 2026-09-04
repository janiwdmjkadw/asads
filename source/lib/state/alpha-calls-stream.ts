'use client';

import { tradingApiUrl } from '@/lib/api/trading';
import { parseAlphaCall, type AlphaCall } from '@/lib/api/alpha-calls-shared';
import { subscribeStreamGeneration } from '@/lib/state/stream-generation';

/**
 * Shared, ref-counted client for the coin-call push channel
 * (`/api/v1/alpha/stream`). One EventSource per browser session is shared
 * across every consumer; frames are `event: coin-call` with the exact feed
 * item wire shape, so parsing reuses `parseAlphaCall`.
 *
 * Delivery model: this stream is the PRIMARY path for the Discover alpha
 * lane — while connected, consumers stop polling entirely. On error the
 * stream reconnects with backoff and consumers fall back to their poll until
 * it recovers; the `onConnect` callback fires on every (re)connect so
 * consumers can run one catch-up refetch for anything missed in the gap.
 */

interface Handlers {
  onCall: (call: AlphaCall) => void;
  /** Fires on every successful (re)connect — run a catch-up refetch. */
  onConnect?: () => void;
  onDisconnect?: () => void;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 12_000;

interface StreamState {
  es: EventSource | null;
  connected: boolean;
  handlers: Set<Handlers>;
  retryHandle: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
}

const state: StreamState = {
  es: null,
  connected: false,
  handlers: new Set(),
  retryHandle: null,
  retryDelayMs: RETRY_BASE_MS,
};

/**
 * Join the coin-call stream. Returns a release fn; the EventSource closes
 * when the last consumer releases.
 */
export function acquireAlphaCallsStream(handlers: Handlers): () => void {
  state.handlers.add(handlers);
  if (state.connected) handlers.onConnect?.();
  if (state.es === null && state.retryHandle === null) connect();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.handlers.delete(handlers);
    if (state.handlers.size === 0) teardown();
  };
}

export function isAlphaCallsStreamConnected(): boolean {
  return state.connected;
}

function connect(): void {
  if (state.handlers.size === 0) return;
  const url = tradingApiUrl('/api/v1/alpha/stream');
  if (!url || typeof EventSource === 'undefined') return;
  let es: EventSource;
  try {
    es = new EventSource(url, { withCredentials: true });
  } catch {
    return;
  }
  state.es = es;
  es.addEventListener('open', () => {
    if (state.es !== es) return;
    state.connected = true;
    state.retryDelayMs = RETRY_BASE_MS;
    for (const h of state.handlers) h.onConnect?.();
  });
  es.addEventListener('coin-call', (ev) => {
    if (state.es !== es) return;
    let raw: unknown;
    try {
      raw = JSON.parse((ev as MessageEvent).data as string);
    } catch {
      return;
    }
    const call = parseAlphaCall(raw);
    if (!call) return;
    for (const h of state.handlers) h.onCall(call);
  });
  es.addEventListener('error', () => {
    if (state.es !== es) return;
    const wasConnected = state.connected;
    state.connected = false;
    try {
      es.close();
    } catch {
      /* ignore */
    }
    state.es = null;
    if (wasConnected) for (const h of state.handlers) h.onDisconnect?.();
    if (state.handlers.size > 0 && state.retryHandle === null) {
      state.retryHandle = setTimeout(() => {
        state.retryHandle = null;
        connect();
        // Jittered (0.5-1.0x): avoid synchronized reconnect herds.
      }, Math.round(state.retryDelayMs * (0.5 + Math.random() * 0.5)));
      state.retryDelayMs = Math.min(state.retryDelayMs * 2, RETRY_MAX_MS);
    }
  });
}

function teardown(): void {
  if (state.retryHandle !== null) {
    clearTimeout(state.retryHandle);
    state.retryHandle = null;
  }
  try {
    state.es?.close();
  } catch {
    /* ignore */
  }
  state.es = null;
  if (state.connected) {
    state.connected = false;
    for (const h of state.handlers) h.onDisconnect?.();
  }
  state.retryDelayMs = RETRY_BASE_MS;
}

// bfcache restore: frozen EventSources come back CLOSED on pageshow and no
// React effect re-runs for this module-level client — force a reconnect.
// The disconnect must be DELIVERED (not just recorded): consumers re-enable
// their poll fallback on it, so if this forced reconnect then fails they are
// not left believing a dead stream is healthy.
subscribeStreamGeneration(() => {
  if (state.handlers.size === 0) return;
  if (state.retryHandle !== null) {
    clearTimeout(state.retryHandle);
    state.retryHandle = null;
  }
  try {
    state.es?.close();
  } catch {
    /* ignore */
  }
  state.es = null;
  const wasConnected = state.connected;
  state.connected = false;
  state.retryDelayMs = RETRY_BASE_MS;
  if (wasConnected) for (const h of state.handlers) h.onDisconnect?.();
  connect();
});

/** Test-only: close and clear all state. */
export function _resetAlphaCallsStreamForTests(): void {
  state.handlers.clear();
  teardown();
}

'use client';

import { tradingApiUrl } from '@/lib/api/trading';
import { subscribeStreamGeneration } from '@/lib/state/stream-generation';

/**
 * Shared, ref-counted client for the notification push channel
 * (`/api/v1/notifications/stream`).
 *
 * ONE EventSource per browser session, shared across every consumer — the
 * bell mounts on every page for every signed-in user, so this is the one
 * truly global stream and it must not be opened twice.
 *
 * DELIVERY MODEL. While connected this is the PRIMARY path: consumers drop
 * their poll to a slow backstop. Frames are inserted straight into the
 * react-query cache, so a notification costs zero fetches. On error the
 * stream reconnects with jittered backoff and `onConnect` fires on every
 * (re)connect so consumers can run ONE catch-up refetch for whatever landed
 * during the gap — nothing is ever reconstructed from the stream alone.
 *
 * Mirrors `lib/state/alpha-calls-stream.ts` exactly, including the bfcache
 * restore hook: a frozen EventSource comes back CLOSED on `pageshow` and no
 * React effect re-runs for a module-level client, so the generation
 * subscription forces a reconnect and DELIVERS the disconnect first (a
 * consumer that thinks a dead stream is healthy would stop polling forever).
 */

/** The wire row — the list shape plus `metadata`, parsed by the caller. */
export interface NotificationStreamFrame {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly metadata: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

interface Handlers {
  onNotification: (frame: NotificationStreamFrame) => void;
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Parse one frame. A malformed frame is dropped, never thrown. */
export function parseNotificationFrame(raw: unknown): NotificationStreamFrame | null {
  if (!isObject(raw)) return null;
  const id = str(raw['id']);
  const kind = str(raw['kind']);
  const title = str(raw['title']);
  const createdAt = str(raw['created_at']);
  if (id === null || kind === null || title === null || createdAt === null) return null;
  return {
    id,
    kind,
    title,
    body: str(raw['body']),
    metadata: isObject(raw['metadata']) ? raw['metadata'] : {},
    readAt: str(raw['read_at']),
    createdAt,
  };
}

/**
 * Join the notification stream. Returns a release fn; the EventSource closes
 * when the last consumer releases.
 */
export function acquireNotificationsStream(handlers: Handlers): () => void {
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

export function isNotificationsStreamConnected(): boolean {
  return state.connected;
}

function connect(): void {
  if (state.handlers.size === 0) return;
  const url = tradingApiUrl('/api/v1/notifications/stream');
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
  es.addEventListener('notification', (ev) => {
    if (state.es !== es) return;
    let raw: unknown;
    try {
      raw = JSON.parse((ev as MessageEvent).data as string);
    } catch {
      return;
    }
    const frame = parseNotificationFrame(raw);
    if (frame === null) return;
    for (const h of state.handlers) h.onNotification(frame);
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
      state.retryHandle = setTimeout(
        () => {
          state.retryHandle = null;
          connect();
          // Jittered (0.5-1.0x): a deploy restarts every stream at once, and
          // an unjittered backoff would reconnect them in lockstep forever.
        },
        Math.round(state.retryDelayMs * (0.5 + Math.random() * 0.5)),
      );
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
export function _resetNotificationsStreamForTests(): void {
  state.handlers.clear();
  teardown();
}

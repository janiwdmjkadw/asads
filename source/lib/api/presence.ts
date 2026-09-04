/**
 * Trade-page presence client (the viewers chip). Beats
 * `POST /api/token/:mint/presence` on the ingestion API while the user is
 * actually looking at a trade page; the server counts distinct presence
 * keys with a live heartbeat (25s TTL) and pushes count changes over the
 * per-mint stream.
 *
 * The presence key dedupes one person across tabs: the mirrored Clerk user
 * id when signed in, else a per-TAB random id (sessionStorage — two anon
 * tabs are honestly two viewers, but a reload is not a new person).
 */

import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { getMirroredClerkUserId } from '@/lib/state/clerk-session-store';

const TAB_KEY_STORAGE = 'presence:tab-key:v1';

/** Beat cadence; the server TTL (25s) tolerates two missed beats. */
export const PRESENCE_BEAT_INTERVAL_MS = 10_000;
/** Site-wide online beats are lazier (server TTL 40s). */
export const ONLINE_BEAT_INTERVAL_MS = 15_000;

function tabKey(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_KEY_STORAGE);
    if (existing) return existing;
    const fresh = `tab_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    window.sessionStorage.setItem(TAB_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    // Non-persistent contexts: a per-load key still counts correctly, it
    // just re-identifies after reload.
    return `tab_${Math.random().toString(36).slice(2, 14)}`;
  }
}

export function presenceKey(): string {
  return getMirroredClerkUserId() ?? tabKey();
}

function presenceUrl(mint: string, action: 'beat' | 'leave'): string {
  const key = encodeURIComponent(presenceKey());
  const suffix = action === 'leave' ? '&action=leave' : '';
  return ingestionApiUrl(
    `/api/token/${encodeURIComponent(mint)}/presence?k=${key}${suffix}`,
  );
}

/** One heartbeat. Resolves to the server's current count, or null on any
 *  failure (the chip simply keeps its last value). */
export async function sendPresenceBeat(mint: string): Promise<number | null> {
  if (!isIngestionApiConfigured()) return null;
  try {
    const res = await fetch(presenceUrl(mint, 'beat'), { method: 'POST' });
    if (!res.ok) return null;
    const body = (await res.json()) as { viewers?: unknown };
    return typeof body.viewers === 'number' ? body.viewers : null;
  } catch {
    return null;
  }
}

/** Fire-and-forget leave. `sendBeacon` survives page hide/unload; the
 *  fetch fallback covers browsers without it. */
export function sendPresenceLeave(mint: string): void {
  if (!isIngestionApiConfigured()) return;
  beaconOrFetch(presenceUrl(mint, 'leave'));
}

function onlineUrl(action: 'beat' | 'leave'): string {
  const key = encodeURIComponent(presenceKey());
  const suffix = action === 'leave' ? '&action=leave' : '';
  // Under /api/token/ ON PURPOSE: prod the edge routes that prefix to the
  // ingestion API, and new top-level locations have no deployable path
  // (no the edge component in the deploy workflow). The server registers
  // this exact static route beside the per-mint one.
  return ingestionApiUrl(`/api/token/presence/online?k=${key}${suffix}`);
}

/** Site-wide online beat (the footer's total-viewers chip). Resolves to
 *  the current online total, or null on failure. */
export async function sendOnlineBeat(): Promise<number | null> {
  if (!isIngestionApiConfigured()) return null;
  try {
    const res = await fetch(onlineUrl('beat'), { method: 'POST' });
    if (!res.ok) return null;
    const body = (await res.json()) as { online?: unknown };
    return typeof body.online === 'number' ? body.online : null;
  } catch {
    return null;
  }
}

export function sendOnlineLeave(): void {
  if (!isIngestionApiConfigured()) return;
  beaconOrFetch(onlineUrl('leave'));
}

function beaconOrFetch(url: string): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url);
      return;
    }
  } catch {
    // fall through to fetch
  }
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined);
}

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  coldBootRetry,
  throwOnColdBootReauth,
  withColdBootAuth,
} from './cold-boot-auth';
import { fetchAuthenticatedApi } from './trading';
import type { ReauthReason } from './referral';

// Slice "Referral Signup Notifications": client for /api/v1/notifications.
// Durable history lives in Aurora; this client polls the last five rows for
// the topnav bell and toast stack.

export interface UserNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Volume for one tier. `alert` interrupts, `inbox` is silent, `off` writes nothing. */
export type NotificationPrefMode = 'alert' | 'inbox' | 'off';

export interface NotificationPrefs {
  act: NotificationPrefMode;
  beat: NotificationPrefMode;
  trace: NotificationPrefMode;
  sound: boolean;
}

/**
 * The documented defaults — the tier ladder itself. Absence of a server row
 * means exactly this, which is why an unconfigured user costs no storage and
 * why an older api that serves no `prefs` block still renders correctly.
 */
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefs> = {
  act: 'alert',
  beat: 'alert',
  trace: 'inbox',
  sound: true,
};

export interface NotificationsPage {
  unreadCount: number;
  notifications: UserNotification[];
  prefs: NotificationPrefs;
}

type Result<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'reauth'; reason: ReauthReason }
  | { kind: 'error'; reason: string };

interface FetchOpts {
  authToken?: string | null;
  signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function reauthOf(body: Record<string, unknown>): ReauthReason | null {
  if (body.reauth_required === true) {
    const r = body.reason;
    if (r === 'no_session' || r === 'session_expired' || r === 'session_invalid') return r;
    return 'session_invalid';
  }
  return null;
}

async function getJson(
  path: string,
  opts: FetchOpts,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> } | { networkError: string }> {
  try {
    const res = await fetchAuthenticatedApi(path, init, {
      authToken: opts.authToken,
      signal: opts.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch (err) {
    return { networkError: (err as Error)?.message ?? 'network_error' };
  }
}

/** The bell's page size. Five was the referral-era posture; one active
 *  conditional can produce that in a minute. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

export async function fetchNotifications(opts: FetchOpts): Promise<Result<NotificationsPage>> {
  const r = await getJson(`/api/v1/notifications?limit=${NOTIFICATIONS_PAGE_SIZE}`, opts);
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };

  const rows = Array.isArray(r.body.notifications) ? r.body.notifications : [];
  return {
    kind: 'ok',
    data: {
      unreadCount: typeof r.body.unread_count === 'number' ? r.body.unread_count : 0,
      notifications: rows.filter(isObject).map(parseNotification),
      prefs: parsePrefs(r.body.prefs),
    },
  };
}

function prefMode(v: unknown, fallback: NotificationPrefMode): NotificationPrefMode {
  return v === 'alert' || v === 'inbox' || v === 'off' ? v : fallback;
}

/** Degrades to the documented defaults — never throws, never blanks the bell. */
export function parsePrefs(raw: unknown): NotificationPrefs {
  if (!isObject(raw)) return { ...DEFAULT_NOTIFICATION_PREFS };
  return {
    act: prefMode(raw.act, DEFAULT_NOTIFICATION_PREFS.act),
    beat: prefMode(raw.beat, DEFAULT_NOTIFICATION_PREFS.beat),
    trace: prefMode(raw.trace, DEFAULT_NOTIFICATION_PREFS.trace),
    sound: raw.sound !== false,
  };
}

/** Per-row clear — the row-level twin of "clear all". */
export async function dismissNotifications(
  ids: string[],
  opts: FetchOpts,
): Promise<Result<{ dismissed: number }>> {
  const r = await getJson('/api/v1/notifications/dismiss', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  return { kind: 'ok', data: { dismissed: typeof r.body.dismissed === 'number' ? r.body.dismissed : 0 } };
}

/** The GLOBAL per-tier control. A partial patch leaves the rest untouched. */
export async function writeNotificationPrefs(
  patch: Partial<NotificationPrefs>,
  opts: FetchOpts,
): Promise<Result<NotificationPrefs>> {
  const r = await getJson('/api/v1/notifications/prefs', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  return { kind: 'ok', data: parsePrefs(r.body.prefs) };
}

export async function markNotificationsRead(
  ids: string[],
  opts: FetchOpts,
): Promise<Result<{ accepted: boolean }>> {
  const r = await getJson('/api/v1/notifications/read', opts, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  return { kind: 'ok', data: { accepted: r.body.accepted === true } };
}

/** "Clear all": server-side delete of the CALLER's notification rows only. */
export async function clearNotifications(
  opts: FetchOpts,
): Promise<Result<{ accepted: boolean }>> {
  const r = await getJson('/api/v1/notifications/clear', opts, { method: 'POST' });
  if ('networkError' in r) return { kind: 'error', reason: r.networkError };
  const reauth = reauthOf(r.body);
  if (reauth) return { kind: 'reauth', reason: reauth };
  if (r.status < 200 || r.status >= 300) return { kind: 'error', reason: `http_${r.status}` };
  return { kind: 'ok', data: { accepted: r.body.accepted === true } };
}

// Exported so push channels (e.g. the coin-call SSE stream) can invalidate
// the bell the moment an event lands instead of waiting out the poll.
export const NOTIFICATIONS_QUERY_KEY = ['api', 'v1', 'notifications'] as const;

export function useNotifications(): UseQueryResult<Result<NotificationsPage>> {
  // Only mounts inside the auth-gated terminal shell (topnav bell), so fire
  // immediately with the session COOKIE (null mirror token → cookie auth)
  // instead of waiting for clerk.browser.js; bail only on positive signed-out.
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  return useQuery<Result<NotificationsPage>>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: ({ signal }) =>
      // Cold-boot guard: a reauth answer produced by a token-less first
      // fetch says nothing about the session — `withColdBootAuth` waits for
      // the token mirror and retries in-place instead of caching a false
      // empty bell for up to 30s.
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await fetchNotifications({ authToken: token, signal }), token),
      ),
    enabled: isSignedIn !== false,
    // THE POLL IS NOW A BACKSTOP, NOT THE DELIVERY PATH.
    // `/api/v1/notifications/stream` pushes each row the moment it is minted
    // and the bell inserts it straight into this cache, so the interval only
    // has to cover a stream that is down. The bell mounts on EVERY page for
    // every signed-in user, so at ten thousand users a 30s poll was ~666 QPS
    // of pure standing cost; five minutes makes that ~66, and the stream's
    // on-connect catch-up covers any gap far faster than either.
    // Constant interval + `refetchIntervalInBackground: false` skips hidden
    // ticks WITHOUT killing the interval (a function returning `false`
    // stops it permanently; refocus only restarts it if staleTime elapsed).
    staleTime: 15_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useMarkNotificationsRead(): UseMutationResult<Result<{ accepted: boolean }>, Error, string[]> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => markNotificationsRead(ids, { authToken: await getToken() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}

export function useClearNotifications(): UseMutationResult<
  Result<{ accepted: boolean }>,
  Error,
  void,
  { previous: Result<NotificationsPage> | undefined }
> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => clearNotifications({ authToken: await getToken() }),
    // Optimistic: empty the bell instantly; the server delete is scoped to
    // this user's rows, so a refetch converges to the same empty page.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previous = qc.getQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY);
      qc.setQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY, {
        kind: 'ok',
        data: {
          unreadCount: 0,
          notifications: [],
          // Clearing the inbox is not a preference change — carry the
          // caller's settings through, or the panel would flash back to the
          // defaults for one render.
          prefs: previous?.kind === 'ok' ? previous.data.prefs : { ...DEFAULT_NOTIFICATION_PREFS },
        },
      });
      return { previous };
    },
    onError: (_err, _void, context) => {
      // Network/API failure — restore the pre-clear page rather than lying
      // about an empty inbox that will bounce back on the next poll.
      if (context?.previous !== undefined) {
        qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
      }
    },
    onSuccess: (result, _void, context) => {
      // Soft failures (reauth / http error) resolve as data, not throws —
      // roll those back too so the optimistic empty can't mask a no-op.
      if (result.kind !== 'ok' && context?.previous !== undefined) {
        qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}

function parseNotification(raw: Record<string, unknown>): UserNotification {
  return {
    id: str(raw.id),
    kind: str(raw.kind),
    title: str(raw.title, 'Notification'),
    body: typeof raw.body === 'string' ? raw.body : null,
    metadata: isObject(raw.metadata) ? raw.metadata : {},
    readAt: typeof raw.read_at === 'string' ? raw.read_at : null,
    createdAt: str(raw.created_at),
  };
}

// ───────── the push path: a frame becomes a cache row, not a refetch ─────────

/**
 * Insert one streamed frame into the bell's cache.
 *
 * Push is the delivery path, so this must be a pure cache write — a refetch
 * per frame would put the QPS back that the stream exists to remove.
 *
 * Three properties it has to hold:
 *  - **idempotent**: the same id arriving twice (a reconnect catch-up racing
 *    a live frame) updates in place rather than duplicating;
 *  - **ordered**: rows stay newest-first by `created_at`, because a coalesced
 *    row keeps its ORIGINAL instant while its count rises, and re-sorting on
 *    arrival order would make the inbox reshuffle mid-burst;
 *  - **bounded**: the page never grows past what the list serves.
 */
export function insertStreamedNotification(
  qc: QueryClient,
  frame: {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    metadata: Record<string, unknown>;
    readAt: string | null;
    createdAt: string;
  },
): void {
  qc.setQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY, (previous) => {
    // No cache yet (a frame beat the first fetch) — let the fetch own it.
    if (previous === undefined || previous.kind !== 'ok') return previous;
    const row: UserNotification = {
      id: frame.id,
      kind: frame.kind,
      title: frame.title,
      body: frame.body,
      metadata: frame.metadata,
      readAt: frame.readAt,
      createdAt: frame.createdAt,
    };
    const existingIndex = previous.data.notifications.findIndex((n) => n.id === row.id);
    const existing = existingIndex >= 0 ? previous.data.notifications[existingIndex] : undefined;
    const next =
      existing === undefined
        ? [row, ...previous.data.notifications]
        : previous.data.notifications.map((n, i) => (i === existingIndex ? row : n));
    next.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    // A coalesced row arrives as an UPDATE to a row we already hold, and the
    // server clears `read_at` when its count rises — so the badge has to
    // light again. Counting only brand-new ids would leave a bumped row
    // silently unread-but-uncounted until the next poll.
    const unreadDelta =
      row.readAt !== null ? 0 : existing === undefined ? 1 : existing.readAt === null ? 0 : 1;
    return {
      kind: 'ok',
      data: {
        ...previous.data,
        unreadCount: previous.data.unreadCount + unreadDelta,
        notifications: next.slice(0, NOTIFICATIONS_PAGE_SIZE),
      },
    };
  });
}

/** Drop rows from the cache without waiting for the server round trip. */
function removeFromCache(qc: QueryClient, ids: readonly string[]): void {
  const drop = new Set(ids);
  qc.setQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY, (previous) => {
    if (previous === undefined || previous.kind !== 'ok') return previous;
    const kept = previous.data.notifications.filter((n) => !drop.has(n.id));
    const removedUnread = previous.data.notifications.filter(
      (n) => drop.has(n.id) && n.readAt === null,
    ).length;
    return {
      kind: 'ok',
      data: {
        ...previous.data,
        unreadCount: Math.max(0, previous.data.unreadCount - removedUnread),
        notifications: kept,
      },
    };
  });
}

export function useDismissNotifications(): UseMutationResult<
  Result<{ dismissed: number }>,
  Error,
  string[],
  { previous: Result<NotificationsPage> | undefined }
> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => dismissNotifications(ids, { authToken: await getToken() }),
    // Optimistic: the row leaves the moment it is clicked. The server delete
    // is scoped to this user's rows, so a refetch converges to the same page.
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previous = qc.getQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY);
      removeFromCache(qc, ids);
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous !== undefined) qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
    },
    onSuccess: (result, _ids, context) => {
      // Soft failures (reauth / http error) resolve as data, not throws —
      // roll those back too, or the row would reappear on the next poll.
      if (result.kind !== 'ok' && context?.previous !== undefined) {
        qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
      }
    },
  });
}

export function useWriteNotificationPrefs(): UseMutationResult<
  Result<NotificationPrefs>,
  Error,
  Partial<NotificationPrefs>,
  { previous: Result<NotificationsPage> | undefined }
> {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) =>
      writeNotificationPrefs(patch, { authToken: await getToken() }),
    // Optimistic: a segmented control that lags a round trip feels broken.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previous = qc.getQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY);
      qc.setQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY, (current) =>
        current === undefined || current.kind !== 'ok'
          ? current
          : { kind: 'ok', data: { ...current.data, prefs: { ...current.data.prefs, ...patch } } },
      );
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous !== undefined) qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
    },
    onSuccess: (result, _patch, context) => {
      if (result.kind !== 'ok') {
        if (context?.previous !== undefined) qc.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previous);
        return;
      }
      const settled = result.data;
      qc.setQueryData<Result<NotificationsPage>>(NOTIFICATIONS_QUERY_KEY, (current) =>
        current === undefined || current.kind !== 'ok'
          ? current
          : { kind: 'ok', data: { ...current.data, prefs: settled } },
      );
    },
  });
}

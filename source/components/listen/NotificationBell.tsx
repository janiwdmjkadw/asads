'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATIONS_QUERY_KEY,
  insertStreamedNotification,
  useClearNotifications,
  useDismissNotifications,
  useMarkNotificationsRead,
  useNotifications,
  type UserNotification,
} from '@/lib/api/notifications';
import { acquireAlphaCallsStream } from '@/lib/state/alpha-calls-stream';
import { acquireNotificationsStream } from '@/lib/state/notifications-stream';
import {
  useChartAlertsStore,
  type FiredChartAlert,
} from '@/lib/state/chart-alerts-store';
import { compactUsd } from '@/lib/format';
import { CoinThumb } from '@/components/trade/ChartAlertsWatcher';
import { playTradeSuccessSound } from '@/components/trade/tradeSound';
import { navigateToToken } from './navigation';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { Bolt } from './icons/Icons';
import { deriveFlashNotices, type FlashNotice } from '@/components/flash/flash-state';
import { useFlashWallets } from '@/components/flash/useFlashWallets';
import { openFlash } from '@/lib/state/flash-store';
import { NotificationPrefsPanel } from './NotificationPrefsPanel';
import './notis-v2.css';
import { NotificationRow, NotificationToast, openNotification } from './NotificationRows';
import {
  formatNotificationTime,
  groupByDay,
  isCelebration,
  isFreshEnoughToToast,
  readToastedIds,
  shouldSound,
  shouldToast,
  writeToastedIds,
} from './notification-view';

/**
 * The topnav bell: the durable record of everything that happened to the
 * signed-in user, and the small noti that announces it.
 *
 * WHAT CHANGED WITH CONDITIONALS. This was a referral-era inbox on a 30s
 * poll. It now has a PUSH path (`/api/v1/notifications/stream`) that inserts
 * frames straight into the react-query cache, so a fill lands in well under a
 * second with zero fetches; the poll drops to a five-minute backstop for a
 * stream that is down, and every (re)connect runs ONE catch-up refetch.
 *
 * VOLUME IS THE SERVER'S CALL. Whether a row toasts comes from
 * `metadata.interrupt` — the preference the projector already resolved from
 * the plan's own mode and the user's tier settings. This component never
 * infers volume from a notification's kind, so a muted plan cannot toast on a
 * client that shipped before the switch existed.
 *
 * SCOPE. Every row here belongs to the signed-in user by construction: the
 * inbox stores per-recipient copies, the list route filters on the session's
 * user id, and the stream hub matches user id before writing a frame.
 */

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Coin-call (and thesis-update) notifications carry the called mint +
 *  ticker in metadata — the click-through target for both the toast and
 *  the bell row. */
function coinCallTarget(
  notification: UserNotification,
): { mint: string; ticker: string } | null {
  if (notification.kind !== 'coin_call' && notification.kind !== 'coin_call_update') return null;
  const mint = notification.metadata['mint'];
  const ticker = notification.metadata['ticker'];
  if (typeof mint !== 'string' || !MINT_RE.test(mint)) return null;
  return {
    mint,
    ticker: typeof ticker === 'string' && ticker.trim().length > 0 ? ticker.trim() : `${mint.slice(0, 4)}…`,
  };
}

function openCoinCall(target: { mint: string; ticker: string }): void {
  navigateToToken(target.mint, { symbol: target.ticker.replace(/^\$/, '') });
}

export function NotificationBell(): React.ReactElement | null {
  const { isLoaded, isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationsRead();
  const clearAll = useClearNotifications();
  const dismiss = useDismissNotifications();
  const markedReadIdsRef = useRef(new Set<string>());

  const page = notificationsQuery.data?.kind === 'ok' ? notificationsQuery.data.data : null;
  const notifications = useMemo(() => page?.notifications ?? [], [page?.notifications]);
  const unreadCount = page?.unreadCount ?? 0;
  const prefs = page?.prefs ?? DEFAULT_NOTIFICATION_PREFS;
  const queryClient = useQueryClient();

  // ── the push path ────────────────────────────────────────────────────
  // Frames go straight into the cache; nothing here refetches per frame.
  // `onConnect` runs ONE catch-up so anything minted while the stream was
  // down still lands — the durable rows are the truth, never the stream.
  useEffect(() => {
    if (!isLoaded || isSignedIn !== true) return;
    const release = acquireNotificationsStream({
      onNotification: (frame) => {
        insertStreamedNotification(queryClient, frame);
      },
      onConnect: () => {
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      },
    });
    return release;
  }, [isLoaded, isSignedIn, queryClient]);

  // Coin calls are minted by the alpha lane, which notifies its OWN channel
  // — they do not ride the notification projector, so this refetch stays.
  // The debounce coalesces bursts into one fetch.
  useEffect(() => {
    if (!isLoaded || isSignedIn !== true) return;
    let timer: number | null = null;
    const refetchSoon = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      }, 400);
    };
    const release = acquireAlphaCallsStream({ onCall: refetchSoon });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      release();
    };
  }, [isLoaded, isSignedIn, queryClient]);

  // ── the toast bridge ─────────────────────────────────────────────────
  useEffect(() => {
    if (!page) return;
    const seen = readToastedIds();
    const nextSeen = new Set(seen);
    let changed = false;

    for (const notification of page.notifications) {
      if (notification.readAt !== null) continue;
      if (seen.has(notification.id)) continue;
      // partner_welcome gets the full-screen PartnerWelcomeModal instead of
      // a toast — firing both would double-announce the same event. Mark it
      // seen anyway, so it is not re-examined on every single render.
      if (notification.kind === 'partner_welcome') {
        nextSeen.add(notification.id);
        changed = true;
        continue;
      }
      // Two independent gates, and BOTH mark the row seen — a row that was
      // delivered silently must not start shouting later just because a
      // setting changed or the clock moved.
      //
      //  1. the server's resolved preference (a trace row, or a plan set to
      //     "inbox only", lands in the bell without interrupting);
      //  2. freshness — a toast announces, it does not recap. The first
      //     fetch after a day away carries a full page of unread rows, and
      //     without this every one of them would pop.
      if (!shouldToast(notification) || !isFreshEnoughToToast(notification)) {
        nextSeen.add(notification.id);
        changed = true;
        continue;
      }
      nextSeen.add(notification.id);
      changed = true;

      const call = coinCallTarget(notification);
      if (call) {
        // Coin calls keep their own rich toast: coin image + ticker.
        const toastId = `coin-call-${notification.id}`;
        toast(
          <button
            type="button"
            onClick={() => {
              toast.dismiss(toastId);
              openCoinCall(call);
            }}
            className="flex w-full items-center gap-2.5 text-left"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            aria-label={`Open ${call.ticker} trade page`}
          >
            <CoinThumb imageUrl={ingestionTokenImageUrl(call.mint)} ticker={call.ticker} />
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold" style={{ color: 'var(--ink-0)' }}>
                {notification.title}
              </span>
              {notification.body ? (
                <span className="block truncate text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  {notification.body}
                </span>
              ) : null}
            </span>
          </button>,
          { id: toastId, duration: 7000 },
        );
        continue;
      }

      // Everything the projector mints. Act tier holds for 7s (it may need
      // a decision); beat is a 4s glance.
      const toastId = `noti-${notification.id}`;
      const act = notification.metadata['tier'] === 'act';
      toast(
        <NotificationToast
          notification={notification}
          onOpen={() => {
            toast.dismiss(toastId);
            openNotification(notification);
          }}
        />,
        { id: toastId, duration: act ? 7000 : 4000 },
      );
      // The dopamine moment is EARNED: a confirmed fill or a completed plan,
      // and only when the user left sound on. A failure gets the inverse.
      if (shouldSound(notification) && isCelebration(notification)) {
        playTradeSuccessSound();
      }
    }

    if (changed) writeToastedIds(nextSeen);
  }, [page]);

  useEffect(() => {
    if (!open) return;
    const unreadIds = notifications
      .filter((n) => n.readAt === null && !markedReadIdsRef.current.has(n.id))
      .map((n) => n.id);
    if (unreadIds.length === 0 || markRead.isPending) return;
    for (const id of unreadIds) markedReadIdsRef.current.add(id);
    markRead.mutate(unreadIds);
  }, [markRead, notifications, open]);

  // The prefs face is a mode of the same popover; closing resets it so the
  // bell always reopens on the inbox.
  useEffect(() => {
    if (!open) setShowPrefs(false);
  }, [open]);

  const onDismissRow = useCallback(
    (id: string) => {
      if (dismiss.isPending) return;
      dismiss.mutate([id]);
    },
    [dismiss],
  );

  // Fired chart alerts live in a local (client-armed, client-fired) log —
  // merged into the same bell: unseen ones count toward the badge and
  // render as rows, marked seen when the popover opens.
  const firedAlerts = useChartAlertsStore((s) => s.fired);
  const markFiredSeen = useChartAlertsStore((s) => s.markFiredSeen);
  const clearFired = useChartAlertsStore((s) => s.clearFired);
  const unseenFiredCount = useMemo(
    () => firedAlerts.filter((alert) => !alert.seen).length,
    [firedAlerts],
  );
  useEffect(() => {
    if (open && unseenFiredCount > 0) markFiredSeen();
  }, [markFiredSeen, open, unseenFiredCount]);

  const badge = useMemo(() => {
    const total = unreadCount + unseenFiredCount;
    if (total <= 0) return null;
    return total > 9 ? '9+' : String(total);
  }, [unreadCount, unseenFiredCount]);

  // Flash entries are DERIVED from wallet state, never stored: one per
  // Solana wallet (the agent's included) whose lane pool is incomplete.
  // They are not dismissable and do not clear — which is also why they
  // stay OUT of the unread marker: this bell's badge is an unread DOT,
  // and a permanent condition would light it forever with no way for the
  // user to put it out.
  const flashWallets = useFlashWallets();
  const flashNotices = useMemo(() => deriveFlashNotices(flashWallets), [flashWallets]);

  const rows = useMemo(
    () => mergeNotificationRows(notifications, firedAlerts),
    [notifications, firedAlerts],
  );
  const groups = useMemo(() => groupByDay(rows, Date.now()), [rows]);

  if (!isLoaded || isSignedIn !== true) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badge ? `${badge} unread notifications` : 'Notifications'}
          className="hdr-ctl hdr-ctl-sq relative flex shrink-0 items-center"
        >
          <BellIcon />
          {/* Unread reads as a marker, not a count: a 5px dot inset
              INSIDE the control's edge, ringed in whatever the bar's own
              ground is so it separates from the bell glyph without
              drawing a second circle around itself. The exact count stays in aria-label.
              Deliberately NOT a number — with trace events flowing, a count
              becomes a figure people learn to ignore, which is the failure
              the tier system exists to prevent. */}
          {badge ? (
            <span
              aria-hidden
              className="absolute right-[4px] top-[4px] h-[5px] w-[5px] rounded-full bg-[var(--bell-dot,var(--ink-0))]"
              style={{ boxShadow: '0 0 0 1.5px var(--bell-ring,rgba(0,0,0,0.55))' }}
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        data-notis=""
        /* 380, up from the 330 this inherited from the popover default.
           `PopoverContent` merges shadcn defaults through `cn`, and
           tailwind-merge only drops them if their counterparts are passed
           here; `notis-v2.css` repeats the same values with `!important`
           because the shipped shadow is an inline style. */
        className="w-[380px] p-0 overflow-hidden border-0"
      >
        {showPrefs ? (
          <NotificationPrefsPanel prefs={prefs} onBack={() => setShowPrefs(false)} />
        ) : (
          <>
            <div
              className="px-3 py-2 flex items-center justify-between gap-2"
              style={{ borderBottom: '1px solid var(--hairline)' }}
            >
              <div className="text-[13px] font-semibold" style={{ color: 'var(--ink-0)' }}>
                Notis
              </div>
              <div className="flex items-center gap-1.5">
                {notifications.length > 0 || firedAlerts.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (clearAll.isPending) return;
                      clearFired();
                      if (notifications.length > 0) clearAll.mutate();
                    }}
                    disabled={clearAll.isPending}
                    className="text-[11px] rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
                    style={{
                      color: 'var(--ink-3)',
                      background: 'transparent',
                      border: '1px solid var(--hairline)',
                      cursor: clearAll.isPending ? 'default' : 'pointer',
                    }}
                  >
                    {clearAll.isPending ? 'Clearing…' : 'Clear all'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowPrefs(true)}
                  aria-label="Notification settings"
                  data-testid="notification-settings"
                  className="rounded px-1.5 py-0.5"
                  style={{
                    color: 'var(--ink-3)',
                    background: 'transparent',
                    border: '1px solid var(--hairline)',
                    cursor: 'pointer',
                  }}
                >
                  <GearIcon />
                </button>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {flashNotices.map((notice) => (
                <FlashNoticeRow
                  key={`flash-${notice.walletAccountId}`}
                  notice={notice}
                  onNavigate={() => setOpen(false)}
                />
              ))}
              {rows.length === 0 ? (
                flashNotices.length > 0 ? null : (
                  <div className="px-3 py-5 text-center text-[12px]" style={{ color: 'var(--ink-3)' }}>
                    No notis yet.
                  </div>
                )
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <div
                      className="noti-day px-3 pt-2 pb-1 t-num text-[10px] uppercase"
                      style={{ color: 'var(--ink-3)', letterSpacing: '0.06em' }}
                    >
                      {group.label}
                    </div>
                    {group.rows.map((row) =>
                      row.kind === 'server' ? (
                        <NotificationRow
                          key={row.notification.id}
                          notification={row.notification}
                          onNavigate={() => setOpen(false)}
                          onDismiss={onDismissRow}
                        />
                      ) : (
                        <FiredAlertRow
                          key={`alert-${row.alert.id}`}
                          alert={row.alert}
                          onNavigate={() => setOpen(false)}
                        />
                      ),
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

type BellRow =
  | { kind: 'server'; notification: UserNotification; tMs: number; createdAt: string }
  | { kind: 'alert'; alert: FiredChartAlert; tMs: number; createdAt: string };

/** The popover's page. Was five; one active plan can produce that in a minute. */
const BELL_ROW_LIMIT = 20;

/** Interleave server notifications with locally fired chart alerts, newest first. */
function mergeNotificationRows(
  notifications: ReadonlyArray<UserNotification>,
  firedAlerts: ReadonlyArray<FiredChartAlert>,
): BellRow[] {
  const rows: BellRow[] = [
    ...notifications.map((notification): BellRow => ({
      kind: 'server',
      notification,
      tMs: Date.parse(notification.createdAt) || 0,
      createdAt: notification.createdAt,
    })),
    ...firedAlerts.map((alert): BellRow => ({
      kind: 'alert',
      alert,
      tMs: alert.firedAtMs,
      createdAt: new Date(alert.firedAtMs).toISOString(),
    })),
  ];
  rows.sort((a, b) => b.tMs - a.tMs);
  return rows.slice(0, BELL_ROW_LIMIT);
}

/**
 * A permanent Flash offer row. No entrance animation and no motion of any
 * kind — bell entries appear frame-one; only exits and reflows move.
 */
function FlashNoticeRow({
  notice,
  onNavigate,
}: {
  notice: FlashNotice;
  onNavigate: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={`flash-notice-${notice.walletAccountId}`}
      onClick={() => {
        onNavigate();
        openFlash(notice.walletAccountId);
      }}
      className="px-3 py-2.5 flex gap-2 w-full text-left"
      style={{
        border: 'none',
        borderBottom: '1px solid var(--hairline)',
        background: 'transparent',
        cursor: 'pointer',
      }}
      aria-label={notice.title}
    >
      <span
        aria-hidden
        className="mt-0.5 shrink-0"
        style={{ color: 'var(--accent-primary)', lineHeight: 0 }}
      >
        <Bolt style={{ width: 14, height: 14 }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          {notice.title}
        </div>
        <div className="mt-0.5 text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
          {notice.hint}
        </div>
      </div>
    </button>
  );
}

function FiredAlertRow({
  alert,
  onNavigate,
}: {
  alert: FiredChartAlert;
  onNavigate: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate();
        navigateToToken(alert.mint, { symbol: alert.ticker.replace(/^\$/, '') });
      }}
      className="px-3 py-2.5 flex gap-2 w-full text-left"
      style={{
        border: 'none',
        borderBottom: '1px solid var(--hairline)',
        background: alert.seen ? 'transparent' : 'rgba(255,255,255,0.035)',
        cursor: 'pointer',
      }}
      aria-label={`Open ${alert.ticker} trade page`}
    >
      <span
        aria-hidden
        className="mt-1 h-2 w-2 rounded-full shrink-0"
        style={{
          background: alert.seen ? 'var(--hairline-2)' : 'var(--hold, #f3c709)',
          boxShadow: alert.seen ? 'none' : '0 0 8px var(--hold, #f3c709)',
        }}
      />
      <CoinThumb imageUrl={alert.imageUrl} ticker={alert.ticker} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          {alert.ticker} crossed {alert.direction} {compactUsd(alert.usdMc, '$0')} MC
        </div>
        <div className="mt-0.5 text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
          Chart alert — hit {compactUsd(alert.mcUsd, '$0')}
        </div>
        <div className="mt-1 text-[10px] t-num" style={{ color: 'var(--ink-3)' }}>
          {formatNotificationTime(new Date(alert.firedAtMs).toISOString())}
          <span style={{ marginLeft: 6, color: 'var(--accent-primary)' }}>open chart →</span>
        </div>
      </div>
    </button>
  );
}

function BellIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

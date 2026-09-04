'use client';

import { CoinThumb } from '@/components/trade/ChartAlertsWatcher';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import type { UserNotification } from '@/lib/api/notifications';
import { navigateToTerminalHref, navigateToToken } from './navigation';
import {
  countOf,
  figureOf,
  formatNotificationTime,
  hrefOf,
  legProgressOf,
  railToneOf,
  tokenOf,
  type RailTone,
} from './notification-view';

/**
 * The inbox row and the toast body, sharing one anatomy so the moment and
 * the record look like the same object.
 *
 * The rail is the row's whole language at a glance and encodes OUTCOME:
 * green it worked, amber it is waiting on you, red it failed, neutral just
 * so you know. The figure keeps the ledger's own ink — SOL out red, SOL in
 * green — exactly as the plan's Activity tab already draws it.
 */

const RAIL_COLOR: Readonly<Record<RailTone, string>> = {
  worked: 'var(--up)',
  needs: 'var(--hold, #ffcf5c)',
  failed: 'var(--down)',
  quiet: 'var(--hairline-2)',
};

/** In-app navigation for a server-resolved href. Never reconstructed here. */
export function openNotification(notification: UserNotification): void {
  const href = hrefOf(notification);
  if (href === null) return;
  const token = tokenOf(notification);
  // A trade href goes through `navigateToToken` so the page opens with the
  // ticker already painted; anything else is a plain in-app route.
  if (token !== null && href.startsWith('/trade/')) {
    navigateToToken(token.mint, { symbol: (token.symbol ?? '').replace(/^\$/, '') || null });
    return;
  }
  navigateToTerminalHref(href);
}

export function NotificationFigure({
  notification,
}: {
  notification: UserNotification;
}): React.ReactElement | null {
  const figure = figureOf(notification);
  if (figure === null) return null;
  return (
    <span
      className="shrink-0 inline-flex items-center rounded-[3px] px-[5px] h-5 t-num text-[12px]"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: figure.direction === 'up' ? 'var(--up)' : 'var(--down)',
      }}
    >
      {figure.text}
    </span>
  );
}

/**
 * One inbox row. Clickable only when the server resolved a destination —
 * a row with no href renders as a plain div rather than a button that does
 * nothing.
 */
export function NotificationRow({
  notification,
  onNavigate,
  onDismiss,
}: {
  notification: UserNotification;
  onNavigate: () => void;
  onDismiss?: (id: string) => void;
}): React.ReactElement {
  const unread = notification.readAt === null;
  const href = hrefOf(notification);
  const token = tokenOf(notification);
  const tone = railToneOf(notification);
  const count = countOf(notification);
  const legs = legProgressOf(notification);

  const body = (
    <>
      <span
        aria-hidden
        className="mt-1 h-2 w-2 rounded-full shrink-0"
        style={{
          background: unread ? RAIL_COLOR[tone] : 'var(--hairline-2)',
          boxShadow: unread && tone !== 'quiet' ? `0 0 8px ${RAIL_COLOR[tone]}` : 'none',
        }}
      />
      {token === null ? null : (
        <CoinThumb
          imageUrl={ingestionTokenImageUrl(token.mint)}
          ticker={token.symbol ?? token.mint.slice(0, 4)}
        />
      )}
      <div className="min-w-0 flex-1">
        {/* No inline colour: an inline style beats the sheet, and the
            sheet is what knows whether this row has been read. */}
        <div className="noti-title text-[12px] font-semibold">
          {notification.title}
        </div>
        {notification.body ? (
          <div className="noti-body mt-0.5 text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
            {notification.body}
          </div>
        ) : null}
        <div className="noti-meta">
          {/* The plan's progress, inline, when the server sends the legs.
              This is the whole point of the row: what fired, and how much
              is left, without opening anything. */}
          {legs === null ? null : (
            <span className="noti-segs" aria-hidden>
              {Array.from({ length: legs.total }, (_, i) => (
                <span key={i} className={i < legs.done ? 'is-done' : undefined} />
              ))}
            </span>
          )}
          {legs === null ? null : (
            <span className="noti-legtext">
              {legs.done} of {legs.total} ·{' '}
            </span>
          )}
          {formatNotificationTime(notification.createdAt)}
        </div>
      </div>
      {count === null ? null : (
        <span
          className="self-center shrink-0 rounded-[3px] px-[5px] t-num text-[10px]"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'var(--ink-3)',
          }}
        >
          ×{count}
        </span>
      )}
      <NotificationFigure notification={notification} />
      {href === null ? null : (
        <svg
          className="noti-go"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </>
  );

  /* No inline ground. An inline background beats every selector, and the
     unread tint written for a black panel is invisible on a white one, so
     the sheet owns the row plate and the read/unread weight. */
  const rowStyle = { background: 'transparent' } as const;

  return (
    /* `data-unread` so the sheet can weight the title: read and unread
       rows were identical apart from a 7px dot. */
    <div className="group relative" data-unread={unread ? 'true' : 'false'} style={rowStyle}>
      {href === null ? (
        <div className="px-3 py-2.5 flex gap-2">{body}</div>
      ) : (
        <button
          type="button"
          onClick={() => {
            onNavigate();
            openNotification(notification);
          }}
          className="px-3 py-2.5 flex gap-2 w-full text-left"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          aria-label={notification.title}
        >
          {body}
        </button>
      )}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          aria-label={`Dismiss: ${notification.title}`}
          data-testid={`dismiss-${notification.id}`}
          className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-3)',
            cursor: 'pointer',
            fontSize: 12,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The toast body. Same anatomy as the row, minus the dismiss affordance —
 * a toast dismisses itself.
 */
export function NotificationToast({
  notification,
  onOpen,
}: {
  notification: UserNotification;
  onOpen: () => void;
}): React.ReactElement {
  const token = tokenOf(notification);
  const tone = railToneOf(notification);
  const href = hrefOf(notification);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex w-full items-center gap-2.5 text-left"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '0 0 0 10px',
        cursor: href === null ? 'default' : 'pointer',
      }}
      aria-label={notification.title}
      disabled={href === null}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
        style={{ background: RAIL_COLOR[tone] }}
      />
      {token === null ? null : (
        <CoinThumb
          imageUrl={ingestionTokenImageUrl(token.mint)}
          ticker={token.symbol ?? token.mint.slice(0, 4)}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          {notification.title}
        </span>
        {notification.body ? (
          <span className="block truncate text-[11px]" style={{ color: 'var(--ink-3)' }}>
            {notification.body}
          </span>
        ) : null}
      </span>
      <NotificationFigure notification={notification} />
    </button>
  );
}

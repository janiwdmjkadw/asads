'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  setConditionalNotificationMode,
  type ConditionalNotificationMode,
} from '@/lib/conditionals';

/**
 * THE PER-ORDER BELL — this one plan, louder or quieter than everything else.
 *
 * Four positions, and the DEFAULT is `inherit`: no row, follow the user's
 * global per-tier settings. That is why the default costs zero writes, and
 * why turning the bell "on" is not an action anyone has to take.
 *
 *   inherit  follow my settings   (default)
 *   alert    tell me everything about this plan — even trace events toast
 *   inbox    badge and inbox only, never interrupts
 *   off      no inbox rows for this plan
 *
 * `off` NEVER LOSES HISTORY. The plan's own Activity tab reads the lifecycle
 * journal directly and stays complete whatever this says — which is exactly
 * why `off` can safely skip the write on the server.
 *
 * Optimistic: the control settles instantly and rolls back on failure. A
 * segmented control that lags a round trip reads as broken.
 *
 * NO DATA HOOKS. It takes `onChanged` the same way the header's other
 * actions take `onCancel` / `onResume`, and authenticates by cookie exactly
 * as `cancelConditional` does. That keeps `ConditionalDetailView` renderable
 * without a QueryClient or Clerk provider — which its tests rely on
 * (`renderToStaticMarkup`), and which a hook here would have broken.
 */

const CYCLE: readonly ConditionalNotificationMode[] = ['inherit', 'alert', 'inbox', 'off'];

const LABEL: Readonly<Record<string, string>> = {
  inherit: 'Notis: following your settings',
  alert: 'Notis: alert me about everything here',
  inbox: 'Notis: inbox only, no toasts',
  off: 'Notis: off for this plan (Activity still complete)',
};

function normalise(mode: ConditionalNotificationMode | undefined): ConditionalNotificationMode {
  return mode === 'alert' || mode === 'inbox' || mode === 'off' ? mode : 'inherit';
}

export function NotificationBellToggle({
  conditionalId,
  mode,
  compact = false,
  onChanged,
}: {
  conditionalId: string;
  mode: ConditionalNotificationMode | undefined;
  compact?: boolean;
  /** Fires after a settled write so the container can refetch. */
  onChanged?: () => void;
}): React.ReactElement {
  const [local, setLocal] = useState<ConditionalNotificationMode>(() => normalise(mode));
  const [pending, setPending] = useState(false);

  // The server is the source of truth: a refetch (or another tab) wins over
  // a stale local value, but never over an in-flight write.
  useEffect(() => {
    if (pending) return;
    setLocal(normalise(mode));
  }, [mode, pending]);

  const advance = useCallback(async () => {
    if (pending) return;
    const index = CYCLE.indexOf(local);
    const next = CYCLE[(index < 0 ? 0 : index + 1) % CYCLE.length] ?? 'inherit';
    const previous = local;
    setLocal(next);
    setPending(true);
    try {
      // Cookie auth, exactly like `cancelConditional` / `resumeConditional`.
      const result = await setConditionalNotificationMode(conditionalId, next);
      if (!result.ok) {
        setLocal(previous);
        return;
      }
      onChanged?.();
    } catch {
      setLocal(previous);
    } finally {
      setPending(false);
    }
  }, [conditionalId, local, onChanged, pending]);

  const muted = local === 'off';
  const loud = local === 'alert';
  const quiet = local === 'inbox';

  return (
    <button
      type="button"
      onClick={() => void advance()}
      disabled={pending}
      aria-label={LABEL[local] ?? LABEL['inherit'] ?? 'Notifications'}
      title={LABEL[local] ?? LABEL['inherit']}
      data-testid={`conditional-noti-${conditionalId}`}
      data-mode={local}
      className="relative inline-flex items-center justify-center shrink-0 rounded-[6px] transition-opacity disabled:opacity-60"
      style={{
        width: compact ? 24 : 28,
        height: compact ? 24 : 28,
        border: '1px solid var(--hairline)',
        background: 'transparent',
        color: muted ? 'var(--ink-3)' : loud ? 'var(--accent-primary)' : 'var(--ink-0)',
        opacity: muted ? 0.6 : 1,
        cursor: pending ? 'default' : 'pointer',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
        {muted ? (
          <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        ) : null}
      </svg>
      {/* `inbox` is the one state the glyph alone cannot say: the bell is on,
          but it will not interrupt. A single muted dot carries it. */}
      {quiet ? (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            right: 3,
            bottom: 3,
            width: 4,
            height: 4,
            background: 'var(--ink-3)',
          }}
        />
      ) : null}
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The decision window on the order card, actually counting down.
 *
 * Three things it has to get right.
 *
 * HYDRATION. The first client render must produce exactly what the server
 * produced, or React tears the tree down. So the initial state is the
 * literal starting value and the clock does not start until after mount —
 * the first tick is the first thing that differs, and by then hydration is
 * done.
 *
 * DRIFT. It reads a timestamp taken at mount rather than decrementing a
 * counter. A `setInterval` that subtracts one per fire loses time whenever
 * the browser throttles it — background tabs, a busy main thread — and a
 * clock that is thirty seconds slow after five minutes is worse than no
 * clock. Elapsed real time is the source of truth; the interval only
 * decides how often to look.
 *
 * ANNOUNCEMENT. `role="timer"` carries an implicit `aria-live="off"`, so a
 * screen reader can read it on demand and is not interrupted once a second
 * for eleven minutes.
 *
 * Plain React: `useState`, `useEffect`, `setInterval`. No Next API.
 */
function parse(value: string): number {
  const [minutes, seconds] = value.split(':');
  return Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

function format(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function Countdown({ from, className }: { from: string; className?: string }) {
  const total = parse(from);
  const [remaining, setRemaining] = useState(total);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, total - elapsed));
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [total]);

  return (
    <span
      role="timer"
      /* `tabular-nums` so the digits do not jitter the row's width as they
         change — Geist Mono is already fixed width, but the class makes
         that a stated requirement rather than a property of the current
         font choice. */
      className={cn('tabular-nums', remaining === 0 && 'text-lp-ink-3', className)}
    >
      {/* The value the server rendered, until the first tick replaces it. */}
      {remaining === total ? from : format(remaining)}
    </span>
  );
}

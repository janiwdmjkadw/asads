'use client';

import { useEffect, useRef } from 'react';

/**
 * Mounts once inside `TerminalShell` — which only renders for users the
 * `(terminal)` layout has already confirmed as redeemed. On every hard-refresh
 * mount it pings `/api/session/redeemed` to (re-)mint the signed redeemed
 * cookie, so subsequent hard refreshes skip the layout's api round-trip.
 * Best-effort and non-blocking: if it fails the layout simply falls back to the
 * (fast, internal-base) server check. Renders nothing.
 */
export function RedeemedCookieSync(): null {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Do not suppress this with sessionStorage. The marker cookie is HttpOnly, so the client
    // cannot tell whether it exists/expired/was cleared; a stale "synced" flag caused every
    // later hard refresh in the tab to fall back to the slower server invite check.
    void fetch('/api/session/redeemed', { method: 'POST' })
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  return null;
}

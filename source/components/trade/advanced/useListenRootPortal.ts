'use client';

import { useCallback, useState } from 'react';

/**
 * Portal target for popovers/modals that logically live inside the
 * trade panel. `.listen-root .panel` clips (`overflow: hidden`) and
 * forces every direct child into one stacking context
 * (`.panel > * { z-index: 1 }`), so fixed/absolute overlays rendered
 * in place paint UNDER later siblings — visually "transparent" and
 * unclickable (see WalletCountButton for the original diagnosis).
 * Theme tokens live under `.listen-root[data-theme-id]`, NOT `:root`,
 * so the portal target must be the nearest `.listen-root` rather than
 * `document.body` (body-portaled cards ignore the active theme).
 *
 * Usage: render `<span ref={anchorRef} hidden />` where the overlay
 * logically lives; `createPortal(overlay, portalTarget)` when non-null.
 */
export function useListenRootPortal(): {
  anchorRef: (el: Element | null) => void;
  portalTarget: HTMLElement | null;
} {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((el: Element | null) => {
    // Keep the last resolved target across unmount/remount races.
    if (el === null) return;
    setPortalTarget(el.closest<HTMLElement>('.listen-root') ?? document.body);
  }, []);
  return { anchorRef, portalTarget };
}

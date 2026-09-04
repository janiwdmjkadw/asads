'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Browser-like link affordances for card surfaces that can't be real
 * anchors (coin cards nest their own links/buttons, and nested `<a>`
 * elements get parser-split during SSR). The hook supplies:
 *
 *   - right-click → open the chart in a new tab (operator feedback 7/7:
 *     straight to the tab, no intermediate custom menu);
 *   - middle-click → open in new tab (mousedown preventDefault stops
 *     the autoscroll cursor);
 *   - the caller's plain-click handler should route modifier clicks
 *     (Ctrl/Cmd/Shift) through `openInNewTab` — see `wantsNewTab`.
 *
 * Inner real links/buttons (socials, quickbuy, tweet chips) are excluded
 * so they keep their own behavior and the browser's own context menu.
 */

export function wantsNewTab(e: ReactMouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey;
}

export function openInNewTab(href: string): void {
  if (typeof window === 'undefined') return;
  window.open(href, '_blank', 'noopener,noreferrer');
}

export function useCardLinkInteractions(options: {
  /** Relative href of the card's destination; `null` disables everything. */
  href: string | null;
}): {
  linkProps: {
    onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
    onAuxClick?: (e: ReactMouseEvent<HTMLElement>) => void;
    onMouseDown?: (e: ReactMouseEvent<HTMLElement>) => void;
  };
} {
  const { href } = options;

  if (href === null) {
    return { linkProps: {} };
  }

  return {
    linkProps: {
      onContextMenu: (e) => {
        // Let inner real links keep the browser's own menu — only card
        // chrome takes the open-in-new-tab shortcut.
        if ((e.target as HTMLElement).closest('a, button') !== null) return;
        e.preventDefault();
        openInNewTab(href);
      },
      onAuxClick: (e) => {
        if (e.button !== 1) return;
        if ((e.target as HTMLElement).closest('a, button') !== null) return;
        e.preventDefault();
        openInNewTab(href);
      },
      onMouseDown: (e) => {
        // Middle-press would otherwise start the browser autoscroll.
        if (e.button === 1) e.preventDefault();
      },
    },
  };
}

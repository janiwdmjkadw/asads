'use client';

import { useEffect, useState } from 'react';
import { PanelStack, type StackPanel } from './PanelStack';
import type { Axis } from './types';
import './column-tabs.css';

/*
 * ── ONE COLUMN AT A TIME, UNDER 1200 ─────────────────────────────────
 *
 * A row wants about 600px. Three of them side by side need 1800 before
 * anything else on the page is paid for, so below 1200 the board stops
 * trying to be a board: it shows one column and a strip of tabs to move
 * between them.
 *
 * ── WHY THE PANELS ARE NOT UNMOUNTED ─────────────────────────────────
 *
 * The inactive columns stay mounted and are hidden with CSS. Each one
 * holds a live feed subscription and its own scroll position, and
 * unmounting would drop both — switching tabs would reconnect a socket
 * and throw you back to the top of a list you had scrolled. Hidden is
 * cheap; remounting a feed is not.
 *
 * ── AND WHY IT IS NOT A MEDIA QUERY ALONE ────────────────────────────
 *
 * CSS could hide the other two columns on its own, but it cannot decide
 * WHICH one is showing — that is a choice the reader makes and it has
 * to survive a resize. So the breakpoint is read in JS, and the tab
 * strip only exists on the narrow side of it.
 */

const NARROW = 1200;

function useNarrow() {
  /*
   * Starts false and corrects on mount. It cannot ask the window during
   * render — the server has no window, and guessing produces a first
   * paint that disagrees with the client and gets thrown away.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}

interface ColumnTabsProps {
  axis: Axis;
  panels: StackPanel[];
  /** What each tab is called. Falls back to the panel's own id. */
  labels?: Record<string, string>;
  sizes: Partial<Record<string, number>>;
  onSizesChange: (sizes: Record<string, number>) => void;
  className?: string;
}

export function ColumnTabs({
  axis,
  panels,
  labels,
  sizes,
  onSizesChange,
  className,
}: ColumnTabsProps) {
  const narrow = useNarrow();
  const [activeId, setActiveId] = useState<string | null>(null);
  /* The first panel, until one is picked — and it re-resolves if the
     panel list changes, so a tab cannot point at a column that is gone. */
  const active = panels.find((p) => p.id === activeId) ?? panels[0];

  if (!narrow || panels.length < 2) {
    return (
      <PanelStack
        axis={axis}
        panels={panels}
        sizes={sizes}
        onSizesChange={onSizesChange}
        className={className}
      />
    );
  }

  return (
    <div className={`ct-wrap ${className ?? ''}`}>
      <div className="ct-bar" role="tablist">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === active?.id}
            className="ct-tab"
            data-on={p.id === active?.id ? '' : undefined}
            onClick={() => setActiveId(p.id)}
          >
            {labels?.[p.id] ?? p.id}
          </button>
        ))}
      </div>

      {/*
        * All of them rendered, one shown. `hidden` rather than removed:
        * these hold feed subscriptions and scroll positions.
        */}
      <div className="ct-body">
        {panels.map((p) => (
          <div key={p.id} className="ct-panel" data-on={p.id === active?.id ? '' : undefined}>
            {p.content}
          </div>
        ))}
      </div>
    </div>
  );
}

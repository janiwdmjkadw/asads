'use client';

import { Fragment, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Axis } from './types';

export interface StackPanel {
  id: string;
  sizing: 'fixed' | 'flex';
  /** Default flex weight (ignored for fixed panels). */
  weight: number;
  content: ReactNode;
}

interface PanelStackProps {
  axis: Axis;
  panels: StackPanel[];
  /** Controlled weights by panel id (percentages summing to ~100). Falls back
   *  to each panel's default `weight` when absent. */
  sizes: Partial<Record<string, number>>;
  onSizesChange: (sizes: Record<string, number>) => void;
  /** Minimum percentage a flex panel can shrink to. */
  minPercent?: number;
  /**
   * Separator thickness in px, and therefore the gap between panels —
   * there is no other gutter, so this number IS the space between lanes.
   *
   * 0, down from 8. There is no gutter between lanes now — they meet,
   * and the only line between them is each shell's own edge.
   *
   * ZERO IS SAFE HERE ONLY BECAUSE THE TARGET IS NOT THE TRACK.
   * `.discover-resize-handle` widens its hit area with a pseudo-element
   * that overflows ±4.5px, so a handle occupying no layout at all is
   * still a ~9px drag target straddling the seam. Take that rule out and
   * this number has to go back up, or lane resizing silently stops
   * working — there would be nothing left to grab.
   */
  handleSize?: number;
  className?: string;
}

/**
 * Viewport-filling stack of panels along one axis. A mix of `fixed` panels
 * (natural size, e.g. pinned Alpha in rows) and `flex` panels (proportional,
 * resizable) is supported uniformly. Dragging a divider grows the panel after
 * it and shrinks EVERY flex panel before it proportionally, so the total is
 * conserved and the page never scrolls. Controlled: the store owns the sizes.
 */
export function PanelStack({
  axis,
  panels,
  sizes,
  onSizesChange,
  minPercent = 12,
  handleSize = 0,
  className,
}: PanelStackProps) {
  const isVertical = axis === 'vertical';
  const flexRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<{
    flexIndex: number;
    startPos: number;
    startPct: number[];
    flexIds: string[];
    available: number;
    /** Latest redistributed weights, applied to the DOM via rAF and
     *  committed to the store only on release. */
    pending: number[] | null;
    rafHandle: number | null;
  } | null>(null);

  const flexPanels = panels.filter((p) => p.sizing === 'flex');
  const effWeight = (p: StackPanel) => sizes[p.id] ?? p.weight;

  const beginDrag = (flexIndex: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const flexIds = flexPanels.map((p) => p.id);
    const weights = flexPanels.map(effWeight);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let available = 0;
    for (const id of flexIds) {
      const el = flexRefs.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      available += isVertical ? r.height : r.width;
    }
    dragRef.current = {
      flexIndex,
      startPos: isVertical ? e.clientY : e.clientX,
      startPct: weights.map((w) => (w / total) * 100),
      flexIds,
      available: Math.max(available, 1),
      pending: null,
      rafHandle: null,
    };
    document.body.style.userSelect = 'none';
  };

  // Live resize never touches React: weights go straight to the panels'
  // flexGrow inside rAF (React's style diff won't clobber them — the sizes
  // prop is unchanged mid-drag), and the store commit + localStorage persist
  // happen exactly once on release. Routing every pointermove through
  // onSizesChange re-rendered the whole page root and synchronously wrote
  // localStorage at pointer-event rate.
  const applyPending = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.rafHandle = null;
    if (!drag.pending) return;
    drag.flexIds.forEach((id, i) => {
      const el = flexRefs.current.get(id);
      if (el) el.style.flexGrow = String(drag.pending![i]);
    });
  };

  const onMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = isVertical ? e.clientY : e.clientX;
    // Dragging toward the start (up/left) grows the panel after the handle.
    const deltaPct = ((drag.startPos - pos) / drag.available) * 100;
    drag.pending = redistribute(drag.startPct, drag.flexIndex, deltaPct, minPercent);
    if (drag.rafHandle === null) drag.rafHandle = requestAnimationFrame(applyPending);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.rafHandle !== null) cancelAnimationFrame(drag.rafHandle);
    document.body.style.userSelect = '';
    if (drag.pending) {
      const map: Record<string, number> = {};
      drag.flexIds.forEach((id, i) => {
        map[id] = drag.pending![i];
      });
      onSizesChange(map);
    }
  };

  let flexCounter = 0;
  const flexIndexByPanel = panels.map((p) => (p.sizing === 'flex' ? flexCounter++ : -1));

  return (
    <div
      className={className}
      /*
       * A hook for the ONE thing CSS needs to know here and React does
       * not tell it: which panel is at each end of the stack. The
       * columns are square everywhere they meet each other, and rounded
       * only where they meet the outside of the board, so the corner has
       * to be decided per position rather than per column. See
       * `.cl` in column.css.
       *
       * The spacer between panels renders only BETWEEN them, so the last
       * panel really is the stack's last child and `:first-child` /
       * `:last-child` are honest here.
       */
      data-panel-stack={axis}
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {panels.map((p, i) => {
        const isFlex = p.sizing === 'flex';
        const next = panels[i + 1];
        /*
         * ── THE COLUMNS DO NOT RESIZE ──────────────────────────────
         *
         * Column mode is a fixed board now: no drag handle between
         * neighbours, no `col-resize` cursor, no grip, no pointer
         * capture. `false` rather than deleting the branch, because ROWS
         * mode still wants its handles — `isVertical` is what tells the
         * two apart, and the whole drag path below stays reachable for
         * it.
         *
         * The spacer in the `else` still renders at `handleSize`, which
         * is 0, so the columns stay flush against each other.
         */
        const draggable = isVertical && isFlex && next?.sizing === 'flex';
        return (
          <Fragment key={p.id}>
            <div
              ref={
                isFlex
                  ? (el) => {
                      if (el) flexRefs.current.set(p.id, el);
                      else flexRefs.current.delete(p.id);
                    }
                  : undefined
              }
              style={
                isFlex
                  ? {
                      flexGrow: effWeight(p),
                      flexBasis: 0,
                      minHeight: 0,
                      minWidth: 0,
                      overflow: 'hidden',
                    }
                  : { flex: '0 0 auto', minHeight: 0, minWidth: 0, overflow: 'hidden' }
              }
            >
              {p.content}
            </div>
            {i < panels.length - 1 ? (
              draggable ? (
                <div
                  className="discover-resize-handle"
                  role="separator"
                  aria-orientation={isVertical ? 'horizontal' : 'vertical'}
                  data-direction={axis}
                  onPointerDown={beginDrag(flexIndexByPanel[i])}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  style={{
                    flex: `0 0 ${handleSize}px`,
                    cursor: isVertical ? 'row-resize' : 'col-resize',
                    touchAction: 'none',
                  }}
                >
                  <span className="discover-resize-handle__grip" aria-hidden />
                </div>
              ) : (
                <div aria-hidden style={{ flex: `0 0 ${handleSize}px` }} />
              )
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Grows the panel after `handleIndex` by `deltaPct` and removes that amount
 * from all panels before it, proportionally + clamped at `minPct`. Negative
 * `deltaPct` does the inverse. Total is conserved.
 */
function redistribute(
  start: number[],
  handleIndex: number,
  deltaPct: number,
  minPct: number,
): number[] {
  const next = [...start];
  const before: number[] = [];
  for (let k = 0; k <= handleIndex; k++) before.push(k);
  const after = handleIndex + 1;
  if (after >= next.length) return next;

  if (deltaPct > 0) {
    let remaining = deltaPct;
    for (let pass = 0; pass < 5 && remaining > 1e-4; pass++) {
      const removable = before.filter((k) => next[k] > minPct + 1e-6);
      const pool = removable.reduce((a, k) => a + (next[k] - minPct), 0);
      if (pool <= 1e-6) break;
      const take = Math.min(remaining, pool);
      for (const k of removable) {
        next[k] -= take * ((next[k] - minPct) / pool);
      }
      remaining -= take;
    }
    next[after] += deltaPct - remaining;
  } else if (deltaPct < 0) {
    const want = -deltaPct;
    const give = Math.min(want, Math.max(next[after] - minPct, 0));
    next[after] -= give;
    const totalBefore = before.reduce((a, k) => a + next[k], 0);
    for (const k of before) {
      next[k] += give * (totalBefore > 0 ? next[k] / totalBefore : 1 / before.length);
    }
  }
  return next;
}

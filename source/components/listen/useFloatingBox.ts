import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { pageZoom } from '@/lib/page-zoom';

export type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface FloatingRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingBoxOptions {
  /** localStorage key for persisting the rect across reloads. */
  storageKey: string;
  /** Smallest size the user is allowed to resize to. */
  minWidth?: number;
  minHeight?: number;
  /** Largest height the user is allowed to resize to (defaults to the
   *  viewport). Lets a panel cap its vertical growth so content can fill
   *  without ever leaving a large empty gap. */
  maxHeight?: number;
  /** Spawn size when no rect is persisted yet. */
  defaultWidth?: number;
  defaultHeight?: number;
  /**
   * Default position when no persisted rect exists. If `bottomRight` is
   * true, the default rect anchors to the bottom-right corner of the
   * viewport (margin = `viewportMargin`); otherwise the explicit
   * `defaultLeft`/`defaultTop` are used.
   */
  bottomRight?: boolean;
  /** Extra bottom clearance for the bottomRight default spawn (e.g. the
   *  app footer height, so a fresh panel never covers the status bar).
   *  Default only — dragging can still go anywhere the margin allows. */
  defaultBottomGap?: number;
  defaultLeft?: number;
  defaultTop?: number;
  /** Pixel padding kept from each viewport edge. */
  viewportMargin?: number;
  /**
   * If supplied AND no rect is persisted yet, the box spawns near this
   * anchor (typically the bounding rect of the element that opened the
   * box) instead of the static defaults.
   */
  initialAnchor?: DOMRectReadOnly | null;
}

interface ResolvedOptions {
  storageKey: string;
  minWidth: number;
  minHeight: number;
  maxHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  bottomRight: boolean;
  defaultBottomGap: number;
  defaultLeft: number;
  defaultTop: number;
  viewportMargin: number;
  initialAnchor: DOMRectReadOnly | null;
}

function resolve(options: FloatingBoxOptions): ResolvedOptions {
  return {
    storageKey: options.storageKey,
    minWidth: options.minWidth ?? 240,
    minHeight: options.minHeight ?? 200,
    maxHeight: options.maxHeight ?? Number.POSITIVE_INFINITY,
    defaultWidth: options.defaultWidth ?? 360,
    defaultHeight: options.defaultHeight ?? 280,
    bottomRight: options.bottomRight ?? false,
    defaultBottomGap: options.defaultBottomGap ?? 0,
    defaultLeft: options.defaultLeft ?? 24,
    defaultTop: options.defaultTop ?? 88,
    viewportMargin: options.viewportMargin ?? 8,
    initialAnchor: options.initialAnchor ?? null,
  };
}

/**
 * Persistent floating-box hook with drag + edge/corner resize.
 *
 * - The full rect (left/top/width/height) is persisted to localStorage
 *   under `storageKey`, clamped to viewport bounds on every change.
 * - `startDrag(event, mode)` is wired by the consumer onto either a
 *   move surface (mode = 'move') or a resize handle (mode = ResizeEdge).
 *   The hook installs window-level pointermove/up listeners while a
 *   drag is active.
 * - `bottomRight: true` produces a sensible default anchor in the
 *   bottom-right of the viewport — convenient for activity feeds /
 *   docked widgets.
 * - When the consumer attaches `boxRef` to the floating element, an
 *   active drag/resize applies the rect to the element directly inside
 *   requestAnimationFrame (`transform` for position, width/height for
 *   resize) and commits React state + localStorage only on pointerup —
 *   the box's subtree never re-renders per pointermove. Consumers that
 *   don't attach the ref keep the per-move state-update behavior.
 */
export function useFloatingBox(options: FloatingBoxOptions): {
  rect: FloatingRect;
  startDrag: (event: ReactPointerEvent, mode: 'move' | ResizeEdge) => void;
  boxRef: MutableRefObject<HTMLElement | null>;
  /** Adopt a rect programmatically (persisted like any user move) — used
   *  by the dock layer to hand a just-unsnapped panel to the cursor. */
  setRect: (next: FloatingRect) => void;
} {
  const {
    bottomRight,
    defaultHeight,
    defaultLeft,
    defaultTop,
    defaultWidth,
    initialAnchor,
    maxHeight,
    minHeight,
    minWidth,
    storageKey,
    viewportMargin,
  } = options;
  const opts = useMemo(
    () =>
      resolve({
        bottomRight,
        defaultHeight,
        defaultLeft,
        defaultTop,
        defaultWidth,
        initialAnchor,
        maxHeight,
        minHeight,
        minWidth,
        storageKey,
        viewportMargin,
      }),
    [
      bottomRight,
      defaultHeight,
      defaultLeft,
      defaultTop,
      defaultWidth,
      initialAnchor,
      maxHeight,
      minHeight,
      minWidth,
      storageKey,
      viewportMargin,
    ],
  );
  const [rect, setRect] = useState<FloatingRect>(() => defaultRect(opts));
  const boxRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | ResizeEdge;
    startX: number;
    startY: number;
    startRect: FloatingRect;
    margin: number;
    minWidth: number;
    minHeight: number;
    maxHeight: number;
    /** Latest clamped rect applied via the element ref (uncommitted). */
    pendingRect: FloatingRect | null;
    rafHandle: number | null;
  } | null>(null);
  const skipInitialPersistRef = useRef(true);

  useLayoutEffect(() => {
    setRect(initialRect(opts));
  }, [opts]);

  useEffect(() => {
    // rAF-coalesced direct style write: position moves via transform
    // (composited, no layout), resize-mode drags also set width/height
    // (transform can't express them).
    const applyPendingRect = () => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.rafHandle = null;
      const el = boxRef.current;
      const next = drag.pendingRect;
      if (!el || !next) return;
      // translate3d (not translate): promotes the box to its own compositor
      // layer for the gesture, so a heavy panel's paint never re-enters the
      // main thread per frame.
      el.style.transform =
        `translate3d(${next.left - drag.startRect.left}px, ${next.top - drag.startRect.top}px, 0)`;
      if (drag.mode !== 'move') {
        el.style.width = `${next.width}px`;
        el.style.height = `${next.height}px`;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      // clientX/Y are physical px; the rect drives fixed left/top, which the
      // low-DPI page zoom multiplies — divide or the box outruns the cursor.
      const z = pageZoom();
      const dx = (event.clientX - drag.startX) / z;
      const dy = (event.clientY - drag.startY) / z;
      const next = clampRect(
        applyDrag(drag.startRect, drag.mode, dx, dy),
        drag.mode,
        drag.startRect,
        drag.margin,
        drag.minWidth,
        drag.minHeight,
        drag.maxHeight,
      );
      if (boxRef.current) {
        drag.pendingRect = next;
        if (drag.rafHandle === null) {
          drag.rafHandle = window.requestAnimationFrame(applyPendingRect);
        }
      } else {
        // No element attached: legacy per-move state updates.
        setRect(next);
      }
    };
    const onPointerUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.rafHandle !== null) window.cancelAnimationFrame(drag.rafHandle);
      const el = boxRef.current;
      if (el && drag.pendingRect) {
        // Pin the final rect on the element before clearing the transform so
        // the box never flashes back to its pre-drag position while React
        // commits the state below (which also persists to localStorage once).
        el.style.transform = '';
        el.style.left = `${drag.pendingRect.left}px`;
        el.style.top = `${drag.pendingRect.top}px`;
        el.style.width = `${drag.pendingRect.width}px`;
        el.style.height = `${drag.pendingRect.height}px`;
        setRect(drag.pendingRect);
      }
    };
    // A drag that ends without a delivered pointerup (touch/pen
    // `pointercancel`, browser gesture interception, window blur) must run
    // the SAME commit path — otherwise `dragRef` stays armed forever, every
    // later pointermove keeps gluing the box to the cursor, and the opaque
    // panel (z-200 InstantTradeBox / z-30 feed) eats every click on the page.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (skipInitialPersistRef.current) {
      skipInitialPersistRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(opts.storageKey, JSON.stringify(rect));
    } catch {
      // Non-persistent contexts (private mode) still get the in-memory rect.
    }
  }, [rect, opts.storageKey]);

  // Re-clamp on viewport resize so the box stays on-screen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setRect((current) =>
        clampRect(
          current,
          'move',
          current,
          opts.viewportMargin,
          opts.minWidth,
          opts.minHeight,
          opts.maxHeight,
        ),
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [opts.viewportMargin, opts.minWidth, opts.minHeight, opts.maxHeight]);

  function startDrag(event: ReactPointerEvent, mode: 'move' | ResizeEdge): void {
    event.preventDefault();
    event.stopPropagation();
    // Capture the pointer so the terminating pointerup/pointercancel is
    // guaranteed to be delivered even if the cursor leaves the window.
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort (some synthetic pointers refuse it).
    }
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
      margin: opts.viewportMargin,
      minWidth: opts.minWidth,
      minHeight: opts.minHeight,
      maxHeight: opts.maxHeight,
      pendingRect: null,
      rafHandle: null,
    };
  }

  return { rect, startDrag, boxRef, setRect };
}

function defaultRect(opts: ResolvedOptions): FloatingRect {
  return {
    left: opts.defaultLeft,
    top: opts.defaultTop,
    width: opts.defaultWidth,
    height: opts.defaultHeight,
  };
}

/** Cap a HYDRATED size so a persisted near-viewport rect can never come back
 *  covering the whole page on refresh (a maximized floating feed on a dark
 *  theme reads as "the page is dead" — clicks land on the box, not the app).
 *  Live resizing is unaffected; this only bounds what we restore. */
function clampHydratedSize(
  size: Pick<FloatingRect, 'width' | 'height'>,
  opts: ResolvedOptions,
): Pick<FloatingRect, 'width' | 'height'> {
  if (typeof window === 'undefined') return size;
  const z = pageZoom();
  return {
    width: Math.max(opts.minWidth, Math.min(size.width, (window.innerWidth / z) * 0.7)),
    height: Math.max(opts.minHeight, Math.min(size.height, (window.innerHeight / z) * 0.8)),
  };
}

function initialRect(opts: ResolvedOptions): FloatingRect {
  if (typeof window === 'undefined') {
    return defaultRect(opts);
  }
  const savedSize = readSavedSize(opts);
  const { width, height } = clampHydratedSize(
    {
      width: savedSize?.width ?? opts.defaultWidth,
      height: savedSize?.height ?? opts.defaultHeight,
    },
    opts,
  );

  if (opts.initialAnchor) {
    // Anchor rects come from getBoundingClientRect (physical px); fixed
    // left/top are zoom-multiplied, so convert to layout px.
    const z = pageZoom();
    return clampRect(
      {
        left: opts.initialAnchor.left / z + 14,
        top: opts.initialAnchor.top / z + 52,
        width,
        height,
      },
      'move',
      { left: 0, top: 0, width, height },
      opts.viewportMargin,
      opts.minWidth,
      opts.minHeight,
      opts.maxHeight,
    );
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(opts.storageKey) ?? '',
    ) as Partial<FloatingRect>;
    if (isFiniteRect(parsed)) {
      const bounded = { ...parsed, ...clampHydratedSize(parsed, opts) };
      return clampRect(
        bounded,
        'move',
        bounded,
        opts.viewportMargin,
        opts.minWidth,
        opts.minHeight,
        opts.maxHeight,
      );
    }
  } catch {
    // Fall through to default below.
  }

  if (opts.bottomRight) {
    const vw = typeof window !== 'undefined' ? window.innerWidth / pageZoom() : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight / pageZoom() : 800;
    return clampRect(
      {
        left: vw - width - opts.viewportMargin - 8,
        top: vh - height - opts.viewportMargin - 8 - opts.defaultBottomGap,
        width,
        height,
      },
      'move',
      { left: 0, top: 0, width, height },
      opts.viewportMargin,
      opts.minWidth,
      opts.minHeight,
      opts.maxHeight,
    );
  }

  return clampRect(
    {
      left: opts.defaultLeft,
      top: opts.defaultTop,
      width,
      height,
    },
    'move',
    { left: 0, top: 0, width, height },
    opts.viewportMargin,
    opts.minWidth,
    opts.minHeight,
    opts.maxHeight,
  );
}

function readSavedSize(opts: ResolvedOptions): Pick<FloatingRect, 'width' | 'height'> | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(opts.storageKey) ?? '',
    ) as Partial<FloatingRect>;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    return {
      width: Math.max(opts.minWidth, Number(parsed.width)),
      height: Math.max(opts.minHeight, Number(parsed.height)),
    };
  } catch {
    return null;
  }
}

function isFiniteRect(rect: Partial<FloatingRect>): rect is FloatingRect {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function applyDrag(
  rect: FloatingRect,
  mode: 'move' | ResizeEdge,
  dx: number,
  dy: number,
): FloatingRect {
  if (mode === 'move') return { ...rect, left: rect.left + dx, top: rect.top + dy };
  const next = { ...rect };
  if (mode.includes('e')) next.width = rect.width + dx;
  if (mode.includes('s')) next.height = rect.height + dy;
  if (mode.includes('w')) {
    next.left = rect.left + dx;
    next.width = rect.width - dx;
  }
  if (mode.includes('n')) {
    next.top = rect.top + dy;
    next.height = rect.height - dy;
  }
  return next;
}

function clampRect(
  rect: FloatingRect,
  mode: 'move' | ResizeEdge,
  startRect: FloatingRect,
  margin: number,
  minWidth: number,
  minHeight: number,
  maxHeightOpt: number = Number.POSITIVE_INFINITY,
): FloatingRect {
  // innerWidth/Height are physical px; rects live in fixed-position layout
  // px, which the low-DPI page zoom multiplies — clamp in layout px.
  const vw = Math.max(
    minWidth + margin * 2,
    typeof window !== 'undefined' ? window.innerWidth / pageZoom() : 1280,
  );
  const vh = Math.max(
    minHeight + margin * 2,
    typeof window !== 'undefined' ? window.innerHeight / pageZoom() : 800,
  );
  let { left, top, width, height } = rect;
  const maxWidth = vw - margin * 2;
  const maxHeight = Math.min(vh - margin * 2, maxHeightOpt);
  width = Math.min(Math.max(width, minWidth), maxWidth);
  height = Math.min(Math.max(height, minHeight), maxHeight);
  if (mode !== 'move' && mode.includes('w') && width === minWidth)
    left = startRect.left + startRect.width - minWidth;
  if (mode !== 'move' && mode.includes('n') && height === minHeight)
    top = startRect.top + startRect.height - minHeight;
  left = Math.min(Math.max(left, margin), vw - margin - width);
  top = Math.min(Math.max(top, margin), vh - margin - height);
  return { left, top, width, height };
}

export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

export function resizeHandleStyle(edge: ResizeEdge): CSSProperties {
  const corner = 14;
  const thickness = 8;
  const style: CSSProperties = {
    position: 'absolute',
    zIndex: 3,
    touchAction: 'none',
  };
  if (edge.includes('n')) {
    style.top = -thickness / 2;
    style.height = thickness;
  }
  if (edge.includes('s')) {
    style.bottom = -thickness / 2;
    style.height = thickness;
  }
  if (edge.includes('e')) {
    style.right = -thickness / 2;
    style.width = thickness;
  }
  if (edge.includes('w')) {
    style.left = -thickness / 2;
    style.width = thickness;
  }
  if (edge === 'n' || edge === 's') {
    style.left = corner;
    style.right = corner;
    style.cursor = 'ns-resize';
  } else if (edge === 'e' || edge === 'w') {
    style.top = corner;
    style.bottom = corner;
    style.cursor = 'ew-resize';
  } else {
    style.width = corner;
    style.height = corner;
    style.cursor = edge === 'ne' || edge === 'sw' ? 'nesw-resize' : 'nwse-resize';
  }
  return style;
}

/**
 * Convenience helper for "move surface" drag handlers — only starts a
 * drag when the pointer target is not an interactive element or
 * resize handle, so clicks on buttons/inputs inside the floating box
 * keep working normally.
 */
export function shouldStartSurfaceDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest('button,input,textarea,select,a,[data-resize-handle="true"]');
}

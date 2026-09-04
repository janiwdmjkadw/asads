'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  useFloatingBox,
  type FloatingBoxOptions,
  type ResizeEdge,
} from '@/components/listen/useFloatingBox';
import {
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  useDockStore,
  type DockContext,
  type DockPanelId,
  type DockSide,
} from '@/lib/state/dock-store';
import { pageZoom } from '@/lib/page-zoom';

// Dockable floating panel: composes useFloatingBox (floating drag/resize/
// persistence, untouched) with edge snapping for the Discover side docks.
//
// Interactions (spec):
// - Drag the panel and HOLD it against a viewport edge for 1s to snap.
//   While the hold is arming, the panel blurs slightly and the target edge
//   glows; moving away or releasing cancels.
// - While dragging, the panel turns translucent so the page reads through.
// - Snapped panels drag-off (>56px pull toward center) back to their
//   previous floating rect.
// - Snapped panels resize from their CENTER-FACING edge only.
// - A side occupied by the OTHER panel refuses to arm (marker shows why).
//
// Performance contract: pointermove never triggers a React re-render of
// the page. Snapped widths reach DiscoverPage through CSS variables
// (--dock-left-w / --dock-right-w) written directly on <html>; React state
// only changes on snap/unsnap/open/close and at drag END.

/*
 * ── SNAPPING IS MEANT TO BE EASY ─────────────────────────────────────
 *
 * 96 and 220, up from 36 and 1000.
 *
 * A 36px strip is about a thumb's width of a 1280px window, so you had
 * to steer into a target you cannot see and then hold still in it for a
 * FULL SECOND. A second is a long time to hold a mouse steady — long
 * enough that a small wobble cancels the arm and you start over, which
 * is why docking felt like a fight.
 *
 * 96px is wide enough to hit by pushing toward the edge rather than
 * aiming at it, and 220ms is short enough to feel immediate while still
 * being long enough that dragging PAST one edge to the other does not
 * snap on the way through.
 */
const EDGE_ZONE_PX = 96;
const SNAP_HOLD_MS = 220;
const DRAG_OFF_PX = 56;

export const DOCK_TOP_PX = 8;
/**
 * Snapped docks start where the PAGE'S CONTENT starts and stop where it
 * stops.
 *
 * The old value cleared the top nav and the sub header but not the page
 * bar — the strip carrying the page name and the wallet chips — so a
 * dock snapped to a side ran up past the top of the columns and covered
 * it. `--h-pagebar` closes that gap.
 *
 * ── THE INSET BELONGS TO THE PAGE, NOT TO THE DOCK ───────────────────
 *
 * The 10 and the 8 used to be literals here, and they were Discover's:
 * that board carries its own 10px pad, so matching it put the dock's top
 * edge on the same line as the columns beside it.
 *
 * The trade page has no such pad — its content runs flush from the nav
 * to the footer. So the same two literals, which lined a dock up
 * perfectly on one page, opened a 12px black band above the panel and a
 * 10px one below it on the other. The dock was inset from a page that
 * is not inset.
 *
 * Now both edges are variables each page owns, defaulting to Discover's
 * numbers so nothing there changes: `--dock-inset-top` for the gap under
 * the nav, `--dock-bottom` for the whole bottom edge. `.tw-page` sets the
 * top inset to zero and the bottom edge to zero — see `trade-tape.css`.
 * The vars inherit down to the panel and to the grip, both of which are
 * children of the page wrapper even though they are `position: fixed`.
 */
/* Exported because the snapped resize grip renders OUTSIDE the panel —
   it has to run the same height as the edge it grabs, and the only way
   to guarantee that is to be given the same two values. */
export const DOCK_TOP =
  `calc(var(--h-topnav, 56px) + var(--h-subnav, 0px) + var(--h-pagebar, 0px) + var(--dock-inset-top, 10px))`;
/*
 * The footer term is inside the variable, not outside it, so a page can
 * take the panel PAST the footer to the bottom of the window — which is
 * what the trade page does. A docked panel there runs the full height of
 * the side it holds: no radius, no shoulder above the footer, nothing
 * between the last row and the bottom edge of the screen.
 */
export const DOCK_BOTTOM = `var(--dock-bottom, calc(var(--h-footer, 28px) + ${DOCK_TOP_PX}px))`;

function setDockVar(ctx: DockContext, side: DockSide, px: number): void {
  // Per-context vars: each page pads with its OWN context's widths, so the
  // hidden Discover pane's snapped layout never squeezes the trade page.
  document.documentElement.style.setProperty(
    `--dock-${side}-w-${ctx}`,
    `${Math.max(0, Math.round(px))}px`,
  );
}

/** Keeps the CSS vars in sync with the store (one instance per page is
 *  enough, but it is idempotent — both docks calling it is fine). */
export function useDockCssVars(ctx: DockContext): void {
  const panels = useDockStore((s) => s.contexts[ctx]);
  useEffect(() => {
    const width = (side: DockSide): number => {
      if (panels.wallet.side === side && panels.wallet.open) return panels.wallet.width;
      if (panels.tweets.side === side && panels.tweets.open) return panels.tweets.width;
      return 0;
    };
    setDockVar(ctx, 'left', width('left'));
    setDockVar(ctx, 'right', width('right'));
  }, [ctx, panels]);
}

export interface DockablePanel {
  /** null = floating. */
  side: DockSide | null;
  open: boolean;
  /** Current panel width in layout px — the floating rect when floating,
   *  the dock width when snapped. Commits at drag/resize END (both modes
   *  move the element imperatively during the gesture), so it is the
   *  right input for layout DECISIONS, not for per-frame paint. */
  width: number;
  /** Style block for the panel root (position + size, both modes). */
  shellStyle: CSSProperties;
  boxRef: ReturnType<typeof useFloatingBox>['boxRef'];
  /** Wire to onPointerDown of the drag surface. */
  onSurfacePointerDown: (event: ReactPointerEvent) => void;
  /** Floating-mode resize starter (pass-through of useFloatingBox). */
  startResize: (event: ReactPointerEvent, edge: ResizeEdge) => void;
  /** Snapped-mode: pointer-down handler for the center-facing edge. */
  onSnappedResizeStart: (event: ReactPointerEvent) => void;
  /** Which edge the panel is currently ARMING to snap to (blur + glow). */
  armingSide: DockSide | null;
  /** True while a drag is in flight (drives the translucency). */
  dragging: boolean;
  setOpen: (open: boolean) => void;
  unsnap: () => void;
}

export function useDockablePanel(
  id: DockPanelId,
  ctx: DockContext,
  floatOptions: FloatingBoxOptions,
): DockablePanel {
  const panels = useDockStore((s) => s.contexts[ctx]);
  const snapCtx = useDockStore((s) => s.snap);
  const unsnapCtx = useDockStore((s) => s.unsnap);
  const setWidthCtx = useDockStore((s) => s.setWidth);
  const setOpenCtx = useDockStore((s) => s.setOpen);
  const snap = (panel: DockPanelId, side: DockSide) => snapCtx(ctx, panel, side);
  const unsnapStore = (panel: DockPanelId) => unsnapCtx(ctx, panel);
  const setWidth = (panel: DockPanelId, width: number) => setWidthCtx(ctx, panel, width);
  const setOpenStore = (panel: DockPanelId, open: boolean) => setOpenCtx(ctx, panel, open);
  const me = panels[id];
  const other = panels[id === 'wallet' ? 'tweets' : 'wallet'];

  const { rect, startDrag, boxRef, setRect } = useFloatingBox(floatOptions);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const [armingSide, setArmingSide] = useState<DockSide | null>(null);
  const [dragging, setDragging] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedFor = useRef<DockSide | null>(null);
  // Refs so window-level listeners never hold stale state.
  const meRef = useRef(me);
  meRef.current = me;
  const otherRef = useRef(other);
  otherRef.current = other;

  // Snapped geometry enforcement: React's style diff removes its OWN old
  // left/top, but it cannot know about values useFloatingBox wrote directly
  // to the element. Re-assert the snapped box after every snap/width change.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || me.side === null) return;
    el.style.transform = '';
    el.style.left = '';
    el.style.right = '';
    el.style.height = '';
    el.style[me.side] = '0px';
    el.style.top = DOCK_TOP;
    el.style.bottom = DOCK_BOTTOM;
    el.style.width = `${me.width}px`;
  }, [boxRef, me.side, me.width]);

  const clearArming = useCallback(() => {
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    armTimer.current = null;
    armedFor.current = null;
    setArmingSide(null);
  }, []);

  useEffect(() => () => clearArming(), [clearArming]);

  // Gesture body treatment, ported from AgentWindow: a drag must not paint
  // a text selection across the page it passes over, and the cursor must
  // stay `grabbing` even when the pointer outruns the panel between frames
  // (otherwise it flickers to whatever is underneath — a large part of why
  // the dock drag read as "bad" next to the agent window).
  useEffect(() => {
    if (!dragging) return;
    const body = document.body;
    const prevUserSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = 'none';
    body.style.cursor = 'grabbing';
    return () => {
      body.style.userSelect = prevUserSelect;
      body.style.cursor = prevCursor;
    };
  }, [dragging]);

  /** Edge-hold arming step, shared by the floating drag and the
   *  continued post-unsnap drag: watches the pointer x, arms/cancels the
   *  hold timer, and snaps when it fires. */
  const updateArming = useCallback(
    (clientX: number) => {
      const vw = window.innerWidth;
      const side: DockSide | null =
        clientX <= EDGE_ZONE_PX ? 'left' : clientX >= vw - EDGE_ZONE_PX ? 'right' : null;
      // A side held by the other OPEN panel never arms.
      const blocked = side !== null && otherRef.current.side === side && otherRef.current.open;
      const target = blocked ? null : side;
      if (target !== armedFor.current) {
        if (armTimer.current !== null) clearTimeout(armTimer.current);
        armTimer.current = null;
        armedFor.current = target;
        setArmingSide(target);
        if (target !== null) {
          armTimer.current = setTimeout(() => {
            // End the in-flight drag FIRST: useFloatingBox (and the
            // continued drag below) move the box with imperative el.style
            // writes and commit on release — a commit landing after the
            // snap render would clobber the full-fill geometry. The
            // synthetic pointerup makes the drag commit while still
            // floating; the snap render then owns the element.
            window.dispatchEvent(new PointerEvent('pointerup'));
            snap(id, target);
            clearArming();
          }, SNAP_HOLD_MS);
        }
      }
    },
    [clearArming, id, snap],
  );

  /** Floating drag: delegate movement to useFloatingBox, and in parallel
   *  watch the pointer for edge-hold arming. */
  const onFloatingPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      startDrag(event, 'move');
      setDragging(true);
      const onMove = (e: PointerEvent) => updateArming(e.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDragging(false);
        /*
         * ── LETTING GO AT AN EDGE DOCKS IT ─────────────────────────
         *
         * The hold was the only way in: reach the edge, keep the mouse
         * still for 220ms, and it snaps — release a moment early and the
         * panel drops back into the middle of the page as if nothing had
         * happened. Every attempt that was not patient enough read as
         * "docking does not work".
         *
         * Releasing inside the edge zone now docks. The hold stays, so a
         * slow drag still snaps mid-gesture with the edge glow first;
         * this is the same intent honoured at the other end of it.
         */
        const target = armedFor.current;
        clearArming();
        /* One frame, so `useFloatingBox` commits its floating rect before
           the snap render takes the element over. */
        if (target !== null) window.requestAnimationFrame(() => snap(id, target));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [clearArming, id, snap, startDrag, updateArming],
  );

  /** Snapped drag: a horizontal pull toward the center detaches — and the
   *  panel HANDS OFF LIVE to the cursor (the user keeps dragging the
   *  floating modal in the same gesture, and can even re-snap the other
   *  edge without releasing). */
  const onSnappedPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const startX = event.clientX;
      const side = meRef.current.side;
      if (side === null) return;
      // clientX/Y are physical px while fixed left/top and transform px are
      // page-zoom-multiplied — divide by the zoom (1 on high-DPI screens) so
      // the panel tracks the cursor exactly on scaled screens.
      const zoom = pageZoom();
      setDragging(true);
      let detached = false;
      let base = { left: 0, top: 0, width: 0, height: 0 };
      let originX = 0;
      let originY = 0;
      // rAF-coalesced transform writes: pointermove can outpace the display
      // (1000Hz mice), so per-event style writes waste main-thread time.
      let lastX = 0;
      let lastY = 0;
      let rafHandle: number | null = null;
      const applyTransform = () => {
        rafHandle = null;
        const el = boxRef.current;
        if (el)
          el.style.transform = `translate3d(${(lastX - originX) / zoom}px, ${(lastY - originY) / zoom}px, 0)`;
      };
      const onMove = (e: PointerEvent) => {
        if (!detached) {
          const pull = side === 'left' ? e.clientX - startX : startX - e.clientX;
          if (pull <= DRAG_OFF_PX) return;
          detached = true;
          // Adopt the panel's floating size, anchored so the header sits
          // under the cursor; React renders it there once, then transform
          // writes carry the rest of the gesture.
          const prev = rectRef.current;
          base = {
            left: Math.round(e.clientX / zoom - prev.width / 2),
            top: Math.round(e.clientY / zoom - 20),
            width: prev.width,
            height: prev.height,
          };
          originX = e.clientX;
          originY = e.clientY;
          unsnapStore(id);
          setRect(base);
          return;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        if (rafHandle === null) rafHandle = window.requestAnimationFrame(applyTransform);
        updateArming(e.clientX);
      };
      const onUp = (e: Event) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
        setDragging(false);
        /* Same at the other end of an unsnap: pull a panel off one side,
           let go at the other, and it docks there. */
        const target = armedFor.current;
        clearArming();
        if (target !== null) {
          const el = boxRef.current;
          if (el) el.style.transform = '';
          window.requestAnimationFrame(() => snap(id, target));
          return;
        }
        if (detached) {
          const el = boxRef.current;
          if (el) el.style.transform = '';
          const pe = e as PointerEvent;
          const dx =
            typeof pe.clientX === 'number' && pe.clientX !== 0
              ? (pe.clientX - originX) / zoom
              : 0;
          const dy =
            typeof pe.clientY === 'number' && pe.clientY !== 0
              ? (pe.clientY - originY) / zoom
              : 0;
          setRect({ ...base, left: base.left + dx, top: base.top + dy });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [boxRef, clearArming, id, setRect, snap, unsnapStore, updateArming],
  );

  const onSurfacePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (meRef.current.side === null) onFloatingPointerDown(event);
      else onSnappedPointerDown(event);
    },
    [onFloatingPointerDown, onSnappedPointerDown],
  );

  /** Snapped resize: center-facing edge; width goes to the CSS var per
   *  frame (zero React work) and commits to the store on release. */
  const onSnappedResizeStart = useCallback(
    (event: ReactPointerEvent) => {
      const side = meRef.current.side;
      if (side === null) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = meRef.current.width;
      // Pointer deltas are physical px; the dock width is layout px, which
      // the low-DPI page zoom multiplies — divide to track the cursor 1:1.
      const zoom = pageZoom();
      const el = boxRef.current;
      let latest = startWidth;
      // rAF-coalesced: the dock-width CSS var on <html> drives the page's
      // content padding, so every write can reflow the whole page — cap the
      // writes at one per frame instead of one per pointermove event.
      let rafHandle: number | null = null;
      const applyWidth = () => {
        rafHandle = null;
        if (el) el.style.width = `${latest}px`;
        setDockVar(ctx, side, latest);
      };
      const onMove = (e: PointerEvent) => {
        const delta = (side === 'left' ? e.clientX - startX : startX - e.clientX) / zoom;
        latest = Math.min(
          DOCK_MAX_WIDTH,
          Math.max(DOCK_MIN_WIDTH, Math.round(startWidth + delta)),
        );
        if (rafHandle === null) rafHandle = window.requestAnimationFrame(applyWidth);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
        applyWidth();
        setWidth(id, latest);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [boxRef, id, setWidth],
  );

  const shellStyle: CSSProperties =
    me.side === null
      ? {
          position: 'fixed',
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          zIndex: 40,
        }
      : {
          position: 'fixed',
          top: DOCK_TOP,
          bottom: DOCK_BOTTOM,
          [me.side]: 0,
          width: me.width,
          zIndex: 40,
        };

  return {
    side: me.side,
    open: me.open,
    width: me.side === null ? rect.width : me.width,
    shellStyle,
    boxRef,
    onSurfacePointerDown,
    startResize: startDrag,
    onSnappedResizeStart,
    armingSide,
    dragging,
    setOpen: (open) => setOpenStore(id, open),
    unsnap: () => unsnapStore(id),
  };
}

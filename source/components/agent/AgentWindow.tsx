'use client';

/**
 * Floating agent chat window — the global chat surface on every route
 * (replaces the fixed side panel + dock pill). Draggable by its header,
 * resizable from the bottom-right corner, geometry + open state persisted
 * in `agent-chat:window:v1` (one global position across routes — spatial
 * muscle memory). Below `WINDOW_FLOAT_MIN_VIEWPORT_W` it degrades to a
 * fixed right-side sheet (no drag/resize).
 *
 * Drag moves via `transform: translate3d` on the element (zero layout
 * cost) and commits to left/top state on pointerup; resize writes
 * width/height directly — `[contain:layout_style_paint]` fences the
 * relayout inside the window so streaming/resizing never reflows the
 * live chart subtree (F§ inv. 4).
 *
 * Accessibility (carried over from the retired side panel): focus moves
 * to the input on open and back to the previously-focused element on
 * close; Escape closes; the window is a labelled complementary landmark.
 *
 * Body renders the frozen content contract — `<AgentBanner/>`,
 * `<AgentConversation/>`, `<AgentMessageInput ref clientContext/>` — the
 * content lane rewrites their internals with identical signatures.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { cva } from 'class-variance-authority';
import { Expand, X } from '@/components/listen/icons/Icons';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import {
  shouldHandleTokenHintEvent,
  TOKEN_HINT_EVENT,
  tokenTickerFromNavigationHint,
} from '@/components/listen/navigation';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { pageZoom } from '@/lib/page-zoom';
import {
  clampGeometry,
  geometryEquals,
  rectToLayoutGeometry,
  toLayoutPx,
  WINDOW_DEFAULT_H,
  WINDOW_DEFAULT_W,
  WINDOW_FLOAT_MIN_VIEWPORT_W,
  WINDOW_MIN_H,
  WINDOW_MIN_W,
  WINDOW_SOREN_DEFAULT_H,
  WINDOW_VIEWPORT_MARGIN,
  type ViewportSize,
  type WindowGeometry,
} from '@/lib/agent/window-geometry';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { AgentBanner } from './AgentBanner';
import { AgentConversation } from './AgentConversation';
import { AgentMessageInput } from './AgentMessageInput';

// `ag-glass` (agent-chat.css) carries the pane material: gradient body,
// ONE backdrop blur for the whole surface, specular rim, floor shadow.
// No `relative` here — `fixed` is already a containing block for the
// rim filament's absolute ::before, and two position utilities on one
// element would resolve by stylesheet order rather than intent.
const windowShell = cva(
  'ag-glass fixed z-40 flex flex-col overflow-hidden [contain:layout_style_paint]',
  {
    variants: {
      mode: {
        floating: 'rounded-[16px] border',
        sheet: 'right-0 border-l',
      },
    },
  },
);

/**
 * Viewport in LAYOUT px. `innerWidth/Height` are physical px while fixed
 * offsets are zoom-multiplied, so the low-DPI page zoom has to be divided
 * out — same convention as `useFloatingBox`'s clampRect.
 */
function viewport(): ViewportSize {
  const z = pageZoom();
  return { width: window.innerWidth / z, height: window.innerHeight / z };
}

/** Identity mark: a 14px diamond filled with the live accent gradient. */
function SparkMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="block h-[14px] w-[14px] shrink-0 drop-shadow-[0_0_6px_var(--flame-glow)]"
    >
      <defs>
        <linearGradient id="agent-window-mark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent-primary)" />
          <stop offset="100%" stopColor="var(--accent-secondary)" />
        </linearGradient>
      </defs>
      <path d="M8 1.4 L13.2 8 L8 14.6 L2.8 8 Z" fill="url(#agent-window-mark)" opacity="0.92" />
      <path d="M8 5.1 L10.4 8 L8 10.9 L5.6 8 Z" fill="var(--surface-1)" opacity="0.85" />
    </svg>
  );
}

/** Token symbol for the context chip; falls back to the truncated mint. */
function useContextChipLabel(mint: string | null): string | null {
  const [hintTick, setHintTick] = useState(0);
  useEffect(() => {
    if (mint === null) return;
    const onHint = (e: Event) => {
      if (shouldHandleTokenHintEvent((e as CustomEvent).detail, mint)) {
        setHintTick((t) => t + 1);
      }
    };
    window.addEventListener(TOKEN_HINT_EVENT, onHint);
    return () => window.removeEventListener(TOKEN_HINT_EVENT, onHint);
  }, [mint]);
  return useMemo(() => {
    if (mint === null) return null;
    void hintTick; // re-read after an identity-hint update for this mint
    return tokenTickerFromNavigationHint(mint) ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  }, [mint, hintTick]);
}

/** True below the floating floor — the window degrades to a side sheet. */
function useSheetMode(): boolean {
  const query = `(max-width: ${WINDOW_FLOAT_MIN_VIEWPORT_W - 1}px)`;
  const [sheet, setSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setSheet(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return sheet;
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  base: WindowGeometry;
}

/** Current rect in layout px — see `rectToLayoutGeometry` for why. */
function gestureBase(el: HTMLElement): WindowGeometry {
  return rectToLayoutGeometry(el.getBoundingClientRect(), pageZoom());
}

/** Pointer delta in layout px (clientX/Y are physical px). */
function pointerDelta(from: number, to: number): number {
  return toLayoutPx(to - from, pageZoom());
}

/** Below this (layout px) a header gesture is a click, not a drag. */
const DRAG_COMMIT_THRESHOLD_PX = 2;

/**
 * The Soren skin's shell (`soren-chat-surface`): no `ag-glass` — that pane
 * carries a backdrop blur the redesign forbids — and no cva border/radius,
 * because rim, radius, shadow and backdrop are one block in `agent-chat.css`
 * (`.ag-soren-window`). Everything else about the shell is unchanged.
 */
const SOREN_SHELL =
  'ag-soren-window fixed z-40 flex flex-col overflow-hidden [contain:layout_style_paint]';

export function AgentWindow({ mint, onClose }: { mint: string | null; onClose: () => void }) {
  const soren = useSorenChat();
  const router = useRouter();
  const geometry = useAgentChatStore((s) => s.geometry);
  const setGeometry = useAgentChatStore((s) => s.setGeometry);
  const focusNonce = useAgentChatStore((s) => s.focusNonce);
  const initPanelConversation = useAgentChatStore((s) => s.initPanelConversation);
  const userId = useAgentChatStore((s) => s.userId);
  const selectedWalletAccountId = useSelectedWalletStore((s) => s.selectedWalletAccountId);
  const sheet = useSheetMode();
  const chipLabel = useContextChipLabel(mint);
  const thumbUrl = mint === null ? null : ingestionTokenImageUrl(mint);
  // A 404/blocked thumb drops back to the text-only chip rather than an
  // alt-text box; reset per mint so navigating re-tries the new image.
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
  }, [mint]);

  const windowRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<Gesture | null>(null);
  const resizeRef = useRef<Gesture | null>(null);
  const resizeNERef = useRef<Gesture | null>(null);
  const [gesture, setGesture] = useState<'drag' | 'resize' | 'resize-ne' | null>(null);

  // Restore the session's conversation and reattach to any run that was
  // streaming before a refresh (F§ inv. 2) — same entry as the old panel.
  // Keyed on userId because the restore key is per-user: this no-ops until
  // the dock reports an identity, then runs against the right key (and runs
  // again, on the new key, if the active session switches users).
  useEffect(() => {
    void initPanelConversation();
  }, [initPanelConversation, userId]);

  // Focus management: capture the opener first (effect order matters —
  // the focusNonce effect below focuses the input right after), restore
  // focus on close.
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Runs on mount and again whenever openWindow() is called while the
  // window is already open (topnav "Ask the agent…", ⌘K re-open).
  useEffect(() => {
    inputRef.current?.focus();
  }, [focusNonce]);

  // Keep persisted geometry fully inside the viewport: clamp a restored
  // rect from a larger monitor before first paint, re-clamp on resize.
  useLayoutEffect(() => {
    const reclamp = () => {
      const state = useAgentChatStore.getState();
      if (state.geometry === null) return;
      const clamped = clampGeometry(state.geometry, viewport());
      if (!geometryEquals(state.geometry, clamped)) state.setGeometry(clamped);
    };
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, []);

  // Kill text selection (and cursor flicker) for the duration of a gesture.
  useEffect(() => {
    if (gesture === null) return;
    const body = document.body;
    const prevUserSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = 'none';
    body.style.cursor =
      gesture === 'drag' ? 'grabbing' : gesture === 'resize-ne' ? 'nesw-resize' : 'nwse-resize';
    return () => {
      body.style.userSelect = prevUserSelect;
      body.style.cursor = prevCursor;
    };
  }, [gesture]);

  const clientContext = useMemo(
    () => ({
      ...(mint !== null ? { mint } : {}),
      ...(selectedWalletAccountId !== null ? { wallet_account_id: selectedWalletAccountId } : {}),
    }),
    [mint, selectedWalletAccountId],
  );

  const dragTarget = (g: Gesture, e: ReactPointerEvent): WindowGeometry =>
    clampGeometry(
      {
        x: g.base.x + pointerDelta(g.startX, e.clientX),
        y: g.base.y + pointerDelta(g.startY, e.clientY),
        w: g.base.w,
        h: g.base.h,
      },
      viewport(),
    );

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (sheet || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button') !== null) return;
    const el = windowRef.current;
    if (el === null) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base: gestureBase(el),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture('drag');
  };

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = dragRef.current;
    const el = windowRef.current;
    if (g === null || el === null || e.pointerId !== g.pointerId) return;
    const target = dragTarget(g, e);
    el.style.transform = `translate3d(${target.x - g.base.x}px, ${target.y - g.base.y}px, 0)`;
  };

  const onHeaderPointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const g = dragRef.current;
    const el = windowRef.current;
    if (g === null || el === null || e.pointerId !== g.pointerId) return;
    dragRef.current = null;
    setGesture(null);
    el.style.transform = '';
    // A click (no movement) must not rewrite geometry: committing on every
    // pointerup would pin the CSS-default window to a measured rect for no
    // user intent — and any measurement drift would accumulate per click.
    const moved =
      Math.abs(pointerDelta(g.startX, e.clientX)) >= DRAG_COMMIT_THRESHOLD_PX ||
      Math.abs(pointerDelta(g.startY, e.clientY)) >= DRAG_COMMIT_THRESHOLD_PX;
    if (moved) setGeometry(dragTarget(g, e));
  };

  const resizeTarget = (g: Gesture, e: ReactPointerEvent): WindowGeometry => {
    const vp = viewport();
    const maxW = Math.max(WINDOW_MIN_W, vp.width - WINDOW_VIEWPORT_MARGIN - g.base.x);
    const maxH = Math.max(WINDOW_MIN_H, vp.height - WINDOW_VIEWPORT_MARGIN - g.base.y);
    return {
      x: g.base.x,
      y: g.base.y,
      w: Math.min(Math.max(g.base.w + pointerDelta(g.startX, e.clientX), WINDOW_MIN_W), maxW),
      h: Math.min(Math.max(g.base.h + pointerDelta(g.startY, e.clientY), WINDOW_MIN_H), maxH),
    };
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (sheet || e.button !== 0) return;
    const el = windowRef.current;
    if (el === null) return;
    const base = gestureBase(el);
    resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base };
    // Materialize top-left anchoring so height growth extends downward
    // even while the window still sits on its bottom-anchored default.
    el.style.left = `${base.x}px`;
    el.style.top = `${base.y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = `${base.w}px`;
    el.style.height = `${base.h}px`;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture('resize');
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = resizeRef.current;
    const el = windowRef.current;
    if (g === null || el === null || e.pointerId !== g.pointerId) return;
    const target = resizeTarget(g, e);
    el.style.width = `${target.w}px`;
    el.style.height = `${target.h}px`;
  };

  const onResizePointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const g = resizeRef.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    resizeRef.current = null;
    setGesture(null);
    setGeometry(clampGeometry(resizeTarget(g, e), viewport()));
  };

  /**
   * The top-right corner (soren): the window's default rest is the
   * bottom-left of the viewport, so its natural growth corner is the
   * opposite one. Anchors the BOTTOM-LEFT corner — width grows right,
   * height grows UP under the pointer — where the bottom-right handle
   * anchors the top-left and can barely grow a bottom-rested window.
   */
  const resizeNETarget = (g: Gesture, e: ReactPointerEvent): WindowGeometry => {
    const vp = viewport();
    const bottom = g.base.y + g.base.h;
    const maxW = Math.max(WINDOW_MIN_W, vp.width - WINDOW_VIEWPORT_MARGIN - g.base.x);
    const maxH = Math.max(WINDOW_MIN_H, bottom - WINDOW_VIEWPORT_MARGIN);
    const w = Math.min(Math.max(g.base.w + pointerDelta(g.startX, e.clientX), WINDOW_MIN_W), maxW);
    const h = Math.min(Math.max(g.base.h - pointerDelta(g.startY, e.clientY), WINDOW_MIN_H), maxH);
    return { x: g.base.x, y: bottom - h, w, h };
  };

  const onResizeNEPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (sheet || e.button !== 0) return;
    const el = windowRef.current;
    if (el === null) return;
    const base = gestureBase(el);
    resizeNERef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base };
    // Materialize bottom-left anchoring so height growth extends upward
    // while the anchored corner holds still.
    el.style.left = `${base.x}px`;
    el.style.bottom = `${viewport().height - (base.y + base.h)}px`;
    el.style.top = 'auto';
    el.style.right = 'auto';
    el.style.width = `${base.w}px`;
    el.style.height = `${base.h}px`;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture('resize-ne');
  };

  const onResizeNEPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = resizeNERef.current;
    const el = windowRef.current;
    if (g === null || el === null || e.pointerId !== g.pointerId) return;
    const target = resizeNETarget(g, e);
    el.style.width = `${target.w}px`;
    el.style.height = `${target.h}px`;
  };

  const onResizeNEPointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const g = resizeNERef.current;
    const el = windowRef.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    resizeNERef.current = null;
    setGesture(null);
    // The committed geometry positions by left/top; the bottom written at
    // gesture start would otherwise linger as a stale over-constraint.
    if (el !== null) el.style.bottom = 'auto';
    setGeometry(clampGeometry(resizeNETarget(g, e), viewport()));
  };

  const openFullPage = () => {
    onClose();
    router.push('/agent');
  };

  const positionStyle: CSSProperties = sheet
    ? {
        top: 'calc(var(--h-topnav, 56px) + var(--h-subnav, 0px) + var(--h-pagebar, 0px))',
        bottom: 'var(--h-footer, 30px)',
        /*
         * 100vw, not 92. The 8% gutter is a tablet idea: it says "there
         * is a page behind this". On a phone that ribbon is 30px of
         * unusable board down one edge while the conversation is
         * squeezed, and the composer's send key ends up under the pane's
         * own border. Under 560 the chat IS the screen; above it the
         * sheet keeps its 420 and the page shows beside it.
         */
        width: `min(${WINDOW_DEFAULT_W}px, 100vw)`,
      }
    : geometry !== null
      ? { left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h }
      : {
          left: WINDOW_VIEWPORT_MARGIN,
          bottom: 'calc(var(--h-footer, 30px) + 12px)',
          width: WINDOW_DEFAULT_W,
          height: soren ? WINDOW_SOREN_DEFAULT_H : WINDOW_DEFAULT_H,
          maxWidth: `calc(100vw - ${2 * WINDOW_VIEWPORT_MARGIN}px)`,
          // Cap so the bottom-anchored default can never poke above the
          // viewport top on short screens (bottom offset + top margin).
          maxHeight: `calc(100vh - var(--h-footer, 30px) - ${WINDOW_VIEWPORT_MARGIN + 12}px)`,
        };

  return (
    <aside
      ref={windowRef}
      role="complementary"
      aria-label="Agent chat"
      data-agent-chat="window"
      data-testid="agent-window"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      data-soren={soren ? 'true' : undefined}
      data-mode={soren ? (sheet ? 'sheet' : 'floating') : undefined}
      className={soren ? SOREN_SHELL : windowShell({ mode: sheet ? 'sheet' : 'floating' })}
      style={positionStyle}
    >
      {soren ? (
        <>
          {/* The headerless window's drag affordance (D8): a reserved,
              visually empty 66px top row carrying the SAME translate3d
              gesture as the old header. It is a layout row, not an
              overlay, so nothing scrolls under an invisible handle — and
              it is `aria-hidden`, so the × lives outside it. */}
          <div
            data-testid="agent-window-drag"
            aria-hidden
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerEnd}
            onPointerCancel={onHeaderPointerEnd}
            className={`ag-soren-drag ${
              sheet
                ? ''
                : gesture === 'drag'
                  ? 'cursor-grabbing touch-none'
                  : 'cursor-grab touch-none'
            }`}
          />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close agent chat"
            data-testid="agent-window-close"
            className="ag-soren-close"
          >
            <X style={{ width: 12, height: 12 }} />
          </button>
          {/* The growth corner (owner, 2026-08-24: "drag the top right to
              go bigger or smaller"). 18px square at the very corner —
              clear of the × at inset 18 — above the drag row, so the
              corner resizes and the strip beside it drags. */}
          {sheet ? null : (
            <div
              aria-hidden
              data-testid="agent-window-resize-ne"
              onPointerDown={onResizeNEPointerDown}
              onPointerMove={onResizeNEPointerMove}
              onPointerUp={onResizeNEPointerEnd}
              onPointerCancel={onResizeNEPointerEnd}
              className="absolute right-0 top-0 z-[4] h-[18px] w-[18px] touch-none cursor-nesw-resize"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                className="h-full w-full text-[var(--ink-4)]"
                style={{ transform: 'scaleY(-1)' }}
              >
                <path d="M13 7L7 13M13 11l-2 2" />
              </svg>
            </div>
          )}
        </>
      ) : (
        <header
          data-testid="agent-window-header"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerEnd}
          onPointerCancel={onHeaderPointerEnd}
          className={`ag-header relative z-[2] flex h-[38px] shrink-0 select-none items-center justify-between gap-2 px-3 ${
            sheet ? '' : gesture === 'drag' ? 'touch-none cursor-grabbing' : 'touch-none cursor-grab'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <SparkMark />
            <span className="text-[12px] font-medium tracking-[-0.005em] text-[var(--ink-1)]">
              agent
            </span>
            {mint !== null && chipLabel !== null ? (
              <>
                <span aria-hidden className="mx-px h-[12px] w-px shrink-0 bg-[var(--hairline-2)]" />
                <span
                  data-testid="agent-window-context-chip"
                  title={mint}
                  className="inline-flex h-[19px] min-w-0 items-center gap-[5px] rounded-full border border-[var(--hairline-2)] px-[7px]"
                >
                  {thumbUrl !== null && !thumbFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl}
                      alt=""
                      onError={() => setThumbFailed(true)}
                      className="block h-[12px] w-[12px] shrink-0 rounded-[4px] object-cover"
                    />
                  ) : null}
                  <span className="truncate font-[family-name:var(--sans)] tabular-nums text-[10px] leading-none text-[var(--ink-2)]">
                    {chipLabel}
                  </span>
                </span>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={openFullPage}
              title="Open full view"
              aria-label="Open full-page agent chat"
              data-testid="agent-window-expand"
              className="ag-iconbtn inline-flex h-6 w-6 items-center justify-center text-[var(--ink-3)] hover:text-[var(--ink-0)]"
            >
              <Expand style={{ width: 14, height: 14 }} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close agent chat"
              data-testid="agent-window-close"
              className="ag-iconbtn inline-flex h-6 w-6 items-center justify-center text-[var(--ink-3)] hover:text-[var(--ink-0)]"
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </header>
      )}
      <AgentBanner />
      <AgentConversation />
      <AgentMessageInput ref={inputRef} clientContext={clientContext} />
      {sheet ? null : (
        <div
          aria-hidden
          data-testid="agent-window-resize"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          className="absolute bottom-0 right-0 h-4 w-4 touch-none cursor-nwse-resize"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            className="h-full w-full text-[var(--ink-4)]"
          >
            <path d="M13 7L7 13M13 11l-2 2" />
          </svg>
        </div>
      )}
    </aside>
  );
}

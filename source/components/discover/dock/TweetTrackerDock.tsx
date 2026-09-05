'use client';

import { useCallback, useEffect, useState } from 'react';
import { TweetsPanel, type TweetsPanelMeta } from '@/components/tracker/TweetsPanel';
import {
  getTweetChimeMuted,
  setTweetChimeMuted,
} from '@/components/discover/attentionSounds';
import { useDockablePanel } from './useDockablePanel';
import {
  CloseGlyph,
  DockArmingGlow,
  SnappedResizeHandle,
} from './DockChrome';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RESIZE_EDGES, resizeHandleStyle } from '@/components/listen/useFloatingBox';
import type { DockContext } from '@/lib/state/dock-store';
import { useFloatingPanelZ } from '@/lib/state/floating-panel-order';

/** v3: the glass redesign ships a larger default rect; keying it fresh
 *  lets existing users pick the new default up instead of keeping the
 *  cramped v2 360×480 forever. */
const RECT_KEY = 'discover:tweet-tracker-rect:v3';

/**
 * Floating / snappable tweet tracker for the Discover page. The content is
 * the tracker page's own <TweetsPanel/> (live tweet feed + the same
 * autocomplete manager toolbar as the Trackers tab), so functionality stays
 * identical — this shell adds the dock behaviors and the glass chrome:
 *
 * - ONE header row. The panel runs `chromeless` and reports its header
 *   data (count / live / paused) via `onMetaChange`, so the dock header
 *   carries the title, count chip, live dot, pause chip, and chime bell —
 *   the stacked double-header this replaced was most of the "crumbled"
 *   reading at dock widths.
 * - Engage-to-manage: the add-field + bulk buttons render only while the
 *   user is clicked INTO the panel (pointer/focus inside); clicking off
 *   hides them and returns the height to the feed. Reading never shows
 *   management chrome.
 * - Liquid-glass shell: translucent surface + backdrop blur, ONE element
 *   (the same budget as toast Variant09 — the blur cost is per-element,
 *   and this is the only one). While dragging the surface goes opaque and
 *   the blur is dropped so no per-frame re-filter runs against the live
 *   feed behind it.
 * - The footer "Tweets" toggle detaches; the X reattaches. Drag the
 *   HEADER; hold against a free edge to snap; resize from the
 *   center-facing edge when snapped. Side markers shared with the wallet
 *   activity dock.
 */
export function TweetTrackerDock({ ctx }: { ctx: DockContext }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Click-to-raise among the floating surfaces (shared band with the
  // wallet dock, instant box, and canvas popover).
  const { zIndex: panelZ, raise: raisePanel } = useFloatingPanelZ('tweets-dock');

  const dock = useDockablePanel('tweets', ctx, {
    storageKey: RECT_KEY,
    minWidth: 320,
    minHeight: 360,
    defaultWidth: 400,
    defaultHeight: 540,
    bottomRight: true,
    // Spawn clear of the bottom status bar (footer + breathing room).
    defaultBottomGap: 44,
  });

  // Engage-to-manage: clicked into the panel = management chrome shown.
  // Any pointerdown inside engages (capture phase, so it also covers the
  // header/feed); a pointerdown anywhere else disengages. Escape also
  // disengages so keyboard users can dismiss without reaching for the
  // mouse. Listener attached only while engaged — zero idle cost.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!engaged || !dock.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (dock.boxRef.current?.contains(event.target)) return;
      setEngaged(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEngaged(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [engaged, dock.open, dock.boxRef]);

  // Header data reported by the chromeless panel (count / live / paused).
  const [meta, setMeta] = useState<TweetsPanelMeta>({ count: 0, live: false, paused: false });
  const onMetaChange = useCallback((next: TweetsPanelMeta) => setMeta(next), []);

  // Mirror of the persisted chime mute — the module store owns the truth,
  // this state only drives the bell icon (same pattern as TweetsPanel's
  // own header bell, which chromeless mode suppresses).
  const [chimeMuted, setChimeMuted] = useState(false);
  useEffect(() => {
    setChimeMuted(getTweetChimeMuted());
  }, []);

  if (!mounted) return null;

  if (!dock.open) return null;

  const floating = dock.side === null;

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
      <DockArmingGlow side={dock.armingSide} />
      <section
        ref={dock.boxRef as React.MutableRefObject<HTMLElement | null>}
        role="dialog"
        aria-label="Tweet tracker"
        className="dock-terminal"
        onPointerDownCapture={() => {
          raisePanel();
          setEngaged(true);
        }}
        style={{
          ...dock.shellStyle,
          zIndex: panelZ,
          borderRadius: floating ? 10 : 0,
          transition: dock.dragging ? 'none' : 'opacity 120ms ease',
          willChange: dock.dragging ? 'transform' : undefined,
          /*
           * ── FLAT ───────────────────────────────────────────────────
           *
           * One ground, one hairline, one corner. No backdrop blur, no
           * top gradient, no inset light, no drop shadow.
           *
           * What this replaces was glass: a translucent surface at 76%,
           * a 22px / 1.45 backdrop filter, a white gradient down the
           * first 42% of it, a 1px inset highlight and a two part
           * shadow. Six devices, all saying the one thing — this
           * floats. A different ground to the page says it once, and
           * says it at every width, on every backdrop, with nothing to
           * re-filter per frame while the panel is dragged.
           *
           * `--surface-1` is opaque, so the drag no longer swaps ground
           * and drops a filter to stay cheap. It looks the same moving
           * as it does still.
           */
          background: 'var(--surface-1)',
          /*
           * ── A SNAPPED PANEL HAS ONE EDGE ───────────────────────────
           *
           * Floating, it is an object and gets a border all the way
           * round. Snapped, three of those four sides are lying: the top
           * runs along the nav, the bottom along the footer, and the
           * outer one along the window. What is left is the seam between
           * the panel and the page, and that is the only line worth
           * drawing.
           */
          border: floating ? '1px solid var(--hairline)' : 'none',
          borderLeft: dock.side === 'right' ? '1px solid var(--hairline)' : undefined,
          borderRight: dock.side === 'left' ? '1px solid var(--hairline)' : undefined,
          boxShadow: floating
            ? '0 0 0 1px rgba(11, 14, 20, 0.12), 0 20px 52px rgba(11, 14, 20, 0.18)'
            : 'none',
          fontFamily: 'var(--mono)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <div
          className="flex items-center gap-2 pl-3.5 pr-2 h-[40px] shrink-0 select-none"
          onPointerDown={(event) => dock.onSurfacePointerDown(event)}
          style={{
            cursor: dock.dragging ? 'grabbing' : 'grab',
            borderBottom: '1px solid color-mix(in srgb, var(--ink-0) 7%, transparent)',
          }}
        >
          {/*
            * The tracker page's header, in a panel.
            *
            * It was `TWEET TRACKER` at 11px bold on a 0.14em track — the
            * printout voice the rest of the product has dropped — with a
            * bordered pill around the count and a lit pip after it. The
            * pip said the feed had tweets, which the feed says by having
            * tweets in it, and the pill was chrome around a figure that
            * is never more than three digits.
            */}
          <span
            className="text-[13px] font-semibold whitespace-nowrap"
            style={{ color: 'var(--ink-0)', fontFamily: 'var(--sans)', lineHeight: 1 }}
          >
            Tweets
          </span>
          {meta.count > 0 ? (
            <span
              className="text-[11.5px] font-semibold tabular-nums shrink-0"
              style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)', lineHeight: 1 }}
            >
              {meta.count}
            </span>
          ) : null}
          {meta.paused ? (
            /* A quiet state, told quietly — the same change the tracker
               page's own chip took. It was a bordered, washed, bold
               uppercase badge in the accent: three devices to say the
               feed is asleep, which is not news worth that much ink. */
            <span
              className="inline-flex h-[18px] items-center rounded-full px-2"
              style={{
                color: 'var(--ink-3)',
                background: 'color-mix(in srgb, var(--ink-0) 7%, transparent)',
                border: '1px solid var(--hairline)',
                fontFamily: 'var(--sans)',
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              Paused
            </span>
          ) : null}
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  const next = !chimeMuted;
                  setTweetChimeMuted(next);
                  setChimeMuted(next);
                }}
                role="switch"
                aria-checked={!chimeMuted}
                aria-label={chimeMuted ? 'Unmute new-tweet sounds' : 'Mute new-tweet sounds'}
                className="inline-flex items-center justify-center rounded-md transition-colors hover:text-[var(--ink-0)]"
                style={{
                  width: 22,
                  height: 22,
                  cursor: 'pointer',
                  color: chimeMuted ? 'var(--ink-3)' : 'var(--ink-2)',
                }}
              >
                <BellIcon muted={chimeMuted} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {chimeMuted ? 'Unmute new-tweet sounds' : 'Mute new-tweet sounds'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => dock.setOpen(false)}
                aria-label="Close tweet tracker"
                className="inline-flex items-center justify-center rounded-md text-[var(--ink-3)] transition-colors hover:text-[var(--ink-0)]"
                style={{ width: 22, height: 22, cursor: 'pointer' }}
              >
                <CloseGlyph />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>

        {/* Tweets are prose — the mono chrome font must not leak into
            them (it used to: this wrapper inherited the shell's --mono
            and every tweet body rendered as monospace). */}
        <div
          /* `dk-scroll` carries the product's own bar. `scrollbarWidth:
             thin` came off with it: Chrome honours that property and,
             once it is set, drops every `::-webkit-scrollbar` rule on
             the element — so leaving it here would have quietly kept
             the browser's slab. */
          className="dk-scroll flex-1 min-h-0 overflow-y-auto"
          style={{ fontFamily: 'var(--sans)' }}
          data-no-drag
        >
          <TweetsPanel chromeless toolbarVisible={engaged} onMetaChange={onMetaChange} />
        </div>

        {floating
          ? RESIZE_EDGES.map((edge) => (
              <span
                key={edge}
                aria-hidden
                data-resize-handle="true"
                onPointerDown={(event) => dock.startResize(event, edge)}
                style={resizeHandleStyle(edge)}
              />
            ))
          : null}
      </section>

      {/* Outside the shell, deliberately: the panel is `overflow: hidden`
          and the grip straddles its edge, so a child would lose the half
          hanging over the page. See `SnappedResizeHandle`. */}
      {dock.side !== null ? (
        <SnappedResizeHandle
          side={dock.side}
          ctx={ctx}
          width={dock.width}
          zIndex={panelZ + 1}
          onPointerDown={dock.onSnappedResizeStart}
        />
      ) : null}
    </TooltipProvider>
  );
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

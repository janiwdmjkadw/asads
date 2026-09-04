'use client';

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActivityCountStore } from '@/lib/state/activity-count-store';
import { useDockStore, type DockContext, type DockPanelId, type DockSide } from '@/lib/state/dock-store';
import { DOCK_BOTTOM, DOCK_TOP } from './useDockablePanel';
import { cn } from '@/lib/utils';
import './dock-chrome.css';

// Shared chrome for the Discover dockable panels: the L/R slot markers
// (each panel shows its own side solid and the OTHER panel's side dimmed,
// so both panels read each other's state at a glance), the edge glow shown
// while a snap hold is arming, the center-facing resize handle for the
// snapped mode, and the always-visible toggle pill whose color/opacity
// mirrors the panel state (closed / floating / snapped).

const ACCENT_BY_PANEL: Record<DockPanelId, string> = {
  wallet: 'var(--up)',
  tweets: 'var(--accent-primary)',
};

/** Wallet activity: an event-flow trace. Reads as "things are happening". */
/*
 * 14. It was 10, sized against the 10px label beside it inside a chip —
 * with the label and the chip gone the glyph IS the control, and it sits
 * in a row with the palette and the social marks, which are 15.
 */
function ActivityPulseIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 8.5h3l1.7-4.7 2.4 8.4 1.8-5.2 1.1 1.5H15" />
    </svg>
  );
}

/** Tweet tracker: the X mark. Previously a speech bubble, which read as a
 *  chat feature rather than the tweet feed it actually opens. */
/*
 * 13, a point under Activity's 14 rather than level with it: this X is a
 * SOLID mark and that pulse is a 1.5 stroke, so at equal sizes the X
 * carries visibly more ink. The pair has to look the same weight, not
 * measure the same.
 */
function TweetsXIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

/**
 * Close glyph for the panel-family headers, replacing the text `×` those
 * headers used to render. A 14px text multiplication sign carries the
 * FONT's weight and sits on the text baseline, so it never matched the
 * 1.8-stroke bell beside it at the same 20px button size.
 *
 * Geometry is lucide's X (a 12-unit span inside a 24 viewBox — an X drawn
 * to the bell's own 18-unit span would read LARGER, because its diagonal
 * is ~1.4x its span), carrying this family's 1.8 stroke so the two glyphs
 * share one optical weight.
 */
export function CloseGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DockSideMarkers({ selfId, ctx }: { selfId: DockPanelId; ctx: DockContext }) {
  const panels = useDockStore((s) => s.contexts[ctx]);
  const otherId: DockPanelId = selfId === 'wallet' ? 'tweets' : 'wallet';
  const dot = (side: DockSide) => {
    const mine = panels[selfId].side === side && panels[selfId].open;
    const theirs = panels[otherId].side === side && panels[otherId].open;
    const title = mine
      ? `Snapped ${side}`
      : theirs
        ? `${otherId === 'wallet' ? 'Wallet activity' : 'Tweet tracker'} holds ${side}`
        : `${side} free — hold the panel here to snap`;
    return (
      <Tooltip key={side}>
        <TooltipTrigger asChild>
          <span
            aria-label={title}
            className="inline-block rounded-full"
            style={{
              width: 7,
              height: 7,
              background: mine
                ? ACCENT_BY_PANEL[selfId]
                : theirs
                  ? ACCENT_BY_PANEL[otherId]
                  : 'transparent',
              opacity: mine ? 1 : theirs ? 0.45 : 1,
              border: mine || theirs ? 'none' : '1px solid var(--hairline-2)',
            }}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{title}</TooltipContent>
      </Tooltip>
    );
  };
  return (
    <span className="inline-flex items-center gap-1" aria-label="Dock side slots">
      {dot('left')}
      {dot('right')}
    </span>
  );
}

/**
 * ── THE ARMING GLOW IS GONE ──────────────────────────────────────────
 *
 * This drew a fixed, full height bar down whichever edge a drag was
 * arming toward — first in the accent with an accent glow, then in
 * white. Either way it was the largest thing on screen while it showed,
 * for the smallest possible message, and it read as a light source
 * shining in from off the page rather than as a hint.
 *
 * Nothing replaces it. The panel itself moves under the cursor and the
 * snap happens; a beam announcing that a snap is coming was telling you
 * something you were about to see anyway.
 *
 * The component stays and returns null so every caller and its
 * `side` plumbing is untouched — putting a hint back later is a change
 * inside this function and nowhere else.
 */
export function DockArmingGlow(_: { side: DockSide | null }) {
  return null;
}

/**
 * The resize edge of a SNAPPED panel, and the grip that makes it
 * findable.
 *
 * This used to be an invisible 8px strip. It worked, and nobody could
 * tell it was there: a docked panel has no corner and no shadow to
 * suggest a drag, so the only affordance was the cursor changing if you
 * happened to sweep the seam.
 *
 * Now it carries a bar down the whole edge: 3px wide, top to bottom,
 * sitting ON the seam, half over the panel and half over the page. The
 * entire edge resizes, so the entire edge is marked.
 *
 * ── IT RENDERS OUTSIDE THE PANEL ─────────────────────────────────────
 *
 * Straddling the seam is not optional — a grip that sits wholly inside
 * one side belongs to that side, and this one belongs to the join. But
 * the panel shell is `overflow: hidden`, so anything hung off its edge
 * loses the outer half. It was shipping as five pixels of a ten pixel
 * plate with one edge shaved flat.
 *
 * So the handle is a SIBLING of the panel rather than a child of it,
 * fixed to the same top and bottom, and offset in from the docked edge
 * by the panel's own width. Nothing clips it.
 *
 * ── IT HAS TO TRACK A LIVE RESIZE ────────────────────────────────────
 *
 * A snapped panel resizes IMPERATIVELY: `onSnappedResizeStart` writes
 * `el.style.width` once per frame and only commits to the store on
 * pointerup. So `width` here — React state — is the width the drag
 * STARTED at, and a grip positioned from it sits still while the edge it
 * is supposed to be on slides out from under it. Which is exactly what
 * it looked like.
 *
 * `--dock-<side>-w-<ctx>` is the same number, on `<html>`, written by
 * that same per-frame callback (it is what the page pads its content
 * with). Reading it means the grip is driven by the resize itself rather
 * than by a render that has not happened yet. `width` stays as the
 * fallback, for the first paint before the var exists.
 */
export function SnappedResizeHandle({
  side,
  ctx,
  width,
  zIndex,
  onPointerDown,
}: {
  side: DockSide;
  /** Which page's docks these are — the CSS var is per context. */
  ctx: DockContext;
  /** Fallback width, for the first paint before the live var is set. */
  width: number;
  /** One above the panel, so the seam's mark is never under its own panel. */
  zIndex: number;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  return (
    <div
      className="dk-grip"
      role="separator"
      aria-label="Resize dock"
      aria-orientation="vertical"
      /* Which edge faces the page, and therefore which edge resizes. */
      data-side={side}
      style={{
        ['--dk-w' as string]: `var(--dock-${side}-w-${ctx}, ${width}px)`,
        top: DOCK_TOP,
        bottom: DOCK_BOTTOM,
        zIndex,
      }}
      onPointerDown={onPointerDown}
      data-no-drag
    >
      <span className="dk-bar" />
    </div>
  );
}

/** Footer dock toggle: lives in the app status bar next to the canvas
 *  button (replaces the old floating bottom-right pills). Color/opacity
 *  mirror the panel state — dim when closed, accent when floating,
 *  accent-tinted fill + L/R chip when snapped. The wallet toggle carries
 *  the live activity count. Mount-gated so persisted state never causes
 *  a hydration mismatch in the shared footer. */
/*
 * ── THE FOOTER TOGGLE IS A MARK ──────────────────────────────────────
 *
 * It used to be a chip: a bordered pill, uppercase in `--mono`, with the
 * word beside the glyph, an unread count behind a divider, an L or R for
 * the snapped side, an accent fill when open and a coloured
 * `drop-shadow` around the icon.
 *
 * That is eight pieces of chrome on a 30px strip, for a control that
 * opens a side panel — and the strip runs under every page in the
 * product, so it was the loudest permanent thing on the quietest
 * surface.
 *
 * Now it is the glyph. No plate, no border, no word, no count, no
 * accent, no glow. Hover lifts it and open holds it lit; those are the
 * only two states it draws, and both are one step of brightness.
 *
 * ── WHAT MOVED, NOT WHAT WAS LOST ────────────────────────────────────
 *
 * The word, the state and the snapped side all still exist — they are in
 * `aria-label` and in the tooltip, which is where they were already
 * being said a second time. The count is the one thing genuinely gone:
 * a number that ticks up on its own, on a bar meant to be ignorable,
 * pulling the eye off the board every time a wallet moves.
 */
export function DockFooterToggle({
  panelId,
  ctx,
  label,
}: {
  panelId: DockPanelId;
  ctx: DockContext;
  label: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const me = useDockStore((s) => s.contexts[ctx][panelId]);
  const setOpen = useDockStore((s) => s.setOpen);
  if (!mounted) return null;
  const state: 'closed' | 'floating' | 'snapped' = !me.open ? 'closed' : me.side === null ? 'floating' : 'snapped';
  const panelName = panelId === 'wallet' ? 'wallet activity feed' : 'tweet tracker';
  const tooltip = me.open
    ? `Close the ${panelName}${me.side ? ` (snapped ${me.side})` : ''}`
    : `Open the ${panelName}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(ctx, panelId, !me.open)}
          aria-label={`${label} — ${state}${me.side ? ` (${me.side})` : ''}`}
          aria-pressed={me.open}
          data-state={state}
          /* Styled in `footer-v2.css` beside the social marks it now sits
             with, rather than in utilities here: the three of them are one
             row of glyphs and their tone has to be set in one place. */
          className="ftv-icon inline-flex items-center justify-center"
        >
          {panelId === 'wallet' ? <ActivityPulseIcon /> : <TweetsXIcon />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

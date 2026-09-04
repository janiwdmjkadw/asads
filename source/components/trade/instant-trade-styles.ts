import { cva, type VariantProps } from 'class-variance-authority';

/**
 * One source of truth for the Instant Trade panel's spacing + variant
 * styles (frontend-style rules 1, 2, 5, 6). All panel padding/rhythm is
 * owned here and applied by the OUTER layers (top bar + body) so inner
 * leaves never hardcode their own padding/margins. Theme colors go
 * through CSS-var arbitrary classes because the `ink`/`surface` Tailwind
 * scales are fixed hex, not the live theme vars. Mirrors the Tracker
 * panel's `panel-styles.ts`.
 */

/** Outer radius of the floating panel (kept modest — see PANEL_RADIUS). */
export const PANEL_RADIUS = 'var(--r-lg)';
/** Horizontal inset shared by the top bar and the body. */
export const BODY_INSET = 'px-3.5';
/** Body vertical padding. Top is tight (the divider sits just under the top
 *  bar, no dead space above the first controls); the bottom keeps the P&L
 *  strip clear of the rounded corner. */
export const BODY_PAD_Y = 'pt-2 pb-3.5';
/** Top-bar padding. Top keeps the controls clear of the rounded corner
 *  (matching `BODY_INSET`); the bottom is tight so the divider hugs the
 *  P1/P2/P3 row instead of floating low. */
export const BAR_PAD_Y = 'pt-3 pb-1.5';
/** Vertical rhythm between the major stacked sections (buy / sell / pnl). */
export const SECTION_GAP = 'gap-2.5';
/** Tight rhythm WITHIN a side group (chips directly above their settings). */
export const GROUP_GAP = 'gap-1.5';
/** Quick-amount chip grid — 4 columns with a FIXED rectangular row height
 *  (36px) so chips read the same at every panel size. What changes with the
 *  panel height is the NUMBER of rows (see useFittingRows), not the chip
 *  height. The panel's `maxHeight` cap keeps the leftover gap small. */
export const CHIP_GRID = 'grid grid-cols-4 content-start gap-1.5 auto-rows-[2.25rem]';

/**
 * Quick-amount chip — reuses the shared `.amt-chip` CSS class (same
 * chips the TradePanel uses) so buy/sell tone stays in one place. The
 * `side` variant only toggles the `--sell` modifier class; no inline
 * color ternary.
 */
export const instantChip = cva('amt-chip group relative w-full min-w-0', {
  variants: {
    side: {
      buy: '',
      sell: 'amt-chip--sell',
    },
  },
  defaultVariants: { side: 'buy' },
});

export type ChipSide = NonNullable<VariantProps<typeof instantChip>['side']>;

/** Status line under the controls, color-coded by outcome. */
export const statusTone = cva('t-num-xs leading-snug', {
  variants: {
    tone: {
      idle: 'text-[color:var(--ink-4)]',
      neutral: 'text-[color:var(--ink-2)]',
      error: 'text-[color:var(--down)]',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type StatusTone = NonNullable<VariantProps<typeof statusTone>['tone']>;

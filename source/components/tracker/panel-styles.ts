import { cva, type VariantProps } from 'class-variance-authority';

/**
 * One source of truth for the Tracker panels' spacing + variant styles
 * (frontend-style rules 1, 2, 5). Theme colors are referenced through
 * CSS-var arbitrary classes because the `ink`/`surface` Tailwind scales
 * are fixed hex, not the live theme vars.
 */

/** Horizontal inset for panel content — owned by the panel, not leaves. */
export const EDGE = 'px-3 sm:px-4';
/** Panel header height. */
export const HEADER_H = 'h-12';
/** Vertical rhythm between stacked feed cards. */
export const FEED_RHYTHM = 'space-y-2';

/** Live status line under an add-field, color-coded by outcome. */
export const statusTone = cva('text-[11px] leading-none', {
  variants: {
    tone: {
      idle: 'text-[color:var(--ink-3)]',
      info: 'text-[color:var(--ink-2)]',
      ok: 'text-[color:var(--up)]',
      warn: 'text-[color:var(--ink-2)]',
      error: 'text-[color:var(--down)]',
    },
  },
  defaultVariants: { tone: 'idle' },
});

export type StatusTone = NonNullable<VariantProps<typeof statusTone>['tone']>;

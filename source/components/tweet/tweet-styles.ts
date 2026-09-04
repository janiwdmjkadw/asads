/**
 * Shared style tokens for the tweet card — one source of truth so the
 * layout reads as a small repeated scale, not ad-hoc paddings
 * (frontend-style rules 1, 2). Theme colors are referenced via CSS-var
 * arbitrary classes because the Tailwind `ink`/`surface` scales are fixed
 * hex, not the theme vars.
 */

/**
 * 12px — the outer frame gutter, owned once by the shell on all four
 * sides. Inner boxes do NOT set the outer padding; they inherit this
 * single gutter, so every box stays aligned and adding a new box requires
 * no outer padding of its own. Each box only owns its divider-facing edge
 * (header → `pb-3`, body → `pt-3`), which is the 12px gap around the
 * header/body separator.
 */
export const GUTTER = 'p-3';

/** 10px — vertical rhythm between stacked body sections (rule 6: space-y). */
export const RHYTHM = 'space-y-2.5';

/** Full-width 1px hairline rule. */
export const DIVIDER = 'block h-px w-full bg-[color:var(--hairline)]';

/** Bottom hairline rule (header → body separator). */
export const DIVIDER_BOTTOM = 'border-b border-[color:var(--hairline)]';

/**
 * Nested subcard (quote / reply): flat / X-style — no fill, defined purely
 * by a hairline border on the shell's own base, like X's quoted tweets.
 */
export const NESTED_CARD = 'rounded-sm border border-[color:var(--hairline-2)] p-2.5';

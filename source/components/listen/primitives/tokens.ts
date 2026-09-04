/**
 * Shared type tokens for primitives. Mirrors the CSS-var palette so
 * primitives can accept a `tone` string instead of a raw color.
 */

export type Tone =
  | 'ink-0'
  | 'ink-1'
  | 'ink-2'
  | 'ink-3'
  | 'ink-4'
  | 'up'
  | 'down'
  | 'hold'
  | 'primary'
  | 'secondary';

/** Convert a `Tone` to a CSS-var color reference. */
export function toneVar(tone: Tone | undefined, fallback: Tone = 'ink-1'): string {
  const t = tone ?? fallback;
  switch (t) {
    case 'primary':
      return 'var(--accent-primary)';
    case 'secondary':
      return 'var(--accent-secondary)';
    default:
      return `var(--${t})`;
  }
}

/**
 * Listen — font catalog.
 *
 * Three independent axes (sans / mono / display). The defaults — Geist,
 * Geist Mono, Instrument Serif — are self-hosted via next/font in
 * app/layout.tsx and exposed as CSS variables (--font-geist-sans etc.),
 * so they never trigger a runtime Google Fonts fetch. All other entries
 * lazy-load via `useFontLoader` when the user picks them.
 */

export type FontAxis = 'sans' | 'mono' | 'display';

export interface FontOption {
  /** Display + persistence key. Family name expected by Google Fonts. */
  name: string;
  /** Full CSS font-family stack — used for `--font-*` injection. */
  stack: string;
  /**
   * Google-fonts axis suffix, e.g. `'400;500;600'` for weight-only or
   * `'ital,wght@0,400;1,400'` for italic+weight.
   * `null` means the font is preinstalled / system; do not inject a link.
   */
  weights: string | null;
}

export const SANS_FONTS: readonly FontOption[] = [
  {
    name: 'Geist',
    stack: `var(--font-geist-sans, system-ui), system-ui, sans-serif`,
    weights: null /* self-hosted (next/font, app/layout.tsx) */,
  },
  {
    name: 'Instrument Sans',
    stack: `'Instrument Sans', system-ui, sans-serif`,
    weights: '400;500;600;700',
  },
  { name: 'Inter', stack: `'Inter', system-ui, sans-serif`, weights: '400;500;600;700' },
  {
    name: 'IBM Plex Sans',
    stack: `'IBM Plex Sans', system-ui, sans-serif`,
    weights: '400;500;600;700',
  },
  { name: 'Manrope', stack: `'Manrope', system-ui, sans-serif`, weights: '400;500;600;700' },
  {
    name: 'Space Grotesk',
    stack: `'Space Grotesk', system-ui, sans-serif`,
    weights: '400;500;600;700',
  },
  { name: 'DM Sans', stack: `'DM Sans', system-ui, sans-serif`, weights: '400;500;600;700' },
  { name: 'Outfit', stack: `'Outfit', system-ui, sans-serif`, weights: '400;500;600;700' },
  {
    name: 'Plus Jakarta Sans',
    stack: `'Plus Jakarta Sans', system-ui, sans-serif`,
    weights: '400;500;600;700',
  },
  { name: 'Sora', stack: `'Sora', system-ui, sans-serif`, weights: '400;500;600;700' },
  { name: 'Work Sans', stack: `'Work Sans', system-ui, sans-serif`, weights: '400;500;600;700' },
  { name: 'System UI', stack: `system-ui, -apple-system, sans-serif`, weights: null },
] as const;

export const MONO_FONTS: readonly FontOption[] = [
  {
    name: 'Geist Mono',
    stack: `var(--font-geist-mono, ui-monospace), ui-monospace, monospace`,
    weights: null /* self-hosted (next/font, app/layout.tsx) */,
  },
  {
    name: 'JetBrains Mono',
    stack: `'JetBrains Mono', ui-monospace, monospace`,
    weights: '400;500;600',
  },
  {
    name: 'IBM Plex Mono',
    stack: `'IBM Plex Mono', ui-monospace, monospace`,
    weights: '400;500;600',
  },
  { name: 'Fira Code', stack: `'Fira Code', ui-monospace, monospace`, weights: '400;500;600' },
  { name: 'Space Mono', stack: `'Space Mono', ui-monospace, monospace`, weights: '400;700' },
  { name: 'Roboto Mono', stack: `'Roboto Mono', ui-monospace, monospace`, weights: '400;500;600' },
  { name: 'DM Mono', stack: `'DM Mono', ui-monospace, monospace`, weights: '400;500' },
  { name: 'Azeret Mono', stack: `'Azeret Mono', ui-monospace, monospace`, weights: '400;500;600' },
  { name: 'Commit Mono', stack: `'Commit Mono', ui-monospace, monospace`, weights: '400;700' },
  { name: 'ui-monospace', stack: `ui-monospace, monospace`, weights: null },
] as const;

export const DISPLAY_FONTS: readonly FontOption[] = [
  {
    name: 'Instrument Serif',
    stack: `var(--font-instrument-serif, Georgia), Georgia, serif`,
    weights: null /* self-hosted (next/font, app/layout.tsx) */,
  },
  { name: 'Fraunces', stack: `'Fraunces', Georgia, serif`, weights: 'ital,wght@0,400;0,600;1,400' },
  {
    name: 'EB Garamond',
    stack: `'EB Garamond', Georgia, serif`,
    weights: 'ital,wght@0,400;0,600;1,400',
  },
  {
    name: 'Playfair Display',
    stack: `'Playfair Display', Georgia, serif`,
    weights: 'ital,wght@0,400;0,600;1,400',
  },
  {
    name: 'Cormorant Garamond',
    stack: `'Cormorant Garamond', Georgia, serif`,
    weights: 'ital,wght@0,400;0,600;1,400',
  },
  {
    name: 'DM Serif Display',
    stack: `'DM Serif Display', Georgia, serif`,
    weights: 'ital,wght@0,400;1,400',
  },
  {
    name: 'Newsreader',
    stack: `'Newsreader', Georgia, serif`,
    weights: 'ital,wght@0,400;0,600;1,400',
  },
  {
    name: 'Crimson Pro',
    stack: `'Crimson Pro', Georgia, serif`,
    weights: 'ital,wght@0,400;0,600;1,400',
  },
  {
    name: 'Libre Caslon Text',
    stack: `'Libre Caslon Text', Georgia, serif`,
    weights: 'ital,wght@0,400;1,400',
  },
  {
    name: 'Bricolage Grotesque',
    stack: `'Bricolage Grotesque', system-ui, sans-serif`,
    weights: '400;500;600;700',
  },
  // The homepage's "technical terminal" display face — self-hosted already,
  // so it lets the main site mirror the marketing page's mono-heading look.
  {
    name: 'Geist Mono',
    stack: `var(--font-geist-mono, ui-monospace), ui-monospace, monospace`,
    weights: null /* self-hosted (next/font, app/layout.tsx) */,
  },
  { name: 'Caveat', stack: `'Caveat', cursive`, weights: '400;600' },
  { name: 'Georgia', stack: `Georgia, serif`, weights: null },
] as const;

export const DEFAULT_SANS = SANS_FONTS[0]!.name;
export const DEFAULT_MONO = MONO_FONTS[0]!.name;
export const DEFAULT_DISPLAY = DISPLAY_FONTS[0]!.name;

/** Look up a font by axis + name. Falls back to default for that axis. */
export function resolveFont(axis: FontAxis, name: string | null | undefined): FontOption {
  const list = axis === 'sans' ? SANS_FONTS : axis === 'mono' ? MONO_FONTS : DISPLAY_FONTS;
  const fallback =
    axis === 'sans' ? SANS_FONTS[0]! : axis === 'mono' ? MONO_FONTS[0]! : DISPLAY_FONTS[0]!;
  if (!name) return fallback;
  return list.find((f) => f.name === name) ?? fallback;
}

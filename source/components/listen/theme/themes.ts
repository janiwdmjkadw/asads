/**
 * Listen — aurora theme catalog.
 *
 * Each theme is a `(primary, secondary)` accent pair. The full surface /
 * ink / data palette stays constant — only `--accent-primary`,
 * `--accent-secondary`, and the derived `--accent-glow` change. This keeps
 * green-up / red-down semantics intact across themes.
 *
 * Source: ported from the Listen playground (`window.THEMES`) but
 * fully typed and grouped for the swatch picker.
 */

export type ThemeGroup = 'All';

export interface Theme {
  /** Stable identifier. Persisted to localStorage; never rename. */
  id: string;
  /** Display group used by the swatch grid in ThemeSwitcher. */
  group: ThemeGroup;
  /** Display name. */
  name: string;
  /** Primary accent color (cyan in default theme). */
  primary: string;
  /** Secondary accent color, used for gradients. */
  secondary: string;
  /** Glow color — primary at 45% alpha. Computed once at build time. */
  glow: string;
  /**
   * Ink for text/glyphs drawn ON the accent fill (the gradient buttons).
   * Near-black or white, whichever contrasts better against the WORSE of
   * the two gradient stops — accent luminance spans light mints (arctic)
   * to near-black slates (midnight), so a fixed literal is wrong for one
   * end or the other. Computed once at build time.
   */
  ink: string;
  /**
   * Optional page-background image URL. When present the ambient aurora +
   * grid layers are hidden (see `listen.css`, `[data-theme-id="..."]`)
   * so the image fronts the page chrome on its own.
   */
  bgImage?: string;
  /**
   * Optional override for `--accent-soft` (the tinted fill behind hover
   * states, badges, etc.). Defaults to `color-mix(primary 14%)` when
   * unset — themes that need a hand-picked tint (e.g. parchment-based
   * looks like zen, where color-mix against the primary goes muddy)
   * pass an explicit color/rgba here.
   */
  accentSoft?: string;
  /** Optional override for `--accent-wash`. Same rationale as `accentSoft`. */
  accentWash?: string;
}

const hex2rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const glow = (hex: string, alpha = 0.45): string => {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Near-black used on light accents. Matches the literal the agent composer
 *  and the trading-settings modal already draw on the accent fill. */
const INK_DARK = '#0b0e14';
const INK_LIGHT = '#ffffff';

/** WCAG relative luminance. */
const luminance = (hex: string): number => {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hex2rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Pick the ink that survives on BOTH gradient stops — score each candidate
 * by its worst stop, then take the better candidate. Scoring the worst stop
 * (rather than an average or the primary alone) is what stops a label from
 * dissolving halfway along the gradient.
 */
const accentInk = (primary: string, secondary: string): string => {
  const stops = [luminance(primary), luminance(secondary)];
  const worst = (ink: string): number => {
    const inkLum = luminance(ink);
    return Math.min(...stops.map((stop) => contrast(stop, inkLum)));
  };
  return worst(INK_DARK) >= worst(INK_LIGHT) ? INK_DARK : INK_LIGHT;
};

const t = (
  group: ThemeGroup,
  id: string,
  name: string,
  primary: string,
  secondary: string,
  extras?: Partial<Theme>,
): Theme => ({
  id,
  group,
  name,
  primary,
  secondary,
  glow: glow(primary),
  ink: accentInk(primary, secondary),
  ...extras,
});

/**
 * All available themes, indexed by id. Order here drives swatch ordering.
 *
 * ── FIVE, DOWN FROM THIRTY ONE ───────────────────────────────────────
 *
 * Thirty one themes in six groups was six swatch rows and a sub heading
 * per row, which was most of the vertical height of the Tweaks panel and
 * the reason everything below Theme scrolled off the bottom. Thirty one
 * choices of the same thing is not thirty one times the value of six —
 * past about six, picking stops being a choice and becomes a search.
 *
 * These five span the range rather than sampling one family: two cool
 * (one soft, one vivid), one green, one warm, one pink. Anything a cut
 * theme did, one of these does within a hue step or two.
 *
 * ── THERE IS NO LIGHT THEME ANY MORE ─────────────────────────────────
 *
 * `zen` was the parchment one and it is gone, so the product is dark
 * only. Three things were built for it and are now unreachable rather
 * than broken, left in place because each is load bearing the moment a
 * light theme comes back:
 *
 *   `ThemeProvider` paints a paper texture page background for
 *   `theme.id === 'zen'`; `components/ui/sonner.tsx` keys the toaster's
 *   light mode off the same check; and `Theme` still carries `bgImage`,
 *   `accentSoft` and `accentWash`, which only zen used.
 *
 * None of those fire now. Deleting them is a separate decision from
 * dropping one swatch, and doing it here would make bringing a light
 * theme back a rewrite rather than a row in this table.
 *
 * ── NOTHING BREAKS FOR SOMEBODY ON A CUT THEME ───────────────────────
 *
 * `resolveTheme` already falls back to the default for an unknown id, so
 * a persisted `oilSlick` resolves to `arctic` on next load with no
 * migration. `hotpink` is kept deliberately: `ThemeProvider` migrates the
 * legacy `zen` default to it, and removing it would point that migration
 * at an id that no longer exists.
 *
 * A persisted `zen` resolves to `arctic` on next load through the same
 * fallback, so nobody sitting on it wakes up to a broken surface.
 */
export const THEMES: Record<string, Theme> = {
  arctic:  t('All', 'arctic',  'Arctic → Mint',     '#bae6fd', '#5eead4'),
  cyan:    t('All', 'cyan',    'Cyan → Violet',     '#38e1ff', '#9d5cff'),
  emerald: t('All', 'emerald', 'Emerald → Lime',    '#34d399', '#a3e635'),
  sunset:  t('All', 'sunset',  'Sunset',            '#fb923c', '#f472b6'),
  hotpink: t('All', 'hotpink', 'Hot Pink → Purple', '#ec4899', '#7c3aed'),
};

export const DEFAULT_THEME_ID = 'arctic';

/*
 * ONE GROUP NOW.
 *
 * Five themes do not need sorting into families — the grouping existed
 * to make thirty one findable. The machinery stays because `ThemeSwitcher`
 * buckets by it, and collapsing to a single entry is the change that
 * costs nothing there. When that file is next open, the sub heading it
 * renders per group can come out and this can go with it.
 */
export const THEME_GROUP_ORDER: ThemeGroup[] = ['All'];

/** Returns the theme for an id, or the default if unknown. */
export function resolveTheme(id: string | null | undefined): Theme {
  if (!id) return THEMES[DEFAULT_THEME_ID]!;
  return THEMES[id] ?? THEMES[DEFAULT_THEME_ID]!;
}

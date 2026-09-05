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
  /**
   * Which half of the product this is. Written to `data-theme` on the
   * document element, because that is the only signal a PORTALLED
   * surface can read: a dialog or a menu mounted at the document root
   * is inside no page, and every palette block the repaint added keys
   * off it.
   */
  mode: 'light' | 'dark';
  /** The page ground. Painted inline on `.listen-root`. */
  ground: string;
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
  extras: Partial<Theme> & Pick<Theme, 'mode' | 'ground'>,
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
 * The two themes.
 *
 * ── FIVE ACCENT PAIRS BECAME TWO GROUNDS ─────────────────────────────
 *
 * The catalog used to be five `(primary, secondary)` pairs over one
 * fixed dark surface: a choice about the colour of a glow, on a product
 * that has since dropped the glow. Nobody picks a terminal by its
 * accent, and the one axis anybody actually wants was missing.
 *
 * So: light and dark, and a theme now carries the GROUND. Everything
 * else on the surface follows from it.
 *
 * ── THE ACCENT IS THE INK ────────────────────────────────────────────
 *
 * On both themes the accent is the strongest ink of that ground — near
 * black on paper, near white on the terminal. A control that is "the
 * live one" says so by being the darkest or lightest thing in its row,
 * not by being cyan. The one place a hue still means something is the
 * pair (up green, down red) and the quick buy button, which the Tweaks
 * panel still colours by hand.
 */
export const THEMES: Record<string, Theme> = {
  light: t('All', 'light', 'Light', '#0b0e14', '#0f6d5f', {
    mode: 'light',
    ground: '#ffffff',
    accentSoft: 'rgba(11, 14, 20, 0.06)',
    accentWash: 'rgba(11, 14, 20, 0.04)',
  }),
  dark: t('All', 'dark', 'Dark', '#e4e7ee', '#5eead4', {
    mode: 'dark',
    ground: '#000000',
    accentSoft: 'rgba(255, 255, 255, 0.08)',
    accentWash: 'rgba(255, 255, 255, 0.05)',
  }),
};

export const DEFAULT_THEME_ID = 'light';

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

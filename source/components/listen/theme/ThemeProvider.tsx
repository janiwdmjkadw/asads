import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DEFAULT_THEME_ID, resolveTheme } from './themes';
import {
  DEFAULT_DISPLAY,
  DEFAULT_MONO,
  DEFAULT_SANS,
  resolveFont,
} from './fonts';
import { useFontLoader } from './useFontLoader';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';

/* ============================================================================
   Trade-page theme provider.
   Owns:
     - active theme (palette pair) + 3 font axes (sans/mono/display)
     - persistence to localStorage under a versioned key
     - the `.listen-root` wrapper element + inline CSS-var injection
   The whole TradePage tree consumes via `useTheme()` (see ./useTheme.ts).
   ============================================================================ */

const STORAGE_KEY = 'listen.trade.theme.v3';

/**
 * v2 era: the provider auto-persisted the then-default 'zen' for every
 * visitor, so "still on the default" and "explicitly chose zen" are
 * indistinguishable in v2 data. The migration maps it to the current
 * default and carries everything else over.
 *
 * Every id from the five accent era — arctic, cyan, emerald, sunset,
 * hotpink — resolves the same way: `resolveTheme` falls back to the
 * default for an unknown id, so a persisted accent lands on light with
 * no migration table and nothing breaks for somebody who had one.
 */
const LEGACY_STORAGE_KEY = 'listen.trade.theme.v2';
const LEGACY_DEFAULT_THEME_ID = 'zen';

interface PersistedState {
  themeId: string;
  fontSans: string;
  fontMono: string;
  fontDisplay: string;
}

const DEFAULT_STATE: PersistedState = {
  themeId: DEFAULT_THEME_ID,
  fontSans: DEFAULT_SANS,
  fontMono: DEFAULT_MONO,
  fontDisplay: DEFAULT_DISPLAY,
};

function loadState(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        themeId: parsed.themeId ?? DEFAULT_STATE.themeId,
        fontSans: parsed.fontSans ?? DEFAULT_STATE.fontSans,
        fontMono: parsed.fontMono ?? DEFAULT_STATE.fontMono,
        fontDisplay: parsed.fontDisplay ?? DEFAULT_STATE.fontDisplay,
      };
    }
    // One-time v2 → v3 migration (see LEGACY_STORAGE_KEY note above).
    // The post-hydration persist effect writes the migrated state to v3.
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return DEFAULT_STATE;
    const legacy = JSON.parse(legacyRaw) as Partial<PersistedState>;
    const legacyThemeId = legacy.themeId ?? LEGACY_DEFAULT_THEME_ID;
    return {
      themeId: legacyThemeId === LEGACY_DEFAULT_THEME_ID ? DEFAULT_STATE.themeId : legacyThemeId,
      fontSans: legacy.fontSans ?? DEFAULT_STATE.fontSans,
      fontMono: legacy.fontMono ?? DEFAULT_STATE.fontMono,
      fontDisplay: legacy.fontDisplay ?? DEFAULT_STATE.fontDisplay,
    };
  } catch {
    /* Corrupted JSON or unavailable storage — fall through to defaults. */
    return DEFAULT_STATE;
  }
}

function persistState(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Quota exceeded or storage disabled; theme just won't persist. */
  }
}

interface Props {
  children: ReactNode;
}

export function ThemeProvider({ children }: Props) {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useLayoutEffect(() => {
    setState(loadState());
    setHydrated(true);
    document.documentElement.removeAttribute('data-listen-theme-loading');
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistState(state);
  }, [hydrated, state]);

  /*
   * THE HALF, PUBLISHED WHERE EVERYTHING CAN READ IT.
   *
   * `data-theme` on the document element, not on the shell: a dialog, a
   * menu or a tooltip renders at the DOCUMENT ROOT, outside every page
   * and outside `.listen-root` itself, and still has to know whether it
   * is on paper or on the terminal. Every palette block the repaint
   * added is scoped `:root[data-theme='light'] …` for exactly that
   * reason — on dark none of them match and the surfaces fall back to
   * the tokens they always had.
   */
  const mode = resolveTheme(state.themeId).mode;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [mode]);

  const theme = resolveTheme(state.themeId);
  const sans = resolveFont('sans', state.fontSans);
  const mono = resolveFont('mono', state.fontMono);
  const display = resolveFont('display', state.fontDisplay);

  /* Lazy-load Google Fonts for each non-bundled axis. No-op for default. */
  useFontLoader(sans);
  useFontLoader(mono);
  useFontLoader(display);

  const setThemeId = useCallback((id: string) => {
    setState((s) => ({ ...s, themeId: id }));
  }, []);
  const setFontSans = useCallback((name: string) => {
    setState((s) => ({ ...s, fontSans: name }));
  }, []);
  const setFontMono = useCallback((name: string) => {
    setState((s) => ({ ...s, fontMono: name }));
  }, []);
  const setFontDisplay = useCallback((name: string) => {
    setState((s) => ({ ...s, fontDisplay: name }));
  }, []);
  const reset = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      sans,
      mono,
      display,
      setThemeId,
      setFontSans,
      setFontMono,
      setFontDisplay,
      reset,
    }),
    [theme, sans, mono, display, setThemeId, setFontSans, setFontMono, setFontDisplay, reset],
  );

  /* Inline overrides for the active theme + fonts. Cast through unknown
     to allow CSS custom-property keys, which TypeScript's CSSProperties
     index doesn't know about. Static class-based tokens still come from
     trade.css; this layer just swaps the user-pickable axes. */
  /*
   * ── THE PAGE GROUND COMES FROM THE THEME ──────────────────────────
   *
   * This is the style that actually paints the page: it is set INLINE on
   * `.listen-root`, so it beats the rule for the same element in
   * listen.css no matter what that rule says. That is why it has to be
   * the thing that switches — every gap between surfaces (a short
   * page's tail, the gutters beside a centred column, the strip under a
   * footer) is this pixel, and a page painting itself cannot reach it.
   *
   * It was a literal black, then a literal white; now it is the theme's
   * own ground, which is the only version of it that can be swapped.
   */
  const rootStyle: CSSProperties = {
    '--accent-primary': theme.primary,
    '--accent-secondary': theme.secondary,
    '--accent-glow': theme.glow,
    '--accent-ink': theme.ink,
    '--accent-soft': theme.accentSoft ?? `color-mix(in srgb, ${theme.primary} 14%, transparent)`,
    '--accent-wash': theme.accentWash ?? `color-mix(in srgb, ${theme.primary} 6%, transparent)`,
    '--sans': sans.stack,
    '--mono': mono.stack,
    '--display': display.stack,
    color: 'var(--ink-1)',
    background: theme.ground,
  } as CSSProperties;

  return (
    <ThemeContext.Provider value={value}>
      <div
        className="listen-root min-h-screen flex flex-col"
        data-theme-id={theme.id}
        suppressHydrationWarning
        style={rootStyle}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

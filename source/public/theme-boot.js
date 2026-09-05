(() => {
  try {
    /*
     * ── THE HALF, BEFORE THE FIRST PAINT ─────────────────────────────
     *
     * `ThemeProvider` writes `data-theme` in a layout effect, which is
     * after hydration — so a reader on dark got a white document for as
     * long as the bundle took to arrive, and then the terminal. This
     * runs in the head, from `localStorage`, before anything is drawn.
     *
     * It only writes the ATTRIBUTE. Every colour still comes from
     * `source/app/dark*.css`, which is where the theme actually lives;
     * this is the one bit of it that cannot wait for React.
     *
     * Two themes now, `light` and `dark`. Anything else in storage is an
     * id from the thirty theme era and resolves to the default, exactly
     * as `resolveTheme` does.
     */
    const DEFAULT_THEME = 'light';
    const raw =
      window.localStorage.getItem('listen.trade.theme.v3') ||
      window.localStorage.getItem('listen.trade.theme.v2');
    const state = raw ? JSON.parse(raw) : null;
    const stored = state && typeof state.themeId === 'string' ? state.themeId : null;
    const themeId = stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', themeId);

    /*
     * The FONTS still cannot be answered here — they load through
     * `useFontLoader` after hydration — so the shell stays hidden until
     * then when a non default face is stored, and only then. The theme
     * no longer needs that gate: it is already correct above.
     */
    const face = (k, d) =>
      state && typeof state[k] === 'string' && state[k] !== d;
    if (
      face('fontSans', 'Geist') ||
      face('fontMono', 'Geist Mono') ||
      face('fontDisplay', 'Instrument Serif')
    ) {
      document.documentElement.setAttribute('data-listen-theme-loading', '1');
    }
  } catch (_) {}
})();

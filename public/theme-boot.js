(() => {
  try {
    // Mirrors ThemeProvider: v3 is authoritative; v2 falls back with the
    // zen→default migration. Marks the document while a NON-default
    // theme/font will hydrate, so the default paint never flashes first.
    const DEFAULT_THEME = 'arctic';
    const v3 = window.localStorage.getItem('listen.trade.theme.v3');
    const v2 = window.localStorage.getItem('listen.trade.theme.v2');
    const raw = v3 || v2;
    if (!raw) return;
    const state = JSON.parse(raw);
    let themeId = state && typeof state.themeId === 'string' ? state.themeId : DEFAULT_THEME;
    // v2 data: a stored 'zen' was the auto-persisted old default — it
    // migrates to the new default on hydration, so it is NOT "changed".
    if (!v3 && themeId === 'zen') themeId = DEFAULT_THEME;
    const changed =
      themeId !== DEFAULT_THEME ||
      (state && typeof state.fontSans === 'string' && state.fontSans !== 'Geist') ||
      (state && typeof state.fontMono === 'string' && state.fontMono !== 'Geist Mono') ||
      (state && typeof state.fontDisplay === 'string' && state.fontDisplay !== 'Instrument Serif');
    if (changed) document.documentElement.setAttribute('data-listen-theme-loading', '1');
  } catch (_) {}
})();

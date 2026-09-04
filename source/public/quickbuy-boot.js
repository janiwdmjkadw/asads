(() => {
  try {
    // Stamp the "Quickbuy always" pref BEFORE first paint, so the card's
    // quickbuy never flashes in as a score first. Mirrors
    // lib/state/coincard-prefs.ts: ON unless explicitly turned off, so an
    // absent key and a stored 'false' are different states. Keep the two
    // in step — this file is the pre-paint copy of that one rule.
    const raw = window.localStorage.getItem('listen:quickbuy-always:v1');
    if (raw === null || raw === 'true') {
      document.documentElement.setAttribute('data-qb-always', '');
    }
  } catch (_) {}
})();

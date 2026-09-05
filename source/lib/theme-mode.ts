'use client';

/**
 * ── WHICH HALF ARE WE ON, IN JAVASCRIPT ──────────────────────────────
 *
 * Nearly all of the theme is answered in CSS: `ThemeProvider` writes
 * `data-theme` on the document element and the sheets under
 * `source/app/dark*.css` do the rest.
 *
 * A canvas cannot read any of that. lightweight-charts takes its colours
 * as STRINGS and paints them into a bitmap — `var(--x)` reaching it is
 * just eight characters it does not understand, and the chart's own
 * style model parses them as `#rrggbb` and falls back to grey. So the
 * chart is the one surface that has to ask which half it is on, in code.
 *
 * `useThemeMode` is that question. It reads the attribute and watches it,
 * so a theme switch repaints the chart without a reload.
 */

import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/** The current half, read straight off the document element. */
export function getThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * The current half, kept current.
 *
 * Starts on `light` so the server and the first client render agree —
 * `data-theme` is written in a layout effect, after hydration, and a
 * value read during render would not match what the server sent.
 */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const read = () => setMode(getThemeMode());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

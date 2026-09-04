import { useEffect } from 'react';
import type { FontOption } from './fonts';

/**
 * Lazily inject a Google Fonts <link> tag for the given family.
 *
 * Default Listen fonts (Geist / Geist Mono / Instrument Serif) ship with
 * `weights: null` and are skipped — they're already in `index.html`. All
 * other entries get a single `<link>` injected on demand and cached by id
 * so re-selecting the same font is a no-op.
 *
 * Called from ThemeProvider once per axis. Safe in StrictMode (idempotent).
 */
export function useFontLoader(font: FontOption): void {
  useEffect(() => {
    if (!font.weights) return;
    const id = `listen-gf-${font.name.replace(/\W+/g, '-')}`;
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    const family = font.name.replace(/ /g, '+');
    /* `ital,wght@...` already specifies the axis prefix. Plain weight-only
       lists need the `wght@` prefix prepended to be valid. */
    const axis = font.weights.includes('@') ? font.weights : `wght@${font.weights}`;
    link.href = `https://fonts.googleapis.com/css2?family=${family}:${axis}&display=swap`;
    document.head.appendChild(link);
  }, [font.name, font.weights]);
}

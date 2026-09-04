import { createContext } from 'react';
import type { Theme } from './themes';
import type { FontOption } from './fonts';

/**
 * Lives in its own module so `ThemeProvider.tsx` can keep a single
 * default export of components (Vite's react-refresh plugin can only
 * fast-refresh files whose exports are all components).
 */

export interface ThemeContextValue {
  theme: Theme;
  sans: FontOption;
  mono: FontOption;
  display: FontOption;
  setThemeId: (id: string) => void;
  setFontSans: (name: string) => void;
  setFontMono: (name: string) => void;
  setFontDisplay: (name: string) => void;
  reset: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

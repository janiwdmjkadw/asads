import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { runtimeConfigHtml } from '@/lib/runtime-config';
import { metadataBase } from '../sandbox/siteMeta';

/**
 * The root document. The real `app/layout.tsx` is a server component and so
 * was excluded from the export; this is the smallest one that satisfies what
 * the export actually reads from it.
 *
 * Two things it must do:
 *
 * 1. Install the three faces as the CSS variables the design system names
 *    (`--font-geist-sans`, `--font-geist-mono`, `--font-instrument-serif`).
 *    Every `--sans` / `--mono` / `--display` token falls back to a system
 *    face without them, so the whole product would render in the wrong
 *    typography.
 * 2. Write `window.__RUNTIME_CONFIG__` into <head> BEFORE hydration, which
 *    is how `getRuntimeConfig()` reaches the browser. Values come from
 *    `.env.local`.
 *
 * It deliberately imports NO stylesheet. `source/app/globals.css` is the
 * terminal's: 59 KB of tokens plus `listen.css`, `discover.css` and
 * `agent-chat.css`, and it paints `body`. Loading it here put all of that on
 * the landing page too, which is not what the landing is authored against
 * and is not what its own harness loads. Each route group imports the
 * stylesheet it actually wants.
 *
 * It also loads the two pre-paint scripts the export ships in
 * `public/`: `theme-boot.js` (stamps `data-listen-theme-loading` when a non
 * default theme will hydrate, so the default paint never flashes first) and
 * `quickbuy-boot.js` (stamps the quickbuy preference before the first card
 * paints). Both must run before hydration, which is why they are plain
 * <script src> tags in <head> rather than imports.
 */

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  /* Open Graph consumers do not resolve relative URLs, so the base is set
     once here and every page's preview card inherits it. See siteMeta. */
  metadataBase,
  title: 'Listen UI sandbox',
  description: 'Local sandbox for redesigning the Listen frontend.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // theme-boot.js and quickbuy-boot.js stamp attributes on this element
      // before React hydrates, which is the whole point of them; the server
      // HTML cannot carry those marks, so the mismatch is expected.
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      style={{ ['--font-geist' as string]: 'var(--font-geist-sans)' }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigHtml() }} />
        <script src="/theme-boot.js" />
        <script src="/quickbuy-boot.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}

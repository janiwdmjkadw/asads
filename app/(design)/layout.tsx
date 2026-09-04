'use client';

import type { ReactNode } from 'react';
import '@/app/globals.css';
import { Providers } from '@/app/providers';
import { ThemeProvider } from '@/components/listen/theme/ThemeProvider';
import { TrackedWalletsProvider } from '@/components/discover/TrackedWalletsProvider';
import { ClientOnly } from '../../sandbox/ClientOnly';

/**
 * The design group: `/whatever` and nothing else.
 *
 * It used to sit under `(landing)`, which is a passthrough that loads the
 * landing's own stylesheet and NO providers — fine for hand written mockups,
 * useless the moment the page wants to mount something from the product.
 * A real component needs the terminal's ground: `globals.css` for the
 * tokens, `Providers` for the query client, `ThemeProvider` for the
 * `.listen-root` scope every theme variable is declared on, and
 * `TrackedWalletsProvider` because anything that touches an address reads
 * it. That is exactly the wrapper `TerminalShell` builds, minus the shell:
 * no nav, no sub header, no footer, so the thing being worked on is alone
 * on the page.
 *
 * It is a CLIENT layout, unlike the terminal's. `ThemeProvider` carries no
 * `'use client'` of its own — it is only ever reached through
 * `TerminalShell`, which has one — so importing it from a server layout
 * asks the server to run `useEffect` and the build stops. Marking the
 * layout is the whole fix; every child under here is a client component
 * regardless.
 */
export default function DesignLayout({ children }: { children: ReactNode }) {
  return (
    <ClientOnly>
      <Providers>
        <ThemeProvider>
          <TrackedWalletsProvider>{children}</TrackedWalletsProvider>
        </ThemeProvider>
      </Providers>
    </ClientOnly>
  );
}

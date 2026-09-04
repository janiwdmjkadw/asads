import type { ReactNode } from 'react';
import '@/app/globals.css';
import { Providers } from '@/app/providers';
import { TerminalShell } from '@/components/listen/TerminalShell';
import { ClientOnly } from '../../sandbox/ClientOnly';
import { NavHover } from '../../sandbox/NavHover';
import { TokenHints } from '../../sandbox/TokenHints';

/**
 * The terminal frame. Both halves are the export's own code:
 * `Providers` (source/app/providers.tsx) and `TerminalShell`
 * (source/components/listen/TerminalShell.tsx), which is what mounts the
 * persistent Discover / Trade / tab panes, the agent dock and every modal
 * host. The route pages under here render `null` on purpose — the shell
 * paints, so a tab change is a display flip rather than a remount.
 *
 * In production this composition lives in a server layout that also enforces
 * auth. There is no auth here, so it is only the composition — wrapped in
 * `ClientOnly`, which is explained in that file.
 */
export default function TerminalLayout({ children }: { children: ReactNode }) {
  return (
    <ClientOnly>
      <Providers>
        <NavHover />
        <TokenHints />
        <TerminalShell>{children}</TerminalShell>
      </Providers>
    </ClientOnly>
  );
}

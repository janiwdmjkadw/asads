import type { ReactNode } from 'react';
import '@/app/globals.css';
import { Providers } from '@/app/providers';

/**
 * Everything outside the terminal EXCEPT the landing page: the agentic
 * marketing page, onboarding, the fren links and the auth pages. All of them
 * are drawn in the terminal's own tokens, so they load its stylesheet; the
 * landing is not, and has its own group.
 *
 * They share this layout for one reason. `Providers` (the export's own
 * `source/app/providers.tsx`) installs the React Query client, and several
 * of these pages call `useMe()`, which throws without it. In production the
 * root server layout mounts it once for the whole app; here the terminal
 * mounts its own copy inside `ClientOnly`, so the two trees each get one.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}

'use client';

/**
 * Client-side flag gate + lazy loader for the `/conditionals` route, mirroring
 * `components/agent/AgentPageGate.tsx`: keeps the route chunk to this stub, so
 * with `conditionals-surface` off the conditionals code is never fetched, never
 * mounted, and puts no DOM on the page.
 *
 * This gate exists because `app/(terminal)/conditionals/page.tsx` is a SERVER
 * component and `useConditionalsEnabled` is a LaunchDarkly hook, i.e. client
 * only. The agent route can gate server-side with `notFound()` because its flag
 * is a synchronous env value; an LD flag is not knowable on the server, so the
 * gate has to live one level down, here.
 *
 * Disabled renders `null` rather than `notFound()` ON PURPOSE. `useFlags()`
 * returns `{}` until the LD client finishes initializing (the provider sets no
 * `bootstrap`), so the flag reads `false` on the FIRST render for every user
 * including the ones it is on for. `notFound()` is a throw: it would swap in
 * the not-found boundary during that window and never re-render back, 404ing
 * the route for entitled users. Returning null is re-render safe — the panel
 * appears as soon as LD answers `true`, and stays absent forever otherwise.
 */

import dynamic from 'next/dynamic';
import { useConditionalsEnabled } from '@/lib/conditionals/useConditionalsEnabled';

const ConditionalsPanel = dynamic(
  () => import('./ConditionalsPanel').then((m) => m.ConditionalsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[var(--h-app-content)] items-center justify-center text-[12px] text-[var(--ink-3)]">
        Loading conditionals…
      </div>
    ),
  },
);

export function ConditionalsPageGate() {
  const conditionalsEnabled = useConditionalsEnabled();
  if (!conditionalsEnabled) return null;
  return <ConditionalsPanel />;
}

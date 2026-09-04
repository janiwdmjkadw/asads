'use client';

/**
 * Client-side flag gate + lazy loader for `/conditionals/<id>`, the exact
 * pattern `ConditionalsPageGate` documents: the route chunk stays this
 * stub, so with `conditionals-surface` off the conditionals code is never
 * fetched, never mounted, and puts no DOM on the page — and `null` rather
 * than `notFound()`, because `useFlags()` reads `false` on the first render
 * for every user and a throw during that window would 404 the route for
 * entitled ones (the full argument is in `ConditionalsPageGate`).
 *
 * The id comes off `useParams` rather than the server's `params`, which
 * keeps the route component sync and identical in shape to the landing's —
 * `app/(terminal)/trade/proposals/[id]/page.tsx` reads its id the same way.
 */

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useConditionalsEnabled } from '@/lib/conditionals/useConditionalsEnabled';

const ConditionalDetail = dynamic(
  () => import('./ConditionalDetail').then((m) => m.ConditionalDetail),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[var(--h-app-content)] items-center justify-center text-[12px] text-[var(--ink-3)]">
        Loading conditional…
      </div>
    ),
  },
);

/** One id, however the router hands it over. */
export function conditionalIdFrom(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

export function ConditionalDetailGate() {
  const params = useParams();
  const conditionalsEnabled = useConditionalsEnabled();
  if (!conditionalsEnabled) return null;
  return <ConditionalDetail conditionalId={conditionalIdFrom(params?.id)} />;
}

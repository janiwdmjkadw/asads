'use client';

/**
 * Client-side flag gate + lazy loader for the full-page chat: keeps the
 * /agent route chunk to this stub; the real page lives in the shared
 * agent-chat async chunk (loaded only with the flag on, which the server
 * gate in `app/(terminal)/agent/page.tsx` already guarantees).
 */

import dynamic from 'next/dynamic';
import { getRuntimeConfig } from '@/lib/runtime-config';

const AgentPage = dynamic(() => import('./AgentPage').then((m) => m.AgentPage), {
  ssr: false,
  loading: () => (
    <div className="flex h-[var(--h-app-content)] items-center justify-center text-[12px] text-[var(--ink-3)]">
      Loading agent…
    </div>
  ),
});

export function AgentPageGate() {
  if (!getRuntimeConfig().agentChat) return null;
  return <AgentPage />;
}

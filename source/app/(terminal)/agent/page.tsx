import { notFound } from 'next/navigation';
import { AgentPageGate } from '@/components/agent/AgentPageGate';
import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * Full-page agent chat route (04 "Placement"). Hard-gated by
 * NEXT_PUBLIC_AGENT_CHAT: with the flag off the route 404s server-side —
 * no chat DOM, no chat chunks, no route surface on the live terminal.
 */
export default function AgentRoute() {
  if (!getRuntimeConfig().agentChat) notFound();
  return <AgentPageGate />;
}

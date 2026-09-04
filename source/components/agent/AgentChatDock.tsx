'use client';

/**
 * Agent chat feature-flag gate. `NEXT_PUBLIC_AGENT_CHAT=1` gates
 * EVERYTHING chat-related: with the flag off this renders null before any
 * chat module is touched — zero DOM, and the chat code stays in its own
 * never-requested async chunks (verified in the WP evidence). This is the
 * only agent-chat import the terminal shell carries (the topnav's
 * "Ask the agent…" button reaches the store through the same lazy
 * `import()` boundary, never statically).
 */

import dynamic from 'next/dynamic';
import { getRuntimeConfig } from '@/lib/runtime-config';

const AgentChatDockActive = dynamic(
  () => import('./AgentChatDockActive').then((m) => m.AgentChatDockActive),
  { ssr: false },
);

export function AgentChatDock() {
  if (!getRuntimeConfig().agentChat) return null;
  return <AgentChatDockActive />;
}

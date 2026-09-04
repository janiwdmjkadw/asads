'use client';

/**
 * Full-page agent chat (04 "Placement": full-page chat with conversation
 * history/management). Conversation list on the left (keyset-paginated
 * endpoint; first page only at scaffold stage), active thread on the
 * right, sharing the isolated chat store with the trade side panel.
 */

import { useEffect, useRef } from 'react';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { AgentBanner } from './AgentBanner';
import { AgentConversation } from './AgentConversation';
import { AgentMessageInput } from './AgentMessageInput';

function ConversationList() {
  const conversations = useAgentChatStore((s) => s.conversations);
  const conversationsStatus = useAgentChatStore((s) => s.conversationsStatus);
  const conversationId = useAgentChatStore((s) => s.conversationId);
  const selectConversation = useAgentChatStore((s) => s.selectConversation);
  const newConversation = useAgentChatStore((s) => s.newConversation);

  return (
    <div className="flex min-h-0 flex-col border-r border-[var(--hairline)]">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-2.5">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
          Conversations
        </span>
        <button
          type="button"
          onClick={() => void newConversation()}
          data-testid="agent-new-conversation"
          className="ag-chip rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          new
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="agent-conversation-list">
        {conversationsStatus === 'loading' ? (
          <div className="px-3 py-2 text-[12px] text-[var(--ink-3)]">Loading…</div>
        ) : null}
        {conversationsStatus === 'error' ? (
          <div className="px-3 py-2 text-[12px] text-[var(--down)]">Could not load conversations.</div>
        ) : null}
        {conversationsStatus === 'ready' && conversations.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-[var(--ink-3)]">
            No conversations yet — send a message to start one.
          </div>
        ) : null}
        {conversations.map((c) => {
          const active = c.id === conversationId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => void selectConversation(c.id)}
              data-active={active ? 'true' : 'false'}
              className={`ag-convo-item block w-full truncate px-3 py-2 text-left text-[12px] ${
                active
                  ? 'text-[var(--ink-0)]'
                  : 'text-[var(--ink-2)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--ink-1)]'
              }`}
            >
              {c.title ?? 'Untitled conversation'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgentPage() {
  const loadConversations = useAgentChatStore((s) => s.loadConversations);
  const conversationId = useAgentChatStore((s) => s.conversationId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  return (
    <div
      data-agent-chat="page"
      data-testid="agent-page"
      className="grid h-[var(--h-app-content)] min-h-0 grid-cols-[240px_minmax(0,1fr)] [contain:layout_style_paint]"
    >
      <ConversationList />
      <div className="flex min-h-0 flex-col">
        <AgentBanner />
        <AgentConversation />
        <AgentMessageInput ref={inputRef} placeholder="Ask the agent… (Enter to send)" />
      </div>
    </div>
  );
}

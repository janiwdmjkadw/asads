'use client';

/**
 * Full-page agent chat (04 "Placement": full-page chat with conversation
 * history/management). Conversation list on the left (keyset-paginated
 * endpoint; first page only at scaffold stage), active thread on the
 * right, sharing the isolated chat store with the trade side panel.
 */

import { useEffect, useRef, useState } from 'react';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { AgentBanner } from './AgentBanner';
import { AgentConversation } from './AgentConversation';
import { AgentMessageInput } from './AgentMessageInput';

function ConversationList({ onPick }: { onPick?: () => void }) {
  const conversations = useAgentChatStore((s) => s.conversations);
  const conversationsStatus = useAgentChatStore((s) => s.conversationsStatus);
  const conversationId = useAgentChatStore((s) => s.conversationId);
  const selectConversation = useAgentChatStore((s) => s.selectConversation);
  const newConversation = useAgentChatStore((s) => s.newConversation);

  return (
    <div className="ag-convo-rail flex min-h-0 flex-1 flex-col md:flex-none md:border-r md:border-[var(--hairline)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
          Conversations
        </span>
        {/*
         * THE ONE ACT IN THIS PANEL, drawn like one.
         *
         * It was the word `new` at 10px in tracked capitals in ink-2 —
         * the same size and colour as the label beside it, with no
         * shape — so the only button in the rail read as a second
         * caption, and the target was about eleven pixels tall.
         *
         * A filled plate, a mark, and a word: the same ink primary
         * every other act in the terminal wears.
         */}
        <button
          type="button"
          onClick={() => {
            void newConversation();
            onPick?.();
          }}
          data-testid="agent-new-conversation"
          title="Start a new conversation"
          className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--ink-0)] pl-2 pr-2.5 text-[11.5px] font-medium text-[var(--surface)] transition-opacity hover:opacity-90"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-[13px] w-[13px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
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
              onClick={() => {
                void selectConversation(c.id);
                onPick?.();
              }}
              data-active={active ? 'true' : 'false'}
              className={`ag-convo-item block w-full truncate px-3 py-2 text-left text-[12.5px] ${
                active
                  ? 'bg-[rgba(11,14,20,0.05)] text-[var(--ink-0)]'
                  : 'text-[var(--ink-2)] hover:bg-[rgba(11,14,20,0.04)] hover:text-[var(--ink-1)]'
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
  const conversations = useAgentChatStore((s) => s.conversations);
  const selectConversation = useAgentChatStore((s) => s.selectConversation);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /*
   * OPEN THE NEWEST ONE — ONCE, ON ARRIVAL.
   *
   * The page used to land with nothing selected, which draws a spinner
   * where the conversation goes until you pick a title, and on a phone
   * reads as a chat that failed to load.
   *
   * The latch is the whole point. `newConversation()` is
   * `selectConversation(null)` — a draft with no id until you send — so
   * an effect that fires whenever the id is null would answer New chat
   * by reopening the newest thread, which is exactly what it did.
   * Landing is a one time event; every null after it is a decision.
   */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || conversationId !== null) return;
    const newest = conversations[0];
    if (newest === undefined) return;
    landed.current = true;
    void selectConversation(newest.id);
  }, [conversationId, conversations, selectConversation]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  /*
   * THE DRAWER, under 720 only. One boolean and a transform: the rail
   * slides in over the thread, a scrim takes the rest of the screen,
   * and picking anything inside it closes it behind you.
   */
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const title =
    conversations.find((c) => c.id === conversationId)?.title ?? 'New chat';

  return (
    <div
      data-agent-chat="page"
      data-testid="agent-page"
      /*
       * One column on a phone, two on a desktop. The rail is a fixed
       * 240px, which on a 375px screen left the conversation itself
       * 135 — so under 720 it stops being a column at all and becomes
       * the drawer below.
       */
      className="relative grid h-[var(--h-app-content)] min-h-0 grid-cols-[minmax(0,1fr)] [contain:layout_style_paint] md:grid-cols-[240px_minmax(0,1fr)]"
    >
      {/* The rail, in its desktop form. Hidden under 720, where the same
          list is what the drawer holds. */}
      <div className="hidden min-h-0 md:flex md:min-h-0 md:flex-col">
        <ConversationList />
      </div>

      <div className="flex min-h-0 flex-col">
        {/*
         * The phone's own header: the way in to the list, and the name
         * of the thread you are reading. It is the only chrome the
         * drawer needs — no strip of titles taking a band off every
         * screen.
         */}
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Conversations"
            data-testid="agent-drawer-open"
            className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline-2)] text-[var(--ink-1)]"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-[15px] w-[15px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ink-0)]">
            {title}
          </span>
        </div>

        <AgentBanner />
        <AgentConversation />
        <AgentMessageInput ref={inputRef} placeholder="Ask the agent… (Enter to send)" />
      </div>

      {/* The scrim. It exists only while the drawer is open, and it is
          what closes it — the same gesture as anywhere else. */}
      <button
        type="button"
        aria-hidden={!drawer}
        tabIndex={drawer ? 0 : -1}
        onClick={() => setDrawer(false)}
        data-testid="agent-drawer-scrim"
        className="absolute inset-0 z-[30] bg-[rgba(11,14,20,0.32)] md:hidden"
        style={{
          opacity: drawer ? 1 : 0,
          pointerEvents: drawer ? 'auto' : 'none',
          transition: 'opacity 200ms var(--ease-out, ease-out)',
        }}
      />

      <aside
        aria-label="Conversations"
        data-testid="agent-drawer"
        className="absolute inset-y-0 left-0 z-[31] flex w-[272px] max-w-[84vw] flex-col border-r border-[var(--hairline)] bg-[var(--surface)] shadow-[0_24px_60px_-24px_rgba(11,14,20,0.35)] md:hidden"
        /* The slide is an inline transform rather than a utility pair.
           The utility classes were applied and produced no transform at
           all — the drawer sat open with `-translate-x-full` on it — and
           a panel that only closes when a stylesheet cooperates is not
           worth debugging twice. */
        style={{
          transform: drawer ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 200ms var(--ease-out, ease-out)',
          visibility: drawer ? 'visible' : 'hidden',
          transitionProperty: 'transform, visibility',
        }}
      >
        <ConversationList onPick={() => setDrawer(false)} />
      </aside>
    </div>
  );
}

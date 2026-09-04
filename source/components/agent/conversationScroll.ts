'use client';

/**
 * The conversation's scroll box, handed to the parts inside it.
 *
 * `use-stick-to-bottom` publishes its own React context, but the context
 * OBJECT is not exported and `useStickToBottomContext()` THROWS outside a
 * `<StickToBottom>` — and the parts that want this (a proposal card) also
 * render on `/trade/proposals/<id>`, where there is no conversation at
 * all. So `AgentConversation` captures the library's context through its
 * `contextRef` and republishes exactly three capabilities here, with
 * `null` as the honest answer for "not in a conversation".
 *
 * Each capability is a FUNCTION, not a value, so the published object can
 * be stable for the life of the conversation while still answering with
 * the library's live state at the moment it is asked.
 */

import { createContext, useContext } from 'react';

export interface ConversationScroll {
  /** The scrolling element itself — the box a part measures against. */
  readonly scrollElement: () => HTMLElement | null;
  /** Is the thread currently pinned to the bottom? */
  readonly isAtBottom: () => boolean;
  /**
   * Disengage stick-to-bottom, the way a user scrolling up disengages it
   * (`stopScroll`): every queued and future auto-scroll re-reads that
   * state each frame, so releasing kills the one in flight too.
   */
  readonly release: () => void;
}

export const ConversationScrollContext = createContext<ConversationScroll | null>(null);

/** `null` outside a conversation — the caller decides what that means. */
export function useConversationScroll(): ConversationScroll | null {
  return useContext(ConversationScrollContext);
}

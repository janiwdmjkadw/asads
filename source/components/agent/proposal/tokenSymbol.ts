'use client';

/**
 * The token's TICKER for the proposal card's action row.
 *
 * The proposal record carries a mint and no symbol (`ProposalDetail`
 * has no name field yet — the durable fix is server-side, and until it
 * lands this is the honest best effort). So the container asks the two
 * places the browser already knows tokens by name, in order:
 *
 *   1. THE TURN ITSELF. A `get_token_state` result in this conversation
 *      for exactly this mint (`tokenSymbolForMint`). This is SERVER
 *      data — a tool result, not model prose — and the match is by
 *      mint, so a state for another coin is never borrowed.
 *   2. THE PAGE CONTEXT. The same navigation-hint cache the agent
 *      window's header chip reads (`tokenTickerFromNavigationHint`), so
 *      a proposal about the token whose page you are on reads by name.
 *
 * Neither can change what a click authorizes: this is a LABEL beside a
 * logo, and when both miss, the card says `token` and leaves identity
 * to the details drawer. Nothing here ever renders an address.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TOKEN_HINT_EVENT,
  shouldHandleTokenHintEvent,
  tokenTickerFromNavigationHint,
} from '@/components/listen/navigation';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { streamParts } from '@/lib/agent/chat-core';
import { tokenSymbolForMint } from '@/lib/agent/view';

export function useProposalTokenSymbol(mint: string | null): string | null {
  /*
   * A primitive selector: it re-runs on every stream tick but only
   * re-renders the card when the resolved NAME changes, so a settled
   * proposal card does not repaint while prose streams beside it
   * (F§ invariant 4).
   */
  const fromTurn = useAgentChatStore((state) => {
    if (mint === null) return null;
    const live = state.stream === null ? null : tokenSymbolForMint(streamParts(state.stream), mint);
    if (live !== null) return live;
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const found = tokenSymbolForMint(state.history[index].parts, mint);
      if (found !== null) return found;
    }
    return null;
  });

  /*
   * The hint cache is written by navigation, not by React, so a mount
   * that misses it re-reads once the hint for THIS mint lands — the
   * same listener the window header uses.
   */
  const [hintTick, setHintTick] = useState(0);
  useEffect(() => {
    if (mint === null) return;
    const onHint = (event: Event) => {
      if (shouldHandleTokenHintEvent((event as CustomEvent).detail, mint)) setHintTick((tick) => tick + 1);
    };
    window.addEventListener(TOKEN_HINT_EVENT, onHint);
    return () => window.removeEventListener(TOKEN_HINT_EVENT, onHint);
  }, [mint]);

  return useMemo(() => {
    if (fromTurn !== null) return fromTurn;
    if (mint === null) return null;
    void hintTick;
    return tokenTickerFromNavigationHint(mint);
  }, [fromTurn, mint, hintTick]);
}

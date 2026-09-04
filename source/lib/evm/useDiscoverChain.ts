'use client';

import { useCallback, useEffect, useState } from 'react';
import { useEvmEnabled } from './useEvmEnabled';
import {
  DISCOVER_CHAIN_PARAM,
  DISCOVER_CHAIN_STORAGE_KEY,
  DEFAULT_DISCOVER_CHAIN,
  discoverSearchWithChain,
  parseDiscoverChain,
  resolveDiscoverChain,
  type DiscoverChainTag,
} from './chains';

/**
 * ONE source of truth for which chain the discover surface is showing.
 *
 * It replaced three that did not agree:
 *
 *  1. `DiscoverPage`'s local `useState<'sol'|'bsc'|'robinhood_chain'>('sol')`
 *     — invisible to the URL, reset on every reload, unshareable.
 *  2. `/discover/evm?chain=` — in the URL, but on a SEPARATE route that
 *     rendered only the EVM lanes, so choosing a chain there and choosing one
 *     on `/discover` were different acts with different outcomes.
 *  3. The trade route's path slug (`/trade/bsc/0x…`) — the user is
 *     unambiguously on BSC, and going back to Discover put them on Solana.
 *
 * The reconciliation, in one sentence: **the URL is the state, localStorage is
 * the memory of it, and the trade route writes the memory.** A refresh keeps
 * the chain (the URL still says it), a shared link opens on the sender's chain
 * (the URL says it and beats the recipient's stored preference), and a cold
 * `/discover` with no query opens on whatever the user last used.
 *
 * WHY `window.history`, NOT `useSearchParams` + `router.replace`.
 * `DiscoverPage` lives inside a PERSISTENT PANE that stays mounted behind the
 * trade page; `useSearchParams` would opt its whole segment into client-side
 * rendering and re-render the pane on unrelated query changes, and
 * `router.replace` would push work through the App Router for what is a
 * display flip. `history.replaceState` is the documented App Router escape
 * hatch for exactly this: update the URL, do not re-run the route.
 *
 * Solana emits NO `?chain=` parameter, so `/discover` stays byte-identical to
 * the URL it has always been — every existing Solana link and bookmark
 * resolves unchanged.
 *
 * BEHIND THE `evm-client-surface` FLAG. With the flag off this resolves to
 * Solana unconditionally, overriding BOTH inputs — the `?chain=` parameter AND
 * the remembered selection. The stored value is the reason the override has to
 * live here rather than at the switcher: a user who clicked BSC before the
 * gate has `bsc` sitting in `discover:chain:v1`, and honouring it would open
 * them straight onto the EVM lanes with no switcher visible to leave by. The
 * stored value is READ-past, never cleared — flipping the flag back on returns
 * them to the lane they chose.
 */
export function useDiscoverChain(): {
  chain: DiscoverChainTag;
  setChain: (next: DiscoverChainTag) => void;
} {
  const evmEnabled = useEvmEnabled();
  /* SSR renders the default. Reading `window` during render would be a
     hydration mismatch, and reading localStorage during render would be one
     even on the client — so the stored/URL value is adopted in an effect, one
     frame later. The frame costs nothing here: the Solana subtree is the
     default and stays mounted either way, so adopting `bsc` a frame late is a
     display flip, not a remount. */
  const [chain, setChainState] = useState<DiscoverChainTag>(DEFAULT_DISCOVER_CHAIN);

  useEffect(() => {
    /* Flag off: pin to Solana and subscribe to nothing. The reset (rather than
       just skipping adoption) covers the flag flipping off under a mounted
       pane — LD can re-evaluate at any time, and a stale `bsc` in state would
       otherwise survive as a board with no way back. */
    if (!evmEnabled) {
      setChainState(DEFAULT_DISCOVER_CHAIN);
      return;
    }
    const adopt = () => {
      const url = new URLSearchParams(window.location.search).get(DISCOVER_CHAIN_PARAM);
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(DISCOVER_CHAIN_STORAGE_KEY);
      } catch {
        // Private mode / disabled storage. The URL still works; the memory
        // does not, and that degrades to "always opens on the default"
        // rather than to a crash.
      }
      setChainState(resolveDiscoverChain(url, stored));
    };
    adopt();
    // A back/forward between `/discover` and `/discover?chain=bsc` is a real
    // navigation the user expects to move the board.
    window.addEventListener('popstate', adopt);
    window.addEventListener('listen:discover-chain', adopt);
    return () => {
      window.removeEventListener('popstate', adopt);
      window.removeEventListener('listen:discover-chain', adopt);
    };
  }, [evmEnabled]);

  const setChain = useCallback((next: DiscoverChainTag) => {
    /* Flag off: a no-op, not a coerce-to-Solana. There is no switcher to call
       this and nothing to switch to, and writing `solana` here would overwrite
       the remembered EVM selection the gate is supposed to leave intact. */
    if (!evmEnabled) return;
    setChainState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DISCOVER_CHAIN_STORAGE_KEY, next);
    } catch {
      // See above — the URL is still authoritative for this tab.
    }
    const search = discoverSearchWithChain(window.location.search, next);
    /* replaceState, not pushState: flipping between lanes is not a
       navigation the back button should have to unwind one chain at a time.
       The URL is still shareable and still survives a reload, which is what
       was actually missing. */
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}`);
    window.dispatchEvent(new Event('listen:discover-chain'));
  }, [evmEnabled]);

  return { chain, setChain };
}

/**
 * Record the chain a user is currently looking at, WITHOUT changing what is on
 * screen.
 *
 * Called by the chain-qualified trade route. Opening `/trade/bsc/0x…` — from a
 * shared link, a bookmark, or a card click — is unambiguous evidence about
 * which chain the user is working on, and losing it on the way back to
 * Discover was the third of the three unreconciled mechanisms. This writes the
 * memory only; it touches no URL, because the trade page's own URL already
 * says the chain and rewriting it would fight the router.
 *
 * NOT flag-gated here, and it does not need to be: this is a plain function
 * (no hook, so it cannot read the flag) and its ONLY caller is
 * `PersistentEvmTradePane`, which `TerminalShell` does not mount while
 * `evm-client-surface` is off. Nothing can reach this to persist an EVM chain.
 */
export function rememberDiscoverChain(chain: string): void {
  if (typeof window === 'undefined') return;
  const parsed = parseDiscoverChain(chain);
  // Only chains the discover surface can actually SHOW are remembered. Storing
  // `base` would send the next `/discover` visit to a lane that does not
  // exist, and `resolveDiscoverChain` would silently fall back — a stored
  // value nobody can honour is worse than no stored value.
  if (parsed === null) return;
  try {
    window.localStorage.setItem(DISCOVER_CHAIN_STORAGE_KEY, parsed);
    window.dispatchEvent(new Event('listen:discover-chain'));
  } catch {
    // Nothing to do; the trade page itself is unaffected.
  }
}

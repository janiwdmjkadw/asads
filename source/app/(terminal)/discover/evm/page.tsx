'use client';

/**
 * `/discover/evm` — RETIRED, and now a redirect to `/discover?chain=…`.
 *
 * This route existed because the placement of the EVM lanes relative to the
 * Solana ones was an open product question, and inventing an answer inside
 * `DiscoverPage` would have been choosing for the owner while putting the live
 * Solana surface at risk. Its own header said it was "trivially deleted once
 * the placement is decided".
 *
 * The placement WAS decided (owner directive, 2026-08-06: the chain switch
 * lives on the discover page), and keeping this route afterwards was the
 * problem rather than the caution: it left two different places to pick a
 * chain, disagreeing about vocabulary (`?chain=robinhood_chain` here,
 * a local `useState` there) and about what "switching chain" even did. Item 3
 * of the closure list is that disagreement.
 *
 * It redirects rather than 404s because the link has shipped and may be
 * bookmarked, and because `parseDiscoverChain` accepts BOTH vocabularies —
 * so an old `/discover/evm?chain=robinhood_chain` lands on exactly the lane it
 * always did, at the URL that is now canonical.
 *
 * `useRouter().replace`, not `redirect()`: this is a client component and the
 * target is the persistent-pane discover route, which must be entered through
 * the router so the pane is reused rather than hard-reloaded.
 */

import { useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import {
  DEFAULT_DISCOVER_CHAIN,
  DISCOVER_CHAIN_PARAM,
  discoverHrefForChain,
  parseDiscoverChain,
} from '@/lib/evm/chains';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';

function EvmDiscoverRedirect() {
  const router = useRouter();
  /* This route mints the URL that `useDiscoverChain` later reads, so it needs
     its own gate — the hook's override pins the BOARD to Solana but cannot
     un-say a `?chain=bsc` this redirect put in the address bar. Leaving it
     there is not a visibility leak today, but LD re-evaluates live: flipping
     the flag on mid-session would make that stale parameter adopt itself and
     drop the user onto the EVM lanes they never asked for. */
  const evmEnabled = useEvmEnabled();
  useEffect(() => {
    /* Read from `window.location` rather than `useSearchParams` so this
       component needs no Suspense-driven re-render to know its own query — it
       runs exactly once, in an effect, and navigates. An unparseable or absent
       chain falls to the default rather than 404ing: someone following this
       link wants the discover board, and a typo'd query is not a reason to
       show them nothing. */
    const raw = new URLSearchParams(window.location.search).get(DISCOVER_CHAIN_PARAM);
    /* Flag off ⇒ the query is DROPPED, not honoured: the default chain makes
       `discoverHrefForChain` emit the plain canonical `/discover` with no
       parameter at all (Solana deliberately spells itself as an absent
       param), which is byte-identical to the pre-EVM discover URL. */
    const chain = evmEnabled ? (parseDiscoverChain(raw) ?? DEFAULT_DISCOVER_CHAIN) : DEFAULT_DISCOVER_CHAIN;
    router.replace(discoverHrefForChain(chain));
  }, [router, evmEnabled]);

  return (
    <main className="p-6 text-sm" data-testid="evm-discover-redirect">
      Opening Discover…
    </main>
  );
}

export default function EvmDiscoverRoute() {
  return (
    <Suspense fallback={<main className="p-6 text-sm">Loading…</main>}>
      <EvmDiscoverRedirect />
    </Suspense>
  );
}

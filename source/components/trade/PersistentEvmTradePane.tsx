'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { EvmTradePage } from './EvmTradePage';
import { TradePaneHiddenContext } from './tradePaneVisibility';
import { parseEvmTradePath, type EvmTradeSubject } from '@/lib/evm/chains';
import { rememberDiscoverChain } from '@/lib/evm/useDiscoverChain';

/**
 * Keeps the EVM trade page MOUNTED across route changes — the two-segment
 * SIBLING of `PersistentTradePane`, not an extension of it.
 *
 * A sibling on purpose: the Solana pane's matcher (`^/trade/([^/]+)$` + the
 * base58 gate) is part of the sacred first-paint path, and folding a second
 * shape into it would put every Solana navigation through new code. This pane
 * claims EXACTLY the served two-segment EVM paths (`parseEvmTradePath`:
 * served slug + well-formed 0x address); everything else — including
 * `/trade/proposals/<id>` and unserved slugs, whose invalid/redirect pages
 * the route component keeps owning — leaves it inert.
 *
 * Same mechanism as the Solana twin:
 *  - LAZY: mounts on the first EVM trade visit; deep links elsewhere pay zero.
 *  - Subject swaps IN PLACE on route changes (EvmTradePage's own subject-reset
 *    effect handles the tape/header wipe) — no remount flash.
 *  - While hidden the pane retains the LAST subject and provides
 *    `TradePaneHiddenContext`, which EvmTradePage reads to go dormant (socket
 *    closed, clock stopped) and to heal with one refetch on reveal.
 */
export function PersistentEvmTradePane() {
  const pathname = usePathname();
  const parsed = parseEvmTradePath(pathname);
  const chain = parsed?.chain ?? null;
  const address = parsed?.address ?? null;
  const active = chain !== null && address !== null;
  const [retained, setRetained] = useState<EvmTradeSubject | null>(parsed);

  useEffect(() => {
    if (chain === null || address === null) return;
    setRetained((current) =>
      current !== null && current.chain === chain && current.address === address
        ? current
        : { chain, address },
    );
    // The user is provably looking at a token on this chain — remember it so
    // returning to Discover lands on the same chain (was `RememberChain` in
    // the route component before the pane owned rendering).
    rememberDiscoverChain(chain);
    performance.mark('trade:evm-pane-active', { detail: { chain, address } });
  }, [chain, address]);

  const subject = parsed ?? retained;
  if (subject === null) return null; // never visited an EVM chart this session
  return (
    <TradePaneHiddenContext.Provider value={!active}>
      {/* display:none while hidden — same measured reasoning as the Solana
          pane: hidden-but-laid-out subtrees tax every navigation commit. */}
      <div style={{ display: active ? 'contents' : 'none' }} aria-hidden={!active}>
        <EvmTradePage chain={subject.chain} address={subject.address} />
      </div>
    </TradePaneHiddenContext.Provider>
  );
}

'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Solana } from '@/components/listen/icons/Icons';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { useWalletFunding } from '@/lib/api/wallet-funding';
import { formatFundedAge } from '@/components/discover/WalletFundingHoverCard';
import { shortAddress } from '@/components/discover/trackedWallets';
import { ExchangeIcon } from './ExchangeIcon';

/**
 * FundingCell — Axiom-style funding readout for the Holders / Top
 * Traders tables:
 *
 *   [logo] Binance             [↑] CqVZZp…f7cy
 *   2mo · ◎0.459                5m · ◎0.023
 *
 * Line 1 is the wallet's direct funder (exchange label when known, raw
 * address otherwise — click opens the wallet profile). Line 2 is
 * funding age · funded SOL.
 *
 * Fetches when the cell first becomes VISIBLE (IntersectionObserver,
 * 200px lookahead) and stays fetched: the tables render all 100 rows
 * unvirtualized, and mount-fetching every row burned a 100-credit
 * Wallet API call per never-seen wallet below the fold. On-screen rows
 * still fill with the table; off-screen rows resolve as they scroll
 * into view. Balance is skipped (`withBalance: false`) — the cell
 * never renders it.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatFundedSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 100) return sol.toFixed(0);
  if (sol >= 10) return sol.toFixed(1);
  if (sol >= 1) return sol.toFixed(2);
  return sol.toFixed(3);
}

export function FundingCell({ wallet }: { wallet: string }) {
  const cellRef = useRef<HTMLSpanElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = cellRef.current;
    if (seen || node === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  const { data, loading, error } = useWalletFunding(wallet, seen, { withBalance: false });

  const secondaryStyle: CSSProperties = { color: 'var(--ink-3)' };

  let primary: React.ReactNode;
  if (loading) {
    primary = <span style={{ color: 'var(--ink-4)' }}>…</span>;
  } else if (error || !data || (!data.originSource && !data.funder)) {
    primary = <span style={{ color: 'var(--ink-3)' }}>Unknown</span>;
  } else if (data.originSource) {
    primary = (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ExchangeIcon label={data.originSource} size={14} />
        <span className="truncate" style={{ color: 'var(--ink-1)' }}>
          {data.originSource}
        </span>
      </span>
    );
  } else {
    // Unlabeled funder: the address IS the lead — click opens its profile.
    const funder = data.funder!;
    primary = (
      <button
        type="button"
        className="inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left hover:underline"
        style={{ color: 'var(--ink-1)', font: 'inherit' }}
        title={funder}
        onClick={(e) => {
          e.stopPropagation();
          openWalletProfile(funder);
        }}
      >
        <span aria-hidden style={{ color: 'var(--ink-3)' }}>
          ↑
        </span>
        <span className="truncate">{shortAddress(funder)}</span>
      </button>
    );
  }

  const fundedAtMs = data?.fundedAtMs ?? null;
  const amountLamports = data?.fundingAmountLamports ?? null;

  return (
    <span ref={cellRef} className="inline-flex min-w-0 flex-col gap-0.5 leading-tight">
      {primary}
      {data && !loading && fundedAtMs !== null ? (
        <span
          className="inline-flex min-w-0 items-center gap-1 truncate text-[10px]"
          style={secondaryStyle}
        >
          {formatFundedAge(fundedAtMs, Date.now())}
          {amountLamports !== null ? (
            <>
              <span aria-hidden>·</span>
              <Solana style={{ width: 9, height: 9, flexShrink: 0 }} />
              {formatFundedSol(amountLamports)}
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

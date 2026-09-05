/**
 * The clickable token identity chip — the conditional surfaces' one way
 * to name a token, and a LINK to its trade page.
 *
 * Same visual grammar as the ledger's scope plate (coin art through
 * `TokenDisc`, symbol-length label, mint as the hover title) promoted to
 * a navigable element: every place a conditional shows which token a leg
 * or firing operates on should let the user go trade it in one click.
 * `symbol` may be null (catalog not hydrated) — the 4…4 short mint is the
 * label then, never prose.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { TokenDisc } from '@/components/agent/proposal/v2/marks';
import { TOK_PLATE } from '@/components/agent/proposal/v2/card-classes';
import { tradeHref } from '@/lib/agent/mint-links';

export function shortMint(mint: string): string {
  return mint.length <= 9 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function TokenChip({ mint, symbol, testid }: { readonly mint: string; readonly symbol?: string | null; readonly testid?: string }): ReactElement {
  return (
    <Link
      href={tradeHref(mint)}
      className="inline-block whitespace-nowrap rounded-[4px] bg-[rgba(11,14,20,.06)] px-[5.5px] py-[2px] align-[.05em] text-[10px] leading-[1.1] text-[var(--ink-1)] transition-colors hover:bg-[rgba(11,14,20,.14)] hover:text-[var(--ink-0)]"
      title={mint}
      data-testid={testid ?? 'token-chip'}
      prefetch={false}
    >
      <TokenDisc mint={mint} className={TOK_PLATE} />
      {symbol !== null && symbol !== undefined && symbol.length > 0 ? symbol : shortMint(mint)}
    </Link>
  );
}

'use client';

/**
 * EVM holders panel — `GET /evm/holders`.
 *
 * THE partial-count rule, rendered. `holderCount` is a number only when the
 * fold measured every transfer since the token's creation; a partial set
 * sends `null` + `partial: true`, and `observedHolders` is a LOWER BOUND.
 * Presenting the observed figure as "holders" would be shipping a
 * measurement we did not make — so the two are labelled differently and the
 * unmeasured one says so.
 *
 * AND A THIRD STATE, which this panel used to fold into the second: a read
 * NOBODY ANSWERED (`tier: "unavailable"` — a the analytics store timeout, or a cold
 * reader that is not configured) carries `observedHolders: 0` because nothing
 * was observed, and rendered as "at least 0". That is a failed read printed as
 * a fact about the token. Every sentence on this panel now comes from
 * `lib/evm/tradeApi.ts`, where the state it is entitled to is decided once.
 *
 * Balances are token base units and are formatted BigInt-only at the scale the
 * PAGE resolved — measured `decimals` when the wire carried one, the named
 * assumption in `lib/evm/money.ts` when it did not. The scale is a prop rather
 * than a module default so the trade page's decimals disclosure can be shown
 * only when it is true; a panel that silently kept assuming 18 would make that
 * gating a lie by 10^12.
 */

import type { CSSProperties } from 'react';

import { explorerAddressUrl } from '@/lib/evm/explorer';
import {
  holderShareText,
  shareBpsText,
  topHoldersDistribution,
} from '@/lib/evm/holderShare';
import { formatToken, formatTokenCompact } from '@/lib/evm/money';
import {
  holderProvenanceNotes,
  holdersEmptyText,
  readHolderCount,
  type EvmHolderPage,
} from '@/lib/evm/tradeApi';

/** The holders `.trow` grid — same inline-override pattern as the tape's
 *  `TAPE_GRID_STYLE` (trade-page unification: the tab bodies share the Solana
 *  table's row vocabulary). The share column exists only when a denominator
 *  arrived, so the template forks on that rather than rendering a column of
 *  fabricated figures. */
const HOLDER_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: '40px minmax(0, 1.6fr) minmax(90px, 0.7fr) 80px',
  columnGap: 18,
};
const HOLDER_GRID_STYLE_NO_SHARE: CSSProperties = {
  gridTemplateColumns: '40px minmax(0, 1.6fr) minmax(90px, 0.7fr)',
  columnGap: 18,
};

export function EvmHoldersPanel({
  page,
  tokenDecimals,
  chain,
  totalSupply,
}: {
  page: EvmHolderPage;
  tokenDecimals: number;
  /** Storage tag, for explorer address links. Unknown chains link nowhere. */
  chain: string;
  /**
   * The wire's `totalSupply` in token base units, or `null` when it did not
   * arrive — the denominator for the supply-% column and the top-10 bar.
   * Base units on BOTH sides of the division, so no decimals are involved.
   */
  totalSupply: string | null;
}) {
  const count = readHolderCount(page);
  const notes = holderProvenanceNotes(page);
  const emptyText = holdersEmptyText(page);
  const distribution = topHoldersDistribution(page.holders, totalSupply);
  const gridStyle = totalSupply === null ? HOLDER_GRID_STYLE_NO_SHARE : HOLDER_GRID_STYLE;
  return (
    /* Hosted inside the `EvmTradesTable` panel (phase-2 layout), so the frame
       is the panel's: no own border, `.trow` rows, and the header/notes
       aligned to the rows' 24px inset — the exact treatment the tape got. */
    <section aria-label="Holders" data-testid="evm-holders" className="flex min-h-0 flex-col">
      <header className="mb-1 flex flex-wrap items-baseline gap-2 px-6 pt-2">
        <h2 className="text-sm font-semibold">Holders</h2>
        {count.kind === 'exact' && (
          <span className="text-xs tabular-nums" data-testid="evm-holder-count">
            {count.count}
          </span>
        )}
        {count.kind === 'lower-bound' && (
          /* NOT rendered as a count. "at least N" is the true statement; "N
             holders" is a claim the fold cannot support. */
          <span className="text-xs" data-testid="evm-holder-count-partial">
            at least {count.observed}
          </span>
        )}
        {count.kind === 'unavailable' && (
          /* AND NOT "at least 0", which is what an unanswered read used to
             render as — a sentence a reader takes for a measurement. */
          <span className="text-xs" data-testid="evm-holder-count-unavailable">
            unknown
          </span>
        )}
        {page.truncated && (
          <span className="text-[10px] text-muted-foreground">
            top {page.count} of {page.observedHolders} observed
          </span>
        )}
      </header>

      {notes.length > 0 && (
        <div
          className="mb-2 flex flex-col gap-1 px-6 text-[10px] text-muted-foreground"
          data-testid="evm-holders-provenance"
        >
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}

      {emptyText !== null ? (
        <p
          className="px-6 pb-3 text-xs text-muted-foreground"
          data-testid={
            count.kind === 'unavailable' ? 'evm-holders-unavailable' : 'evm-holders-empty'
          }
        >
          {emptyText}
        </p>
      ) : (
        <>
          {distribution !== null && (
            /* TOP-10 CONCENTRATION — the single most-read memecoin risk
               figure, derived entirely from two reads already on the page
               (balances here, `totalSupply` from the header). On a PARTIAL
               page every balance is a floor, so the sum is a floor and says
               "at least" — a lower bound stated as one, never dressed as a
               measurement. */
            <div className="mb-2 px-6" data-testid="evm-holders-distribution">
              <div className="flex h-1.5 w-full overflow-hidden rounded bg-muted">
                {distribution.segments.map((segment, index) => (
                  <div
                    key={segment.address}
                    style={{
                      width: `${segment.bps / 100}%`,
                      background: 'var(--primary, #888)',
                      opacity: 1 - index * 0.08,
                    }}
                  />
                ))}
              </div>
              <p
                className="mt-1 text-[10px] text-muted-foreground"
                data-testid="evm-holders-top10"
              >
                Top {distribution.segments.length}{' '}
                {distribution.segments.length === 1 ? 'holder holds' : 'holders hold'}{' '}
                {page.partial ? 'at least ' : ''}
                {shareBpsText(distribution.totalBps)} of supply.
              </p>
            </div>
          )}
          {/* `.trow` rows — the Solana table's row vocabulary (grid, mono,
              hairlines, hover, sticky head), same as the tape beside this
              tab. Every testid, sentence and honest-state branch of the old
              list survives; only the row frame changed. */}
          <div className="flex flex-col">
            <div className="trow trow--head sticky top-0 z-10" style={gridStyle}>
              <span>#</span>
              <span>Holder</span>
              <span style={{ textAlign: 'right' }}>Balance</span>
              {totalSupply !== null && <span style={{ textAlign: 'right' }}>Supply %</span>}
            </div>
            {page.holders.map((holder, index) => {
              const url = explorerAddressUrl(chain, holder.address);
              const share = holderShareText(holder.balance, totalSupply);
              return (
                <div
                  key={holder.address}
                  className="trow trow--cv"
                  style={gridStyle}
                  data-testid={`evm-holder-${holder.address}`}
                >
                  <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
                    {url === null ? (
                      /* Unknown chain or malformed address: inert text, never a
                         guessed link. */
                      <span className="font-mono">{holder.address}</span>
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono underline-offset-2 hover:underline"
                      >
                        {holder.address}
                      </a>
                    )}
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ textAlign: 'right', color: 'var(--ink-1)' }}
                    title={formatToken(holder.balance, 6, tokenDecimals) ?? 'unknown balance'}
                  >
                    {formatTokenCompact(holder.balance, tokenDecimals) ?? '—'}
                  </span>
                  {totalSupply !== null && (
                    /* Share of supply — an em dash when THIS row's arithmetic
                       refused, the whole column absent (with the note below)
                       when there is no denominator at all. */
                    <span
                      className="tabular-nums"
                      style={{ textAlign: 'right', color: 'var(--ink-3)' }}
                      data-testid={`evm-holder-share-${holder.address}`}
                    >
                      {share ?? '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {totalSupply === null && (
            /* WHY there is no supply-% column: no denominator arrived. Absent
               with a reason, never a column of fabricated zeros. */
            <p
              className="mt-2 px-6 pb-3 text-[10px] text-muted-foreground"
              data-testid="evm-holders-share-unavailable"
            >
              Supply share is unavailable: the wire did not serve this
              token&apos;s total supply, so a percentage would be a guess.
            </p>
          )}
        </>
      )}
    </section>
  );
}

'use client';

/**
 * EVM top traders — `GET /evm/top-traders`.
 *
 * Two shapes, and conflating them is the failure this panel guards against:
 *
 * - `ranked: true` — a real leaderboard. `historyComplete: false` on it means
 *   this is a ranking of the trades we SAW, not of the token, and it is said
 *   out loud rather than left as a footnote nobody reads.
 * - `ranked: false` — a 256-bit total overflowed, so **no total order exists
 *   over these wallets**. The server answers an explicitly unranked page
 *   rather than an empty one, because an empty board claims nobody traded,
 *   which is the opposite of what happened. Rendering it as "no traders"
 *   would undo that care.
 * - **`tier: "unavailable"` — nobody answered.** It arrives as a RANKED board
 *   with no rows (the backend source), so the discriminant
 *   above cannot see it, and an empty-array check printed "No trades observed
 *   for this token yet" over a the analytics store timeout. The sentence is chosen by
 *   the tier now (`tradersEmptyText`), not by the array's length.
 * - **`partialReason` says WHICH KIND of partial.** `historyComplete: false`
 *   is one bit over three situations, and only one of them rewards waiting:
 *   a reorg's damage pending a repair, a tape that started mid-life, and a
 *   token nobody has heard of. `traderProvenanceNotes` picks the sentence, in
 *   the same vocabulary — and from the same module — as the holders panel, so
 *   the two cannot drift.
 *
 * Per-row: `tradeCount` and `volumeNative` are OMITTED when the derived
 * arithmetic refused (checked add overflowed). Absent renders as an em dash
 * — never a wrapped number a dashboard would show without complaint.
 */

import type { CSSProperties } from 'react';

import type { QuoteDenomination } from '@/components/discover/chainBinding';
import { explorerAddressUrl } from '@/lib/evm/explorer';
import { formatNative, formatTokenCompact } from '@/lib/evm/money';
import {
  quoteUnitsWithheldText,
  readTier,
  traderProvenanceNotes,
  tradersEmptyText,
  type EvmTraderBoard,
} from '@/lib/evm/tradeApi';

/** The traders `.trow` grid — the tape's inline-override pattern, seven
 *  columns wide (trade-page unification: tab bodies share the Solana table's
 *  row vocabulary). */
const TRADER_GRID_STYLE: CSSProperties = {
  gridTemplateColumns:
    '40px minmax(0, 1.4fr) minmax(80px, 0.9fr) minmax(80px, 0.9fr) minmax(80px, 0.9fr) minmax(80px, 0.9fr) 56px',
  columnGap: 18,
};

export function EvmTopTradersPanel({
  board,
  quote,
  tokenDecimals,
  chain,
}: {
  board: EvmTraderBoard;
  /** Storage tag, for explorer address links. Unknown chains link nowhere. */
  chain: string;
  /** What `boughtNative` / `soldNative` are DENOMINATED IN. This was
   *  `nativeSymbol: string` — the chain's own ticker — which stamped "(ETH)"
   *  on per-wallet sums that are counts of a stock token's base units on
   *  roughly half of live Pons v2 launches, and rendered them at 18 decimals
   *  besides. The wire carries `quoteToken` and no decimals for it, so
   *  neither the unit nor the scale can be recovered; both columns are
   *  withheld rather than shown wrong. `tokensIn`/`tokensOut` beside them are
   *  in the TOKEN's own scale and are unaffected. */
  quote: QuoteDenomination;
  /** The scale the PAGE resolved for this token — measured when the wire
   *  carried `decimals`, the named assumption otherwise. See
   *  `EvmHoldersPanel` for why it is threaded rather than defaulted. */
  tokenDecimals: number;
}) {
  if (!board.ranked) {
    return (
      <section
        aria-label="Top traders"
        data-testid="evm-top-traders-unranked"
        className="flex min-h-0 flex-col px-6 pt-2"
      >
        <h2 className="text-sm font-semibold">Top traders</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This leaderboard could not be ranked: {board.reason}. There are
          traders — there is no total order over them, so none is shown rather
          than showing an arbitrary one.
        </p>
      </section>
    );
  }

  const emptyText = tradersEmptyText(board);
  const notes = traderProvenanceNotes(board);
  return (
    /* Hosted inside the `EvmTradesTable` panel (phase-2 layout): no own
       border, `.trow` rows, header/notes at the rows' 24px inset — the same
       frame the tape and holders tabs use. */
    <section
      aria-label="Top traders"
      data-testid="evm-top-traders"
      className="flex min-h-0 flex-col"
    >
      <header className="mb-1 flex flex-wrap items-baseline gap-2 px-6 pt-2">
        <h2 className="text-sm font-semibold">Top traders</h2>
        {board.truncated && (
          <span className="text-[10px] text-muted-foreground">
            top {board.count} of {board.total}
          </span>
        )}
      </header>

      {notes.length > 0 && (
        /* WHICH KIND of partial, not merely THAT it is partial. This branch
           was a single hardcoded sentence on `!historyComplete` — true of a
           reorg awaiting repair, of a cold start, and of a token nobody has
           heard of alike, and it told a reader to wait in the two cases where
           waiting is useless. Same structure as the holders panel: the
           sentences live in `tradeApi.ts` so the two cannot drift. */
        <div
          className="mb-2 flex flex-col gap-1 px-6 text-[10px] text-muted-foreground"
          data-testid="evm-top-traders-provenance"
        >
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}

      {emptyText !== null ? (
        /* THE SENTENCE IS CHOSEN BY THE TIER, not by `length === 0`. This read
           printed "No trades observed for this token yet" whenever the array
           was empty, including for `tier: "unavailable"` — a board nobody
           could answer, which the backend source builds as a
           RANKED empty board so the `ranked` discriminant above cannot catch
           it. A failed read rendered as a fact about the token. */
        <p
          className="px-6 pb-3 text-xs text-muted-foreground"
          data-testid={
            readTier(board.tier) === 'unavailable'
              ? 'evm-top-traders-unavailable-tier'
              : 'evm-top-traders-empty'
          }
        >
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-col">
          <div className="trow trow--head sticky top-0 z-10" style={TRADER_GRID_STYLE}>
            <span>#</span>
            <span>Wallet</span>
            {/* The unit is the QUOTE's, and only when we have one. A header
                that names no unit is honest about a column of em dashes; a
                header that names ETH over them is not. */}
            <span style={{ textAlign: 'right' }}>
              {quote.unitSymbol === null ? 'Bought' : `Bought (${quote.unitSymbol})`}
            </span>
            <span style={{ textAlign: 'right' }}>
              {quote.unitSymbol === null ? 'Sold' : `Sold (${quote.unitSymbol})`}
            </span>
            <span style={{ textAlign: 'right' }}>Tokens in</span>
            <span style={{ textAlign: 'right' }}>Tokens out</span>
            <span style={{ textAlign: 'right' }}>Txns</span>
          </div>
          {board.traders.map((trader, index) => {
            const url = explorerAddressUrl(chain, trader.trader);
            return (
              <div
                key={trader.trader}
                className="trow trow--cv"
                style={TRADER_GRID_STYLE}
                data-testid={`evm-trader-${trader.trader}`}
              >
                <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  {index + 1}
                </span>
                <span className="min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
                  {url === null ? (
                    /* Unknown chain or malformed address: inert text, never
                       a guessed link. */
                    <span className="font-mono">{trader.trader}</span>
                  ) : (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono underline-offset-2 hover:underline"
                    >
                      {trader.trader}
                    </a>
                  )}
                </span>
                {/* THE FIGURE FALLS WITH THE LABEL. `formatNative` divides
                    by 10^18, which is the chain coin's scale — a claim
                    about the quote token that nothing measured. Fixing only
                    the header would leave a wrong number wearing a correct
                    unit, which reads as verified. */}
                <span className="tabular-nums" style={{ textAlign: 'right', color: 'var(--ink-1)' }}>
                  {quote.isNative ? (formatNative(trader.boughtNative) ?? '—') : '—'}
                </span>
                <span className="tabular-nums" style={{ textAlign: 'right', color: 'var(--ink-1)' }}>
                  {quote.isNative ? (formatNative(trader.soldNative) ?? '—') : '—'}
                </span>
                <span className="tabular-nums" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                  {formatTokenCompact(trader.tokensIn, tokenDecimals) ?? '—'}
                </span>
                <span className="tabular-nums" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                  {formatTokenCompact(trader.tokensOut, tokenDecimals) ?? '—'}
                </span>
                <span
                  className="tabular-nums"
                  style={{ textAlign: 'right', color: 'var(--ink-2)' }}
                  title={
                    trader.tradeCount === undefined
                      ? 'The checked sum of this wallet’s buys and sells overflowed; the count is unavailable rather than wrapped.'
                      : undefined
                  }
                >
                  {/* Absent because the checked arithmetic REFUSED — an em
                      dash, never `buyCount + sellCount` recomputed here
                      with the same overflow the server declined. */}
                  {trader.tradeCount ?? '—'}
                </span>
              </div>
            );
          })}
          {!quote.isNative && (
            /* WHY TWO COLUMNS ARE EM DASHES, said once under the table rather
               than as a tooltip nobody opens. Silent omission here would read
               as "these wallets bought nothing", i.e. a leaderboard ranking
               traders by an amount it claims is zero.

               The CONSEQUENCE only. This sentence used to re-derive the whole
               premise — which token the market is quoted in, that its money
               leg is not the chain's own asset, that the indexer publishes no
               decimals for it — and so did the tape and the chart, one screen
               apart, above a stats block that had already said all three. The
               premise is stated once now; see `quoteUnitsWithheldText`. */
            <p
              className="mt-2 px-6 pb-3 text-[10px] text-muted-foreground"
              data-testid="evm-top-traders-quote-units-unavailable"
            >
              {quoteUnitsWithheldText('traders')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

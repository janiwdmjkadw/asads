'use client';

import { useMemo } from 'react';
import type { SpotHolding } from '@/lib/api/portfolio-spot';
import { formatAmount, formatPct, formatUsd } from './format';
import { inkForMint } from './cutColors';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": what you hold, as a tape.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * `TokenTreemap` — a squarified treemap where every holding was a
 * rectangle sized by value and FILLED by performance, on a red to green
 * ramp, with a toggle to switch the ramp between unrealized PnL and 24h
 * change. A thousand lines of geometry and a wall of coloured boxes.
 *
 * A treemap answers "what is the shape of this" and it answers it
 * beautifully at ten thousand rows. A portfolio has fifteen. At fifteen
 * it is a wall of colour where a list would be a list, and it cannot
 * tell you what any of the things are worth without a hover.
 *
 * So: a tape. One row per holding, biggest first, with the columns you
 * would actually read across — what it is, how much of the portfolio it
 * is, how many you hold, what that is worth, and what it did today.
 *
 * Each share bar carries the token's own colour, from the same palette
 * the split above uses. Green and red are not in it: they mean gain and
 * loss in the last column of these very rows.
 *
 * Everything the treemap's chrome offered survives without a control:
 * dust and unknown-origin holdings sort to the bottom by value on their
 * own, and the 24h column says what the colour ramp said, in figures.
 */

interface Props {
  readonly holdings: ReadonlyArray<SpotHolding>;
  /** Portfolio total, for the share bar's scale. */
  readonly totalUsd: number;
}

export function HoldingsTape(props: Props): React.ReactElement {
  const rows = useMemo(
    () =>
      [...props.holdings]
        .filter((h) => (h.value_usd ?? 0) > 0)
        .sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0)),
    [props.holdings],
  );

  /* The bar is scaled to the LARGEST holding, not to the portfolio. At
     portfolio scale a fifteen token book draws fourteen slivers and one
     bar, which compares nothing. Against the biggest, every row has a
     length worth reading against its neighbour. */
  const top = rows.length > 0 ? (rows[0]!.value_usd ?? 0) : 0;

  if (rows.length === 0) {
    return <div className="spl-tape-empty">Nothing held yet.</div>;
  }

  return (
    <div className="spl-tape">
      <div className="spl-tape-h">
        <b>Holdings</b>
        <small>
          {rows.length} {rows.length === 1 ? 'token' : 'tokens'}
        </small>
      </div>
      <div className="spl-tape-body">
        {rows.map((h) => (
          <Row key={h.mint} h={h} top={top} />
        ))}
      </div>
    </div>
  );
}

function Row({ h, top }: { h: SpotHolding; top: number }): React.ReactElement {
  const value = h.value_usd ?? 0;
  const day = h.change_24h_pct;
  const width = top > 0 ? Math.min(100, Math.max((value / top) * 100, 2)) : 0;
  const ticker = h.symbol ?? shortMint(h.mint);
  return (
    <div className="spl-tr">
      {/* The ring is on the FRAME, not the picture: a token whose logo
          404s hides its own img, and a border on that img goes with it. */}
      <span className="spl-tr-art">
        {h.logo ? (
          <img
            src={h.logo}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </span>

      <span className="spl-tr-id">
        <span className="spl-tr-tick">{ticker}</span>
        {h.name ? <span className="spl-tr-name">{h.name}</span> : null}
      </span>

      {/* A colour per token, hashed off the mint so it survives the
          tape reordering — see `cutColors.ts`. The bar was white for
          every row, which made six rows of bar read as one column of
          different lengths rather than as six things. */}
      <span className="spl-tr-bar" aria-hidden>
        <span style={{ width: `${width}%`, background: inkForMint(h.mint) }} />
      </span>

      <span className="spl-tr-share">{h.pct_of_portfolio.toFixed(1)}%</span>
      <span className="spl-tr-amt">{formatAmount(h.amount_ui)}</span>
      {/* `formatUsd` groups its digits now, so the branch that used to
          switch to the full formatter under $1,000 is gone — it existed
          only because the compact one printed `$8966.30`. */}
      <span className="spl-tr-val">{formatUsd(value)}</span>
      <span
        className="spl-tr-day"
        style={{
          color: day == null ? 'var(--ink-3)' : day > 0 ? 'var(--up)' : day < 0 ? 'var(--down)' : 'var(--ink-3)',
        }}
      >
        {day == null ? '—' : formatPct(day)}
      </span>
    </div>
  );
}

/** A token with no symbol is still a row; it is named by its mint. */
function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

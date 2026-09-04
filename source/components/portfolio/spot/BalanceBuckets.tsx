'use client';

import { formatUsd } from './format';
import { CUT_INK } from './cutColors';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": the three way split under the chart —
 * SOL, stablecoins, everything else.
 *
 * ── ONE BAR, NOT THREE ───────────────────────────────────────────────
 *
 * The three lengths live in a single stacked bar with a legend under
 * it, so the comparison this row exists to make is made BY THE ROW.
 *
 * It was three columns, each with its own figure and its own bar. Three
 * bars means three baselines, and comparing lengths that do not start
 * at the same place is work the reader should not be doing — it is the
 * one job the row has, and it was handing it back.
 *
 * Three weights of the same white rather than three hues. This is one
 * quantity cut three ways; a hue per cut would say they are three
 * different kinds of thing, and it would make the lengths harder to
 * read, which is the whole point of the object.
 *
 * ── WHAT IT REPLACED BEFORE THAT ─────────────────────────────────────
 *
 * Three tiles, each a 14px-radius bordered plate with an inset top
 * light, a coloured 3px strip signing its top edge, a 20% coloured
 * radial out of its corner, a 4px coloured tick before a mono-capitals
 * label on a 0.14em track, and a share bar filled with a gradient of
 * its own colour under an 8px glow of that colour. Cyan, green, pink.
 * Five colour applications and two grounds per tile, to say how one
 * number divides into three.
 */

interface Props {
  readonly solUsd: number;
  readonly stableUsd: number;
  readonly splUsd: number;
  readonly totalUsd: number;
}

/*
 * ── THE ONE PLACE THIS PAGE SPENDS COLOUR ────────────────────────────
 *
 * Three inks of white did not work, and the reason is structural: a
 * stacked bar's segments carry no labels. The ONLY thing joining a
 * segment to its name in the legend is how it looks, so the three have
 * to be told apart at a glance and at a 9px swatch. Three steps of one
 * grey read as a gradient.
 *
 * The palette is shared with the holdings tape ten pixels below — see
 * `cutColors.ts` for why green and red are not in it.
 */

export function BalanceBuckets(props: Props): React.ReactElement {
  const cuts = [
    { key: 'SOL', usd: props.solUsd },
    { key: 'Stablecoins', usd: props.stableUsd },
    { key: 'Tokens', usd: props.splUsd },
  ];

  const total = props.totalUsd > 0 ? props.totalUsd : cuts.reduce((s, c) => s + c.usd, 0);

  return (
    <div className="spl-split">
      <div className="spl-bar" aria-hidden>
        {cuts.map((c, i) => {
          const pct = total > 0 ? (c.usd / total) * 100 : 0;
          /* A cut worth nothing draws nothing. A zero-width flex child
             with a 2px gap still leaves a gap, which reads as a segment
             that failed to paint. */
          if (pct <= 0) return null;
          return (
            <span key={c.key} style={{ flex: pct, background: CUT_INK[i] }} />
          );
        })}
      </div>

      <div className="spl-key">
        {cuts.map((c, i) => (
          <span key={c.key}>
            <i style={{ background: CUT_INK[i] }} />
            <b>{c.key}</b>
            <u>{formatUsd(c.usd)}</u>
            <u>{total > 0 ? `${((c.usd / total) * 100).toFixed(1)}%` : '0.0%'}</u>
          </span>
        ))}
      </div>
    </div>
  );
}

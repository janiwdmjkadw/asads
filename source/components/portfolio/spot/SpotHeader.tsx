'use client';

import type { SpotRange } from '@/lib/api/portfolio-performance';
import { formatPct, formatSignedUsdFull, formatUsdFull } from './format';
import { useAnimatedNumber } from './useAnimatedNumber';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": the header — the total, the range delta
 * and the range control.
 *
 * ── LEDGER ───────────────────────────────────────────────────────────
 *
 * One line: the total, the delta beside it, the ranges at the far end.
 * Under it, three figures. Then the chart. Everything is left aligned
 * and nothing is centred, so there is one place the eye lands and one
 * direction to go from it.
 *
 * WHAT THIS REPLACED, and why each piece went:
 *
 *   · `TOTAL PORTFOLIO VALUE` — 9.5px mono capitals on a 0.18em track
 *     with a green-blue-pink gradient dash in front of it. Sentence
 *     case now, in the panel's grey, with nothing in front.
 *
 *   · The total in two stacked copies of itself, one carrying a
 *     metallic sweep, over a drop-shadow emboss. It is a number. It is
 *     set once, in the product's own face, and the CENTS are dropped
 *     to 40% white so the dollars carry it — which is the one piece of
 *     treatment here, and it makes the figure easier to read rather
 *     than harder.
 *
 *   · The delta as a tinted capsule with a border and an arrow glyph:
 *     three devices saying up. The figure is green. That is up.
 *
 *   · Three coloured ticks — teal, blue, amber — labelling REALIZED,
 *     UNREALIZED and BASIS in 9px mono capitals, separated by fading
 *     hairline rules. All three are gone. Basis was an input to the
 *     other two rather than a result; realized and unrealized went
 *     after it, because this page is what you HAVE, and what it did is
 *     a different question the chart above already answers.
 *
 *   · The range pills: a bordered tray holding four bordered capsules,
 *     the live one filled with the accent and glowing. Four words. The
 *     live one is the white one.
 *
 *   · `PnlMood`, the mascot that reacted to the selected range, and
 *     `CoinStack`, five confetti bars in five hues dropping onto a gold
 *     coin on mount. Both are gone. This screen is what someone shows
 *     other people when they want to be taken seriously.
 *
 * The hero total still eases toward its target on refetch (see
 * `useAnimatedNumber`) and stays tabular, so the glide never nudges
 * layout.
 */

const RANGES: ReadonlyArray<{ id: SpotRange; label: string }> = [
  { id: '1d', label: '1D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: 'max', label: 'Max' },
];

interface Props {
  readonly totalUsd: number;
  readonly changeUsd: number | null;
  readonly changePct: number | null;
  readonly range: SpotRange;
  readonly onRangeChange: (next: SpotRange) => void;
  readonly degraded: boolean;
  readonly snapshotAtMs: number;
}

export function SpotHeader(props: Props): React.ReactElement {
  const animatedTotal = useAnimatedNumber(props.totalUsd);
  const positive = typeof props.changeUsd === 'number' && props.changeUsd > 0;
  const negative = typeof props.changeUsd === 'number' && props.changeUsd < 0;

  return (
    <div style={{ padding: '0 2px' }}>
      <span className="spl-lab">Portfolio value</span>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: '8px 14px',
          /* 12, not 4. The label and a 44px figure were close enough to
             read as one block rather than as a caption over a number. */
          marginTop: 12,
        }}
      >
        <Total usd={animatedTotal} />

        {props.changeUsd !== null ? (
          <span
            className="spl-delta"
            style={{
              color: positive ? 'var(--up)' : negative ? 'var(--down)' : 'var(--ink-2)',
            }}
          >
            {formatSignedUsdFull(props.changeUsd)}{' '}
            <span className="spl-dim">{formatPct(props.changePct)}</span>
          </span>
        ) : null}

        <span style={{ flex: '1 1 auto' }} />

        <div className="spl-range" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={props.range === r.id}
              data-on={props.range === r.id ? '' : undefined}
              onClick={() => props.onRangeChange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {props.degraded ? (
        <div style={{ fontSize: 11, color: 'var(--down)', marginTop: 8 }}>
          Some prices are temporarily unavailable. Balances are accurate.
        </div>
      ) : null}
    </div>
  );
}

/**
 * The figure, with the cents set back.
 *
 * `formatUsdFull` always ends in `.dd`, so the split is the last dot.
 * Written defensively anyway — a formatter that ever returns a whole
 * dollar figure should print it, not lose its last character.
 */
function Total({ usd }: { usd: number }): React.ReactElement {
  const text = formatUsdFull(usd);
  const dot = text.lastIndexOf('.');
  const dollars = dot === -1 ? text : text.slice(0, dot);
  const cents = dot === -1 ? '' : text.slice(dot);
  return (
    <div className="spl-total">
      {dollars}
      {cents ? <span className="spl-dim">{cents}</span> : null}
    </div>
  );
}

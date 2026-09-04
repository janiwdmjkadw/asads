import './art.css';
import { ROW2_MARKS, ROW2_ORDER, type Row2Key } from '@/components/discover/column/rowMarks';
import { PILL_MARKS } from '@/components/discover/column/Pills';

/*
 * THE SECOND AND THIRD LINES, MARK BY MARK — AS THEY ACTUALLY RENDER.
 *
 * ── THE WHOLE POINT IS THAT NOTHING HERE IS RESTYLED ─────────────────
 *
 * The first cut of this sheet drew every mark as a white glyph on a
 * plate, the way the launchpad sheet above it does. That was wrong, and
 * it was wrong in the way a reference sheet must never be: it showed
 * something the product does not contain. Half of these marks are NOT
 * white on the row — cashback is green, charity pink, fee sharing blue,
 * boost violet, the crown gold — and every pill is a coloured capsule
 * with a figure in it, scored against a limit.
 *
 * So each mark here is wrapped in the CLASS it wears on the row, out of
 * the row's own stylesheet, and each pill is a real pill carrying a real
 * figure and a real tier. What you see is what a row shows.
 *
 * ── WHICH IS ALSO WHY THE FIGURES ARE REAL ───────────────────────────
 *
 * Holders and the dev's record are marks WITH numbers beside them, and
 * the number is most of their width. A glyph shown alone is a mark that
 * fits anywhere; the same glyph with "12.4K" after it is the thing the
 * line actually has to make room for.
 *
 * ── THE CAPS ARE OFF, ON PURPOSE ─────────────────────────────────────
 *
 * On a row the second line stops at six marks and the third at four
 * pills, both by position — the sheet's containers are deliberately not
 * `.arc-meta` and `.arc-pills`, so nothing is hidden here. This is the
 * inventory; the row is where the cut happens.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Art({ k, size }: { k: Row2Key; size: number }) {
  const mark = ROW2_MARKS[k];
  const props = 'filled' in mark && mark.filled
    ? ({ fill: 'currentColor', stroke: 'none' } as const)
    : STROKE;
  return (
    <svg width={size} height={size} viewBox={'viewBox' in mark ? mark.viewBox : '0 0 24 24'} {...props}>
      {mark.art}
    </svg>
  );
}

/*
 * The wrapper each mark wears on the row, and the figure that rides with
 * it. `.arc-attr` variants carry the colour; `.arc-stat` carries a
 * figure; `.arc-web` and `.arc-user` are the plain grey ones.
 */
const WRAP: Record<Row2Key, { cls: string; after?: React.ReactNode }> = {
  /* The leaf carries a tier rather than the line's grey — shown on the
     sheet at `good`, which is the one most rows have. */
  leaf: { cls: 'arc-leaf' },
  cashback: { cls: 'arc-attr is-cash' },
  charity: { cls: 'arc-attr is-give' },
  feeSharing: { cls: 'arc-attr is-fees' },
  boost: { cls: 'arc-attr is-boost' },
  account: { cls: 'arc-web' },
  website: { cls: 'arc-web' },
  telegram: { cls: 'arc-web' },
  github: { cls: 'arc-web' },
  search: { cls: 'arc-stat is-bare' },
  holders: { cls: 'arc-stat', after: '12.4K' },
  migrations: {
    cls: 'arc-stat is-gold',
    after: (
      <>
        31
        <span className="arc-of">/</span>
        52
      </>
    ),
  },
};

/* One representative pill per kind, at a figure that shows its scoring:
   `top10` and `dev` sit over their limit so the bad tier is on the
   sheet, the rest sit under it. A sheet of six green pills would not
   show that these are scored at all. */
const PILLS: {
  key: keyof typeof PILL_MARKS;
  label: string;
  tier: string;
  cls?: string;
  body: React.ReactNode;
}[] = [
  { key: 'top10', label: 'Top 10 holders', tier: 'bad', body: <>57%</> },
  {
    key: 'dev',
    label: 'Dev holding · last moved',
    tier: 'bad',
    body: (
      <>
        61%
        <span className="arc-pill-sub">11m</span>
      </>
    ),
  },
  {
    key: 'snipers',
    label: 'Snipers · wallets and supply',
    tier: 'ok',
    body: (
      <>
        7
        <span className="arc-pill-dot">·</span>
        6%
      </>
    ),
  },
  { key: 'insiders', label: 'Insider holdings', tier: 'bad', body: <>22%</> },
  { key: 'bundles', label: 'Bundled supply', tier: 'ok', body: <>4%</> },
  {
    key: 'boost',
    label: 'Dex Screener paid',
    tier: 'ok',
    cls: 'is-dex',
    body: <span className="arc-pill-sub">1d</span>,
  },
  {
    key: 'boost',
    label: 'Boosted · remaining',
    tier: 'boost',
    cls: 'is-dex',
    body: <span className="arc-pill-sub">22h</span>,
  },
];

export function RowMarksSheet() {
  return (
    <div className="qs">
      <div className="qs-group">
        <div className="qs-title">Second row</div>
        <div className="ms rm">
          {ROW2_ORDER.map((k) => {
            const wrap = WRAP[k];
            return (
              <div className="ms-cell" key={k}>
                {/* Big, in its own colour — the class is on this one too,
                    so the tone is right at both sizes. */}
                <span className={`rm-big ${wrap.cls}`} data-tier={k === 'leaf' ? 'good' : undefined}>
                  <Art k={k} size={30} />
                </span>
                <span className="ms-label">{ROW2_MARKS[k].label}</span>
                {/* And exactly as the row draws it: same class, same
                    15.5px, same figure beside it. */}
                <span className={wrap.cls} data-tier={k === 'leaf' ? 'good' : undefined}>
                  <Art k={k} size={15.5} />
                  {wrap.after}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="qs-group">
        <div className="qs-title">Third row</div>
        <div className="ms rm">
          {PILLS.map((p) => (
            <div className="ms-cell" key={p.label}>
              <span className="rm-big">{PILL_MARKS[p.key]}</span>
              <span className="ms-label">{p.label}</span>
              <span className={`arc-pill ${p.cls ?? ''}`} data-tier={p.tier}>
                <span className="arc-pill-mark">{PILL_MARKS[p.key]}</span>
                {p.body}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

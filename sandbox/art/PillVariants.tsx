import { PILLS, pillTier } from '@/components/discover/column/rowData';
import { PILL_MARKS } from '@/components/discover/column/Pills';

/*
 * THE THIRD LINE, FOUR WAYS.
 *
 * ── WHAT THE REFERENCE ACTUALLY DOES ─────────────────────────────────
 *
 * Reading the screenshots again: the FIGURE takes the colour, not just
 * the mark. "30%" is red next to a red person; "0%" is green next to a
 * green hat. The first version here coloured the mark and kept every
 * number white, on the argument that the mark carries the verdict and
 * the figure carries the value — which is a decent argument and is not
 * what is on screen.
 *
 * So B is the one that matches. The rest are the same five figures at
 * different settings so the choice is visible rather than described.
 *
 *   A  Round     what shipped: pill radius, mark coloured, figure white
 *   B  Match     the reference: both coloured, 6px radius, solid ground
 *   C  Bare      no plate at all
 *   D  Boxed     a hairline instead of a fill
 *
 * Every variant is shown on three rows: a clean token, a bad one, and a
 * mixed one. A treatment that separates green from red on an all-green
 * row proves nothing — the case that matters is the row where two of
 * the five have gone red and the eye has to find them.
 */

type Variant = 'a' | 'b' | 'c' | 'd';

function PillRow({ i, v }: { i: number; v: Variant }) {
  const p = PILLS[i % PILLS.length];
  const items = [
    ['top10', PILL_MARKS.top10, pillTier('top10', p.top10), 'Top 10 holders', `${p.top10}%`, null],
    ['dev', PILL_MARKS.dev, pillTier('dev', p.dev), 'Dev holding · last moved', `${p.dev}%`, p.devAge],
    ['snipe', PILL_MARKS.snipers, pillTier('snipe', p.snipePct), 'Snipers · wallets and supply', `${p.snipeCount} · ${p.snipePct}%`, null],
    ['ins', PILL_MARKS.insiders, pillTier('insiders', p.insiders), 'Insider holdings', `${p.insiders}%`, null],
    ['bun', PILL_MARKS.bundles, pillTier('bundles', p.bundles), 'Bundled supply', `${p.bundles}%`, null],
  ] as const;
  return (
    <div className="pv-row" data-v={v}>
      {items.map(([key, mark, tier, tip, value, sub]) => (
        <span className="pv-pill" data-tier={tier} data-tip={tip} key={key}>
          <span className="pv-mark">{mark}</span>
          <span className="pv-val">{value}</span>
          {sub ? <span className="pv-sub">{sub}</span> : null}
        </span>
      ))}
    </div>
  );
}

const LABELS: readonly [Variant, string][] = [
  ['a', 'A · Round — mark coloured, figure white'],
  ['b', 'B · Match — both coloured, solid ground'],
  ['c', 'C · Bare — no plate'],
  ['d', 'D · Boxed — hairline instead of fill'],
];

export function PillVariants() {
  /* Clean, bad, mixed. Index 3 is a quiet token, 4 has four of five in
     the red, 2 is the split case where the eye has to hunt. */
  const rows = [3, 4, 2];
  return (
    <div className="pv-sheet">
      {LABELS.map(([v, label]) => (
        <div className="pv-col" key={v}>
          <span className="pv-label">{label}</span>
          {rows.map((i) => (
            <PillRow key={i} i={i} v={v} />
          ))}
        </div>
      ))}
    </div>
  );
}

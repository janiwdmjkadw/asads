import { PILLS, pillTier } from './rowData';

/*
 * ── THE THIRD LINE: WHO HOLDS IT ─────────────────────────────────────
 *
 * Five pills. The top ten holders, the dev, snipers, insiders, bundles.
 *
 * Its own line rather than more marks on the second one, because it
 * answers a different question. Line two is what a token is and where
 * to find it; this is who owns it — the only thing on the row that says
 * whether one person can move the price.
 *
 * ── EACH ONE IS A PLATE, WHERE NOTHING ELSE ON THE ROW IS ────────────
 *
 * The rest of the row is bare marks on the row's own ground. These sit
 * on a plate each, and the plate is doing work: it binds an icon to a
 * figure so five icon-and-number pairs in a line do not read as ten
 * separate things. Without it the eye has to guess which number belongs
 * to which mark, and at this size it guesses wrong.
 *
 * ── TWO COLOURS, NO MIDDLE ───────────────────────────────────────────
 *
 * Green or red, with a threshold per metric — a third colour across
 * five pills at once is a traffic light nobody reads. The whole point
 * of the line is that a bad row goes red at a glance.
 *
 * ── THE WHOLE PILL TAKES THE COLOUR ──────────────────────────────────
 *
 * Mark and figure both. This shipped the other way — mark coloured,
 * figure white — on the argument that the mark carries the verdict and
 * the number carries the value. Reading the reference again, it colours
 * both, and it is right: at 11px a white number beside a red mark reads
 * as a number that has not been judged yet.
 *
 * ── TWO PILLS ARE NOT PERCENTAGES ────────────────────────────────────
 *
 * The dev shows "DS" when it has sold, because at that point there is
 * no percentage left to show and 0% would be a lie by omission — a dev
 * who never held and a dev who dumped are the same number and not the
 * same row.
 *
 * Boost is time, not supply, and it is the only pill here that is not a
 * risk. It takes gold, the value this board already uses for graduating,
 * and it is the only one of the six that is sometimes absent.
 */

/*
 * 13.5px, against 11.5px type beside it.
 *
 * The marks were 10.5 — SMALLER than the figures they label — and a
 * mark that loses to its own number reads as a bullet point rather than
 * as the thing being measured. An icon has to run a little large next
 * to text to sit level with it: the type's weight is spread across
 * several strokes and the mark's is one outline.
 */
const S = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/* Top ten holders: a person with a star. The star is what stops it
   being the holders mark on the line above — that one is two people. */
const Top10 = (
  <svg {...S}>
    <circle cx="9.6" cy="7.6" r="3.6" />
    <path d="M3.4 19.8v-1.2a4.4 4.4 0 0 1 4.4-4.4h3.6a4.4 4.4 0 0 1 4.4 4.4v1.2" />
    <path d="m18.4 3.4 1.5 3.1 3.4.5-2.4 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.4-2.4 3.4-.5z" />
  </svg>
);

/* The dev: a chef's hat, which is what the reference uses. A cook. */
const Dev = (
  <svg {...S}>
    <path d="M12 3.4 15.2 7l4.6.6-2 4.2 1 4.8H5.2l1-4.8-2-4.2L8.8 7z" />
    <path d="M6.2 16.6h11.6v3.2H6.2z" />
  </svg>
);

/* Snipers: a crosshair. Bought in the first block. */
const Snipers = (
  <svg {...S}>
    <circle cx="12" cy="12" r="7.2" />
    <path d="M12 1.8v3.6M12 18.6v3.6M1.8 12h3.6M18.6 12h3.6" />
    <circle cx="12" cy="12" r="1.6" />
  </svg>
);

/* Insiders: a ghost. Holdings that were there before anyone could buy.
   It was a person in a box, which is not what the reference draws. */
const Insiders = (
  <svg {...S}>
    <path d="M4.6 20.4V11a7.4 7.4 0 0 1 14.8 0v9.4l-2.5-1.8-2.4 1.8-2.5-1.8-2.5 1.8-2.4-1.8z" />
    <path d="M9.5 10.4h.02M14.5 10.4h.02" strokeWidth={2.6} />
    <path d="M12 12.4v2" />
  </svg>
);

/*
 * THE DEX SCREENER OWL, traced off the real logo.
 *
 * One mark, two pills: boost in gold and paid in green. They are both
 * Dex Screener facts and drawing them differently would say they came
 * from different places.
 *
 * An earlier version drew this by hand from a 10px crop of a
 * screenshot, which is how you get a shape that is nobody's logo. This
 * is the file.
 *
 * FILLED, where the rest of the line is outlined. It is a brand mark
 * rather than an icon, and its own form is solid — an outlined owl is
 * a different drawing.
 */
const Owl = (
  <svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd">
    <path
      d="M11.31 1.53C11.55 1.53 12.33 1.51 12.69 1.53C13.05 1.55 13.19 1.59 13.47 1.66C13.75 1.72
        14.04 1.79 14.39 1.92C14.74 2.05 15.13 2.20 15.55 2.46C15.98 2.72 16.67 3.29 16.94
        3.48C17.21 3.67 17.09 3.58 17.17 3.6C17.25 3.62 17.32 3.62 17.4 3.61C17.48 3.60 17.47 3.63
        17.64 3.53C17.81 3.43 18.29 3.12 18.43 3.04C18.57 2.96 18.51 2.98 18.49 3.05C18.47 3.11
        18.42 3.26 18.32 3.43C18.22 3.60 18.17 3.73 17.91 4.05C17.65 4.37 17.24 4.91 16.78
        5.36C16.32 5.81 15.64 6.37 15.17 6.74C14.70 7.11 14.25 7.37 13.93 7.56C13.61 7.75 13.39 7.82
        13.24 7.87C13.09 7.92 13.14 7.89 13 7.85C12.86 7.81 12.56 7.67 12.39 7.63C12.22 7.59 12.15
        7.60 12 7.6C11.85 7.60 11.65 7.59 11.46 7.63C11.27 7.67 10.98 7.82 10.84 7.86C10.70 7.90
        10.78 7.93 10.61 7.87C10.44 7.81 10.12 7.66 9.84 7.49C9.56 7.33 9.31 7.18 8.91 6.88C8.51
        6.58 7.82 6.00 7.44 5.66C7.06 5.32 6.85 5.09 6.61 4.82C6.37 4.55 6.16 4.27 5.99 4.05C5.83
        3.83 5.73 3.70 5.62 3.51C5.51 3.31 5.22 2.88 5.32 2.88C5.42 2.88 6.01 3.37 6.21 3.49C6.41
        3.61 6.43 3.58 6.52 3.6C6.61 3.62 6.66 3.63 6.75 3.6C6.84 3.58 6.84 3.61 7.06 3.45C7.28 3.29
        7.73 2.89 8.06 2.67C8.40 2.45 8.77 2.26 9.07 2.12C9.37 1.98 9.48 1.92 9.84 1.82C10.20 1.72
        10.98 1.59 11.23 1.54C11.48 1.49 11.07 1.53 11.31 1.53Z M5.77 5.61C5.82 5.64 5.90 5.65 6.06
        5.83C6.22 6.01 6.61 6.49 6.72 6.67C6.83 6.85 6.77 6.73 6.73 6.9C6.69 7.07 6.53 7.47 6.48
        7.68C6.43 7.89 6.44 7.97 6.44 8.14C6.45 8.31 6.46 8.50 6.51 8.68C6.56 8.86 6.64 9.05 6.75
        9.22C6.86 9.39 7.00 9.54 7.14 9.68C7.28 9.82 7.42 9.95 7.6 10.06C7.78 10.17 8.00 10.27 8.22
        10.34C8.45 10.41 8.81 10.45 8.95 10.51C9.09 10.57 9.06 10.58 9.07 10.7C9.08 10.82 9.06 11.09
        9.03 11.22C9.00 11.35 9.20 11.27 8.88 11.49C8.57 11.71 7.46 12.35 7.14 12.55C6.82 12.76 7.02
        12.66 6.99 12.72C6.96 12.78 6.95 12.84 6.99 12.9C7.03 12.96 6.90 12.91 7.21 13.1C7.52 13.29
        8.49 13.82 8.83 14.05C9.17 14.28 9.14 14.32 9.27 14.47C9.40 14.62 9.46 14.71 9.6 14.93C9.73
        15.15 9.93 15.47 10.08 15.78C10.23 16.09 10.23 15.97 10.51 16.79C10.79 17.61 11.53 20.03
        11.75 20.72C11.97 21.41 11.80 20.87 11.84 20.92C11.88 20.97 11.93 21.01 11.97 21.01C12.01
        21.01 12.05 20.97 12.09 20.92C12.13 20.87 12.04 21.19 12.18 20.72C12.32 20.25 12.74 18.78
        12.96 18.1C13.18 17.42 13.34 17.02 13.49 16.63C13.64 16.24 13.73 16.04 13.85 15.78C13.97
        15.52 14.10 15.31 14.23 15.09C14.37 14.87 14.53 14.63 14.66 14.47C14.79 14.31 14.67 14.35
        15.01 14.12C15.35 13.89 16.39 13.31 16.71 13.11C17.03 12.91 16.89 12.96 16.93 12.9C16.97
        12.84 16.95 12.78 16.93 12.73C16.91 12.68 17.10 12.79 16.78 12.58C16.46 12.37 15.32 11.71 15
        11.48C14.68 11.25 14.91 11.35 14.88 11.22C14.85 11.09 14.82 10.82 14.84 10.7C14.86 10.58
        14.83 10.57 14.97 10.51C15.12 10.45 15.50 10.42 15.71 10.35C15.92 10.28 16.07 10.21 16.25
        10.11C16.43 10.01 16.64 9.85 16.78 9.73C16.92 9.61 16.99 9.53 17.09 9.38C17.19 9.23 17.30
        9.02 17.36 8.83C17.42 8.64 17.46 8.43 17.47 8.22C17.47 8.02 17.44 7.82 17.39 7.6C17.34 7.38
        17.19 7.06 17.16 6.91C17.13 6.76 17.05 6.90 17.19 6.7C17.33 6.50 17.83 5.88 17.99 5.7C18.15
        5.52 18.11 5.62 18.15 5.61C18.19 5.60 18.21 5.60 18.25 5.65C18.29 5.70 18.33 5.73 18.41
        5.9C18.49 6.07 18.61 6.35 18.71 6.67C18.81 6.99 18.94 7.43 19 7.83C19.06 8.23 19.09 8.63
        19.09 9.07C19.09 9.51 19.03 10.08 19.03 10.46C19.03 10.85 19.09 11.01 19.1 11.38C19.11 11.75
        19.07 12.16 19.11 12.69C19.15 13.22 19.24 13.97 19.35 14.55C19.46 15.13 19.55 15.53 19.75
        16.17C19.95 16.82 20.49 18.08 20.58 18.42C20.66 18.76 20.56 18.45 20.26 18.22C19.96 17.99
        19.08 17.26 18.79 17.04C18.50 16.82 18.57 16.91 18.5 16.89C18.43 16.87 18.41 16.88 18.36
        16.9C18.31 16.92 18.44 16.67 18.2 17.04C17.96 17.41 17.18 18.71 16.92 19.1C16.66 19.49 16.76
        19.34 16.66 19.35C16.56 19.37 16.57 19.39 16.32 19.19C16.07 18.99 15.40 18.32 15.17
        18.13C14.94 17.93 15.00 18.04 14.94 18.02C14.88 18.00 14.87 17.99 14.8 18.04C14.73 18.09
        14.96 17.65 14.52 18.33C14.08 19.01 12.62 21.45 12.19 22.11C11.76 22.77 12.02 22.32 11.94
        22.32C11.86 22.32 12.12 22.77 11.69 22.11C11.26 21.45 9.81 19.01 9.38 18.33C8.95 17.65 9.18
        18.08 9.11 18.03C9.04 17.98 9.04 18.00 8.98 18.01C8.92 18.02 9.00 17.91 8.76 18.11C8.52
        18.31 7.77 19.03 7.52 19.24C7.27 19.45 7.34 19.37 7.25 19.35C7.16 19.33 7.23 19.48 6.98
        19.1C6.73 18.73 5.97 17.46 5.73 17.1C5.49 16.74 5.61 16.96 5.56 16.93C5.51 16.90 5.51 16.88
        5.43 16.9C5.34 16.92 5.39 16.83 5.05 17.07C4.71 17.31 3.53 18.52 3.4 18.34C3.27 18.16 4.03
        16.71 4.24 16.01C4.45 15.31 4.55 14.74 4.65 14.16C4.75 13.58 4.79 13.38 4.82 12.54C4.85
        11.70 4.80 9.91 4.82 9.14C4.84 8.37 4.85 8.33 4.92 7.91C4.99 7.49 5.14 6.93 5.24 6.6C5.34
        6.26 5.44 6.06 5.52 5.9C5.60 5.74 5.69 5.68 5.73 5.63C5.77 5.58 5.71 5.58 5.77 5.61Z M7.9
        7.8C7.95 7.80 7.86 7.68 8.15 7.85C8.45 8.02 9.39 8.63 9.67 8.81C9.95 8.99 9.79 8.90 9.81
        8.93C9.83 8.96 9.86 8.97 9.81 9C9.76 9.03 9.65 9.09 9.53 9.12C9.41 9.14 9.22 9.15 9.07
        9.15C8.92 9.15 8.73 9.13 8.6 9.1C8.47 9.07 8.39 9.04 8.29 8.98C8.19 8.92 8.09 8.84 8.01
        8.75C7.93 8.66 7.87 8.56 7.83 8.45C7.79 8.33 7.78 8.17 7.78 8.06C7.79 7.96 7.84 7.86 7.86
        7.82C7.88 7.78 7.85 7.79 7.9 7.8Z M15.98 7.8C16.02 7.82 16.11 7.85 16.13 7.93C16.15 8.01
        16.16 8.17 16.13 8.29C16.10 8.41 16.03 8.57 15.96 8.67C15.89 8.77 15.79 8.85 15.7 8.91C15.61
        8.97 15.52 9.02 15.4 9.06C15.29 9.10 15.18 9.12 15.01 9.13C14.84 9.14 14.54 9.14 14.39
        9.12C14.24 9.10 14.16 9.04 14.12 9.01C14.07 8.98 14.10 8.97 14.12 8.94C14.14 8.91 13.95 9.01
        14.25 8.82C14.55 8.63 15.63 7.98 15.92 7.81C16.21 7.64 15.95 7.78 15.98 7.8Z M11.77
        8.88C11.85 8.87 12.04 8.85 12.15 8.87C12.27 8.89 12.35 8.93 12.46 8.99C12.57 9.05 12.70 9.15
        12.81 9.25C12.92 9.35 13.02 9.49 13.11 9.61C13.20 9.73 13.27 9.86 13.32 9.99C13.38 10.12
        13.39 10.05 13.44 10.38C13.49 10.71 13.55 11.69 13.61 12C13.67 12.31 13.68 12.15 13.8
        12.26C13.93 12.37 14.25 12.56 14.36 12.65C14.47 12.74 14.45 12.74 14.45 12.79C14.45 12.84
        14.52 12.79 14.36 12.95C14.20 13.11 13.71 13.53 13.49 13.78C13.27 14.03 13.15 14.24 13.01
        14.47C12.87 14.70 12.81 14.77 12.65 15.17C12.49 15.57 12.17 16.55 12.05 16.85C11.93 17.16
        11.98 17.00 11.95 17C11.92 17.00 11.95 17.11 11.85 16.85C11.75 16.60 11.53 15.87 11.37
        15.47C11.21 15.07 11.06 14.78 10.88 14.47C10.70 14.16 10.51 13.89 10.27 13.62C10.03 13.35
        9.56 13.00 9.44 12.84C9.32 12.68 9.44 12.76 9.55 12.66C9.67 12.56 10.00 12.38 10.13
        12.27C10.26 12.16 10.26 12.28 10.31 12C10.36 11.72 10.36 10.98 10.43 10.61C10.50 10.24 10.61
        9.99 10.73 9.76C10.85 9.53 11.00 9.38 11.16 9.24C11.32 9.10 11.59 8.97 11.69 8.91C11.79 8.85
        11.69 8.89 11.77 8.88Z"
    />
  </svg>
);

/* Bundles: stacked layers. One buy wearing many wallets. */
const Bundles = (
  <svg {...S}>
    <path d="m12 2.8 9 4.6-9 4.6-9-4.6z" />
    <path d="m3 12.4 9 4.6 9-4.6" />
    <path d="m3 17.2 9 4.6 9-4.6" />
  </svg>
);

/*
 * Exported so the variants sheet under the column draws the SAME marks.
 * Comparing four pill treatments is only a comparison of treatment if
 * the thing inside them is identical.
 */
export const PILL_MARKS = { top10: Top10, dev: Dev, snipers: Snipers, insiders: Insiders, bundles: Bundles, boost: Owl };

export function Pills({ i }: { i: number }) {
  const p = PILLS[i % PILLS.length];
  const pill = (
    key: string,
    mark: React.ReactElement,
    tier: 'ok' | 'bad',
    tip: string,
    body: React.ReactNode,
  ) => (
    <span className="arc-pill" data-tier={tier} data-tip={tip} key={key}>
      <span className="arc-pill-mark">{mark}</span>
      {body}
    </span>
  );
  return (
    <div className="arc-pills">
      {pill('t', Top10, pillTier('top10', p.top10), 'Top 10 holders', <>{p.top10}%</>)}

      {/*
        * The dev. "DS" once it has sold, a percentage while it holds,
        * and either way how long since the position last moved — a dev
        * holding 40% for eight minutes and one holding it for five days
        * are not the same row.
        *
        * Sold is NEUTRAL, not green. There is no dev overhang left,
        * which is good, and the dev took money off the table, which is
        * not — the pill states it and declines to score it.
        */}
      {p.devSold
        ? (
          <span className="arc-pill" data-tier="none" data-tip="Dev sold · last moved" key="d">
            <span className="arc-pill-mark">{Dev}</span>
            DS
            <span className="arc-pill-sub">{p.devAge}</span>
          </span>
        )
        : pill('d', Dev, pillTier('dev', p.dev), 'Dev holding · last moved', (
          <>
            {p.dev}%
            <span className="arc-pill-sub">{p.devAge}</span>
          </>
        ))}

      {/* Count AND percentage. Forty snipers holding 2% is a crowd;
          two holding 40% is a problem, and one figure alone cannot
          tell those apart. */}
      {pill('s', Snipers, pillTier('snipe', p.snipePct), 'Snipers · wallets and supply', (
        <>
          {p.snipeCount}
          <span className="arc-pill-dot">·</span>
          {p.snipePct}%
        </>
      ))}

      {pill('i', Insiders, pillTier('insiders', p.insiders), 'Insider holdings', <>{p.insiders}%</>)}
      {pill('b', Bundles, pillTier('bundles', p.bundles), 'Bundled supply', <>{p.bundles}%</>)}

      {/*
        * Dex Paid: the listing has been paid for. Green, because unlike
        * boost it is not a purchase of attention — it is the one thing
        * on this line a rug is least likely to have bothered with.
        *
        * Same owl as boost, in a different colour. Two Dex Screener
        * facts drawn as two different marks would say they came from
        * two different places — and the colour is the only thing that
        * has to tell them apart, because the word is gone.
        *
        * No "Paid" and no "Boost" written out. Seven pills with both
        * words measured 458px against 325 of line, and the tooltip says
        * which is which — the owl and a duration is the reading.
        */}
      {p.paid ? (
        <span className="arc-pill is-dex" data-tier="ok" data-tip="Dex Screener listing paid" key="p">
          <span className="arc-pill-mark">{Owl}</span>
          <span className="arc-pill-sub">{p.paid}</span>
        </span>
      ) : null}

      {/*
        * Boost sits LAST and only when there is one. It is the only
        * pill on this line that is not a risk, so putting it among the
        * five that are would make the line's colour mean two things.
        */}
      {p.boost ? (
        <span className="arc-pill is-dex" data-tier="boost" data-tip="Boosted · time remaining" key="z">
          <span className="arc-pill-mark">{Owl}</span>
          <span className="arc-pill-sub">{p.boost}h</span>
        </span>
      ) : null}
    </div>
  );
}

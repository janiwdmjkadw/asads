/**
 * Slice "Portfolio Spot tab": the colours the page spends.
 *
 * Two users, one palette: the three-way split's stacked bar, and the
 * share bar on every holdings row. They sit ten pixels apart, so a
 * token drawn in a colour the split does not use would look like a
 * fourth category.
 *
 * ── WHAT IS NOT IN HERE ──────────────────────────────────────────────
 *
 * Green and red. Those mean gain and loss everywhere else on this page,
 * including the 24h column at the end of the very rows these bars are
 * on, and a token that happened to be green would read as up.
 *
 * Everything here carries real chroma. That was the rule on black, and
 * it still is — but the SETTING moved. These were mixed to glow on a
 * dark pane: on paper the same hues are highlighter, and the yellow in
 * particular disappeared into the page at 3px. Each one is deepened to
 * the point where a 3px bar holds against white, keeping the hue
 * spacing that lets seven categories be told apart.
 */

/** The split, in order: SOL, stablecoins, everything else. */
export const CUT_INK = ['var(--d-cutcolors-1, #4f6ae0)', 'var(--d-cutcolors-2, #0e9e90)', 'var(--d-cutcolors-3, #d98518)'] as const;

/**
 * The holdings. The split's three first — so the biggest positions
 * usually echo the bar above them — then four more that are far enough
 * apart in hue to be told apart at 3px.
 */
const HOLDING_INK = [
  'var(--d-cutcolors-4, #4f6ae0)',
  'var(--d-cutcolors-5, #0e9e90)',
  'var(--d-cutcolors-6, #d98518)',
  'var(--d-cutcolors-7, #9450e0)',
  'var(--d-cutcolors-8, #1f8fc4)',
  'var(--d-cutcolors-9, #a8921a)',
  'var(--d-cutcolors-10, #d9673a)',
] as const;

/**
 * A token's colour, from its mint.
 *
 * Keyed on the MINT rather than on the row's index, because the tape
 * sorts by value and a filter can reorder it — an index would repaint
 * every bar the moment a price moved, which makes the colour look like
 * it means something it does not. Hashed, so a token keeps its colour
 * for as long as you hold it.
 */
export function inkForMint(mint: string): string {
  let hash = 0;
  for (let i = 0; i < mint.length; i += 1) hash = (hash * 31 + mint.charCodeAt(i)) | 0;
  const at = ((hash % HOLDING_INK.length) + HOLDING_INK.length) % HOLDING_INK.length;
  return HOLDING_INK[at]!;
}

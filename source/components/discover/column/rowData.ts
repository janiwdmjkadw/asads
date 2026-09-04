/*
 * Server safe. NO `'use client'` — `/whatever` is a server component and
 * maps over this.
 *
 * THE TOKEN ART BLOCK, copied, on every launchpad.
 *
 *   · the picture
 *   · a 1px ring in the LAUNCHPAD's colour, sitting 2px off the picture
 *   · the launchpad's own logo on the bottom right corner
 *   · the mint under it, first three and last four
 */

export interface Pad {
  readonly key: string;
  readonly label: string;
  readonly logo: string;
  readonly colour: string;
  /**
   * The artwork carries its own background rather than being a mark on
   * transparency.
   *
   * Measured, not guessed: coverage. A real mark covers 20% to 60% of
   * its canvas; these carry a background and cover 79% to 100%.
   *
   * Bonk is one of them and cannot be rescued by processing. Mapping
   * its artwork shows a filled #ff5e1f circle with a small light emblem
   * in the middle: the orange IS the logo, not a plate behind it. Two
   * passes tried to remove it — the outer disc, then every orange shade
   * — and the second left only the emblem's white highlights, because
   * the mark itself is orange.
   *
   * The Bonk brand mark in the filters chip is a different asset from
   * this app icon, and it is not in `public/assets/launchpads`. Until it
   * is, this renders as the circle it actually is. They are
   * app icons, so they FILL the badge's face and the circle crops them,
   * exactly as an app icon is meant to be shown. Insetting them left a
   * clipped square floating in a ring of ground, which is what looked
   * broken.
   */
  readonly solid?: boolean;
}

const L = '/assets/launchpads';

/*
 * ── THE RING IS THE LOGO'S OWN COLOUR ────────────────────────────────
 *
 * Every value here is the dominant saturated colour of that launchpad's
 * artwork, read off the file in `public/assets/launchpads`. A pad's ring
 * and its badge match because they come from the same image.
 *
 * An earlier pass spread these around the wheel instead, so that no two
 * rings were within a glance of each other. That reads better as a
 * palette and is wrong as a signal: the ring is there to say WHICH pad,
 * and someone who knows Bags knows it as green. Being told it is white
 * is worse than four greens you have to look twice at.
 *
 * So Bags, Believe, Stonkfun and Pumpfun are all green, because all four
 * of them are. The badge sitting on the corner is what separates them.
 *
 * Two are set by hand rather than sampled:
 *
 *   · Dynamic BC   the sampled orange was four values off Bonk's, and
 *                  red both fixes that and is what was asked for
 *   · Jupiter, LaunchLab, Heaven and Boop   their artwork shipped as
 *                  `.ico`, which sharp cannot open, so these four were
 *                  never sampled. The files are PNGs now, but the
 *                  colours below stay hand set until someone looks at
 *                  them against the rest
 */
export const PADS: readonly Pad[] = [
  { key: 'pumpfun', label: 'Pumpfun', logo: `${L}/pumpfun.png`, colour: '#55d491' },
  { key: 'bonk', solid: true, label: 'Bonk', logo: `${L}/bonk.png`, colour: '#fe5e1f' },
  { key: 'bags', label: 'Bags', logo: `${L}/bags.png`, colour: '#0edd24' },
  { key: 'believe', label: 'Believe', logo: `${L}/believe.png`, colour: '#21d65a' },
  { key: 'moonit', label: 'Moonit', logo: `${L}/moonit.png`, colour: '#defe18' },
  { key: 'moonshot', solid: true, label: 'Moonshot', logo: `${L}/moonshot.png`, colour: '#fe77fe' },
  { key: 'stonkfun', label: 'Stonkfun', logo: `${L}/stonkfun.png`, colour: '#68aac1' },
  { key: 'dynamicbc', label: 'Dynamic BC', logo: `${L}/dynamicbc.png`, colour: '#ef4444' },
  { key: 'trench', label: 'Tren.ch', logo: `${L}/trench.png`, colour: '#b57d50' },
  { key: 'printr', solid: true, label: 'PRINTR', logo: `${L}/printr.png`, colour: '#c0479f' },
  { key: 'jupiter', label: 'Jupiter', logo: `${L}/jupiter.png`, colour: '#c7f284' },
  { key: 'launchlab', label: 'LaunchLab', logo: `${L}/launchlab.png`, colour: '#8c65f7' },
  { key: 'heaven', label: 'Heaven', logo: `${L}/heaven.svg`, colour: '#fb7185' },
  { key: 'boop', label: 'Boop', logo: `${L}/boop.png`, colour: '#7dd3fc' },
];

/*
 * The graduated colour.
 *
 * A graduated token is off its launchpad's curve and on an open market,
 * so the pad is history rather than status. Gold says that, and it says
 * it the same way whichever curve the token came off — which is the
 * point: the ring stops naming a launchpad and starts naming a state.
 */
export const GRADUATED = '#ffc247';

/* Four short mints, cycled, so a row is not fifteen copies of one
   string. Printed the way the board prints them: first three, then the
   last four. */
export const MINTS = ['Av7…pump', 'GJS…bonk', 'Dg8…i4wH', 'H4t…moon'] as const;

/*
 * Volume and market cap, per pad.
 *
 * `mcValue` is the raw number, and the display string is derived from it
 * rather than typed alongside it — a hand written pair drifts the first
 * time one of them is edited, and here the number decides a COLOUR, so a
 * drift would show as a figure wearing the wrong tier.
 *
 * Spread deliberately across the tiers: a few hundred dollars up to
 * millions, so every band is on the sheet and the widest string the
 * field will ever hold is too.
 */
export interface Money {
  readonly vol: string;
  readonly mcValue: number;
}

export const MONEY: readonly Money[] = [
  { vol: '$179K', mcValue: 35_300 },
  { vol: '$412K', mcValue: 70_900 },
  { vol: '$4.1M', mcValue: 2_560_000 },
  { vol: '$240K', mcValue: 96_000 },
  { vol: '$61K', mcValue: 18_400 },
  { vol: '$402K', mcValue: 1_190_000 },
  { vol: '$0.8', mcValue: 419 },
  { vol: '$1.4M', mcValue: 880_000 },
  { vol: '$27K', mcValue: 12_900 },
  { vol: '$96K', mcValue: 44_200 },
  { vol: '$5.9M', mcValue: 3_400_000 },
  { vol: '$310K', mcValue: 155_000 },
  { vol: '$88K', mcValue: 8_700 },
  { vol: '$2.2M', mcValue: 1_050_000 },
];

export function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  if (n >= 1) return `$${Math.round(n)}`;
  return `$${n.toFixed(1)}`;
}

/*
 * ── THE MARKET CAP TIER ──────────────────────────────────────────────
 *
 *   under 20K    blue
 *   20K to 100K  gold
 *   over 100K    green
 *
 * The thresholds live here rather than in the stylesheet so the number
 * and the band that reads it cannot disagree.
 */
export function mcTier(n: number): 'low' | 'mid' | 'high' {
  if (n >= 100_000) return 'high';
  if (n >= 20_000) return 'mid';
  return 'low';
}

/*
 * Age in SECONDS. The printed string and the colour band are both
 * derived from it rather than typed beside it — two hand written values
 * drift the moment one is edited, and here the number decides a colour,
 * so a drift would show as a figure wearing the wrong band.
 *
 * Spread across every band, and deliberately sat right on the edges:
 * 1800 and 3600 are the two thresholds exactly, so the sheet shows which
 * side of the line they fall on rather than leaving it to be guessed.
 */
export const AGES: readonly number[] = [
  1, 2_460, 10_800, 720, 360, 172_800, 18, 14_400,
  540, 86_400, 1_209_600, 1_800, 3_600, 604_800,
];

/* One unit, no decimals, the biggest that fits. */
export function age(seconds: number): string {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

/*
 * ── THE AGE BAND ─────────────────────────────────────────────────────
 *
 *   under 30 minutes   green
 *   30 to 60 minutes   orange
 *   over an hour       red
 *
 * The boundaries are inclusive upward: exactly 30 minutes is orange and
 * exactly an hour is red, so a token never sits in two bands and the
 * fixtures on those two values show which way it goes.
 */
export function ageTier(seconds: number): 'fresh' | 'aging' | 'old' {
  if (seconds >= 3_600) return 'old';
  if (seconds >= 1_800) return 'aging';
  return 'fresh';
}

/*
 * The leaf, per row.
 *
 * Three states, and they cycle across the sheet so all three are on
 * screen at once rather than one being the only one anyone ever sees.
 *
 * WHAT IT MEANS IS NOT SET. The reference has a red, an orange and a
 * green one and nothing on the row says which is which, so the values
 * below are a state name and a colour and nothing more. Point it at a
 * real field and the three names change; the drawing does not.
 */
export const LEAVES: readonly ('good' | 'warn' | 'bad')[] = [
  'good', 'warn', 'bad', 'good', 'bad', 'good', 'warn',
  'bad', 'good', 'good', 'warn', 'bad', 'good', 'warn',
];

/*
 * ── PARKED, NOT DELETED ──────────────────────────────────────────────
 *
 * The holders field was built and then taken off the row. Everything it
 * needs is still here — the counts, the formatter, and `.arc-stat` in
 * the stylesheet — so putting it back is one block of JSX rather than a
 * rebuild. Nothing renders it today.
 *
 * Holders, per row. Raw counts: the printed string is derived, so a
 * four figure count and a six figure one cannot disagree about how they
 * abbreviate.
 *
 * Spread from a single holder to tens of thousands, so the field is
 * judged on `1` and on `24.6K` rather than on a comfortable middle.
 */
export const HOLDERS: readonly number[] = [
  1, 324, 8412, 540, 74, 3105, 12, 1806,
  46, 210, 24_600, 968, 137, 5290,
];

/* Thousands get one decimal, and it is dropped when it is a zero, so
   `1.2K` and `24.6K` sit next to `968` without a trailing `.0`. */
export function count(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/* A ticker and a full name per pad, so the sheet is not one string
   repeated fourteen times. Long names are deliberate: the field has to
   survive them. */
export const NAMES: readonly { readonly ticker: string; readonly name: string }[] = [
  { ticker: 'FLUXAI', name: 'Flux AI' },
  { ticker: 'TUNDLA', name: 'Tundra Labs' },
  { ticker: 'BAGSY', name: 'Bagsy' },
  { ticker: 'BELVE', name: 'Believe Protocol' },
  { ticker: 'MOONIT', name: 'Moon It' },
  { ticker: 'VERTCO', name: 'Vertex Coin' },
  { ticker: 'STONKS', name: 'Stonks Forever' },
  { ticker: 'DYNBC', name: 'Dynamic Bonding Curve' },
  { ticker: 'TRENCH', name: 'Trench Warfare' },
  { ticker: 'PRINTR', name: 'Printr' },
  { ticker: 'JUPAG', name: 'Jupiter Aggregator' },
  { ticker: 'LLAB', name: 'Launch Lab' },
  { ticker: 'HEAVN', name: 'Heaven' },
  { ticker: 'BOOPY', name: 'Boop' },
];


/*
 * FEES PAID, IN SOL.
 *
 * Not a dollar figure. Fees are paid in the chain's own unit and every
 * terminal shows them that way, so converting to USD here would be
 * inventing an exchange rate on top of inventing the number.
 *
 * Small values, and they stay small: this is what the token has PAID
 * out, not what it is worth. A row whose fees look like its market cap
 * is a row where one of the two numbers is wrong.
 */
export const FEES = [
  0.42, 1.86, 0.09, 12.4, 3.71, 0.02, 6.05, 0.88, 24.3, 0.15, 2.44, 9.6,
];

/*
 * Two decimals under ten, one above. The column is read down, and a
 * fixed decimal count keeps the digits in the same place from row to
 * row — with tabular figures that is what makes the values comparable
 * at a glance instead of needing to be read.
 */
export function fee(sol: number): string {
  return sol >= 10 ? sol.toFixed(1) : sol.toFixed(2);
}


/*
 * ── THE FEE AUTHORITY ────────────────────────────────────────────────
 *
 * Who collects a token's fees, whether that arrangement is locked, and
 * how it is split.
 *
 * Charity and fee sharing are the SAME structure. A charity coin is not
 * a different mechanism — it is a fee share whose recipient happens to
 * be a charity — so both marks open the same panel and the only thing
 * that differs is who is in the shares list. Modelling them separately
 * would have produced two panels that must be kept in step forever.
 *
 * `locked` is the fact worth showing. A split that can be changed after
 * launch is a promise, not a term, and the panel exists to tell those
 * two apart.
 */
export interface FeeShare {
  readonly name: string;
  readonly address: string;
  readonly sol: number;
  readonly pct: number;
  /** A charity recipient rather than a person. */
  readonly org?: boolean;
}

export interface FeeAuthority {
  readonly authority: string;
  readonly locked: boolean;
  readonly shares: readonly FeeShare[];
}

/*
 * EVERY ONE OF THESE IS A SPLIT.
 *
 * This list is what the fee-sharing mark opens, and a fee share with a
 * single recipient at 100% is not a share — it is just a fee authority.
 * One of these had exactly that and the panel it opened said nothing
 * the mark had not already said.
 *
 * Two and three way, with uneven numbers: an even split reads as a
 * placeholder, and the thing worth seeing here is that the shares do
 * not have to be equal.
 */
const PEOPLE: readonly FeeAuthority[] = [
  { authority: 'Cjpm…71Z3', locked: true, shares: [
    { name: 'andrea-es', address: 'HskJ…Whyx', sol: 266.4, pct: 70 },
    { name: 'lowkeyy', address: 'Rm7d…Kp3a', sol: 114.2, pct: 30 } ] },
  { authority: '7Ftq…d2Ka', locked: true, shares: [
    { name: 'moonpiper', address: 'B4mv…Lq81', sol: 41.8, pct: 60 },
    { name: 'kbz.sol', address: '9Twn…Xr4E', sol: 27.9, pct: 40 } ] },
  { authority: 'Ry8w…mN6p', locked: false, shares: [
    { name: 'devwallet', address: 'Fq2s…8dVc', sol: 3.05, pct: 50 },
    { name: 'ops.sol', address: 'Hn4k…Ww22', sol: 3.05, pct: 30 },
    { name: 'treasury', address: 'Ax1r…Kf6m', sol: 1.83, pct: 20 } ] },
];

const ORGS: readonly FeeAuthority[] = [
  { authority: 'JDQK…rSrT', locked: true, shares: [
    { name: 'Direct Relief', address: 'HskJ…Whyx', sol: 512.7, pct: 100, org: true } ] },
  { authority: 'Mv3d…q9Lz', locked: true, shares: [
    { name: 'GiveDirectly', address: 'C7pk…2Ynd', sol: 88.2, pct: 75, org: true },
    { name: 'treasury', address: 'Ax1r…Kf6m', sol: 29.4, pct: 25 } ] },
];

export function feeAuthority(i: number, org: boolean): FeeAuthority {
  const set = org ? ORGS : PEOPLE;
  return set[i % set.length];
}

/* SOL amounts, one decimal place above ten and two below, the same rule
   the fees figure on the row uses so the two agree when read together. */
export function sol(n: number): string {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}


/*
 * ── THE THIRD LINE ───────────────────────────────────────────────────
 *
 * Five figures about who holds the supply: the top ten, the dev,
 * snipers, insiders, bundles.
 *
 * They are a separate LINE and not more marks on the second one
 * because they are a different question. Line two is what a token is
 * and where to find it; line three is who owns it, which is the only
 * thing on this row that says whether the price can be moved by one
 * person.
 *
 * ── THE THRESHOLDS ───────────────────────────────────────────────────
 *
 * Read off the reference rather than invented, then checked against
 * every example in it:
 *
 *   top ten   red at 15   21, 30, 57 and 89 are all red there, and 21
 *                         is what pins it: the first reading put this
 *                         at 25 and 21% came out green
 *   dev       red at 50   0 and 42 are both green, so the line sits
 *                         above 42 — a dev holding half is the alarm,
 *                         not a dev holding some
 *   snipers   red at 5    0 green, 14 red
 *   insiders  red at 20   0 green, 56 red
 *   bundles   red at 20   1 and 2 are green
 *
 * Two tiers and no middle. A third colour on five pills at once is a
 * traffic light nobody reads — the point of this line is that a bad row
 * turns red at a glance.
 */
export interface Pills {
  readonly top10: number;
  readonly dev: number;
  /** How long ago the dev's position last moved. */
  readonly devAge: string;
  readonly snipeCount: number;
  readonly snipePct: number;
  readonly insiders: number;
  readonly bundles: number;
  /*
   * The dev SOLD. When this is true the pill shows "DS" instead of a
   * percentage, because there is no percentage left to show — a dev at
   * 0% who never held and a dev at 0% who dumped are the same number
   * and not the same row.
   */
  readonly devSold?: boolean;
  /** Hours of paid boost left, or absent for a token with none. */
  readonly boost?: number;
  /** How long ago the Dex Screener listing was paid for, if it was. */
  readonly paid?: string;
}

export const PILLS: readonly Pills[] = [
  { top10: 21, dev: 0,  devAge: '7h', snipeCount: 1,  snipePct: 0,  insiders: 4,  bundles: 5, devSold: true, paid: '1d', boost: 6 },
  { top10: 89, dev: 0,  devAge: '3d', snipeCount: 0,  snipePct: 0,  insiders: 0,  bundles: 1 },
  { top10: 57, dev: 42, devAge: '8m', snipeCount: 14, snipePct: 14, insiders: 56, bundles: 4 },
  { top10: 12, dev: 3,  devAge: '2h', snipeCount: 2,  snipePct: 1,  insiders: 4,  bundles: 0, paid: '4h', boost: 22 },
  { top10: 41, dev: 61, devAge: '11m', snipeCount: 7, snipePct: 6,  insiders: 22, bundles: 31 },
  { top10: 18, dev: 0,  devAge: '5d', snipeCount: 1,  snipePct: 0,  insiders: 9,  bundles: 3, devSold: true, paid: '2d' },
];

const LIMIT = { top10: 15, dev: 50, snipe: 5, insiders: 20, bundles: 20 };

export function pillTier(kind: keyof typeof LIMIT, value: number): 'ok' | 'bad' {
  return value >= LIMIT[kind] ? 'bad' : 'ok';
}

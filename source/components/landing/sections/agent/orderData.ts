/**
 * The conditional order the Agent band shows, as data.
 *
 * It used to be a 550×805 PNG (`/landing/img/conditional-card.png`), which
 * meant it could not follow the palette, could not be read by a screen
 * reader beyond one line of alt text, cost ~83KB, and went soft on a
 * retina display. Everything here is transcribed from that PNG — same
 * legs, same conditions, same numbers, same icons.
 *
 * The PNG is still in `public/landing/img/` and is now unreferenced.
 */

/** Which glyph leads a condition row. Drawn in OrderCard, not imported. */
export type ConditionIcon = 'trend' | 'link' | 'clock';

/* A condition is a sequence of fragments. Plain strings are text; `value`
   sets a number with its unit smaller after it; `chip` sets a bordered
   cross-reference to another leg.

   The chip is a FRAGMENT rather than a flag on the condition, because the
   PNG puts it in a different place in each row it appears in — after
   "After" in one, and ahead of the whole sentence in the other. A flag can
   only ever put it in one place, which is how it ended up reading "Price
   falls Leg 1 20% from peak". */
export type Fragment = string | { value: string; unit?: string } | { chip: string };

export interface Condition {
  icon: ConditionIcon;
  text: readonly Fragment[];
  /**
   * Where the condition stands RIGHT NOW, against what it is waiting for.
   *
   * The card was a list of targets with nothing said about how close any
   * of them was, which is a picture of a form rather than of something
   * running. A condition that reads `Market cap ≥ $5K` and nothing else
   * could have been written a second ago or a week ago.
   */
  now?: string;
  /**
   * How far along, 0 to 1, for the conditions where "far along" means
   * anything. A time window and a market cap climbing toward a number
   * both have a fraction; "after leg one fills" does not, and it does not
   * get a track.
   */
  progress?: number;
  /** True when the condition is already satisfied. */
  met?: boolean;
}

export interface Leg {
  name: string;
  /** Where the leg is in its lifecycle: what the badge says. */
  state: string;
  when: Condition;
  /** Leg 2 only: any one of these also satisfies it. */
  either?: readonly Condition[];
  side: 'buy' | 'sell';
  size: { value: string; unit?: string };
  /** The token being traded. `mark` names the art; see OrderCard. */
  asset: { symbol: string; mark: 'tau' };
  /** Leg 1 only: what is being spent. */
  quote?: { symbol: string; mark: 'sol' };
  /**
   * The other side of the trade, as a figure.
   *
   * The Then row used to read `Buy 5 ◎ — TAU ⓣ`: a side chip, a bare
   * number, the Solana mark, an em dash, the symbol and a lettermark, six
   * objects in a line, with a dash in the middle that the reader has to
   * decode as "becomes". What a person actually wants off that row is
   * what it costs, and that was the one thing missing.
   */
  consideration: { label: string; value: string; mark?: 'sol' };
  /** What the leg's badge says once the order has been approved. */
  armedState: string;
}

/* Typed as `readonly Leg[]` rather than `as const`: a const assertion
   narrows each entry to its own literal shape, so leg 1 — which has no
   `either` — ends up with a type that does not admit the property at all,
   and every reader has to narrow before touching it. */
const LEGS: readonly Leg[] = [
  {
    name: 'Leg 1',
    state: 'Arms on approval',
    when: {
      icon: 'trend',
      text: ['Market cap ≥ ', { value: '$5', unit: 'K' }],
      now: '$4,180',
      progress: 0.836,
    },
    side: 'buy',
    size: { value: '5' },
    asset: { symbol: 'TAU', mark: 'tau' },
    quote: { symbol: 'SOL', mark: 'sol' },
    consideration: { label: 'spends', value: '≈ 0.104 SOL', mark: 'sol' },
    armedState: 'Watching',
  },
  {
    name: 'Leg 2',
    state: 'Queued',
    when: { icon: 'link', text: ['After ', { chip: 'Leg 1' }, ' fills'], now: 'not yet' },
    either: [
      {
        icon: 'clock',
        text: ['After ', { value: '24h' }, ' from arming'],
        now: '23h 41m left',
        progress: 0.016,
      },
      {
        icon: 'trend',
        text: [{ chip: 'Leg 1' }, 'Price falls ', { value: '20', unit: '%' }, ' from peak'],
        now: 'down 4.1%',
        progress: 0.205,
      },
    ],
    side: 'sell',
    size: { value: '100', unit: '%' },
    asset: { symbol: 'TAU', mark: 'tau' },
    /* `returns at market` was a label with no figure under it, sitting in
       a column where every other row carries a number. What is knowable
       about a sale that has not happened is what the position is worth
       RIGHT NOW, which is a real figure and belongs to the same "where it
       stands" idea as every other live value on this card. */
    consideration: { label: 'worth now', value: '≈ 0.099 SOL', mark: 'sol' },
    armedState: 'Queued',
  },
];

/* Typed for the same reason `LEGS` is: under `as const` the entry without
   a `unit` gets a type that does not admit the property, so every reader
   has to narrow before touching it. */
export interface Chip {
  value: string;
  unit?: string;
}

const META: readonly Chip[] = [{ value: '25', unit: '% slip' }, { value: '168h' }];

export const ORDER = {
  title: 'Conditional Order',
  status: 'Awaiting approval',
  legs: LEGS,
  /** What binds leg 2 to leg 1. */
  chain: 'Settlement chained',
  /** And what that actually means, which the two words never said. */
  chainNote: 'Leg 2 arms the moment leg 1 settles, not on a timer',
  eitherLabel: 'Either of these',
  meta: META,
  detailsLabel: 'Details',
  decideWithin: '11:31',
  /* The card is approvable — see OrderCard. These are what it says after. */
  statusArmed: 'Armed',
  armedNote: 'Armed. It is watching the chain, every block.',
} as const;

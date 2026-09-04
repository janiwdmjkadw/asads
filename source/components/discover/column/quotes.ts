/*
 * ── THE QUOTE A PAIR TRADES AGAINST ──────────────────────────────────
 *
 * ── SOL HAS NO MARK ──────────────────────────────────────────────────
 *
 * Nearly every pair on this board is quoted in SOL, so badging them all
 * would put the same mark on ninety-odd rows out of a hundred — which
 * says nothing and costs the width on every one of them. The mark is
 * there to answer "this one is NOT the usual", so only the exceptions
 * carry it. SOL is in the list because the filter needs to name it, and
 * `mark: null` is what says it never draws.
 *
 * ── AND TRUMP IS A QUOTE, NOT A JOKE ─────────────────────────────────
 *
 * It is a real pair on Solana and it behaves like a stablecoin pair in
 * exactly the way that matters here: buying costs you TRUMP, not SOL, so
 * a row you cannot fill with the balance you have looks identical to one
 * you can unless the row says so.
 *
 * The artwork is the token's own, from its mint metadata. It is a poster
 * rather than a logo — the only one with a picture in it — so it is the
 * one that has to be checked at 15px rather than assumed to work.
 *
 * ── WHY THERE ARE FIFTY OF THEM ──────────────────────────────────────
 *
 * The tokenised equities changed what this list is. USDC and USD1 are
 * cash and TRUMP is a meme, and all three quote a pair the same way a
 * dollar does. NVDAX and SPYX do not: a pair quoted in NVDAX is priced
 * in a share of NVIDIA, so the row's figures move with the underlying
 * whether or not anything trades. That is a different fact about the
 * row, and it is one the badge is the only place to put.
 *
 * They are grouped below by what they actually are, because the groups
 * behave differently and a flat alphabetical list would hide that.
 *
 * ── THE ARTWORK IS CROPPED TO A CIRCLE ───────────────────────────────
 *
 * Most of these are square plates — a white ground with a wordmark on
 * it, the way the exchange lists them — and the badge is round. The
 * corners go. That is on purpose: this badge has been a circle since
 * there were four of them, the row has no other round mark to confuse
 * it with, and giving fifty of them square corners to preserve four
 * logos' corners would change the row to suit the artwork.
 */

export interface Quote {
  readonly key: string;
  readonly label: string;
  /**
   * What the ticker stands for. Only where the label does not already
   * say it — `NVDAX` needs `NVIDIA`, `KALSHI` does not need `KALSHI`.
   */
  readonly name?: string;
  /** The badge. `null` for SOL, which is the default and draws nothing. */
  readonly mark: string | null;
}

const ART = '/assets/quotes';
const m = (k: string) => `${ART}/${k}.png`;

export const QUOTES = {
  /* ── the originals ────────────────────────────────────────────── */
  sol: { key: 'sol', label: 'SOL', mark: null },
  usdc: { key: 'usdc', label: 'USDC', mark: m('usdc') },
  usd1: { key: 'usd1', label: 'USD1', mark: m('usd1') },
  trump: { key: 'trump', label: 'TRUMP', mark: `${ART}/trump.jpg` },

  /* ── tokenised equities ───────────────────────────────────────────
   *
   * The `x` suffix is the wrapper's, not the company's: SPYX is a claim
   * on SPY, not SPY. The label keeps the suffix because that is the
   * ticker you would be quoted in, and the name under it says what it
   * tracks.
   */
  spyx: { key: 'spyx', label: 'SPYX', name: 'S&P 500', mark: m('spyx') },
  qqqx: { key: 'qqqx', label: 'QQQX', name: 'QQQ', mark: m('qqqx') },
  gldx: { key: 'gldx', label: 'GLDX', name: 'Gold', mark: m('gldx') },
  nvdax: { key: 'nvdax', label: 'NVDAX', name: 'NVIDIA', mark: m('nvdax') },
  googlx: { key: 'googlx', label: 'GOOGLX', name: 'Google', mark: m('googlx') },
  tslax: { key: 'tslax', label: 'TSLAX', name: 'Tesla', mark: m('tslax') },
  applx: { key: 'applx', label: 'APPLX', name: 'Apple', mark: m('applx') },
  amznx: { key: 'amznx', label: 'AMZNX', name: 'Amazon', mark: m('amznx') },
  metax: { key: 'metax', label: 'METAX', name: 'Meta', mark: m('metax') },
  msftx: { key: 'msftx', label: 'MSFTX', name: 'Microsoft', mark: m('msftx') },
  intcx: { key: 'intcx', label: 'INTCX', name: 'Intel', mark: m('intcx') },
  coinx: { key: 'coinx', label: 'COINX', name: 'Coinbase', mark: m('coinx') },
  crclx: { key: 'crclx', label: 'CRCLX', name: 'Circle', mark: m('crclx') },
  hoodx: { key: 'hoodx', label: 'HOODX', name: 'Robinhood', mark: m('hoodx') },
  mstrx: { key: 'mstrx', label: 'MSTRX', name: 'MicroStrategy', mark: m('mstrx') },
  strcx: { key: 'strcx', label: 'STRCX', mark: m('strcx') },
  pltrx: { key: 'pltrx', label: 'PLTRX', name: 'Palantir', mark: m('pltrx') },
  spcxx: { key: 'spcxx', label: 'SPCXX', name: 'SpaceX', mark: m('spcxx') },
  gmex: { key: 'gmex', label: 'GMEX', name: 'GameStop', mark: m('gmex') },
  mcdx: { key: 'mcdx', label: 'MCDX', name: "McDonald's", mark: m('mcdx') },
  kox: { key: 'kox', label: 'KOX', name: 'Coca Cola', mark: m('kox') },
  brkx: { key: 'brkx', label: 'BRKX', name: 'Berkshire', mark: m('brkx') },

  /* ── private companies ────────────────────────────────────────────
   *
   * No ticker to suffix, because there is no listing behind them. These
   * are the pre IPO books, and the label is just the name.
   */
  anthropic: { key: 'anthropic', label: 'ANTHROPIC', mark: m('anthropic') },
  openai: { key: 'openai', label: 'OPENAI', mark: m('openai') },
  anduril: { key: 'anduril', label: 'ANDURIL', mark: m('anduril') },
  neuralink: { key: 'neuralink', label: 'NEURALINK', mark: m('neuralink') },
  polymarket: { key: 'polymarket', label: 'POLYMARKET', mark: m('polymarket') },
  kalshi: { key: 'kalshi', label: 'KALSHI', mark: m('kalshi') },

  /* ── the rest of the book ─────────────────────────────────────── */
  mu: { key: 'mu', label: 'MU', name: 'Micron', mark: m('mu') },
  skhy: { key: 'skhy', label: 'SKHY', name: 'SK Hynix', mark: m('skhy') },
  sndk: { key: 'sndk', label: 'SNDK', name: 'SanDisk', mark: m('sndk') },
  dram: { key: 'dram', label: 'DRAM', mark: m('dram') },
  nbis: { key: 'nbis', label: 'NBIS', name: 'Nebius', mark: m('nbis') },
  mrvl: { key: 'mrvl', label: 'MRVL', name: 'Marvell', mark: m('mrvl') },
  ttwo: { key: 'ttwo', label: 'TTWO', name: 'Take-Two', mark: m('ttwo') },
  mrna: { key: 'mrna', label: 'MRNA', name: 'Moderna', mark: m('mrna') },
  lly: { key: 'lly', label: 'LLY', name: 'Eli Lilly', mark: m('lly') },
  psg: { key: 'psg', label: 'PSG', mark: m('psg') },
  silver: { key: 'silver', label: 'SILVER', mark: m('silver') },
  robostrategy: { key: 'robostrategy', label: 'ROBOSTRATEGY', name: 'BOT', mark: m('robostrategy') },
  pons: { key: 'pons', label: 'PONS', mark: m('pons') },

  /* ── stables ──────────────────────────────────────────────────── */
  usdt: { key: 'usdt', label: 'USDT', mark: m('usdt') },
  eurc: { key: 'eurc', label: 'EURC', mark: m('eurc') },
  onyc: { key: 'onyc', label: 'ONYC', mark: m('onyc') },
  jlusdc: { key: 'jlusdc', label: 'JLUSDC', mark: m('jlusdc') },

  /* ── wrapped ──────────────────────────────────────────────────────
   *
   * `wsol` is a real second entry rather than a duplicate of `sol`: it
   * is a different mint, and unlike bare SOL it DOES badge, because a
   * pair quoted in wrapped SOL is the exception the badge exists for.
   */
  wsol: { key: 'wsol', label: 'SOL', name: 'Wrapped SOL', mark: m('wsol') },
  xsol: { key: 'xsol', label: 'xSOL', mark: m('xsol') },
  xbtc: { key: 'xbtc', label: 'XBTC', mark: m('xbtc') },

  /* ── collectibles ─────────────────────────────────────────────── */
  sv151: { key: 'sv151', label: 'SV151', mark: m('sv151') },
  heeboo: { key: 'heeboo', label: 'HEEBOO', mark: m('heeboo') },
  skr: { key: 'skr', label: 'SKR', name: 'Seeker', mark: m('skr') },
} as const satisfies Record<string, Quote>;

export type QuoteKey = keyof typeof QUOTES;

export const QUOTE_KEYS = Object.keys(QUOTES) as QuoteKey[];

/*
 * Which row is quoted in what. Indexed off the row like every other
 * fixture on this sheet.
 *
 * ── STILL MOSTLY SOL ─────────────────────────────────────────────────
 *
 * The list got fifty entries longer and the weighting did not change:
 * SOL is two rows in three, and everything else is the exception. It is
 * tempting to spread the new marks evenly now that there are enough to
 * fill a column without repeating — but a lane where every row carries
 * a different badge is telling you the exception is normal, which is the
 * one thing this mark must not do.
 *
 * What DID change is the tail. It used to be USDC, USD1 and TRUMP over
 * and over; now the non-SOL rows pull from across the book, so scrolling
 * shows an equity, a private name and a stable rather than the same
 * three coins at different heights.
 */
export const ROW_QUOTES: readonly QuoteKey[] = [
  'sol',
  'usdc',
  'sol',
  'sol',
  'nvdax',
  'sol',
  'sol',
  'trump',
  'sol',
  'anthropic',
  'sol',
  'sol',
  'usdt',
  'sol',
  'spyx',
  'sol',
  'sol',
  'usd1',
  'sol',
  'tslax',
  'sol',
  'sol',
  'openai',
  'sol',
  'gldx',
  'sol',
  'sol',
  'xbtc',
  'sol',
  'mstrx',
  'sol',
  'sol',
  'eurc',
  'sol',
  'polymarket',
  'sol',
  'sol',
  'coinx',
  'sol',
  'wsol',
  'sol',
  'sol',
  'msftx',
  'sol',
  'kalshi',
  'sol',
  'sol',
  'mu',
  'sol',
  'sv151',
];

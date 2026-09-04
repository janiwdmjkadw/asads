import './art.css';
import { QUOTES, type QuoteKey } from '@/components/discover/column/quotes';

/*
 * THE QUOTE BADGES, ON THEIR OWN.
 *
 * Same idea as the launchpad sheet above it, and the same reason: on a
 * row this is a 15px circle in the middle of a line of marks, which is
 * the size it has to survive and the worst size to judge it at.
 *
 * ── WHAT THIS SHEET IS ACTUALLY FOR ──────────────────────────────────
 *
 * Not "is the drawing good" — none of these were drawn, they are the
 * tokens' own artwork. It is whether fifty of them can be told APART at
 * 15px in a circle, which is the badge's only job. Some of these are a
 * white plate with small black type on it and there are a dozen like
 * that, so the big one is the reference and the small one is the answer.
 *
 * SOL is skipped. It is in the list so the fixtures can name it, but it
 * is the default quote and never draws a badge — an empty cell here
 * would read as a mark that failed to load.
 */

const GROUPS: { title: string; keys: QuoteKey[] }[] = [
  { title: 'Cash and memes', keys: ['usdc', 'usd1', 'usdt', 'eurc', 'onyc', 'jlusdc', 'trump'] },
  {
    title: 'Tokenised equities',
    keys: [
      'spyx', 'qqqx', 'gldx', 'nvdax', 'googlx', 'tslax', 'applx', 'amznx',
      'metax', 'msftx', 'intcx', 'coinx', 'crclx', 'hoodx', 'mstrx', 'strcx',
      'pltrx', 'spcxx', 'gmex', 'mcdx', 'kox', 'brkx',
    ],
  },
  { title: 'Private', keys: ['anthropic', 'openai', 'anduril', 'neuralink', 'polymarket', 'kalshi'] },
  {
    title: 'The rest of the book',
    keys: ['mu', 'skhy', 'sndk', 'dram', 'nbis', 'mrvl', 'ttwo', 'mrna', 'lly', 'psg', 'silver', 'robostrategy', 'pons'],
  },
  { title: 'Wrapped and collectibles', keys: ['wsol', 'xsol', 'xbtc', 'sv151', 'heeboo', 'skr'] },
];

export function QuoteSheet() {
  return (
    <div className="qs">
      {GROUPS.map((group) => (
        <div className="qs-group" key={group.title}>
          <div className="qs-title">{group.title}</div>
          <div className="ms">
            {group.keys.map((key) => {
              const quote = QUOTES[key];
              if (!quote.mark) return null;
              return (
                <div className="ms-cell" key={key}>
                  <img className="qs-big" src={quote.mark} alt="" />
                  <span className="ms-label">{quote.label}</span>
                  <img className="qs-small" src={quote.mark} alt="" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

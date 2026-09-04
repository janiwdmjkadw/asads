/**
 * The prompt corpus for the agentic page.
 *
 * These are written in the voice traders actually use: lowercase, run on,
 * ticker and address soup, a whole thesis in one breath. The page's entire
 * argument is that THIS SENTENCE IS THE STRATEGY, so the examples are the
 * demo. Keep them real. The moment one of these is tidied into marketing
 * copy it stops being evidence and starts being a claim.
 *
 * `tags` name the capabilities a prompt exercises. They are display only;
 * nothing routes off them.
 */

export interface AgentPrompt {
  readonly text: string;
  readonly tags: readonly string[];
}

/** The three that read fastest as "you can just say that". */
export const HERO_PROMPTS: readonly string[] = [
  'if elon tweets a meme buy me 10 sol of the first coin someone deploys on pumpfun',
  'copy trade frankdegods for 6 hours. only tech coins, no memes',
  'once dev sells all $jimothy, buy 10 sol but only if top 10 cluster is less than 15%',
];

/** What the console reports once each prompt has finished typing. */
export const HERO_READS: ReadonlyArray<readonly string[]> = [
  ['social trigger', 'new mints', '10 SOL sized'],
  ['copy trade', '6 hour life', 'narrative filter'],
  ['dev wallet', 'cluster under 15%', '10 SOL sized'],
];

export const CORPUS: readonly AgentPrompt[] = [
  {
    text: 'if elon tweets a meme buy me 10 sol of the first coin someone deploys on pumpfun',
    tags: ['social trigger', 'new mints'],
  },
  {
    text: "I'm up 300 sol this week opposed to +20 sol last week. what did i do better? what missed gains did i have?",
    tags: ['pnl forensics', 'missed gains'],
  },
  {
    text: 'if brian armstrong changes his pfp to the anime one, buy me 5 eth of 0xB2000000000000000000007BF6D5cBb0E24cB301 with 0.5 bribe',
    tags: ['pfp watch', 'evm', 'priority fee'],
  },
  {
    text: 'once dev sells all $jimothy, buy 10 sol but only if top 10 cluster is less than 15%',
    tags: ['dev wallet', 'holder clusters'],
  },
  {
    text: 'copy trade frankdegods for 6 hours. only tech coins, no memes',
    tags: ['copy trade', 'narrative filter'],
  },
  {
    text: "short $OIL on Trump's next TACO from truth social",
    tags: ['truth social', 'short'],
  },
  {
    text: 'ladder out of my $WIF: sell 20% every 2x from here, stop the whole thing if it round trips to my entry',
    tags: ['scale out', 'stop loss'],
  },
  {
    text: 'wake me up when a coin i hold has 3 insiders selling into the same block',
    tags: ['insider flow', 'alerts'],
  },
  {
    text: 'every graduating pumpfun coin, snipe 0.5 sol if the creator has never rugged and bundle is under 8%',
    tags: ['graduations', 'creator history'],
  },
  {
    text: 'watch this wallet. if it buys anything under 200k mcap, buy the same thing 5 seconds later with 1 sol',
    tags: ['wallet watch', 'delayed follow'],
  },
  {
    text: 'sell half my bags if BTC drops 4% in an hour, i want dry powder for the wick',
    tags: ['macro trigger', 'risk off'],
  },
  {
    text: 'find me every wallet that bought $jimothy before 100k and is still holding, then track what they buy next',
    tags: ['cohort', 'alpha discovery'],
  },
  {
    text: 'buy 2 sol of anything a top 50 wallet buys twice in 10 minutes, max 3 positions at a time',
    tags: ['smart money', 'position cap'],
  },
  {
    text: 'if the fed cuts rates, rotate 30% of my stables into majors and tell me before you do it',
    tags: ['macro', 'ask first'],
  },
];

/* Two rows of near equal length, so neither marquee runs out first. */
export const ROW_A: readonly AgentPrompt[] = CORPUS.slice(0, 7);
export const ROW_B: readonly AgentPrompt[] = CORPUS.slice(7);

/**
 * ── FAKE CHATS ───────────────────────────────────────────────────────
 *
 * A bench of conversations for the Ask Soren window and the /agent page,
 * so the chat can be designed against threads rather than against a
 * spinner. Nothing here is generated at render time: every turn is
 * written out, because the point of a fixture is that the same words
 * are on screen every time you look.
 *
 * WHAT THEY COVER, deliberately:
 *   · a short thread and a long one, so the scroll is exercised
 *   · a first turn still unanswered, and a thread that ends on a
 *     question back to you
 *   · replies of every length: one line, a paragraph, a list, a table
 *   · a tool call with its result, so the token pane renders
 *   · no proposal references: the card reads its record from the api by
 *     uuid and the sandbox serves none, so a reference here would render
 *     as "proposal unavailable" — worse than the sentence it replaces
 *   · one conversation with no title, which is what the list falls back
 *     on the day somebody never names one
 *
 * Shapes mirror `source/lib/agent/contracts.ts`: parts are `{v:1,type}`
 * records, turns carry `turn_seq` and `turn_role`, and the ids are
 * stable so a reload lands you back on the same thread.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const iso = (ago: number): string => new Date(Date.now() - ago).toISOString();

type Part = Record<string, unknown>;

const text = (t: string): Part => ({ v: 1, type: 'text', text: t });
const reasoning = (summary: string): Part => ({ v: 1, type: 'reasoning', summary });
const toolCall = (id: string, name: string, args: unknown): Part => ({
  v: 1,
  type: 'tool_call',
  toolCallId: id,
  name,
  args,
});
const toolResult = (id: string, digest: string, preview: unknown): Part => ({
  v: 1,
  type: 'tool_result',
  toolCallId: id,
  digest,
  preview,
});

export interface MockTurn {
  readonly id: string;
  readonly turn_seq: number;
  readonly turn_role: 'user' | 'assistant';
  readonly parts: readonly Part[];
  readonly run_id: string | null;
}

export interface MockConversation {
  readonly id: string;
  title: string | null;
  readonly created_at: string;
  readonly turns: MockTurn[];
}

/** Build a thread from an alternating list, user first. */
function thread(id: string, blocks: ReadonlyArray<readonly Part[]>): MockTurn[] {
  return blocks.map((parts, i) => ({
    id: `${id}_t${i}`,
    turn_seq: i,
    turn_role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    parts,
    run_id: i % 2 === 0 ? null : `${id}_r${i}`,
  }));
}

const CONVERSATIONS: MockConversation[] = [
  {
    id: 'conv_bonk_dip',
    title: 'Buy BONK on a 15% dip',
    created_at: iso(2 * HOUR),
    turns: thread('conv_bonk_dip', [
      [text('what is bonk doing today')],
      [
        toolCall('tc_bonk_state', 'get_token_state', {
          mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        }),
        toolResult('tc_bonk_state', 'bonk · 2.41M mc · +12.4%', {
          mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          symbol: 'BONK',
          name: 'Bonk',
          price_usd: 0.0000241,
          market_cap_usd: 2_410_000,
          vol_24h_usd: 418_000,
          trade_count: 3_182,
          graduated: true,
          holder_count_total: 24_918,
          top10_supply_pct: 18.2,
          as_of_ms: Date.now(),
        }),
        text(
          'BONK is at a **$2.41M** market cap, up 12.4% on the day on $418K of volume. The dev wallet has not moved in three weeks and the top ten holders are down to 18% of supply, which is the thinnest that book has been since launch.\n\nIt has run into the same $2.5M ceiling twice this week. Want me to watch for a pullback rather than buying it here?',
        ),
      ],
      [text('yeah. buy 2 sol if it dips 15% in an hour, until friday')],
      [
        reasoning('Reading the ask as a standing rule rather than a single order.'),
        text(
          'Set up. Here is what I have:\n\n- **Trigger** — BONK falls 15% inside any rolling hour\n- **Order** — buy 2 SOL, market, from Main\n- **Runs** — every time it triggers, until Friday 23:00\n\nNothing is armed until you approve it.',
        ),
      ],
    ]),
  },
  {
    id: 'conv_wallet_spread',
    title: 'Spread my SOL across wallets',
    created_at: iso(5 * HOUR),
    turns: thread('conv_wallet_spread', [
      [text('how much sol do i have and where')],
      [
        text(
          'Across your eight wallets, **125.9 SOL**.\n\n| Wallet | SOL |\n| --- | --- |\n| Cold store | 74.02 |\n| Main | 29.74 |\n| Wallet 2 | 11.54 |\n| Sniper | 6.21 |\n| Runner | 3.42 |\n| Wallet 7 | 0.81 |\n| Scalps | 0.09 |\n| Agent | 0.00 |\n\nCold store is holding 59% of it. The agent wallet is empty, which is why the agent has not been able to act on anything this week.',
        ),
      ],
      [text('move 5 sol to the agent wallet')],
      [
        text(
          'I can queue that, but I cannot sign it — a transfer out of Cold store needs you. Open Portfolio, Wallets, and drag Cold store onto the agent row; the amount box will already say 5.',
        ),
      ],
      [text('why cant you sign it')],
      [
        text(
          'Cold store has no trading authorization on it. That is deliberate on your side: you set it up as the wallet nothing automated can touch, which is why 59% of your SOL is sitting there rather than anywhere I can reach.\n\nMain and the agent wallet both have authorization. Anything you want me to be able to move has to live in one of those two.',
        ),
      ],
      [text('ok move 5 from main to agent instead')],
      [
        text(
          'Queued: **5 SOL**, Main → Agent. Main has 29.74, so it lands at 24.74 and the agent wallet goes from empty to 5.\n\nApprove it in Portfolio and it goes out on the next block.',
        ),
      ],
      [text('how much does the agent actually need')],
      [
        text(
          'For the four conditionals you have armed: **8 SOL** to cover every one of them firing once, plus about 0.02 for fees. Five covers two of the four.\n\nI would send eight and stop thinking about it.',
        ),
      ],
    ]),
  },
  {
    id: 'conv_wif_stop',
    title: 'Stop loss on WIF',
    created_at: iso(26 * HOUR),
    turns: thread('conv_wif_stop', [
      [text('put a stop on my wif position at 20% down')],
      [
        toolCall('tc_wif_state', 'get_token_state', {
          mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        }),
        toolResult('tc_wif_state', 'wif · 1.19M mc · +12.8%', {
          mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
          symbol: 'WIF',
          name: 'dogwifhat',
          price_usd: 2.31,
          market_cap_usd: 1_190_000,
          vol_24h_usd: 402_000,
          trade_count: 1_904,
          graduated: true,
          holder_count_total: 9_412,
          top10_supply_pct: 22.6,
          as_of_ms: Date.now(),
        }),
        text(
          'You hold **1,284 WIF**, in at $2,630 and worth $2,966 now. A 20% stop from here sells the lot at about $2,373, which is below your entry — you would be closing green at a loss.\n\nFrom your ENTRY, 20% down is $2,104. Say which one you meant and I will write it.',
        ),
      ],
      [text('from entry')],
      [
        text('Written. It sells all 1,284 WIF if the position falls to $2,104. Approve it and it arms.'),
      ],
    ]),
  },
  {
    id: 'conv_who_to_follow',
    title: 'Who is worth following',
    created_at: iso(2 * DAY),
    turns: thread('conv_who_to_follow', [
      [text('who on the frens board is actually good')],
      [
        text(
          'Three of the twelve have a record long enough to mean anything.\n\n**Soren** — 44 positions, 86.4% of them green, best call 12x. Trades rarely and holds.\n\n**aster** — 43 positions, 81.4%, best 9.7x. Highest volume on the board, which is why the PnL is second despite the lower hit rate.\n\n**brixby** — 42 positions, 78.6%. Steadiest of the three; nothing above 8x, nothing worse than a 30% drawdown.\n\nThe other nine are under twenty positions each. That is not a record, it is a week.',
        ),
      ],
      [text('track soren')],
      [text('Tracking Soren. You will get a notification the moment they open or close anything.')],
      [text('can you copy their trades automatically')],
      [
        text(
          'Not automatically, and I would not want to: their average hold is four days and yours is under an hour, so you would be copying entries and inventing your own exits, which is the worst half of somebody else\u2019s strategy.\n\nWhat I can do is turn each of their opens into a conditional you approve — same entry, your size, your exit. You stay the one deciding.',
        ),
      ],
      [text('do that but only for calls over 5x potential')],
      [
        text(
          'That is not a number anybody has before the fact. What I can filter on is what the call LOOKS like at the moment it is made: market cap under $1M, liquidity over $150K, dev wallet quiet for a week.\n\nOf Soren\u2019s last 44 positions, 11 met all three, and nine of those went over 5x. That is the closest honest version of what you asked for.',
        ),
      ],
      [text('yeah do that')],
      [
        text('Armed. When Soren opens something that passes those three tests, I will write you a conditional and hold it for approval.'),
      ],
    ]),
  },
  {
    id: 'conv_fees',
    title: 'What am I paying in fees',
    created_at: iso(3 * DAY),
    turns: thread('conv_fees', [
      [text('what am i paying in fees')],
      [
        text(
          'On 1,284.6 SOL of lifetime volume you have paid **12.8 SOL** in platform fees, and you are at the Silver tier, which returns 25% of that.\n\nYou have **1.234 SOL** of cashback claimable now, and 0.12 pending. At 1,215 SOL more volume you reach Gold, which pays back 40%.',
        ),
      ],
      [text('is that a lot')],
      [
        text(
          'It is 1% of what you traded, which is the standard rate — the tier is what changes, not the fee.\n\nWhat costs you more than the fee is slippage: on your last twenty fills you paid an average of 2.3% against the quote, mostly on the four coins under $500K liquidity. That is roughly 29 SOL, against 12.8 in fees.',
        ),
      ],
      [text('how do i fix the slippage')],
      [
        text(
          'Three things, in the order they matter:\n\n1. **Size against liquidity, not against conviction.** 2 SOL into a $200K book moves it. Half a SOL does not.\n2. **Stop market buying into a green candle.** Six of those twenty fills were inside a minute of a 10% move.\n3. **Turn the slippage cap down.** Yours is at 20%; nothing you trade needs more than 8, and the cap is what a sandwich bot reads as permission.',
        ),
      ],
      [text('set the cap to 8')],
      [
        text('Done — the default slippage cap is 8% now, on every wallet. Anything already armed keeps the cap it was written with.'),
      ],
    ]),
  },
  {
    id: 'conv_untitled',
    title: null,
    created_at: iso(4 * DAY),
    turns: thread('conv_untitled', [
      [text('is popcat rugging')],
      [
        text(
          'No sign of it. The dev wallet still holds 4.1% and has not sent to an exchange. Liquidity is $212K against a $70.9M cap, which is thin, but it has been thin all month.\n\nWhat changed today is volume: $412K, four times its average. That is a crowd arriving, not a dev leaving.',
        ),
      ],
      [text('what would it look like if it was')],
      [
        text(
          'Four things, usually in this order:\n\n- the dev wallet moves to a fresh address, not to an exchange\n- liquidity comes out in one transaction rather than in pieces\n- the top ten share jumps as everyone else sells\n- the chart goes vertical down inside a minute, on almost no buys\n\nI watch the first two on everything you hold and tell you inside a block.',
        ),
      ],
      [text('is anything i hold showing those')],
      [
        text(
          'One. **PONKE** — the dev wallet sent 2% of supply to a new address eleven hours ago and has not touched it since. That is not a rug on its own; it is what the hour before one looks like.\n\nYou hold 88.4K PONKE, worth $1,626. Want a stop under it?',
        ),
      ],
      [text('yeah put a stop 25% down')],
      [
        text('Written: sell all 88.4K PONKE if it falls 25% from here. It needs your approval before it arms.'),
      ],
    ]),
  },
  {
    id: 'conv_long_thread',
    title: 'Working through a strategy',
    created_at: iso(6 * DAY),
    turns: thread('conv_long_thread', [
      [text('i keep buying tops. help')],
      [
        text(
          'Your last twelve buys went in at an average of 68% above the day low and you sold nine of them under. That is not bad luck, it is a rule: you buy when it is moving.',
        ),
      ],
      [text('so what do i do')],
      [
        text(
          'Stop deciding at the moment you feel like buying. Decide the price first and let a conditional do the buying.\n\nThree that would have caught your last month:\n\n1. Buy on a 15% hourly dip, not on a green candle.\n2. Never more than 2 SOL into a coin under $500K liquidity.\n3. Take half off at 3x, always.',
        ),
      ],
      [text('set up the first one for the coins i already hold')],
      [
        text(
          'That is six conditionals — BONK, WIF, MEW, PONKE, USDC and SOL. I would drop the last two: a 15% hourly dip on USDC means something has broken, and on SOL it means the whole market has.\n\nFour then, 2 SOL each, until you cancel them.',
        ),
      ],
      [text('do it')],
      [
        text('All four are armed. You can see them on the Conditionals page, and I will tell you the first time one fires.'),
      ],
    ]),
  },
  {
    id: 'conv_mew_liquidity',
    title: 'MEW liquidity',
    created_at: iso(9 * HOUR),
    turns: thread('conv_mew_liquidity', [
      [text('why did mew liquidity double overnight')],
      [
        text(
          'One wallet added **$180K** to the pool at 02:40, in a single transaction. It is not the dev — the address is four days old and funded from an exchange.\n\nSo: someone with real money decided the book was too thin to trade in, and fixed it themselves. That is usually a market maker taking a position, and it usually comes with size behind it.',
        ),
      ],
      [text('good or bad for me')],
      [
        text(
          'Good for getting out, neutral for getting in.\n\nYour 940K MEW is worth $3,873. Yesterday selling that would have moved the price about 4%; this morning it moves it under 1.5%. Nothing about the coin changed — the door just got wider.',
        ),
      ],
      [text('should i size up then')],
      [
        text(
          'Not on liquidity alone. A deeper book makes a position easier to leave, which is a reason to hold what you have with less worry — not a reason to have more of it.\n\nIf you want more MEW, the thing to wait for is the same three tests as everything else: the dev quiet, the top ten under 25%, and a dip you did not chase.',
        ),
      ],
    ]),
  },
  {
    id: 'conv_unanswered',
    title: 'Overnight movers',
    created_at: iso(20 * 60_000),
    turns: [
      {
        id: 'conv_unanswered_t0',
        turn_seq: 0,
        turn_role: 'user',
        parts: [text('what moved most overnight and why')],
        run_id: null,
      },
    ],
  },
];

/** Newest first, which is the order the list renders. */
export function conversations(): MockConversation[] {
  return [...CONVERSATIONS].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}

export function conversation(id: string): MockConversation | undefined {
  return CONVERSATIONS.find((c) => c.id === id);
}

/** A conversation started from the UI. Lives until the server restarts. */
export function createConversation(title: string | null): MockConversation {
  const made: MockConversation = {
    id: `conv_new_${Date.now().toString(36)}`,
    title,
    created_at: new Date().toISOString(),
    turns: [],
  };
  CONVERSATIONS.unshift(made);
  return made;
}

export function appendUserTurn(conv: MockConversation, body: string): MockTurn {
  const turn: MockTurn = {
    id: `${conv.id}_t${conv.turns.length}`,
    turn_seq: conv.turns.length,
    turn_role: 'user',
    parts: [text(body)],
    run_id: null,
  };
  conv.turns.push(turn);
  if (conv.title === null) conv.title = body.slice(0, 48);
  return turn;
}

export function appendAssistantTurn(conv: MockConversation, body: string, runId: string): MockTurn {
  const turn: MockTurn = {
    id: `${conv.id}_t${conv.turns.length}`,
    turn_seq: conv.turns.length,
    turn_role: 'assistant',
    parts: [text(body)],
    run_id: runId,
  };
  conv.turns.push(turn);
  return turn;
}

/**
 * What the mock says back. It is scripted off a keyword rather than
 * random, so the same question always gets the same answer and a
 * screenshot can be retaken.
 */
export function scriptedReply(ask: string): string {
  const q = ask.toLowerCase();
  if (q.includes('buy') || q.includes('dip')) {
    return 'I can write that as a conditional: the trigger, the size and how many times it may run. Nothing arms until you approve it.\n\nSay the coin and the size and I will draft it.';
  }
  if (q.includes('sell') || q.includes('stop')) {
    return 'A stop needs two things I do not have yet: which position, and whether the level is measured from your entry or from where it is now. Those two answers give very different orders.';
  }
  if (q.includes('wallet') || q.includes('sol')) {
    return 'Across your eight wallets you are holding **125.9 SOL**, with 59% of it sitting in Cold store and nothing at all in the agent wallet.';
  }
  if (q.includes('fee') || q.includes('cashback')) {
    return 'You are at the Silver tier, which returns 25% of the platform fee. There is **1.234 SOL** claimable right now.';
  }
  return 'I am the sandbox Soren, so I answer from fixtures rather than from the chain. Ask me about a wallet, a position, fees, or setting up a conditional and you will get a written out answer.';
}

# The landing page as it stood, before it was cleared

Written 2026-09-03, the moment before `LandingPage.tsx` was emptied and
`sections/` was deleted. This is a record, not a plan. Nothing here is
meant to be rebuilt as it was.

Everything below is recoverable in full with `git checkout b87244b --
source/components/landing/sections`, so this file does not try to preserve
code. It preserves the DECISIONS and the COPY, which are the parts that
took thinking and would otherwise have to be thought again.

---

## The shape

Nine bands, 6071px tall at 1440, alternating black and white grounds:

| # | id | ground | height | what it was |
|---|----|--------|--------|-------------|
| 1 | `header` | black | 88 | sticky bar, glass on scroll |
| 2 | `hero` | black | 900 | the headline and the conditional |
| 3 | `agent` | white | 1256 | the annotated order card |
| 4 | `terminal` | black | 692 | the product screenshot |
| 5 | `surfaces` | white | 1676 | four numbered rows |
| 6 | `rewards` | white | 644 | three columns |
| 7 | `close` | black | 449 | a repeat of the hero |
| 8 | `footer` | `#141414` | 366 | twelve links |

## The copy, verbatim

**Header** — Terminal · Rewards · Community (a dropdown onto Discord and
Twitter) · Log in · Start Trading

**Hero**
> Agentic Terminal
> for DeFi
>
> `when mc > $250K and holders > 800`
> `then buy 2 SOL and ask me first`
>
> Start Trading · Agentic Disclosures

**Agent** — eyebrow `ALWAYS AT THE DESK`
> An agent that shows its work
>
> One order, opened up. Every condition it is waiting on, every leg it
> will fire, and the point where it stops and asks you.

A black Conditional Order card, `AWAITING APPROVAL`, two legs. Leg 1
arms on approval: when market cap ≥ $5K, then buy 5 TAU. Settlement
chained. Leg 2 queued: after Leg 1 fills, then either 24h from arming or
price falls 20% from peak, sell 100% TAU. Four callouts down the right,
numbered 01 to 04:

- **01 The trigger** — A live condition on the chain, not a reminder. It
  is watched continuously, not polled when you open the app.
- **02 The size** — Derived from the thesis rather than typed in. Five
  units, priced at the moment the condition turns true.
- **03 The chain** — Leg two cannot arm until leg one actually fills.
  Settlement, not a timer, is what releases it.
- **04 The exits** — Two of them, whichever comes first: a day from
  arming, or a twenty percent fall from peak.

CTA: Meet your agent

**Terminal** — eyebrow `TERMINAL, REIMAGINED`
> Everything the chain knows, on one screen
>
> Price, flow, holders and your own positions in one view, with the agent
> reading the same screen you are.

CTA: Open the terminal

**Surfaces** — eyebrow `SURFACES`
> Four ways into the same market
>
> Discovery, charts, conditionals and the people you follow. Each one its
> own surface, all of them reading the same chain.

1. **01 DISCOVER · See it first** — Models sweep every launch; the lanes
   show what survives past your filters.
2. **02 CHARTS · Charts that argue their case** — Price is the surface.
   See the reasoning underneath. Data built to be understood by both
   humans and agents.
3. **03 CONDITIONALS** and **04** (the fourth was the people you follow).

Each row: number, kicker, headline, one line, `Learn more →`, and a large
isometric line drawing on the right.

**Rewards** — eyebrow `REWARDS`
> Trading pays you back
>
> Cashback, quests and invite rewards. Earning is part of trading here,
> not a programme bolted onto it.

- **Cashback** — Real cashback on every trade, paid as you go.
- **Quests** — Daily quests that pay you to sharpen your edge.
- **Invite rewards** — Bring a trader. When they win, you both do.

CTA: Start earning

**Close** — the hero's conditional again, verbatim, then:
> Write it in plain language. The agent watches the chain and comes back
> when it means something.

CTA: Start trading

**Footer**
> Listen — Set a condition. The agent watches the chain and asks before it
> fires.

Product: Terminal, Rewards, Surfaces, Conditionals ·
Community: Discord, Twitter ·
Legal: Agentic Disclosures, Terms, Privacy · © 2026 Listen

---

## What was wrong with it

Worth keeping, because these are the traps to not walk back into.

1. **The Close repeated the Hero verbatim.** The page opened and closed on
   an identical picture, and the closer was 449px of mostly nothing.
2. **Surfaces was 1676px**, the biggest band on the page, spent on four
   near-identical rows with generic isometric renders. The dead zone.
3. **Rewards was a three column icon grid** that could have belonged to any
   product.
4. **Four tracked uppercase eyebrows** — `ALWAYS AT THE DESK`,
   `TERMINAL, REIMAGINED`, `SURFACES`, `REWARDS`.
5. **No proof anywhere.** No volume, no fills, no counts. A trading
   product with nothing on its landing page a trader could check.
6. **The header ran full bleed** while every band under it capped and
   centred at `--lp-container`, so the mark lined up with nothing.
7. **The header's own doc comment** said it: "it reads as well-made rather
   than as authored, and if the bar is meant to say something about the
   product before you scroll, this is not the composition that says it."

## What survives the clear

- `tokens.css` — the palette and the layout tokens.
- `primitives/` — Pill, Eyebrow, MeshGround, SmokeGround, Video, SocialMenu.
- `art/` — the glyphs.
- `shaders.ts` — the mesh and smoke presets, which still carry the arctic
  mint (`#5EEAD4`, `#AEEDDC`, `#DFFCF3`) even though `tokens.css` was
  flattened to mono at some point.

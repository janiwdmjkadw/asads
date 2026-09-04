# Listen — complete frontend UI export

Every production page, tab, panel, modal, popover, toast and animation in the
Listen terminal, plus the public marketing pages. **833 files, 28 MB.**

Frontend only. No backend, no server code, no proprietary logic.

> This supersedes the two earlier bundles (`listen-discover-ui-export`,
> `listen-landing-ui-export`). Everything in them is here, plus everything else.

---

## 1. Start here

| Order | Look at | Why |
|---|---|---|
| 1 | `reference/` | 14 screenshots of the product as it ships today — see below |
| 2 | `source/app/globals.css` (line 47) | The design tokens. ~246 CSS variables. The whole system starts here |
| 3 | `source/components/listen/theme/themes.ts` | The theme catalog — how the accent palette swaps |
| 4 | `source/components/listen/primitives/` | The 12 shared primitives everything is built from |
| 5 | `source/components/listen/TerminalShell.tsx` | The app frame: nav, sub-header, footer, and every persistent pane |
| 6 | Section 4 below | The page-by-page map |

### reference/

| File | Shows |
|---|---|
| `01-discover-full-page.png` | Discover, full desktop width — the three lanes |
| `02-trade-page-full.png` | The Trade page end to end — chart, buy/sell panel, analytics, trades table |
| `03-discover-wireframe.png` · `04-coin-card-wireframe.png` | The intended layout skeletons |
| `05-coin-card-detail.png` | The coin card close up |
| `06-…` – `10-…` | Agent chat: empty, streaming, complete, a trade proposal, composer detail |
| `11-…` · `12-…` | The agent dock floating over Discover and over Trade |
| `13-…` · `14-…` | The wallet activity dock — feed and manager views |

The landing page is not screenshotted: it is mostly moving video, so a still
would misrepresent it. Open `source/public/landing/video/*.mp4` directly.

---

## 2. What is included

**Terminal tabs** — Discover, Tracker, Portfolio, Rewards, Frens, Conditionals,
Agent (chat), Agent Wallet, and the **Trade page end to end**.

**Public pages** — the landing page (`/`), the agentic-trading marketing page,
the fren profile and fren signup pages, sign-in / sign-up, and the full-screen
onboarding flow (`/welcome`).

**Every overlay** — 59 files carry a modal, dialog, popover, dock or sheet.
Including: the wallet activity dock, the tweet tracker dock, the discover
filters modal, trading settings ("tweaks"), the buy/sell order confirmation,
the order edit modal, chart settings, the token search modal, the emoji picker,
wallet create / transfer / group modals, the wallet recovery-key panel,
onboarding, the invite-code and creator-pass modals, partner welcome, the
classifier candidates modal, cancel confirmations, and every hover card.

**Every animation** — 250 `@keyframes` blocks across 12 stylesheets, 224 CSS
transition/animation declarations, 11 components using framer-motion, 45
`requestAnimationFrame` loops, 6 canvas/WebGL surfaces, the landing page's
video bands and live shader grounds, plus the notification sound.

**Every asset** — 47 SVGs, 20 PNGs, 6 MP4s, WEBP/JPG, the emoji dataset, and
the sound file.

## What is excluded

- `/admin`, `/dev/*`, `/preview/*`, `/seed-deck` — not production surfaces
- All server code: API route handlers, middleware, server components, database
- All test files
- Proprietary logic — see section 7

---

## 3. The design system

**`source/app/globals.css` (from line 47)** — ~246 CSS custom properties:
surface layers (`--surface`, `--surface-1..3`), text hierarchy (`--ink-0..4`),
accents (`--accent-primary/secondary/glow/soft/wash`), market direction
(`--up` `#34d399`, `--down` `#fb5374`, `--hold`), the `--hairline` divider
system, a full fixed-height scale (`--h-topnav`, `--h-row`, `--h-chip`,
`--h-input`, …), type (`--font-sans/mono/display`) and motion
(`--dur-fast/normal/slow`, `--ease-out`).

**Nothing hardcodes a color.** A literal hex will break theming.

**`components/listen/theme/themes.ts`** — a theme is only an *accent pair*.
The surface/ink/data palette never changes, so green-up / red-down semantics
survive every theme. Users pick from swatch groups (Cool, Green, Warm, Pink,
Mono, Exotic).

**`components/listen/primitives/`** — `Pill`, `Stat`, `StatBox`, `Caption`,
`Numeral`, `IconButton`, `SegToggle`, `LiveDot`, `StatusBadge`,
`HairlineDivider`. Highest-leverage place to work: changes propagate everywhere.

The landing page has its **own** scoped palette in
`components/landing/tokens.css` (the `.lp` wrapper, `--lp-*`), deliberately
isolated from the terminal.

### Stylesheets

| File | Size | Scope |
|---|---|---|
| `app/globals.css` | 59 KB | Tokens + base + Tailwind entry |
| `components/listen/listen.css` | 64 KB | App chrome, primitives, shared surfaces |
| `components/agent/agent-chat.css` | 41 KB | Agent chat dock and window |
| `components/discover/discover.css` | 35 KB | The Discover board |
| `components/rewards/rewards.css` | 26 KB | Rewards tabs |
| `homepage/creator-pass-modal/*.module.css` | 28 KB | Creator-pass invite modal |
| `homepage/certificate-invite/*.module.css` | 23 KB | Certificate invite modal |
| `components/rewards/partner-welcome.css` | 17 KB | Partner welcome modal |
| `components/onboarding/welcome/welcome.module.css` | 9 KB | Full-screen onboarding |
| `components/agent/soren/*.css` | 10 KB | Agent hover + panes |
| `components/landing/tokens.css` | 3 KB | Landing palette (scoped) |

---

## 4. Page map

```
components/listen/TerminalShell.tsx     the frame — mounts everything below
├── TerminalTopNav / AppSubHeader / AppFooter / WalletPanel
├── discover/PersistentDiscoverPane  →  DiscoverPage
├── trade/PersistentTradePane        →  TradePage      (Solana)
├── trade/PersistentEvmTradePane     →  EvmTradePage   (BSC / Robinhood)
├── listen/PersistentTabPane         →  Tracker · Portfolio · Rewards
├── agent/AgentChatDock              →  the chat dock + window
└── modal hosts: WalletProfileModal, WalletSetupModalHost, FlashModalHost,
    OnboardingModal, AgentWalletSetupModal, PartnerWelcomeModal, Toaster
```

| Area | Files | Entry point |
|---|---|---|
| Trade | 99 | `components/trade/TradePage.tsx`, `EvmTradePage.tsx` |
| Discover | 85 | `components/discover/DiscoverPage.tsx` |
| Agent chat | 58 | `components/agent/AgentPage.tsx`, `AgentChatDock.tsx` |
| App chrome | 55 | `components/listen/TerminalShell.tsx` |
| Portfolio | 37 | `components/portfolio/PortfolioPage.tsx` |
| Landing | 36 | `components/landing/LandingPage.tsx` |
| Conditionals | 36 | `components/conditionals/ConditionalsPanel.tsx` |
| Agent wallet | 16 | `components/agent-wallet/AgentWalletPanel.tsx` |
| Onboarding | 14 | `components/onboarding/welcome/WelcomeFlow.tsx` |
| Tweet cards | 14 | `components/tweet/TweetCard.tsx` |
| shadcn base | 14 | `components/ui/` |
| Tracker | 11 | `components/tracker/TrackerPage.tsx` |
| Rewards | 9 | `components/rewards/RewardsPage.tsx` |
| Creature | 8 | `components/creature/` (the animated mascot) |
| Agentic marketing | 8 | `components/agentic/AgenticTradingPage.tsx` |

The two biggest single files are `discover/CoinCard.tsx` (2,218 lines) and
`discover/CardMetaRows.tsx` (1,366 lines). The coin card is the most-repeated
element in the product — a trader watches ~130 at once.

---

## 5. Reading the code

Most files carry long header comments explaining *why* something is the way it
is. A lot of it is hard-won performance work — keeping 130 live cards at 60fps
while data streams in. Those constraints are real. If a redesign changes card
height, lane scroll behaviour, or how often a component re-renders, flag it
rather than assuming it is free.

Density and stability-while-updating are hard requirements in the terminal, not
preferences. The landing page is the opposite — it is authored to two exact
anchors (1440×900 desktop, 390×844 mobile) and its section comments carry the
precise measures.

The `.ts` files without JSX (`lib/api/*`, `lib/state/*`, `lib/evm/*`, the
`use*` hooks) are the browser-side data layer — streaming, caching, formatting.
They are included so every import resolves. **There is nothing to design in
them.**

---

## 6. Integrity

Verified after all redactions:

- **744 files resolve** from the 25 page entry points, with **zero missing
  imports**. The export is a complete, self-consistent dependency graph.
- **748 files were compared against the originals with comments stripped.**
  Exactly **6** differ in code — the deliberate redactions in section 7.
  Everything else is byte-identical application code.

---

## 7. What was redacted, and why

Six files were changed on purpose. Each carries a `[REDACTED FOR EXPORT]`
marker so nothing is silently misleading.

| What | Where | Why |
|---|---|---|
| The 0–9.9 coin **score blend** | `discover/useLiveNewPairs.ts`, `trade/snapshotAdapter.ts`, `lib/api/alpha-calls-shared.ts` | The ranking heuristic is proprietary. Replaced with a fixed mid-range placeholder; layout, the score pill and its colour thresholds are unaffected — only the number is not real |
| A client mirror of a server **trading heuristic** | `lib/utils.ts` | An account allowlist, a keyword test and a per-tier sizing rule. Unused by any UI here, so removed rather than stubbed |
| A backend binary name in a status string | `listen/IngestionStatus.tsx` | Named an internal service and its build command |
| A `source:` label | `trade/EvmPriceChart.tsx` | Named an internal service. Informational field, never compared |

Separately, **~190 code comments across 60 files** were sanitized to remove
references to internal backend services, the server stack, and backend source
paths and symbols. These edits are confined to comment text — proven by the
byte-for-byte code comparison in section 6. The engineering and design
reasoning in those comments is intact; only the internal names are generalised.

**Audited clean:** no credentials or keys of any kind, no server or API-route
code, no middleware, no database, no infrastructure identifiers, hostnames,
IPs or regions, no revenue/fee/competitor data, no agent prompts or model
configuration (the agent client only renders what the server streams), no
personal or account identifiers, and no local paths.

---

## 8. If your developer wants to run it

Not a runnable app on its own — it is source for reading and redesigning.
External packages the code imports:

```
core       react · react-dom · next (navigation, image, font)
state      zustand · @tanstack/react-query · zod
auth       @clerk/nextjs · @turnkey/iframe-stamper
flags      launchdarkly-react-client-sdk
ui         @radix-ui/{dialog, popover, hover-card, tooltip, select,
             slider, collapsible, slot, use-controllable-state}
           lucide-react · sonner · frimousse · qrcode
           react-resizable-panels · react-dnd (+ html5-backend)
motion     framer-motion · motion
charts     lightweight-charts
shaders    @paper-design/shaders-react
agent      ai · streamdown (+ @streamdown/{code, math, mermaid, cjk})
           use-stick-to-bottom
styling    clsx · tailwind-merge · class-variance-authority
```

Paths under `source/` mirror the real project layout exactly, so anything you
send back can be dropped straight in.

# Listen UI sandbox — how to edit every page

Your friend's export is source for reading, not a runnable app. This wraps all
833 files in a Next.js project so every page in it renders, so you can change
something and see it a second later.

```bash
npm run dev
```

Then open <http://localhost:4312/sandbox>. That page lists every route with a
line on what it is. Save any file and the page updates without a restart.

---

## The one rule

**Everything under `source/` is your friend's code. Everything else is
scaffolding.**

All 736 of his source files are untouched, byte for byte. Edit them freely,
that is the point, and the folder drops straight back into his repo, since
paths under `source/` mirror his project exactly.

Unlike the earlier Discover sandbox, **nothing was reconstructed and nothing
was added inside `source/`**. This export resolves completely on its own: 736
files, zero missing imports. Send back the whole `source/` folder without
grepping it for anything of mine.

Scaffolding, all of it outside `source/`:

| Path | What it is |
|---|---|
| `app/` | Route shims. Each terminal and public page is one line re-exporting his page from `source/app/`, plus the layouts his server layout used to provide. |
| `app/api/` | The fake backend. Two real fixture feeds for Discover, one real fixture route for the agent wallet, one permissive catch all for everything else. |
| `sandbox/` | The stand ins: Clerk, LaunchDarkly, Turnkey, the flag table, the Discover fixtures. |
| `public` | A junction to `source/public`, so his 17 MB of assets serve from the URL his code asks for. |
| `.env.local` | His own runtime switches, described below. |
| `next.config.mjs` alias | Points `@/components/landing` at `../New folder`, the newer standalone landing export. See below. |
| `sandbox/landing.css` | The landing page's stylesheet, a copy of the one its own harness loads. The terminal's is deliberately not on that route. |
| `next.config.mjs`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.mjs` | Config. The Tailwind file loads HIS config and only rewrites the content globs. |

---

## The landing page comes from somewhere else

`/` is **not** the landing page in this export. `@/components/landing` is
aliased to `../New folder/source/components/landing`, the separate and newer
landing export with its own git history and its own harness on port 4321.
That page is a redesign: eight bands instead of nine (the Infra pyramid band
is gone), a social menu in the header, and the agent, header, hero, surfaces
and terminal bands split into their own folders.

It is aliased rather than copied, so there is one landing page on this
machine. Edit it under `../New folder/source/components/landing` and it moves
here and on 4321 at once.

**It gets its own stylesheet, and that matters.** `source/app/globals.css` is
the terminal's: 59 KB of tokens that also paints `body` and pulls in
`listen.css`, `discover.css` and `agent-chat.css`. Loading it globally put the
landing on the terminal's ground, `rgb(7, 7, 9)` instead of black, under a
base layer it was never drawn against. So the root layout imports no CSS at
all now, and each group imports what it wants: `(terminal)` and `(public)`
take the terminal stylesheet, `(landing)` takes `sandbox/landing.css`, which
is a copy of what the page's own harness loads. Checked against 4321
afterwards: same body ground, same hero box to the pixel, same height for all
eight bands, same 6070px page.

Nothing had to be adapted for it. Its two shared imports, `@/lib/utils` and
`@/components/ui/dialog`, are satisfied by this export (the dialog is
byte-identical; this `utils.ts` is a superset of that one), the Tailwind
configs are byte-identical so every `lp-*` token already resolves, and every
`/landing/*` asset it serves is already in `source/public`. The two other
importers of the landing folder here, the welcome background and the
certificate modal, take `primitives/usePrefersReducedMotion`, which is
byte-identical in both trees.

The old landing is still in `source/components/landing`, untouched and now
unreferenced. Delete the alias in `next.config.mjs` and `tsconfig.json` to go
back to it.

---

## Where the design actually lives

| Want to change | File |
|---|---|
| Colours, spacing, type, motion | `source/app/globals.css` (tokens from line 47) |
| App chrome and shared surfaces | `source/components/listen/listen.css` |
| The Discover board, lanes, density | `source/components/discover/discover.css` |
| The coin card | `source/components/discover/CoinCard.tsx` |
| The stat rows inside a card | `source/components/discover/CardMetaRows.tsx` |
| Shared vocabulary (Pill, Stat, Numeral, IconButton) | `source/components/listen/primitives/` |
| Accent palettes | `source/components/listen/theme/themes.ts` |
| The agent chat | `source/components/agent/agent-chat.css` |
| The landing page palette | `../New folder/source/components/landing/tokens.css` (scoped to `.lp`) |
| A landing band's layout or copy | `../New folder/source/components/landing/sections/` |

### A trap worth knowing

Tokens are declared twice. `globals.css` defines them on `:root`, and
`listen.css` redefines many of them again inside `.listen-root`, which is the
wrapper the whole terminal renders inside.

So for anything in the terminal, **`listen.css` wins**. Editing `--up` in
`globals.css` changes nothing visible; editing it in `listen.css` turns every
green number a different green. `globals.css` still governs the surfaces
outside the terminal shell: the landing page, onboarding, the auth pages.

### Constraints his code documents

The file headers are worth reading before changing structure. Two in
particular:

- **Density and stability are requirements, not preferences.** A trader
  watches about 130 cards at once and the layout is tuned so nothing reflows
  while data streams in. Changing card height, lane scrolling or re-render
  frequency has measured costs he records in those headers.
- **Never hardcode a hex.** New colours must be tokens, or derive from the
  accent pair, or theming breaks.

---

## What is real, and what is faked

The export has no backend by design, so the sandbox supplies one.

| Piece | What it does |
|---|---|
| `app/api/discover/*` | Real fixture data: 85 New Pairs and Graduated rows, 45 Ripening rows, shaped as the ingestion wire type and pushed over SSE. Deterministic, so a reload does not reshuffle the board under you. |
| `app/api/v1/agent-wallet` | Serves HIS OWN wire fixtures from `source/components/agent-wallet/test-fixtures.ts`, so the setup modal parses exactly what its tests parse. |
| `app/api/[...path]` | Everything else. Reads answer with an empty but permissively shaped body; writes are accepted and discarded. A click that would place an order in production does nothing here. |
| `sandbox/stubs/clerk.tsx` | Reports one signed-in user. `getToken` returns a placeholder that only the local mock ever sees. Set `SIGNED_IN` to false in that file to design the signed-out chrome. |
| `sandbox/stubs/launchdarkly.tsx` | Reads `sandbox/flags.ts`. |
| `sandbox/stubs/turnkey.ts` | Reports a successful init and then refuses the export, which is the honest answer: there is no key here to reveal. |

**What that costs you.** Anything whose visual state comes from a server
response you cannot fake sits in its empty or resting state: portfolio
positions, order history, tracked wallets, referral tables, live prices on the
trade chart. The layout, the empty states and every interaction that does not
need a server are all real.

---

## The switches

**`sandbox/flags.ts`** holds the LaunchDarkly flags. These are his real
dashboard keys and every hook behind them fails closed, so a surface appears
only when its flag is `true`. `evm-client-surface` is off by default because
the mock has no EVM positions to answer with, and leaving it on parks a
"positions stale" strip under the nav on every page. Turn it on to reach
`/discover/evm` and the EVM trade page.

**`.env.local`** holds his own runtime config, the same names production
reads (see `source/lib/runtime-config.ts`). The useful ones:

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_AGENT_CHAT` | The agent dock and the `/agent` route. The route hard 404s without it. |
| `NEXT_PUBLIC_AGENT_CHAT_MOCK` | Scripted agent replies with no model behind them. |
| `NEXT_PUBLIC_FORCE_WALLET_READY` | Paints the navbar SOL balance instead of the setup button. |
| `NEXT_PUBLIC_FORCE_AGENT_WALLET_SETUP` | `unfunded`, `final` or `ready`. Blank is off. |

Changing `.env.local` needs a dev server restart. Changing `sandbox/flags.ts`
does not.

**`app/api/v1/agent-wallet/route.ts`** has a `STATE` constant at the top:
`unfunded`, `final` or `ready`, which moves the agent wallet modal between its
three states.

**`app/api/[...path]/route.ts`** has the `/me` body. It reports a wallet in
`ready_to_trade` so the first run onboarding gate does not fire over the board
on every reload. Change it to `wallet_ready_needs_nonce_setup` to design that
path instead.

---

## Reaching the overlays

The 59 modals, docks, sheets and popovers have no URLs of their own. They open
from the surface that owns them: the wallet panel and token search from the
top nav, filters and tweaks from the Discover sub header, order confirmation
and chart settings from the trade panel, the activity and tweet docks from the
footer. One that is otherwise hard to reach has its own way in: the agent
wallet setup modal at `/agent-wallet`, which redirects into Portfolio with it
open.

The invite modal is not one of them any more. It used to be mounted on `/`
behind `?code=1`; that is gone, and invite designs live at
`/whatever?q=invite`.

---

## Two places the sandbox diverges, and why

1. **The terminal renders client side only.** `app/(terminal)/layout.tsx`
   wraps the shell in `sandbox/ClientOnly.tsx`. In this sandbox the query
   cache is seeded entirely in the browser, so the server cannot render the
   same first frame and React reports every difference as a hydration
   mismatch, which puts the error overlay over the page you are working on.
   Nothing is lost: every component under there is a client component anyway.

2. **`/agent-wallet` redirects from a copy of the href, not his constant.**
   His `source/app/(terminal)/agent-wallet/page.tsx` is a server component
   that imports `AGENT_WALLET_SETUP_HREF` from a module marked `use client`.
   Across that boundary the server gets a client reference instead of the
   string, so `redirect()` receives a function and the route answers 404.
   That is his code to change, so `source/` was left alone and the
   destination is inlined in the shim. Worth telling him: it looks like a
   real bug on a live route, not a sandbox artifact.

`/` also drops `HomeAccessGate` entirely. It both opens the invite modal and
routes an already redeemed user into `/discover`, and the mock `/me` is always
redeemed, so the gate would bounce you off the landing page before you could
look at it. The route is the landing page and nothing else.

---

## Two package versions worth knowing

The export names its dependencies but not their versions. Two had to be
pinned from what the code actually calls, and both are worth confirming
against his `package.json` before you trust anything version specific:

- **zod 4.** `source/lib/agent/contracts.ts` calls `z.looseObject`, which
  does not exist in zod 3.
- **lightweight-charts 5.** `source/components/trade/PriceChart.tsx` calls
  `chart.addSeries(CandlestickSeries, ...)`, the v5 API.

`@paper-design/shaders-react` is pinned at the latest release because the
landing page imports `GemSmoke`, which older versions do not export.

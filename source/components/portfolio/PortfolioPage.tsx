'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WalletsTab } from './WalletsTab';
import { PerpsComing } from './PerpsComing';
import { SpotTab } from './spot/SpotTab';
import {
  AGENT_WALLET_PARAM,
  PORTFOLIO_TAB_PARAM,
  initialPortfolioTab,
  isAgentSetupInQuery,
  type PortfolioTab,
} from './agentWallet';
/* The portfolio's own ground and type, in black. Imported here as well
   as in `SpotHeader` so the panel rule lands on the Wallets and
   Perpetuals tabs too, which never mount that header. */
import './spot/spot-ledger.css';

/**
 * Slice "Portfolio page wallets tab" → "Portfolio Spot tab":
 * top-level portfolio surface. Mounted at `/portfolio`. Three top
 * tabs (Spot / Wallets / Perpetuals); Spot is now the default and
 * is fully wired. Perpetuals remains a "coming soon" placeholder.
 *
 * Layout follows the same `.listen-root` chrome the trade page uses:
 *   - topnav rendered by `TerminalShell`
 *   - main panel wrapped in `.panel` so it picks up `--section-bg`
 *     (parchment under zen, dark under cyan/sunset/etc.)
 */

type Tab = PortfolioTab;

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'spot', label: 'Spot' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'perpetuals', label: 'Perpetuals' },
];

export function PortfolioPage(): React.ReactElement {
  // Deep link, not a controlled binding: the query SEEDS the tab (so
  // `/portfolio?tab=wallets&agent=setup` — where the retired
  // `/agent-wallet` route now lands — opens on Wallets with the agent
  // modal up), and clicking a tab thereafter is plain local state.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    initialPortfolioTab({
      tab: searchParams?.get(PORTFOLIO_TAB_PARAM),
      agent: searchParams?.get(AGENT_WALLET_PARAM),
    }),
  );
  const [initialAgentModalOpen] = useState<boolean>(() =>
    isAgentSetupInQuery(searchParams?.get(AGENT_WALLET_PARAM)),
  );
  return (
    <main
      /* `gap-5`, not `gap-3`. With the underline gone the tab labels sit
         on nothing, and 12px put the page's first line close enough to
         them to read as one block — the total was almost touching the
         word above it. */
      className="flex-1 min-h-0 flex flex-col gap-5 p-3 lg:p-4 overflow-hidden"
      style={{ maxHeight: 'var(--h-app-content)' }}
    >
      <nav
        role="tablist"
        aria-label="Portfolio sections"
        className="flex items-center gap-4 px-1"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="relative inline-flex items-center h-[34px] px-1 text-[15px]"
              style={{
                color: active ? 'var(--ink-0)' : 'var(--ink-3)',
                fontWeight: active ? 600 : 500,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              {/*
                * ── NO UNDERLINE ────────────────────────────────────
                *
                * The live tab is the white one, and that is the whole
                * signal. It carried a 2px rule under it — first the
                * app's cyan-into-violet accent pair, then mint into
                * white — and either way it was a second thing saying
                * what the ink already said, on a page whose every other
                * live-state is one step of brightness.
                */}
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'wallets' ? (
        // Wallets tab owns its own panel chrome so the stats / search
        // strip can live above the panel, while the panel wraps the
        // list and the transfer rail.
        <WalletsTab initialAgentModalOpen={initialAgentModalOpen} />
      ) : tab === 'spot' ? (
        <SpotTab />
      ) : (
        /* No panel wrapper and no padding: this screen is full bleed on
           purpose — the ticker runs to both edges and stands on the
           bottom one. */
        <section
          role="tabpanel"
          aria-label={`${tab} tab`}
          /*
           * `flex` as well as `flex-1`: the screen inside sizes itself
           * from this box, and without a flex context it collapsed to
           * its content height — the ticker landed at 15% of a 40px box
           * and sat on top of the word.
           *
           * The negative margins cancel `<main>`'s own `p-3 lg:p-4` on
           * three sides. Every other tab wants that padding; this one is
           * full bleed, and a ticker that stops 16px short of the footer
           * with a strip of black under it is a ticker sitting IN the
           * page rather than being it. The top keeps its padding so the
           * tabs above stay where they are on every tab.
           */
          className="flex-1 min-h-0 flex overflow-hidden -mx-3 -mb-3 lg:-mx-4 lg:-mb-4"
        >
          <PerpsComing />
        </section>
      )}
    </main>
  );
}

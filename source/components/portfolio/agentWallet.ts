'use client';

/**
 * Slice "Agent wallet in Portfolio → Wallets": the PURE derivations
 * behind the agent-wallet row, its delegation chip, and the deep-link
 * that opens the setup modal.
 *
 * Everything here is a total function of its arguments so the terminal's
 * DOM-free test setup (`renderToStaticMarkup` + plain assertions) can
 * cover the modal's open/closed states and the no-wallet vs
 * wallet-exists split without a renderer or a router.
 *
 * SERVER TRUTH, same doctrine as `components/agent-wallet/types.ts`:
 * nothing here recomputes readiness, and an enum the server sent that we
 * do not recognise renders VERBATIM in a degraded tone rather than being
 * coerced into a known member or dropped.
 */

import type { AgentWalletDelegation } from '@/components/agent-wallet/types';

/** Query param that deep-links the Portfolio page to a tab. */
export const PORTFOLIO_TAB_PARAM = 'tab';
/** Query param that deep-links the agent-wallet setup modal open. */
export const AGENT_WALLET_PARAM = 'agent';
/** The only value of {@link AGENT_WALLET_PARAM} that opens the modal. */
export const AGENT_WALLET_SETUP_VALUE = 'setup';

export type PortfolioTab = 'spot' | 'wallets' | 'perpetuals';

const PORTFOLIO_TABS: readonly PortfolioTab[] = ['spot', 'wallets', 'perpetuals'];

/**
 * The href that opens Portfolio → Wallets with the setup modal already
 * open. This is what `/agent-wallet` redirects to and what the top nav
 * points at, so a bookmark of the old page keeps working.
 */
export const AGENT_WALLET_SETUP_HREF =
  `/portfolio?${PORTFOLIO_TAB_PARAM}=wallets&${AGENT_WALLET_PARAM}=${AGENT_WALLET_SETUP_VALUE}` as const;

/** Narrows the `?tab=` value; anything unrecognised falls back to Spot. */
export function portfolioTabFromQuery(raw: string | null | undefined): PortfolioTab {
  if (typeof raw !== 'string') return 'spot';
  const found = PORTFOLIO_TABS.find((t) => t === raw);
  return found ?? 'spot';
}

/**
 * True when the query asks for the setup modal. Deliberately exact:
 * a stray `?agent=1` does not open a ceremony that can create a wallet.
 */
export function isAgentSetupInQuery(raw: string | null | undefined): boolean {
  return raw === AGENT_WALLET_SETUP_VALUE;
}

/**
 * The tab a deep-link implies. `?agent=setup` lands on Wallets even
 * without an explicit `?tab=`, so the modal never opens over the Spot
 * tab where the wallets table it belongs to is not mounted.
 */
export function initialPortfolioTab(params: {
  readonly tab: string | null | undefined;
  readonly agent: string | null | undefined;
}): PortfolioTab {
  if (isAgentSetupInQuery(params.agent)) return 'wallets';
  return portfolioTabFromQuery(params.tab);
}

export type DelegationTone = 'good' | 'warn' | 'bad';

export interface DelegationChip {
  /** Short label for the row chip. */
  readonly label: string;
  readonly tone: DelegationTone;
  /** Long-form title/tooltip text. */
  readonly title: string;
  /** True when the server sent an enum we do not recognise. */
  readonly degraded: boolean;
}

/**
 * Collapses the two delegation enums into the one chip the row shows.
 *
 * `state` and `mode` are independent on the wire, and the pair the
 * product cares about is "durable AND active" — a durable grant that
 * has been revoked is NOT durable in any sense the user benefits from,
 * so `revoked` wins over `mode` here.
 */
export function delegationChip(delegation: AgentWalletDelegation): DelegationChip {
  const state = delegation.state.known;
  const mode = delegation.mode.known;

  if (state === null) {
    return {
      label: delegation.state.raw,
      tone: 'warn',
      title: `Unrecognised delegation state "${delegation.state.raw}". Update or contact support.`,
      degraded: true,
    };
  }
  if (state === 'revoked') {
    return {
      label: 'revoked',
      tone: 'bad',
      title: 'Authorization revoked — the agent cannot trade this wallet.',
      degraded: false,
    };
  }
  if (state === 'paused') {
    return {
      label: 'paused',
      tone: 'warn',
      title: 'Authorization paused — the agent will not place new trades.',
      degraded: false,
    };
  }
  // state === 'active' from here.
  if (mode === 'durable') {
    return {
      label: 'durable',
      tone: 'good',
      title:
        'Durable authorization — the agent keeps trading while you are signed out. No tab needs to stay open.',
      degraded: false,
    };
  }
  if (mode === 'session') {
    return {
      label: 'session',
      tone: 'warn',
      title: 'Session authorization only — re-authorize for durable agent trading.',
      degraded: false,
    };
  }
  if (mode === 'none') {
    return {
      label: 'none',
      tone: 'warn',
      title: 'No authorization yet — the agent cannot trade this wallet.',
      degraded: false,
    };
  }
  return {
    label: delegation.mode.raw,
    tone: 'warn',
    title: `Unrecognised delegation mode "${delegation.mode.raw}". Update or contact support.`,
    degraded: true,
  };
}

/** Label the synthetic entry (and therefore every rail/modal) shows. */
export const AGENT_WALLET_LABEL = 'Agent wallet';

/**
 * The disclosure shown at the confirm moment for a transfer OUT of the
 * agent wallet.
 *
 * This is not a caution we invented: `POST /api/v1/wallets/transfer`
 * auto-pauses every armed conditional in the SAME reserve transaction
 * when the SOURCE is the agent wallet (api/src/routes/wallets/transfer.ts,
 * WP-13 plan §13.7). The user cannot avoid that side effect, so the only
 * honest thing to do is name it before they commit.
 */
export const AGENT_WITHDRAWAL_WARNING =
  'This moves SOL out of your agent wallet, which pauses every armed conditional until you re-enable them.';

/**
 * True when a transfer's SOURCE side includes the agent wallet — the
 * case that triggers the api's auto-pause.
 *
 * Deliberately source-only: funding the agent wallet (agent on the
 * DESTINATION side) has no such side effect and stays frictionless.
 * Returns false when there is no agent wallet, so an unrelated transfer
 * can never show the warning.
 */
export function isAgentWithdrawal(
  sources: ReadonlyArray<string>,
  agentWalletAccountId: string | null | undefined,
): boolean {
  if (typeof agentWalletAccountId !== 'string' || agentWalletAccountId.length === 0) return false;
  return sources.includes(agentWalletAccountId);
}

/*
 * REMOVED: `agentWalletToEntry(status): MeWalletEntry`.
 *
 * It existed because `listWalletAccountsForUser` filtered
 * `purpose = 'user'`, which kept the agent wallet out of `/me`, out of
 * the wallet picker and out of every portfolio total — so the terminal
 * fabricated a `MeWalletEntry` from the agent-wallet status route to
 * have something table- and rail-shaped to render.
 *
 * The api now returns the agent wallet in `/me.wallets` and in
 * `/api/v1/wallets/balances` as a real entry (`purpose: 'agent'`,
 * ordered last), and every trading path accepts it. A synthetic copy
 * alongside the real one could only double-render it, double-count it,
 * or disagree with it — so the copy is gone and every surface reads the
 * server's entry. `AGENT_WALLET_LABEL` above is still the display name
 * (see `walletDisplayName`), and the delegation enums, which `/me` does
 * not carry, still come from the status route via `delegationChip`.
 */

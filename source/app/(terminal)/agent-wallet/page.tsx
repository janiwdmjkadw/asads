import { redirect } from 'next/navigation';
import { AGENT_WALLET_SETUP_HREF } from '@/components/portfolio/agentWallet';

/**
 * RETIRED ROUTE — kept as a redirect, not deleted.
 *
 * The agent-wallet surface moved into Portfolio → Wallets (owner
 * decision, Aug 2026): the ceremony is now a modal over the wallets
 * table, and the wallet itself renders as a row in that table's Agent
 * group. This route survives so existing bookmarks and any link that
 * still points here land on the same flow with the modal already open,
 * rather than a 404.
 *
 * A permanent redirect is deliberately NOT used: `redirect()` issues a
 * 307, so nothing is cached in a user's browser that we would have to
 * outlive if the agent wallet ever gets its own page again.
 */
export default function AgentWalletRoute(): never {
  redirect(AGENT_WALLET_SETUP_HREF);
}

/**
 * Component 4 agent-wallet onboarding surface.
 *
 *   import { AgentWalletPanel } from '@/components/agent-wallet';
 *
 * The agent-wallet CEREMONY: create, funding address, nonce pool,
 * readiness, and the two-stage delegation grant / revoke. No
 * `/internal/**` route is reachable from this module, and the panel
 * itself still contains no transfer, funding, defunding or withdrawal
 * control — within it, the user funds the wallet by sending SOL to the
 * displayed address.
 *
 * OWNER CHANGE (Aug 2026), superseding "this is the agent wallet's ONLY
 * product surface, deliberately absent from every wallet picker":
 * Portfolio → Wallets now renders the agent wallet as a distinguished
 * row in its own group and mounts this panel inside
 * `components/portfolio/AgentWalletModal`. Funding may also ride the
 * ordinary drag-to-transfer rail, which addresses the agent wallet by
 * its `wallet_account_id` — a path the api already permits, because the
 * transfer route resolves endpoints with the purpose-UNFILTERED
 * `getWalletAccountByIdForUser`.
 *
 * WHAT DID NOT CHANGE: the agent wallet is still absent from the TRADE
 * wallet picker and from every portfolio total, because
 * `listWalletAccountsForUser` remains `purpose = 'user'`. Do not reuse
 * this module to put it in a trade-side picker.
 */

export { AgentWalletPanel, AGENT_WALLET_QUERY_KEY } from './AgentWalletPanel';
export { AgentWalletSurface, type AgentWalletSurfaceProps } from './AgentWalletSurface';
export { AgentWalletSetupModal } from './AgentWalletSetupModal';
export { deriveNavSlotState, deriveSetupCards, type NavSlotState } from './setup-state';
export {
  createAgentWallet,
  fetchAgentWalletStatus,
  grantAgentWalletDelegation,
  revokeAgentWalletDelegation,
  setupAgentWalletNonces,
} from './client';
export {
  parseCreateResponse,
  parseGrantResponse,
  parseRevokeResponse,
  parseStatusResponse,
} from './parse';
export * from './types';

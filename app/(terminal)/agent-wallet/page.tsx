import { redirect } from 'next/navigation';

/*
 * Route shim, and the one place where the shim does NOT simply re-export the
 * export's page.
 *
 * `source/app/(terminal)/agent-wallet/page.tsx` is a retired route kept as a
 * redirect into Portfolio → Wallets with the setup modal already open. It is
 * a server component, and it builds that destination from
 * AGENT_WALLET_SETUP_HREF in `@/components/portfolio/agentWallet` — a module
 * marked `'use client'`. Importing a value across that boundary hands the
 * server a client reference rather than the string, so `redirect()` receives
 * a function and the route answers 404.
 *
 * That is your friend's code to change, not the sandbox's, so nothing under
 * `source/` is touched. The destination is inlined here instead, spelled
 * exactly as `agentWallet.ts` builds it, so the surface is reachable while
 * you work.
 */

const AGENT_WALLET_SETUP_HREF = '/portfolio?tab=wallets&agent=setup';

export default function AgentWalletRoute(): never {
  redirect(AGENT_WALLET_SETUP_HREF);
}

import type { MeNonceSetup } from '@/lib/api/me';

/**
 * Slice "No-nonce trading" (D10): how a wallet's nonce pool should be
 * presented. Derived from `/me` alone — the api owns the decision, the
 * Terminal never carries a flag of its own.
 *
 *  - `required` — trading waits on setup. Today's behaviour, unchanged.
 *  - `optional` — the api reports the wallet trade-ready with an
 *    unprovisioned pool (nonceless mode). Setup is still OFFERED as a
 *    faster-lanes step; it must never gate anything.
 *  - `complete` — the pool is provisioned; there is nothing left to
 *    offer.
 */
export type NonceSetupSurface = 'required' | 'optional' | 'complete';

export function nonceSetupSurface(nonceSetup: MeNonceSetup): NonceSetupSurface {
  if (nonceSetup.required) return 'required';
  return nonceSetup.active_count >= nonceSetup.target_count ? 'complete' : 'optional';
}

/**
 * The live plan's state → the card's phase.
 *
 * OPEN ENUM. Only the words this build knows are translated; anything else
 * travels through as the SERVER's own string and the card says so rather
 * than guessing which family it belongs to. `cancel_requested` and
 * `expiry_pending` are deliberately in that bucket: they are in-flight, and
 * calling them "cancelled" or "expired" would be the card reporting an
 * outcome the server has not reached.
 *
 * It lives beside the card rather than inside `ProposalPart` because the
 * card now has TWO containers — the chat message and the conditional's own
 * page — and a second copy of this table is a second answer to "is this
 * plan live", which is exactly the disagreement the card's phase families
 * exist to prevent.
 */

import type { CardPhase } from './ProposalCardV2';

export function livePhase(state: string): {
  readonly phase: CardPhase;
  readonly stateLabel?: string;
} {
  switch (state) {
    case 'armed':
      return { phase: 'activated' };
    case 'paused':
    case 'budget_paused':
      return { phase: 'paused' };
    case 'completed':
      return { phase: 'completed' };
    case 'cancelled':
      return { phase: 'cancelled' };
    case 'expired':
      return { phase: 'plan_expired' };
    case 'draft':
    case 'pending_auth':
      return { phase: 'authorized' };
    default:
      return { phase: 'unknown', stateLabel: state };
  }
}

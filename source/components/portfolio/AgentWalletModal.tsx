'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AgentWalletPanel } from '@/components/agent-wallet';

/**
 * Slice "Agent wallet in Portfolio → Wallets": the agent-wallet
 * ceremony, as a modal over the wallets table.
 *
 * This is the WHOLE flow, not a trimmed setup wizard — create, funding
 * address, nonce-pool provisioning (including its dry-run and
 * failed/missing-slot states), readiness, and the two-stage delegation
 * grant plus revoke. `AgentWalletPanel` is mounted verbatim, so setup
 * and ongoing management are the same surface and nothing about an
 * agent wallet requires visiting another page to complete.
 *
 * WHY THE PANEL IS NOT FORKED: the panel owns the status query, the
 * post-action re-read, and the confirmation stage that keeps a
 * grant-capable control off screen until the user asks for one. A modal
 * copy of that logic would be a second place for the ceremony to drift
 * from the server's gate ladder.
 *
 * MOUNT/UNMOUNT IS DELIBERATE: the panel only renders while `open`, so
 * its 15s status poll stops when the modal closes. That is safe
 * precisely because the durable authorization has no browser-presence
 * deadline — nothing here keeps a grant alive, so nothing is lost by
 * not polling. Remounting also resets the grant confirmation stage, so
 * a reopened modal never resumes mid-ceremony.
 *
 * STEP-UP: the delegation grant's step-up is a same-page, two-call
 * ceremony (`requestSensitiveActionChallenge` then the grant POST in
 * `components/agent-wallet/client.ts`) — there is no auth redirect and
 * no return trip, so the modal has no round-trip to preserve. The
 * `?agent=setup` deep link exists for linkability, and it also means
 * that IF a step-up ever gains a redirect, the URL already carries
 * enough state to re-open this modal on return.
 */

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AgentWalletModal(props: Props): React.ReactElement {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/*
        * WHITE, like the Flash dialog. The surface inside carries the
        * whole voice now — its own title, its own body — so the dialog
        * header would be a second heading over the first. It stays in
        * the tree for the accessible name and is hidden from sight.
        */}
      <DialogContent
        data-testid="agent-wallet-modal"
        className="max-w-lg gap-0 max-h-[85vh] overflow-y-auto"
        style={{
          /* The shared portal tokens: paper on light, the terminal's
             own plate on dark. Declared in `globals.css`. */
          background: 'var(--ui-paper)',
          color: 'var(--ui-ink)',
          borderColor: 'transparent',
          borderRadius: 12,
          padding: '34px 32px 28px',
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Agent wallet</DialogTitle>
          <DialogDescription>
            Fund it, provision its nonce pool, and authorize the agent to trade from it.
          </DialogDescription>
        </DialogHeader>
        {props.open ? <AgentWalletPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

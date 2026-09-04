'use client';

/**
 * Deep-linkable approval surface for one proposal.
 *
 * The api stamps `approval_target: /trade/proposals/<id>` onto every
 * proposal it creates (`api/src/agent/act`), and that link had no route
 * behind it — it 404'd. This page is that route, and it renders the
 * SAME card chat renders (`ProposalPart` → `useProposalCard`), so an
 * approval is the same ceremony wherever it is reached from.
 *
 * The URL is treated exactly like chat content: it supplies an id and
 * nothing else, and the card fetches the canonical record by that id
 * (04-frontend.md invariant 1). A malformed id resolves to no ref, and
 * the card says so rather than rendering a blank (invariant 5).
 *
 * Auth, shell and nav come from the `(terminal)` layout. `/trade/…`
 * activates no persistent pane here — `PersistentTradePane` only claims
 * single-segment base58 mints — so this route paints on its own.
 */

import { useParams } from 'next/navigation';
import { ProposalPart } from '@/components/agent/proposal';

export default function ProposalRoute() {
  const params = useParams();
  const rawId = params?.id;
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? (rawId[0] ?? '') : '';

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-4 py-4">
      <ProposalPart part={{ proposal_id: id }} />
    </main>
  );
}

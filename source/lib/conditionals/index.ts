/**
 * The shared typed port over the trade-control user-facing api.
 *
 *   import { fetchProposal, decideProposal } from '@/lib/conditionals';
 *   import type { ProposalDetail, AuthorizationView } from '@/lib/conditionals';
 *
 * Server truth only: proposals are fetched by id, lifecycle states come
 * from the server record, and agent-wallet readiness is read from
 * `/api/v1/me` (see the note in `client.ts`) — never inferred in the
 * browser. Operator `/internal/**` routes are not part of this port.
 */

export * from './types';
export * from './parse';
export * from './client';

/**
 * Inline proposal / authorization card (Component 4).
 *
 * Mount `ProposalPart` for a `proposal_ref` content part; everything
 * else here exists for tests and for hosts that already hold a
 * `ProposalDetail`.
 */

export { ProposalCard, ProposalCardSkeleton, ProposalCardStatus } from './ProposalCard';
export type { ProposalCardProps } from './ProposalCard';
export { ProposalPart } from './ProposalPart';
export type { ProposalPartProps } from './ProposalPart';
export { PROPOSAL_CREATED_STATUS, proposalRefFromPart, proposalRefFromToolResult } from './ref';
export type { ProposalRef } from './ref';
export {
  conditionalStateFromDecision,
  loadProposalCard,
  useProposalCard,
} from './useProposalCard';
export type { ProposalCardState, ProposalDecider, ProposalFetcher, UseProposalCardOptions } from './useProposalCard';
export { classifyDecision, classifyLoad, reauthAffordance, reauthReasonText } from './decision';
export type { DecisionPhase, ProposalLoadPhase, ReauthAffordance } from './decision';
export {
  acceptsDecision,
  armedFromServer,
  buildProposalCardModel,
  expiryCountdown,
  isHiddenPredicateKind,
  proposalPhase,
} from './model';
export type { ExpiryCountdown, ProposalCardModel, ProposalPhase, RevisionLineage } from './model';

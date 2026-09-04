/**
 * Proofs → lines. Each firing's `proofs[]` (api `buildProofs`) becomes one
 * line per condition node: the CLAIM (what the plan asked) and the FACT
 * as a sentence, with at most one link — the tweet, the Solscan tx — and
 * at most one token to draw as a chip. Pure; combinator nodes are dropped
 * here because "and of the conditions below" says nothing a list does not.
 */

import type { ConditionalProof } from '@/lib/conditionals/types';
import { formatSol } from './pnl';

export interface ProofLine {
  readonly key: string;
  readonly kind: string;
  readonly claim: string;
  /** The fact as a sentence; '' when only the chip/link says it. */
  readonly text: string;
  /** External destination (x.com status, solscan tx). */
  readonly href: string | null;
  readonly linkLabel: string | null;
  /** Token to draw as a clickable chip. */
  readonly mint: string | null;
  readonly unresolved: boolean;
}

export function shortHandle(handle: string): string {
  return `@${handle.replace(/^@/, '')}`;
}

function short(address: string): string {
  return address.length <= 9 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function excerpt(text: string | null, max = 80): string {
  if (text === null) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function proofLine(firingId: string, proof: ConditionalProof): ProofLine | null {
  const base = { key: `${firingId}:${proof.node_idx}`, kind: proof.kind, claim: proof.claim, href: null, linkLabel: null, mint: null, unresolved: false };
  const fact = proof.fact;
  switch (fact.type) {
    case 'op':
      return null;
    case 'tweet': {
      const quote = excerpt(fact.text);
      return { ...base, text: quote === '' ? '' : `“${quote}”`, href: fact.url, linkLabel: shortHandle(fact.handle) };
    }
    case 'deploy':
      return { ...base, text: fact.creator === null ? 'deployed' : `deployed by ${short(fact.creator)}`, mint: fact.mint };
    case 'join':
      return {
        ...base,
        text: fact.tweet_id === null ? 'metadata links the tweet' : `metadata links tweet ${fact.tweet_id}`,
        href: fact.tweet_url,
        linkLabel: fact.tweet_url === null ? null : 'open tweet',
        mint: fact.mint,
      };
    case 'market_level':
      return { ...base, text: `reached (level v${fact.entity_version})` };
    case 'wallet_trade': {
      const lamports = /^\d+$/.test(fact.sol_lamports) ? BigInt(fact.sol_lamports) : null;
      const amount = lamports === null ? '' : ` ${formatSol(lamports)} SOL`;
      return {
        ...base,
        text: `${short(fact.wallet)} ${fact.side === 'sell' ? 'sold' : 'bought'}${amount}`,
        href: fact.solscan_url,
        linkLabel: 'tx',
        mint: fact.mint,
      };
    }
    case 'event':
      return { ...base, text: `${fact.kind.replace(/_/g, ' ')} on ${fact.entity_id}` };
    case 'unresolved':
      return { ...base, text: 'record not readable right now', unresolved: true };
    default:
      return { ...base, text: 'record not readable right now', unresolved: true };
  }
}

export function proofLines(firingId: string, proofs: readonly ConditionalProof[] | undefined): readonly ProofLine[] {
  if (proofs === undefined) return [];
  const out: ProofLine[] = [];
  for (const proof of proofs) {
    const line = proofLine(firingId, proof);
    if (line !== null) out.push(line);
  }
  return out;
}

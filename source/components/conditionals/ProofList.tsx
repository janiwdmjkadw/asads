'use client';

/**
 * WHY IT FIRED — the proof lines under a firing: one per condition leaf,
 * the plan's own claim in grey and the record's fact in ink, with the one
 * link (tweet, tx) and the one token chip the fact carries.
 *
 * Quiet by design: 12.5px, no boxes, no marks — it sits inside a row that
 * is already open, under the record the broker would show, and says what
 * the evidence was in the page's own typography.
 */

import type { ReactElement } from 'react';

import { TokenChip } from './TokenChip';
import type { ProofLine } from './proofs-model';

const CLAIM = 'text-[11.5px] leading-[1.4] text-[var(--ink-2)]';
const FACT = 'text-[12.5px] leading-[1.45] text-[var(--ink-1)]';
const LINK =
  'text-[var(--acc-0,#8ab4ff)] underline decoration-[rgba(138,180,255,.35)] underline-offset-[3px] ' +
  'transition-colors hover:text-[var(--ink-0)]';

export function ProofList({ lines, testid }: { readonly lines: readonly ProofLine[]; readonly testid?: string }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <ol className="m-0 flex list-none flex-col gap-[9px] p-0" data-testid={testid ?? 'cd-proofs'}>
      {lines.map((line) => (
        <li key={line.key} className="min-w-0" data-testid="cd-proof" data-kind={line.kind} data-unresolved={line.unresolved ? 'true' : 'false'}>
          <div className={CLAIM}>{line.claim}</div>
          <div className={`${FACT} flex min-w-0 flex-wrap items-center gap-x-[7px] gap-y-[3px]`}>
            {line.mint === null ? null : <TokenChip mint={line.mint} testid="cd-proof-token" />}
            {line.text === '' ? null : <span className={line.unresolved ? 'text-[var(--ink-2)]' : ''}>{line.text}</span>}
            {line.href === null ? null : (
              <a href={line.href} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="cd-proof-link">
                {line.linkLabel ?? 'open'}
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

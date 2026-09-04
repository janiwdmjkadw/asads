'use client';

/**
 * The judge's ledger, over the landing. Opened from a ledger row's judge
 * stat; the row's own tally is shown at once and the candidates arrive
 * from `/state`, which this keeps polling (5 s, 2 s while live) for as
 * long as the dialog is open — a verdict that lands while you are
 * reading shows up. The query is gated on `open`, so a closed modal
 * costs the list page nothing.
 *
 * Frame: the app's Radix dialog (portals into `.listen-root` so the
 * theme tokens reach it), drawn in the ledger's own materials — surface,
 * hairline, the card radius — and no accent: this is a record, not an
 * action.
 */

import { useMemo, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { ClassifierSummary } from '@/lib/conditionals';
import { ClassifierCandidatesPanel } from './ClassifierCandidatesPanel';
import type { ClockContext } from './ledger-model';
import { useConditionalState } from './useConditionals';

export interface ClassifierCandidatesModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly conditionalId: string;
  readonly summary: ClassifierSummary | null;
  readonly timeZone: string;
}

export function ClassifierCandidatesModal({
  open,
  onClose,
  conditionalId,
  summary,
  timeZone,
}: ClassifierCandidatesModalProps): ReactElement {
  const state = useConditionalState(open ? conditionalId : null);
  const value = state.data !== undefined && state.data.ok ? state.data.value : null;
  // `undefined` = still loading; `null` = the route answered without a
  // block (an older api, or a failed read) — the panel says which.
  const block = state.data === undefined ? undefined : (value?.classifier ?? null);
  const ctx = useMemo<ClockContext>(
    () => ({ timeZone, nowMs: Date.now() }),
    // Re-anchor "now" on every poll so the projected rate moves with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeZone, state.dataUpdatedAt],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="max-h-[min(86vh,760px)] overflow-y-auto rounded-[var(--r-card)] border border-[var(--hairline)] bg-[var(--surface)] p-[22px] text-[var(--ink-1)] shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        style={{ width: 'min(640px, calc(100vw - 32px))', maxWidth: 'none' }}
        data-testid="cdl-judge-modal"
      >
        <DialogTitle className="m-0 mb-[14px] font-[family-name:var(--display)] text-[22px] font-normal leading-[1.2] tracking-[-.01em] text-[var(--ink-0)]">
          The judge
        </DialogTitle>
        <ClassifierCandidatesPanel block={block} summary={summary} ctx={ctx} />
      </DialogContent>
    </Dialog>
  );
}

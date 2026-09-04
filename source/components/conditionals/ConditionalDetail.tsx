'use client';

/**
 * `/conditionals/<id>` — THE DETAIL, AS ITS OWN PAGE.
 *
 * It used to be the bottom half of the landing: `?id=` swapped the ribbon
 * in UNDER the ledger, so a reader who opened a play kept the serif page
 * title and the four-segment toggle above it — a page header that belonged
 * to a different page. The detail is now a route, and this is its wired
 * container.
 *
 * The top line is the lab's own back affordance (p5), and it holds one
 * job: the way back. It used to state the poll cadence on the right
 * ("Rechecked 17:19 · every 5s"); the owner cut it — the page reporting on
 * its own polling is furniture, and the polling is unchanged. No title, no
 * toggle: the view below carries its own header, and always did.
 *
 * IT OWNS FOUR READS, and the fourth is the only interesting one: the
 * card's envelope is on the PROPOSAL route, and which proposal authorizes
 * the current revision is a fact only the detail carries — so that read
 * chains off the detail rather than off the id. The LIST is read too, for
 * the two facts only a list row serves (when the play was created, and the
 * list's own fired count); coming from the ledger it is already cached, and
 * on a cold deep link it costs one request.
 *
 * Isolation (04-frontend.md invariant 4): its queries live under the
 * conditionals key space and it subscribes to no chart/feed store.
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  agentWalletReadiness,
  cancelConditional,
  resumeConditional,
  type ConditionalStateResponse,
} from '@/lib/conditionals';
import { useMe } from '@/lib/api/me';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowMark } from '@/components/agent/proposal/v2/marks';
import { ConditionalDetailView } from './ConditionalDetailView';
import { mutationFeedback, type MutationFeedback } from './controls';
import { errorGuidance, walletGuidance, type Guidance, type GuidanceActionKind } from './guidance';
import { GuidanceNotice } from './GuidanceNotice';
import type { ClockContext } from './ledger-model';
import {
  CONDITIONALS_QUERY_KEY,
  useConditionalDetail,
  useConditionalEventPush,
  useConditionalProposal,
  useConditionalState,
  useConditionalsList,
} from './useConditionals';

/** Where the back affordance goes. The landing opens on Active by design. */
export const CONDITIONALS_LANDING_HREF = '/conditionals';

/**
 * THE WAY BACK, drawn as an arrow rather than an 11px chevron.
 *
 * It is the v2 `ArrowMark` mirrored — the same 12-unit grid, the same
 * 1.7-unit stroke, the same cap and join as every other mark on the
 * surface — so back and forward are one glyph read in two directions
 * rather than two drawings that happen to point at each other. A chevron
 * this size read as a decoration on the shipped page; an arrow at the
 * label's own size reads as the control it is, and it travels 2px on
 * hover the way the card's arrow does.
 */
const BACK_ARROW =
  'h-[12px] w-[18px] flex-none -scale-x-100 transition-transform duration-[.14s] ' +
  'ease-[var(--ease)] group-hover:-translate-x-[2px]';

export function ConditionalDetail({
  conditionalId,
  onGuidanceAction,
  onRequestModification,
}: {
  readonly conditionalId: string;
  /**
   * Wire the actions this app already owns: `open_wallet_setup` opens the
   * wallet setup flow, `refresh_authorization` re-authorizes the agent
   * wallet. `retry` is handled here. Unwired actions render as instruction
   * text, never as dead buttons.
   */
  readonly onGuidanceAction?: ((action: GuidanceActionKind) => void) | undefined;
  /** Modification mints a NEW revision proposal, which the agent composes. */
  readonly onRequestModification?: ((conditionalId: string) => void) | undefined;
}): ReactElement {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);

  const id = conditionalId === '' ? null : conditionalId;
  const list = useConditionalsList();
  const detail = useConditionalDetail(id);
  const state = useConditionalState(id);
  // Push: this plan's own events refresh the page the instant they land.
  // The polls above stay as the backstop (muted plans, stream down).
  useConditionalEventPush(id);
  const detailValue = detail.data !== undefined && detail.data.ok ? detail.data.value : null;
  const proposal = useConditionalProposal(detailValue?.proposal_id ?? null);
  const me = useMe();

  const nowMs = Date.now();
  /** The viewer's own zone, resolved once — every instant here is local. */
  const ctx = useMemo<ClockContext>(
    () => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nowMs }),
    [nowMs],
  );

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CONDITIONALS_QUERY_KEY });
  }, [queryClient]);

  const handleGuidanceAction = useCallback(
    (action: GuidanceActionKind) => {
      if (action === 'retry') {
        refetchAll();
        return;
      }
      onGuidanceAction?.(action);
    },
    [onGuidanceAction, refetchAll],
  );

  const runMutation = useCallback(
    async (action: 'cancel' | 'resume') => {
      if (id === null || busy) return;
      setBusy(true);
      const result =
        action === 'cancel' ? await cancelConditional(id) : await resumeConditional(id);
      setFeedback(mutationFeedback(action, result));
      setBusy(false);
      // The server record moved (or proved it had already moved) — reread
      // rather than patching a local copy: state is the server's.
      refetchAll();
    },
    [busy, id, refetchAll],
  );

  const stateValue: ConditionalStateResponse | null =
    state.data !== undefined && state.data.ok ? state.data.value : null;

  // The ledger row for this conditional: when the play was created, and
  // the list's own fired count. Both are facts the detail route does not
  // serve, and the rail and identity strip want them.
  const summaryRow =
    id === null || list.data === undefined || !list.data.ok
      ? null
      : (list.data.value.conditionals.find((row) => row.conditional_id === id) ?? null);

  const walletNotice: Guidance | null =
    me.data === undefined || me.data.reauth_required
      ? null
      : walletGuidance(agentWalletReadiness(me.data.provisioning.state));

  const detailError =
    detail.data !== undefined && !detail.data.ok ? errorGuidance(detail.data.error) : null;
  const stateError =
    state.data !== undefined && !state.data.ok ? errorGuidance(state.data.error) : null;

  const notices: readonly Guidance[] = [
    ...(walletNotice === null ? [] : [walletNotice]),
    ...(stateError === null ? [] : [stateError]),
  ];

  return (
    // THE READING MEASURE IS 720px (P5-A2), and the way back shares its
    // left edge — the arrow, the title, the status line, the tabs and every
    // feed row start on one line down the page.
    <div
      className="mx-auto flex w-full min-w-0 max-w-[720px] flex-col"
      data-testid="conditional-detail-page"
    >
      {/* The way back, and nothing else. It is the only page furniture the
          detail has — the landing's title and toggle belong to the
          landing. The negative margins keep the affordance's hit area
          (≈31px tall) off the page's spacing: the label still starts on
          the header's own left edge. */}
      <div className="mb-[18px] flex items-center" data-testid="cd-topline">
        <Link
          href={CONDITIONALS_LANDING_HREF}
          className="group -my-[7px] -ml-[6px] inline-flex flex-none items-center gap-[10px] whitespace-nowrap rounded-[8px] px-[6px] py-[7px] text-[15.5px] leading-[1.25] text-[var(--ink-2)] no-underline transition-colors duration-[.14s] ease-[var(--ease)] hover:text-[var(--ink-0)]"
          data-testid="cd-back"
        >
          <ArrowMark className={BACK_ARROW} />
          Conditionals
        </Link>
      </div>

      {detailError !== null ? (
        <GuidanceNotice guidance={detailError} onAction={handleGuidanceAction} />
      ) : detailValue !== null ? (
        <ConditionalDetailView
          detail={detailValue}
          live={stateValue}
          proposal={
            proposal.data === undefined ? undefined : proposal.data.ok ? proposal.data.value : null
          }
          summary={summaryRow}
          ctx={ctx}
          notices={notices}
          busy={busy}
          feedback={feedback}
          onCancel={() => void runMutation('cancel')}
          onResume={() => void runMutation('resume')}
          onNotificationModeChanged={refetchAll}
          onGuidanceAction={handleGuidanceAction}
          {...(onRequestModification === undefined || id === null
            ? {}
            : { onRequestModification: () => onRequestModification(id) })}
        />
      ) : (
        <p className="text-[11px] text-[var(--ink-3)]">Loading conditional…</p>
      )}
    </div>
  );
}

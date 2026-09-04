'use client';

/**
 * The `proposal_ref` content-part renderer — what chat actually mounts.
 *
 * Chat hands this component a raw content part. It extracts an ID and
 * discards the rest (`proposalRefFromPart`), fetches the canonical
 * record by that id, and renders THAT. A model that writes a different
 * amount, a different mint or a different wallet into the part changes
 * nothing on screen and cannot change what a click authorizes
 * (04-frontend.md invariant 1).
 *
 * A part this build cannot read at all renders nothing rather than
 * anything speculative (invariant 3).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { fetchAuthenticatedApi } from '@/lib/api/trading';
import type { GhostPlan } from '@/lib/agent/ghost-plan';
import type { ProposalDecision } from '@/lib/conditionals';
import { useConditionalsGate } from '@/lib/conditionals/useConditionalsGate';
import { useConditionalLive, type ConditionalLive } from './conditionalLive';
import { ProposalCardGhost } from './CardSkeleton';
import { ProposalCard, ProposalCardSkeleton, ProposalCardStatus } from './ProposalCard';
import { proposalRefFromPart } from './ref';
import { useLiveReveal } from './useLiveReveal';
import { useProposalCard, type UseProposalCardOptions } from './useProposalCard';
import { useProposalTokenSymbol } from './tokenSymbol';
import type { DecisionPhase, ProposalLoadPhase } from './decision';
import type { ProposalCardModel } from './model';
import type { CardPhase } from './v2/ProposalCardV2';
import { livePhase } from './v2/phase';

/**
 * The height a two-leg awaiting card occupies. MEASURED, not derived: the
 * real card on the dev bench (`/dev/proposal-card?state=awaiting&fixture=
 * simple`) renders 657.41px at the 458px review width — 55.5 header + 485
 * legs (two panels and the settlement connector) + 49 details + 65 footer —
 * rounded to the nearest 4. The skeleton stands in for that height so the
 * end-of-turn swap does not shove the thread; being approximate costs a few
 * pixels of settle, being ABSENT cost the whole jump this build is fixing.
 */
const V2_SKELETON_MIN_HEIGHT_PX = 656;

/**
 * The v2 card is a chunk of its own. `ssr: false` because the card
 * resolves the viewer's time zone, which the server does not share.
 *
 * THE LOADER IS NAMED so it can be called TWICE. `next/dynamic` exposes no
 * preload of its own, and webpack memoizes `import()` by chunk — so the
 * warm call below and the render-time call inside `dynamic` are the same
 * request, and whichever runs second resolves from cache. Left to
 * `dynamic` alone, the chunk was fetched at the FIRST v2 render, i.e.
 * after the turn had already committed, and the reader paid the download
 * staring at the reserve.
 */
const loadProposalCardV2 = () => import('./v2/ProposalCardV2');

/**
 * THE LOADING FALLBACK TAKES NO PROPS, and it has to draw the same ghost
 * the part above it was drawing a frame ago — otherwise the chunk landing
 * swaps a true ghost for the two-leg guess and the thread jumps, which is
 * the exact failure the true ghost exists to remove. `dynamic`'s
 * `loading` is a bare component, so the plan reaches it through a
 * module-scope latch: one nullable value, written by the part that is
 * about to mount the card, read by the placeholder that stands in for it.
 * Both live in the same render pass, there is one card mounting at a
 * time, and a stale value costs at most a placeholder's geometry.
 */
let ghostPlanForLoading: GhostPlan | null = null;

const ProposalCardV2 = dynamic(() => loadProposalCardV2().then((m) => m.ProposalCardV2), {
  ssr: false,
  loading: () =>
    ghostPlanForLoading === null ? (
      <ProposalCardGhost minHeightPx={V2_SKELETON_MIN_HEIGHT_PX} />
    ) : (
      <ProposalCardGhost plan={ghostPlanForLoading} />
    ),
});

/**
 * WARM IT WHILE THE TURN IS STILL STREAMING, once per page.
 *
 * Not gated on the flag being TRUE, because at this moment it usually is
 * not yet — LD has not answered, and waiting for it would put the fetch
 * back after the commit, which is the whole cost being removed. It IS
 * gated on the flag not having been REFUSED: a user LD has already
 * evaluated to false never fetches a chunk they will not render.
 */
let v2ChunkWarmed = false;
function warmProposalCardV2(refused: boolean): void {
  if (v2ChunkWarmed || refused) return;
  v2ChunkWarmed = true;
  void loadProposalCardV2().catch(() => {
    // A failed warm is not an error: `dynamic` will ask again at render
    // and report it there. Allow another attempt in the meantime.
    v2ChunkWarmed = false;
  });
}

/** A load phase that has neither resolved nor is still resolving. */
type DegradedPhase = Exclude<ProposalLoadPhase, { kind: 'ready' } | { kind: 'loading' }>;

/** What a ref + load phase resolves to on screen. */
export type ProposalPartView =
  | { readonly kind: 'skeleton' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'status'; readonly phase: DegradedPhase }
  | { readonly kind: 'card'; readonly model: ProposalCardModel };

/**
 * The renderer's whole decision, as a pure function — so invariant 5
 * ("a degraded state says what happened; it never hangs") is testable
 * without a DOM.
 *
 * ORDER MATTERS. `useProposalCard` builds a `model` only for the
 * `ready` phase, so consulting the model before the phase collapses
 * `not_found` / `unavailable` / `error` into a skeleton that never
 * resolves — which is what a `/trade/proposals/<gone-id>` deep link
 * used to hit. The model is only reachable INSIDE the ready branch.
 */
export function proposalPartView(
  hasRef: boolean,
  streaming: boolean,
  load: ProposalLoadPhase,
  model: ProposalCardModel | null,
  gateResolved = true,
): ProposalPartView {
  /*
   * STREAMING NO LONGER HOLDS THE CARD (spec/30-creature.md §3.5, "the
   * card is held behind the skeleton until turn-commit even though the
   * record has already arrived"; §5.7 seam 3). Beat 8 fires when the
   * RECORD resolves, not at turn commit.
   *
   * The branch this replaces existed to answer one question — a short
   * skeleton growing into a tall card mid-stream drags the scroll anchor
   * — and the redesign answers it at the source instead: the skeleton
   * the card replaces is the TRUE ghost, built from the plan the wire
   * already delivered, so it stands at the card's real geometry and the
   * swap holds heights. Where no plan is readable the ghost keeps its
   * measured reserve (`V2_SKELETON_MIN_HEIGHT_PX`), which is the same
   * answer the old branch was approximating.
   */
  // No USABLE id → say so; a silent blank is a bug. The api requires a
  // uuid, so a non-uuid ref never resolves. Mid-stream the part may
  // simply not have finished arriving, so that window stays a skeleton.
  if (!hasRef) return streaming ? { kind: 'skeleton' } : { kind: 'unreadable' };
  if (load.kind === 'loading') return { kind: 'skeleton' };
  // THE FLAG IS STILL OPENING. `conditionals-surface` fails closed, so
  // reading it now would mount v1 and swap it for v2 the moment LD
  // answered — a flash of the old card, which is worse than a wait. The
  // skeleton holds instead, and only until the gate resolves: an LD
  // outage times out (`useConditionalsGate`) and lands on v1, so this
  // can delay the answer but never withhold one.
  if (!gateResolved) return { kind: 'skeleton' };
  if (load.kind === 'ready') return model === null ? { kind: 'skeleton' } : { kind: 'card', model };
  return { kind: 'status', phase: load };
}

/** Which card renders a ready record, and in which state. */
export type ProposalCardChoice =
  | { readonly kind: 'v1' }
  | { readonly kind: 'v2'; readonly phase: CardPhase; readonly stateLabel?: string };


/**
 * The flag branch, as a pure function.
 *
 * THE FLAG DECIDES, AND NOTHING ELSE DOES. v2 used to speak three states
 * and hand every other one back to v1, so a plan that completed showed
 * the OLD card the next time the reader scrolled past it — two designs in
 * one thread, which is what the owner hit. v2 now has copy for every
 * state (design-28 §6, `PHASES` in ProposalCardV2), including the ones
 * this build has never heard of, so there is nothing left to fall back
 * for.
 *
 * ONE EXCEPTION, and it is about honesty rather than coverage: an
 * IMMEDIATE proposal is not a conditional order, and v2's letterhead is
 * the words "Conditional Order", unconditionally. A swap wearing that
 * header would be the card lying about what is being authorized, so
 * immediates stay on v1 — which has copy for them — until they get a
 * card of their own.
 *
 * "Activated" is still only claimed while the SERVER says armed: from
 * the decision response until the first live read, and from the live
 * read after that, because the live read is fresher.
 */
export function proposalCardChoice(
  conditionalsEnabled: boolean,
  model: ProposalCardModel,
  decision: DecisionPhase,
  live: ConditionalLive | null,
): ProposalCardChoice {
  if (!conditionalsEnabled) return { kind: 'v1' };
  if (model.kind === 'immediate') return { kind: 'v1' };
  switch (model.phase) {
    case 'awaiting_approval': {
      // The offer is still pending on the server, but its window has
      // closed here — so there is no decision left to offer.
      if (!model.canDecide) return { kind: 'v2', phase: 'expired' };
      const verifying = decision.kind === 'step_up' || decision.kind === 'reauth';
      return { kind: 'v2', phase: verifying ? 'step_up' : 'awaiting' };
    }
    case 'declined':
      return { kind: 'v2', phase: 'declined' };
    case 'expired':
      return { kind: 'v2', phase: 'expired' };
    case 'superseded':
      return { kind: 'v2', phase: 'superseded' };
    case 'armed':
    case 'authorized': {
      // No live read yet: an `armed` record is armed because the DECISION
      // response said so; an `authorized` one has not been told yet.
      if (live === null) return { kind: 'v2', phase: model.phase === 'armed' ? 'activated' : 'authorized' };
      const { phase, stateLabel } = livePhase(live.state);
      return { kind: 'v2', phase, ...(stateLabel === undefined ? {} : { stateLabel }) };
    }
    default:
      // The server said a proposal state this build has never heard of.
      return { kind: 'v2', phase: 'unknown', stateLabel: model.state };
  }
}

/**
 * The conditional worth polling: an APPROVED proposal's plan. A pending
 * proposal has nothing live yet, and a card on v1 does not read it. The
 * poll retires itself once the plan is terminal, so this stays a
 * function of the record and never of the poll's own answers.
 */
export function livePollId(
  conditionalsEnabled: boolean,
  model: ProposalCardModel | null,
  conditionalId: string | null,
): string | null {
  if (!conditionalsEnabled || conditionalId === null || model === null) return null;
  return model.phase === 'armed' || model.phase === 'authorized' ? conditionalId : null;
}

/**
 * The activated footer states a countdown to the PLAN's expiry, and the
 * model's clock deliberately stops once the proposal is no longer
 * pending (a settled card is inert beside the live charts — 04-frontend
 * invariant 4). So the live card keeps its own second hand, and only
 * while it is the live card: `active` false leaves the model's instant
 * exactly as it was, which is what keeps an injected clock honest.
 */
function useLiveNowMs(active: boolean, fallbackMs: number): number {
  const [now, setNow] = useState(fallbackMs);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : fallbackMs;
}

export interface ProposalPartProps extends UseProposalCardOptions {
  /** The raw chat content part. Untrusted — only an id is read from it. */
  readonly part: unknown;
  /**
   * The turn this part belongs to is still streaming. Renders the
   * skeleton (skeleton-first, never a blank gap) and defers the card
   * itself to the committed turn — the record is fetched meanwhile, so
   * the reveal costs nothing.
   */
  readonly streaming?: boolean;
  /**
   * The shape the `propose_conditional` call already stated, read by the
   * caller off the SAME arguments the build sequence read (§3.5 act 2).
   * With one the ghost stands at the card's real geometry, so the record
   * resolving moves nothing; the sequence and this lane must be handed
   * the same plan, or the running→committed remount is a jump.
   */
  readonly ghostPlan?: GhostPlan | null;
  /** Host-supplied step-up flow. Absent → the notice renders without a button. */
  readonly onStepUp?: () => void;
}

export function ProposalPart({
  part,
  streaming = false,
  ghostPlan = null,
  onStepUp,
  ...options
}: ProposalPartProps) {
  const ref = useMemo(() => proposalRefFromPart(part), [part]);
  const { load, decision, model, decide, reload } = useProposalCard(ref, options);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Drive the refresh straight off the 409 body: the server names the
   * method, the path and the body, and the UI does not hardcode them.
   * On success the same decision is retried — the proposal stayed
   * PENDING throughout.
   */
  const onRefreshAuthorization = useCallback(() => {
    if (decision.kind !== 'reauth' || refreshing) return;
    const { affordance } = decision;
    const retry: ProposalDecision = decision.decision;
    setRefreshing(true);
    void fetchAuthenticatedApi(affordance.path, {
      method: affordance.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(affordance.body),
    })
      .then((response) => {
        setRefreshing(false);
        if (response.ok) decide(retry);
      })
      .catch(() => setRefreshing(false));
  }, [decision, refreshing, decide]);

  /*
   * The token's NAME comes from outside the record (the record has a
   * mint and no symbol). Resolved here, in the container, so the card
   * itself stays a pure function of its model — and so the failure to
   * resolve is just a quieter label, never a missing card.
   */
  const tokenSymbol = useProposalTokenSymbol(model?.mint ?? null);

  const gate = useConditionalsGate();
  const conditionalsEnabled = gate.enabled;
  /*
   * Warm the v2 chunk the moment a proposal part exists — which is
   * mid-stream, while the skeleton is up and the reader is reading
   * prose. By the commit the chunk is in cache and the card mounts with
   * no download in front of it.
   */
  useEffect(() => {
    warmProposalCardV2(gate.resolved && !gate.enabled);
  }, [gate.resolved, gate.enabled]);
  const detail = load.kind === 'ready' ? load.detail : null;
  const live = useConditionalLive(livePollId(conditionalsEnabled, model, detail?.conditional_id ?? null));
  const choice = model === null ? null : proposalCardChoice(conditionalsEnabled, model, decision, live);
  const liveNowMs = useLiveNowMs(
    choice?.kind === 'v2' && choice.phase === 'activated' && options.nowMs === undefined,
    model?.nowMs ?? 0,
  );

  const symbolOf = useCallback(
    (mint: string): string | undefined =>
      mint === model?.mint && tokenSymbol !== null ? tokenSymbol : undefined,
    [model?.mint, tokenSymbol],
  );

  // See `ghostPlanForLoading`: the placeholder the v2 chunk shows while it
  // arrives has to be THIS part's ghost, and it cannot be handed props.
  ghostPlanForLoading = ghostPlan;

  const view = proposalPartView(ref !== null, streaming, load, model, gate.resolved);

  /*
   * The reveal wraps EVERY branch, so the element the reader's eye is
   * anchored to is the same element whatever the card turns out to be —
   * and so the wrapper is already in the DOM when the layout effect that
   * anchors it runs. `agent-card-reveal` animates opacity, clip and
   * transform only: none of them resize the scroll container, so the
   * animation cannot feed back into stick-to-bottom.
   *
   * The reveal exists to anchor the swap FROM the reserve TO the card.
   * With the card mounting as soon as the record resolves, that swap now
   * happens mid-stream — so a card already on screen must not ALSO claim
   * the commit's reveal, which would fade and re-anchor a card that is
   * not moving. Handing the hook `false` there both declines the claim
   * and clears the mark the streaming instance would otherwise leave.
   */
  const reveal = useLiveReveal(ref?.proposalId ?? null, streaming && view.kind !== 'card');
  const content = ((): ReactNode => {
    switch (view.kind) {
      case 'skeleton':
        /*
         * The GHOST while the v2 card is the one on its way — which
         * includes the window where the flag has not answered yet, since
         * that is exactly when a v2 card is still possible. Only a gate
         * that has RESOLVED to false gets v1's plain reserve.
         */
        return gate.resolved && !conditionalsEnabled ? (
          <ProposalCardSkeleton />
        ) : ghostPlan === null ? (
          <ProposalCardGhost minHeightPx={V2_SKELETON_MIN_HEIGHT_PX} />
        ) : (
          /* A plan-bearing ghost needs no reserve: its geometry IS the
             card's, so there is no measured guess left to make. */
          <ProposalCardGhost plan={ghostPlan} />
        );
      case 'unreadable':
        return (
          <ProposalCardStatus
            phase={{ kind: 'error', message: 'This proposal reference is unreadable.', retryable: false }}
          />
        );
      case 'status':
        return <ProposalCardStatus phase={view.phase} onRetry={reload} />;
      case 'card': {
        if (choice !== null && choice.kind === 'v2' && detail !== null) {
          /*
           * The 409 reauth retry survives the redesign by reusing v2's
           * step-up affordance: "Verify to approve" runs the refresh the
           * server's own body named, and the refresh re-posts the same
           * decision (`onRefreshAuthorization`). Everything else routes
           * through the SAME submit path as v1 — decision, then the
           * mandatory server re-read.
           */
          const stepUp = decision.kind === 'reauth' ? onRefreshAuthorization : onStepUp;
          return (
            <ProposalCardV2
              detail={detail}
              nowMs={choice.phase === 'activated' ? liveNowMs : view.model.nowMs}
              {...(choice.stateLabel === undefined ? {} : { stateLabel: choice.stateLabel })}
              phase={choice.phase}
              busy={decision.kind === 'submitting' || refreshing}
              onApprove={() => decide('approve')}
              onDecline={() => decide('decline')}
              symbolOf={symbolOf}
              mint={model?.mint ?? null}
              {...(stepUp === undefined ? {} : { onStepUp: stepUp })}
              {...(live === null ? {} : { conditionalSummary: live.summary })}
            />
          );
        }
        return (
          <ProposalCard
            model={view.model}
            decision={decision}
            onDecide={decide}
            onRefreshAuthorization={onRefreshAuthorization}
            tokenSymbol={tokenSymbol}
            {...(onStepUp === undefined ? {} : { onStepUp })}
          />
        );
      }
    }
  })();

  return (
    <div
      ref={reveal.ref}
      className={reveal.live ? 'agent-card-reveal' : undefined}
      data-testid="agent-proposal-reveal"
      data-live-reveal={reveal.live ? 'true' : undefined}
    >
      {content}
    </div>
  );
}

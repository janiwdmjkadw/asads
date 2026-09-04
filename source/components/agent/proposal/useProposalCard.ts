'use client';

/**
 * The wiring between a `proposal_ref` in chat and the canonical record.
 *
 * THE SERVER-TRUTH SEAM: `loadProposalCard` takes a `ProposalRef` — an
 * id and nothing else — and answers with what the api served. Chat
 * content reaches this module only through `proposalRefFromPart`, so
 * the card's contents are always the server's, whatever a model wrote.
 *
 * The hook holds no derived lifecycle of its own: after every committed
 * decision it RE-READS the proposal, so `approved` / `armed` / `expired`
 * on screen are the server record's, never an optimistic guess.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decideProposal, fetchProposal } from '@/lib/conditionals';
import type {
  ConditionalState,
  DecisionResult,
  ProposalDecision,
  ProposalDetail,
  TradeControlResult,
} from '@/lib/conditionals';
import { classifyDecision, classifyLoad, type DecisionPhase, type ProposalLoadPhase } from './decision';
import { armedFromServer, buildProposalCardModel, type ProposalCardModel } from './model';
import type { ProposalRef } from './ref';

export type ProposalFetcher = (proposalId: string) => Promise<TradeControlResult<ProposalDetail>>;
export type ProposalDecider = (
  proposalId: string,
  decision: ProposalDecision,
) => Promise<TradeControlResult<DecisionResult>>;

/**
 * Fetch the canonical proposal for a ref. The ONLY input is the id;
 * there is no parameter for a chat-embedded payload to travel through.
 */
export async function loadProposalCard(
  ref: ProposalRef,
  fetcher: ProposalFetcher = fetchProposal,
): Promise<ProposalLoadPhase> {
  return classifyLoad(await fetcher(ref.proposalId));
}

// ───────────────────────── the load cache ─────────────────────────

/**
 * ONE GET PER PROPOSAL, across mounts.
 *
 * A `proposal_ref` is rendered twice for the same id in the normal case:
 * once inside the streaming turn, then again from history when the turn
 * commits (`chat-store` nulls the stream and appends the turn, and the two
 * live in different subtrees, so the part REMOUNTS). Without a cache that
 * remount re-enters `loading`, which is a second skeleton flash and a
 * second GET for a record that has not changed.
 *
 * So the load is memoised at module scope, keyed by id: the skeleton phase
 * starts it, the committed card reads the settled phase SYNCHRONOUSLY on
 * mount, and no second request is made. Short TTL — this exists to survive
 * a remount, not to serve a stale record minutes later — and an explicit
 * `reload()` always bypasses it, so the mandatory post-decision re-read is
 * still a real read of server truth.
 */
export interface ProposalCacheEntry {
  readonly startedAtMs: number;
  readonly promise: Promise<ProposalLoadPhase>;
  /** The settled phase once it has arrived; `null` while in flight. */
  readonly phase: ProposalLoadPhase | null;
}

const CACHE_TTL_MS = 60_000;
const loadCache = new Map<string, ProposalCacheEntry>();

function startLoad(proposalId: string, fetcher: ProposalFetcher): ProposalCacheEntry {
  let settled: ProposalLoadPhase | null = null;
  const promise = loadProposalCard({ proposalId }, fetcher).then((phase) => {
    settled = phase;
    return phase;
  });
  return {
    startedAtMs: Date.now(),
    promise,
    get phase() {
      return settled;
    },
  };
}

/**
 * Start the load for an id, or JOIN the one already in flight/settled.
 * `fresh` bypasses the cache — an explicit demand for server truth.
 */
export function loadProposalCardCached(
  proposalId: string,
  fetcher: ProposalFetcher = fetchProposal,
  fresh = false,
): ProposalCacheEntry {
  const hit = loadCache.get(proposalId);
  if (!fresh && hit !== undefined && Date.now() - hit.startedAtMs < CACHE_TTL_MS) return hit;
  const entry = startLoad(proposalId, fetcher);
  loadCache.set(proposalId, entry);
  return entry;
}

/** The settled phase a recent load left for this id, if there is one. */
export function cachedProposalPhase(proposalId: string): ProposalLoadPhase | null {
  const hit = loadCache.get(proposalId);
  return hit !== undefined && Date.now() - hit.startedAtMs < CACHE_TTL_MS ? hit.phase : null;
}

/** Tests only — the cache outlives a component, so it outlives a case. */
export function clearProposalCache(): void {
  loadCache.clear();
}

/**
 * The conditional state a decision response reported, if any. Reading
 * it from the response is what makes `armed` a server fact: the card
 * shows `armed` only once the decision transaction has committed and
 * the server says the conditional is armed.
 */
export function conditionalStateFromDecision(result: DecisionResult): ConditionalState | null {
  const candidate = (result as { conditional_state?: unknown }).conditional_state;
  return armedFromServer(typeof candidate === 'string' ? candidate : null);
}

/** Countdown tick. One second is plenty for an `mm:ss` display. */
const TICK_MS = 1_000;

export interface ProposalCardState {
  readonly load: ProposalLoadPhase;
  readonly decision: DecisionPhase;
  /** `null` until the canonical record has arrived. */
  readonly model: ProposalCardModel | null;
  readonly decide: (value: ProposalDecision) => void;
  readonly reload: () => void;
}

export interface UseProposalCardOptions {
  /** Injected in tests; production uses the shared typed port. */
  readonly fetcher?: ProposalFetcher;
  readonly decider?: ProposalDecider;
  /** Injected in tests so the countdown is deterministic. */
  readonly nowMs?: number;
}

export function useProposalCard(
  ref: ProposalRef | null,
  options: UseProposalCardOptions = {},
): ProposalCardState {
  const { fetcher = fetchProposal, decider = decideProposal, nowMs } = options;
  const proposalId = ref?.proposalId ?? null;
  // A remount over a cached id starts AT the record, not at a skeleton.
  const [load, setLoad] = useState<ProposalLoadPhase>(
    () => (proposalId === null ? null : cachedProposalPhase(proposalId)) ?? { kind: 'loading' },
  );
  const [decision, setDecision] = useState<DecisionPhase>({ kind: 'idle' });
  const [conditionalState, setConditionalState] = useState<ConditionalState | null>(null);
  const [tick, setTick] = useState(() => nowMs ?? Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (proposalId === null) return;
    let current = true;
    // `reload()` is an explicit demand for server truth — the mandatory
    // post-decision re-read, or the retry button — so it never reads the
    // cache. A first mount does, which is what makes the stream→history
    // handoff free of both a second skeleton and a second GET.
    const entry = loadProposalCardCached(proposalId, fetcher, reloadKey > 0);
    const settled = entry.phase;
    if (settled !== null) setLoad(settled);
    else setLoad((previous) => (previous.kind === 'loading' ? previous : { kind: 'loading' }));
    void entry.promise.then((phase) => {
      if (current) setLoad(phase);
    });
    return () => {
      current = false;
    };
  }, [proposalId, fetcher, reloadKey]);

  // The countdown ticks only while a decision is actually pending, so a
  // settled card is inert beside the live charts (invariant 4).
  const ticking = load.kind === 'ready' && load.detail.state === 'pending' && nowMs === undefined;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const decide = useCallback(
    (value: ProposalDecision) => {
      if (proposalId === null) return;
      setDecision({ kind: 'submitting', decision: value });
      void decider(proposalId, value).then((result) => {
        if (!alive.current) return;
        const phase = classifyDecision(value, result);
        setDecision(phase);
        if (phase.kind === 'settled') {
          setConditionalState(conditionalStateFromDecision(phase.result));
          // Re-read: the card must show the server's post-decision
          // record, not what the browser believes it just did.
          setReloadKey((key) => key + 1);
        } else if (phase.kind === 'refused' && phase.refetch) {
          setReloadKey((key) => key + 1);
        }
      });
    },
    [proposalId, decider],
  );

  const model = useMemo(
    () =>
      load.kind === 'ready'
        ? buildProposalCardModel(load.detail, nowMs ?? tick, conditionalState)
        : null,
    [load, nowMs, tick, conditionalState],
  );

  return { load, decision, model, decide, reload };
}

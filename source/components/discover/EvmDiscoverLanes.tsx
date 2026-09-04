'use client';

/**
 * EVM discover lanes (guide WP-313, terminal side).
 *
 * Renders the four lifecycle lanes for one chain. All ordering,
 * de-duplication, staleness and live-frame arithmetic lives in
 * `lib/evm/laneState.ts` — this file is the view plus the two data sources,
 * which is why the hard rules are unit-tested without a DOM.
 *
 * TWO SOURCES, ONE STORE:
 *  1. `GET /evm/discover` — the authoritative snapshot for the whole chain.
 *  2. `GET /evm/stream` (SSE) — live frames. This was served by
 *     `the ingestion service` and consumed by NOBODY until now: the lanes were a
 *     one-shot fetch, so a card was as old as the page. The reducer's
 *     seq-gap machinery existed and was unreachable.
 *
 * Design notes:
 * - **A gap triggers a re-snapshot of THAT CHAIN, not a silent continue and
 *   not a global refetch.** seq is per-chain, so a hole in BSC's feed says
 *   nothing about Robinhood's.
 * - **Every degrade is visible.** The lane header carries a live/stale
 *   indicator whose tooltip reports the stream's own counters — frames
 *   applied, malformed, gaps, ring lapses, reconnects. A silent failure is
 *   a defect, and the reason seq is minted at the tap is that holes be seen.
 * - **A feed that cannot be READ never renders as an empty board.** "We could
 *   not read" and "there is nothing" are different answers and must not share
 *   a pixel. A chip that says `refreshing` forever is the empty-vs-unavailable
 *   conflation, not an indicator: see `evmFeedUnavailable` for the rule, and
 *   `EvmLane` for the lane body and the count that must not be 0.
 * - **THE BOARD RECOVERS; IT DOES NOT REFUSE.** Every degrade here has a way
 *   back, because the failure mode of this board is not a wrong number, it is
 *   a frozen one. A stale snapshot is rendered and MARKED rather than
 *   discarded (a 12 s-old board beats a blank one); an open-but-silent socket
 *   is cut by the stream's watchdog instead of trusted; and a board that
 *   already looks fine is re-read on a cadence anyway, because nothing else
 *   would ever notice a producer that wedged with its socket up. Stale,
 *   unavailable and refreshing are three states and render as three.
 * - **Partial history renders as "—", never 0.** A cursor-admitted token has
 *   no history to count, and a zero would claim it never traded.
 * - **A migrating token's control is disabled WITH a reason.** Both sides
 *   freeze in four.meme's keeper-async gap; a dead button with no
 *   explanation reads as breakage.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  evmLaunchOptionsForChain,
  nativeSymbolForChain,
  parseEvmDiscoverSnapshot,
  type EvmDiscoverLane,
  type EvmLaunchpad,
  type EvmLaunchVariant,
} from '@/lib/evm/discoverAdapter';
import {
  readEvmQuickbuyAmountText,
  writeEvmQuickbuyAmountText,
} from '@/lib/evm/quickbuy';
import {
  EMPTY_LANE_STATE,
  EVM_LANES,
  evmLaneReducer,
  frameToAction,
  needsRefresh,
  selectMergedLane,
  snapshotAction,
  type EvmLaneCounters,
  type EvmLane,
} from '@/lib/evm/laneState';
import {
  allEvmLaunchIdentityKeys,
  evmLaunchIdentityKey,
  readEvmLaunchSelection,
  writeEvmLaunchSelection,
  type EvmLaunchIdentityKey,
} from '@/lib/evm/launchSelection';
import {
  evmDiscoverFailureForStatus,
  evmDiscoverUrl,
  parseEvmDiscoverSnapshotDiagnostics,
  type EvmDiscoverReadFailure,
} from '@/lib/evm/readApi';
import {
  jitteredBackoffMs,
  openEvmStream,
  type EvmStreamStatus,
} from '@/lib/evm/stream';
import { toDiscoverRows } from '@/lib/evm/cardAdapter';
import { CoinCard } from '@/components/discover/CoinCard';
import { DiscoverCoinStoreContext } from '@/components/discover/discoverFeedStore';
import {
  createDetachedCoinStore,
  publishRows,
} from '@/components/discover/detachedCoinStore';
import type { MockCoin } from '@/components/discover/mockCoins';
import { tokenCardKey } from '@/components/discover/tokenIdentityCache';
import { evmFilterSection, laneVisibleRows } from '@/components/discover/evmLaneRows';
import { usePausableRow } from '@/components/discover/pausableRow';
import { DiscoverFiltersButton } from '@/components/discover/DiscoverFiltersButton';
import { rowFilterActive, type DiscoverSectionId } from '@/components/discover/discoverFilters';
import { Section } from '@/components/discover/layout/Section';
import { PanelStack, type StackPanel } from '@/components/discover/layout/PanelStack';
import { CARD_ZOOM_BY_SIZE, resolveLayout } from '@/components/discover/layout/resolveLayout';
import type { Axis } from '@/components/discover/layout/types';
import { useDiscoverStore } from '@/lib/state/discover-store';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import { LANE_GATE_TEARDOWN_GRACE_MS } from '@/components/discover/laneStreamGate';
import { EvmLaunchpadBadge } from './EvmLaunchpadBadge';

/* Three lanes, matching Solana's three sections. `migrating` is a wire stage,
   not a lane — its cards render under Ripening (see `stagesForLane`). */
const STAGE_LABELS: Record<EvmLane, string> = {
  new: 'New pairs',
  ripening: 'Ripening',
  graduated: 'Graduated',
};

/**
 * How often the age/"last trade" clock ticks. Ages are rendered from a single
 * shared `now`, so one interval repaints the whole board instead of each card
 * owning a timer.
 */
const CLOCK_TICK_MS = 1_000;

/**
 * Delay before re-attempting a re-snapshot that did not produce a current
 * board — BACKED OFF AND JITTERED, which it was not.
 *
 * The old fixed 3 s said the thundering-herd concern that shapes the SSE
 * backoff "does not apply at this rate". It does. The condition that raises
 * this retry — a wedged producer, a 503 from the proxy, a chain the ingestion
 * box cannot serve — is a condition every open terminal on that chain hits in
 * the same second, so an unjittered fixed delay has all of them re-reading
 * together, forever, against a service already struggling; at enough boards
 * that is the api's own 240-req/min bucket being spent on a read that is
 * failing. The ladder is `stream.ts`'s (`:127-128`, `:284-288`), with a
 * FLOOR — a snapshot retry runs against an endpoint that just failed, and a
 * near-zero draw would collapse it into a hot loop on a fetch that rejects
 * instantly, which full jitter permits and the reconnect ladder can afford.
 */
const RESNAPSHOT_RETRY_BASE_MS = 3_000;
const RESNAPSHOT_RETRY_MAX_MS = 30_000;

/**
 * Unconditional re-read of a board we already accepted.
 *
 * THE WEDGE HOLE. Every other read here is reactive: the cold load, and a
 * refresh a seq gap asked for. Nothing schedules a re-read of a board that
 * looks fine — so a producer that stops folding while its socket stays open,
 * or a fresher `built_at_ms` sitting on the server behind a snapshot we
 * accepted, is never noticed. The freshness grader has existed the whole time
 * with nothing calling it on a cadence.
 *
 * 30 s FLOOR, 15 s SPREAD. The floor is what bounds the hole: worst-case
 * staleness of an otherwise-silent board is one period, and 30 s is short
 * enough that a wedge is caught while a user is still looking at it and long
 * enough that the cost is 2 reads/min per open board — under 1% of the api's
 * 240/min bucket, against a snapshot the producer rebuilds once a second
 * anyway. The spread de-phases boards that mounted together (a deploy, a
 * reconnect storm) across a 15 s window instead of stacking them on one
 * second; it is additive rather than full jitter because a floor of zero
 * would let a board re-read immediately after the read it just did.
 */
const RESNAPSHOT_PERIOD_MS = 30_000;
const RESNAPSHOT_PERIOD_JITTER_MS = 15_000;

/** Backoff for a re-snapshot that must be re-attempted. */
export function evmResnapshotRetryMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  return jitteredBackoffMs(
    attempt,
    {
      baseMs: RESNAPSHOT_RETRY_BASE_MS,
      maxMs: RESNAPSHOT_RETRY_MAX_MS,
      floorRatio: 0.5,
    },
    random,
  );
}

/** Delay until the next unconditional re-snapshot. */
export function evmPeriodicResnapshotMs(random: () => number = Math.random): number {
  return RESNAPSHOT_PERIOD_MS + Math.floor(random() * RESNAPSHOT_PERIOD_JITTER_MS);
}

/**
 * One resolved `GET /evm/discover` attempt.
 *
 * A DISCRIMINATED RESULT rather than a boolean, because the caller has to
 * separate two things the boolean conflated: whether the read LANDED (which
 * decides "feed unavailable"), and whether the board is now CURRENT (which
 * decides whether to retry). A stale snapshot landed and is not current; a
 * re-served identical board landed and discharges nothing.
 */
export type EvmDiscoverRead =
  | {
      readonly kind: 'fresh' | 'stale';
      readonly lanes: readonly EvmDiscoverLane[];
      readonly builtAtMs: number;
      readonly version: bigint;
      /** Age of the board in ms; `null` when it is inside the contract. */
      readonly staleAgeMs: number | null;
    }
  | { readonly kind: 'failed'; readonly failure: EvmDiscoverReadFailure };

/**
 * Read one chain's discover snapshot and judge it.
 *
 * SEPARATE FROM THE COMPONENT so every branch below is provable without a
 * DOM — 401 vs 429 vs 503 vs a body that is not JSON vs a wire-shape skew are
 * six different answers, and "the lanes went blank" was how all of them used
 * to render. It takes `nowMs` rather than reading the clock so a freshness
 * verdict is reproducible in a test.
 */
export async function readEvmDiscoverSnapshot(options: {
  fetchImpl: typeof fetch;
  apiBase: string;
  chain: string;
  nowMs: number;
}): Promise<EvmDiscoverRead> {
  let response: Response;
  try {
    response = await options.fetchImpl(evmDiscoverUrl(options.apiBase, options.chain));
  } catch {
    return { kind: 'failed', failure: 'transport' };
  }
  if (!response.ok) {
    return { kind: 'failed', failure: evmDiscoverFailureForStatus(response.status) };
  }
  const diagnostics = parseEvmDiscoverSnapshotDiagnostics(response.headers, options.nowMs);
  if (diagnostics.kind === 'missing') return { kind: 'failed', failure: 'headers-missing' };
  if (diagnostics.kind === 'malformed') {
    return { kind: 'failed', failure: 'headers-malformed' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed', failure: 'body' };
  }
  // Shape-check every lane, not just the envelope: `snapshotAction`
  // flat-maps `lane.cards`, so one lane without a `cards` array throws
  // inside the reducer and takes the whole board down with a render error
  // — a harder failure than the stale lanes it was meant to replace.
  const lanes = parseEvmDiscoverSnapshot(body, options.chain);
  if (lanes === null) return { kind: 'failed', failure: 'shape' };
  return {
    kind: diagnostics.kind,
    lanes,
    builtAtMs: diagnostics.builtAtMs,
    version: diagnostics.version,
    staleAgeMs: diagnostics.kind === 'stale' ? diagnostics.ageMs : null,
  };
}

/**
 * What one snapshot attempt did to the board.
 *
 * `unchanged` is the wedged-producer steady state and it is NOT a failure:
 * the read landed, the server simply re-served the build we already hold. It
 * must not count toward "feed unavailable" — there are real cards on screen —
 * and it must not discharge a refresh obligation either, or a gap would sit
 * outstanding behind a chip that says everything is fine.
 */
export type EvmSnapshotOutcome =
  | 'fresh'
  | 'stale'
  | 'unchanged'
  | 'failed'
  /** A newer request (or a chain switch) owns the board now. */
  | 'superseded';

/** Does this outcome still owe another attempt? Only a current board settles. */
export function evmSnapshotRetryable(outcome: EvmSnapshotOutcome): boolean {
  return outcome === 'stale' || outcome === 'unchanged' || outcome === 'failed';
}

/**
 * Chip-filter membership for one card.
 *
 * ABSENCE IS NOT EXCLUSION. A card whose launchpad or variant the wire did not
 * state is still a real token on this chain, and dropping it makes an
 * unrecognised origin — a launchpad shipped by the producer before the
 * terminal learned its name, or a card admitted at the cursor with no origin
 * observed — invisible with nothing on screen to say so. Every chip can be
 * lit and the token still vanishes, which is unfalsifiable from the UI.
 */
export function evmLaunchIncluded(
  selected: ReadonlySet<EvmLaunchIdentityKey>,
  card: {
    launchpad: EvmLaunchpad | null;
    launchVariant: EvmLaunchVariant | null;
  },
): boolean {
  if (card.launchpad === null || card.launchVariant === null) return true;
  return selected.has(evmLaunchIdentityKey(card.launchpad, card.launchVariant));
}

/**
 * Consecutive failed snapshots a chain that ALREADY HAS a board absorbs before
 * the chip stops calling the condition a refresh.
 *
 * Asymmetric on purpose, and the asymmetry is what is on screen. A chain whose
 * snapshot has never landed shows three empty lanes, and an empty lane under a
 * `refreshing` chip is read as "no tokens on this chain" — so that case is
 * unavailable on its FIRST failure, with nothing to wait for. A chain that HAS
 * loaded still shows its last good cards, so one blip the retry heals is
 * honestly a refresh; the second consecutive failure is where that stops being
 * true.
 */
const SNAPSHOT_FAILURES_BEFORE_UNAVAILABLE = 2;

/**
 * The last RESOLVED snapshot attempt for one chain.
 *
 * `snapshotFailures` cannot answer this and is not being asked to: it is a
 * session total across every chain the board has selected and never resets, so
 * it states neither "since the last success" nor "for THIS chain". It stays
 * exactly as it is — the tooltip and `data-snapshot-failures` read it.
 */
export interface EvmSnapshotAttempt {
  /** Chain these counts describe. A different selection starts over. */
  readonly chain: string;
  /** Has any snapshot for this chain landed on this board? */
  readonly loadedOnce: boolean;
  /** Failures since the last success. 0 until one resolves as a failure. */
  readonly failures: number;
  /**
   * Which condition the last failure was, or `null` when the last attempt did
   * not fail. Six causes rendered as one word is what made a misconfigured
   * chain, an expired session and a rate limit indistinguishable on screen.
   */
  readonly failure: EvmDiscoverReadFailure | null;
  /**
   * Age of the board when the last READ landed outside the freshness
   * contract, `null` when it landed inside it.
   *
   * A DIFFERENT AXIS FROM `failures`, and the distinction is the point: a
   * stale board was read successfully and is on screen, an unavailable one
   * could not be read at all. They must never render as the same state.
   */
  readonly staleAgeMs: number | null;
}

/**
 * Is the feed UNAVAILABLE, as opposed to merely refreshing?
 *
 * THE rule of this file: absence must be typed, never rendered as zero. An
 * in-flight first load is NOT unavailable (`failures === 0`), and neither is a
 * board still holding a current snapshot — the pair of conditions is "no
 * current snapshot for the selected chain" AND "the last attempt for it
 * failed", which is what separates a read that did not land from a chain that
 * genuinely holds no tokens.
 */
export function evmFeedUnavailable(
  attempt: EvmSnapshotAttempt,
  chain: string,
  /** Does the board hold a snapshot that is current for `chain`? */
  hasCurrentSnapshot: boolean,
): boolean {
  if (hasCurrentSnapshot || attempt.chain !== chain || attempt.failures === 0) return false;
  return !attempt.loadedOnce || attempt.failures >= SNAPSHOT_FAILURES_BEFORE_UNAVAILABLE;
}

export interface EvmDiscoverLanesProps {
  /** Storage tag: `bsc`, `robinhood_chain`. */
  chain: string;
  /**
   * Base URL of the EVM ingestion read API. `''` (the default) means
   * same-origin through the api's `/api/v1/evm/*` proxy routes; a non-empty
   * value points straight at the ingestion read API (`/evm/*` route names).
   * See `lib/evm/readApi.ts` for why the two spell their paths differently.
   */
  apiBase?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Set false to render snapshot-only (no socket). Used by tests and by any
   * caller that mounts the lanes off-screen — an invisible pane must not hold
   * a stream open.
   */
  live?: boolean;
  /**
   * Opens the page's single filters modal on a given tab.
   *
   * A PROP rather than a modal mounted here: `DiscoverFiltersModal` is a
   * dialog root, and two roots for one persisted filter set is how a bound
   * edited in one place stops matching the funnel-pill "active" dot in the
   * other. Absent (tests, any host without the modal) simply omits the pill —
   * the bounds still apply, because they come from the store.
   */
  onOpenFilters?: (section: DiscoverSectionId) => void;
}

export function EvmDiscoverLanes({
  chain,
  apiBase = '',
  fetchImpl,
  live = true,
  onOpenFilters,
}: EvmDiscoverLanesProps) {
  const [state, dispatch] = useReducer(evmLaneReducer, EMPTY_LANE_STATE);
  const [streamStatus, setStreamStatus] = useState<EvmStreamStatus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [snapshotCurrentChain, setSnapshotCurrentChain] = useState<string | null>(null);
  const [snapshotAttempt, setSnapshotAttempt] = useState<EvmSnapshotAttempt>(() => ({
    chain,
    loadedOnce: false,
    failures: 0,
    failure: null,
    staleAgeMs: null,
  }));
  const activeChain = useRef(chain);
  const snapshotRequest = useRef(0);
  /** Is a read outstanding? The periodic re-read yields to a retry ladder. */
  const snapshotInFlight = useRef(false);
  const latestSnapshot = useRef<{
    chain: string;
    builtAtMs: number;
    version: bigint;
  } | null>(null);
  activeChain.current = chain;
  if (latestSnapshot.current?.chain !== chain) latestSnapshot.current = null;

  // `globalThis.fetch` detached from its receiver throws "Illegal invocation"
  // in the browser: the WebIDL binding requires `this` to be the global. Tests
  // inject an already-bound mock, so the PRODUCTION path is the only one that
  // breaks, and it breaks into an unhandled rejection that renders as four
  // empty lanes.
  const doFetch = useMemo(
    () => fetchImpl ?? globalThis.fetch.bind(globalThis),
    [fetchImpl],
  );

  /** One attempt at making this chain's board current. See `EvmSnapshotOutcome`. */
  const snapshot = useCallback(async (): Promise<EvmSnapshotOutcome> => {
    const request = snapshotRequest.current + 1;
    snapshotRequest.current = request;
    snapshotInFlight.current = true;
    const read = await readEvmDiscoverSnapshot({
      fetchImpl: doFetch,
      apiBase,
      chain,
      nowMs: Date.now(),
    });
    // Only the NEWEST request may declare the board idle — an older one
    // resolving late would clear the flag out from under a live read. Set
    // here rather than in a `finally` because everything below is
    // synchronous and `readEvmDiscoverSnapshot` resolves rather than throws.
    if (request === snapshotRequest.current) snapshotInFlight.current = false;
    // A newer request, or a chain switch, owns the board now. Nothing here
    // may write state for a chain that is no longer selected.
    if (request !== snapshotRequest.current || activeChain.current !== chain) {
      return 'superseded';
    }
    if (read.kind === 'failed') {
      // A failed snapshot leaves the refresh obligation OUTSTANDING rather
      // than clearing it: the lane is still known-stale. The retry that
      // discharges it is scheduled by the caller — see the refresh effect.
      setSnapshotCurrentChain(null);
      // Counted PER CHAIN and since the last success, which is the only form
      // in which the count can decide whether the board is unreadable or
      // merely refreshing — see `evmFeedUnavailable`.
      setSnapshotAttempt((previous) =>
        previous.chain === chain
          ? {
              ...previous,
              failures: previous.failures + 1,
              failure: read.failure,
              staleAgeMs: null,
            }
          : {
              chain,
              loadedOnce: false,
              failures: 1,
              failure: read.failure,
              staleAgeMs: null,
            },
      );
      return 'failed';
    }
    // The read LANDED — that is the fact `evmFeedUnavailable` turns on, and it
    // is true of a stale or re-served board just as much as a fresh one. What
    // the board is NOT is necessarily current; that is `chainNeedsRefresh` and
    // the stale age, which travel separately.
    const landed = (): void => {
      setSnapshotCurrentChain(chain);
      // Same object back when the health did not change, so a routine
      // re-snapshot of a healthy chain does not repaint the whole board.
      setSnapshotAttempt((current) =>
        current.chain === chain
          && current.loadedOnce
          && current.failures === 0
          && current.staleAgeMs === read.staleAgeMs
          ? current
          : {
              chain,
              loadedOnce: true,
              failures: 0,
              failure: null,
              staleAgeMs: read.staleAgeMs,
            },
      );
    };
    const previous = latestSnapshot.current;
    if (
      previous?.chain === chain
      && (read.builtAtMs < previous.builtAtMs
        || (read.builtAtMs === previous.builtAtMs && read.version <= previous.version))
    ) {
      // A slower replica/response must not roll a newer board backwards, and
      // this is ALSO the wedged-producer steady state: the server keeps
      // re-serving the build we already hold. It discharges no refresh
      // obligation — the caller keeps retrying — but it is not a failure and
      // must never read as one, because the cards on screen are real.
      landed();
      return 'unchanged';
    }
    // ONE dispatch for the whole chain. A snapshot is authoritative per CHAIN,
    // not per lane, so dispatching once per lane would delete the lane before
    // it and leave only the last one rendered.
    //
    // A STALE SNAPSHOT IS RENDERED, NOT REFUSED. It parsed, it describes real
    // tokens, and a 12 s-old board beats four empty lanes by every measure a
    // user has; refusing it is how the board answered "the producer is behind"
    // with "this chain has nothing on it". The chip carries the age.
    dispatch(snapshotAction(chain, read.lanes));
    latestSnapshot.current = {
      chain,
      builtAtMs: read.builtAtMs,
      version: read.version,
    };
    landed();
    return read.kind;
  }, [apiBase, chain, doFetch]);

  const [snapshotFailures, setSnapshotFailures] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const load = async () => {
      const outcome = await snapshot();
      if (cancelled || !evmSnapshotRetryable(outcome)) return;
      // Only a read that did not LAND counts as a failed refresh. A stale or
      // re-served board landed; conflating them would drive the chip to
      // "feed unavailable" over cards that are on screen.
      if (outcome === 'failed') setSnapshotFailures((count) => count + 1);
      timer = globalThis.setTimeout(load, evmResnapshotRetryMs(attempt)) as unknown as number;
      attempt += 1;
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
    };
  }, [snapshot]);

  // A seq gap (or any server-declared discontinuity) means frames were lost —
  // re-snapshot rather than render a lane we know is incomplete. Per chain:
  // this component renders exactly one, and the flag it reads is that chain's.
  //
  // THE RETRY IS EXPLICIT. `chainNeedsRefresh` stays true after a failed
  // snapshot, so it never CHANGES, so this effect would never fire again —
  // the obligation would sit outstanding forever behind a chip that says
  // "refreshing". `retryTick` is the dependency that actually re-arms it, and
  // `snapshotFailures` makes the condition countable rather than silent.
  const chainNeedsRefresh = needsRefresh(state, chain);
  const [retryTick, setRetryTick] = useState(0);
  /* The ladder's rung. A REF, not effect-local: this effect re-runs once per
     retry, so a local counter would reset to 0 every time and the backoff
     would never leave its first step. */
  const refreshAttempt = useRef(0);
  useEffect(() => {
    if (!chainNeedsRefresh) {
      refreshAttempt.current = 0;
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    void snapshot().then((outcome) => {
      if (cancelled || !evmSnapshotRetryable(outcome)) return;
      if (outcome === 'failed') setSnapshotFailures((count) => count + 1);
      timer = globalThis.setTimeout(
        () => setRetryTick((tick) => tick + 1),
        evmResnapshotRetryMs(refreshAttempt.current),
      ) as unknown as number;
      refreshAttempt.current += 1;
    });
    return () => {
      cancelled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
    };
  }, [chainNeedsRefresh, snapshot, retryTick]);

  /* A bfcache restore closes every `EventSource` the page held and re-runs no
     effect on its own (`lib/state/stream-generation.ts:61-63`), so a restored
     tab sits behind a dead socket with a green chip. Solana puts the same
     counter in its connect effect's deps (`useLiveNewPairs.ts:118`, `:378`);
     the EVM deps were `[chain, apiBase, live]`, which a restore does not
     touch. It gates the periodic re-read too: a restored board is as old as
     the moment the tab was frozen. */
  const streamGeneration = useStreamGeneration();

  /* VISIBILITY HYSTERESIS, hide-side only. `live` is `!paneHidden`, and a
     Discover→Trade→Discover toggle flips it twice in under a second: without a
     grace that tears down the socket, burns the frames in the gap, and pays a
     full fat re-snapshot on the way back — repeatedly, on a route the user
     bounces through. The reveal path stays IMMEDIATE, and the grace is the
     Solana lane gate's own (`laneStreamGate.ts:34`), which documents the rule
     and the reason the new-pairs lane is exempt from it. */
  const [streamLive, setStreamLive] = useState(live);
  useEffect(() => {
    if (live) {
      setStreamLive(true);
      return;
    }
    const timer = globalThis.setTimeout(
      () => setStreamLive(false),
      LANE_GATE_TEARDOWN_GRACE_MS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [live]);

  /* A REVEAL OWES A READ. The socket was closed for the dormant window, so no
     frame will heal what was missed and the board is as old as the moment it
     was hidden. Routed through the store's refresh obligation — the mechanism
     a seq gap already raises — rather than a bespoke fetch, so the retry
     ladder, the counters and the chip all cover it for free. The first mount
     is not a reveal: the cold load owns that read. */
  const wasDormant = useRef(!live);
  useEffect(() => {
    if (!streamLive) {
      wasDormant.current = true;
      return;
    }
    if (wasDormant.current) dispatch({ type: 'require-refresh', chain });
    wasDormant.current = false;
  }, [streamLive, chain]);

  /* THE UNCONDITIONAL RE-READ. Every other read on this board is reactive, so
     a producer that wedges with its socket still open — or simply a fresher
     build sitting on the server — is never noticed by a board that already
     accepted a snapshot. See `RESNAPSHOT_PERIOD_MS` for the cadence and why a
     dormant board does not pay it. */
  useEffect(() => {
    if (!streamLive) return;
    let cancelled = false;
    let timer: number | null = null;
    const arm = () => {
      timer = globalThis.setTimeout(() => {
        // YIELD TO A LADDER IN PROGRESS. Two reads in flight means one
        // supersedes the other, and the one that loses stops retrying — which
        // would leave a refresh obligation outstanding until the next period.
        // The board is already being read; skip this tick and re-arm.
        if (snapshotInFlight.current) {
          arm();
          return;
        }
        void snapshot().finally(() => {
          if (!cancelled) arm();
        });
      }, evmPeriodicResnapshotMs()) as unknown as number;
    };
    arm();
    return () => {
      cancelled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
    };
  }, [snapshot, streamLive, streamGeneration]);

  // The live socket. Its identity depends only on (chain, apiBase) so a
  // re-render never cycles it — a stream that reconnects on every frame
  // would be worse than no stream at all.
  useEffect(() => {
    if (!streamLive) return;
    if (typeof globalThis.EventSource !== 'function') {
      // No SSE in this environment (SSR, or a test without a polyfill). The
      // snapshot path stands alone; the indicator says so rather than
      // claiming a live lane.
      return;
    }
    const handle = openEvmStream({
      chain,
      apiBase,
      handlers: {
        onFrame: (frame) => {
          const action = frameToAction(frame);
          if (action !== null) dispatch(action);
        },
        onResnapshot: (resnapshotChain) => {
          // Route through the store rather than calling `snapshot()` here:
          // the store is what remembers the obligation across a failed
          // fetch, and the effect above is what retries it.
          dispatch({ type: 'require-refresh', chain: resnapshotChain });
        },
        onStatus: setStreamStatus,
      },
    });
    return () => handle.close();
  }, [chain, apiBase, streamLive, streamGeneration]);

  // One clock for the whole board — and it STOPS while the board is dormant.
  //
  // `live` is `!paneHidden` at the call site: the persistent Discover pane
  // stays mounted behind the trade page, so without this gate an invisible
  // board keeps ticking once a second, and each tick re-adapts every card in
  // every lane (`rowsByStage` depends on `nowMs`) to repaint ages nobody is
  // looking at. The Solana subtree already goes dormant on the same signal.
  //
  // The immediate `setNowMs` is what makes waking up correct: the interval's
  // first fire is a full second away, so a reveal would otherwise paint one
  // frame of ages frozen at the moment the pane was hidden.
  useEffect(() => {
    setNowMs(Date.now());
    if (!live) return;
    const timer = globalThis.setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => globalThis.clearInterval(timer);
  }, [live]);

  const launchOptions = useMemo(() => evmLaunchOptionsForChain(chain), [chain]);
  const allLaunchKeys = useMemo(() => allEvmLaunchIdentityKeys(chain), [chain]);
  const [selectedByChain, setSelectedByChain] = useState<
    Record<string, readonly EvmLaunchIdentityKey[]>
  >({});
  const selectedLaunchKeys = selectedByChain[chain] ?? allLaunchKeys;
  const selectedLaunchSet = useMemo(
    () => new Set<EvmLaunchIdentityKey>(selectedLaunchKeys),
    [selectedLaunchKeys],
  );
  useEffect(() => {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    const selected = readEvmLaunchSelection(storage, chain);
    setSelectedByChain((current) => ({ ...current, [chain]: selected }));
  }, [chain]);
  const setSelectedLaunchKeys = useCallback((next: readonly EvmLaunchIdentityKey[]) => {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    writeEvmLaunchSelection(storage, chain, next);
    setSelectedByChain((current) => ({ ...current, [chain]: next }));
  }, [chain]);
  const includeSelectedLaunch = useCallback(
    (card: {
      launchpad: EvmLaunchpad | null;
      launchVariant: EvmLaunchVariant | null;
    }): boolean => evmLaunchIncluded(selectedLaunchSet, card),
    [selectedLaunchSet],
  );

  /* Every lane's rows, adapted against ONE clock so the whole board agrees
     about "now" (per-card `Date.now()` makes an age column jitter). */
  const rowsByStage = useMemo(() => {
    const out = {} as Record<EvmLane, MockCoin[]>;
    for (const stage of EVM_LANES) {
      out[stage] = toDiscoverRows(
        selectMergedLane(state, chain, stage, includeSelectedLaunch),
        nowMs,
      );
    }
    return out;
  }, [state, chain, includeSelectedLaunch, nowMs]);

  /* THE decoupling. One detached store per mounted lane board: the shared
     `CoinCard` reads its row through `DiscoverCoinStoreContext`, so pointing
     that context at a store WE own means an EVM card never subscribes into
     the Solana singleton — no chain branch inside the card's hot subscription
     path, and no listener held on the Solana feed for a key it will never
     have. Same seam the Almost Graduated section already uses. */
  const coinStore = useMemo(() => createDetachedCoinStore(), []);
  const allRows = useMemo(
    () => EVM_LANES.flatMap((stage) => rowsByStage[stage]),
    [rowsByStage],
  );
  /* Layout effect, not effect: publish BEFORE the cards' subscriptions read
     their snapshot in the same commit, so a freshly mounted lane paints its
     rows immediately instead of one frame empty. */
  useLayoutEffect(() => {
    publishRows(coinStore, allRows);
  }, [coinStore, allRows]);

  /* THE SAME LAYOUT ENGINE THE SOLANA BOARD RUNS. `resolveLayout` owns the
     rows/columns axis flip and the density preset, and calling it here (rather
     than restating `mode === 'rows' ? …` locally) is what keeps the two boards
     from drifting apart the next time that rule changes. Only the axis and the
     card size are taken: its `panels` are Solana section ids, and this board's
     panels are lifecycle stages. `extraRowAvailable: false` because the auto
     second row is a measurement the Solana page makes for its own sections. */
  const layout = useDiscoverStore((s) => s.layout);
  const descriptor = useMemo(
    () => resolveLayout(layout, { extraRowAvailable: false }),
    [layout],
  );
  const presetZoom = CARD_ZOOM_BY_SIZE[layout.cardSize] ?? 1;
  /* Panel weights are LOCAL, not the store's `layout.sizes`. Those are keyed by
     Solana `SectionId` and persisted under one versioned key; writing stage
     names into them would corrupt a shape `sanitize` guarantees. The cost is
     that an EVM drag does not survive a reload — reported as an open gap
     rather than papered over by persisting into a foreign key space. */
  const [panelSizes, setPanelSizes] = useState<Record<string, number>>({});

  const hasCurrentSnapshot = snapshotCurrentChain === chain;
  const feedUnavailable = evmFeedUnavailable(snapshotAttempt, chain, hasCurrentSnapshot);
  /* Only this chain's staleness. A leftover age from the previously selected
     chain would mark a board it says nothing about. */
  const snapshotStaleMs =
    snapshotAttempt.chain === chain ? snapshotAttempt.staleAgeMs : null;

  const panels: StackPanel[] = EVM_LANES.map((stage) => ({
    id: stage,
    sizing: 'flex' as const,
    weight: 1,
    content: (
      <EvmLane
        stage={stage}
        rows={rowsByStage[stage]}
        total={rowsByStage[stage].length}
        unavailable={feedUnavailable}
        cardFlow={descriptor.cardFlow}
        maxZoom={presetZoom}
        filterSection={evmFilterSection(stage)}
        onOpenFilters={onOpenFilters}
      />
    ),
  }));

  return (
    <DiscoverCoinStoreContext.Provider value={coinStore}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="evm-discover-lanes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StreamIndicator
            status={streamStatus}
            live={streamLive}
            stale={chainNeedsRefresh || !hasCurrentSnapshot}
            unavailable={feedUnavailable}
            staleAgeMs={snapshotStaleMs}
            failure={snapshotAttempt.chain === chain ? snapshotAttempt.failure : null}
            snapshotFailures={snapshotFailures}
            store={state.counters}
          />
          <EvmQuickbuyConfig chain={chain} />
        </div>
        <div
          className="flex flex-wrap items-center gap-1 py-1"
          data-testid="evm-launchpad-filter"
          aria-label="EVM launchpad and mode filters"
        >
          <button
            type="button"
            className="rounded border px-1.5 py-0.5"
            style={{ borderColor: 'var(--hairline)', fontFamily: 'var(--mono)', fontSize: 9 }}
            onClick={() => setSelectedLaunchKeys(allLaunchKeys)}
          >
            All
          </button>
          <button
            type="button"
            className="rounded border px-1.5 py-0.5"
            style={{ borderColor: 'var(--hairline)', fontFamily: 'var(--mono)', fontSize: 9 }}
            onClick={() => setSelectedLaunchKeys([])}
          >
            Clear
          </button>
          {launchOptions.map((option) => {
            const key = evmLaunchIdentityKey(option.launchpad, option.launchVariant);
            const selected = selectedLaunchSet.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedLaunchKeys(
                  selected
                    ? selectedLaunchKeys.filter((candidate) => candidate !== key)
                    : [...selectedLaunchKeys, key],
                )}
              >
                <EvmLaunchpadBadge
                  chain={chain}
                  launchpad={option.launchpad}
                  launchVariant={option.launchVariant}
                  selected={selected}
                />
              </button>
            );
          })}
        </div>
        <PanelStack
          axis={descriptor.axis}
          panels={panels}
          sizes={panelSizes}
          onSizesChange={setPanelSizes}
          className="min-h-0 flex-1"
        />
      </div>
    </DiscoverCoinStoreContext.Provider>
  );
}


/**
 * `stillBelongs` for a lane's pause merge.
 *
 * MODULE-LEVEL so its reference is stable — `usePausableRow` has it in an
 * effect's dependency list, and a fresh closure per render would re-run the
 * merge on every render instead of on every frame.
 *
 * A card that changed stage has already left this lane's `rows` (the reducer
 * MOVES it), so there is nothing per-row to re-test: `rows` is the lane. The
 * predicate then exists to state what the freeze does with a card that
 * vanished from the live list — it KEEPS it, stale, exactly as the Solana
 * rows do, because a card disappearing from under the pointer is the failure
 * being prevented. It resolves on pointer-leave.
 */
const stillInLane = (): boolean => true;

/**
 * Slot key for `CardLane`. MODULE-LEVEL so its identity is stable — it is a
 * prop of the memoized lane, and a fresh closure per render defeats the memo.
 *
 * The CARD's own store key, not `row.id`: `MockCoin.id` is optional, and the
 * two must agree or a slot and the card inside it can key off different things.
 * It is chain-qualified (`mint:bsc:0x…`), so the same address on two EVM chains
 * cannot collide into one slot.
 */
const laneRowKey = (row: MockCoin): string => tokenCardKey(row);

/**
 * One lifecycle lane, rendered through the SHARED `Section`.
 *
 * A COMPONENT PER LANE, rather than four lanes rendered from one loop in the
 * board, because each lane owns hover-pause and search state and a hook cannot
 * be called inside a loop.
 *
 * WHY `Section` AND NOT A LOCAL `<ul>`, which is what this was: `Section`
 * mounts `CardLane`, and `CardLane` is the only thing in the codebase that
 * provides `CardVisibilityContext`. Hand-rolling the markup therefore cost far
 * more than section chrome — every EVM card stayed permanently "visible", so
 * an off-screen card kept its live feed subscription and repainted on every
 * frame, and the `--card-zoom` density preset (cascaded onto
 * `.discover-card-zoom` slots by the lane) had nothing to apply to. One seam,
 * four symptoms.
 *
 * `quickBuySectionId={null}` is the hard gate: no section id means the
 * one-click buy is not rendered at all here, matching `sectionId={null}` on the
 * card below. EVM's spend path is not wired, and every quick-buy amount we hold
 * is a number of SOL.
 */
export function EvmLane({
  stage,
  rows,
  total,
  unavailable,
  cardFlow,
  maxZoom,
  filterSection,
  onOpenFilters,
}: {
  stage: EvmLane;
  /** This lane's rows, newest first, already adapted against the board clock. */
  rows: MockCoin[];
  /** The lane's size in the STORE — what the filter and search narrowed from. */
  total: number;
  /** The chain's snapshot could not be read (`evmFeedUnavailable`). */
  unavailable: boolean;
  cardFlow: Axis;
  maxZoom: number;
  /** Which persisted filter row supplies this lane's bounds. */
  filterSection: DiscoverSectionId;
  onOpenFilters?: (section: DiscoverSectionId) => void;
}) {
  const [search, setSearch] = useState('');
  const filter = useDiscoverStore((s) => s.filters[filterSection]);
  const matched = useMemo(
    () => laneVisibleRows(rows, search, filter),
    [rows, search, filter],
  );

  /* HOVER-TO-PAUSE, the shared implementation the Solana rows use. Live frames
     reorder and remove cards continuously, so without this a card moves out
     from under the cursor between the mousedown and the click and the click
     lands on whatever slid into its place — on cards that carry a trade
     control. `search` is the snap key: a mouse user typing in this header
     necessarily has the pointer inside the lane, and a frozen row would make
     search look inert. */
  const { visible, paused, onPointerEnter, onPointerLeave } = usePausableRow(
    matched,
    stillInLane,
    search,
  );

  const renderCard = useCallback(
    (row: MockCoin): ReactNode => (
      /* THE SHARED CARD. `sectionId={null}` is how a non-Solana row opts out of
         the per-section quick-buy apparatus — see `CoinCardProps.sectionId`.
         `fallbackCoin` carries the row directly so the first paint never
         depends on the store publish having landed. */
      <CoinCard cardKey={tokenCardKey(row)} fallbackCoin={row} sectionId={null} />
    ),
    [],
  );

  /* The lane's TOTAL alongside how many are shown — a filtered count displayed
     alone reads as the lane shrinking, and it is the only thing on screen that
     accounts for a row the metric filter excluded for having no USD figure at
     all. `headerBadge` carries the paused pill, so a frozen row says so in the
     same slot the Solana sections use.

     AN UNREADABLE LANE WITH NOTHING IN IT HAS NO COUNT — it renders "—", the
     same unknown mark a card's missing history uses, because the 0 it would
     otherwise print is not a measurement of this chain, it is the absence of
     one. The unavailable state is scoped to the EMPTY case on purpose: a lane
     still holding its last good cards is reporting a real count of real (if
     stale) rows, and the chip above the board is what says the feed behind
     them cannot be read. */
  const blank = unavailable && total === 0;
  const countBadge = blank
    ? '—'
    : visible.length === total
      ? `${total}`
      : `${visible.length} of ${total}`;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid={`evm-lane-${stage}`}
      data-paused={paused ? 'true' : 'false'}
      data-count={countBadge}
      data-unavailable={blank ? 'true' : 'false'}
    >
      <Section
        label={STAGE_LABELS[stage]}
        variant="standard"
        sizing="flex"
        tracks={1}
        cardFlow={cardFlow}
        maxZoom={maxZoom}
        quickBuySectionId={null}
        isAlpha={false}
        headerAction={
          onOpenFilters === undefined ? (
            <LaneCount label={countBadge} />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <LaneCount label={countBadge} />
              <DiscoverFiltersButton
                active={rowFilterActive(filter)}
                onClick={() => onOpenFilters(filterSection)}
                iconOnly={cardFlow === 'vertical'}
              />
            </div>
          )
        }
        headerBadge={paused ? 'paused' : null}
        searchValue={search}
        onSearchChange={setSearch}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        items={visible}
        getKey={laneRowKey}
        renderCard={renderCard}
        /* Only reachable with zero items, so a lane holding stale cards still
           shows them rather than hiding real rows behind a notice. */
        emptyState={blank ? <LaneUnavailable /> : undefined}
      />
    </div>
  );
}

/**
 * The lane body when the chain's snapshot could not be read.
 *
 * Exists so an unreadable lane cannot render as a lane with no tokens in it.
 * It states the retry as well as the failure: the board re-attempts on a fixed
 * interval, and a degrade with no stated end reads as a page the user must
 * reload.
 */
function LaneUnavailable() {
  return (
    <p
      data-testid="evm-lane-unavailable"
      style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-2)' }}
    >
      Feed unavailable — this chain’s snapshot could not be read. Retrying.
    </p>
  );
}

/**
 * The per-chain NATIVE quickbuy preset — the amount the ⚡ control on every
 * chain-bound card spends (`lib/evm/quickbuy.ts`).
 *
 * Configured HERE, on the board the cards live on, because the preset is
 * chain-scoped: one amount of the chain's own coin, not a per-section SOL
 * figure. Empty means OFF — no card renders a spend control until the user
 * has chosen an amount, and an invalid amount is refused at the input rather
 * than stored and refused at the press.
 */
function EvmQuickbuyConfig({ chain }: { chain: string }) {
  const nativeSymbol = nativeSymbolForChain(chain);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<'idle' | 'saved' | 'cleared' | 'invalid'>('idle');
  /* Loaded in an effect (not an initializer) so SSR and hydration both render
     the empty input and the client corrects after mount — localStorage is a
     client-only source. */
  useEffect(() => {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    setText(readEvmQuickbuyAmountText(storage, chain) ?? '');
    setVerdict('idle');
  }, [chain]);
  const commit = () => {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    setVerdict(writeEvmQuickbuyAmountText(storage, chain, text));
  };
  return (
    <label
      className="flex shrink-0 items-center gap-1"
      data-testid="evm-quickbuy-config"
      title={`One-click buy size for ${nativeSymbol} cards on this board, in ${nativeSymbol}. Leave empty to disable quickbuy. This is a separate setting from the Solana (SOL) quickbuy amounts.`}
    >
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-2)' }}>
        ⚡ quickbuy ({nativeSymbol})
      </span>
      <input
        value={text}
        inputMode="decimal"
        placeholder="off"
        onChange={(event) => {
          setText(event.target.value);
          setVerdict('idle');
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        data-testid="evm-quickbuy-config-input"
        aria-label={`Quickbuy amount in ${nativeSymbol}`}
        className="w-16 rounded border bg-transparent px-1 text-right"
        style={{ fontFamily: 'var(--mono)', fontSize: 10, borderColor: 'var(--hairline)' }}
      />
      {verdict === 'invalid' && (
        <span style={{ fontSize: 9, color: 'var(--down, #e05260)' }} role="status">
          not a valid amount
        </span>
      )}
      {verdict === 'saved' && (
        <span style={{ fontSize: 9, color: 'var(--ink-3)' }} role="status">
          saved
        </span>
      )}
      {verdict === 'cleared' && (
        <span style={{ fontSize: 9, color: 'var(--ink-3)' }} role="status">
          off
        </span>
      )}
    </label>
  );
}

/** Shown vs held. See `countBadge` above for why both numbers travel. */
function LaneCount({ label }: { label: string }) {
  return (
    <span
      data-testid="evm-lane-count"
      className="shrink-0"
      style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-2)' }}
    >
      {label}
    </span>
  );
}

/**
 * Live-state chip.
 *
 * Exists because a silent failure is a defect: without it, a dead socket and
 * a quiet chain look identical, and so do a clean stream and one that has
 * dropped a thousand malformed frames. Every counter the stream keeps is in
 * the tooltip.
 */
export function StreamIndicator({
  status,
  live,
  stale,
  unavailable,
  staleAgeMs,
  failure,
  snapshotFailures,
  store,
}: {
  status: EvmStreamStatus | null;
  live: boolean;
  stale: boolean;
  /** The chain's snapshot could not be read (`evmFeedUnavailable`). Outranks
   *  every other label: `refreshing` describes a condition that is expected to
   *  end, and applying it to one that is not is how a broken feed and a quiet
   *  chain came to render identically. */
  unavailable: boolean;
  /** Age of a board that WAS read and is behind the freshness contract, or
   *  `null`. A THIRD state, not a shade of the other two: unavailable means
   *  nothing could be read, refreshing means a re-read is owed and expected to
   *  land, and this one means the cards below are real and old. */
  staleAgeMs: number | null;
  /** Which condition the last failed read hit, for the tooltip. `null` when
   *  the last read landed. Six causes under one word is what the operator
   *  reading a screenshot could not tell apart. */
  failure: EvmDiscoverReadFailure | null;
  /** Re-snapshot attempts that failed. A refresh that never lands must be
   *  countable — otherwise a permanently stale lane and a healthy one both
   *  render the same chip. */
  snapshotFailures: number;
  /** The STORE's own degrade counters — a different lane of truth from the
   *  stream's. The stream counts what arrived; these count what the reducer
   *  had to do about it, including the snapshot/stream replay race that is
   *  self-correcting and would otherwise be invisible. */
  store: EvmLaneCounters;
}) {
  /* Seconds, floored, and never below 1: a board the contract already calls
     stale is at least ten seconds old, and "0s" would read as fresh. */
  const staleLabel =
    staleAgeMs === null ? null : `stale · ${Math.max(Math.floor(staleAgeMs / 1000), 1)}s old`;
  if (!live) {
    /* Snapshot-only is not exempt: the socket being off says nothing about
       whether the one read this view depends on landed. */
    return (
      <p
        className="text-[10px]"
        data-testid="evm-stream-status"
        data-phase="off"
        data-unavailable={unavailable ? 'true' : 'false'}
        data-snapshot-stale-ms={staleAgeMs ?? ''}
      >
        {unavailable
          ? 'Feed unavailable — this chain’s snapshot could not be read.'
          : staleLabel !== null
            ? `Snapshot only — and this one is ${staleLabel}.`
            : 'Snapshot only — live updates are off for this view.'}
      </p>
    );
  }
  const phase = status?.phase ?? 'connecting';
  const counters = status?.counters;
  /* PRECEDENCE, worst honest state first. `unavailable` (nothing could be
     read) outranks `stale` (real cards, old) outranks `refreshing` (a re-read
     is owed and expected to land) outranks the socket's own phase. The
     incident this file was rewritten for was a board frozen under a green
     `live`, so the phase is the LAST thing allowed to speak. */
  const label =
    unavailable
      ? 'feed unavailable'
      : staleLabel !== null
        ? staleLabel
        : stale
          ? 'refreshing'
          : phase === 'live'
            ? 'live'
            : phase === 'retrying'
              ? 'reconnecting'
              : phase;
  // Two lanes that mean different things never share a counter: the stream's
  // `gaps` is "a hole arrived", the store's `gapsDetected` is "the reducer
  // raised a re-snapshot for one", and `framesReplayed` is a third thing
  // entirely (a duplicate the snapshot already held).
  const storeDetail = [
    `store: replayed frames ${store.framesReplayed}`,
    `unarbitrable snapshots ${store.snapshotsWithoutSeq}`,
    `store gaps ${store.gapsDetected}`,
    `frames for unknown cards ${store.framesForUnknownCard}`,
    // A DROPPED ROW, not a failed read: the board is on screen and one card of
    // it could not be decoded. Nothing else on this chip can say that, and a
    // silent drop reads as a token the producer never served.
    `snapshot cards dropped ${store.cardsRejected}`,
  ].join(' · ');
  // The last read's own verdict travels with the counts: a count says how
  // often, only this says what.
  const readDetail = [
    `failed refreshes ${snapshotFailures}`,
    failure === null ? 'last read ok' : `last read failed: ${failure}`,
    staleAgeMs === null ? 'snapshot within contract' : `snapshot age ${staleAgeMs}ms`,
  ].join(' · ');
  const detail =
    counters === undefined
      ? `Stream has not reported yet. · ${readDetail} · ${storeDetail}`
      : [
          readDetail,
          `frames ${counters.framesApplied}`,
          `gaps ${counters.gaps}`,
          `ring lapses ${counters.ringLapped}`,
          `epoch changes ${counters.epochChanges}`,
          `reconnects ${counters.reconnects}`,
          `silent stalls ${counters.silentStalls}`,
          `transport errors ${counters.transportErrors}`,
          `malformed ${counters.framesMalformed}`,
          `foreign-chain ${counters.framesForeignChain}`,
          storeDetail,
        ].join(' · ');
  return (
    <p
      className="text-[10px]"
      data-testid="evm-stream-status"
      data-phase={phase}
      /* Machine-readable too: a tooltip is for a human watching, and a
         rollout needs a selector a harness can read. */
      data-frames-replayed={store.framesReplayed}
      data-snapshots-without-seq={store.snapshotsWithoutSeq}
      data-store-gaps={store.gapsDetected}
      data-cards-rejected={store.cardsRejected}
      data-snapshot-failures={snapshotFailures}
      data-unavailable={unavailable ? 'true' : 'false'}
      data-snapshot-stale-ms={staleAgeMs ?? ''}
      data-snapshot-failure={failure ?? ''}
      data-silent-stalls={counters?.silentStalls ?? 0}
      title={detail}
      style={{
        fontFamily: 'var(--mono)',
        color: unavailable
          ? 'var(--down, #e05260)'
          : staleAgeMs !== null
            ? 'var(--warn, #d99a2b)'
            : phase === 'live' && !stale
              ? 'var(--positive, #37c07a)'
              : 'var(--ink-2)',
      }}
    >
      ● {label}
      {status?.seq !== null && status?.seq !== undefined ? ` · seq ${status.seq}` : ''}
    </p>
  );
}

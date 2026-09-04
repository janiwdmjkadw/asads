/**
 * EVM discover lane state (guide WP-313, terminal side).
 *
 * Pure reducer + selectors. Kept OUT of the React component so every rule is
 * testable without rendering: a lane's correctness is about ordering,
 * de-duplication and staleness, none of which need a DOM.
 *
 * Invariants:
 * - **Cards de-duplicate on the chain-qualified key.** The same address on
 *   two chains is two cards; the same card arriving twice is one. Getting
 *   this wrong renders duplicates or merges distinct tokens.
 * - **A stage change MOVES a card, it does not copy it.** A token that
 *   graduates must leave the lane it was in, or it renders in two lanes at
 *   once and the counts lie.
 * - **Older blocks never overwrite newer state.** Frames can arrive out of
 *   order across a reconnect; applying a stale one would visibly rewind the
 *   card.
 * - **A seq gap means REFRESH, never silent continuation.** The exec feed
 *   mints seq at the tap precisely so a drop is visible; ignoring the gap
 *   throws away that signal and leaves the lane quietly wrong.
 * - **Refresh is PER CHAIN.** `seq` is per-chain (the chain travels WITH the
 *   cursor, an internal routine), so a hole in BSC's feed says nothing about
 *   Robinhood's. A single global flag re-snapshotted every chain on any
 *   chain's gap — wasted reads, and worse, it cleared on the first chain's
 *   snapshot while the chain that actually gapped stayed unrefreshed.
 *
 * CLOSED — the graduation stamp landed. This header used to carry a handoff
 * asking for `graduated_at_sec` on
 * an internal backend type, because the Graduated lane
 * could only fall back to last-applied-block order (a ranking by how recently
 * a token TRADED, not by when it graduated, which is what Solana's Graduated
 * row answers with `graduatedAt desc`). The producer ships it now and
 * `selectLane` sorts by it — under the same unknown-sinks rule the `new` lane
 * uses, because a token hydrated already-graduated carries no stamp and must
 * not be read as 1970.
 *
 * WHAT IS STORED IS THE WIRE CARD, NOT THE VIEW. The reducer applies live
 * frames by arithmetic (a trade increments the fold's counters), and that
 * arithmetic needs the exact `u128` decimal strings, not a formatted "1.23".
 * Views are derived in the selectors — a stored view is a cache that goes
 * stale against the card on the very next frame.
 */

import {
  evmCardKey,
  parseEvmDiscoverCard,
  toCardView,
  type EvmCardView,
  type EvmDiscoverCard,
} from './discoverAdapter';
import { parseWire } from './money';
import type { EvmFrame } from './stream';

export type EvmStage = EvmDiscoverCard['stage'];

/**
 * Every stage the WIRE can report. `migrating` is a real fold state — the
 * curve completed and liquidity is mid-move — and it is what makes a card
 * non-tradeable (`toLaneCard`'s `tradeable: stage !== 'migrating'`). It must
 * stay in this list or such a card would fail `isStage` and be dropped.
 */
export const EVM_STAGES: readonly EvmStage[] = [
  'new',
  'ripening',
  'migrating',
  'graduated',
] as const;

/**
 * The lanes the board RENDERS — three, matching Solana's three sections
 * (`new-pairs`, `almost-graduated`, `graduated`).
 *
 * There is no Migrating lane. Owner, 2026-08-07: "there shouldn't be a
 * 'Migrating' lane — that's what ripening is." A fourth lane was invented for
 * EVM because the wire has a fourth STAGE, which conflated a fold state with
 * a place to put cards. Migrating tokens now render in Ripening
 * (`stagesForLane`) and keep their non-tradeable treatment per card, so
 * nothing is lost but the extra column.
 */
export const EVM_LANES = ['new', 'ripening', 'graduated'] as const;
export type EvmLane = (typeof EVM_LANES)[number];

/** Which wire stages feed a rendered lane. Ripening absorbs `migrating`. */
export function stagesForLane(lane: EvmLane): readonly EvmStage[] {
  return lane === 'ripening' ? (['ripening', 'migrating'] as const) : ([lane] as const);
}

/**
 * Trades a `new` token needs before the fold promotes it to `ripening`.
 *
 * Mirrors an internal backend type. It
 * is duplicated here — rather than waiting for the next snapshot to move the
 * card — because a token that ripens live and stays rendered in "New pairs"
 * until an unrelated seq gap forces a refetch is a lane that is visibly
 * wrong for minutes. The duplication is bounded (one integer), named, and
 * self-correcting: every snapshot is authoritative and overwrites whatever
 * the client derived.
 */
export const RIPENING_TRADE_COUNT = 10;

/**
 * The most cards one lane RENDERS.
 *
 * Mirrors `DISCOVER_ROW_RENDER_LIMIT` (50) from
 * `components/discover/useLiveNewPairs.ts`, which is where every Solana
 * section's cap comes from. Re-stated here rather than imported: that module
 * pulls the Solana live-feed apparatus (the delta-wire consumer, the feed
 * store singleton, image preloading) and the EVM lanes exist partly to not
 * hold any of it. The duplication is one integer, named, and checked against
 * its source in `laneState.test.ts`.
 */
export const EVM_LANE_RENDER_LIMIT = 50;

/**
 * The most cards this store will hold for one (chain, stage) bucket.
 *
 * WHY A CAP EXISTS AT ALL. Nothing else bounds this store. A snapshot is
 * authoritative only for the chain it replaces, and re-snapshots happen only
 * when a seq gap raises an obligation — so on a HEALTHY stream, which never
 * gaps, `created` frames add a key per new token and nothing ever removes one.
 * Every lane therefore grows for as long as the tab is open, and the cost is
 * not just memory: the lanes re-adapt every card they hold on a 1 s clock, so
 * an overnight session ends up rebuilding tens of thousands of rows a second
 * for a board showing fifty. That is the leak, and a render-side `slice(0, 50)`
 * does not fix it — it only hides the growth behind a viewport.
 *
 * WHY IT IS PER (CHAIN, STAGE) rather than per chain. The four lanes are
 * independent views, and a chain-wide budget lets a burst of new pairs evict
 * the graduated lane out from under the user — the one lane whose rows are
 * scarce and long-lived.
 *
 * WHY 4x THE RENDER LIMIT and not the render limit itself. Search and the
 * metric filters run over the WHOLE lane and cap afterwards (the Solana page
 * does the same), so a store trimmed to exactly what is on screen would make a
 * search unable to find the 51st card — a filter that silently cannot see its
 * own corpus. Four screens of headroom keeps that honest while still bounding
 * the store at 200 cards per lane, 800 per chain.
 */
export const EVM_LANE_STORE_LIMIT = EVM_LANE_RENDER_LIMIT * 4;

/**
 * What a live frame knows that a snapshot card cannot carry.
 *
 * The `GET /evm/discover` wire now carries the fold's own admission stamp
 * (`firstSeenSec`), so the age half of this map is a FALLBACK for frames
 * that predate the field — `toLaneCard` prefers the wire's stamp. Last-trade
 * fields still exist ONLY for tokens we watched happen (verified against
 * an internal backend type). Kept in a side map so a
 * snapshot — authoritative for everything the fold measures — does not erase
 * observations the fold never had.
 *
 * Every field is optional and absent means UNKNOWN. Nothing here is ever
 * defaulted to 0: a card with no observed trade has no last price, which is
 * a different statement from a last price of zero.
 */
export interface EvmLiveMarks {
  /**
   * BLOCK time of the frame we first observed this token on — `null` when
   * that block carried no usable timestamp.
   *
   * It is not a wall clock and must never be substituted with one. This field
   * feeds the card's age and the discover lanes' ordering, so a wall-clock
   * stand-in does not degrade an unknown age: it manufactures the freshest
   * measurement on the chain out of a block that told us nothing.
   */
  readonly firstSeenAtMs?: number | null;
  /** Block time of the newest observed trade; `null` when it carried none. */
  readonly lastTradeAtMs?: number | null;
  readonly lastTradeSide?: 'buy' | 'sell';
  /** Last trade's exact price as `costWei / amountBaseUnits`. */
  readonly lastPriceNum?: string;
  readonly lastPriceDen?: string;
}

/**
 * Every self-correcting degrade this store performs, COUNTED.
 *
 * "Self-correcting" is not "invisible". Each of these is a condition that
 * resolves on the next authoritative snapshot, which is exactly why nothing
 * would ever report it — and an uncounted silent correction is
 * indistinguishable from a bug that happens not to be firing.
 */
export interface EvmLaneCounters {
  /**
   * Frames whose seq the store had already applied for that chain — a
   * REPLAY, dropped rather than folded twice.
   *
   * The specific race this exists for (closure §5, tier 2.9): the lanes
   * subscribe to the socket BEFORE fetching the snapshot, so a trade landing
   * in that window is folded into the snapshot AND delivered as a live frame.
   * Seq is minted at the tap and is monotonic per chain, so `seq <= applied`
   * is a provable duplicate — as long as the snapshot reported its seq.
   */
  readonly framesReplayed: number;
  /**
   * Snapshots that arrived with NO seq, so the replay guard above could not
   * arbitrate for that window and any duplicate WAS double-counted until the
   * next snapshot.
   *
   * This is the honest measure of the residual race, and it is per snapshot
   * rather than per frame because that is the granularity at which the
   * condition actually exists.
   */
  readonly snapshotsWithoutSeq: number;
  /** Seq holes detected — each raised a re-snapshot obligation. */
  readonly gapsDetected: number;
  /** Frames about a token the store does not hold; forced a re-snapshot. */
  readonly framesForUnknownCard: number;
  /**
   * Snapshot cards the wire served that could not be decoded, so the board
   * renders that many rows fewer.
   *
   * A card-level drop is not a lane-level failure, and conflating the two is
   * what rendered every EVM lane as "feed unavailable" over cards that were
   * being served correctly. The drop self-corrects on the next snapshot only
   * if the producer changes, so it is exactly the kind of silent degrade this
   * surface exists to make visible.
   */
  readonly cardsRejected: number;
}

export const EMPTY_LANE_COUNTERS: EvmLaneCounters = {
  framesReplayed: 0,
  snapshotsWithoutSeq: 0,
  gapsDetected: 0,
  framesForUnknownCard: 0,
  cardsRejected: 0,
};

export interface EvmLaneState {
  /** Wire cards by chain-qualified key — the single source of truth. */
  readonly cards: Readonly<Record<string, EvmDiscoverCard>>;
  /** Last block applied per card key, for the stale-frame guard. */
  readonly lastBlock: Readonly<Record<string, number>>;
  /** Live-only observations, preserved across snapshots. */
  readonly marks: Readonly<Record<string, EvmLiveMarks>>;
  /** Newest feed seq applied, per chain. */
  readonly seqByChain: Readonly<Record<string, number>>;
  /**
   * Chains with an outstanding re-snapshot obligation. Per chain, because
   * seq is per chain — see the header.
   */
  readonly refreshChains: Readonly<Record<string, true>>;
  /** Degrade counters. Never reset by a snapshot — they are session totals. */
  readonly counters: EvmLaneCounters;
}

export const EMPTY_LANE_STATE: EvmLaneState = {
  cards: {},
  lastBlock: {},
  marks: {},
  seqByChain: {},
  refreshChains: {},
  counters: EMPTY_LANE_COUNTERS,
};

export type EvmLaneAction =
  /**
   * Full snapshot for a chain — replaces that chain's cards wholesale, across
   * ALL FOUR lanes. Build it with `snapshotAction`, never one per lane.
   *
   * `seq` is omitted when the snapshot's source does not report one. That is
   * NOT the same as zero: see the reducer branch.
   */
  | {
      type: 'snapshot';
      chain: string;
      cards: EvmDiscoverCard[];
      seq?: number;
      /** Cards the snapshot served that could not be decoded and were dropped. */
      cardsRejected?: number;
    }
  /** One card changed and the frame carried the whole card (`created`). */
  | {
      type: 'upsert';
      chain: string;
      card: EvmDiscoverCard;
      seq: number;
      /** Block time of the frame; `null` when the block carried none. */
      occurredAtMs?: number | null;
    }
  /**
   * A trade landed. The frame carries `{side, amount, cost}` and NOT a card
   * (the backend source), so the reducer applies the same arithmetic the fold
   * does — see `applyTrade`.
   */
  | {
      type: 'trade';
      chain: string;
      token: string;
      side: 'buy' | 'sell';
      /** Token base units moved. */
      amount: string;
      /** Native wei spent/received, excluding fee. */
      cost: string;
      seq: number;
      /** Block time of the trade; `null` when the block carried none. */
      occurredAtMs: number | null;
    }
  /** The fold moved a token's lifecycle stage. */
  | {
      type: 'stage';
      chain: string;
      token: string;
      stage: EvmStage;
      seq: number;
      /** Block time of the stage move; `null` when the block carried none. */
      occurredAtMs: number | null;
    }
  /** A reorg retracted a card. */
  | { type: 'revert'; chain: string; key: string; seq: number }
  /** A frame with nothing to apply; advances the cursor only. */
  | { type: 'checkpoint'; chain: string; seq: number }
  /** The stream (or the caller) determined this chain must be re-snapshotted. */
  | { type: 'require-refresh'; chain: string };

/**
 * Fold a whole `GET /evm/discover` response into ONE snapshot action.
 *
 * The endpoint answers with the chain's FOUR lanes, but a `snapshot` is
 * authoritative for the whole CHAIN — so one dispatch per lane deletes the
 * lane before it and only the last one survives. Reconciling the two facts
 * here, once, is what keeps every caller from having to know that.
 *
 * Applying it as a single action also means the reducer never passes through
 * a state where some lanes have been replaced and others have not.
 */
export function snapshotAction(
  chain: string,
  lanes: readonly {
    readonly cards: EvmDiscoverCard[];
    /** Absent for a caller that does not decode (tests, synthesized lanes). */
    readonly cardsRejected?: number;
  }[],
): EvmLaneAction {
  return {
    type: 'snapshot',
    chain,
    cards: lanes.flatMap((lane) => lane.cards),
    cardsRejected: lanes.reduce((total, lane) => total + (lane.cardsRejected ?? 0), 0),
  };
}

/**
 * Map one live SSE frame onto an action, or `null` when the frame carries
 * nothing this store can apply.
 *
 * STRICT: a frame whose payload does not parse is DROPPED rather than
 * applied with defaults. A trade with an unreadable `cost` is not a trade of
 * zero — it is a trade we cannot account for, and the caller counts it.
 * The one exception is a shape we can still learn the CURSOR from; those
 * become `checkpoint` so seq keeps advancing and the gap detector stays
 * accurate.
 *
 * **NO WALL CLOCK ENTERS HERE**, which is why this function no longer takes
 * one. `EvmFeedFrame.occurredAtMs` is chain EVENT time and defaults to `0`
 * when the block carried no usable timestamp (`lib/evm/stream.ts`), and that
 * `0` used to become `Date.now()`. `firstSeenAtMs` is what the discover cards
 * age and order by, so an un-headered launch was not merely undated — it was
 * dated NOW, and sorted as the freshest token on the chain. That is a
 * fabricated measurement in the field that decides ordering.
 * `lib/evm/tape.ts` has always read the same word as `null`; these agree with
 * it now.
 */
export function frameToAction(frame: EvmFrame): EvmLaneAction | null {
  const payload =
    typeof frame.payload === 'object' && frame.payload !== null
      ? (frame.payload as Record<string, unknown>)
      : null;

  switch (frame.kind) {
    case 'created':
    case 'state': {
      // `created` frames carry the whole discover card (the backend source emits
      // `discover_card(state)` as the payload); `state` is reserved for the
      // same shape. Anything else is not a card and must not be coerced.
      const card = asDiscoverCard(payload, frame.chain);
      if (card === null) return { type: 'checkpoint', chain: frame.chain, seq: frame.seq };
      return {
        type: 'upsert',
        chain: frame.chain,
        card,
        seq: frame.seq,
        occurredAtMs: frame.occurredAtMs > 0 ? frame.occurredAtMs : null,
      };
    }
    case 'trade': {
      const side = payload?.['side'];
      const amount = payload?.['amount'];
      const cost = payload?.['cost'];
      if (
        frame.token === null ||
        (side !== 'buy' && side !== 'sell') ||
        typeof amount !== 'string' ||
        typeof cost !== 'string'
      ) {
        return { type: 'checkpoint', chain: frame.chain, seq: frame.seq };
      }
      return {
        type: 'trade',
        chain: frame.chain,
        token: frame.token,
        side,
        amount,
        cost,
        seq: frame.seq,
        occurredAtMs: frame.occurredAtMs > 0 ? frame.occurredAtMs : null,
      };
    }
    case 'stage': {
      const stage = payload?.['stage'];
      if (frame.token === null || !isStage(stage)) {
        return { type: 'checkpoint', chain: frame.chain, seq: frame.seq };
      }
      return {
        type: 'stage',
        chain: frame.chain,
        token: frame.token,
        stage,
        seq: frame.seq,
        occurredAtMs: frame.occurredAtMs > 0 ? frame.occurredAtMs : null,
      };
    }
    case 'reverted': {
      if (frame.token === null) {
        return { type: 'checkpoint', chain: frame.chain, seq: frame.seq };
      }
      return {
        type: 'revert',
        chain: frame.chain,
        key: `${frame.chain}:${frame.token}`,
        seq: frame.seq,
      };
    }
    case 'checkpoint':
      return { type: 'checkpoint', chain: frame.chain, seq: frame.seq };
    default:
      return null;
  }
}

/**
 * Apply one action.
 *
 * Returns the SAME object when nothing changed, so React can bail out of a
 * re-render by identity — the discover page is the hottest list in the app
 * and a no-op frame must not repaint it.
 */
export function evmLaneReducer(
  state: EvmLaneState,
  action: EvmLaneAction,
): EvmLaneState {
  const next = applyAction(state, action);
  // THE CAP RUNS ON THE THREE ACTIONS THAT CAN GROW A BUCKET, and on nothing
  // else. `trade`, `revert`, `checkpoint` and `require-refresh` can only
  // shrink a bucket or leave its membership alone, so paying an O(cards) sweep
  // on them — `trade` is the hottest frame kind by an order of magnitude —
  // would buy nothing. `stage` is in the list because a graduation MOVES a
  // card between buckets and can therefore overflow the destination.
  if (
    next === state
    || (action.type !== 'snapshot' && action.type !== 'upsert' && action.type !== 'stage')
  ) {
    return next;
  }
  return capChainBuckets(next, action.chain);
}

function applyAction(
  state: EvmLaneState,
  action: EvmLaneAction,
): EvmLaneState {
  // THE REPLAY GUARD. Seq is minted at the tap and is monotonic per chain, so
  // a frame at or below the newest seq already applied for that chain is a
  // duplicate — most often one the snapshot already folded, because the lanes
  // subscribe before they snapshot. Applying it double-counts a trade into
  // `tradeCount`/`volumeNative`. Dropping it and counting the drop is the fix
  // AND the instrumentation; when the snapshot reports no seq there is no
  // baseline to compare against, and THAT window is counted separately.
  if (action.type !== 'snapshot' && action.type !== 'require-refresh') {
    const applied = state.seqByChain[action.chain];
    if (applied !== undefined && action.seq <= applied) {
      return bump(state, 'framesReplayed');
    }
  }

  switch (action.type) {
    case 'snapshot': {
      // A snapshot is authoritative for its chain: drop that chain's old
      // cards rather than merging, or a token deleted upstream lingers.
      const cards: Record<string, EvmDiscoverCard> = {};
      const lastBlock: Record<string, number> = {};
      for (const [key, card] of Object.entries(state.cards)) {
        if (card.chain !== action.chain) {
          cards[key] = card;
          lastBlock[key] = state.lastBlock[key] ?? 0;
        }
      }
      for (const wire of action.cards) {
        const key = evmCardKey(wire);
        cards[key] = wire;
        lastBlock[key] = wire.lastBlockNumber;
      }
      // A snapshot with no reported seq must not INVENT one. The feed mints
      // real, large seq values at the tap, so adopting a synthetic 0 as the
      // baseline makes the very next frame look like a multi-thousand-frame
      // hole — which raises a refresh, which re-snapshots, which resets to 0
      // again. Dropping the entry instead makes the next observed seq the
      // baseline, and `detectGap` cannot fire against an absent one.
      const seqByChain = { ...state.seqByChain };
      if (action.seq === undefined) {
        delete seqByChain[action.chain];
      } else {
        seqByChain[action.chain] = action.seq;
      }
      const rejected = action.cardsRejected ?? 0;
      return {
        cards,
        lastBlock,
        // Marks survive: they record what we WATCHED, which the fold never
        // measured and a snapshot therefore cannot restate. Pruned to the
        // surviving keys so a long session does not accumulate marks for
        // tokens that left the lanes.
        marks: pruneMarks(state.marks, cards),
        seqByChain,
        // A snapshot IS the refresh — for THIS chain only.
        refreshChains: withoutChain(state.refreshChains, action.chain),
        counters:
          action.seq === undefined || rejected > 0
            ? {
                ...state.counters,
                snapshotsWithoutSeq:
                  state.counters.snapshotsWithoutSeq + (action.seq === undefined ? 1 : 0),
                cardsRejected: state.counters.cardsRejected + rejected,
              }
            : state.counters,
      };
    }

    case 'upsert': {
      const gap = detectGap(state, action.chain, action.seq);
      const key = evmCardKey(action.card);
      const previousBlock = state.lastBlock[key];

      // Older blocks never overwrite newer state — frames can arrive out of
      // order across a reconnect, and applying a stale one visibly rewinds
      // the card.
      if (previousBlock !== undefined && action.card.lastBlockNumber < previousBlock) {
        return gap ? markRefresh(state, action.chain) : state;
      }

      return {
        cards: { ...state.cards, [key]: action.card },
        lastBlock: { ...state.lastBlock, [key]: action.card.lastBlockNumber },
        marks: mergeMark(state.marks, key, {
          // `?? null` at the end, never `?? Date.now()`: a block with no
          // timestamp leaves the age UNKNOWN. See `frameToAction`.
          firstSeenAtMs: state.marks[key]?.firstSeenAtMs ?? action.occurredAtMs ?? null,
        }),
        seqByChain: { ...state.seqByChain, [action.chain]: action.seq },
        refreshChains: gap
          ? { ...state.refreshChains, [action.chain]: true }
          : state.refreshChains,
        counters: countGap(state.counters, gap),
      };
    }

    case 'trade': {
      const gap = detectGap(state, action.chain, action.seq);
      const key = `${action.chain}:${action.token}`;
      const card = state.cards[key];
      const seqByChain = { ...state.seqByChain, [action.chain]: action.seq };
      if (card === undefined) {
        // A trade on a token we do not hold: the lane is missing a card the
        // server has. We cannot INVENT one — a card built from a trade frame
        // has no name, no stage and no history flag — so the honest response
        // is to re-snapshot this chain.
        return {
          ...state,
          seqByChain,
          refreshChains: { ...state.refreshChains, [action.chain]: true },
          counters: {
            ...countGap(state.counters, gap),
            framesForUnknownCard: state.counters.framesForUnknownCard + 1,
          },
        };
      }
      const applied = applyTrade(card, action);
      return {
        cards: { ...state.cards, [key]: applied },
        lastBlock: state.lastBlock,
        marks: mergeMark(state.marks, key, {
          lastTradeAtMs: action.occurredAtMs,
          lastTradeSide: action.side,
          // Exact last-trade price, as the ratio the wire doctrine wants:
          // native wei spent over token base units moved. NOT the event's
          // own `price` field — that is documented as "venue units" in
          // the backend source with no stated scale, so rendering it as a
          // price would be asserting a denomination nobody verified.
          lastPriceNum: action.cost,
          lastPriceDen: action.amount,
        }),
        seqByChain,
        refreshChains: gap
          ? { ...state.refreshChains, [action.chain]: true }
          : state.refreshChains,
        counters: countGap(state.counters, gap),
      };
    }

    case 'stage': {
      const gap = detectGap(state, action.chain, action.seq);
      const key = `${action.chain}:${action.token}`;
      const card = state.cards[key];
      const seqByChain = { ...state.seqByChain, [action.chain]: action.seq };
      if (card === undefined) {
        return {
          ...state,
          seqByChain,
          refreshChains: { ...state.refreshChains, [action.chain]: true },
          counters: {
            ...countGap(state.counters, gap),
            framesForUnknownCard: state.counters.framesForUnknownCard + 1,
          },
        };
      }
      // Stage NEVER regresses (the backend source): a late curve trade must not
      // pull a graduated token back to `ripening`.
      if (stageRank(action.stage) <= stageRank(card.stage)) {
        return {
          ...state,
          seqByChain,
          refreshChains: gap
            ? { ...state.refreshChains, [action.chain]: true }
            : state.refreshChains,
          counters: countGap(state.counters, gap),
        };
      }
      const needsCapabilityRefresh = card.stage === 'migrating' && action.stage !== 'migrating';
      return {
        ...state,
        cards: { ...state.cards, [key]: withStage(card, action.stage) },
        seqByChain,
        refreshChains: gap || needsCapabilityRefresh
          ? { ...state.refreshChains, [action.chain]: true }
          : state.refreshChains,
        counters: countGap(state.counters, gap),
      };
    }

    case 'revert': {
      // The gap check runs on EVERY frame kind, not just `upsert`. A revert
      // also ADVANCES seq past whatever was dropped before it, so skipping
      // the check here hides the hole from every later frame as well — the
      // lane stays quietly wrong with no outstanding refresh signal.
      const gap = detectGap(state, action.chain, action.seq);
      const seqByChain = { ...state.seqByChain, [action.chain]: action.seq };
      const refreshChains: Readonly<Record<string, true>> = gap
        ? { ...state.refreshChains, [action.chain]: true }
        : state.refreshChains;
      const counters = countGap(state.counters, gap);
      if (state.cards[action.key] === undefined) {
        // Nothing to retract; still advance seq so the gap detector stays
        // accurate.
        return { ...state, seqByChain, refreshChains, counters };
      }
      const cards = { ...state.cards };
      const lastBlock = { ...state.lastBlock };
      const marks = { ...state.marks };
      delete cards[action.key];
      delete lastBlock[action.key];
      // A retracted token's live observations go with it: keeping them would
      // resurrect a last-trade price for a trade the chain un-happened.
      delete marks[action.key];
      return { cards, lastBlock, marks, seqByChain, refreshChains, counters };
    }

    case 'checkpoint': {
      const gap = detectGap(state, action.chain, action.seq);
      return {
        ...state,
        seqByChain: { ...state.seqByChain, [action.chain]: action.seq },
        refreshChains: gap
          ? { ...state.refreshChains, [action.chain]: true }
          : state.refreshChains,
        counters: countGap(state.counters, gap),
      };
    }

    case 'require-refresh':
      return markRefresh(state, action.chain);

    default:
      return state;
  }
}

/**
 * Apply a trade to a wire card the way an internal routine does.
 *
 * Deliberately NOT a general-purpose fold: it updates only the fields a
 * trade frame can justify.
 * - Counts and volume advance ONLY when `historyComplete`. A partial-history
 *   card has no counts on the wire, and starting one at 1 here would turn an
 *   honest "—" into a claim that this token has traded exactly once.
 * - Reserves are NOT touched. The fold reads them from the event's resident
 *   `offers`/`funds`, and the frame payload carries neither — so the client
 *   would have to accumulate, which is exactly the approximation the fold
 *   exists to avoid. They stay at their last snapshot value until the next
 *   snapshot or a card-bearing frame.
 * - `lastBlockNumber` is NOT advanced: the frame carries a block HASH, not a
 *   number. Inventing one would defeat the stale-frame guard.
 */
export function applyTradeToCard<T extends EvmDiscoverCard>(
  card: T,
  action: { side: 'buy' | 'sell'; amount: string; cost: string },
): T {
  return applyTrade(card, action) as T;
}

function applyTrade<T extends EvmDiscoverCard>(
  card: T,
  action: { side: 'buy' | 'sell'; amount: string; cost: string },
): T {
  if (!card.historyComplete) {
    // Nothing countable changes, but the stage may still ripen — and it
    // cannot, because ripening is a function of a trade count we do not
    // have. So this card is unchanged; only its marks move.
    return card;
  }
  const tradeCount = (card.tradeCount ?? 0) + 1;
  const cost = parseWire(action.cost);
  const volumeBefore = parseWire(card.volumeNative);
  // A malformed cost leaves volume UNCHANGED rather than resetting it: the
  // trade happened, we just cannot price it, and a reset would be a
  // fabricated measurement.
  const volumeNative =
    cost !== null && volumeBefore !== null
      ? (volumeBefore + cost).toString()
      : card.volumeNative;
  const next: T = {
    ...card,
    tradeCount,
    buyCount: (card.buyCount ?? 0) + (action.side === 'buy' ? 1 : 0),
    sellCount: (card.sellCount ?? 0) + (action.side === 'sell' ? 1 : 0),
    volumeNative,
  };
  if (next.stage === 'new' && tradeCount >= RIPENING_TRADE_COUNT) {
    return withStage(next, 'ripening');
  }
  return next;
}

/**
 * Apply a stage-only frame without inventing execution capability.
 *
 * The frame proves only lifecycle. It carries no quote asset, reserve basis,
 * or concentrated-liquidity evidence, so it may PAUSE a card on migration but
 * may never promote an already-blocked card back to tradeable. An authoritative
 * upsert/snapshot is the only message that can clear that conservative hold.
 */
function withStage<T extends EvmDiscoverCard>(card: T, stage: EvmStage): T {
  const enteringMigration = stage === 'migrating';
  const next: T = {
    ...card,
    stage,
    // A stage frame can remove capability (migration), never add it. Before
    // this guard, any stage advance changed a non-native or unproved V3 market
    // from `tradeable:false` to true in the browser even though the engine
    // correctly refused it.
    tradeable: !enteringMigration && card.tradeable,
    buyable: enteringMigration ? false : card.buyable,
    sellable: enteringMigration ? false : card.sellable,
    tradeBlockedReason: enteringMigration ? 'migrating' : card.tradeBlockedReason,
    buyBlockedReason: enteringMigration ? 'migrating' : card.buyBlockedReason,
    sellBlockedReason: enteringMigration ? 'migrating' : card.sellBlockedReason,
  };
  if (stage === 'graduated') {
    // The curve stopped being the market, so its reserves stop being a
    // measurement of anything (`apply_liquidity_added`). Dropping them is
    // what makes the card render "—" instead of pricing against a dead pool.
    delete next.reserveNative;
    delete next.reserveToken;
  }
  return next;
}

const STAGE_RANK: Record<EvmStage, number> = {
  new: 0,
  ripening: 1,
  migrating: 2,
  graduated: 3,
};

function stageRank(stage: EvmStage): number {
  return STAGE_RANK[stage];
}

function isStage(value: unknown): value is EvmStage {
  return typeof value === 'string' && (EVM_STAGES as readonly string[]).includes(value);
}

/**
 * Wire-card decode for a LIVE frame — the SAME decoder the snapshot path uses.
 *
 * It used to be a second, hand-rolled shape check, and that is how the two
 * sides came to disagree about a field's wire TYPE: this one required
 * `lastBlockNumber` to be a JSON number, while the producer emits a `u64` as a
 * canonical decimal string on wire V2 (a `u64` block number exceeds 2^53 and a
 * JSON number would silently round it). Every `created` frame therefore
 * decoded to nothing.
 *
 * Sharing the decoder is what makes that class of skew unrepeatable, and it is
 * also what NORMALIZES the card: the store's monotonic block guard and the
 * lane sorts compare `lastBlockNumber` with `<`, so a string there is a
 * lexicographic comparison — a silent wrong answer, worse than the outage.
 */
function asDiscoverCard(
  payload: Record<string, unknown> | null,
  chain: string,
): EvmDiscoverCard | null {
  return payload === null ? null : parseEvmDiscoverCard(payload, chain);
}

/** Increment one counter, returning a new state. */
function bump(state: EvmLaneState, key: keyof EvmLaneCounters): EvmLaneState {
  return { ...state, counters: { ...state.counters, [key]: state.counters[key] + 1 } };
}

/**
 * Fold a gap decision into the counters.
 *
 * Returns the SAME object when there was no gap, so the identity bail-out
 * that keeps the hottest list in the app from repainting is preserved on the
 * overwhelmingly common path.
 */
function countGap(counters: EvmLaneCounters, gap: boolean): EvmLaneCounters {
  return gap ? { ...counters, gapsDetected: counters.gapsDetected + 1 } : counters;
}

/**
 * Trim every (chain, stage) bucket of one chain to `EVM_LANE_STORE_LIMIT`.
 *
 * WHAT IT EVICTS, AND WHY THAT ORDER. The survivors are chosen by the SAME
 * comparison `selectLane` renders by — newest last-applied block first, then
 * the key as a stable tie-break — so what is dropped is exactly what was
 * already ranked off the bottom of the lane. Evicting on any other key (say,
 * insertion order) would silently remove a card that is still on screen.
 *
 * Eviction is not a degrade worth counting the way `EvmLaneCounters` counts
 * the others: those record a condition the store had to CORRECT FOR, and
 * reaching a designed bound is not one. The next snapshot restates the lane
 * from the server regardless.
 *
 * Returns `state` unchanged (same reference) when nothing is over the limit,
 * which is the overwhelmingly common case — the reducer's callers rely on
 * reference equality to skip re-renders.
 */
function capChainBuckets(state: EvmLaneState, chain: string): EvmLaneState {
  const buckets = new Map<EvmStage, string[]>();
  for (const [key, card] of Object.entries(state.cards)) {
    if (card.chain !== chain) continue;
    const bucket = buckets.get(card.stage);
    if (bucket === undefined) buckets.set(card.stage, [key]);
    else bucket.push(key);
  }

  const evicted: string[] = [];
  for (const keys of buckets.values()) {
    if (keys.length <= EVM_LANE_STORE_LIMIT) continue;
    keys.sort((left, right) => {
      const delta = (state.lastBlock[right] ?? 0) - (state.lastBlock[left] ?? 0);
      return delta !== 0 ? delta : left.localeCompare(right);
    });
    for (const key of keys.slice(EVM_LANE_STORE_LIMIT)) evicted.push(key);
  }
  if (evicted.length === 0) return state;

  const cards = { ...state.cards };
  const lastBlock = { ...state.lastBlock };
  const marks = { ...state.marks };
  for (const key of evicted) {
    // ALL THREE maps, or the eviction just moves the leak: `marks` and
    // `lastBlock` are keyed by the same card key and would otherwise keep
    // growing for tokens the store no longer holds.
    delete cards[key];
    delete lastBlock[key];
    delete marks[key];
  }
  return { ...state, cards, lastBlock, marks };
}

function markRefresh(state: EvmLaneState, chain: string): EvmLaneState {
  if (state.refreshChains[chain] === true) return state;
  return { ...state, refreshChains: { ...state.refreshChains, [chain]: true } };
}

function withoutChain(
  refreshChains: Readonly<Record<string, true>>,
  chain: string,
): Readonly<Record<string, true>> {
  if (refreshChains[chain] === undefined) return refreshChains;
  const next = { ...refreshChains };
  delete next[chain];
  return next;
}

function mergeMark(
  marks: Readonly<Record<string, EvmLiveMarks>>,
  key: string,
  patch: EvmLiveMarks,
): Readonly<Record<string, EvmLiveMarks>> {
  return { ...marks, [key]: { ...marks[key], ...patch } };
}

function pruneMarks(
  marks: Readonly<Record<string, EvmLiveMarks>>,
  cards: Readonly<Record<string, EvmDiscoverCard>>,
): Readonly<Record<string, EvmLiveMarks>> {
  const next: Record<string, EvmLiveMarks> = {};
  for (const [key, mark] of Object.entries(marks)) {
    if (cards[key] !== undefined) next[key] = mark;
  }
  return next;
}

/**
 * A seq gap means frames were dropped between the tap and here.
 *
 * The exec feed mints seq AT THE TAP, before the send, precisely so a drop
 * leaves a visible hole. Treating a gap as normal throws that signal away and
 * leaves the lane quietly wrong — so it flags the chain and the caller
 * re-snapshots.
 */
function detectGap(state: EvmLaneState, chain: string, seq: number): boolean {
  const previous = state.seqByChain[chain];
  if (previous === undefined) return false;
  return seq > previous + 1;
}

/** Does this chain owe a re-snapshot? */
export function needsRefresh(state: EvmLaneState, chain: string): boolean {
  return state.refreshChains[chain] === true;
}

/** Every chain currently owing a re-snapshot. */
export function chainsNeedingRefresh(state: EvmLaneState): string[] {
  return Object.keys(state.refreshChains);
}

/** One card, view-shaped, with its live observations folded in. */
export interface EvmLaneCard extends EvmCardView {
  firstSeenAtMs: number | null;
  lastTradeAtMs: number | null;
  lastTradeSide: 'buy' | 'sell' | null;
  /** Exact last-trade price ratio (`costWei / amountBaseUnits`). */
  lastPriceNum: string | null;
  lastPriceDen: string | null;
}

/**
 * Membership predicate for one merged lane.
 *
 * Launchpad/mode selection plugs in here once the wire carries an explicit,
 * lifecycle-stable origin. The selector deliberately accepts ONE predicate
 * over the shared card set: filtering each origin into its own sorted bucket
 * and concatenating those buckets would make the selected launchpad order,
 * rather than chronology, decide what appears at the head of the row.
 */
export type EvmLaneCardPredicate = (card: EvmLaneCard) => boolean;

/**
 * The wire's admission stamp in milliseconds, or `null`.
 *
 * SECONDS on the wire (`firstSeenSec`), and the wire omits rather than
 * zeroes — the `> 0` guard is for a corrupted or pre-contract frame, and it
 * degrades to ABSENT, never to the epoch. This is a BLOCK time; no branch
 * here may substitute a wall clock (see `frameToAction`).
 */
function firstSeenMsFromWire(card: EvmDiscoverCard): number | null {
  const sec = card.firstSeenSec;
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0
    ? sec * 1000
    : null;
}

function toLaneCard(card: EvmDiscoverCard, mark: EvmLiveMarks | undefined): EvmLaneCard {
  return {
    ...toCardView(card),
    // Every one of these is `null` when unobserved — an unknown age is not
    // "0 seconds old" and an unobserved trade is not a trade at price 0.
    //
    // The WIRE'S stamp wins over the client's own mark: the fold admitted
    // the token no later than any frame this client watched, so its stamp is
    // at least as early — and it survives a cold load, which the mark is the
    // whole reason this used to render "—" on. The mark remains the fallback
    // for a wire that predates `firstSeenSec` or an admission block whose
    // header carried no timestamp.
    firstSeenAtMs: firstSeenMsFromWire(card) ?? mark?.firstSeenAtMs ?? null,
    lastTradeAtMs: mark?.lastTradeAtMs ?? null,
    lastTradeSide: mark?.lastTradeSide ?? null,
    lastPriceNum: mark?.lastPriceNum ?? null,
    lastPriceDen: mark?.lastPriceDen ?? null,
  };
}

/** One card by chain-qualified key, or `null`. */
export function selectCard(state: EvmLaneState, key: string): EvmLaneCard | null {
  const card = state.cards[key];
  return card === undefined ? null : toLaneCard(card, state.marks[key]);
}

/**
 * Cards in one lane, in that lane's own order.
 *
 * Derived, never stored: a stored lane is a cache that goes stale against the
 * card map on the very next frame.
 *
 * ORDER IS PER LANE, matching what the Solana page does with the equivalent
 * row — a lane sorted by the wrong key is not a cosmetic difference, it is a
 * different answer to "what is new".
 *
 * - **`new` — newest ADMISSION first**, the same question Solana's New Pairs
 *   answers with `createdAt desc`. Last-applied block is a different question
 *   ("what traded most recently"), and answering it here buries a token that
 *   launched thirty seconds ago under an hour-old one that just took a trade.
 *   The admission stamp is the fold's own (`firstSeenSec`, block time), so
 *   this became expressible only once the discover wire started carrying it.
 * - **`graduated` — newest GRADUATION first**, the same question Solana's
 *   Graduated row answers with `graduatedAt desc`. Last-applied block ranks by
 *   how recently a token TRADED, which buries a token that graduated a minute
 *   ago under a week-old one that just took a fill. Expressible since the wire
 *   started carrying `graduatedAtSec`.
 * - **`ripening`, `migrating` — last-applied block first**, as before. Neither
 *   stage has a moment to sort by: "when it started ripening" is not a fact
 *   the fold records, and the honest key for both is recency of activity.
 *
 * BOTH stamped lanes share ONE rule for an unknown stamp: it SINKS below every
 * known one and falls through to block order against another unknown. It is
 * never read as 0. Solana can write `createdAtMs ?? 0` because its feed always
 * carries a stamp; here a producer that predates the field — or a token
 * hydrated already-graduated, which never had a graduation to witness —
 * legitimately serves none, and treating that as 1970 pins the card to the
 * bottom of the lane forever.
 */
export function selectLane(
  state: EvmLaneState,
  chain: string,
  lane: EvmLane,
): EvmLaneCard[] {
  return selectMergedLane(state, chain, lane, () => true);
}

/**
 * Select one lifecycle lane after applying a membership filter, then perform
 * exactly one chronological sort across every surviving card.
 *
 * The order of operations is load-bearing for multi-launchpad Discover: the
 * filter chooses membership; it never creates per-launchpad ordering buckets.
 */
export function selectMergedLane(
  state: EvmLaneState,
  chain: string,
  lane: EvmLane,
  include: EvmLaneCardPredicate,
): EvmLaneCard[] {
  // A LANE, not a stage: `ripening` renders `migrating` cards too, so a token
  // whose curve has completed does not vanish between two columns.
  const stages = stagesForLane(lane);
  const out: EvmLaneCard[] = [];
  for (const [key, card] of Object.entries(state.cards)) {
    if (card.chain !== chain || !stages.includes(card.stage)) continue;
    const laneCard = toLaneCard(card, state.marks[key]);
    if (include(laneCard)) out.push(laneCard);
  }
  const byBlock = (left: EvmLaneCard, right: EvmLaneCard): number => {
    const delta = (state.lastBlock[right.id] ?? 0) - (state.lastBlock[left.id] ?? 0);
    // Stable tie-break so equal blocks do not reshuffle between renders —
    // a list that reorders under the cursor is unusable.
    return delta !== 0 ? delta : left.id.localeCompare(right.id);
  };
  /* ONE comparator for both stamped lanes, parameterised by which stamp. Two
     copies of this rule is how one of them ends up with a `?? 0` — and the
     lane that got it would silently sort its unknowns to the top. */
  const byStamp = (
    stampOf: (card: EvmLaneCard) => number | null,
  ) => (left: EvmLaneCard, right: EvmLaneCard): number => {
    const a = stampOf(left);
    const b = stampOf(right);
    if (a !== null && b !== null) {
      if (a !== b) return b - a;
    } else if (a !== null) {
      return -1;
    } else if (b !== null) {
      return 1;
    }
    return byBlock(left, right);
  };
  if (lane === 'new') return out.sort(byStamp((card) => card.firstSeenAtMs));
  if (lane === 'graduated') return out.sort(byStamp((card) => card.graduatedAtMs));
  return out.sort(byBlock);
}

/** Per-stage counts for the lane headers. */
export function selectStageCounts(
  state: EvmLaneState,
  chain: string,
): Record<EvmStage, number> {
  const counts: Record<EvmStage, number> = {
    new: 0,
    ripening: 0,
    migrating: 0,
    graduated: 0,
  };
  for (const card of Object.values(state.cards)) {
    if (card.chain === chain) counts[card.stage] += 1;
  }
  return counts;
}

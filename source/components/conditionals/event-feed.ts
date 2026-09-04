/**
 * THE DETAIL'S EVENT FEED — one chronological read of everything that has
 * happened to a plan, grouped by the RUN it happened in.
 *
 * This is the journey rail's derivation re-aimed. The rail laid five fixed
 * slots out as a ruler and asked "how far has it got"; the page now asks
 * "what has it done", which is a list and not a ruler. So the same three
 * sources — the lifecycle journal, the firings, and the list's own
 * `created_at` — are read into ROWS instead of nodes, and the two things
 * the rail could not carry come with them: the fills' signed SOL, and the
 * run each row belongs to.
 *
 * WHAT IS GROUPED, AND BY WHAT. `firings.occurrence_seq` is the run
 * number, and it is the only run identity the wire serves. A run's window
 * runs from the claim that opened it to the last instant one of its
 * firings settled, extended backwards over the `fired` journal row that
 * caused it — a firing is claimed a beat AFTER the engine journals the
 * decision to fire, and putting those two rows in different groups would
 * split one run down the middle. Everything before the first run is
 * "Before run 1"; everything after run n is "Since run n".
 *
 * THREE RULES THIS MODULE WILL NOT BEND.
 *  - **Proposed is not in the feed.** Its instant is on no route this port
 *    reads (`/proposals/:id` serves no `created_at`), and a chronological
 *    list cannot hold a row it cannot place. `Approved` leads instead,
 *    dated by `conditionals.created_at` — the conditional row exists
 *    BECAUSE the proposal was approved.
 *  - **`firing_settled` is not a row.** The FIRING is the settlement, and
 *    it is the row that carries the figure; journalling both would say the
 *    same thing twice, once without the number.
 *  - **The figure column holds MOVEMENTS.** `sol_delta_lamports` off the
 *    settlement journal and nothing else. An amount inside a sentence
 *    ("needs 0.004 more") is a condition, not a fill, and stays in the
 *    sentence.
 *
 * THE SIDE WORD COMES OFF THE SIGN, and could not honestly come from
 * anywhere else on these routes: SOL leaving the wallet is a buy, SOL
 * arriving is a sell. A fill the reconciler did not price therefore has no
 * side word, and says which leg filled instead of guessing at one.
 */

import type {
  ConditionalEvent,
  ConditionalExecutionEvent,
  ConditionalFiring,
  ConditionalLeg,
  ConditionalPause,
  ConditionalQualifier,
  ConditionalState,
  FillTimes,
} from '@/lib/conditionals';
import { firingWord, solDeltaOf, type SolDelta } from './detail-model';
import {
  clock,
  dayStamp,
  pauseReason,
  stampSeconds,
  type ClockContext,
} from './ledger-model';
import { humaniseState } from './views';

// ───────────────────────── the shapes ─────────────────────────

/** The 12-unit drawing in a row's marker slot. Never a chip. */
export type FeedMark = 'check' | 'hold' | 'clock' | 'stop' | 'fail' | 'link' | 'dot';

/** What moved in the wallet, for the one right-aligned mono column. */
export interface FeedDelta {
  readonly sign: '+' | '-';
  /** The magnitude in SOL, trimmed. Never signed itself. */
  readonly amount: string;
  /** Which ink a broker would use. `down` is spend, `up` is proceeds. */
  readonly direction: 'up' | 'down';
}

/**
 * One row of the feed. The sentence is split around at most one inline
 * figure so a number inside prose can be drawn in mono (and, on a pause,
 * in amber) without the model handing components any markup.
 */
export interface FeedRow {
  readonly key: string;
  readonly mark: FeedMark;
  /** Amber marker and amber inline figure — the one asking state. */
  readonly hold: boolean;
  readonly lead: string;
  /** The figure inside the sentence. `null` when the sentence has none. */
  readonly figure: string | null;
  /** Whether that figure is an amount of SOL (and takes the ◎). */
  readonly figureSol: boolean;
  readonly trail: string;
  /** The wallet movement. `null` on every row that moved nothing. */
  readonly delta: FeedDelta | null;
  /** `17:05`, local and 24-hour. */
  readonly at: string;
}

/** One run band, or the plan-level band either side of the runs. */
export interface FeedGroup {
  readonly key: string;
  /** `Run 1 · completed` · `Since run 1` · `Before run 1`. Empty when a plan has never run. */
  readonly title: string;
  /** `Aug 11`, or `Aug 10 to Aug 11` when the band crosses a local day. */
  readonly date: string;
  readonly rows: readonly FeedRow[];
}

/** The label-over-value record a transaction row opens into. */
export interface TxRecord {
  readonly orderType: string;
  /** `Leg 1 of 2 · run 1`, split so the figures can be drawn in mono. */
  readonly legNo: number | null;
  readonly legCount: number;
  readonly occurrence: number;
  readonly status: string;
  /** `Aug 11, 16:46:18`. Empty when the wire dated no instant. */
  readonly submitted: string;
  /** The engine's own confirm clock. Empty when `fill_times` served none. */
  readonly filled: string;
  readonly delta: FeedDelta | null;
}

/** One fill, in the tab that is only about fills. */
export interface TxRow {
  readonly key: string;
  readonly legNo: number | null;
  /** `buy` / `sell`, off the sign of what moved. `null` when unpriced. */
  readonly side: 'buy' | 'sell' | null;
  readonly delta: FeedDelta | null;
  readonly at: string;
  readonly record: TxRecord;
  /** The firing's own operation id — the join key for per-row economics. */
  readonly operationId: string;
  /** THIS firing's token (additive) — a pattern plan trades tokens the page header cannot name. */
  readonly token: { readonly mint: string; readonly symbol: string | null } | null;
}

export interface TxGroup {
  readonly key: string;
  readonly title: string;
  readonly date: string;
  readonly rows: readonly TxRow[];
}

export interface FeedInput {
  readonly state: ConditionalState;
  /** `conditionals.created_at` — the approval instant. */
  readonly createdAt: string | null;
  readonly events: readonly ConditionalEvent[];
  readonly firings: readonly ConditionalFiring[];
  readonly legs: readonly ConditionalLeg[];
  readonly qualifier?: ConditionalQualifier | undefined;
  readonly firedCount?: number | undefined;
  readonly pause?: ConditionalPause | null | undefined;
  readonly fillTimes?: FillTimes | undefined;
  readonly executionEvents?: readonly ConditionalExecutionEvent[] | undefined;
  /**
   * The evaluator has not caught up with the latest revision (CONTRACT-3
   * §B.2): one asking row, at the instant of the edit it waits on.
   */
  readonly syncHold?: { readonly lead: string; readonly atMs: number } | undefined;
}

// ───────────────────────── clocks ─────────────────────────

function parse(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function deltaOf(sol: SolDelta): FeedDelta {
  return { sign: sol.sign, amount: sol.amount, direction: sol.sign === '-' ? 'down' : 'up' };
}

// ───────────────────────── the runs ─────────────────────────

/** The journal rows that OPEN a run, and so belong inside it. */
const FIRE_TRANSITIONS: readonly string[] = ['fired', 'firing_claimed'];
/** Said by the firing itself, with the figure the journal row lacks. */
const SETTLED_TRANSITIONS: readonly string[] = ['firing_settled'];

interface Fill {
  readonly firing: ConditionalFiring;
  readonly legNo: number | null;
  /** When it landed: the engine's confirm clock, else the claim. */
  readonly ms: number;
  readonly claimedMs: number | null;
  readonly filledMs: number | null;
  readonly delta: FeedDelta | null;
}

interface Run {
  readonly occurrence: number;
  /** Earliest instant that belongs to this run — the claim, or the `fired`. */
  startMs: number;
  readonly endMs: number;
  readonly fills: readonly Fill[];
  readonly outcome: string;
}

/**
 * What a run came to, in one word. Every arm is a fact off `firings[].state`
 * except the last: a run whose fills all filled but which has not produced
 * one per leg is still RUNNING, because the second leg has not fired yet.
 */
function runOutcome(fills: readonly Fill[], legCount: number): string {
  const states = fills.map((fill) => fill.firing.state);
  if (states.includes('failed')) return 'failed';
  if (states.includes('guardrail_rejected')) return 'refused';
  if (states.includes('expired')) return 'ran out of time';
  if (states.includes('unknown')) return 'unsettled';
  if (states.every((state) => state === 'filled')) {
    return legCount > 0 && fills.length < legCount ? 'running' : 'completed';
  }
  return 'running';
}

function buildRuns(input: FeedInput): readonly Run[] {
  const legNoById = new Map(input.legs.map((leg) => [leg.id, leg.leg_no]));
  const fillByOperation = new Map<string, number>();
  if (input.fillTimes?.available === true) {
    for (const entry of input.fillTimes.entries) {
      fillByOperation.set(entry.operation_id, entry.confirmed_at_ms);
    }
  }
  const deltaByOperation = new Map<string, FeedDelta>();
  for (const event of input.executionEvents ?? []) {
    const sol = solDeltaOf(event.reconciliation_result);
    if (sol !== null) deltaByOperation.set(event.operation_id, deltaOf(sol));
  }

  const byOccurrence = new Map<number, Fill[]>();
  for (const firing of input.firings) {
    const claimedMs = parse(firing.claimed_at);
    const filledMs = fillByOperation.get(firing.operation_id) ?? null;
    const ms = filledMs ?? claimedMs;
    // A firing the wire dated with neither clock cannot be placed in a
    // chronological list, and is left out rather than stacked at zero.
    if (ms === null) continue;
    const bucket = byOccurrence.get(firing.occurrence_seq) ?? [];
    bucket.push({
      firing,
      legNo: legNoById.get(firing.leg_id) ?? null,
      ms,
      claimedMs,
      filledMs,
      // Only a FILL moved the wallet. A refused or failed claim spent
      // nothing, and the reconciler prices neither.
      delta: firing.state === 'filled' ? (deltaByOperation.get(firing.operation_id) ?? null) : null,
    });
    byOccurrence.set(firing.occurrence_seq, bucket);
  }

  const runs: Run[] = [];
  for (const [occurrence, fills] of byOccurrence) {
    const sorted = [...fills].sort((a, b) => (a.legNo ?? 0) - (b.legNo ?? 0));
    const claims = fills.map((fill) => fill.claimedMs ?? fill.ms);
    runs.push({
      occurrence,
      startMs: Math.min(...claims),
      endMs: Math.max(...fills.map((fill) => fill.ms)),
      fills: sorted,
      outcome: runOutcome(sorted, input.legs.length),
    });
  }
  runs.sort((a, b) => a.startMs - b.startMs);

  // A run OPENS at the journal row that decided to fire it, not at the
  // claim a beat later. Walk each run's start back over the latest such
  // row that sits after the previous run and before this one's claim.
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const floor = index === 0 ? Number.NEGATIVE_INFINITY : (runs[index - 1]?.endMs ?? Number.NEGATIVE_INFINITY);
    let earliest = run.startMs;
    for (const event of input.events) {
      if (!FIRE_TRANSITIONS.includes(event.transition)) continue;
      const ms = parse(event.created_at);
      if (ms === null || ms > run.startMs || ms <= floor) continue;
      earliest = Math.min(earliest, ms);
    }
    run.startMs = earliest;
  }
  return runs;
}

/** Which band an instant falls in: a run, the gap after one, or the head. */
function bandFor(ms: number, runs: readonly Run[]): string {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined) continue;
    if (ms > run.endMs) return `since-${run.occurrence}`;
    if (ms >= run.startMs) return `run-${run.occurrence}`;
  }
  return 'before';
}

// ───────────────────────── the sentences ─────────────────────────

interface Sentence {
  readonly lead: string;
  readonly figure?: string | undefined;
  readonly figureSol?: boolean | undefined;
  readonly trail?: string | undefined;
  readonly mark: FeedMark;
  readonly hold?: boolean | undefined;
}

/** How many runs a `first_n` plan had left when its clock ran out. */
function unusedRuns(
  qualifier: ConditionalQualifier | undefined,
  firedCount: number | undefined,
): number | null {
  if (qualifier?.kind !== 'first_n' || typeof qualifier.n !== 'number') return null;
  if (typeof firedCount !== 'number' || !Number.isInteger(firedCount)) return null;
  const left = qualifier.n - firedCount;
  return left > 0 ? left : null;
}

/**
 * A lifecycle transition, in words. Open vocabulary: a transition this
 * build has never heard of prints the SERVER's own word, humanised — a raw
 * `budget_paused` never reaches the DOM (design-29's rule, in a feed).
 */
function planSentence(
  event: ConditionalEvent,
  input: FeedInput,
  context: { readonly firstArm: boolean; readonly latestPause: boolean },
): Sentence {
  switch (event.transition) {
    case 'armed':
      return { lead: context.firstArm ? 'Armed, watching' : 'Armed, watching again', mark: 'check' };
    case 'resumed':
      return { lead: 'Resumed, watching again', mark: 'check' };
    case 'paused':
    case 'budget_paused': {
      // The pause BLOCK describes the pause the plan is in NOW, so it may
      // only dress the latest pause row, and only while the plan is still
      // held. An older pause states that it happened and invents no reason.
      const why = context.latestPause ? pauseReason(input) : null;
      if (why === null) return { lead: 'Paused, it stopped watching', mark: 'hold', hold: true };
      return {
        lead: why.lead,
        ...(why.amount === null ? {} : { figure: why.amount, figureSol: true }),
        trail: why.trail,
        mark: 'hold',
        hold: true,
      };
    }
    case 'cancelled':
      return { lead: 'Cancelled, you stopped it', mark: 'stop' };
    case 'completed':
      return { lead: 'Completed, there is nothing left to run', mark: 'check' };
    case 'expired': {
      const left = unusedRuns(input.qualifier, input.firedCount);
      if (left === null) return { lead: 'Expired, the time ran out', mark: 'clock' };
      return {
        lead: 'Expired, the time ran out with',
        figure: String(left),
        figureSol: false,
        trail: left === 1 ? 'run unused' : 'runs unused',
        mark: 'clock',
      };
    }
    case 'edited':
      return { lead: 'Edited, a new version was approved', mark: 'link' };
    case 'fired':
    case 'firing_claimed':
      return { lead: 'Fired, conditions met', mark: 'check' };
    case 'partial_abandoned':
      return { lead: 'Partly filled, the rest was let go', mark: 'dot' };
    default:
      return { lead: humaniseState(event.transition), mark: 'dot' };
  }
}

/** `buy` when SOL left the wallet, `sell` when it arrived. Nothing else. */
export function sideOf(delta: FeedDelta | null): 'buy' | 'sell' | null {
  if (delta === null) return null;
  return delta.direction === 'down' ? 'buy' : 'sell';
}

function fillSentence(fill: Fill): Sentence {
  const side = sideOf(fill.delta);
  if (fill.firing.state === 'filled') {
    if (side !== null) return { lead: side === 'buy' ? 'Buy filled' : 'Sell filled', mark: 'check' };
    if (fill.legNo === null) return { lead: 'Filled', mark: 'check' };
    return { lead: 'Leg', figure: String(fill.legNo), figureSol: false, trail: 'filled', mark: 'check' };
  }
  const word = firingWord(fill.firing.state).toLowerCase();
  const mark: FeedMark =
    fill.firing.state === 'failed' || fill.firing.state === 'guardrail_rejected'
      ? 'fail'
      : fill.firing.state === 'expired'
        ? 'clock'
        : 'dot';
  if (fill.legNo === null) return { lead: firingWord(fill.firing.state), mark };
  return { lead: 'Leg', figure: String(fill.legNo), figureSol: false, trail: word, mark };
}

function rowOf(
  key: string,
  ms: number,
  sentence: Sentence,
  delta: FeedDelta | null,
  ctx: ClockContext,
): FeedRow {
  return {
    key,
    mark: sentence.mark,
    hold: sentence.hold === true,
    lead: sentence.lead,
    figure: sentence.figure ?? null,
    figureSol: sentence.figureSol === true,
    trail: sentence.trail ?? '',
    delta,
    at: clock(new Date(ms).toISOString(), ctx),
  };
}

// ───────────────────────── the feed ─────────────────────────

interface Placed {
  readonly band: string;
  readonly ms: number;
  /** Ties break with the fill above the journal row that caused it. */
  readonly rank: 0 | 1;
  readonly row: FeedRow;
}

function bandDate(rows: readonly { readonly ms: number }[], ctx: ClockContext): string {
  if (rows.length === 0) return '';
  const newest = dayStamp(new Date(Math.max(...rows.map((r) => r.ms))).toISOString(), ctx);
  const oldest = dayStamp(new Date(Math.min(...rows.map((r) => r.ms))).toISOString(), ctx);
  return newest === oldest ? newest : `${oldest} to ${newest}`;
}

function bandTitle(band: string, runs: readonly Run[]): string {
  if (band === 'before') return runs.length === 0 ? '' : `Before run ${runs[0]?.occurrence ?? 1}`;
  const [kind, occurrence] = band.split('-');
  const run = runs.find((entry) => String(entry.occurrence) === occurrence);
  if (run === undefined) return '';
  return kind === 'since' ? `Since run ${run.occurrence}` : `Run ${run.occurrence} · ${run.outcome}`;
}

/** The bands, newest first: the tail, then each run and its gap, then the head. */
function bandOrder(runs: readonly Run[]): readonly string[] {
  const order: string[] = [];
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined) continue;
    order.push(`since-${run.occurrence}`, `run-${run.occurrence}`);
  }
  order.push('before');
  return order;
}

/**
 * The activity feed: every plan-level event and every firing, newest
 * first, banded by the run it belongs to. An empty band is not drawn.
 */
export function activityFeed(input: FeedInput, ctx: ClockContext): readonly FeedGroup[] {
  const runs = buildRuns(input);
  const placed: Placed[] = [];

  const createdMs = parse(input.createdAt);
  if (createdMs !== null) {
    placed.push({
      band: bandFor(createdMs, runs),
      ms: createdMs,
      rank: 0,
      row: rowOf('approved', createdMs, { lead: 'Approved', mark: 'check' }, null, ctx),
    });
  }

  const ordered = [...input.events].sort((a, b) => a.seq - b.seq);
  const firstArmSeq = ordered.find((event) => event.transition === 'armed')?.seq ?? null;
  const latestPauseSeq =
    [...ordered].reverse().find((event) => event.transition === 'paused' || event.transition === 'budget_paused')
      ?.seq ?? null;
  const held = input.pause !== undefined && input.pause !== null;

  for (const event of ordered) {
    if (SETTLED_TRANSITIONS.includes(event.transition)) continue;
    const ms = parse(event.created_at);
    if (ms === null) continue;
    const sentence = planSentence(event, input, {
      firstArm: firstArmSeq !== null && event.seq === firstArmSeq,
      latestPause: held && latestPauseSeq !== null && event.seq === latestPauseSeq,
    });
    placed.push({
      band: bandFor(ms, runs),
      ms,
      rank: 0,
      row: rowOf(`e${event.seq}`, ms, sentence, null, ctx),
    });
  }

  // The edit the evaluator has not taken yet: an asking row, ranked above
  // the journal row of the revision it waits on when they share an instant.
  if (input.syncHold !== undefined) {
    placed.push({
      band: bandFor(input.syncHold.atMs, runs),
      ms: input.syncHold.atMs,
      rank: 1,
      row: rowOf('sync-hold', input.syncHold.atMs, { lead: input.syncHold.lead, mark: 'hold', hold: true }, null, ctx),
    });
  }

  for (const run of runs) {
    for (const fill of run.fills) {
      placed.push({
        band: `run-${run.occurrence}`,
        ms: fill.ms,
        rank: 1,
        row: rowOf(`f${fill.firing.id}`, fill.ms, fillSentence(fill), fill.delta, ctx),
      });
    }
  }

  const groups: FeedGroup[] = [];
  for (const band of bandOrder(runs)) {
    const rows = placed
      .filter((entry) => entry.band === band)
      .sort((a, b) => (b.ms === a.ms ? b.rank - a.rank : b.ms - a.ms));
    if (rows.length === 0) continue;
    groups.push({
      key: band,
      title: bandTitle(band, runs),
      date: bandDate(rows, ctx),
      rows: rows.map((entry) => entry.row),
    });
  }
  return groups;
}

/**
 * The transactions tab: one row per FILL, newest first, in the same run
 * bands and on the same four columns — so a fill lands on one figure edge
 * whichever tab the reader is in.
 */
export function transactionGroups(input: FeedInput, ctx: ClockContext): readonly TxGroup[] {
  const runs = buildRuns(input);
  const legCount = input.legs.length;
  const groups: TxGroup[] = [];
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const rows = [...run.fills]
      .sort((a, b) => b.ms - a.ms)
      .map((fill) => ({
        key: `t${fill.firing.id}`,
        legNo: fill.legNo,
        side: sideOf(fill.delta),
        delta: fill.delta,
        at: clock(new Date(fill.ms).toISOString(), ctx),
        operationId: fill.firing.operation_id,
        token:
          fill.firing.token != null
            ? { mint: fill.firing.token.mint, symbol: fill.firing.token.symbol }
            : fill.firing.mint != null
              ? { mint: fill.firing.mint, symbol: null }
              : null,
        record: {
          orderType:
            sideOf(fill.delta) === 'buy'
              ? 'Conditional buy'
              : sideOf(fill.delta) === 'sell'
                ? 'Conditional sell'
                : 'Conditional order',
          legNo: fill.legNo,
          legCount,
          occurrence: run.occurrence,
          status: firingWord(fill.firing.state),
          submitted: stampSeconds(fill.firing.claimed_at, ctx),
          filled:
            fill.filledMs === null ? '' : stampSeconds(new Date(fill.filledMs).toISOString(), ctx),
          delta: fill.delta,
        },
      }));
    if (rows.length === 0) continue;
    groups.push({
      key: `run-${run.occurrence}`,
      title: `Run ${run.occurrence} · ${run.outcome}`,
      date: bandDate(
        run.fills.map((fill) => ({ ms: fill.ms })),
        ctx,
      ),
      rows,
    });
  }
  return groups;
}

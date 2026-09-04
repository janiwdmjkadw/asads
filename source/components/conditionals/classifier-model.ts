/**
 * THE JUDGE'S LEDGER — what the semantic classifier has cost and decided,
 * as display rows. Pure: the wire block in, words and figures out.
 *
 * Money is TRUNCATED, never rounded (the `pnl.ts` `formatSol` rule): a
 * judge that has spent $0.1849 reads "$0.18", not "$0.19" — rounding up a
 * spend is inventing money the user has not paid. Absent is not zero: a
 * row with no `classifier` derives to `null`, a candidate with no
 * `cost_micro` shows the em-dash slot, never `$0`.
 */

import type { ClassifierCandidate, ClassifierOutcome, ClassifierSummary } from '@/lib/conditionals';
import { formatUsdcMicro } from '@/lib/format';
import { clock, type ClockContext } from './ledger-model';

const MICRO_PER_CENT = 10_000n;
const MICRO_PER_HUNDREDTH_CENT = 100n;
const HOUR_MS = 3_600_000;

function parseMicro(micro: string | null | undefined): bigint | null {
  if (typeof micro !== 'string' || !/^-?\d+$/.test(micro)) return null;
  try {
    return BigInt(micro);
  } catch {
    return null;
  }
}

/**
 * Micro-USD → "$0.18", truncated to the cent, or to the hundredth of a
 * cent below one cent (the formatter's own 4dp floor). `formatUsdcMicro`
 * rounds, so the truncation happens BEFORE it sees the number.
 */
export function formatMicroUsd(micro: bigint): string {
  const unit = micro < MICRO_PER_CENT && micro > -MICRO_PER_CENT ? MICRO_PER_HUNDREDTH_CENT : MICRO_PER_CENT;
  const truncated = (micro / unit) * unit;
  return formatUsdcMicro(truncated);
}

// ───────────────────────── the row stat ─────────────────────────

export interface JudgeStat {
  /** `"$0.18 · 34 judged · 1 match · 33 rejected"`, or `"judge armed · $0"`. */
  readonly phrase: string;
  /** The spend alone, for the money column. */
  readonly figure: string;
}

/** `null` when the row carries no judge at all — absent is not zero. */
export function judgeStat(summary: ClassifierSummary | null | undefined): JudgeStat | null {
  if (summary === null || summary === undefined) return null;
  const spent = parseMicro(summary.cost_micro) ?? 0n;
  const figure = formatMicroUsd(spent);
  if (summary.evaluations === 0) return { phrase: `judge armed · ${figure}`, figure };
  const parts = [
    figure,
    `${summary.evaluations} judged`,
    `${summary.accepted} ${summary.accepted === 1 ? 'match' : 'matches'}`,
    `${summary.rejected} rejected`,
  ];
  if (summary.unknown > 0) parts.push(`${summary.unknown} unknown`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  return { phrase: parts.join(' · '), figure };
}

// ───────────────────────── the candidates ─────────────────────────

/** Ink for an outcome: colour means STATE, and only a match is a state worth colour. */
export type OutcomeTone = 'up' | 'neutral' | 'hold' | 'pending';

const OUTCOME_WORDS: Readonly<Record<string, { readonly word: string; readonly tone: OutcomeTone }>> = {
  accepted: { word: 'Matched', tone: 'up' },
  rejected: { word: 'Rejected', tone: 'neutral' },
  unknown: { word: 'Unsure', tone: 'hold' },
  pending: { word: 'Judging', tone: 'pending' },
};

export function outcomeWord(outcome: ClassifierOutcome): { readonly word: string; readonly tone: OutcomeTone } {
  return OUTCOME_WORDS[outcome] ?? { word: 'Unsure', tone: 'hold' };
}

export interface CandidateRow {
  readonly key: string;
  readonly time: string;
  readonly outcome: ClassifierOutcome;
  readonly word: string;
  readonly tone: OutcomeTone;
  /** `"72%"` — or `null` while pending / unserved. */
  readonly confidence: string | null;
  /** `"≥ 60%"` — the floor this verdict was measured against. */
  readonly threshold: string;
  /** True for a match that fell BELOW the floor: rejected on confidence, not on content. */
  readonly belowFloor: boolean;
  /** `"412 ms"` or null. */
  readonly latency: string | null;
  /** `"$0.0052"` or null — absent is not free. */
  readonly cost: string | null;
  readonly link: string | null;
  readonly target: string;
  readonly rubric: string;
}

export function pct(bps: number): string {
  return `${Math.trunc(bps / 100)}%`;
}

export function candidateRow(candidate: ClassifierCandidate, ctx: ClockContext): CandidateRow {
  const { word, tone } = outcomeWord(candidate.outcome);
  const cost = parseMicro(candidate.cost_micro);
  return {
    key: `${candidate.predicate_hash}:${candidate.entity_id}:${candidate.entity_version}`,
    time: clock(candidate.created_at, ctx),
    outcome: candidate.outcome,
    word,
    tone,
    confidence: candidate.confidence_bps === null ? null : pct(candidate.confidence_bps),
    threshold: `≥ ${pct(candidate.confidence_min_bps)}`,
    belowFloor:
      candidate.verdict === 'match' &&
      candidate.confidence_bps !== null &&
      candidate.confidence_bps < candidate.confidence_min_bps,
    latency: candidate.latency_ms === null ? null : `${Math.trunc(candidate.latency_ms)} ms`,
    cost: cost === null ? null : formatMicroUsd(cost),
    link: candidate.link,
    target: candidate.target,
    rubric: candidate.rubric_name,
  };
}

/** Newest first, whatever order the wire used. */
export function candidateRows(candidates: readonly ClassifierCandidate[], ctx: ClockContext): readonly CandidateRow[] {
  return [...candidates]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((candidate) => candidateRow(candidate, ctx));
}

// ───────────────────────── is it worth it ─────────────────────────

export interface JudgeRunRate {
  /** `"$0.0052"` per verdict, or null with nothing judged. */
  readonly perVerdict: string | null;
  /** Verdicts per hour over the window since the first candidate, truncated to one decimal. */
  readonly perHour: number | null;
  /** `"$0.62"` per day at the observed rate, or null. */
  readonly perDay: string | null;
  /** `"34 verdicts over 2h 10m"`-style window, or null. */
  readonly window: string | null;
}

function windowText(ms: number): string {
  const minutes = Math.trunc(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Average cost per verdict and the spend a day at the rate the judge has
 * actually been running — so the user can decide whether to keep it on.
 * The rate is measured over the window from the OLDEST served candidate
 * to now, against the summary's full tally (the candidates are capped at
 * 200, the tally is not); with no candidate to anchor the window on, the
 * rate is unknown and only the average is served.
 */
export function judgeRunRate(
  summary: ClassifierSummary,
  candidates: readonly ClassifierCandidate[],
  ctx: ClockContext,
): JudgeRunRate {
  const spent = parseMicro(summary.cost_micro) ?? 0n;
  const judged = summary.evaluations;
  if (judged <= 0) return { perVerdict: null, perHour: null, perDay: null, window: null };
  const perVerdictMicro = spent / BigInt(judged);
  const perVerdict = formatMicroUsd(perVerdictMicro);

  const oldest = candidates.reduce<number | null>((acc, candidate) => {
    const ms = Date.parse(candidate.created_at);
    if (!Number.isFinite(ms)) return acc;
    return acc === null || ms < acc ? ms : acc;
  }, null);
  if (oldest === null) return { perVerdict, perHour: null, perDay: null, window: null };
  // Floor the window at one minute so a judge that is ten seconds old does
  // not project a million dollars a day off its first verdict.
  const windowMs = Math.max(ctx.nowMs - oldest, 60_000);
  const perHourExact = (judged * HOUR_MS) / windowMs;
  const perHour = Math.trunc(perHourExact * 10) / 10;
  const perDayMicro = (spent * 24n * BigInt(HOUR_MS)) / BigInt(Math.trunc(windowMs));
  return {
    perVerdict,
    perHour,
    perDay: formatMicroUsd(perDayMicro),
    window: `${judged} ${judged === 1 ? 'verdict' : 'verdicts'} over ${windowText(windowMs)}`,
  };
}

// ───────────────────────── the header ─────────────────────────

export interface JudgeHeader {
  /** The claims, one per rubric, deduplicated by name. */
  readonly claims: readonly string[];
  readonly model: string | null;
  /** `"≥ 60%"`; when rubrics disagree, the range `"≥ 60 to 75%"`. */
  readonly threshold: string | null;
}

export function judgeHeader(summary: ClassifierSummary): JudgeHeader {
  const claims = [...new Set(summary.rubrics.map((rubric) => rubric.name))];
  const floors = [...new Set(summary.rubrics.map((rubric) => rubric.confidence_min_bps))].sort((a, b) => a - b);
  const lo = floors[0];
  const hi = floors[floors.length - 1];
  const threshold =
    lo === undefined || hi === undefined
      ? null
      : lo === hi
        ? `≥ ${pct(lo)}`
        : `≥ ${Math.trunc(lo / 100)} to ${pct(hi)}`;
  return { claims, model: summary.model_version, threshold };
}

export const JUDGE_EMPTY = 'No candidates yet, the judge is armed.';

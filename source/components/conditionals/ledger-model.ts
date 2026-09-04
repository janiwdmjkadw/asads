/**
 * The ledger's clocks, its day bands, and what a finished row has to say
 * for itself.
 *
 * LOCAL TIME, 24-HOUR, ZONE STATED ONCE. Every instant on the page is the
 * viewer's own (design-28 §4); the zone tag rides the line beside the
 * toggle rather than every row, because a ledger repeats its clock forty
 * times and a repeated tag is noise. `timeZone` and `nowMs` are injected
 * so the tests are not a function of the box's locale.
 *
 * THE OUTCOME PHRASES ARE BOUNDED BY THE WIRE. The lab writes "Leg 1
 * fired 21:04 · reverted on-chain · nothing acquired"; the list route
 * serves neither fill times nor a failure reason, and design-29 is
 * explicit that Failed is the one view where the page must never guess.
 * So a failed row says WHAT HAPPENED and stops — no reason clause, no
 * cost clause — and the third clause arrives when the wire does. What is
 * written here is derived from `fired_count`, `created_at`, `expires_at`
 * and the state, and from nothing else.
 */

import type { ConditionalPause, ConditionalState, ConditionalSummary } from '@/lib/conditionals';
import { displayState, hasEnded } from './views';

// ───────────────────────── clocks ─────────────────────────

export interface ClockContext {
  /** IANA zone. The viewer's own. */
  readonly timeZone: string;
  readonly nowMs: number;
}

function parse(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** `17:02` — the row's own clock, 24-hour, in the viewer's zone. */
export function clock(iso: string | null | undefined, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ctx.timeZone,
  }).format(ms);
}

/** The local calendar day an instant falls on, as a sortable `2026-08-11`. */
export function dayKey(iso: string | null | undefined, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: ctx.timeZone,
  }).format(ms);
}

function bandDate(ms: number, ctx: ClockContext): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: ctx.timeZone,
  })
    .format(ms)
    .replace(',', '');
}

/**
 * `Aug 11, 20:41` — a day AND a clock, for the two places on the detail
 * where an instant has to survive leaving the page's "today": the lineage
 * strip (versions are days apart) and the expiry the identity strip states.
 * The ledger's rows never use it — they are banded by day already.
 */
export function stamp(iso: string | null | undefined, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  // `en-US` for the month-first order the lab draws ("Aug 11"); the clock
  // beside it stays `en-GB` 24-hour, which is the page's own rule.
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: ctx.timeZone,
  }).format(ms);
  return `${day}, ${clock(iso, ctx)}`;
}

/**
 * `Aug 11, 16:46:18` — the same stamp, to the SECOND.
 *
 * The detail's transaction record is the one place on the surface where a
 * second matters: submitted-to-filled is the whole of what a broker's order
 * detail has to say about speed, and a minute-resolution clock reports a
 * 12-second fill and a 58-second one as the same instant.
 */
export function stampSeconds(iso: string | null | undefined, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: ctx.timeZone,
  }).format(ms);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: ctx.timeZone,
  }).format(ms);
  return `${day}, ${time}`;
}

/** `Aug 11` — the day a feed group falls on, with no clock beside it. */
export function dayStamp(iso: string | null | undefined, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: ctx.timeZone,
  }).format(ms);
}

/**
 * `ET` · `GMT+2` — the viewer's zone, in the short form the platform uses.
 *
 * Stated ONCE per page (beside the tabs), never per row: design-28 §4's
 * rule, and the reason every other clock on this surface is bare.
 */
export function zoneLabel(ctx: ClockContext): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: ctx.timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(ctx.nowMs)
    .find((entry) => entry.type === 'timeZoneName');
  return part?.value ?? '';
}

/** `Today · Mon 11 Aug` · `Yesterday · Sun 10 Aug` · `Wed 6 Aug`. */
export function dayBandLabel(iso: string, ctx: ClockContext): string {
  const ms = parse(iso);
  if (ms === null) return '';
  const key = dayKey(iso, ctx);
  const today = dayKey(new Date(ctx.nowMs).toISOString(), ctx);
  const yesterday = dayKey(new Date(ctx.nowMs - 86_400_000).toISOString(), ctx);
  const date = bandDate(ms, ctx);
  if (key === today) return `Today · ${date}`;
  if (key === yesterday) return `Yesterday · ${date}`;
  return date;
}

export interface LedgerDay {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ConditionalSummary[];
}

/**
 * The ledger, banded by the local day a play was created. Input order is
 * preserved inside every band — the list arrives newest-first and a play
 * keeps the slot it sat in while it was live (design-29: creation-ordered,
 * so a paused row does not jump).
 */
export function ledgerDays(
  rows: readonly ConditionalSummary[],
  ctx: ClockContext,
): readonly LedgerDay[] {
  const days: LedgerDay[] = [];
  const byKey = new Map<string, ConditionalSummary[]>();
  for (const row of rows) {
    const key = dayKey(row.created_at, ctx);
    const bucket = byKey.get(key);
    if (bucket === undefined) {
      const fresh: ConditionalSummary[] = [row];
      byKey.set(key, fresh);
      days.push({ key, label: dayBandLabel(row.created_at, ctx), rows: fresh });
    } else {
      bucket.push(row);
    }
  }
  return days;
}

// ───────────────────────── the right edge ─────────────────────────

/** `41m` · `1h 12m` · `3d`. Coarse on purpose: a ledger is not a countdown. */
export function compactSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes - hours * 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * How long an ACTIVE play has left: `in 41m`. Empty when the lifetime is
 * unresolved (pre-arm, `expires_at: null`) — an empty slot is honest and
 * an invented one is not. A play past its own expiry that the sweep has
 * not caught yet reads `ending`, never a negative countdown.
 */
export function expiryText(row: ConditionalSummary, ctx: ClockContext): string {
  const ms = parse(row.expires_at);
  if (ms === null) return '';
  const delta = ms - ctx.nowMs;
  return delta <= 0 ? 'ending' : `in ${compactSpan(delta)}`;
}

// ───────────────────────── the record's own sentence ─────────────────────────

function runs(count: number | undefined): string | null {
  if (count === undefined || !Number.isInteger(count) || count <= 0) return null;
  return count === 1 ? 'Fired once' : `Fired ${count} times`;
}

/**
 * The outcome phrase — the clause a record row puts where a live row puts
 * its flow and clock, so the same column always answers "what has this
 * play to say for itself". Past tense, no accent, no figures.
 */
export function outcomePhrase(row: ConditionalSummary, ctx: ClockContext): string {
  const state = displayState(row);
  const fired = runs(row.fired_count);
  const created = parse(row.created_at);
  const expires = parse(row.expires_at);

  switch (state as ConditionalState) {
    case 'completed':
      return fired === null ? 'Ran to the end' : `${fired} · every run settled`;
    case 'cancelled':
    case 'cancel_requested':
      return fired === null ? 'You stopped it' : `${fired} · then you stopped it`;
    case 'declined':
      return 'Never armed · you turned it down';
    case 'expired':
    case 'expiry_pending': {
      const ran =
        created === null || expires === null || expires <= created
          ? null
          : `ran ${compactSpan(expires - created)}`;
      const ended = expires === null ? null : `ended ${clock(row.expires_at, ctx)}`;
      return [fired ?? 'Nothing fired', ran, ended].filter((part) => part !== null).join(' · ');
    }
    case 'failed':
      // WHAT HAPPENED, and nothing more. The reason and the cost are the
      // lab's second and third clauses and the wire serves neither.
      return fired === null ? 'It never fired · it ended in an error' : `${fired} · then it failed`;
    default:
      return fired ?? '';
  }
}

// ───────────────────────── the money line ─────────────────────────

/**
 * "+0.12 SOL (+5%) · 2 open" — the detail strip's net, on the list, so a
 * multi-position plan reads as money before it is opened. Null when the
 * wire served no economics (older api, or nothing has filled yet).
 */
export function economicsPhrase(row: ConditionalSummary): string | null {
  const e = row.economics;
  if (e === undefined || e === null) return null;
  let net: bigint;
  try {
    net = BigInt(e.net_lamports);
  } catch {
    return null;
  }
  const sign = net > 0n ? '+' : net < 0n ? '−' : '';
  const abs = net < 0n ? -net : net;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  const sol = `${sign}${whole}${frac === '' ? '' : `.${frac}`} SOL`;
  const pct = e.net_bps === null ? '' : ` (${e.net_bps > 0 ? '+' : e.net_bps < 0 ? '−' : ''}${(Math.abs(e.net_bps) / 100).toFixed(1).replace(/\.0$/, '')}%)`;
  const open = e.open_runs > 0 ? ` · ${e.open_runs} open` : '';
  return `${sol}${pct}${open}`;
}

// ───────────────────────── the life of a play ─────────────────────────

/**
 * How far through its own lifetime a play is, 0 to 1 — the number the
 * ledger's track is drawn from.
 *
 * NULL WHEN THE LIFETIME IS UNRESOLVED. A plan with no `expires_at` has
 * no proportion to be part of the way through, and a track drawn at a
 * guessed length would be the monitor inventing a deadline. Rows like
 * that draw a plain rule instead. An ended play is complete by
 * definition, whatever its clock said.
 */
export function lifeFraction(row: ConditionalSummary, ctx: ClockContext): number | null {
  if (hasEnded(displayState(row))) return 1;
  const created = parse(row.created_at);
  const expires = parse(row.expires_at);
  if (created === null || expires === null || expires <= created) return null;
  const through = (ctx.nowMs - created) / (expires - created);
  return Math.max(0, Math.min(1, through));
}

/**
 * The money line in parts, so the row can colour it and set the official
 * mark beside the figure rather than spelling "SOL". Same source as
 * `economicsPhrase`, which stays for the aria string and the tests.
 */
export interface EconomicsParts {
  /** Signed, without a unit: `+0.12`. */
  readonly net: string;
  /** Signed percent, or null when the wire served no basis points. */
  readonly pct: string | null;
  readonly open: number;
  readonly negative: boolean;
}

export function economicsParts(row: ConditionalSummary): EconomicsParts | null {
  const e = row.economics;
  if (e === undefined || e === null) return null;
  let net: bigint;
  try {
    net = BigInt(e.net_lamports);
  } catch {
    return null;
  }
  const sign = net > 0n ? '+' : net < 0n ? '−' : '';
  const abs = net < 0n ? -net : net;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return {
    net: `${sign}${whole}${frac === '' ? '' : `.${frac}`}`,
    pct:
      e.net_bps === null
        ? null
        : `${e.net_bps > 0 ? '+' : e.net_bps < 0 ? '−' : ''}${(Math.abs(e.net_bps) / 100).toFixed(1).replace(/\.0$/, '')}%`,
    open: e.open_runs,
    negative: net < 0n,
  };
}

// ───────────────────────── the paused row's why ─────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Lamport string → `0.02`, trimmed. Strings end to end: they are BigInt-derived. */
export function solText(lamports: string | null | undefined): string | null {
  if (typeof lamports !== 'string' || !/^\d+$/.test(lamports)) return null;
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  if (!Number.isFinite(sol) || sol <= 0) return null;
  return sol
    .toFixed(sol < 0.001 ? 6 : 3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

export interface PauseReason {
  /** "Paused, needs" / the whole sentence when there is no figure. */
  readonly lead: string;
  /** The SOL figure, when the wire served a shortfall. */
  readonly amount: string | null;
  readonly trail: string;
}

/** `3 attempts` · `1 attempt`, or null. A count the wire did not serve is not zero. */
function attemptsText(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null;
  return count === 1 ? '1 attempt' : `${count} attempts`;
}

/**
 * The engine's own last failure reason, VERBATIM — `never_broadcast`,
 * `not_found_past_blockhash_validity`. This surface renders an
 * unrecognised server word as the server wrote it rather than coercing it
 * into a phrase that might be wrong (the `outcomePhrase` default and
 * `views.humaniseState` are the same doctrine). Blank or non-string is
 * absent, not "".
 */
function lastReasonText(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') return null;
  const text = reason.trim();
  return text === '' ? null : text;
}

/**
 * The 0189 exit-failure lead: `Failed after 3 attempts · never_broadcast`.
 *
 * Every clause is independent, because `pause_detail` degrades field by
 * field and an api that projects neither still has to say something true.
 * With no figure and no reason it states the SHAPE of what happened and
 * stops — the plan gave up — which is the one thing the reason column is
 * always entitled to say.
 */
function exitFailedLead(pause: ConditionalPause): string {
  const parts = [attemptsText(pause.attempts), lastReasonText(pause.last_reason)].filter(
    (part) => part !== null,
  );
  return parts.length === 0
    ? 'Failed after repeated attempts'
    : `Failed after ${parts.join(' · ')}`;
}

/**
 * Why this row is paused, in words. A funds pause with a shortfall says
 * the number; a funds pause without one says the shortfall is unknown
 * rather than inventing a figure; a pause the server did not explain (a
 * user pause, a withdrawal pause) says only that you paused it.
 *
 * `exit_failed` is the one pause that must NOT offer resuming as the way
 * out — the server refuses it (409 `exit_failed_terminal`), so the row
 * says the plan failed instead of promising a button that will not work.
 */
export function pauseReason(row: {
  readonly pause?: ConditionalPause | null | undefined;
}): PauseReason | null {
  const pause = row.pause;
  if (pause === undefined || pause === null) return null;
  if (pause.reason === 'exit_failed') {
    return { lead: exitFailedLead(pause), amount: null, trail: '' };
  }
  if (pause.reason !== 'insufficient_funds') {
    return { lead: 'Paused, and it will not fire until you resume it', amount: null, trail: '' };
  }
  const amount = solText(pause.shortfall_lamports);
  if (amount === null) {
    return { lead: 'Paused, the agent wallet is short of what this needs', amount: null, trail: '' };
  }
  return { lead: 'Paused, needs', amount, trail: 'more in the agent wallet' };
}

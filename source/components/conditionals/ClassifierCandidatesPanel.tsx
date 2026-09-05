'use client';

/**
 * THE JUDGE'S LEDGER, drawn — what the semantic classifier has looked at,
 * what it decided, and what that has cost. One body, used twice: inline
 * as the detail's Judge tab, and inside `ClassifierCandidatesModal` from
 * the ledger row. The modal owns the frame; the tab owns nothing, because
 * the detail's body has exactly one hairline and it is the tab bar's.
 *
 * REJECTIONS ARE ROWS, NOT A COUNT. The user asked to keep track of the
 * candidates AND the rejections, so every candidate the judge saw is a
 * line with its verdict word, its confidence against the floor it was
 * measured by, and the tweet it was. A match that fell below the floor
 * says so — "rejected on confidence" is a different fact from "rejected
 * on content", and the number the user tunes is the floor.
 *
 * Colour means STATE: a match is `--up`, a rejection is ink, an unsure is
 * `--hold`, and a verdict in flight pulses in ink. Money is the detail's
 * own right-aligned 15.5px mono column, and an unserved figure is an em
 * dash — never `$0`.
 */

import type { ReactElement } from 'react';
import type { ClassifierBlock, ClassifierSummary } from '@/lib/conditionals';
import {
  JUDGE_EMPTY,
  candidateRows,
  judgeHeader,
  judgeRunRate,
  judgeStat,
  type CandidateRow,
  type OutcomeTone,
} from './classifier-model';
import type { ClockContext } from './ledger-model';

const FIGURE =
  'justify-self-end whitespace-nowrap font-[family-name:var(--mono)] text-[15.5px] font-medium tabular-nums tracking-[-.014em] text-[var(--ink-0)]';
const DT = 'font-[family-name:var(--mono)] text-[9.5px] uppercase leading-[1.2] tracking-[.1em] text-[var(--ink-2)]';
const DD = 'mt-[5px] whitespace-nowrap font-[family-name:var(--mono)] text-[14px] font-medium tabular-nums tracking-[-.01em] text-[var(--ink-0)]';
const META = 'whitespace-nowrap text-[12px] leading-[1.4] text-[var(--ink-2)]';
const MONO_META = 'whitespace-nowrap font-[family-name:var(--mono)] text-[12px] tabular-nums leading-[1.4] text-[var(--ink-2)]';

const TONE_INK: Readonly<Record<OutcomeTone, string>> = {
  up: 'text-[var(--up,#0f6d5f)]',
  neutral: 'text-[var(--ink-3)]',
  hold: 'text-[var(--hold)]',
  pending: 'text-[var(--ink-3)] animate-pulse',
};

function Blank(): ReactElement {
  return (
    <span className="font-[family-name:var(--mono)] text-[13px] text-[var(--ink-2)]" data-testid="cd-judge-blank">
      —
    </span>
  );
}

function Stat({ label, value, testId }: { readonly label: string; readonly value: string | null; readonly testId: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <span className={DT}>{label}</span>
      <span className={DD}>{value === null ? <Blank /> : value}</span>
    </div>
  );
}

function CandidateLine({ row }: { readonly row: CandidateRow }): ReactElement {
  return (
    <li
      className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-baseline gap-x-[12px] gap-y-[3px] py-[9px] @[520.02px]:grid-cols-[38px_88px_minmax(0,1fr)_auto]"
      data-testid="cd-judge-row"
      data-outcome={row.outcome}
    >
      <span className={MONO_META}>{row.time === '' ? '—' : row.time}</span>
      <span className={`whitespace-nowrap text-[13px] font-semibold tracking-[-.004em] ${TONE_INK[row.tone]}`} data-testid="cd-judge-outcome">
        {row.word}
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-[10px] gap-y-[2px] @[520.02px]:col-span-1">
        <span className={MONO_META} data-testid="cd-judge-confidence">
          {row.confidence === null ? '—' : row.confidence} <span className="text-[var(--ink-3)]">{row.threshold}</span>
          {row.belowFloor ? <span className="ml-[6px] font-[family-name:var(--sans)] text-[var(--hold)]">below floor</span> : null}
        </span>
        {row.latency === null ? null : <span className={MONO_META}>{row.latency}</span>}
        <span className={META}>{row.target}</span>
        {row.link === null ? null : (
          <a
            href={row.link}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap text-[12px] text-[var(--ink-1)] underline decoration-[var(--hairline-2)] underline-offset-[3px] transition-colors hover:text-[var(--ink-0)]"
            data-testid="cd-judge-link"
            onClick={(event) => event.stopPropagation()}
          >
            open ↗
          </a>
        )}
      </span>
      <span className={`${FIGURE} col-start-3 row-start-1 @[520.02px]:col-start-4`} data-testid="cd-judge-cost">
        {row.cost === null ? <Blank /> : row.cost}
      </span>
    </li>
  );
}

export interface ClassifierCandidatesPanelProps {
  /** The `/state` block. `undefined` while it loads; `null` when the route degraded. */
  readonly block: ClassifierBlock | null | undefined;
  /** The ledger row's tally, shown at once while the candidates load. */
  readonly summary?: ClassifierSummary | null | undefined;
  readonly ctx: ClockContext;
}

export function ClassifierCandidatesPanel({ block, summary, ctx }: ClassifierCandidatesPanelProps): ReactElement {
  const live = block !== null && block !== undefined && block.available ? block : null;
  const tally = live?.summary ?? summary ?? null;
  const candidates = live?.candidates ?? null;

  if (tally === null) {
    const reason = block !== null && block !== undefined && !block.available ? block.reason : null;
    return (
      <p className="py-[28px] text-center text-[13px] leading-[1.5] text-[var(--ink-2)]" data-testid="cd-judge-unavailable">
        {reason === 'event_plane_unreachable'
          ? 'The judge’s record is unreachable right now.'
          : block === undefined
            ? 'Loading the judge’s record…'
            : 'This plan has no semantic judge.'}
      </p>
    );
  }

  const header = judgeHeader(tally);
  const rate = judgeRunRate(tally, candidates ?? [], ctx);
  const stat = judgeStat(tally);
  const rows = candidates === null ? null : candidateRows(candidates, ctx);

  return (
    <div className="@container flex min-w-0 flex-col" data-testid="cd-judge">
      <div className="flex min-w-0 flex-col gap-[4px]" data-testid="cd-judge-head">
        {header.claims.map((claim) => (
          <p key={claim} className="m-0 text-[14.5px] font-medium leading-[1.4] tracking-[-.004em] text-[var(--ink-0)]" data-testid="cd-judge-claim">
            “{claim}”
          </p>
        ))}
        <p className="m-0 flex flex-wrap items-baseline gap-x-[9px] text-[12px] leading-[1.4] text-[var(--ink-2)]">
          {header.model === null ? null : (
            <span className="font-[family-name:var(--mono)]" data-testid="cd-judge-model">
              {header.model}
            </span>
          )}
          {header.threshold === null ? null : (
            <span data-testid="cd-judge-threshold">
              accepts at <b className="font-[family-name:var(--mono)] font-medium text-[var(--ink-1)]">{header.threshold}</b>
            </span>
          )}
        </p>
      </div>

      <dl
        className="mt-[18px] grid grid-cols-3 gap-x-[14px] gap-y-[14px] @[520.02px]:grid-cols-4"
        data-testid="cd-judge-summary"
      >
        <Stat label="Judged" value={String(tally.evaluations)} testId="cd-judge-judged" />
        <Stat label="Matched" value={String(tally.accepted)} testId="cd-judge-accepted" />
        <Stat label="Rejected" value={String(tally.rejected)} testId="cd-judge-rejected" />
        <Stat label="Unsure" value={String(tally.unknown)} testId="cd-judge-unknown" />
        <Stat label="Judging" value={String(tally.pending)} testId="cd-judge-pending" />
        <Stat label="Spent" value={stat?.figure ?? null} testId="cd-judge-spent" />
        <Stat label="Per verdict" value={rate.perVerdict} testId="cd-judge-per-verdict" />
        <Stat label="Per day at this rate" value={rate.perDay} testId="cd-judge-per-day" />
      </dl>
      {rate.window === null ? null : (
        <p className="mt-[10px] text-[12px] leading-[1.5] text-[var(--ink-2)]" data-testid="cd-judge-rate">
          {rate.window} · about <b className="font-[family-name:var(--mono)] font-medium tabular-nums text-[var(--ink-1)]">{rate.perHour}</b> an hour. Is the judge earning its keep?
        </p>
      )}

      {rows === null ? (
        <p className="mt-[22px] text-[12.5px] text-[var(--ink-2)]" data-testid="cd-judge-loading">
          Loading candidates…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-[22px] py-[16px] text-center text-[13px] leading-[1.5] text-[var(--ink-2)]" data-testid="cd-judge-empty">
          {JUDGE_EMPTY}
        </p>
      ) : (
        <ul className="mt-[16px] flex list-none flex-col p-0" data-testid="cd-judge-list">
          {rows.map((row) => (
            <CandidateLine key={row.key} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

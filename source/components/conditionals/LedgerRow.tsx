'use client';

/**
 * ONE PLAY, AND HOW MUCH ROAD IT HAS LEFT.
 *
 * TWO COLUMNS. The play as a sentence on the left at reading size, and
 * its READINGS standing in a labelled column of their own on the right:
 * what it is holding on, how many times it fired, what it made, how long
 * it runs, and how far through its life it is. The two can each be read
 * on their own — the left edge is nothing but rules, the right edge is
 * nothing but figures — and a column of labels beats a run of phrases
 * separated by dots, because the label says what the figure IS.
 *
 * THE TRACK LIVES IN THAT COLUMN, under its own value, and that is not
 * cosmetic. It used to run the full width directly under the sentence,
 * at the same left edge and the same width as a line of type, which is
 * exactly how an underline is drawn: it read as one. In the readings
 * column it is a figure among figures and it cannot touch a word.
 *
 * WHY A TRACK. Everything else on this page is a phrase you have to do
 * arithmetic on: "in 4d", "ran 11d", "Fired 4 times". A column of tracks
 * answers "which of these is nearly out of road" at a glance, which is
 * the question a monitor exists to answer and the one the old row made
 * you read for.
 *
 * WHAT THE TRACK DOES NOT SAY. The list serves `fired_count` and no per
 * run timestamps, so the fires are NOT marked on the track — a tick at a
 * made up position would be the monitor inventing history. The count
 * stays in words on the line below, where it is true.
 *
 * A ROW IS NOT A BOX. No fill, no border, no rounded corners: the rows
 * are separated by one hairline and by air, and the only colour anywhere
 * on the row is a gain or a loss.
 *
 * EVERY LENGTH IS px. The app's root is 14px and `--ui-scale` zooms it,
 * so Tailwind's rem scale means something different here than it says.
 */

import Link from 'next/link';
import { useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { Solana } from '@/components/listen/icons/Icons';
import type { ScopePlate, Segment } from '@/components/agent/proposal/v2/row-model';
import { isCancellable, type ConditionalMutationResult, type ConditionalSummary, type TradeControlResult } from '@/lib/conditionals';
import { CancelConfirm } from './CancelConfirm';
import { ClassifierCandidatesModal } from './ClassifierCandidatesModal';
import { judgeStat } from './classifier-model';
import { CANCEL_CONFIRM, mutationFeedback, type MutationFeedback } from './controls';
import {
  economicsParts,
  economicsPhrase,
  expiryText,
  lifeFraction,
  outcomePhrase,
  pauseReason,
  clock,
  type ClockContext,
} from './ledger-model';
import { gluesToPrevious, playLine, playLineText } from './play-line';
import { displayState, hasEnded, stateWord } from './views';

// ───────────────────────── the sentence ─────────────────────────

/**
 * The figures in the sentence are the sentence's spine: same family, one
 * step brighter, tabular so a column of them lines up. No monospace and
 * no separate operator type — the old row set both, and a play read as
 * three fonts arguing.
 */
const VALUE = 'font-medium tabular-nums text-[var(--ink-0)]';
const OPERATOR = 'text-[var(--ink-2)]';

function SegmentSpan({ segment }: { readonly segment: Segment }): ReactElement {
  if (segment.role === 'operator') return <span className={OPERATOR}>{segment.text}</span>;
  if (segment.role === 'value') return <span className={VALUE}>{segment.text}</span>;
  if (segment.role === 'unit') {
    if (segment.text === '◎') return <Solana className="mx-[2px] inline-block h-[.62em] w-[.62em] align-baseline" />;
    return <span className="text-[var(--ink-2)]">{segment.text}</span>;
  }
  return <>{segment.text}</>;
}

function Sentence({ segments }: { readonly segments: readonly Segment[] }): ReactElement {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className="contents">
          {gluesToPrevious(index === 0 ? null : (segments[index - 1] ?? null), segment) ? null : ' '}
          <SegmentSpan segment={segment} />
        </span>
      ))}
    </>
  );
}

/*
 * Identity at symbol length. THE SYMBOL, AND NOT THE ART.
 *
 * It wore the coin's disc, which for any mint the art has not resolved
 * for falls back to a generated colour: a purple blob sitting in front
 * of every ticker, carrying no information and being the only saturated
 * thing on a page whose colour is supposed to mean money. The symbol is
 * already the identity, and it is already the boldest word on the line.
 */
function ScopePlateChip({ plate }: { readonly plate: ScopePlate }): ReactElement {
  return (
    <span
      className="mr-[7px] inline-flex items-baseline whitespace-nowrap align-baseline text-[.86em] font-semibold text-[var(--ink-0)]"
      data-testid="cdl-plate"
      {...(plate.mint === undefined ? {} : { title: plate.mint })}
    >
      {plate.label}
    </span>
  );
}

// ───────────────────────── the money ─────────────────────────

/** The net, with the official mark and the only colour on the row. */
function NetFigure({ row }: { readonly row: ConditionalSummary }): ReactElement | null {
  const parts = economicsParts(row);
  if (parts === null) return null;
  return (
    <span
      className={`inline-flex flex-none items-baseline whitespace-nowrap text-[14px] font-semibold tabular-nums tracking-[-.014em] ${
        parts.negative ? 'text-[var(--down)]' : 'text-[var(--up)]'
      }`}
      data-testid="cdl-economics"
      title={economicsPhrase(row) ?? undefined}
    >
      {parts.net}
      <Solana className="mx-[3px] h-[9px] w-[9px] flex-none self-center" />
      {parts.pct === null ? null : <em className="not-italic font-medium opacity-70">{parts.pct}</em>}
    </span>
  );
}

// ───────────────────────── the readings ─────────────────────────

/*
 * ONE READING: its label, and its figure right against the column's
 * right edge. The label is 11px and grey because it is furniture; the
 * figure is the thing, and it is tabular so the column of them lines up
 * down the page whatever the row above it said.
 */
function Reading({
  label,
  title,
  wrap = false,
  children,
}: {
  readonly label: string;
  /** The whole value, for the readings the column has to clip. */
  readonly title?: string | undefined;
  /**
   * Let this one run onto a second line instead of being clipped. The
   * figures are all short enough to sit on one; the reason a play is
   * held is a SENTENCE, and clipping it loses the number that says how
   * much the wallet is short by, which is the only actionable thing on
   * a held row.
   */
  readonly wrap?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className={wrap ? 'cdl-read cdl-read--wrap' : 'cdl-read'} data-testid="cdl-read">
      <span className="cdl-read-k">{label}</span>
      <span className="cdl-read-v" {...(title === undefined ? {} : { title })}>
        {children}
      </span>
    </span>
  );
}

// ───────────────────────── the row ─────────────────────────

const ROW_CANCEL_BTN =
  'rounded-[7px] border border-[var(--hairline)] bg-transparent px-[9px] py-[3px] text-[11.5px] leading-[1.3] ' +
  'text-[var(--ink-2)] transition-colors duration-[.14s] ease-[var(--ease)] hover:border-[var(--hairline-2)] hover:text-[var(--ink-0)]';

const JUDGE_BTN =
  'inline-flex min-w-0 max-w-full items-baseline gap-[6px] whitespace-nowrap rounded-[6px] border-0 bg-transparent ' +
  'p-0 text-[12.5px] leading-[1.4] text-[var(--ink-3)] transition-colors duration-[.14s] ease-[var(--ease)] ' +
  'hover:text-[var(--ink-0)] cursor-pointer';

function swallow(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export type CancelRow = (conditionalId: string) => Promise<TradeControlResult<ConditionalMutationResult>>;

export interface LedgerRowProps {
  readonly row: ConditionalSummary;
  readonly ctx: ClockContext;
  /** Record views say how the play ended where a live row says how long it has. */
  readonly record: boolean;
  /**
   * Runs the cancel and rereads the list. NO HANDLER, NO BUTTON — the
   * surface's rule for an action nothing is wired to run.
   */
  readonly onCancel?: CancelRow | undefined;
}

export function LedgerRow({ row, ctx, record, onCancel }: LedgerRowProps): ReactElement {
  const state = displayState(row);
  const ended = hasEnded(state);
  const line = playLine(row);
  const hoverText = [
    row.source_text ?? row.summary ?? '',
    [playLineText(line.when), playLineText(line.then)].filter((t) => t !== '').join(' → '),
  ]
    .filter((t) => t !== '')
    .join('\n');
  const why = pauseReason(row);
  // The play's own text usually ends in a full stop already, and adding
  // a second gave every row two.
  const spoken = [playLineText(line.when), playLineText(line.then)].filter((t) => t !== '').join(' ');
  const needsStop = spoken !== '' && !/[.!?]$/.test(spoken.trim());
  const life = lifeFraction(row, ctx);
  /*
   * Both readings resolved here rather than in the column, so the column
   * stays a list of labels and the question of whether a row HAS a figure
   * is answered once. `fired_count` is optional on the list payload, and
   * an absent count is nought fires, not an unknown number of them.
   */
  const fired = row.fired_count ?? 0;
  const net = economicsParts(row) === null ? null : <NetFigure row={row} />;

  const [judgeOpen, setJudgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const judge = judgeStat(row.classifier);
  // Affordance follows the STORED state, never the display one — and a
  // landed cancel takes the button away before the poll confirms it.
  const cancellable =
    onCancel !== undefined && !record && isCancellable(row.state) && !(feedback?.kind === 'done');

  const cancel = async () => {
    if (onCancel === undefined || busy) return;
    setBusy(true);
    setFeedback(mutationFeedback('cancel', await onCancel(row.conditional_id)));
    setBusy(false);
  };

  // Where a row says how it is doing: a live play counts down, an ended
  // one says how it ended.
  const tail = record || ended ? outcomePhrase(row, ctx) : expiryText(row, ctx);

  return (
    <>
      <Link
        // A REAL link to a REAL page, so the row keeps open-in-new-tab,
        // middle-click and copy-link, and the back button returns here.
        href={`/conditionals/${encodeURIComponent(row.conditional_id)}`}
        className={`cdl-row group no-underline ${ended ? 'cdl-row--past' : ''}`}
        data-testid="cdl-row"
        data-conditional-id={row.conditional_id}
        data-state={state}
        {...(why === null ? {} : { 'data-hold': 'true' })}
      >
        <span className="cdl-body">
          {/* The left column: the play, and the quiet line of chrome under it. */}
          <span className="cdl-col">
            <span className="cdl-head">
            <span className="cdl-say" title={hoverText}>
              {line.plate === null ? null : <ScopePlateChip plate={line.plate} />}
              {line.when === null ? null : <Sentence segments={line.when} />}
              {line.then === null ? null : (
                <>
                  <span>, </span>
                  <Sentence segments={line.then} />
                </>
              )}
              {needsStop ? <span>.</span> : null}
            </span>
              {/* The one thing that says the row goes somewhere. */}
              <svg className="cdl-go" viewBox="0 0 12 12" aria-hidden focusable="false">
                <path
                  d="M4.4 2.2 8.2 6l-3.8 3.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>

            <span className="cdl-sub">
              <span className="cdl-st" data-testid="cdl-state">
                {stateWord(state)}
              </span>
              {row.sync_pending === true ? (
                // The evaluator is still on an older version of this plan.
                <span data-testid="cdl-sync" title="The evaluator is still on an older version; the edit is syncing">
                  Catching up
                </span>
              ) : null}
              {judge === null ? null : (
                <button
                  type="button"
                  className={JUDGE_BTN}
                  onClick={(event) => {
                    swallow(event);
                    setJudgeOpen(true);
                  }}
                  title="Open the judge record"
                  data-testid="cdl-judge"
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis" data-testid="cdl-judge-phrase">
                    {judge.phrase}
                  </span>
                  <span className="font-medium tabular-nums text-[var(--ink-1)]" data-testid="cdl-judge-figure">
                    {judge.figure}
                  </span>
                </button>
              )}
              {feedback === null ? null : (
                <span
                  className={feedback.kind === 'done' ? 'text-[var(--ink-1)]' : 'text-[var(--ink-0)]'}
                  data-testid="cdl-cancel-feedback"
                >
                  {feedback.kind === 'done' ? feedback.message : feedback.guidance.title}
                </span>
              )}
              {/* The right end of the line: the clock the row was made at,
                  and the one action a row offers. */}
              <span className="cdl-end">
                <span className="cdl-at">{clock(row.created_at, ctx)}</span>
                {cancellable ? (
                  <CancelConfirm
                    busy={busy}
                    onConfirm={() => void cancel()}
                    entryClassName={ROW_CANCEL_BTN}
                    entryTestId="cdl-cancel"
                    label={CANCEL_CONFIRM}
                  />
                ) : null}
              </span>
            </span>
          </span>

          {/*
           * The right column: every reading this row has, each against its
           * own label. What is on it is decided by the ROW rather than by
           * the layout, so nothing is ever shown a figure that does not
           * apply to it: a held play says what is holding it, and an ended
           * one says how it ended rather than how long it has left.
           */}
          <span className="cdl-figs">
            {why === null ? null : (
              <Reading label="Holding" wrap>
                <span data-testid="cdl-pause-reason">
                  {why.lead}
                  {why.amount === null ? null : (
                    <>
                      {' '}
                      <b className="font-medium tabular-nums text-[var(--ink-1)]">{why.amount}</b>
                      <Solana className="mx-[3px] inline-block h-[9px] w-[9px] align-baseline" /> {why.trail}
                    </>
                  )}
                </span>
              </Reading>
            )}
            <Reading label="Fired">{fired === 0 ? 'Never' : String(fired)}</Reading>
            <Reading label="Made">{net === null ? <span className="cdl-none">Nothing yet</span> : net}</Reading>
            {tail === '' ? null : (
              <Reading label={record || ended ? 'Ended' : 'Runs'} title={tail}>
                <span data-testid="cdl-tail">{tail}</span>
              </Reading>
            )}
            {/*
             * The life, as a figure with its own track under it. Both or
             * neither: a play with no resolved deadline has no fraction to
             * state, and a rule drawn under a value that is not there is
             * furniture saying nothing.
             */}
            {life === null ? null : (
              <>
                <Reading label={ended ? 'Ran' : 'Life'}>{`${(life * 100).toFixed(0)}%`}</Reading>
                <span className="cdl-track" aria-hidden data-testid="cdl-track">
                  <span className="cdl-run" style={{ width: `${(life * 100).toFixed(2)}%` }} />
                  {ended ? null : <span className="cdl-now" style={{ left: `${(life * 100).toFixed(2)}%` }} />}
                </span>
              </>
            )}
          </span>
        </span>
      </Link>

      {/* A SIBLING of the anchor, not a child: the dialog portals its DOM
          out, but React events still bubble up the React tree, so a click
          on its overlay would otherwise reach the row's Link. */}
      {judgeOpen ? (
        <ClassifierCandidatesModal
          open
          onClose={() => setJudgeOpen(false)}
          conditionalId={row.conditional_id}
          summary={row.classifier ?? null}
          timeZone={ctx.timeZone}
        />
      ) : null}
    </>
  );
}

/** Exposed for the aria/phrasing tests: what this row says in one string. */
export function ledgerRowText(row: ConditionalSummary, ctx: ClockContext): string {
  const line = playLine(row);
  const parts = [
    clock(row.created_at, ctx),
    line.plate?.label ?? '',
    playLineText(line.when),
    playLineText(line.then),
    stateWord(displayState(row)),
    hasEnded(displayState(row)) ? outcomePhrase(row, ctx) : expiryText(row, ctx),
    economicsPhrase(row) ?? '',
  ];
  return parts.filter((part) => part !== '').join(' · ');
}

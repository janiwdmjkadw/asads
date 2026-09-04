'use client';

/**
 * THE LEDGER LANDING.
 *
 * No panel, no card, no ground: the page title, four words of navigation
 * under a rule, and the plays. Each play draws its own lifetime as a
 * track (see `LedgerRow`), and the column of tracks is the thing you
 * read the page with — which plays are nearly out of road, at a glance,
 * without doing arithmetic on a phrase.
 *
 * WHAT WENT. A bordered card holding a second bordered ledger on a
 * recessed ground, capitalised tracked day bands set in a monospace, and
 * a state said twice — once as a coloured boxed word and again in the
 * sentence. The ground was a box inside a box, the bands were the
 * loudest type on a page they were not the subject of, and the boxes
 * were the only colour on a page whose colour is supposed to mean money.
 *
 * THE ROWS ARE NOT GROUPED BY DAY. Creation time is on the row, at the
 * end of its own line, and the track says more about where a play is in
 * its life than the calendar it was born on ever did.
 *
 * THE RESIDUAL SHEET states what a utility cannot: the row's own three
 * line geometry, the track, and the seam between rows.
 */

import type { ReactElement } from 'react';
import type { ConditionalSummary } from '@/lib/conditionals';
import { LedgerRow, type CancelRow } from './LedgerRow';
import type { ClockContext } from './ledger-model';
import {
  LEDGER_VIEWS,
  VIEW_EMPTY_LINES,
  VIEW_LABELS,
  VIEW_SUBLINES,
  routeConditionals,
  type LedgerView,
} from './views';

const SHEET = `
/*
 * A row is a link, and it has to LOOK like one under the cursor. The
 * hover is drawn in the page's own materials rather than a fill: the row
 * takes the ledger's own margin back as padding, a mark appears in that
 * margin, the sentence comes up to full ink and the track brightens. No
 * background, because nothing on this page has one.
 */
.cdl-row{
  display:block;position:relative;padding:19px 14px 21px;margin:0 -14px;
  border-top:1px solid rgba(255,255,255,.05);
}
.cdl-row:first-of-type{border-top:0;padding-top:4px}
.cdl-row::before{
  content:'';position:absolute;left:0;top:14px;bottom:15px;width:2px;
  background:var(--ink-0);opacity:0;transition:opacity .14s var(--ease);
}
.cdl-row:hover::before,.cdl-row:focus-visible::before{opacity:1}
.cdl-row:focus-visible{outline:none}
.cdl-say,.cdl-track,.cdl-sub{transition:color .14s var(--ease),background-color .14s var(--ease)}
.cdl-row:hover .cdl-say,.cdl-row:focus-visible .cdl-say{color:var(--ink-0)}
.cdl-row:hover .cdl-sub,.cdl-row:focus-visible .cdl-sub{color:var(--ink-2)}
.cdl-row:hover .cdl-track,.cdl-row:focus-visible .cdl-track{background:rgba(255,255,255,.13)}
.cdl-row:hover .cdl-run,.cdl-row:focus-visible .cdl-run{background:var(--ink-1)}
/* The chevron rides the END OF THE HEAD LINE and keeps its 11px whether
   or not it is showing: an element that appears on hover and takes width
   with it would shift the figure beside it every time the cursor lands. */
.cdl-go{
  flex:none;width:11px;height:11px;align-self:center;
  color:var(--ink-3);opacity:0;transform:translateX(-4px);
  transition:opacity .14s var(--ease),transform .14s var(--ease);
}
.cdl-row:hover .cdl-go,.cdl-row:focus-visible .cdl-go{opacity:1;transform:translateX(0)}

.cdl-head{display:flex;align-items:baseline;gap:16px;margin-bottom:13px}
.cdl-say{flex:1 1 auto}
.cdl-say{
  min-width:0;font-size:16px;line-height:1.4;letter-spacing:-.014em;color:var(--ink-1);
  transition:color .14s var(--ease);
}
.cdl-row--past .cdl-say{color:var(--ink-2)}

/* The track: 3px, so it reads as a measure and never as a bar chart. */
.cdl-track{display:block;position:relative;height:3px;border-radius:2px;background:rgba(255,255,255,.07)}
.cdl-run{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--ink-2)}
.cdl-row--past .cdl-run,.cdl-row[data-hold="true"] .cdl-run{background:var(--ink-3)}
/* Now: the head of the run, and the only thing on the track with a size.
   The outline is the black behind it, so the dot sits ON the track
   rather than in it. */
.cdl-now{
  position:absolute;top:-2.5px;width:8px;height:8px;margin-left:-4px;border-radius:50%;
  /* The halo is the page's own ground, which is black. --surface is
     hsl(220 12% 3%), a blue near-black, and drew a faint ring on it. */
  background:var(--ink-0);outline:3px solid #000;
}
.cdl-row[data-hold="true"] .cdl-now{background:#000;box-shadow:inset 0 0 0 1.5px var(--ink-2)}
.cdl-row[data-state="cancel_requested"] .cdl-now{background:var(--ink-3)}

.cdl-sub{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:0 9px;margin-top:13px;
  font-size:12.5px;line-height:1.45;color:var(--ink-3);
}
.cdl-sub > span + span::before{content:'·';margin-right:9px;color:var(--ink-4)}
.cdl-st{color:var(--ink-2);font-weight:500}
.cdl-row[data-hold="true"] .cdl-st,.cdl-row[data-state="failed"] .cdl-st{color:var(--ink-0)}
/* The end of the line, pushed right. It is not part of the run of
   phrases, so it takes no separator dot. */
.cdl-end{display:flex;align-items:center;gap:12px;margin-left:auto}
.cdl-end::before{display:none}
.cdl-at{font-variant-numeric:tabular-nums}

@media (max-width:640px){
  .cdl-head{flex-direction:column;gap:9px}
  .cdl-say{font-size:15px}
  .cdl-end{margin-left:0;width:100%;margin-top:4px}
}
`;

// ───────────────────────── the toggle ─────────────────────────

/**
 * FOUR WORDS UNDER A RULE.
 *
 * The segmented control was a pill on a recessed ground with an inset
 * hairline round the live segment: three materials to say which of four
 * words you are on. A rule and a mark under the live word says it with
 * one, and it is the same navigation the rest of the terminal uses.
 */
function ViewToggle({
  view,
  onChange,
}: {
  readonly view: LedgerView;
  readonly onChange: (next: LedgerView) => void;
}): ReactElement {
  return (
    <div
      className="flex min-w-0 flex-wrap items-baseline gap-x-[26px]"
      role="tablist"
      aria-label="Which conditionals"
      data-testid="cdl-toggle"
    >
      {LEDGER_VIEWS.map((candidate) => {
        const on = candidate === view;
        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(candidate)}
            data-testid={`cdl-view-${candidate}`}
            className={`relative border-0 bg-transparent p-0 pb-[11px] text-[13px] font-medium leading-none tracking-[-.006em] transition-colors duration-[.14s] ease-[var(--ease)] ${
              on
                ? "text-[var(--ink-0)] after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-[var(--ink-0)] after:content-['']"
                : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]'
            }`}
          >
            {VIEW_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── the panel ─────────────────────────

export interface ConditionalsLedgerProps {
  readonly conditionals: readonly ConditionalSummary[];
  readonly view: LedgerView;
  readonly onViewChange: (next: LedgerView) => void;
  readonly ctx: ClockContext;
  /** Wired by the panel; without it no row offers Cancel. */
  readonly onCancel?: CancelRow | undefined;
}

export function ConditionalsLedger({
  conditionals,
  view,
  onViewChange,
  ctx,
  onCancel,
}: ConditionalsLedgerProps): ReactElement {
  const routed = routeConditionals(conditionals);
  const rows = routed[view];
  const record = view !== 'active';
  const subline = VIEW_SUBLINES[view];

  return (
    <div
      className="w-full text-[14px] leading-[1.45] tabular-nums text-[var(--ink-1)]"
      data-testid="conditionals-ledger"
    >
      <style>{SHEET}</style>

      <header className="flex items-baseline pb-[18px]">
        <h1 className="whitespace-nowrap text-[27px] font-semibold leading-[1.1] tracking-[-.024em] text-[var(--ink-0)]">
          Conditionals
        </h1>
      </header>

      <div className="mb-[26px] flex flex-wrap items-baseline gap-x-[16px] gap-y-[8px] border-b border-[var(--hairline)]">
        <ViewToggle view={view} onChange={onViewChange} />
        {subline === null ? null : (
          <span
            className="ml-auto flex-none whitespace-nowrap pb-[11px] text-[11.5px] text-[var(--ink-3)]"
            data-testid="cdl-subline"
          >
            {subline}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        // AN EMPTY VIEW IS STILL A STAGE: the view keeps its room whether
        // or not it has rows, and the invitation sits in the middle of it.
        <div
          className="flex min-h-[220px] items-center justify-center px-[8px] py-[12px]"
          data-testid="cdl-empty-stage"
        >
          <p
            className="max-w-[52ch] text-balance text-center text-[15.5px] leading-[1.55] tracking-[-.002em] text-[var(--ink-2)]"
            data-testid="cdl-empty"
          >
            {VIEW_EMPTY_LINES[view]}
          </p>
        </div>
      ) : (
        <div data-testid="cdl-ledger-panel">
          {rows.map((row) => (
            <LedgerRow key={row.conditional_id} row={row} ctx={ctx} record={record} onCancel={onCancel} />
          ))}
        </div>
      )}
    </div>
  );
}

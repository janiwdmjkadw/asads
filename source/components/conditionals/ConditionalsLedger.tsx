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

/*
 * TWO COLUMNS. The play on the left, its readings in a column of their
 * own on the right. 268px is what the widest reading needs at 12.5px
 * without clipping, and it does not grow with the page: the sentence
 * takes every pixel the window gives, because the sentence is the thing
 * whose length varies.
 */
.cdl-body{display:grid;grid-template-columns:minmax(0,1fr) 268px;gap:44px;align-items:start}
.cdl-col{min-width:0}

.cdl-head{display:flex;align-items:baseline;gap:12px}
.cdl-say{flex:1 1 auto}
.cdl-say{
  min-width:0;font-size:16px;line-height:1.4;letter-spacing:-.014em;color:var(--ink-1);
  transition:color .14s var(--ease);
}
.cdl-row--past .cdl-say{color:var(--ink-2)}

/*
 * ── THE READINGS ─────────────────────────────────────────────────────
 *
 * Label left, figure hard against the right edge, so the figures form a
 * true column down the page and a row with one reading more than the one
 * above it does not push anything out of line.
 */
.cdl-figs{display:flex;flex-direction:column;gap:7px;min-width:0;padding-top:2px}
.cdl-read{display:flex;align-items:baseline;justify-content:space-between;gap:16px;min-width:0}
.cdl-read-k{flex:none;font-size:11px;line-height:1.45;color:var(--ink-3)}
.cdl-read-v{
  min-width:0;font-size:12.5px;line-height:1.45;font-weight:500;color:var(--ink-1);
  text-align:right;font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  transition:color .14s var(--ease);
}
/* The held reason is a sentence, so it wraps rather than losing its tail. */
.cdl-read--wrap{display:block}
.cdl-read--wrap .cdl-read-k{display:block;margin-bottom:2px}
.cdl-read--wrap .cdl-read-v{display:block;white-space:normal;overflow:visible;text-align:left;color:var(--ink-2)}
.cdl-none{color:var(--ink-3);font-weight:400}
.cdl-row:hover .cdl-read-v,.cdl-row:focus-visible .cdl-read-v{color:var(--ink-0)}

/* The track: 3px, so it reads as a measure and never as a bar chart. It
   sits UNDER ITS OWN VALUE inside the readings column. Full width across
   the sentence, which is where it used to be, is how an underline is
   drawn, and it read as one. */
.cdl-track{display:block;position:relative;height:3px;margin-top:2px;border-radius:2px;background:rgba(255,255,255,.07)}
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
  display:flex;flex-wrap:wrap;align-items:baseline;gap:0 9px;margin-top:9px;
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

/*
 * ── THE NARROW CASE ──────────────────────────────────────────────────
 *
 * A CONTAINER query, not a viewport one. This page is a column inside a
 * terminal that has other things beside it, so the width that decides
 * whether a 268px readings column can stand next to a readable sentence
 * is the width of THIS surface, not of the window. Under 860 the
 * readings go under the play instead, laid out across the width they
 * just got back rather than stacked in a strip.
 */
@container cdl (max-width:860px){
  .cdl-body{grid-template-columns:minmax(0,1fr);gap:16px}
  .cdl-figs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 26px}
  .cdl-read--wrap{grid-column:1 / -1}
  .cdl-track{grid-column:1 / -1;margin-top:4px}
}
@container cdl (max-width:560px){
  .cdl-figs{grid-template-columns:minmax(0,1fr)}
  .cdl-say{font-size:15px}
  .cdl-end{margin-left:0;width:100%;margin-top:4px}
}

/*
 * ── THE PAGE: THE FILTER STANDS ON THE LEFT ──────────────────────────
 *
 * Four words down the left and the plays beside them, rather than a
 * strip across the top. The strip spent a whole band of the page saying
 * one word; the column spends width the plays were not using, and it
 * puts the navigation where the eye starts rather than in the middle of
 * the reading.
 *
 * Both widths that matter here are CONTAINER widths. This surface is a
 * column inside a terminal that has other things beside it, so the
 * window is not what decides whether a column fits.
 */
.cdl-page{container:cdlpage / inline-size}
.cdl-split{display:flex;align-items:flex-start;gap:40px}
.cdl-nav{flex:none;width:164px;padding-top:3px}
.cdl-navlist{display:flex;flex-direction:column;align-items:flex-start;gap:13px}
.cdl-subline{display:block;margin-top:18px;font-size:11.5px;line-height:1.5;color:var(--ink-3)}
/* The rows are the thing whose width decides the row layout, so the row
   container is named on THEM and not on the page. */
.cdl-main{flex:1;min-width:0;container:cdl / inline-size}

/*
 * Under 720 there is not enough width for a column beside a readable
 * play, so the four lie down across the top. That is the only width at
 * which they are ever on top.
 */
@container cdlpage (max-width:720px){
  .cdl-split{display:block}
  .cdl-nav{width:auto;padding:0 0 16px}
  .cdl-navlist{flex-direction:row;flex-wrap:wrap;gap:22px}
  .cdl-subline{margin-top:10px}
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
    <div className="cdl-navlist" role="tablist" aria-label="Which conditionals" data-testid="cdl-toggle">
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
            className={`border-0 bg-transparent p-0 text-left text-[13px] font-medium leading-none tracking-[-.006em] transition-colors duration-[.14s] ease-[var(--ease)] ${
              on ? 'text-[var(--ink-0)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]'
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
      className="cdl-page w-full text-[14px] leading-[1.45] tabular-nums text-[var(--ink-1)]"
      data-testid="conditionals-ledger"
    >
      <style>{SHEET}</style>

      <header className="flex items-baseline pb-[22px]">
        <h1 className="whitespace-nowrap text-[27px] font-semibold leading-[1.1] tracking-[-.024em] text-[var(--ink-0)]">
          Conditionals
        </h1>
      </header>

      <div className="cdl-split">
        <aside className="cdl-nav">
          <ViewToggle view={view} onChange={onViewChange} />
          {subline === null ? null : (
            <span className="cdl-subline" data-testid="cdl-subline">
              {subline}
            </span>
          )}
        </aside>

        <div className="cdl-main">
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
      </div>
    </div>
  );
}

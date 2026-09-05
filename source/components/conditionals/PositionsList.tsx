'use client';

/**
 * POSITIONS — one compact row per position the plan has opened, under the
 * header and above the tabs, because "what do I hold, and what did each
 * one make" is the question a plan that has FIRED is opened to answer.
 *
 * One row system, again: the token chip in the sentence slot, the status
 * as a WORD in the page's three inks (mint watching, amber sold-outside,
 * grey ended, `--down` for a failed exit), the realized figure in the one
 * right-aligned mono column. An `every` plan with 25 positions is 25
 * 44px rows, each opening on the same 140ms grid-rows ease the
 * Transactions rows use — never 25 cards.
 *
 * The open row says, in order: entry (SOL in, tokens, price, time); the
 * TRIGGER LEVEL against the FILL market cap and the gap between them —
 * the line that stops the screen price being read as the entry; the exit
 * targets the plan is still watching (entry-relative — this surface has
 * no live quote); the exit and its note; and why the entry fired.
 */

import { useState, type ReactElement } from 'react';

import { TokenChip } from './TokenChip';
import { ProofList } from './ProofList';
import type { PositionRow } from './positions-model';
import type { ProofLine } from './proofs-model';

const ROW =
  'grid w-full cursor-pointer appearance-none grid-cols-[16px_minmax(0,1fr)_auto_96px] items-center gap-x-[10px] ' +
  'border-0 bg-transparent px-[2px] py-[12px] text-left @[430.02px]:grid-cols-[18px_minmax(0,1fr)_auto_112px] @[430.02px]:gap-x-[12px]';
const SENTENCE = 'flex min-w-0 items-center gap-[9px] overflow-hidden text-[14px] leading-[1.45] tracking-[-.002em] text-[var(--ink-1)]';
const STATUS = 'flex-none whitespace-nowrap text-[12px] font-semibold tracking-[-.004em]';
const FIGURE = 'justify-self-end whitespace-nowrap font-[family-name:var(--mono)] text-[15.5px] font-medium tabular-nums tracking-[-.014em]';
const DT = 'font-[family-name:var(--mono)] text-[9.5px] uppercase leading-[1.2] tracking-[.1em] text-[var(--ink-2)]';
const DD = 'mt-[6px] min-w-0 text-[13px] leading-[1.45] text-[var(--ink-1)]';
const NOTE = 'mt-[6px] text-[12px] leading-[1.5] text-[var(--ink-2)]';

const TONE_INK: Readonly<Record<PositionRow['tone'], string>> = {
  watch: 'text-[var(--flame)]',
  hold: 'text-[var(--hold)]',
  past: 'text-[var(--ink-2)]',
  fail: 'text-[var(--down,#b4482e)]',
};

function Chevron({ open }: { readonly open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      focusable="false"
      className={`block h-[12px] w-[12px] flex-none text-[var(--ink-2)] transition-transform duration-[140ms] ease-[var(--ease)] motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.4 2.2 8.2 6l-3.8 3.8" />
    </svg>
  );
}

function PositionItem({ row, proofs }: { readonly row: PositionRow; readonly proofs: readonly ProofLine[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="cd-position" data-state={row.tone} data-open={open ? 'true' : 'false'}>
      <button type="button" className={ROW} aria-expanded={open} onClick={() => setOpen((was) => !was)} data-testid="cd-position-row">
        <Chevron open={open} />
        <span className={SENTENCE}>
          {row.token === null ? <span className="text-[var(--ink-2)]">token</span> : <TokenChip mint={row.token.mint} symbol={row.token.symbol} testid="cd-position-token" />}
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--ink-2)]">{row.entryText}</span>
        </span>
        <span className={`${STATUS} ${TONE_INK[row.tone]}`} data-testid="cd-position-status">
          {row.statusWord}
        </span>
        <span
          className={`${FIGURE} ${row.pnlUp === null ? 'text-[var(--ink-2)]' : row.pnlUp ? 'text-[var(--up,#0f6d5f)]' : 'text-[var(--down,#b4482e)]'}`}
          data-testid="cd-position-pnl"
        >
          {row.pnlText ?? '—'}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-[140ms] ease-[var(--ease)] motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <dl className="m-0 grid grid-cols-1 gap-x-[26px] gap-y-[16px] pb-[22px] pl-[26px] pr-[2px] pt-[2px] @[430.02px]:grid-cols-2 @[430.02px]:pl-[32px]">
            <div className="min-w-0">
              <dt className={DT}>Entry</dt>
              <dd className={DD}>
                {row.entryText}
                {row.entryAt === '' ? null : <span className="ml-[.42em] text-[var(--ink-2)]">· {row.entryAt}</span>}
              </dd>
            </div>
            {row.triggerFillText === null ? null : (
              <div className="min-w-0">
                <dt className={DT}>Trigger vs fill</dt>
                <dd className={DD} data-testid="cd-position-trigger">
                  {row.triggerFillText}
                </dd>
                <p className={NOTE}>The trigger is the level the plan asked for; the fill is what the trade paid.</p>
              </div>
            )}
            {row.targets.length === 0 ? null : (
              <div className="min-w-0">
                <dt className={DT}>Exit when</dt>
                <dd className={DD}>
                  <ul className="m-0 flex list-none flex-col gap-[4px] p-0" data-testid="cd-position-targets">
                    {row.targets.map((target) => (
                      <li key={target.key} className={target.inZone === true ? 'text-[var(--flame)]' : ''} data-in-zone={target.inZone === null ? 'unknown' : String(target.inZone)}>
                        {target.text}
                        {target.inZone === true ? ', in zone' : ''}
                      </li>
                    ))}
                  </ul>
                </dd>
                <p className={NOTE}>Stated against the entry; this page shows no live quote.</p>
              </div>
            )}
            {row.exitText === null && row.exitNote === null ? null : (
              <div className="min-w-0">
                <dt className={DT}>Exit</dt>
                {row.exitText === null ? null : (
                  <dd className={DD} data-testid="cd-position-exit">
                    {row.exitText}
                    {row.signature === null ? null : (
                      <>
                        {' '}
                        <a
                          href={`https://solscan.io/tx/${row.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--acc-0,#2a5fd0)] underline decoration-[rgba(42,95,208,.35)] underline-offset-[3px]"
                        >
                          tx
                        </a>
                      </>
                    )}
                  </dd>
                )}
                {row.exitNote === null ? null : (
                  <p className={NOTE} data-testid="cd-position-exit-note">
                    {row.exitNote}
                  </p>
                )}
              </div>
            )}
            {proofs.length === 0 ? null : (
              <div className="min-w-0 @[430.02px]:col-span-2">
                <dt className={DT}>Why it fired</dt>
                <dd className={`${DD} mt-[9px]`}>
                  <ProofList lines={proofs} testid="cd-position-proofs" />
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </li>
  );
}

export function PositionsList({
  rows,
  proofsFor,
}: {
  readonly rows: readonly PositionRow[];
  /** Proof lines for a position's ENTRY firing, by position key. */
  readonly proofsFor: (key: string) => readonly ProofLine[];
}): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section className="mt-[18px]" data-testid="cd-positions">
      <h3 className="m-0 text-[11.5px] font-medium uppercase leading-none tracking-[.1em] text-[var(--ink-2)]">
        {rows.length === 1 ? 'Position' : `${rows.length} positions`}
      </h3>
      <ol className="m-0 mt-[4px] list-none p-0">
        {rows.map((row) => (
          <PositionItem key={row.key} row={row} proofs={proofsFor(row.key)} />
        ))}
      </ol>
    </section>
  );
}

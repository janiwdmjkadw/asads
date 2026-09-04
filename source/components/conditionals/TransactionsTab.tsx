'use client';

/**
 * TAB 2 · TRANSACTIONS — one row per fill, and the broker's order detail
 * under it.
 *
 * This is NOT a second row system. It is the Activity row with the chevron
 * in the marker slot and the token in the sentence, on the same four
 * columns from `feed-row.tsx` — which is why `+0.005` lands on the same
 * edge it landed on in Activity. A list of numbers earns its authority by
 * having ONE column of numbers.
 *
 * PRICE AND FEES ARE SLOTS, NOT NUMBERS. The read routes serve times,
 * counts and a settled SOL delta; nothing on the wire today carries a
 * per-fill price, a fee, or a realised P&L. They render as an em dash,
 * because designing the slot rather than hiding the field is what makes
 * filling it a data change and not a layout change. Nothing here is ever
 * computed from the amount the plan was AUTHORIZED for.
 */

import { useState, type ReactElement, type ReactNode } from 'react';
import { TokenDisc } from '@/components/agent/proposal/v2/marks';
import { TokenChip } from './TokenChip';
import { formatSol } from './pnl';
import type { FiringEconomics } from './pnl';
import { ProofList } from './ProofList';
import type { ProofLine } from './proofs-model';
import { TOK_PLATE } from '@/components/agent/proposal/v2/card-classes';
import type { TxGroup, TxRow } from './event-feed';
import {
  FEED_INLINE,
  FEED_ROW,
  FEED_SENTENCE,
  FeedFigure,
  FeedGroupHeader,
  FeedSection,
  FeedTime,
} from './feed-row';

const DT =
  'font-[family-name:var(--mono)] text-[9.5px] leading-[1.2] uppercase tracking-[.1em] ' +
  'whitespace-nowrap text-[var(--ink-2)]';
const DD = 'mt-[7px] min-w-0 text-[13.5px] leading-[1.4] text-[var(--ink-1)]';
const STAMP = `${FEED_INLINE} text-[var(--ink-0)]`;
const ZONE =
  'ml-[.34em] text-[.8em] font-normal tracking-[.04em] text-[var(--ink-2)]';

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0" data-testid="cd-record-field">
      <dt className={DT}>{label}</dt>
      <dd className={DD}>{children}</dd>
    </div>
  );
}

/** The slot the wire does not fill. An em dash, never an invented figure. */
function Blank(): ReactElement {
  return (
    <span className="font-[family-name:var(--mono)] text-[13px] text-[var(--ink-2)]" data-testid="cd-record-blank">
      —
    </span>
  );
}

function Stamp({ at, zone }: { readonly at: string; readonly zone: string }): ReactElement {
  if (at === '') return <Blank />;
  return (
    <>
      <b className={STAMP}>{at}</b>
      {zone === '' ? null : <span className={ZONE}>{zone}</span>}
    </>
  );
}

function Record({
  row,
  zone,
  proofs,
}: {
  readonly row: TxRow;
  readonly zone: string;
  readonly proofs: readonly ProofLine[];
}): ReactElement {
  const record = row.record;
  return (
    <dl
      className="grid grid-cols-2 gap-x-[26px] gap-y-[22px] @[430.02px]:grid-cols-3"
      data-testid="cd-record"
    >
      <Field label="Order type">{record.orderType}</Field>
      <Field label="Leg">
        {record.legNo === null ? (
          <Blank />
        ) : (
          <>
            Leg <b className={STAMP}>{record.legNo}</b>
            {record.legCount > 0 ? (
              <>
                {' of '}
                <b className={STAMP}>{record.legCount}</b>
              </>
            ) : null}
          </>
        )}
        <span className="mx-[.42em] text-[var(--ink-2)]">·</span>
        run <b className={STAMP}>{record.occurrence}</b>
      </Field>
      <Field label="Status">{record.status}</Field>
      <Field label="Submitted">
        <Stamp at={record.submitted} zone={zone} />
      </Field>
      <Field label="Filled">
        <Stamp at={record.filled} zone={zone} />
      </Field>
      <Field label="Amount">
        {record.delta === null ? (
          <Blank />
        ) : (
          <span className="flex items-baseline">
            <FeedFigure delta={record.delta} />
          </span>
        )}
      </Field>
      <Field label="Price">
        <Blank />
      </Field>
      <Field label="Fees">
        <Blank />
      </Field>
      {/* WHY IT FIRED — the firing's frozen evidence as checkable facts
          (tweet link, deploy, watched wallet's tx). Spans the record so the
          lines never fight the two-figure columns above them. */}
      {proofs.length === 0 ? null : (
        <div className="col-span-2 min-w-0 @[430.02px]:col-span-3" data-testid="cd-record-field">
          <dt className={DT}>Why it fired</dt>
          <dd className={`${DD} mt-[9px]`}>
            <ProofList lines={proofs} testid="cd-tx-proofs" />
          </dd>
        </div>
      )}
    </dl>
  );
}

function TransactionRow({
  row,
  mint,
  zone,
  economics,
  proofs,
}: {
  readonly row: TxRow;
  readonly mint: string | null;
  readonly zone: string;
  readonly economics?: ReadonlyMap<string, FiringEconomics>;
  readonly proofs?: ReadonlyMap<string, readonly ProofLine[]>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const facts = economics?.get(row.operationId);
  const proofLines = proofs?.get(row.operationId) ?? [];
  // Entry/exit at the SWAP price — what the tokens themselves cost, the
  // same basis the stop-loss compares against.
  const priceText =
    facts === undefined
      ? null
      : `${facts.side === 'buy' ? 'entry' : 'exit'} @ ${formatSol(facts.priceLamportsPerToken)} SOL`;
  return (
    <div data-testid="cd-tx" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className={`${FEED_ROW} w-full cursor-pointer appearance-none border-0 bg-transparent text-left`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        data-testid="cd-tx-row"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          focusable="false"
          className={`block h-[12px] w-[12px] flex-none text-[var(--ink-2)] transition-transform duration-[140ms] ease-[var(--ease)] motion-reduce:transition-none ${
            open ? 'rotate-90' : ''
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.4 2.2 8.2 6l-3.8 3.8" />
        </svg>
        <span className={`${FEED_SENTENCE} flex items-center gap-[9px]`}>
          {row.token !== null ? (
            <TokenChip mint={row.token.mint} symbol={row.token.symbol} testid="cd-tx-token" />
          ) : (
            <TokenDisc mint={mint} className={`${TOK_PLATE} h-[17px] w-[17px]`} />
          )}
          <span>
            {row.legNo === null ? null : (
              <>
                Leg <b className={STAMP}>{row.legNo}</b>
              </>
            )}
            {row.side === null ? (row.legNo === null ? 'Fill' : '') : ` ${row.side}`}
          </span>
          {priceText === null ? null : (
            <span className="whitespace-nowrap text-[11px] text-[var(--ink-2)]" data-testid="cd-tx-price">
              {priceText}
            </span>
          )}
        </span>
        <FeedFigure delta={row.delta} />
        <FeedTime at={row.at} />
      </button>
      {/* 0fr → 1fr: a height ease with no measured pixel, so the record can
          be any depth and the row still opens on the lab's 140ms curve. */}
      <div
        className={`grid transition-[grid-template-rows] duration-[140ms] ease-[var(--ease)] motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
        data-testid="cd-record-shell"
      >
        <div className="overflow-hidden">
          <div className="pb-[30px] pl-[26px] pr-[2px] pt-[5px] @[430.02px]:pl-[32px]">
            <Record row={row} zone={zone} proofs={proofLines} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransactionsTab({
  groups,
  mint,
  zone,
  economics,
  proofs,
}: {
  readonly groups: readonly TxGroup[];
  readonly mint: string | null;
  readonly zone: string;
  readonly economics?: ReadonlyMap<string, FiringEconomics>;
  /** Proof lines by the firing's operation id. */
  readonly proofs?: ReadonlyMap<string, readonly ProofLine[]>;
}): ReactElement {
  if (groups.length === 0) {
    return (
      <FeedSection testId="cd-transactions">
        <p className="px-[2px] py-[22px] text-[13.5px] leading-[1.5] text-[var(--ink-2)]">
          Nothing has traded yet. A fill lands here the moment one settles.
        </p>
      </FeedSection>
    );
  }
  return (
    <FeedSection testId="cd-transactions">
      {groups.map((group, index) => (
        <div key={group.key} className={index === 0 ? '' : 'mt-[30px]'} data-testid="cd-feed-group">
          <FeedGroupHeader title={group.title} date={group.date} />
          {group.rows.map((row) => (
            <TransactionRow
              key={row.key}
              row={row}
              mint={mint}
              zone={zone}
              {...(economics === undefined ? {} : { economics })}
              {...(proofs === undefined ? {} : { proofs })}
            />
          ))}
        </div>
      ))}
    </FeedSection>
  );
}

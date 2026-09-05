'use client';

/**
 * THE HEADER'S RIGHT EDGE — what you can do about this plan, and nothing
 * you cannot.
 *
 * THE ACTIONS ARE ABSENT, NOT DISABLED. A finished plan cannot be
 * cancelled and has nothing to edit, so neither control renders — the same
 * rule that removes Resume from a play the wallet cannot fund instead of
 * greying it out. When there is nothing to offer, the ⋯ itself does not
 * draw: an overflow menu with an empty menu inside it is furniture.
 *
 * CANCEL IS A LABELLED BUTTON, NEXT TO EDIT. It lived only in the ⋯
 * overflow, which the owner read as "no way to cancel unless you tell the
 * agent". It is still two steps — the question and its two answers, in
 * the locked sentences from `controls.ts`, in a popover under the word
 * (`CancelConfirm`, the same control the ledger rows use). After it lands
 * the page states what is now true (the header's own quiet line) and
 * there is nothing left to press.
 *
 * THE ⋯ ONLY DRAWS WHEN SOMETHING ELSE IS IN IT — a paused plan's
 * `Resume` / `Add funds`. With cancel promoted, a plain live plan has no
 * menu at all.
 *
 * ONE GRADIENT, AND IT IS ALWAYS THE SAFE ANSWER — `Keep watching` during
 * the ask, and on a paused plan whichever primary the wallet actually
 * supports (`Resume` when the balance covers what the plan needs, `Add
 * funds` when it does not).
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { SolMark } from '@/components/agent/proposal/v2/marks';
import { CancelConfirm } from './CancelConfirm';
import { CANCEL_CONFIRM, EDIT_ENTRY, FUND_ENTRY, RESUME_ENTRY, type ControlsModel } from './controls';

/** The lab's `.btn`: quiet, borderless, and it only lights on hover. The
 *  border is TRANSPARENT on purpose: the detail body has exactly one
 *  hairline (the tab bar's), and a bordered ghost here would be a second. */
export const HEADER_BTN =
  'inline-flex flex-none items-center gap-[8px] whitespace-nowrap rounded-[10px] border border-transparent ' +
  'bg-transparent px-[13px] py-[9px] text-[13px] font-medium leading-[1.15] tracking-[.012em] ' +
  'text-[var(--ink-2)] transition-colors duration-[.14s] ease-[var(--ease)] ' +
  'hover:bg-[var(--surface-1)] hover:text-[var(--ink-0)] disabled:opacity-[.55]';

const MENU_ITEM =
  'flex w-full items-center rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[1.3] ' +
  'text-[var(--ink-1)] transition-colors duration-[.14s] ease-[var(--ease)] ' +
  'hover:bg-[var(--surface-3)] hover:text-[var(--ink-0)] disabled:opacity-[.55]';

export interface PlanActionsProps {
  readonly controls: ControlsModel;
  readonly busy: boolean;
  /** True once a cancel has landed — the page has nothing left to offer. */
  readonly settled: boolean;
  readonly onCancel: () => void;
  readonly onResume: () => void;
  readonly onRequestModification?: (() => void) | undefined;
  readonly onFund?: (() => void) | undefined;
}

export function PlanActions({
  controls,
  busy,
  settled,
  onCancel,
  onResume,
  onRequestModification,
  onFund,
}: PlanActionsProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const canEdit = !settled && controls.canEdit && onRequestModification !== undefined;
  const canCancel = !settled && controls.canCancel;
  const resume = settled ? 'none' : controls.resume;
  const hasMenu = resume !== 'none';
  if (!canEdit && !canCancel && !hasMenu) return null;

  return (
    <div className="relative ml-auto flex flex-none items-center gap-[2px] pt-[3px]" ref={wrap}>
      {canEdit ? (
        <button
          type="button"
          className={HEADER_BTN}
          onClick={onRequestModification}
          disabled={busy}
          data-testid="cd-edit"
        >
          {EDIT_ENTRY}
        </button>
      ) : null}

      {canCancel ? (
        <CancelConfirm
          busy={busy}
          onConfirm={onCancel}
          entryClassName={HEADER_BTN}
          entryTestId="cd-cancel"
          label={CANCEL_CONFIRM}
        />
      ) : null}

      {hasMenu ? (
        <button
          type="button"
          className={`${HEADER_BTN} px-[10px]`}
          aria-label="More actions"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((was) => !was)}
          disabled={busy}
          data-testid="cd-more"
        >
          <svg viewBox="0 0 16 16" aria-hidden focusable="false" className="block h-[16px] w-[16px] fill-current">
            <circle cx="3.4" cy="8" r="1.35" />
            <circle cx="8" cy="8" r="1.35" />
            <circle cx="12.6" cy="8" r="1.35" />
          </svg>
        </button>
      ) : null}

      {open ? (
        <div
          className="absolute right-0 top-full z-[20] mt-[6px] w-[268px] rounded-[12px] border border-[var(--hairline-2)] bg-[var(--surface-2)] p-[8px] shadow-[0_18px_40px_rgba(11,14,20,.16)]"
          data-testid="cd-menu"
          role="menu"
        >
          <div className="flex flex-col gap-[2px]">
            {resume === 'resume' ? (
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM}
                onClick={() => {
                  setOpen(false);
                  onResume();
                }}
                disabled={busy}
                data-testid="cd-resume"
              >
                {RESUME_ENTRY}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setOpen(false);
                    onFund?.();
                  }}
                  disabled={busy || onFund === undefined}
                  data-testid="cd-fund"
                >
                  {FUND_ENTRY}
                </button>
                {controls.fundLine === null ? null : (
                  <p
                    className="px-[10px] pb-[6px] text-[12px] leading-[1.5] text-[var(--ink-2)]"
                    data-testid="cd-fund-line"
                  >
                    {controls.fundLine.lead}
                    {controls.fundLine.amount === null ? null : (
                      <>
                        {' '}
                        <b className="font-[family-name:var(--mono)] font-medium tabular-nums text-[var(--ink-1)]">
                          {controls.fundLine.amount}
                        </b>
                        <SolMark />{' '}
                        {controls.fundLine.trail}
                      </>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

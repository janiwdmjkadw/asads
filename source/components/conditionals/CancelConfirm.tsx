'use client';

/**
 * CANCEL, AS A LABELLED BUTTON — on the detail header and on every
 * cancellable ledger row. It used to live only inside the detail's ⋯
 * overflow, which read as "there is no way to cancel unless you tell the
 * agent"; the entry is now a word, and the two-step ask is unchanged: the
 * question and its two answers, in the locked sentences from
 * `controls.ts`, in a small popover under the button rather than a
 * dialog over the thing being decided about.
 *
 * ONE GRADIENT, AND IT IS THE SAFE ANSWER (`Keep watching`). Cancel is an
 * action, not a state, so it takes no accent: the entry is whatever quiet
 * button its host hands in, and the confirm is the ghost.
 *
 * INSIDE A LINK IT MUST NOT NAVIGATE. Every click in here is stopped and
 * its default prevented at the wrapper, so a row's anchor never sees it
 * and `next/link` never routes on it.
 */

import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { BTN, BTN_GHOST, BTN_GRAD, BTN_PAD } from '@/components/agent/proposal/v2/card-classes';
import { CANCEL_ASK, CANCEL_CONFIRM, CANCEL_KEEP } from './controls';

export interface CancelConfirmProps {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  /** The entry button's classes — the host decides how quiet it is. */
  readonly entryClassName: string;
  readonly entryTestId: string;
  readonly label: string;
  /** Where the popover hangs from the entry. */
  readonly align?: 'left' | 'right';
  /** Extra classes on the wrapper — the host's grid slot, if any. */
  readonly className?: string;
}

function swallow(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function CancelConfirm({
  busy,
  onConfirm,
  entryClassName,
  entryTestId,
  label,
  align = 'right',
  className = '',
}: CancelConfirmProps): ReactElement {
  const [asking, setAsking] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!asking) return undefined;
    const away = (event: globalThis.MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setAsking(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAsking(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [asking]);

  return (
    <span
      ref={wrap}
      className={`relative inline-flex flex-none items-center ${className}`}
      onClick={swallow}
      data-testid={`${entryTestId}-wrap`}
    >
      <button
        type="button"
        className={entryClassName}
        aria-expanded={asking}
        aria-haspopup="dialog"
        onClick={() => setAsking((was) => !was)}
        disabled={busy}
        data-testid={entryTestId}
      >
        {label}
      </button>
      {asking ? (
        <span
          role="dialog"
          aria-label={CANCEL_ASK}
          className={`absolute top-full z-[20] mt-[6px] flex w-[268px] flex-col gap-[10px] rounded-[12px] border border-[var(--hairline-2)] bg-[var(--surface-2)] p-[12px] text-left shadow-[0_18px_40px_rgba(0,0,0,.45)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          data-testid="cd-cancel-ask"
        >
          <span className="whitespace-normal text-[13px] leading-[1.4] text-[var(--ink-1)]">{CANCEL_ASK}</span>
          <span className="flex flex-wrap items-center gap-[8px]">
            <button
              type="button"
              className={`${BTN} ${BTN_PAD} ${BTN_GRAD}`}
              onClick={() => setAsking(false)}
              disabled={busy}
              data-testid="cd-keep"
            >
              {CANCEL_KEEP}
            </button>
            <button
              type="button"
              className={`${BTN} ${BTN_PAD} ${BTN_GHOST}`}
              onClick={() => {
                setAsking(false);
                onConfirm();
              }}
              disabled={busy}
              data-testid="cd-cancel-confirm"
            >
              {CANCEL_CONFIRM}
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}

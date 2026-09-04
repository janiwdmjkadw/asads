'use client';

import { createPortal } from 'react-dom';
import { SummaryRow } from './bits';
import { useListenRootPortal } from './useListenRootPortal';

/**
 * Pre-create confirmation modal (reference: "Recurring Summary").
 * Pure presentation: the caller assembles the rows and owns the
 * submit; this component only renders and relays Confirm/Cancel.
 *
 * Portaled to the nearest `.listen-root`: rendered in place inside the
 * trade panel, the fixed overlay is trapped in the panel's forced
 * stacking context (`.panel > * { z-index: 1 }`) and can paint under
 * other page chrome (see useListenRootPortal).
 */

export interface ConfirmRow {
  readonly label: string;
  readonly value: string;
}

export function ConfirmOrderModal({
  title,
  rows,
  confirmLabel,
  submitting,
  onConfirm,
  onCancel,
}: {
  title: string;
  rows: ReadonlyArray<ConfirmRow>;
  confirmLabel: string;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { anchorRef, portalTarget } = useListenRootPortal();
  const overlay = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        // Backdrop click cancels; clicks inside the card don't bubble out.
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        className="flex w-full max-w-[340px] flex-col gap-3"
        style={{
          padding: 16,
          borderRadius: 'var(--r-2xl)',
          background: 'var(--section-bg)',
          border: '1px solid var(--section-border)',
          boxShadow: '0 24px 64px -16px rgba(0,0,0,0.9)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>{title}</div>
        <div
          className="flex flex-col gap-2"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--r-lg)',
            background: 'var(--input-bg)',
            border: '1px solid var(--hairline)',
          }}
        >
          {rows.map((row) => (
            <SummaryRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="seg__btn flex-1"
            style={{ height: 34, fontSize: 12, justifyContent: 'center' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="buy-cta flex-1"
            style={{ height: 34, fontSize: 13, opacity: submitting ? 0.6 : 1 }}
          >
            <span>{submitting ? 'Submitting…' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <span ref={anchorRef} hidden />
      {portalTarget ? createPortal(overlay, portalTarget) : null}
    </>
  );
}

'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './confirm-dialog.css';

/**
 * Slice "Portfolio": the in-app confirm.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * Deleting a wallet group called `window.confirm`. That is the
 * BROWSER's dialog: Chrome's own grey sheet dropping from the top of
 * the window in the system font, with an OS `Cancel` and `OK`, over the
 * page's URL — the one piece of chrome in the product that cannot be
 * styled, is identical to the box a scam site shows you, and looks like
 * a crash rather than a question.
 *
 * It is also synchronous. It blocks the main thread, so nothing on the
 * page can paint, animate or respond while it is up.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────
 *
 * The page's own materials: black, one hairline, sentence case, and the
 * one destructive action in the product's red rather than a plate.
 *
 * Portalled to `document.body`, because a dialog rendered inside the
 * wallets panel inherits that panel's `overflow: hidden` and its
 * stacking context, and either one is enough to clip it or bury it.
 */

interface Props {
  readonly open: boolean;
  readonly title: string;
  /** One line. If it needs a paragraph, it is not a confirm. */
  readonly body?: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Red rather than white. Deleting is the only thing that earns it. */
  readonly destructive?: boolean;
  readonly busy?: boolean;
}

export function ConfirmDialog(props: Props): React.ReactElement | null {
  const { open, onCancel } = props;

  // Escape closes, and the listener only exists while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="cfd-scrim"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="cfd" role="alertdialog" aria-modal="true" aria-label={props.title}>
        <b className="cfd-title">{props.title}</b>
        {props.body ? <p className="cfd-body">{props.body}</p> : null}

        <div className="cfd-row">
          <button type="button" className="cfd-quiet" onClick={onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button
            type="button"
            className="cfd-go"
            data-destructive={props.destructive ? '' : undefined}
            onClick={props.onConfirm}
            disabled={props.busy}
            autoFocus
          >
            {props.busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

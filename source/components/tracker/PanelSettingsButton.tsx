'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './tracker.css';

/**
 * The gear beside a panel's title, and the MODAL it opens.
 *
 * This was a dropdown, and a dropdown is the wrong container for what is
 * in it: two hundred handles and any number of wallets can be tracked,
 * so a card hanging off a gear is either a wall running down the side of
 * the panel or a short slot you scroll a hundred rows through. Neither
 * is a way to find one wallet.
 *
 * A modal has the room. The tracked list lays out in as many columns as
 * fit, so eighty wallets are on screen at once instead of eight, and the
 * filter sits at the top of them.
 *
 * ── WHY IT IS PORTALLED ──────────────────────────────────────────────
 *
 * `position: fixed` escapes overflow clipping but NOT a containing
 * block, and this button sits inside two: the panel carries
 * `container-type: inline-size`, and the toolbar row keeps a transform
 * from its entrance animation. Rendered in place, the overlay would
 * centre itself inside the panel instead of the window.
 */
export function PanelSettingsButton({
  label,
  title,
  children,
}: {
  label: string;
  /** Heading inside the modal. */
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The portal target does not exist during the server render.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="tk-gear"
        aria-label={label}
        aria-expanded={open}
        data-on={open ? '' : undefined}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12.2 2.4h-.4a1.9 1.9 0 0 0-1.9 1.9v.2a1.9 1.9 0 0 1-1 1.6l-.4.3a1.9 1.9 0 0 1-1.9 0l-.2-.1a1.9 1.9 0 0 0-2.6.7l-.2.4a1.9 1.9 0 0 0 .7 2.6l.2.1a1.9 1.9 0 0 1 .9 1.6v.5a1.9 1.9 0 0 1-.9 1.6l-.2.1a1.9 1.9 0 0 0-.7 2.6l.2.4a1.9 1.9 0 0 0 2.6.7l.2-.1a1.9 1.9 0 0 1 1.9 0l.4.3a1.9 1.9 0 0 1 1 1.6v.2a1.9 1.9 0 0 0 1.9 1.9h.4a1.9 1.9 0 0 0 1.9-1.9v-.2a1.9 1.9 0 0 1 1-1.6l.4-.3a1.9 1.9 0 0 1 1.9 0l.2.1a1.9 1.9 0 0 0 2.6-.7l.2-.4a1.9 1.9 0 0 0-.7-2.6l-.2-.1a1.9 1.9 0 0 1-.9-1.6v-.5a1.9 1.9 0 0 1 .9-1.6l.2-.1a1.9 1.9 0 0 0 .7-2.6l-.2-.4a1.9 1.9 0 0 0-2.6-.7l-.2.1a1.9 1.9 0 0 1-1.9 0l-.4-.3a1.9 1.9 0 0 1-1-1.6v-.2a1.9 1.9 0 0 0-1.9-1.9z" />
        </svg>
      </button>

      {mounted && open
        ? createPortal(
            <div
              className="tk-scrim"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div className="tk-modal" role="dialog" aria-modal="true" aria-label={title}>
                <header>
                  <b>{title}</b>
                  <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </header>
                <div className="tk-modal-body tk-scroll">{children}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A named run inside the modal. */
export function PanelSection({ children }: { children: ReactNode }) {
  return <div className="tk-sec">{children}</div>;
}

/**
 * The tracked list.
 *
 * Removal is a BUTTON, not a checkbox: nothing in this list is ever off,
 * every row is tracked, and the only verb is to stop tracking it. The
 * cross is the sole target on the row — a whole row that removes is one
 * stray press from losing a wallet out of a hundred.
 *
 * It lays out in as many columns as the modal is wide, so a long list
 * gets WIDER rather than longer.
 */
export function PanelList({
  items,
  onRemove,
  placeholder,
  noun,
}: {
  items: readonly { key: string; label: string }[];
  onRemove: (key: string) => void;
  placeholder: string;
  noun: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items),
    [items, needle],
  );

  return (
    <>
      {items.length > 10 ? (
        <div className="tk-find">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} spellCheck={false} />
        </div>
      ) : null}

      <div className="tk-plist">
        {shown.map((i) => (
          <div className="tk-prow" key={i.key}>
            <span>{i.label}</span>
            <button type="button" aria-label={`Stop tracking ${i.label}`} title={`Stop tracking ${i.label}`} onClick={() => onRemove(i.key)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {shown.length === 0 ? <p className="tk-pempty">No {noun} match that.</p> : null}
    </>
  );
}

/** One switch in the modal. */
export function PanelSetting({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  /** The last one standing — on, and not allowed off. */
  disabled?: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="tk-col" data-off={checked ? undefined : ''}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
      {children}
    </label>
  );
}

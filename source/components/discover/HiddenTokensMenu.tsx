'use client';

/**
 * THE HIDDEN-TOKEN MENU — the eye-off button on the page bar.
 *
 * Two settings, both about the hidden set:
 *
 *   whether hidden tokens show on the board anyway
 *   whether a hidden token comes back when it graduates
 *
 * ── ONE CONTROL SHAPE, NOT TWO ───────────────────────────────────────
 *
 * The reference draws the first pair as a menu with a tick beside the
 * chosen line and the second as a pair of radio buttons, which is two
 * different marks for the same kind of choice sitting four rows apart.
 * Both are two-way, so both are the same control here, and it is the one
 * the filters panel already uses for a two-way choice: a segment pair.
 *
 * ── THE BUTTON SAYS WHETHER ANYTHING IS HIDDEN ───────────────────────
 *
 * A crossed-out eye that looks the same whether you have hidden nothing
 * or forty things tells you nothing. It carries the count when there is
 * one, and goes white while hidden tokens are being shown, because that
 * is a state the board is in that you would otherwise have to remember.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useBlacklistStore } from '@/lib/state/blacklist-store';
import { useHiddenTokens } from './useHiddenTokens';

import './hidden-tokens-menu.css';

const EYE_OFF = 'M3 3l18 18M10.6 10.7a2 2 0 002.8 2.8M9.4 5.4A9.6 9.6 0 0112 5.2c5 0 9 4.3 9 6.8 0 1-.7 2.3-1.8 3.5M6.2 7.4C4 8.9 3 10.9 3 12c0 2.5 4 6.8 9 6.8 1.3 0 2.5-.3 3.6-.8';

export function HiddenTokensMenu() {
  const hidden = useHiddenTokens();
  const showHiddenTokens = useBlacklistStore((s) => s.showHiddenTokens);
  const unhideOnMigration = useBlacklistStore((s) => s.unhideOnMigration);
  const setShowHiddenTokens = useBlacklistStore((s) => s.setShowHiddenTokens);
  const setUnhideOnMigration = useBlacklistStore((s) => s.setUnhideOnMigration);
  const hydrate = useBlacklistStore((s) => s.hydrate);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hydrate();
    setHost(document.querySelector<HTMLElement>('.listen-root') ?? document.body);
  }, [hydrate]);

  /*
   * Placed from the button's rect in LAYOUT pixels. The root carries a
   * `zoom`, so `getBoundingClientRect` and the `top`/`left` written back
   * as inline style are in different units; dividing by the zoom puts
   * them in the same one. Portalled for the same reason the launchpad
   * popover is: the bars around it create their own stacking contexts.
   */
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      if (btn === null) return;
      const root = document.documentElement;
      const zoom = Number.parseFloat(getComputedStyle(root).zoom);
      const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
      const r = btn.getBoundingClientRect();
      /*
       * `clientWidth` first, `innerWidth` second: the pair disagree under
       * the root's zoom and either can read zero in an embedded webview,
       * so the clamp takes whichever actually measured. With neither, the
       * stylesheet's `max-width` is what keeps the panel on screen.
       */
      const width = popRef.current?.offsetWidth ?? 244;
      const vw = root.clientWidth > 0 ? root.clientWidth : window.innerWidth / z;
      const left = vw > 0
        ? Math.min(Math.max(10, r.left / z), Math.max(10, vw - width - 10))
        : Math.max(10, r.left / z);
      setPos({ top: r.bottom / z + 8, left });
    };
    place();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) === true) return;
      if (btnRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const count = hidden.mintSet.size;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid="subheader-hidden-tokens"
        className={`htm-btn${showHiddenTokens ? ' is-on' : ''}`}
        aria-label={`Hidden tokens, ${count} hidden`}
        aria-expanded={open}
        title="Hidden tokens"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={EYE_OFF} />
        </svg>
        {count > 0 ? <span className="htm-count">{count}</span> : null}
      </button>

      {open && host !== null
        ? createPortal(
            <div
              ref={popRef}
              className="htm-pop"
              role="dialog"
              aria-label="Hidden tokens"
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              <Choice
                label="Hidden tokens"
                a={{ label: 'Hide', on: !showHiddenTokens, pick: () => setShowHiddenTokens(false) }}
                b={{ label: 'Show', on: showHiddenTokens, pick: () => setShowHiddenTokens(true) }}
                note={
                  showHiddenTokens
                    ? 'Showing them without unhiding them. The list is untouched.'
                    : `${count} token${count === 1 ? '' : 's'} kept off the board.`
                }
              />
              <Choice
                label="On migration"
                a={{ label: 'Keep hidden', on: !unhideOnMigration, pick: () => setUnhideOnMigration(false) }}
                b={{ label: 'Unhide', on: unhideOnMigration, pick: () => setUnhideOnMigration(true) }}
                note="Most hides happen in the first minutes. Graduating is what makes that call stale."
              />
            </div>,
            host,
          )
        : null}
    </>
  );
}

function Choice({
  label,
  a,
  b,
  note,
}: {
  label: string;
  a: { label: string; on: boolean; pick: () => void };
  b: { label: string; on: boolean; pick: () => void };
  note: string;
}) {
  return (
    <div className="htm-choice">
      <div className="htm-row">
        <span className="htm-label">{label}</span>
        <span className="df-seg">
          {[a, b].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={opt.on}
              className={`df-segbtn${opt.on ? ' is-on' : ''}`}
              onClick={opt.pick}
            >
              {opt.label}
            </button>
          ))}
        </span>
      </div>
      <p className="htm-note">{note}</p>
    </div>
  );
}

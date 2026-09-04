'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FeePanelBody } from './FeePanel';
import type { FeeAuthority } from './rowData';

/*
 * ── THE FEE PANEL, OUT OF THE SCROLLER ───────────────────────────────
 *
 * It used to be a child of the mark that opens it, positioned absolutely
 * and shown on `:hover`. That works on the sheet and cannot work in the
 * product: the mark lives inside `.cl-list`, which is `overflow: auto`
 * AND a size container, with four more clipping ancestors above it. A
 * panel taller than the row was simply cut off — and scrolled with the
 * list while it was open.
 *
 * So it is PORTALLED to the body and positioned `fixed`. Nothing in the
 * column's overflow chain can clip it.
 *
 * ── AND IT DOES NOT CLOSE WHILE YOU REACH FOR IT ─────────────────────
 *
 * A CSS-only hover panel closes the instant the pointer leaves the mark,
 * which includes the moment you start moving toward the panel. Three
 * things stop that here:
 *
 *   · the panel is a hover target too, so being on it keeps it open
 *   · closing is DELAYED, so crossing the gap does not count as leaving
 *   · the gap is bridged by the panel's own top padding rather than a
 *     margin, so there is no dead strip between the two
 *
 * ── THE BOARD IS ZOOMED ──────────────────────────────────────────────
 *
 * The root carries `zoom: 1.18`. `getBoundingClientRect` reports post
 * zoom pixels, and the portal lands inside that same zoomed root — so
 * the coordinates have to be divided back out or the panel drifts
 * further from its mark the further down the page it is.
 */

const CLOSE_DELAY = 220;

export function FeePopover({
  auth,
  className,
  label,
  children,
}: {
  auth: FeeAuthority;
  className: string;
  label: string;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const floatRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const open = useCallback(() => {
    clear();
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    /* Anchored by its RIGHT edge to the mark's right edge, opening
       leftwards: these marks sit near the end of the line and a 264px
       panel centred on a 15px mark hangs off the column. */
    setAt({ left: r.right / zoom, top: r.top / zoom });
  }, []);

  const close = () => {
    clear();
    timer.current = window.setTimeout(() => setAt(null), CLOSE_DELAY);
  };

  useEffect(() => clear, []);

  /*
   * ── KEEP IT ON SCREEN ────────────────────────────────────────────
   *
   * The panel is anchored by its bottom right to the mark's top right
   * and opens up and to the LEFT, which is correct while there is room
   * — but these marks sit part way along the row, and on the left hand
   * column the panel ran off the edge of the window entirely.
   *
   * So after it mounts, its real box is measured and pushed back inside
   * with an 8px margin. It has to happen in a LAYOUT effect: painting
   * it off screen and correcting on the next frame is a visible jump.
   */
  useLayoutEffect(() => {
    const el = floatRef.current;
    if (!at || !el) return;
    const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    let dy = 0;
    if (r.left < pad) dx = (pad - r.left) / zoom;
    else if (r.right > window.innerWidth - pad) dx = (window.innerWidth - pad - r.right) / zoom;
    if (r.top < pad) dy = (pad - r.top) / zoom;
    else if (r.bottom > window.innerHeight - pad) dy = (window.innerHeight - pad - r.bottom) / zoom;
    if (dx || dy) setAt((p) => (p ? { left: p.left + dx, top: p.top + dy } : p));
  }, [at]);

  /* A scroll or a resize moves the mark and the panel cannot follow a
     fixed position it was given once — so it closes rather than sitting
     somewhere wrong. */
  useEffect(() => {
    if (!at) return;
    const drop = () => setAt(null);
    window.addEventListener('scroll', drop, true);
    window.addEventListener('resize', drop);
    return () => {
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('resize', drop);
    };
  }, [at]);

  return (
    <>
      <span
        ref={hostRef}
        className={className}
        aria-label={label}
        onPointerEnter={open}
        onPointerLeave={close}
      >
        {children}
      </span>
      {at && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={floatRef}
              className="fp-float"
              style={{ left: at.left, top: at.top }}
              onPointerEnter={clear}
              onPointerLeave={close}
              role="dialog"
              aria-label="Fee authority"
            >
              <span className="fp">
                <FeePanelBody auth={auth} />
              </span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

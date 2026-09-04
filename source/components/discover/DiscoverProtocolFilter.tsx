'use client';

/**
 * THE PER LANE LAUNCHPAD FILTER.
 *
 * The launchpad chips out of the filters panel, put in a lane's own
 * header so one lane can be narrowed without opening the panel and
 * without touching the other two. It writes to the same per-section
 * `protocols` filter the panel does, so the two are one setting seen from
 * two places and can never disagree.
 *
 * WHAT THE BUTTON SAYS. Everything on reads `LAUNCHPADS`, because a
 * control that is not narrowing anything should not look like it is.
 * Narrowed, it shows the marks of what you kept, up to four, then a count
 * — the marks are the fastest read, and the count covers the case where
 * there are more of them than fit.
 *
 * WHITE, NOT ACCENT. `DiscoverFiltersButton` beside it goes accent when
 * active. This one goes white, because it shares its chips with the
 * filters panel, and on every surface those chips appear on, selection is
 * stated in white.
 *
 * THE POPOVER IS PORTALLED, and it has to be. Every lane section is
 * `relative z-[1]`, which makes each one its own stacking context, so a
 * popover rendered inside the New Pairs header is sealed into New Pairs:
 * its `z-index` counts only against that lane's own contents, and the
 * Ripening and Graduated sections, being later siblings at the same
 * level, paint straight over the top of it. No z-index on the popover can
 * win that, because it is not in the same contest. It goes to
 * `.listen-root` instead, which is where every theme token is declared —
 * portalling to `document.body` would render it outside the theme
 * cascade and lock it to the fallback palette.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDiscoverStore } from '@/lib/state/discover-store';
import type { DiscoverSectionId } from './discoverFilters';
import { LAUNCHPADS } from './launchpads';

import '@/components/settings/discover-filters-v2.css';
import './discover-protocol-filter.css';

/** Past four the marks stop being readable and start being texture. */
const MAX_MARKS = 4;

/** What it wants to be. Narrower screens get the screen minus 10 a side. */
const POP_WIDTH = 316;

const GRID_GLYPH = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z';

export function DiscoverProtocolFilter({
  section,
  dense = false,
}: {
  section: DiscoverSectionId;
  dense?: boolean;
}) {
  const filters = useDiscoverStore((s) => s.filters);
  const setFilterProtocol = useDiscoverStore((s) => s.setFilterProtocol);
  const setAllFilterProtocols = useDiscoverStore((s) => s.setAllFilterProtocols);

  const protocols = filters[section].protocols;
  const selected = LAUNCHPADS.filter((l) => protocols[l.key]);
  const allOn = selected.length === LAUNCHPADS.length;
  const noneOn = selected.length === 0;
  // Nothing selected constrains nothing (same rule the predicate applies),
  // so it is not a narrowed state and must not be drawn as one.
  const narrowed = !allOn && !noneOn;

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  /* Resolved after mount, which matches what the portal does before the
     client has one: nothing, rather than a hydration mismatch. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.listen-root') ?? document.body);
  }, []);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  /*
   * Positioned from the button's own rect, not absolutely inside the
   * header: the lane header lives in a scroller that clips its overflow,
   * and a popover opened inside it comes out cut in half.
   *
   * ── ONE COORDINATE SPACE ────────────────────────────────────────────
   *
   * The root carries a `zoom`, and that splits the numbers on this page
   * into two units. `getBoundingClientRect` reports ZOOMED pixels, while
   * `offsetWidth`, `clientWidth` and the `top`/`left` written back as
   * inline style are all in UNZOOMED layout pixels. Mixing them puts the
   * popover a little further off with every extra 100px down the page,
   * which is exactly the kind of bug that looks like a guess about
   * padding.
   *
   * So the rect is divided by the zoom on the way in, and everything
   * below is layout pixels: the same space the style is written in.
   * `clientWidth`/`clientHeight` are used for the viewport rather than
   * `innerWidth`/`innerHeight` for the same reason, and because embedded
   * webviews report the inner pair as zero while the host sizes them.
   */
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (btn === null) return;
    const root = document.documentElement;
    const zoom = Number.parseFloat(getComputedStyle(root).zoom);
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

    const r = btn.getBoundingClientRect();
    const btnTop = r.top / z;
    const btnBottom = r.bottom / z;
    const btnLeft = r.left / z;

    const vw = root.clientWidth;
    const vh = root.clientHeight;
    const below = btnBottom + 8;

    // A viewport that has not been measured yet: open below the button at
    // its natural width and height rather than clamp against a zero.
    if (vw <= 0 || vh <= 0) {
      setPos({ top: below, left: Math.max(10, btnLeft), width: 0, maxHeight: 0 });
      return;
    }

    // 10px each side on a phone, and never wider than it wants to be.
    const width = Math.min(POP_WIDTH, vw - 20);

    // Never taller than the screen. Fifteen chips fit on any normal one;
    // this is what keeps a short window from cutting the last row off.
    const maxHeight = Math.max(180, vh - 20);
    const height = Math.min(popRef.current?.offsetHeight ?? 320, maxHeight);
    const left = Math.min(Math.max(10, btnLeft), Math.max(10, vw - width - 10));
    // Below the button, flipping above when there is no room below and
    // there is above, then clamped so it lands on screen either way.
    const wants = below + height > vh - 10 && btnTop - 8 - height > 10
      ? btnTop - 8 - height
      : below;
    const top = Math.max(10, Math.min(wants, vh - height - 10));
    setPos({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) === true) return;
      if (btnRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // `true` on scroll: lane scrollers do not bubble their scroll events,
    // and a popover left behind by one is worse than one that follows.
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
  }, [open, place]);

  const label = narrowed ? `${selected.length} of ${LAUNCHPADS.length}` : 'Launchpads';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`dpf-btn${dense ? ' is-dense' : ''}${narrowed ? ' is-narrowed' : ''}${open ? ' is-open' : ''}`}
        aria-label={`Launchpads for this lane, ${narrowed ? `${selected.length} of ${LAUNCHPADS.length} selected` : 'all selected'}`}
        aria-expanded={open}
        title="Launchpads"
        onClick={() => setOpen((v) => !v)}
      >
        {/*
         * All three parts are always in the markup and the stylesheet
         * decides which of them show. A button whose contents depend on a
         * JS width reading cannot be right on the first paint, and this
         * one sits in a header that reflows.
         */}
        <svg className="dpf-glyph" viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" aria-hidden>
          <path d={GRID_GLYPH} />
        </svg>
        {narrowed ? (
          <span className="dpf-marks" aria-hidden>
            {selected.slice(0, MAX_MARKS).map((l) => (
              <img key={l.key} src={l.logo} alt="" width={13} height={13} loading="lazy" />
            ))}
          </span>
        ) : null}
        <span className="dpf-label">{label}</span>
      </button>

      {open && host !== null
        ? createPortal(
          <div
            ref={popRef}
            className="dpf-pop"
            role="dialog"
            aria-label="Launchpads for this lane"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              /* Zero means the viewport had not been measured; let the
                 stylesheet's own width and no cap stand. */
              width: pos?.width === 0 ? undefined : pos?.width,
              maxHeight: pos?.maxHeight === 0 ? undefined : pos?.maxHeight,
            }}
          >
            <div className="dpf-head">
              <span className="dpf-title">Launchpads</span>
              <button
                type="button"
                className="df-clear"
                /* When none are selected the press selects all, and vice
                   versa — so the value written IS `noneOn`, not its inverse. */
                onClick={() => setAllFilterProtocols(section, noneOn)}
              >
                {noneOn ? 'Select all' : 'Deselect all'}
              </button>
            </div>
            <div className="df-grid">
              {LAUNCHPADS.map((l) => {
                const on = protocols[l.key];
                return (
                  <button
                    key={l.key}
                    type="button"
                    className={`df-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setFilterProtocol(section, l.key, !on)}
                  >
                    <span className="df-mark">
                      <img src={l.logo} alt="" width={18} height={18} loading="lazy" />
                    </span>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>,
            host,
          )
        : null}
    </>
  );
}

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PositionsBar } from '@/components/positions/PositionsBar';
import { WatchlistBar } from '@/components/watchlist/WatchlistBar';
import './subheader-v2.css';

/**
 * Thin full-bleed strip directly under the top nav. Hosts EITHER the live
 * open-position tracker for the active wallet (image + ticker + amount +
 * PnL, click to trade) OR the user's watchlist (image + ticker + market cap
 * + 24h change), swapped by the two small toggle buttons. Height is
 * tokenized (`--h-subnav`) and carved out of `--h-app-content`.
 *
 * ── THE WALLET CLUSTER IS NOT HERE ──────────────────────────────────
 *
 * The cog, the group selector and the wallet selector used to be pinned
 * to the right of this line. Two things were competing for it: a tape
 * that wants every pixel it can get, and a cluster whose width is
 * whatever the wallet figures happen to be. The tape lost, which is why
 * it was the thing that got hidden on a narrow window. They live on
 * `AppPageBar` now, one line down.
 *
 * This line is the coins and nothing else. It was tried the other way
 * once more and put straight back: whatever is missing off Discover,
 * the answer is not parking wallets on the tape's row.
 *
 * ── THE MODE TOGGLE IS BACK ──────────────────────────────────────────
 *
 * It was removed for reading as "two dots rather than controls" at 11px
 * of glyph inside 18px, and the note left behind recorded the
 * consequence: the mode became whatever was in localStorage, nothing in
 * the UI wrote it, and a fresh profile was pinned to `positions` with the
 * watchlist strip unreachable.
 *
 * The fix was never removal — it was SIZE. They are 24px boxes with 14px
 * glyphs now, in the same white-plate-when-on language as the nav pills
 * and the footer toggles, and `writeStripMode` is back beside its reader.
 *
 * ── AND THE TAPE SCROLLS BY ARROW ────────────────────────────────────
 *
 * The tape is an overflow-x scroller. On a trackpad that is fine; on a
 * narrow window with no horizontal wheel it is a list with an invisible
 * tail. Two chevrons appear only when there IS overflow, matching the
 * caret on the pickers opposite them.
 */

type StripMode = 'positions' | 'watchlist';

const STRIP_MODE_KEY = 'subheader:strip-mode:v1';

function readStripMode(): StripMode {
  if (typeof window === 'undefined') return 'positions';
  try {
    return window.localStorage.getItem(STRIP_MODE_KEY) === 'watchlist' ? 'watchlist' : 'positions';
  } catch {
    return 'positions';
  }
}

function writeStripMode(mode: StripMode): void {
  try {
    window.localStorage.setItem(STRIP_MODE_KEY, mode);
  } catch {
    /* Private windows and blocked site data throw on write. The mode still
       applies for this session; it just does not survive a reload. */
  }
}

function ChartGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l5.5-6 4 4L21 6" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z" />
    </svg>
  );
}

function ScrollArrow({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      className="sub-arrow"
      data-dir={dir}
      onClick={onClick}
      aria-label={dir === 'left' ? 'Scroll tape left' : 'Scroll tape right'}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === 'left' ? 'M14.5 6L8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
      </svg>
    </button>
  );
}

export function AppSubHeader() {
  // Hydrate the persisted mode after mount — seeding useState from
  // localStorage desyncs the first client render from the server HTML.
  const [mode, setMode] = useState<StripMode>('positions');
  useEffect(() => {
    setMode(readStripMode());
  }, []);

  const pick = useCallback((next: StripMode) => {
    setMode(next);
    writeStripMode(next);
  }, []);

  /*
   * The scroller belongs to `PositionsBar` / `WatchlistBar`, not to this
   * file, so it is reached through the wrapper by the class both of them
   * put on it. Reading it rather than owning it keeps the arrows out of
   * two components that have nothing else in common.
   */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const measure = useCallback(() => {
    const scroller = wrapRef.current?.querySelector<HTMLElement>('.scroll-hide');
    if (!scroller) {
      setOverflow({ left: false, right: false });
      return;
    }
    const max = scroller.scrollWidth - scroller.clientWidth;
    setOverflow({
      left: scroller.scrollLeft > 2,
      // 2px of slack: sub-pixel layout leaves a permanent 0.5px of "overflow"
      // on plenty of widths, which would pin the right arrow on forever.
      right: max > 2 && scroller.scrollLeft < max - 2,
    });
  }, []);

  /*
   * The observers watch the WRAPPER, not the scroller.
   *
   * `PositionsBar` returns null until its first SSE frame lands, so on the
   * first layout pass there is no `.scroll-hide` to observe at all. An
   * earlier cut bound to the scroller and bailed when it was missing —
   * and since the deps never changed again, nothing re-measured when the
   * positions actually arrived, so the arrows never appeared no matter how
   * far the tape overflowed.
   *
   * The wrapper is always mounted. `scroll` has to be caught in the
   * CAPTURE phase because scroll does not bubble.
   */
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    measure();
    wrap.addEventListener('scroll', measure, { passive: true, capture: true });
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    // The tape's CONTENT changes without a resize — a position opens, a
    // price ticks a chip wider — and this is also what catches the
    // scroller appearing in the first place.
    const mo = new MutationObserver(measure);
    mo.observe(wrap, { childList: true, subtree: true });
    return () => {
      wrap.removeEventListener('scroll', measure, { capture: true });
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure, mode]);

  const nudge = useCallback(
    (dir: 'left' | 'right') => {
      const scroller = wrapRef.current?.querySelector<HTMLElement>('.scroll-hide');
      if (!scroller) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const from = scroller.scrollLeft;

      /*
       * ── ONE CHIP AT A TIME ON A NARROW STRIP ─────────────────────
       *
       * Wide, a press moves most of a screenful: there are several chips
       * in view, so landing on a new set of them is the useful move.
       *
       * Narrow, roughly one chip IS the screenful, so the same rule
       * threw the one you were reading off the edge and brought an
       * unknown one in — a press moved you somewhere without showing you
       * the way. Below 560 the step is the next chip boundary instead,
       * so an arrow advances the tape by exactly one position and the
       * chip you just looked at is still the one beside it.
       *
       * Measured off the chips rather than assumed: they are not a fixed
       * width — a ticker is three characters or six, and the figure and
       * PnL either side of it vary with the number — so a constant step
       * would drift out of alignment within a few presses.
       */
      const oneChip = window.matchMedia('(max-width: 560px)').matches;

      let to: number;
      if (oneChip) {
        const base = scroller.getBoundingClientRect().left - from;
        const edges = Array.from(scroller.children, (chip) =>
          Math.round(chip.getBoundingClientRect().left - base),
        );
        // 1px of slack: sub-pixel positions mean an edge can sit a
        // fraction off the current offset and read as "already there",
        // which would make a press do nothing.
        to =
          dir === 'right'
            ? (edges.find((edge) => edge > from + 1) ?? max)
            : ([...edges].reverse().find((edge) => edge < from - 1) ?? 0);
      } else {
        // Most of a screenful, so a press always lands somewhere new but
        // never skips a chip clean over.
        const step = Math.max(120, scroller.clientWidth * 0.8);
        to = dir === 'left' ? from - step : from + step;
      }

      to = Math.max(0, Math.min(max, to));
      if (to === from) return;

      /*
       * THE TWEEN IS OURS, ON rAF.
       *
       * Two browser-provided paths were tried first and both did nothing
       * in an embedded webview: `scrollBy({behavior:'smooth'})` returned
       * without moving, and a plain `scrollLeft` assignment under CSS
       * `scroll-behavior: smooth` left the scroller sitting at zero. The
       * element scrolls perfectly well when written to directly — it is
       * only the smooth path that is missing.
       *
       * So the animation is done here, where nothing can switch it off,
       * and `measure` runs on every frame, which also removes the timer
       * that used to guess when the scroll had finished.
       */
      const started = performance.now();
      const DURATION = 260;
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / DURATION);
        // easeOutCubic: leaves fast, arrives gently.
        const eased = 1 - (1 - t) ** 3;
        scroller.scrollLeft = from + (to - from) * eased;
        measure();
        if (t < 1) window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    },
    [measure],
  );

  return (
    <div
      data-subheader-v2=""
      /*
        FLUSH, LIKE THE BOARD UNDER IT.

        This was `px-3 sm:px-6` — 12px rising to 24 — from when the
        Discover board carried the same inset, which put the first
        control 24px inboard of the first card directly beneath it.

        5px, not 0. Flush put the mode button hard against the window
        edge with nothing between the glyph and the bezel, which reads as
        clipped rather than as aligned.

        Narrow screens keep 8px, set in `subheader-v2.css`: a control
        against the bezel is a mis-tap on a phone in a way it is not
        under a cursor.
      */
      className="relative z-20 flex h-[var(--h-subnav)] w-full shrink-0 items-center gap-2 px-[15px]"
      style={{
        /* Same as the nav above: no ground, no divider, no blur — the
           header sits directly on the black page. */
        background: 'transparent',
      }}
    >
      <div className="sub-mode" data-no-drag>
        <button
          type="button"
          className="sub-modebtn"
          data-on={mode === 'positions' ? 'true' : 'false'}
          onClick={() => pick('positions')}
          aria-label="Open positions"
          aria-pressed={mode === 'positions'}
        >
          <ChartGlyph />
        </button>
        <button
          type="button"
          className="sub-modebtn"
          data-on={mode === 'watchlist' ? 'true' : 'false'}
          onClick={() => pick('watchlist')}
          aria-label="Watchlist"
          aria-pressed={mode === 'watchlist'}
        >
          <StarGlyph />
        </button>
      </div>

      {overflow.left ? <ScrollArrow dir="left" onClick={() => nudge('left')} /> : null}

      <div ref={wrapRef} className="flex min-w-0 flex-1 items-center">
        {mode === 'positions' ? <PositionsBar /> : <WatchlistBar />}
      </div>

      {overflow.right ? <ScrollArrow dir="right" onClick={() => nudge('right')} /> : null}

    </div>
  );
}

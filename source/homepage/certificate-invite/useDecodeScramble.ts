'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * The decode scramble — the brand's cryptography motion.
 *
 * The cipher pool and the styling come from the creator-pass modal's
 * ghost row (`homepage/creator-pass-modal/CreatorPassModal.tsx`), the
 * last surviving copy of the motion now that the old HomeHero is gone.
 * The CHOREOGRAPHY here is deliberately not the same, and it has been
 * rebuilt twice:
 *
 *   v1 — that row's synchronized left→right reveal wave. Read as a sweep.
 *   v2 — one independent timeout chain per cell, slow cadence. Read as
 *        an aimless murmur: no two cells ever agreed on anything.
 *   v3 — A COLLECTIVE BREATH, and the model to keep. ONE scheduler drives
 *        the whole row: every eligible cell flutters at once for
 *        `BURST_MS`, all settle back to their resting glyphs together,
 *        the row rests in total stillness for `REST_MS`, then bursts
 *        again. Chaos in unison ↔ rest in unison.
 *
 * The two things that keep it from reading mechanical:
 *
 *   - Inside the shared window each cell runs its OWN glyph clock
 *     (`GLYPH_TICK_MIN_MS`–`GLYPH_TICK_MAX_MS`, re-rolled every tick), so
 *     the flutter never strobes in lockstep even though the window is
 *     shared.
 *   - The settle carries up to `SETTLE_JITTER_MS` of per-cell slop, drawn
 *     fresh per cell per burst and NEVER derived from the cell's index —
 *     so the row relaxes organically with no direction to read.
 *
 * A cell participates only while its span reads as an unfilled, non-calm,
 * non-socket ghost (see `eligible`). Those three attributes are owned by
 * React, so typing, the advancing socket and the calm group all steer the
 * motion without this hook knowing anything about the code state.
 *
 * Timers: during a burst, one pending timeout per fluttering cell; during
 * the rest, exactly one — the next-burst wake-up. Nothing else is ever
 * pending. Both hooks mutate `textContent` through refs rather than
 * re-rendering per frame, the same idiom as the sources. CSS only styles
 * the `[data-decoding]` state; the loop is imperative.
 */

/** The cipher pool. Identical to CreatorPassModal's GHOST_GLYPHS. */
export const DECODE_GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=<>?';

/* ── The breath, in numbers ────────────────────────────────────────────
   Tuned by feel — these five are the dials. Read them as one sentence:
   a beat after the modal lands, the row flutters fast for BURST_MS,
   relaxes together within SETTLE_JITTER_MS, holds still for REST_MS, and
   goes again. Faster = drop BURST_MS and the tick band; calmer = raise
   REST_MS. One full cycle is BURST_MS + SETTLE_JITTER_MS + REST_MS. */

/** Mount → the first burst, so the modal's entrance owns the frame alone. */
export const MOUNT_DELAY_MS = 1000;
/** How long the whole row scrambles, per burst. */
export const BURST_MS = 1200;
/** Total stillness between bursts, measured from the last cell's settle. */
export const REST_MS = 3200;
/** Cipher cadence inside a burst — re-rolled per cell per tick. */
export const GLYPH_TICK_MIN_MS = 45;
export const GLYPH_TICK_MAX_MS = 65;
/** Per-cell slop on the settle. Organic, not sequential — never index-derived. */
export const SETTLE_JITTER_MS = 80;

/** Mount → the mono support lines' one-shot decode. Independent of the row. */
export const DECODE_FIRST_MS = 1200;
/** The mono support lines' one-shot decode. */
export const LINE_DECODE_MS = 1100;

function between(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomGlyph() {
  return DECODE_GLYPHS[Math.floor(Math.random() * DECODE_GLYPHS.length)] ?? '';
}

/** Reduced motion and a hidden tab both mean: do not start a burst. */
function motionBlocked() {
  if (typeof window === 'undefined') return true;
  if (document.hidden) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ */
/* The serial row's ghost slots                                         */
/* ------------------------------------------------------------------ */

/**
 * A cell scrambles only while it is unfilled (`data-ghost`), outside the
 * calm group (`data-calm`) and not the active socket (`data-socket`).
 * Read fresh on every tick, so a cell that is typed into — or that the
 * socket advances onto — drops out mid-burst.
 */
function eligible(span: HTMLSpanElement) {
  return (
    span.dataset.ghost === 'true' &&
    span.dataset.calm !== 'true' &&
    span.dataset.socket !== 'true'
  );
}

/**
 * Runs the row's single collective scramble cycle.
 *
 * Returns `burstNow` for the one place the product interrupts the rhythm:
 * focusing the input fires an extra collective burst, after which the
 * cycle resumes from a fresh rest.
 */
export function useGhostDecode({
  enabled,
  length,
  resting,
}: {
  enabled: boolean;
  length: number;
  resting: string;
}) {
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  /** One per fluttering cell, alive only inside a burst. */
  const cellTimers = useRef<Array<ReturnType<typeof setTimeout> | null>>([]);
  /** The single scheduler timer: the next burst's wake-up. */
  const cycleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Before this, the entrance is still playing and a burst is refused. */
  const armedAt = useRef(0);
  /** Set by the effect below; focus and the test hook trigger through it. */
  const trigger = useRef<() => void>(() => {});

  const registerGhost = useCallback((index: number, el: HTMLSpanElement | null) => {
    els.current[index] = el;
  }, []);

  const burstNow = useCallback(() => trigger.current(), []);

  useEffect(() => {
    const clearCell = (index: number) => {
      const timer = cellTimers.current[index];
      if (timer !== null && timer !== undefined) clearTimeout(timer);
      cellTimers.current[index] = null;
    };

    const clearCells = () => {
      for (let index = 0; index < length; index += 1) clearCell(index);
    };

    const clearCycle = () => {
      if (cycleTimer.current !== null) clearTimeout(cycleTimer.current);
      cycleTimer.current = null;
    };

    /** Drop the cipher styling, and hand a still-eligible cell its glyph
        back. An ineligible cell's text belongs to React — a socket wants
        no glyph and a typed cell wants its character. The equality guard
        keeps a settle that has nothing to undo from touching the DOM at
        all: reduced motion resolves after first paint and tears the whole
        cycle down, and that teardown must not write a single node. */
    const settle = (index: number, span: HTMLSpanElement) => {
      delete span.dataset.decoding;
      if (!eligible(span)) return;
      const glyph = resting[index] ?? '';
      if (span.textContent !== glyph) span.textContent = glyph;
    };

    const settleAll = () => {
      for (let index = 0; index < length; index += 1) {
        const span = els.current[index];
        if (span) settle(index, span);
      }
    };

    /** One collective burst. Every eligible cell starts fluttering on this
        same frame and stops within the jitter of the same deadline; a cell
        that is ineligible right now simply sits this burst out. */
    const burst = () => {
      clearCells();
      const end = performance.now() + BURST_MS;
      for (let index = 0; index < length; index += 1) {
        const span = els.current[index];
        if (!span || !eligible(span)) continue;
        const until = end + Math.random() * SETTLE_JITTER_MS;
        const tick = () => {
          const el = els.current[index];
          if (!el) {
            cellTimers.current[index] = null;
            return;
          }
          // Typed into, or the socket advanced onto it, mid-burst: drop out
          // and leave the text to React. No rescheduling — the chain ends.
          if (!eligible(el)) {
            delete el.dataset.decoding;
            cellTimers.current[index] = null;
            return;
          }
          if (performance.now() >= until) {
            settle(index, el);
            cellTimers.current[index] = null;
            return;
          }
          el.textContent = randomGlyph();
          el.dataset.decoding = 'true';
          cellTimers.current[index] = setTimeout(tick, between(GLYPH_TICK_MIN_MS, GLYPH_TICK_MAX_MS));
        };
        tick();
      }
    };

    /** The full cycle length: flutter, the slowest settle, then stillness. */
    const cycleMs = BURST_MS + SETTLE_JITTER_MS + REST_MS;

    const cycle = () => {
      clearCycle();
      // Blocked mid-run (tab hidden): stop dead and leave the row resting.
      // `onVisibility` owns the restart, so nothing stays pending.
      if (motionBlocked()) {
        clearCells();
        settleAll();
        return;
      }
      burst();
      cycleTimer.current = setTimeout(cycle, cycleMs);
    };

    const start = () => {
      clearCycle();
      clearCells();
      armedAt.current = performance.now() + MOUNT_DELAY_MS;
      cycleTimer.current = setTimeout(cycle, MOUNT_DELAY_MS);
    };

    /* One extra collective burst, out of band, then back on cycle from a
       fresh rest. Refused while the entrance is still playing — the modal
       auto-focuses the field ~120ms after opening, and that must not
       pre-empt the mount delay. */
    trigger.current = () => {
      if (!enabled || motionBlocked()) return;
      if (performance.now() < armedAt.current) return;
      clearCycle();
      burst();
      cycleTimer.current = setTimeout(cycle, cycleMs);
    };

    if (enabled) start();

    const onVisibility = () => {
      if (!enabled) return;
      if (document.hidden) {
        clearCycle();
        clearCells();
        settleAll();
      } else {
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearCycle();
      clearCells();
      settleAll();
    };
  }, [enabled, length, resting]);

  // Deterministic test hook, same precedent as the source's __cpOwl:
  // one collective burst on demand.
  useEffect(() => {
    const w = window as unknown as { __ciGhostDecode?: () => void };
    w.__ciGhostDecode = () => trigger.current();
    return () => {
      delete w.__ciGhostDecode;
    };
  }, []);

  return { registerGhost, burstNow };
}

/* ------------------------------------------------------------------ */
/* One-shot line decode                                                 */
/* ------------------------------------------------------------------ */

/**
 * Decodes a fixed line of text once, `delayMs` after it becomes enabled,
 * then leaves it permanently at rest — no idle loop. Whitespace never
 * scrambles, and the mono face keeps every cipher glyph
 * the same advance width, so nothing reflows.
 *
 * The caller still renders the real text as a JSX child; this only
 * borrows the node for the length of the pass, so SSR and a JS-less
 * render both show the resting line.
 */
export function useTextDecode(text: string, enabled: boolean, delayMs: number) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let raf: number | null = null;
    const chars = text.split('');

    const start = () => {
      if (motionBlocked()) return;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - t0) / LINE_DECODE_MS, 1);
        const revealed = Math.ceil(p * chars.length);
        if (p < 1) {
          el.textContent = chars
            .map((ch, i) => (ch === ' ' || i < revealed ? ch : randomGlyph()))
            .join('');
          el.dataset.decoding = 'true';
          raf = requestAnimationFrame(tick);
        } else {
          raf = null;
          el.textContent = text;
          delete el.dataset.decoding;
        }
      };
      raf = requestAnimationFrame(tick);
    };

    const timer = setTimeout(start, delayMs);
    return () => {
      clearTimeout(timer);
      if (raf !== null) cancelAnimationFrame(raf);
      el.textContent = text;
      delete el.dataset.decoding;
    };
  }, [delayMs, enabled, text]);

  return ref;
}

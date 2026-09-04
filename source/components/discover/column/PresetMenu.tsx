'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * THE PRESET MENU — what `P1` in the column head opens.
 *
 * Three presets, each a row of the four settings that actually differ
 * between them: the buy size, the sell size, the slippage, and whether
 * MEV protection is on. Picking one closes the menu and re-labels the
 * button.
 *
 * ── WHY THE VALUES ARE ON THE ROW ────────────────────────────────────
 *
 * A menu of "P1 / P2 / P3" is three names with nothing to choose
 * between: the whole reason you open it is to remember which preset is
 * the fast one. Printing all four settings on the row makes the choice
 * readable without a second click, and it is why the row is wide.
 *
 * ── IT HAS TO BE A PORTAL ────────────────────────────────────────────
 *
 * The button sits inside `.cl-tools`, which is `overflow: hidden` so the
 * group's rounded corners clip its buttons, and that group sits inside
 * `.cl`, which is `overflow: hidden` so the list scrolls inside the
 * column. An absolutely positioned menu is clipped by BOTH — it opened
 * and was invisible.
 *
 * So it renders into `document.body` and is positioned from the
 * button's own rect. The `zoom: 1.18` on <html> is divided out: a rect
 * is measured in zoomed pixels and a fixed offset is applied in CSS
 * pixels before the zoom multiplies it, so passing the rect straight
 * through would land the menu 18% too far down and right.
 *
 * ── NOT WIRED TO THE TRADE STORE ─────────────────────────────────────
 *
 * The values are local state seeded from a constant. Picking a preset
 * changes the label and nothing else — no order is sized by this yet.
 * That is deliberate and visible rather than faked: the real quick buy
 * settings live in `lib/state/trade-store`, and pointing this at them is
 * its own change with its own blast radius.
 */

export interface Preset {
  readonly id: string;
  readonly buy: string;
  readonly sell: string;
  readonly slippage: string;
  readonly mev: boolean;
}

export const PRESETS: readonly Preset[] = [
  { id: 'P1', buy: '0.001', sell: '0.01', slippage: '20%', mev: true },
  { id: 'P2', buy: '0.002', sell: '0.02', slippage: '20%', mev: true },
  { id: 'P3', buy: '0.003', sell: '0.03', slippage: '20%', mev: true },
];

function Glyph({ d, size = 11 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/* One mark per setting, so a row reads as four facts rather than four
   numbers you have to count positions to identify. */
const M = {
  buy: 'M4 7h13l-1.5 9h-10zM8 7V5.5a4 4 0 018 0V7M4 7 2.5 4',
  sell: 'M3 12a9 4 0 1018 0 9 4 0 10-18 0M3 12v5c0 2.2 4 4 9 4s9-1.8 9-4v-5',
  slip: 'M6 20c1.5-4 3-6 6-7M12 13l3.5-4M8 9l3 2M15.5 5.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2M18 15l2 5',
  mev: 'M12 3l7 3v5.5c0 4.2-3 7.6-7 8.5-4-.9-7-4.3-7-8.5V6z',
  chart: 'M3 17l5.5-6 4 4L21 6M21 6h-4.5M21 6v4.5',
} as const;

export function PresetMenu() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(PRESETS[0].id);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /*
   * Hang the menu under the button's bottom right corner.
   *
   * `right` rather than `left`: the menu is wider than the button and the
   * button sits in a cluster at the right of the head, so anchoring the
   * left edge would push it off the column.
   */
  const place = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const zoom = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
    ) || 1;
    const r = el.getBoundingClientRect();
    setAt({
      top: r.bottom / zoom + 6,
      right: (window.innerWidth - r.right) / zoom,
    });
  }, []);

  /* Measure before paint, so the menu never shows at 0,0 for a frame. */
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  /* A scroll or a resize moves the button out from under it. Nothing
     re-measures on its own, so close instead of chasing. */
  useEffect(() => {
    if (!open) return;
    const shut = () => setOpen(false);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open]);

  /*
   * Close on an outside press and on Escape.
   *
   * `pointerdown`, not `click`: a click fires after the press completes,
   * so a press that starts outside and drags onto the menu would close
   * it under the cursor. Bound while OPEN only — a listener per column
   * standing on the document for the whole session is three listeners
   * this board does not need.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      /* The menu is portalled, so it is NOT inside `wrap` in the DOM —
         both have to be tested or the first click inside the menu
         closes it. */
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="cl-presetwrap" ref={wrap}>
      <button
        type="button"
        className="cl-tool"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {active}
        <Glyph d={M.chart} size={13} />
      </button>

      {open && at
        ? createPortal(
            <div
              className="cl-presets"
              id={menuId}
              role="menu"
              ref={menu}
              style={{ top: at.top, right: at.right }}
            >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === active}
              className="cl-preset"
              data-on={p.id === active}
              onClick={() => {
                setActive(p.id);
                setOpen(false);
              }}
            >
              <span className="cl-preset-id">{p.id}</span>
              <span className="cl-preset-cell" title={`Buy ${p.buy} SOL`}>
                <Glyph d={M.buy} size={11} />
                {p.buy}
              </span>
              <span className="cl-preset-cell" title={`Sell ${p.sell} SOL`}>
                <Glyph d={M.sell} size={11} />
                {p.sell}
              </span>
              <span className="cl-preset-cell" title={`Slippage ${p.slippage}`}>
                <Glyph d={M.slip} size={11} />
                {p.slippage}
              </span>
              <span className="cl-preset-cell" title="MEV protection">
                <Glyph d={M.mev} size={11} />
                {p.mev ? 'On' : 'Off'}
              </span>
            </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

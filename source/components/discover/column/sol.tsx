import { useId } from 'react';
/*
 * ── THE SOLANA MARK ──────────────────────────────────────────────────
 *
 * The three bars and the gradient behind them, in one place.
 *
 * ── WHY THE GRADIENT IS SEPARATE FROM THE MARK ───────────────────────
 *
 * An SVG `fill: url(#id)` resolves against the DOCUMENT, not against the
 * element — so the mark paints nothing at all unless a matching `<defs>`
 * is somewhere on the page. That is a real trap and it has already been
 * hit once here: the definition used to live in the sandbox column's
 * wrapper, and every SOL mark outside that wrapper rendered invisible.
 *
 * So the two are exported as a pair. `<SolDefs />` goes once per surface
 * that shows the mark — a column, the trade header — and `<SolMark />`
 * can then appear as many times as it likes. One definition serves all
 * of them, because they share the id.
 */

/** The gradient's id, shared by every instance of the mark. */
export const SOL_GRADIENT = 'arc-sol';

/**
 * The gradient definition. Renders nothing visible; mount it ONCE per
 * surface that draws `<SolMark />`. Mounting it twice is harmless — the
 * ids collide and the first wins, and both are identical.
 */
export function SolDefs() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id={SOL_GRADIENT} x1="1.78" y1="13.33" x2="13.97" y2="1.14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="0.24" stopColor="#8752F3" />
          <stop offset="0.465" stopColor="#5497D5" />
          <stop offset="0.6" stopColor="#43B4CA" />
          <stop offset="0.735" stopColor="#28E0B9" />
          <stop offset="1" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Solana's own mark, at whatever size the surface wants. The path is the
 * real logo rather than a drawing of it — three parallelograms, not
 * three chevrons — and it paints with the brand gradient, so it is the
 * one mark in this product that is not `currentColor`.
 */
export function SolMark({ size = 10.5 }: { size?: number }) {
  /*
   * ── THE MARK CARRIES ITS OWN GRADIENT ────────────────────────────
   *
   * It used to paint with a document wide `url(#arc-sol)` and rely on
   * `<SolDefs/>` being mounted once per surface. That contract cannot
   * hold in this app: route panes STAY MOUNTED under `display:none`, and
   * Chromium resolves `url(#id)` to the first matching definition it
   * finds — so once the Discover column had been visited, every mark on
   * every other surface pointed at a definition inside a hidden subtree
   * and painted nothing at all. The marks on the trade panel were simply
   * absent.
   *
   * A per instance id cannot collide with a hidden one. It is the same
   * fix `Icons.tsx` already carries for its own Solana glyph, and the
   * cost is six gradient stops per mark, which is nothing next to a logo
   * that is not there.
   */
  const id = `sol-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="1.78" y1="13.33" x2="13.97" y2="1.14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="0.24" stopColor="#8752F3" />
          <stop offset="0.465" stopColor="#5497D5" />
          <stop offset="0.6" stopColor="#43B4CA" />
          <stop offset="0.735" stopColor="#28E0B9" />
          <stop offset="1" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.44955 6.75999H12.0395C12.1595 6.75999 12.2695 6.80999 12.3595 6.89999L13.8795 8.45999C14.1595 8.74999 13.9595 9.23999 13.5595 9.23999H3.96955C3.84955 9.23999 3.73955 9.18999 3.64955 9.09999L2.12955 7.53999C1.84955 7.24999 2.04955 6.75999 2.44955 6.75999ZM2.12955 4.68999L3.64955 3.12999C3.72955 3.03999 3.84955 2.98999 3.96955 2.98999H13.5495C13.9495 2.98999 14.1495 3.47999 13.8695 3.76999L12.3595 5.32999C12.2795 5.41999 12.1595 5.46999 12.0395 5.46999H2.44955C2.04955 5.46999 1.84955 4.97999 2.12955 4.68999ZM13.8695 11.3L12.3495 12.86C12.2595 12.95 12.1495 13 12.0295 13H2.44955C2.04955 13 1.84955 12.51 2.12955 12.22L3.64955 10.66C3.72955 10.57 3.84955 10.52 3.96955 10.52H13.5495C13.9495 10.52 14.1495 11.01 13.8695 11.3Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

import type { CSSProperties, ReactElement } from 'react';

/**
 * The landing hero, parked.
 *
 * ── WHAT IS HERE ─────────────────────────────────────────────────────
 *
 * An empty band at the hero's exact height and nothing else. It holds the
 * space so every band under it still lands where it will land while the
 * hero itself is being decided.
 *
 * ── NOTHING IS DELETED ───────────────────────────────────────────────
 *
 * Four finished versions of this band are on disk, all working:
 *
 *   `hero/HeroSplit.tsx`  the split: copy on paper in the left half with
 *                         registration ticks, and a conditional running on
 *                         an ink panel in the right. Needs `split.css`.
 *                         This is the one that was mounted here last.
 *   `hero/HeroSaid.tsx`   the sentence made exact: your words, with the
 *                         vague parts taking a rule one at a time and what
 *                         each became named underneath. Needs `hero.css`.
 *   `hero/HeroRun.tsx`    the conditional playing out act by act, with the
 *                         market only climbing during the watch.
 *   `hero/Panels.tsx`     the panels ground, which HeroSaid or HeroRun can
 *                         hang in. Mounted by the component, not here.
 *
 * Restoring any of them is one import: swap the export below for
 * `export { HeroSplit as Hero } from './hero/HeroSplit';`.
 *
 * ── WHY THE HEIGHT IS WRITTEN THE WAY IT IS ──────────────────────────
 *
 * `clamp(720px, 92vh, 940px)` is the band's own measurement, kept to the
 * pixel. A parked band that is merely about right moves every band under
 * it and makes the page it is meant to let you read a different page.
 */

const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
} as CSSProperties;

export function Hero(): ReactElement {
  return (
    <section
      id="hero"
      style={LIGHT}
      className="relative isolate flex min-h-[clamp(720px,92vh,940px)] w-full items-center bg-lp-ground"
    >
      {/* The floor is a full bleed rule: it is what stops this band and the
          one under it reading as one continuous white. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-lp-hairline" />
    </section>
  );
}

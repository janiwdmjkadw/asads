import type { CSSProperties, ReactElement } from 'react';

/**
 * The landing hero, parked.
 *
 * ── WHAT IS HERE AND WHAT IS NOT ─────────────────────────────────────
 *
 * An empty band at the hero's exact height, and nothing else. No type, no
 * ground, no motion. It is deliberate: the page is being read for its
 * shape right now, and the band holds the space so everything below it
 * still lands where it will land.
 *
 * ── THE RUN IS NOT DELETED ───────────────────────────────────────────
 *
 * The version this replaced — the conditional playing out act by act,
 * with the market only climbing during the watch — is intact in
 * `hero/HeroRun.tsx`. Restoring it is one import: swap the export below
 * for `export { HeroRun as Hero } from './hero/HeroRun';`.
 *
 * The panels ground it hung in is likewise intact in `hero/Panels.tsx`,
 * and is mounted by that component rather than by this one.
 *
 * ── WHY THE HEIGHT IS WRITTEN THE WAY IT IS ──────────────────────────
 *
 * `clamp(720px, 92vh, 940px)` is the run's own measurement, kept to the
 * pixel. A parked band that is merely "about right" moves every band
 * under it and makes the page it is meant to let you read a different
 * page.
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
      {/* The floor is a full bleed rule, as it was: it is the line that
          stops this band and the one under it reading as one continuous
          white nothing, which is most of what the band is here to show. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-lp-hairline" />
    </section>
  );
}

import type { CSSProperties, ReactElement } from 'react';

/**
 * The agentic hero, parked.
 *
 * An empty band at the hero's exact height. Same reasoning as the landing
 * one in `sections/Hero.tsx`: it holds the space so every band under it
 * still lands where it will land.
 *
 * Two finished versions are on disk, both working:
 *
 *   `ClarifyHero.tsx`   it asks which of two readings you meant, you pick,
 *                       and it arms. The one that was mounted here last.
 *   `HeroConsole.tsx`   the console that types a real prompt and then names
 *                       the trigger, the universe and the size it read.
 *
 * Restoring either is one import: swap the export below for
 * `export { ClarifyHero as AgenticHero } from './ClarifyHero';`.
 */

const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
} as CSSProperties;

export function AgenticHero(): ReactElement {
  return (
    <section
      id="hero"
      style={LIGHT}
      className="relative isolate flex min-h-[clamp(720px,92vh,940px)] w-full items-center bg-lp-ground"
    >
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-lp-hairline" />
    </section>
  );
}

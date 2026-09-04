import type { CSSProperties, ReactElement } from 'react';

/**
 * The agentic hero, parked.
 *
 * An empty band at the hero's exact height. Same reasoning as the landing
 * one in `sections/Hero.tsx`: the page is being read for its shape, and
 * the band holds the space so every band under it still lands where it
 * will land.
 *
 * The console — the one that typed a real prompt and then named the
 * trigger, the universe and the size it read out of it — is intact in
 * `HeroConsole.tsx`, along with `hero.css`. Restoring it is one import:
 * swap the export below for
 * `export { HeroConsole as AgenticHero } from './HeroConsole';`.
 *
 * It was also the hero this page most needed to replace: it opened on the
 * same shape as the landing hero, at the same size, in the same column,
 * so the two pages read as one page twice.
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

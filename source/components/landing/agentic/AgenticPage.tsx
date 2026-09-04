import { AgenticHero } from './AgenticHero';
import { Control, Loop } from './Control';
import { Corpus } from './Corpus';
import { Run } from './Run';
import { Footer, Header } from '../sections';

/**
 * `/agentic-trading`.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * A dark page: black ground, tracked uppercase monospace, gradient CTAs,
 * corner registration ticks, warped section dividers and an aurora behind
 * every band. It was a different product wearing the same name, and a
 * visitor arriving from the landing page could not tell they were still
 * on the same site.
 *
 * This is the landing page's shell, unchanged: the same glass header, the
 * same white ground, the same 1400 column, the same type scale, the same
 * footer. Nothing here declares a new register.
 *
 * ── THE ORDER ────────────────────────────────────────────────────────
 *
 * Hero, run, corpus, loop, control. It is an argument, and it is made in
 * the order somebody actually asks the questions:
 *
 *   1  it takes a sentence          (hero types one)
 *   2  and here is what it does with it   (the run, in the open)
 *   3  and it takes ANY sentence    (the wall)
 *   4  so, three moves, that is the product   (the loop)
 *   5  and here is what it can and cannot do  (control)
 *
 * Control is last on purpose. Safety before somebody wants the thing
 * reads as a warning; safety after they want it reads as an answer.
 *
 * ── THE HEADER IS THE LANDING HEADER ─────────────────────────────────
 *
 * Not a copy of it. The same component, so the bar can never drift
 * between the two pages. Its destinations are anchors into the landing
 * page, which is correct: this page is reached FROM there.
 */

export function AgenticPage() {
  return (
    <main className="lp min-h-screen bg-white text-lp-ink-1 antialiased">
      <Header />
      <AgenticHero />
      <Run />
      <Corpus />
      <Loop />
      <Control />
      <Footer />
    </main>
  );
}

import '@/components/landing/tokens.css';
import { Agent, Footer, Frens, Header, Hero, Rewards } from '@/components/landing/sections';

/**
 * The "listen" landing page — the signed-out face of `/`.
 *
 * The page was cleared on 2026-09-03 and is being rebuilt one band at a
 * time. What was here before, and what was wrong with it, is written down
 * in `WHAT-WAS-HERE.md` beside this file.
 *
 * ── THE GROUND IS PAPER NOW ──────────────────────────────────────────
 *
 * `bg-lp-ground` is still #000000 in `tokens.css`, because that file
 * describes the page that was cleared and nothing else on the site reads
 * it yet. The site is going light, and a white header on a black page is
 * not a thing anyone would ship, so the shell states the ground itself
 * rather than waiting for the token to catch up. When the rest of the
 * bands land, this moves back into `tokens.css` and the literal goes.
 *
 * `lp` stays regardless. It scopes the landing palette, and the
 * `html:has(.lp)` root rules — 16px root, no terminal zoom, smooth
 * in-page scrolling — key off this same class.
 */
export function LandingPage() {
  return (
    <main className="lp min-h-screen bg-white text-lp-ink-1 antialiased">
      <Header />
      <Hero />
      <Agent />
      <Rewards />
      <Frens />
      <Footer />
    </main>
  );
}

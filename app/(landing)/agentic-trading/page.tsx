import { AgenticPage } from '@/components/landing/agentic/AgenticPage';
import { pageMeta } from '../../../sandbox/siteMeta';

/*
 * `/agentic-trading` — the marketing page for the trading agents.
 *
 * ── WHY IT IS IN THE LANDING GROUP AND NOT `(public)` ────────────────
 *
 * It used to live in `(public)`, alongside onboarding and the auth pages,
 * because it was drawn in the terminal's tokens. It is not any more: it is
 * the landing page's shell, its header and its footer.
 *
 * That matters more than tidiness. `(public)/layout.tsx` loads the
 * terminal's `globals.css`, which sets `zoom: var(--ui-scale)` — 1.18 — on
 * the root element. Served from there, every measurement on this page came
 * out 18 percent larger than the identical component on `/`, so the shared
 * header and footer were visibly bigger on one page than the other.
 *
 * The landing group loads `sandbox/landing.css` and sets no zoom, which is
 * what the landing components are authored against.
 *
 * The production route also reads the Clerk session and gates on it. None
 * of that is here, for the same reason the landing route omits it.
 */
export const metadata = pageMeta({
  title: 'Agentic trading · Listen',
  description:
    'Say it once and it trades it for you. Every tool it reaches for is on the page, and nothing fires until you approve.',
  path: '/agentic-trading',
});

export default function AgenticTradingRoute() {
  return <AgenticPage />;
}

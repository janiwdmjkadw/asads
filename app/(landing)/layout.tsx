import type { ReactNode } from 'react';
import '../../sandbox/landing.css';

/**
 * The landing page's own group, and the reason it exists is the stylesheet
 * on the line above.
 *
 * `/` is served from the separate landing export in `../New folder` (see the
 * note in next.config.mjs), and that page is authored against its own
 * `components/landing/tokens.css` and a near empty set of globals. The
 * terminal's `source/app/globals.css` is 59 KB of tokens that also paints
 * `body` and pulls in listen.css, discover.css and agent-chat.css. With it
 * loaded, the landing came up on the terminal's ground (rgb(7,7,9)) instead
 * of black, under a base layer it was never drawn against.
 *
 * No `Providers` either: the landing calls nothing that needs a query
 * client, exactly as its own harness renders it.
 */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

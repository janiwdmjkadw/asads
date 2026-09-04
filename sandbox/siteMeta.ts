import type { Metadata } from 'next';

/**
 * Page metadata, and the one place the preview card is named.
 *
 * ── WHY `metadataBase` MATTERS HERE ──────────────────────────────────
 *
 * Open Graph consumers do not resolve relative URLs. Without a base, Next
 * emits `/og?p=landing` verbatim and every unfurl — Discord, iMessage,
 * a timeline — shows the link with no image at all. So the base is
 * resolved once, from the deployment, and every page inherits it.
 *
 * The order matters: an explicitly configured site URL wins, because that
 * is the domain people will actually paste. `VERCEL_URL` is the preview
 * deployment's own generated host and is right only when nothing else is
 * set. Localhost is the fallback so the sandbox still emits absolute URLs
 * that a local unfurl tester can read.
 */
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:4312');

export const metadataBase = new URL(SITE);

/**
 * ONE preview image, on every page. `/og` draws a single card and there is
 * nothing to select; see the note on that route for why it is not one per
 * page. `alt` is what somebody using a screen reader hears in place of the
 * card, and what shows when an unfurl fails to fetch it.
 */
const IMAGE = { url: '/og', width: 1200, height: 630, alt: 'Listen' } as const;

export function pageMeta({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const images = [IMAGE];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: 'Listen', type: 'website', images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}

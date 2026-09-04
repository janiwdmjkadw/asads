import { Index } from '../../sandbox/Index';
import { pageMeta } from '../../sandbox/siteMeta';

/**
 * `/sandbox` — the index. Not part of the export and not part of the
 * product: it exists so every surface in the bundle is one click away
 * instead of a URL somebody has to remember.
 *
 * The list itself lives in `sandbox/pageList.ts`, because `/og` draws a
 * preview card from the same entries. Add a page there, not here.
 */
export const metadata = pageMeta({
  title: 'Every page · Listen',
  description: 'Every surface in the bundle, with a preview of each.',
  path: '/sandbox',
});

export default function SandboxIndexRoute() {
  return <Index />;
}

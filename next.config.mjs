import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stub = (p) => path.join(root, 'sandbox/stubs', p);

/**
 * The landing page is NOT the one in this export.
 *
 * `../New folder` is a separate, newer export of the landing alone, with its
 * own git history and its own harness on port 4321. Its `/` is a redesign:
 * no Infra band, a social menu in the header, and the agent, header, hero,
 * surfaces and terminal bands broken into their own folders.
 *
 * `@/components/landing` is pointed there rather than copied, so there is
 * ONE landing page on this machine. Edit it in `../New folder/source` and it
 * moves here and on 4321 at the same time.
 *
 * Safe as a blanket redirect of the whole folder: the only other importers
 * of it in this export are the welcome background and the certificate
 * modal, and they take `primitives/usePrefersReducedMotion`, which is
 * byte-identical in both trees. Everything else the new landing reaches for
 * (`@/lib/utils`, `@/components/ui/dialog`, every `/landing/*` asset, the
 * `lp-*` Tailwind tokens) is already here and already matches.
 */
/*
 * WHICH LANDING, AND WHY IT IS A SWITCH NOW.
 *
 * Turbopack roots its filesystem at the project and refuses any path that
 * climbs above it: `FileSystemPath("").join("../New folder/source/
 * components/landing") leaves the filesystem root`. That is a FATAL
 * panic rather than a recoverable error, so it aborts the manifest write
 * and then EVERY route 500s with `ENOENT ... app-build-manifest.json` —
 * the whole sandbox is down, and the message names the landing page
 * rather than the route you actually asked for.
 *
 * A directory junction inside the project does not get around it either:
 * Turbopack canonicalises through the junction and ends up right back
 * outside the root.
 *
 * So the DEFAULT is unchanged — the external landing, on webpack, exactly
 * as before. Setting LANDING_INTERNAL=1 swaps in the landing that lives
 * in this export, which keeps every path inside the root and lets the
 * whole thing build under Turbopack: a 30 second cold compile of
 * /discover becomes about 4.
 *
 *   npm run dev            unchanged: the newer external landing, webpack
 *   LANDING_INTERNAL=1 …   the in-repo landing, which Turbopack can build
 *
 * The newer landing keeps its own harness on port 4321, which is where
 * it is actually worked on, so the default costs nothing day to day.
 */
const LANDING_INTERNAL = path.join(root, 'source/components/landing');
const LANDING_EXTERNAL = path.resolve(root, '../New folder/source/components/landing');

/*
 * AND IT FALLS BACK WHEN THE EXTERNAL TREE IS NOT THERE.
 *
 * The external landing is one directory on one machine. A clone of this
 * repo does not have it, and pointing the alias at a path that does not
 * exist fails the build with a module resolution error that says nothing
 * about the actual cause.
 *
 * `source/components/landing` is a copy of that tree, committed here, so
 * anywhere this repo is checked out builds. On the machine the landing is
 * actually authored on, the external path exists and still wins, which
 * keeps that edit loop exactly as it was.
 */
const LANDING =
  process.env.LANDING_INTERNAL === '1' || !existsSync(LANDING_EXTERNAL)
    ? LANDING_INTERNAL
    : LANDING_EXTERNAL;

/**
 * Sandbox host for the complete Listen frontend export.
 *
 * `source/` is your friend's tree and is treated as read only by this config:
 * nothing in it is edited to make it run. Two things are supplied from
 * outside instead.
 *
 * 1. `@/*` resolves to `source/*` (declared in tsconfig.json, which Next
 *    reads for both webpack and turbopack). That is the only reason the
 *    export's 736 files find each other.
 * 2. The three packages that are backend owned and therefore excluded from
 *    the export are aliased to local stand ins: Clerk (auth), LaunchDarkly
 *    (flags) and the Turnkey iframe stamper (key custody).
 *
 * Everything else in the import list is a real public package and is
 * installed for real, so the UI runs on the same libraries production does.
 */
const stubs = {
  '@clerk/nextjs': stub('clerk.tsx'),
  'launchdarkly-react-client-sdk': stub('launchdarkly.tsx'),
  '@turnkey/iframe-stamper': stub('turnkey.ts'),
};

/** @type {import('next').NextConfig} */
export default {
  /*
   * ── NO DEV INDICATOR ─────────────────────────────────────────────
   *
   * The floating badge in the bottom-left corner — the N logo and its
   * "1 Issue" counter. It sits on top of the board in every screenshot
   * of this app, so the corner of the page cannot be looked at without
   * looking at it instead.
   *
   * Errors are not hidden by this: a real compile failure still takes
   * over the whole page and the server log still carries everything.
   * What goes is the permanent corner ornament.
   */
  devIndicators: false,

  /*
   * ONE BUILD DIR PER SERVER.
   *
   * Two `next dev` processes against this folder — which happens the
   * moment a second chat or a second terminal runs `npm run dev` — both
   * write `.next`, overwrite each other's manifests, and invalidate each
   * other's cache on every request. The symptom is a route that compiles
   * fine and then 500s with `ENOENT ... app-build-manifest.json`, plus
   * recompiles that never stop.
   *
   * Default is unchanged, so the normal `npm run dev` behaves exactly as
   * before. A second server sets `NEXT_DIST_DIR` and stays out of its way.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: false,
  // The export is source for reading. Type and lint errors in it are your
  // friend's business, and they must never stop the page from painting.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  turbopack: {
    resolveAlias: { ...stubs, '@/components/landing': LANDING },
  },
  // The landing page lives outside this project root.
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(Object.entries(stubs).map(([k, v]) => [`${k}$`, v])),

      // More specific than the bare `@` below, so it wins for anything
      // under the landing folder and nothing else.
      '@/components/landing': LANDING,

      // Broad prefix alias LAST: everything else resolves inside the export.
      '@': path.join(root, 'source'),
    };
    return config;
  },
};

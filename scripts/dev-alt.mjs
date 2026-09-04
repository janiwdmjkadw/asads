/**
 * A SECOND DEV SERVER THAT DOES NOT FIGHT THE FIRST.
 *
 * Two `next dev` processes against this folder both write `.next`,
 * overwrite each other's manifests and invalidate each other's cache on
 * every request. The symptom is a route that reports `✓ Compiled` and
 * then 500s with `ENOENT ... app-build-manifest.json`, plus recompiles
 * that never settle. That happens the moment a second chat or a second
 * terminal runs `npm run dev`.
 *
 * So this one takes its own build directory and its own port, and leaves
 * `.next` and 4312 to whoever got there first. It also runs Turbopack,
 * which the config has been set up for all along — see the note in
 * `next.config.mjs`.
 *
 * A launcher file rather than a one-liner in `package.json`: setting an
 * env var inline needs `cross-env` on Windows, and spawning `npx.cmd`
 * from `node -e` throws `EINVAL` on Node 24 without `shell: true`.
 */

process.env.NEXT_DIST_DIR ||= '.next-alt';

// `next/dist/bin/next` reads `process.argv.slice(2)`, so the flags have
// to be in place before it is imported.
/*
 * WEBPACK, for now.
 *
 * `--turbopack` compiles /discover in about 4s against webpack's 30, and
 * the config has been set up for it all along — but it cannot build the
 * landing page from either source. The external export sits outside the
 * project root, which Turbopack refuses with a FATAL panic
 * (`FileSystemPath("").join("../New folder/...") leaves the filesystem
 * root`, and a junction canonicalises straight back out). Pointing at the
 * in-repo landing clears that and then hits `@clerk/nextjs` failing to
 * resolve through `resolveAlias` inside a server component. Either way
 * the panic aborts the manifest write and EVERY route 500s.
 *
 * So: same speed as the main server, but its own port and its own build
 * directory, which is the half of the problem that is actually solved.
 * Put `--turbopack` back after the Clerk alias resolves.
 */
process.argv = [process.argv[0], 'next', 'dev', '-p', '4313'];

await import('next/dist/bin/next');

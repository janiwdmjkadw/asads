/*
 * The export ships its own Tailwind config (source/tailwind.config.js) and
 * that file is the design system: every colour token, font, radius, shadow
 * and keyframe. It is loaded verbatim here — edit it there, not here.
 *
 * Only `content` is rewritten, because its globs are written relative to the
 * export root and the project root is one level above it now.
 */
const exported = require('./source/tailwind.config.js');

module.exports = {
  ...exported,
  content: [
    './app/**/*.{ts,tsx}',
    './sandbox/**/*.{ts,tsx}',
    './source/app/**/*.{ts,tsx}',
    './source/components/**/*.{ts,tsx}',
    './source/lib/**/*.{ts,tsx}',
    './source/homepage/**/*.{ts,tsx}',
    // The landing page is served from the separate export next door; see
    // the note in next.config.mjs. Its classes have to be scanned there.
    '../New folder/source/components/landing/**/*.{ts,tsx}',
  ],
};

/**
 * Geometry of the normalized owl asset (`listen-creature.svg`).
 *
 * The source Paper node is ONE compound `<path>` whose two eye subpaths are
 * cutouts (opposite winding under `nonzero`). The creature has to move its
 * eyes independently, so they are split out here as their own curves,
 * translated so each bbox center sits at (0, 0) — that is what lets an eye
 * rotate and scale about itself with a plain SVG `transform` attribute,
 * with no dependence on CSS `transform-origin` semantics on SVG elements.
 */

/** viewBox of the character, unchanged from the source node. */
export const VIEW_BOX = '0 0 100 95';

/** Height / width of the viewBox — a caller sizing by width multiplies by this. */
export const ASPECT = 0.95;

/** Body silhouette: round head plus the two ear tufts. Absolute coordinates. */
export const BODY_PATH =
  'M88.6 25.7L88 24.6L79.1 3L67.7 6.6C64.3 5.1 59.1 2.7 50 2.7C43.1 2.7 38.3 4.1 32.4 6.5L20.8 3L11.5 24.9C8.4 30.3 5.1 38.7 5.1 49C5.1 66.5 19.3 86.6 41 91.1C43.9 91.7 46.8 92 49.9 92C73.9 92.2 94.8 73.7 94.9 49C94.9 41.3 92.8 32.9 88.6 25.7Z';

/** Left eye mark (a slanted "\" capsule), centered on (0, 0). */
export const LEFT_EYE_PATH =
  'M2.92 4.17C2.02 4.67 1.02 4.57 0.22 3.97C-0.48 3.37 -1.68 2.17 -2.08 1.57C-2.68 0.67 -3.18 -0.23 -3.78 -1.23C-4.28 -2.43 -3.68 -3.93 -2.38 -4.33C-1.28 -4.73 -0.08 -4.33 0.52 -3.23C1.62 -1.23 2.32 -0.53 3.12 0.17C4.32 1.27 4.22 3.27 2.92 4.17Z';

/** Right eye mark (a slanted "/" capsule), centered on (0, 0). */
export const RIGHT_EYE_PATH =
  'M3.62 -0.71C2.82 0.69 2.32 1.89 -0.18 3.99C-0.78 4.59 -1.88 4.79 -2.88 4.29C-4.18 3.49 -4.48 1.69 -3.38 0.59C-2.48 -0.31 -1.78 -0.71 -0.58 -3.11C-0.08 -4.11 1.12 -4.91 2.52 -4.41C3.92 -3.91 4.52 -2.01 3.62 -0.71Z';

/** Where the left eye is placed back on the face, in viewBox units. */
export const LEFT_EYE_CENTER = { x: 37.08, y: 37.23 } as const;

/** Where the right eye is placed back on the face, in viewBox units. */
export const RIGHT_EYE_CENTER = { x: 63.78, y: 37.12 } as const;

/** Center of the body bbox — the origin whole-character transforms rotate about. */
export const BODY_CENTER = { x: 50.0, y: 47.35 } as const;

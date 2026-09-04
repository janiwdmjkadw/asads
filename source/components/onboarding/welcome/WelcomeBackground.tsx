import { OrderSequence } from './OrderSequence';

/** Flat stand-in, and the colour every layer here falls back to. */
/** Arctic mint. Anything painting the welcome ground reads this, so the
 *  colour is decided in one place rather than three. */
export const WELCOME_GROUND = '#04100f';

/**
 * The onboarding ground.
 *
 * This used to be a live `MeshGradient` in teal, taken off the design
 * board. It is the order sequence now — a chart along the floor, a cursor
 * that clicks a point on it, the conditions resolving behind, and a fill
 * printing where the click landed. See `OrderSequence`.
 *
 * Three things that changed with it, all of them wins rather than
 * compromises:
 *
 *   - No WebGL. The mesh held a live GL context and a render loop for the
 *     whole time this step was open, on a screen that is also booting the
 *     Turnkey export iframe. This is CSS on fourteen elements.
 *   - No client component. The shader needed `'use client'` for its
 *     reduced-motion hook; the sequence solves its geometry at module
 *     scope and ships no JavaScript.
 *   - No hue. The panel was made fully neutral, which left the teal mesh
 *     as the only chroma on the front door and arguing with a landing
 *     whose palette has none by design.
 *
 * Reduced motion is handled in the stylesheet: the scene stays and simply
 * stops telling its story, which is the same freeze-don't-drop policy the
 * shader had.
 */
export function WelcomeBackground(): React.ReactElement {
  return <OrderSequence />;
}

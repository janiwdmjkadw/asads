/**
 * The expression table: OFFSETS FROM NEUTRAL, never absolute poses.
 *
 * x/y/rotation are added to whatever gaze and behavior already produced;
 * scaleX/scaleY multiply it. That is why an expression composes with a gaze
 * dart or a blink instead of fighting it.
 *
 * Rotation sign follows SVG (positive = clockwise on screen). The left mark
 * is a "\" and the right a "/", so a NEGATIVE left rotation and a POSITIVE
 * right rotation both flatten the eye — that pairing reads as relaxed, and
 * the opposite pairing reads as intense.
 */

import type { BodyOffset, Expression, ExpressionName, EyeOffset } from './types';

/** No offset at all — the identity every expression is measured against. */
export const NEUTRAL_EYE: EyeOffset = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/** No body inflection; used for expressions that leave the body alone. */
export const NEUTRAL_BODY: BodyOffset = NEUTRAL_EYE;

/** Build an eye offset, defaulting every channel it does not mention. */
function eye(o: Partial<EyeOffset>): EyeOffset {
  return {
    x: o.x ?? 0,
    y: o.y ?? 0,
    rotation: o.rotation ?? 0,
    scaleX: o.scaleX ?? 1,
    scaleY: o.scaleY ?? 1,
  };
}

/** Every expression the creature can wear, as offsets from neutral. */
export const EXPRESSIONS: Record<ExpressionName, Expression> = {
  neutral: { left: NEUTRAL_EYE, right: NEUTRAL_EYE },
  curious: {
    left: eye({ scaleY: 1.12, scaleX: 1.05, y: -0.3, rotation: -3 }),
    right: eye({ scaleY: 0.98, y: 0.1, rotation: 3 }),
    body: eye({ rotation: 3 }),
  },
  focused: {
    left: eye({ scaleY: 0.82, x: 0.25 }),
    right: eye({ scaleY: 0.82, x: -0.25 }),
  },
  surprised: {
    left: eye({ scaleX: 1.28, scaleY: 1.32, y: -0.4 }),
    right: eye({ scaleX: 1.28, scaleY: 1.32, y: -0.4 }),
    body: eye({ y: -1, scaleX: 1.02, scaleY: 1.02 }),
  },
  skeptical: {
    left: eye({ scaleY: 0.65, rotation: -8, y: 0.2 }),
    right: eye({ scaleY: 1.05, y: -0.3, rotation: 2 }),
    body: eye({ rotation: -2 }),
  },
  squint: {
    left: eye({ scaleY: 0.5, scaleX: 1.04 }),
    right: eye({ scaleY: 0.5, scaleX: 1.04 }),
  },
  satisfied: {
    left: eye({ scaleY: 0.6, scaleX: 1.06, y: 0.2, rotation: -8 }),
    right: eye({ scaleY: 0.6, scaleX: 1.06, y: 0.2, rotation: 8 }),
  },
  alert: {
    left: eye({ scaleX: 1.06, scaleY: 1.1, y: -0.25 }),
    right: eye({ scaleX: 1.06, scaleY: 1.1, y: -0.25 }),
  },
  alarmed: {
    left: eye({ scaleX: 1.28, scaleY: 1.32, y: -0.4, rotation: 4 }),
    right: eye({ scaleX: 1.12, scaleY: 1.18, y: 0.1, rotation: -2 }),
  },
};

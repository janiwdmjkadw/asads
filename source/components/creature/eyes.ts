/**
 * Eye geometry — the one part of the creature that is a pure RENDERING
 * concern, and therefore tunable without touching the engine at all.
 *
 * The engine only ever emits eye poses as OFFSETS from "wherever the renderer
 * put that eye", so the marks can change shape, size, tilt, spacing and height
 * freely: the gaze spring, the blink envelope and the expressions keep working
 * unchanged on top of whatever geometry is resolved here.
 *
 * Two shapes exist. `'source'` is the hand-drawn capsule from the original
 * asset (`LEFT_EYE_PATH` / `RIGHT_EYE_PATH`), which is not parametric — its
 * `rx`/`ry`/`tilt` are ignored. `'oval'` is a generated ellipse, which is what
 * every slider in the playground draws.
 */

import { LEFT_EYE_PATH, RIGHT_EYE_PATH } from './svg';
import type { Vec2 } from './types';

/** Which curve an eye mark is drawn from: the source capsule, or an ellipse. */
export type EyeShape = 'source' | 'oval';

/** A complete description of where the two eye marks are and what they look like. */
export interface EyeGeometry {
  /** `'source'` uses the hand-drawn capsules and ignores `rx`/`ry`/`tilt`. */
  shape: EyeShape;
  /** Half-width of the oval, in viewBox units. */
  rx: number;
  /** Half-height of the oval, in viewBox units. */
  ry: number;
  /** Degrees, applied `+tilt` to the LEFT eye and `−tilt` to the right: `+` keeps the inner corners lower (the source's sly look), `−` flips it friendly. */
  tilt: number;
  /** Distance between the two eye centers. */
  spacing: number;
  /** Height of the eye centers, in viewBox units. */
  y: number;
  /** Horizontal shift of BOTH eyes; 0 everywhere except the source preset. */
  offsetX: number;
  /** Radius of a surface-colored dot inside each mark; 0 = no pupil. */
  pupil: number;
}

/** The presets the playground offers, from the source mark to owl-round. */
export type EyePresetName =
  | 'source'
  | 'ovalS'
  | 'ovalM'
  | 'ovalL'
  | 'round'
  | 'roundL'
  | 'almond'
  | 'ovalMPupil'
  | 'roundPupil';

/** Every named eye geometry; `ovalL` is the component default (owner, 2026-08-19). */
export const EYE_PRESETS: Record<EyePresetName, EyeGeometry> = {
  // Reproduces the original centers (37.08, 37.2) / (63.78, 37.2).
  source: {
    shape: 'source',
    rx: 4,
    ry: 4.5,
    tilt: 0,
    spacing: 26.7,
    y: 37.18,
    offsetX: 0.43,
    pupil: 0,
  },
  ovalS: {
    shape: 'oval',
    rx: 3.6,
    ry: 5.0,
    tilt: 18,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 0,
  },
  ovalM: {
    shape: 'oval',
    rx: 4.6,
    ry: 6.4,
    tilt: 14,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 0,
  },
  ovalL: {
    shape: 'oval',
    rx: 5.6,
    ry: 7.6,
    tilt: 10,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 0,
  },
  round: { shape: 'oval', rx: 6.2, ry: 6.2, tilt: 0, spacing: 26.7, y: 37.2, offsetX: 0, pupil: 0 },
  roundL: { shape: 'oval', rx: 7.4, ry: 7.4, tilt: 0, spacing: 28, y: 37.6, offsetX: 0, pupil: 0 },
  almond: {
    shape: 'oval',
    rx: 5.6,
    ry: 3.8,
    tilt: 12,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 0,
  },
  ovalMPupil: {
    shape: 'oval',
    rx: 4.6,
    ry: 6.4,
    tilt: 14,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 1.9,
  },
  roundPupil: {
    shape: 'oval',
    rx: 6.2,
    ry: 6.2,
    tilt: 0,
    spacing: 26.7,
    y: 37.2,
    offsetX: 0,
    pupil: 2.4,
  },
};

/** Human labels for the presets, for the playground's buttons. */
export const EYE_PRESET_LABELS: Record<EyePresetName, string> = {
  source: 'source',
  ovalS: 'oval · S',
  ovalM: 'oval · M',
  ovalL: 'oval · L',
  round: 'round',
  roundL: 'round · L',
  almond: 'almond',
  ovalMPupil: 'oval · M + pupil',
  roundPupil: 'round + pupil',
};

/** Two decimals, with `-0` normalized away so paths never carry `-0.00`. */
function n(value: number): string {
  const s = value.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

/** Ellipse centered at (0, 0), rotated by `tilt` degrees, as exact SVG arcs. */
export function ellipsePath(rx: number, ry: number, tilt: number): string {
  const t = (tilt * Math.PI) / 180;
  const x0 = -rx * Math.cos(t);
  const y0 = -rx * Math.sin(t);
  const dx = 2 * rx * Math.cos(t);
  const dy = 2 * rx * Math.sin(t);
  return (
    `M${n(x0)} ${n(y0)}` +
    `a${n(rx)} ${n(ry)} ${n(tilt)} 1 0 ${n(dx)} ${n(dy)}` +
    `a${n(rx)} ${n(ry)} ${n(tilt)} 1 0 ${n(-dx)} ${n(-dy)}Z`
  );
}

/**
 * Resolve the `eyes` prop: a preset name, a partial override, or nothing.
 * Nothing means the canonical creature — oval · L (owner decision, 2026-08-19);
 * a partial merges over oval · L unless it asks for the source mark.
 */
export function resolveEyes(eyes?: EyePresetName | Partial<EyeGeometry>): EyeGeometry {
  if (eyes === undefined) return EYE_PRESETS.ovalL;
  if (typeof eyes === 'string') return EYE_PRESETS[eyes];
  const base = eyes.shape === 'source' ? EYE_PRESETS.source : EYE_PRESETS.ovalL;
  return { ...base, ...eyes };
}

/** The two mark paths (each centered on (0, 0)) and where to place them. */
export function eyeLayout(g: EyeGeometry): {
  left: string;
  right: string;
  leftCenter: Vec2;
  rightCenter: Vec2;
} {
  const source = g.shape === 'source';
  return {
    left: source ? LEFT_EYE_PATH : ellipsePath(g.rx, g.ry, g.tilt),
    right: source ? RIGHT_EYE_PATH : ellipsePath(g.rx, g.ry, -g.tilt),
    leftCenter: { x: 50 - g.spacing / 2 + g.offsetX, y: g.y },
    rightCenter: { x: 50 + g.spacing / 2 + g.offsetX, y: g.y },
  };
}

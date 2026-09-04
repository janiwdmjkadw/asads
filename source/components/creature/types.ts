/**
 * Shared vocabulary for the creature: what it can be doing, what it can look
 * at, the pose it resolves to each frame, and the knobs that scale all of it.
 *
 * Poses are absolute values in viewBox units / degrees — the engine composes
 * every contribution (breath, float, lean, impulses, gaze, expression, blink)
 * into exactly one pose per part, so the renderer only ever writes three
 * transform strings.
 */

/** What the creature is doing; drives its base expression and its behaviors. */
export type CreatureState =
  'idle' | 'listening' | 'thinking' | 'searching' | 'executing' | 'success' | 'error';

/** A named thing in the surrounding UI the creature can point its gaze at. */
export type AttentionTarget = 'pointer' | 'input' | 'response' | 'result' | null;

/** A 2-D vector; as a gaze direction it is normalized, +y = down. */
export interface Vec2 {
  x: number;
  y: number;
}

/** The three attention targets whose screen position the host can override. */
export type NamedTargetVectors = Partial<Record<'input' | 'response' | 'result', Vec2>>;

/** Resolved pose of one eye group, relative to that eye's own center. */
export interface EyePose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Resolved pose of the whole character, about the body center. */
export interface BodyPose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * The forms Soren can take (spec §3.4). `owl` is the resting form — the
 * ordinary creature — and every other name is one bounded morph or behaviour
 * the form channel plays exactly one of at a time.
 */
export type FormName =
  | 'owl'
  | 'pour'
  | 'dots'
  | 'gather'
  | 'slide-left'
  | 'peek'
  | 'head-turn'
  | 'assemble';

/** One circle of a signifier (a pour dot, an assemble particle), viewBox units. */
export interface FormDot {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/**
 * What a form does to the whole character, ON TOP of `BodyPose`. Kept apart
 * from the pose because it belongs to a different node: the pose is the CSS
 * transform on the `<svg>` root, this is the `<g data-part="character">`
 * transform, so the dots and particles do not inherit the body's morph.
 */
export interface FormBody {
  opacity: number;
  extraX: number;
  extraY: number;
  extraScaleX: number;
  extraScaleY: number;
}

/**
 * The form channel's whole output for one frame: pure data, already resolved
 * from sim time, so the renderer never interprets a clock or an easing curve.
 */
export interface FormState {
  kind: FormName;
  /** Progress of a one-shot form, or the cycle phase of a looping one; 0..1. */
  t01: number;
  /** A one-shot form that has reached its end (and is holding its last frame). */
  done: boolean;
  /** True for the forms that hold until something else starts them off. */
  loops: boolean;
  body: FormBody;
  /** The eye marks are hidden only for the pure signifiers (spec §3.4). */
  eyesVisible: boolean;
  /** Up to `FORM_DOT_COUNT` entries; empty when the form draws no dots. */
  dots: readonly FormDot[];
  /** Up to `FORM_PARTICLE_COUNT` entries; empty when the form draws none. */
  particles: readonly FormDot[];
}

/** How many dot circles a renderer must pre-create (the pour signifier). */
export const FORM_DOT_COUNT = 3;

/** How many particle circles a renderer must pre-create (the assemble). */
export const FORM_PARTICLE_COUNT = 8;

/** The resting form: the ordinary owl, nothing added, nothing in flight. */
export const OWL_FORM: FormState = Object.freeze({
  kind: 'owl',
  t01: 0,
  done: true,
  loops: false,
  body: Object.freeze({ opacity: 1, extraX: 0, extraY: 0, extraScaleX: 1, extraScaleY: 1 }),
  eyesVisible: true,
  dots: Object.freeze([]) as readonly FormDot[],
  particles: Object.freeze([]) as readonly FormDot[],
});

/** One composed frame: everything the renderer needs, and nothing else. */
export interface CreatureFrame {
  body: BodyPose;
  left: EyePose;
  right: EyePose;
  form: FormState;
}

/** The expressions the eyes (and slightly the body) can blend toward. */
export type ExpressionName =
  | 'neutral'
  | 'curious'
  | 'focused'
  | 'surprised'
  | 'skeptical'
  | 'squint'
  | 'satisfied'
  | 'alert'
  | 'alarmed';

/** One eye's expression offset from neutral: x/y/rotation add, scales multiply. */
export interface EyeOffset {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** A whole-body offset from neutral, same additive/multiplicative split. */
export type BodyOffset = EyeOffset;

/** An expression is a pair of eye offsets plus an optional body inflection. */
export interface Expression {
  left: EyeOffset;
  right: EyeOffset;
  body?: BodyOffset;
}

/** Amplitude and speed knobs; every motion in the engine scales off these. */
export interface CreatureTuning {
  /** Max eye translation, viewBox units. */
  eyeRange: number;
  /** Max eye rotation, degrees. */
  eyeRotation: number;
  /** Max lean/tilt rotation, degrees. */
  bodyTilt: number;
  /** Sim-time multiplier: scales schedules, envelopes, periods and springs alike. */
  speed: number;
  /** Squash/stretch amount, as a fraction of scale. */
  squash: number;
  /** Breathing scale amplitude, as a fraction of scale. */
  breath: number;
  /** Float amplitude, viewBox units. */
  floatAmp: number;
  /** Pointer notice radius, in creature widths. */
  noticeRadius: number;
}

/** The tuning the creature ships with; the playground edits a copy of this. */
export const DEFAULT_TUNING: CreatureTuning = {
  eyeRange: 3,
  eyeRotation: 8,
  bodyTilt: 4,
  speed: 1,
  squash: 0.06,
  breath: 0.015,
  floatAmp: 1.2,
  noticeRadius: 4,
};

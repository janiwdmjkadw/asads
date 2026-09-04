/**
 * The creature's whole mind and body, as one pure object.
 *
 * Nothing in here touches the DOM, React, timers, `Math.random` or `Date`:
 * `tick(now)` is the only thing that moves time forward, and every draw comes
 * from a seeded rng. That is what makes a creature reproducible — same seed
 * plus the same tick sequence gives byte-identical frames — and what lets the
 * behaviors be tested without a browser.
 *
 * Four systems compose into every frame (spec §6, §3.4):
 *   body = breath ⊕ float ⊕ sway ⊕ lean-springs ⊕ Σ impulses
 *   eyes = gaze ⊕ expression ⊕ blink ⊕ micro-noise
 *   brain = a tiny scheduler of next-event times, in SIM milliseconds
 *   form = ONE morph at a time, resolved from sim time into pure data
 * Sim time is real time × `tuning.speed`, so one slider scales schedules,
 * envelopes, periods and springs coherently.
 */

import { EXPRESSIONS } from './expressions';
import { Rng } from './rng';
import { MEDIUM, SNAPPY, SOFT, Spring } from './spring';
import type { SpringConfig } from './spring';
import { BODY_CENTER } from './svg';
import { DEFAULT_TUNING, FORM_PARTICLE_COUNT, OWL_FORM } from './types';
import type {
  AttentionTarget,
  BodyPose,
  CreatureFrame,
  CreatureState,
  CreatureTuning,
  ExpressionName,
  EyeOffset,
  EyePose,
  FormBody,
  FormDot,
  FormName,
  FormState,
  NamedTargetVectors,
  Vec2,
} from './types';

const TAU = Math.PI * 2;

/** Where the named attention targets sit, as normalized gaze directions. */
const DEFAULT_TARGET_VECTORS: Record<'input' | 'response' | 'result', Vec2> = {
  input: { x: 0, y: 0.8 },
  response: { x: -0.3, y: 0.55 },
  result: { x: 0.3, y: 0.55 },
};

/** Blink interval per state, in sim ms. */
const BLINK_RANGES: Record<CreatureState, readonly [number, number]> = {
  idle: [3000, 7000],
  listening: [2500, 5000],
  thinking: [4000, 8000],
  searching: [3000, 6000],
  executing: [4000, 8000],
  success: [3000, 7000],
  error: [2000, 4000],
};

/** Base expression per state; behaviors may override it temporarily. */
const BASE_EXPRESSIONS: Record<CreatureState, ExpressionName> = {
  idle: 'neutral',
  listening: 'alert',
  thinking: 'neutral',
  searching: 'alert',
  executing: 'focused',
  success: 'neutral',
  error: 'alarmed',
};

/** Where `thinking` lets its eyes drift while it works something out. */
const THINKING_GLANCES: readonly Vec2[] = [
  { x: 0, y: -0.7 },
  { x: -0.6, y: -0.5 },
  { x: 0.6, y: -0.5 },
  { x: 0.7, y: 0 },
  { x: -0.7, y: 0 },
];

/** The fixed sweep `searching` walks, in order, with jitter added per dart. */
const SCAN_PATTERN: readonly Vec2[] = [
  { x: -0.8, y: -0.2 },
  { x: 0.8, y: -0.2 },
  { x: -0.5, y: 0.5 },
  { x: 0.9, y: 0.1 },
  { x: 0, y: -0.8 },
  { x: -0.9, y: 0.15 },
];

/** A pointer this many creature widths off-center reads as a full gaze. */
const POINTER_FULL_GAZE_WIDTHS = 2;

const BLINK_CLOSE_MS = 70;
const BLINK_HOLD_MS = 30;
const BLINK_OPEN_MS = 110;
const BLINK_TOTAL_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;
const BLINK_MIN_SCALE = 0.06;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp a gaze direction into the unit disc, preserving its angle. */
function clampDisc(v: Vec2, radius = 1): Vec2 {
  const r = Math.hypot(v.x, v.y);
  if (r <= radius || r === 0) return { x: v.x, y: v.y };
  const k = radius / r;
  return { x: v.x * k, y: v.y * k };
}

function easeInQuad(u: number): number {
  return u * u;
}

function easeOutQuad(u: number): number {
  return 1 - (1 - u) * (1 - u);
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function easeOutCubic(u: number): number {
  return 1 - Math.pow(1 - u, 3);
}

/** A sub-progress of `u` over [a, b], clamped to 0..1 — the form channel's ruler. */
function seg(u: number, a: number, b: number): number {
  return clamp((u - a) / (b - a), 0, 1);
}

// ------------------------------------------------------------------- forms
//
// The form channel (spec §3.4). Soren is a transforming system, not a sprite
// with poses: exactly ONE form is active at a time, it is resolved from sim
// time alone, and every number below is LOCKED by the owner. Sequencing a
// multi-beat cycle is deliberately NOT in here — the wait cycle is anchored
// to wire events (§3.5), which the engine cannot see.

/** Where the three dots of the pour signifier sit, in viewBox units. */
const DOT_XS: readonly number[] = [28, 50, 72];
const DOT_Y = 47;
const DOT_R = 7;

/** The dot-wave's dim level; one dot is at 1, the others sit here. */
const DOT_DIM = 0.4;

/** How long one run (or, for a looping form, one cycle) takes, in sim ms. */
const FORM_MS: Record<Exclude<FormName, 'owl'>, number> = {
  pour: 480,
  dots: 1200,
  gather: 360,
  'slide-left': 420,
  peek: 1600,
  'head-turn': 1400,
  assemble: 360,
};

/** The forms that hold until told to move on; every other form settles. */
const LOOPING_FORMS: ReadonlySet<FormName> = new Set<FormName>(['dots', 'peek']);

/** peek's segment lengths in sim ms; they sum to `FORM_MS.peek`. */
const PEEK_DUCK = 180;
const PEEK_DOWN = 200;
const PEEK_POP = 220;
const PEEK_UP = 300;
const PEEK_T1 = PEEK_DUCK; // 180  — ducked
const PEEK_T2 = PEEK_T1 + PEEK_DOWN; // 380  — held under the line
const PEEK_T3 = PEEK_T2 + PEEK_POP; // 600  — popped up and right
const PEEK_T4 = PEEK_T3 + PEEK_UP; // 900  — held up, glancing left
const PEEK_T5 = PEEK_T4 + PEEK_DUCK; // 1080 — ducked again
const PEEK_T6 = PEEK_T5 + PEEK_DOWN; // 1280 — held under the line
const PEEK_T7 = PEEK_T6 + PEEK_POP; // 1500 — back home, then 100 ms of rest

/** A form body that adds nothing: the owl, exactly as the pose left it. */
function restBody(): FormBody {
  return { opacity: 1, extraX: 0, extraY: 0, extraScaleX: 1, extraScaleY: 1 };
}

/** How far shut an eye is `e` sim-ms into a blink; 1 = fully open. */
function blinkFactor(e: number): number {
  if (e <= 0 || e >= BLINK_TOTAL_MS) return 1;
  if (e < BLINK_CLOSE_MS) return 1 - (1 - BLINK_MIN_SCALE) * easeInQuad(e / BLINK_CLOSE_MS);
  if (e < BLINK_CLOSE_MS + BLINK_HOLD_MS) return BLINK_MIN_SCALE;
  const u = (e - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS;
  return BLINK_MIN_SCALE + (1 - BLINK_MIN_SCALE) * easeOutQuad(u);
}

/** One impulse's contribution: x/y/rotation add, scales multiply. */
interface BodyDelta {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** A time-boxed body envelope; dropped from the frame once it is done. */
interface Impulse {
  readonly start: number;
  readonly duration: number;
  at(elapsed: number): BodyDelta;
}

/** A one-shot callback at a sim time; cancelled wholesale on a state change. */
interface Step {
  readonly at: number;
  run(): void;
}

/** An in-flight blink; `lag` is how far the right eye trails the left. */
interface Blink {
  readonly start: number;
  readonly lag: number;
}

function noDelta(): BodyDelta {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
}

/**
 * Jump: optional pre-squash, a sine arc with stretch at the apex, a landing
 * squash, then a damped-sine recovery so it never stops dead.
 */
function hopImpulse(
  start: number,
  height: number,
  flight: number,
  squash: number,
  pre: boolean,
): Impulse {
  const preMs = pre ? 90 : 0;
  const landMs = 120;
  const recoverMs = 220;
  return {
    start,
    duration: preMs + flight + landMs + recoverMs,
    at(e: number): BodyDelta {
      const d = noDelta();
      if (preMs > 0 && e < preMs) {
        const u = e / preMs;
        d.scaleY = 1 - 1.2 * squash * u;
        d.scaleX = 1 + 0.8 * squash * u;
        d.y = 0.8 * u;
        return d;
      }
      const air = e - preMs;
      if (air < flight) {
        const s = Math.sin(Math.PI * (air / flight));
        d.y = -height * s;
        d.scaleY = 1 + 0.6 * squash * s;
        d.scaleX = 1 - 0.4 * squash * s;
        return d;
      }
      const land = air - flight;
      if (land < landMs) {
        const s = Math.sin(Math.PI * (land / landMs));
        d.scaleY = 1 - squash * s;
        d.scaleX = 1 + 0.7 * squash * s;
        return d;
      }
      const u = clamp((land - landMs) / recoverMs, 0, 1);
      const wave = Math.sin(TAU * 2 * u) * (1 - u) * Math.exp(-3 * u);
      d.scaleY = 1 - 0.35 * squash * wave;
      d.scaleX = 1 + 0.25 * squash * wave;
      d.y = -0.5 * wave;
      return d;
    },
  };
}

/** A full 360° spin that dips and lifts through the middle and lands level. */
function twirlImpulse(start: number, duration = 700): Impulse {
  return {
    start,
    duration,
    at(e: number): BodyDelta {
      const u = clamp(e / duration, 0, 1);
      const d = noDelta();
      const mid = Math.sin(Math.PI * u);
      d.rotation = 360 * easeInOutCubic(u);
      d.scaleX = 1 - 0.06 * mid;
      d.scaleY = 1 - 0.06 * mid;
      d.y = -2 * mid;
      return d;
    },
  };
}

/** A decaying side-to-side rock. */
function wobbleImpulse(start: number, duration = 900): Impulse {
  return {
    start,
    duration,
    at(e: number): BodyDelta {
      const u = clamp(e / duration, 0, 1);
      const d = noDelta();
      d.rotation = 5 * Math.sin(TAU * 3 * u) * (1 - u) * (1 - u);
      return d;
    },
  };
}

/** Flinch back and away, fast attack, damped return to level. */
function recoilImpulse(start: number, duration = 700): Impulse {
  const attack = 120;
  return {
    start,
    duration,
    at(e: number): BodyDelta {
      const d = noDelta();
      let k: number;
      if (e < attack) {
        k = easeOutQuad(e / attack);
      } else {
        const u = clamp((e - attack) / (duration - attack), 0, 1);
        k = Math.cos(TAU * 0.9 * u) * Math.exp(-3.5 * u) * (1 - u);
      }
      d.x = -2.5 * k;
      d.rotation = -4 * k;
      return d;
    },
  };
}

/** A quick flatten that holds a beat before springing back. */
function squashImpulse(start: number, squash: number, duration = 380): Impulse {
  const attack = 60;
  const hold = 160;
  return {
    start,
    duration,
    at(e: number): BodyDelta {
      const d = noDelta();
      let k: number;
      if (e < attack) k = easeOutQuad(e / attack);
      else if (e < hold) k = 1;
      else {
        const u = clamp((e - hold) / (duration - hold), 0, 1);
        k = Math.cos(TAU * 0.75 * u) * Math.exp(-3 * u) * (1 - u);
      }
      d.scaleY = 1 - 2 * squash * k;
      d.scaleX = 1 + 1.5 * squash * k;
      return d;
    },
  };
}

/** Five springs moving one part: x/y/rotation from 0, scales from 1. */
class PoseSprings {
  readonly x: Spring;
  readonly y: Spring;
  readonly rotation: Spring;
  readonly scaleX: Spring;
  readonly scaleY: Spring;

  constructor(config: SpringConfig) {
    this.x = new Spring(0, config);
    this.y = new Spring(0, config);
    this.rotation = new Spring(0, config);
    this.scaleX = new Spring(1, config);
    this.scaleY = new Spring(1, config);
  }

  /** Aim every channel at one offset. */
  setTarget(o: EyeOffset): void {
    this.x.target = o.x;
    this.y.target = o.y;
    this.rotation.target = o.rotation;
    this.scaleX.target = o.scaleX;
    this.scaleY.target = o.scaleY;
  }

  /** Return every channel to neutral. */
  neutral(): void {
    this.setTarget({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  }

  /** Advance all five channels by `dtMs` sim milliseconds. */
  step(dtMs: number): void {
    this.x.step(dtMs);
    this.y.step(dtMs);
    this.rotation.step(dtMs);
    this.scaleX.step(dtMs);
    this.scaleY.step(dtMs);
  }
}

/** Constructor options; `now` seeds the clock so the first tick has a base. */
export interface CreatureEngineOptions {
  seed?: number;
  tuning?: Partial<CreatureTuning>;
  reducedMotion?: boolean;
  now: number;
}

/** The deterministic animation engine behind `<ListenCreature />`. */
export class CreatureEngine {
  private tuning: CreatureTuning;
  private rng: Rng;
  private reducedMotion: boolean;

  // Clock. `t` is sim time; every schedule below is an absolute sim time.
  private lastNow: number;
  private t = 0;
  private stateT = 0;

  // Ambient phases, drawn from the seed so two creatures never breathe in sync.
  private readonly phase: readonly number[];
  private readonly noisePhase: readonly number[];

  // Body.
  private readonly lean = new PoseSprings(MEDIUM);
  private readonly exprBody = new PoseSprings(MEDIUM);
  private impulses: Impulse[] = [];
  private sway = false;
  private pulse = false;

  // Eyes.
  private readonly gazeX = new Spring(0, MEDIUM);
  private readonly gazeY = new Spring(0, MEDIUM);
  private readonly exprLeft = new PoseSprings(MEDIUM);
  private readonly exprRight = new PoseSprings(MEDIUM);
  private readonly asymLeft = new Spring(0, MEDIUM);
  private readonly asymRight = new Spring(0, MEDIUM);
  private blinks: Blink[] = [];

  // Brain.
  private _state: CreatureState = 'idle';
  private baseExpression: ExpressionName = 'neutral';
  private overrideExpression: ExpressionName | null = null;
  private overrideUntil = 0;
  private steps: Step[] = [];
  private nextBlink = 0;
  private nextWander = 0;
  private nextTilt = 0;
  private tiltUntil = 0;
  private nextGlance = 0;
  private nextSquint = 0;
  private nextDart = 0;
  private dartIndex = 0;
  private dartCount = 0;
  private gazeHoldUntil = 0;
  private gazeReleased = false;
  private idleAmbientOn = true;

  // Form. One at a time; `formStart` is a sim time like every other schedule.
  private formName: FormName = 'owl';
  private formStart = 0;
  /** The dot opacities the last dot-bearing frame drew, so `gather` continues them. */
  private readonly dotFade: [number, number, number] = [1, DOT_DIM, DOT_DIM];
  /** Where the 8 assemble particles start, as offsets from the body center. */
  private readonly particleOffsets: readonly Vec2[];
  /** A form's own eye displacement, added after the gaze clamp (they are leaving). */
  private formEyeX = 0;
  private formEyeY = 0;

  // Attention.
  private target: AttentionTarget | Vec2 = null;
  private targetVectors: Record<'input' | 'response' | 'result', Vec2> = {
    ...DEFAULT_TARGET_VECTORS,
  };
  private pointer: { dx: number; dy: number } | null = null;
  private pointerInside = false;
  private noticeUntil = 0;
  private noticeCooldownUntil = 0;

  constructor(opts: CreatureEngineOptions) {
    const seed = opts.seed ?? 1;
    this.tuning = { ...DEFAULT_TUNING, ...opts.tuning };
    this.reducedMotion = opts.reducedMotion ?? false;
    this.lastNow = opts.now;
    this.rng = new Rng(seed);

    const phaseRng = new Rng(seed ^ 0x9e3779b9);
    this.phase = [0, 1, 2, 3].map(() => phaseRng.range(0, TAU));
    this.noisePhase = [0, 1, 2, 3, 4, 5, 6, 7].map(() => phaseRng.range(0, TAU));

    // Drawn from their own stream so a given seed's particles are the same
    // whenever `assemble` is played, not a function of what ran before it.
    const particleRng = new Rng(seed ^ 0x51ed270b);
    this.particleOffsets = Array.from({ length: FORM_PARTICLE_COUNT }, (_, i) => {
      const a = (i / FORM_PARTICLE_COUNT) * TAU + particleRng.range(-0.28, 0.28);
      const r = particleRng.range(38, 62);
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

    this.enterState('idle');
  }

  /** What the creature is currently doing. */
  get state(): CreatureState {
    return this._state;
  }

  /** The form currently playing; `'owl'` when the form channel is at rest. */
  get form(): FormName {
    return this.formName;
  }

  // ---------------------------------------------------------------- inputs

  /** Switch behavior; springs carry the pose across, nothing cuts. */
  setState(s: CreatureState, now: number): void {
    this.advance(now);
    if (s === this._state) return;
    this.enterState(s);
  }

  /** Point attention at a named target, an explicit gaze direction, or nothing. */
  setTarget(t: AttentionTarget | Vec2 | null): void {
    this.target = t;
  }

  /** Override where the named attention targets live, as gaze directions. */
  setTargetVectors(v: NamedTargetVectors): void {
    this.targetVectors = { ...this.targetVectors, ...v };
  }

  /** Pointer offset from the creature's center, in creature widths. */
  setPointer(p: { dx: number; dy: number } | null): void {
    this.pointer = p === null ? null : { dx: p.dx, dy: p.dy };
    if (p === null) this.pointerInside = false;
  }

  /** Merge new tuning; takes effect on the next composed frame. */
  setTuning(t: Partial<CreatureTuning>): void {
    this.tuning = { ...this.tuning, ...t };
  }

  /** Reduced motion stills the body and stops darting; blinks stay. */
  setReducedMotion(b: boolean): void {
    this.reducedMotion = b;
    if (b) {
      this.impulses = [];
      this.lean.neutral();
      this.cancelForm();
    }
  }

  /**
   * Play one form, from now, replacing whatever was playing. Looping forms
   * (`dots`, `peek`) hold until something else starts; one-shot forms settle
   * and then keep emitting their last frame, so `pour` ends ON the three dots
   * and `slide-left` stays gone.
   *
   * Under reduced motion this is a NO-OP — `form` stays `'owl'`, which is how
   * a caller tells the form was refused and settles its sequence itself.
   */
  startForm(name: FormName): void {
    if (name === 'owl') {
      this.cancelForm();
      return;
    }
    if (this.reducedMotion) return;
    this.formName = name;
    this.formStart = this.t;
  }

  /** Drop the active form at once and go back to the ordinary owl. */
  cancelForm(): void {
    this.formName = 'owl';
    this.formStart = this.t;
  }

  // --------------------------------------------------------------- actions

  /** A full jump. */
  hop(): void {
    this.addImpulse(hopImpulse(this.t, 6, 420, this.tuning.squash, true));
  }

  /** One full spin. */
  twirl(): void {
    this.addImpulse(twirlImpulse(this.t));
  }

  /** Blink now, on top of whatever the schedule was going to do. */
  blink(): void {
    this.startBlink();
  }

  /** Narrow the eyes for a moment. */
  squint(ms = 500): void {
    this.express('squint', ms);
  }

  /** Flatten and spring back. */
  squash(): void {
    this.addImpulse(squashImpulse(this.t, this.tuning.squash));
  }

  /** Rock side to side. */
  wobble(): void {
    this.addImpulse(wobbleImpulse(this.t));
  }

  /** Pleased: a held `satisfied` and one or two bounces. */
  celebrate(): void {
    this.express('satisfied', 1200);
    this.bounce();
    if (this.rng.chance(0.5)) {
      this.steps.push({ at: this.t + 250, run: () => this.bounce() });
      this.sortSteps();
    }
  }

  /** Look somewhere explicitly, then hand the gaze back to the behaviors. */
  lookAt(dir: Vec2, holdMs = 1500): void {
    this.setGaze(clampDisc(dir), SNAPPY);
    this.gazeHoldUntil = this.t + holdMs;
  }

  /** Wear an expression temporarily; the state's base returns after `holdMs`. */
  express(name: ExpressionName, holdMs = 1200): void {
    this.overrideExpression = name;
    this.overrideUntil = this.t + holdMs;
  }

  // ------------------------------------------------------------------ tick

  /** Advance to `now` (ms) and return the composed frame. */
  tick(now: number): CreatureFrame {
    this.advance(now);
    this.runSteps();
    this.brain();
    this.pruneImpulses();
    this.pruneBlinks();
    return this.compose();
  }

  /**
   * Move the clock and the springs to `now`.
   *
   * A gap over a second means the tab was hidden, rAF was throttled or a
   * debugger stopped the world: the creature must NOT burst-catch-up, so the
   * gap is spent as a single 16 ms frame. Because every schedule is an
   * absolute SIM time and sim time only advances here, not advancing `t` is
   * exactly equivalent to shifting every scheduled time forward by the gap.
   */
  private advance(now: number): void {
    let dt = now - this.lastNow;
    this.lastNow = now;
    if (!Number.isFinite(dt) || dt <= 0) dt = 0;
    else if (dt > 1000) dt = 16;
    else if (dt > 50) dt = 50;

    const sim = dt * this.tuning.speed;
    if (sim <= 0) return;
    this.t += sim;
    this.stepSprings(sim);
  }

  private stepSprings(dtMs: number): void {
    this.lean.step(dtMs);
    this.exprBody.step(dtMs);
    this.exprLeft.step(dtMs);
    this.exprRight.step(dtMs);
    this.gazeX.step(dtMs);
    this.gazeY.step(dtMs);
    this.asymLeft.step(dtMs);
    this.asymRight.step(dtMs);
  }

  // ----------------------------------------------------------------- brain

  private brain(): void {
    if (this.overrideExpression !== null && this.t >= this.overrideUntil) {
      this.overrideExpression = null;
    }
    if (this.gazeHoldUntil !== 0 && this.t >= this.gazeHoldUntil) {
      this.gazeHoldUntil = 0;
      this.gazeReleased = true;
    }

    this.applyPointer();

    switch (this._state) {
      case 'idle':
        this.brainIdle();
        break;
      case 'listening':
        this.brainListening();
        break;
      case 'thinking':
        this.brainThinking();
        break;
      case 'searching':
        this.brainSearching();
        break;
      case 'success':
        this.brainSuccess();
        break;
      case 'executing':
      case 'error':
        // Both are driven entirely by their entry sequence (`steps`).
        break;
    }

    this.scheduleBlink();
    this.applyExpression();
  }

  /** Wander and head-tilt: the quiet aliveness idle (and settled success) has. */
  private idleAmbient(): void {
    if (this.noticeUntil !== 0) return;

    if (this.gazeReleased) {
      this.gazeReleased = false;
      this.setGaze({ x: 0, y: 0 }, SOFT);
    }
    if (!this.gazeBusy() && this.t >= this.nextWander) {
      this.nextWander = this.t + this.rng.range(4000, 10000);
      const skip = this.rng.chance(0.3);
      const r = 0.55 * Math.sqrt(this.rng.next());
      const a = this.rng.range(0, TAU);
      const hold = this.rng.range(900, 2500);
      if (!skip && !this.reducedMotion) {
        this.setGaze({ x: r * Math.cos(a), y: r * Math.sin(a) }, SOFT);
        this.gazeHoldUntil = this.t + hold;
      }
    }

    if (this.tiltUntil !== 0 && this.t >= this.tiltUntil) {
      this.tiltUntil = 0;
      this.lean.rotation.target = 0;
    }
    if (this.t >= this.nextTilt) {
      this.nextTilt = this.t + this.rng.range(12000, 25000);
      const sign = this.rng.chance(0.5) ? 1 : -1;
      const amount = this.rng.range(2, 3.5);
      const hold = this.rng.range(1500, 3000);
      if (!this.reducedMotion) {
        this.lean.rotation.target = this.clampTilt(sign * amount);
        this.tiltUntil = this.t + hold;
      }
    }
  }

  private brainIdle(): void {
    this.idleAmbient();
  }

  private brainListening(): void {
    const dir = this.attentionDir();
    if (!this.gazeBusy()) {
      this.setGaze(dir, this.t - this.stateT < 350 ? SNAPPY : MEDIUM);
    }
    if (!this.reducedMotion) {
      this.lean.x.target = dir.x * 1.2;
      this.lean.y.target = dir.y * 0.6;
      this.lean.rotation.target = this.clampTilt(dir.x * 2.5);
    }
  }

  private brainThinking(): void {
    if (this.gazeBusy()) return;
    if (this.gazeReleased) {
      this.gazeReleased = false;
      this.setGaze({ x: 0, y: 0 }, MEDIUM);
      this.asymLeft.target = 0;
      this.asymRight.target = 0;
    }
    if (this.t >= this.nextGlance) {
      this.nextGlance = this.t + this.rng.range(1800, 3600);
      const dir = this.rng.pick(THINKING_GLANCES);
      const hold = this.rng.range(700, 1600);
      const flip = this.rng.chance(0.5);
      if (!this.reducedMotion) {
        this.setGaze(dir, MEDIUM);
        this.gazeHoldUntil = this.t + hold;
        this.asymLeft.target = flip ? -0.2 : 0.1;
        this.asymRight.target = flip ? 0.1 : -0.2;
      }
    }
    if (this.t >= this.nextSquint) {
      this.nextSquint = this.t + this.rng.range(5000, 9000);
      const take = this.rng.chance(0.5);
      const ms = this.rng.range(350, 600);
      if (take) this.express('squint', ms);
    }
  }

  private brainSearching(): void {
    if (this.gazeBusy() || this.t < this.nextDart) return;
    this.nextDart = this.t + this.rng.range(650, 1300);

    const base = SCAN_PATTERN[this.dartIndex % SCAN_PATTERN.length];
    this.dartIndex += 1;
    const dir = clampDisc({
      x: base.x + this.rng.range(-0.1, 0.1),
      y: base.y + this.rng.range(-0.1, 0.1),
    });
    const kick = this.rng.chance(0.25);
    const kickSign = this.rng.chance(0.5) ? 1 : -1;

    if (this.reducedMotion) {
      this.setGaze({ x: 0, y: 0 }, SOFT);
      return;
    }
    this.setGaze(dir, SNAPPY);
    this.lean.x.target = dir.x * 0.4;
    this.lean.y.target = dir.y * 0.4;
    this.lean.rotation.target = this.clampTilt(dir.x * 2 + (kick ? kickSign * 2 : 0));

    this.dartCount += 1;
    if (this.dartCount % 3 === 0) this.startBlink();
  }

  private brainSuccess(): void {
    if (this.idleAmbientOn) this.idleAmbient();
  }

  /** Pointer rules, which differ per state; most states ignore it entirely. */
  private applyPointer(): void {
    const p = this.pointer;
    const canNotice = this._state === 'idle' || (this._state === 'success' && this.idleAmbientOn);

    if (canNotice) {
      if (p === null) {
        this.pointerInside = false;
        if (this.noticeUntil !== 0) this.endNotice();
        return;
      }
      const dist = Math.hypot(p.dx, p.dy);
      const inside = dist <= this.tuning.noticeRadius;

      if (this.noticeUntil !== 0) {
        if (!inside || this.t >= this.noticeUntil) this.endNotice();
        else this.setGaze(this.pointerDir(p), MEDIUM);
        this.pointerInside = inside;
        return;
      }
      if (inside && !this.pointerInside && this.t >= this.noticeCooldownUntil) {
        const notice = this.rng.chance(0.7);
        const follow = this.rng.range(1500, 4000);
        if (notice && !this.reducedMotion) {
          this.setGaze(this.pointerDir(p), MEDIUM);
          this.noticeUntil = this.t + follow;
          this.gazeHoldUntil = this.noticeUntil;
        }
      }
      this.pointerInside = inside;
      return;
    }

    if (this._state === 'thinking' && p !== null) {
      const dist = Math.hypot(p.dx, p.dy);
      if (dist <= 1.2 && this.t >= this.noticeCooldownUntil && !this.gazeBusy()) {
        this.setGaze(this.pointerDir(p), SNAPPY);
        this.gazeHoldUntil = this.t + 600;
        this.noticeCooldownUntil = this.t + 5000;
      }
    }
    // listening reads the pointer through `attentionDir`; the rest ignore it.
  }

  private endNotice(): void {
    this.noticeUntil = 0;
    this.gazeHoldUntil = 0;
    this.gazeReleased = true;
    this.noticeCooldownUntil = this.t + this.rng.range(3000, 8000);
  }

  private scheduleBlink(): void {
    if (this.t < this.nextBlink) return;
    const [lo, hi] = BLINK_RANGES[this._state];
    this.nextBlink = this.t + this.rng.range(lo, hi);
    this.startBlink();
  }

  private startBlink(): void {
    const lag = this.rng.range(0, 15);
    const double = this.rng.chance(0.1);
    this.blinks.push({ start: this.t, lag });
    if (double) this.blinks.push({ start: this.t + 180, lag });
  }

  private applyExpression(): void {
    const name = this.overrideExpression ?? this.baseExpression;
    const e = EXPRESSIONS[name];
    this.exprLeft.setTarget(e.left);
    this.exprRight.setTarget(e.right);
    if (e.body) this.exprBody.setTarget(e.body);
    else this.exprBody.neutral();
  }

  // ------------------------------------------------------------ transitions

  private enterState(s: CreatureState): void {
    this._state = s;
    this.stateT = this.t;
    this.steps = [];
    this.gazeHoldUntil = 0;
    this.gazeReleased = false;
    this.noticeUntil = 0;
    this.noticeCooldownUntil = 0;
    this.pointerInside = false;
    this.overrideExpression = null;
    this.overrideUntil = 0;
    this.baseExpression = BASE_EXPRESSIONS[s];
    this.sway = false;
    this.pulse = false;
    this.idleAmbientOn = s === 'idle';
    this.tiltUntil = 0;
    this.dartIndex = 0;
    this.dartCount = 0;
    this.asymLeft.target = 0;
    this.asymRight.target = 0;
    this.lean.neutral();
    // A form belongs to the moment that started it; a new behavior ends it.
    this.cancelForm();

    const [lo, hi] = BLINK_RANGES[s];
    this.nextBlink = this.t + this.rng.range(lo, hi);
    this.nextWander = this.t + this.rng.range(4000, 10000);
    this.nextTilt = this.t + this.rng.range(12000, 25000);

    switch (s) {
      case 'idle':
        this.setGaze({ x: 0, y: 0 }, SOFT);
        break;
      case 'listening':
        this.setGaze(this.attentionDir(), SNAPPY);
        this.addImpulse(hopImpulse(this.t, 1.5, 260, 0, false));
        break;
      case 'thinking':
        this.sway = true;
        this.nextGlance = this.t + this.rng.range(1800, 3600);
        this.nextSquint = this.t + this.rng.range(5000, 9000);
        break;
      case 'searching':
        this.nextDart = this.t + 120;
        break;
      case 'executing':
        this.enterExecuting();
        break;
      case 'success':
        this.enterSuccess();
        break;
      case 'error':
        this.enterError();
        break;
    }
  }

  /** Compress, hold, then commit — the one state that reads as decisive. */
  private enterExecuting(): void {
    this.setGaze({ x: 0, y: 0.05 }, SNAPPY);
    this.compress(true);
    const spin = this.rng.chance(0.12);
    this.steps = [
      {
        at: this.t + 450,
        run: () => {
          this.compress(false);
          if (spin) this.twirl();
          else this.hop();
        },
      },
      { at: this.t + 1100, run: () => (this.pulse = true) },
    ];
  }

  private enterSuccess(): void {
    this.express('satisfied', 900);
    this.steps = [
      { at: this.t + 60, run: () => this.bounce() },
      {
        at: this.t + 1200,
        run: () => {
          this.idleAmbientOn = true;
          this.nextWander = this.t + this.rng.range(1000, 4000);
        },
      },
    ];
  }

  private enterError(): void {
    this.addImpulse(recoilImpulse(this.t));
    // Alarm holds 600 ms, then 500 ms of nothing at all, then it recovers.
    this.steps = [
      {
        at: this.t + 1100,
        run: () => {
          this.baseExpression = 'alert';
          this.setGaze({ x: 0, y: 0.2 }, MEDIUM);
        },
      },
    ];
    this.nextBlink = this.t + 3000;
  }

  /** Hold a compressed stance (a lean target, so it can last) or let it go. */
  private compress(on: boolean): void {
    if (this.reducedMotion) return;
    this.lean.scaleY.target = on ? 1 - 1.3 * this.tuning.squash : 1;
    this.lean.scaleX.target = on ? 1 + this.tuning.squash : 1;
  }

  private runSteps(): void {
    while (this.steps.length > 0 && this.t >= this.steps[0].at) {
      const step = this.steps.shift();
      if (step) step.run();
    }
  }

  private sortSteps(): void {
    this.steps.sort((a, b) => a.at - b.at);
  }

  // ------------------------------------------------------------- utilities

  /** A small jump with no wind-up: `success` and `celebrate` punctuate with it. */
  private bounce(): void {
    this.addImpulse(hopImpulse(this.t, 3, 320, this.tuning.squash, false));
  }

  private addImpulse(im: Impulse): void {
    if (this.reducedMotion) return;
    this.impulses.push(im);
  }

  private pruneImpulses(): void {
    for (let i = this.impulses.length - 1; i >= 0; i -= 1) {
      const im = this.impulses[i];
      if (this.t - im.start >= im.duration) this.impulses.splice(i, 1);
    }
  }

  private pruneBlinks(): void {
    while (this.blinks.length > 0) {
      const b = this.blinks[0];
      if (this.t < b.start + b.lag + BLINK_TOTAL_MS) break;
      this.blinks.shift();
    }
  }

  private gazeBusy(): boolean {
    return this.gazeHoldUntil > this.t;
  }

  private setGaze(dir: Vec2, config: SpringConfig): void {
    const d = clampDisc(dir);
    this.gazeX.setConfig(config);
    this.gazeY.setConfig(config);
    this.gazeX.target = d.x;
    this.gazeY.target = d.y;
  }

  private clampTilt(deg: number): number {
    return clamp(deg, -this.tuning.bodyTilt, this.tuning.bodyTilt);
  }

  /** A pointer offset, in creature widths, as a gaze direction. */
  private pointerDir(p: { dx: number; dy: number }): Vec2 {
    return clampDisc({
      x: p.dx / POINTER_FULL_GAZE_WIDTHS,
      y: p.dy / POINTER_FULL_GAZE_WIDTHS,
    });
  }

  /** Where `listening` should be looking, given the target prop and pointer. */
  private attentionDir(): Vec2 {
    const t = this.target;
    if (t !== null && typeof t === 'object') return clampDisc(t);
    if (t === 'pointer') {
      return this.pointer === null ? this.targetVectors.input : this.pointerDir(this.pointer);
    }
    if (t === 'response' || t === 'result' || t === 'input')
      return clampDisc(this.targetVectors[t]);
    return clampDisc(this.targetVectors.input);
  }

  // --------------------------------------------------------------- compose

  private compose(): CreatureFrame {
    // The form runs first: it publishes the eye displacement the eyes read.
    const form = this.composeForm();
    return {
      body: this.composeBody(),
      left: this.composeEye(0),
      right: this.composeEye(1),
      form,
    };
  }

  // ------------------------------------------------------------ form channel

  /** Resolve the active form at `t` into pure data. Nothing here is stateful. */
  private composeForm(): FormState {
    this.formEyeX = 0;
    this.formEyeY = 0;
    const kind = this.formName;
    if (kind === 'owl' || this.reducedMotion) return OWL_FORM;

    const duration = FORM_MS[kind];
    const loops = LOOPING_FORMS.has(kind);
    const elapsed = this.t - this.formStart;
    const t01 = loops ? (elapsed % duration) / duration : clamp(elapsed / duration, 0, 1);

    const form: FormState = {
      kind,
      t01,
      done: !loops && t01 >= 1,
      loops,
      body: restBody(),
      eyesVisible: true,
      dots: [],
      particles: [],
    };

    switch (kind) {
      case 'pour':
        this.formPour(form);
        break;
      case 'dots':
        this.formDots(form);
        break;
      case 'gather':
        this.formGather(form);
        break;
      case 'slide-left':
        this.formSlideLeft(form);
        break;
      case 'peek':
        this.formPeek(form);
        break;
      case 'head-turn':
        this.formHeadTurn(form);
        break;
      case 'assemble':
        this.formAssemble(form);
        break;
    }
    return form;
  }

  /**
   * thinking — the body sags (scaleY .88 / scaleX 1.08) and pours into
   * three dots left → right; the eyes sink into the dot line and are gone
   * by the end. Last frame: three dots, no owl, no eyes — and already
   * wearing the dot-wave's phase-0 brightness, so `dots` picks it up
   * without a step.
   *
   * The sag was .7 / 1.2 with the fade starting at u=.42 — a fully opaque
   * flatten the owner read as "the animation is messed up, squished"
   * (2026-08-24) at the gap row's 32px. The melt survives at 12%, and the
   * fade starts INSIDE the sag so the deepest deformation is mostly gone
   * from view.
   */
  private formPour(form: FormState): void {
    const u = form.t01;
    const sag = easeOutQuad(seg(u, 0, 0.45));
    form.body.extraScaleY = 1 - 0.12 * sag;
    form.body.extraScaleX = 1 + 0.08 * sag;
    form.body.extraY = 2.5 * sag;
    form.body.opacity = 1 - easeInQuad(seg(u, 0.3, 1));
    form.eyesVisible = u < 0.62;
    this.formEyeY = 4 * sag;

    const dots: FormDot[] = [];
    for (let i = 0; i < DOT_XS.length; i += 1) {
      const k = easeOutQuad(seg(u, 0.42 + i * 0.13, 0.66 + i * 0.13));
      const opacity = k * (i === 0 ? 1 : DOT_DIM);
      this.dotFade[i] = opacity;
      dots.push({ x: DOT_XS[i], y: DOT_Y, r: DOT_R * k, opacity });
    }
    form.dots = dots;
  }

  /**
   * The hold — brightness travels left → right over the three dots, one at
   * full and the others at .4, one cycle per 1.2 s. Phase comes from a modulo
   * of sim time, never an accumulator, so ten minutes of it cannot drift.
   */
  private formDots(form: FormState): void {
    const p = form.t01;
    form.body.opacity = 0;
    form.eyesVisible = false;

    const dots: FormDot[] = [];
    for (let i = 0; i < DOT_XS.length; i += 1) {
      // Wrapped distance from this dot's slot in the cycle, in [0, .5].
      const d = Math.abs(((((p - i / 3) % 1) + 1.5) % 1) - 0.5);
      const k = d >= 1 / 3 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * 3 * d);
      const opacity = DOT_DIM + (1 - DOT_DIM) * k;
      this.dotFade[i] = opacity;
      dots.push({ x: DOT_XS[i], y: DOT_Y, r: DOT_R, opacity });
    }
    form.dots = dots;
  }

  /** The dots draw back together and he is whole again — the pour,
   *  reversed, at the pour's own softened 12% sag. */
  private formGather(form: FormState): void {
    const u = form.t01;
    const rise = easeOutQuad(seg(u, 0.3, 1));
    form.body.extraScaleY = 0.88 + 0.12 * rise;
    form.body.extraScaleX = 1.08 - 0.08 * rise;
    form.body.extraY = 2.5 * (1 - rise);
    form.body.opacity = easeOutQuad(seg(u, 0.3, 0.8));
    form.eyesVisible = u >= 0.5;
    this.formEyeY = 4 * (1 - rise);

    const dots: FormDot[] = [];
    for (let i = 0; i < DOT_XS.length; i += 1) {
      const k = 1 - easeInQuad(seg(u, i * 0.06, 0.45 + i * 0.06));
      dots.push({
        x: DOT_XS[i] + (BODY_CENTER.x - DOT_XS[i]) * (1 - k),
        y: DOT_Y,
        r: DOT_R * k,
        opacity: this.dotFade[i] * k,
      });
    }
    form.dots = dots;
  }

  /**
   * The handoff to text — 70 units left with a 1.08 / .93 smear, fading out.
   * Terminal: he holds the empty last frame until something starts him again.
   */
  private formSlideLeft(form: FormState): void {
    const u = form.t01;
    const smear = Math.sin(Math.PI * u);
    form.body.extraX = -70 * easeInQuad(u);
    form.body.extraScaleX = 1 + 0.08 * smear;
    form.body.extraScaleY = 1 - 0.07 * smear;
    form.body.opacity = 1 - easeInQuad(u);
  }

  /**
   * searching — a BEHAVIOUR, not a morph (spec §3.4): the whole owl ducks
   * below the line, pops up 30 units right with a .97 / 1.06 overshoot and a
   * glance left, then goes back the way it came. 1.6 s per cycle, looping.
   */
  private formPeek(form: FormState): void {
    const p = form.t01 * FORM_MS.peek;
    const b = form.body;

    if (p < PEEK_T1) {
      const a = easeInQuad(p / PEEK_DUCK);
      b.extraY = 14 * a;
      b.extraScaleX = 1 + 0.06 * a;
      b.extraScaleY = 1 - 0.08 * a;
    } else if (p < PEEK_T2) {
      b.extraY = 14;
      b.extraScaleX = 1.06;
      b.extraScaleY = 0.92;
    } else if (p < PEEK_T3) {
      const a = (p - PEEK_T2) / PEEK_POP;
      const k = easeOutCubic(a);
      const o = Math.sin(Math.PI * a);
      b.extraY = 14 * (1 - k);
      b.extraX = 30 * k;
      b.extraScaleX = 1 - 0.03 * o;
      b.extraScaleY = 1 + 0.06 * o;
    } else if (p < PEEK_T4) {
      b.extraX = 30;
      // The glance: eased in and back out so it reads as a look, not a jump.
      const a = (p - PEEK_T3) / PEEK_UP;
      this.formEyeX = -0.8 * this.tuning.eyeRange * Math.sin(Math.PI * a);
    } else if (p < PEEK_T5) {
      const a = easeInQuad((p - PEEK_T4) / PEEK_DUCK);
      b.extraX = 30;
      b.extraY = 14 * a;
      b.extraScaleX = 1 + 0.06 * a;
      b.extraScaleY = 1 - 0.08 * a;
    } else if (p < PEEK_T6) {
      b.extraX = 30;
      b.extraY = 14;
      b.extraScaleX = 1.06;
      b.extraScaleY = 0.92;
    } else if (p < PEEK_T7) {
      const a = (p - PEEK_T6) / PEEK_POP;
      const k = easeOutCubic(a);
      const o = Math.sin(Math.PI * a);
      b.extraY = 14 * (1 - k);
      b.extraX = 30 * (1 - k);
      b.extraScaleX = 1 - 0.03 * o;
      b.extraScaleY = 1 + 0.06 * o;
    }
    // The tail of the cycle is rest, at home: `restBody()` already is that.
  }

  /** One look-around: a squash to a .30 profile, a beat, and back. Once. */
  private formHeadTurn(form: FormState): void {
    const p = form.t01 * FORM_MS['head-turn'];
    let sx = 0.3;
    if (p < 500) sx = 1 - 0.7 * easeInOutCubic(p / 500);
    else if (p >= 900) sx = 0.3 + 0.7 * easeInOutCubic((p - 900) / 500);
    form.body.extraScaleX = sx;
    // Volume, roughly: the narrower the profile, the taller he stands.
    form.body.extraScaleY = 1 + 0.04 * ((1 - sx) / 0.7);
  }

  /** arrive — 8 particles converge and the last frame is the ordinary owl. */
  private formAssemble(form: FormState): void {
    const u = form.t01;
    const k = easeOutCubic(u);
    const fade = 1 - easeInQuad(seg(u, 0.35, 1));

    const particles: FormDot[] = [];
    for (let i = 0; i < this.particleOffsets.length; i += 1) {
      const o = this.particleOffsets[i];
      particles.push({
        x: BODY_CENTER.x + o.x * (1 - k),
        y: BODY_CENTER.y + o.y * (1 - k),
        r: 3.4 * (1 - easeInQuad(u)),
        opacity: fade,
      });
    }
    form.particles = particles;

    const grow = easeOutQuad(seg(u, 0.45, 1));
    form.body.opacity = grow;
    form.body.extraScaleX = 0.94 + 0.06 * grow;
    form.body.extraScaleY = 0.94 + 0.06 * grow;
    form.eyesVisible = u >= 0.55;
  }

  private composeBody(): BodyPose {
    const T = this.tuning;
    const pose: BodyPose = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

    if (!this.reducedMotion) {
      const amp = this.pulse ? T.breath * 2 : T.breath;
      const period = this.pulse ? 2300 : 4600;
      const s = 1 + amp * Math.sin((TAU * this.t) / period + this.phase[0]);
      pose.scaleY = s;
      pose.scaleX = 1 + 0.6 * (s - 1);

      pose.y = T.floatAmp * Math.sin((TAU * this.t) / 6300 + this.phase[1]);
      pose.x = 0.4 * T.floatAmp * Math.sin((TAU * this.t) / 9100 + this.phase[2]);
      pose.rotation = 0.6 * Math.sin((TAU * this.t) / 7700 + this.phase[3]);

      if (this.sway) {
        pose.rotation += 1.5 * Math.sin((TAU * this.t) / 3400);
        pose.x += 0.8 * Math.sin((TAU * this.t) / 5200);
      }

      pose.x += this.lean.x.value;
      pose.y += this.lean.y.value;
      pose.rotation += this.lean.rotation.value;
      pose.scaleX *= this.lean.scaleX.value;
      pose.scaleY *= this.lean.scaleY.value;

      for (const im of this.impulses) {
        const d = im.at(this.t - im.start);
        pose.x += d.x;
        pose.y += d.y;
        pose.rotation += d.rotation;
        pose.scaleX *= d.scaleX;
        pose.scaleY *= d.scaleY;
      }
    }

    // An expression's body inflection is a POSE, not motion, so it survives
    // reduced motion — at neutral every channel is exactly 0/1 anyway.
    pose.x += this.exprBody.x.value;
    pose.y += this.exprBody.y.value;
    pose.rotation += this.exprBody.rotation.value;
    pose.scaleX *= this.exprBody.scaleX.value;
    pose.scaleY *= this.exprBody.scaleY.value;

    return pose;
  }

  private composeEye(side: 0 | 1): EyePose {
    const T = this.tuning;
    const expr = side === 0 ? this.exprLeft : this.exprRight;
    const asym = side === 0 ? this.asymLeft : this.asymRight;
    const gx = this.gazeX.value;
    const gy = this.gazeY.value;

    const pose: EyePose = {
      x: gx * T.eyeRange + expr.x.value,
      y: gy * 0.8 * T.eyeRange + expr.y.value + asym.value,
      rotation: gx * 0.3 * T.eyeRotation + expr.rotation.value,
      scaleX: expr.scaleX.value,
      scaleY: expr.scaleY.value * this.blinkAt(side),
    };

    // Micro-noise is ambient eye motion, so it goes quiet with reduced motion.
    if (!this.reducedMotion && (this._state === 'idle' || this._state === 'thinking')) {
      const o = side * 4;
      pose.x += this.microNoise(this.noisePhase[o], this.noisePhase[o + 1]);
      pose.y += this.microNoise(this.noisePhase[o + 2], this.noisePhase[o + 3]);
    }

    const max = 1.15 * T.eyeRange;
    const r = Math.hypot(pose.x, pose.y);
    if (r > max && r > 0) {
      const k = max / r;
      pose.x *= k;
      pose.y *= k;
    }
    pose.scaleX = clamp(pose.scaleX, 0.04, 1.6);
    pose.scaleY = clamp(pose.scaleY, 0.04, 1.6);
    const rotMax = T.eyeRotation + 12;
    pose.rotation = clamp(pose.rotation, -rotMax, rotMax);

    // A form's eye displacement is added AFTER the gaze clamp on purpose: in
    // `pour` the marks are leaving the face, which the clamp exists to stop.
    pose.x += this.formEyeX;
    pose.y += this.formEyeY;
    return pose;
  }

  private microNoise(pa: number, pb: number): number {
    const a = Math.sin((TAU * this.t) / 3100 + pa);
    const b = Math.sin((TAU * this.t) / 5300 + pb);
    return (0.15 * (a + b)) / 2;
  }

  private blinkAt(side: 0 | 1): number {
    let f = 1;
    for (const b of this.blinks) {
      const e = this.t - b.start - (side === 1 ? b.lag : 0);
      const v = blinkFactor(e);
      if (v < f) f = v;
    }
    return f;
  }
}

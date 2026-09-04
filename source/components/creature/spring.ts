/**
 * One-dimensional critically-tunable spring, integrated with semi-implicit
 * Euler in fixed substeps of at most 16 ms.
 *
 * Substepping is what makes a dropped frame (or a 50 ms clamp after a stall)
 * behave like several small steps instead of one explosive one, so the same
 * spring is stable at 120 Hz and at 20 Hz. Time comes in as MILLISECONDS
 * because that is what the engine's clock speaks; internally it is seconds,
 * which is what the stiffness/damping units assume.
 */

/** Stiffness (1/s²) and damping (1/s) of a spring. */
export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Slow and loose — wander, look-away, anything unhurried. */
export const SOFT: SpringConfig = { stiffness: 40, damping: 11 };

/** The default: arrives promptly, barely overshoots. */
export const MEDIUM: SpringConfig = { stiffness: 90, damping: 15 };

/** Darts, notices, locks — fast and near-critical. */
export const SNAPPY: SpringConfig = { stiffness: 220, damping: 22 };

/** Deliberately springy; used where a little overshoot reads as alive. */
export const BOUNCY: SpringConfig = { stiffness: 170, damping: 11 };

const MAX_SUBSTEP_MS = 16;

/** A single spring value chasing `target`. */
export class Spring {
  /** Where the spring is being pulled to; write it freely between steps. */
  target: number;

  private v = 0;
  private x: number;
  private stiffness: number;
  private damping: number;

  constructor(value: number, config: SpringConfig) {
    this.x = value;
    this.target = value;
    this.stiffness = config.stiffness;
    this.damping = config.damping;
  }

  /** Current position. */
  get value(): number {
    return this.x;
  }

  /** Current rate of change, in units per second. */
  get velocity(): number {
    return this.v;
  }

  /** Swap the response curve (e.g. SNAPPY for a dart) without losing motion. */
  setConfig(config: SpringConfig): void {
    this.stiffness = config.stiffness;
    this.damping = config.damping;
  }

  /** Jump to a value, killing velocity — for construction/reset only. */
  reset(value: number): void {
    this.x = value;
    this.target = value;
    this.v = 0;
  }

  /** Advance by `dtMs` milliseconds, in substeps of at most 16 ms. */
  step(dtMs: number): void {
    if (!(dtMs > 0)) return;
    const steps = Math.max(1, Math.ceil(dtMs / MAX_SUBSTEP_MS));
    const h = dtMs / steps / 1000;
    for (let i = 0; i < steps; i += 1) {
      const a = -this.stiffness * (this.x - this.target) - this.damping * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }

  /** True once the spring is within `eps` of target and has all but stopped. */
  settled(eps = 0.001): boolean {
    return Math.abs(this.target - this.x) <= eps && Math.abs(this.v) <= eps * 10;
  }
}

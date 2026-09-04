/**
 * Seeded PRNG (mulberry32) — the ONLY source of randomness in the creature.
 *
 * Every behavior draw goes through one instance owned by the engine, so the
 * same seed plus the same tick sequence reproduces the same frames exactly.
 * `Math.random` and `Date` are never used anywhere in this folder.
 */

/** A deterministic random stream; cheap to construct, one per creature. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // Coerce to a non-zero uint32 so any number (0, negatives, floats) is usable.
    this.s = Math.trunc(seed) >>> 0 || 1;
  }

  /** Next value in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform value in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** True with probability `p` (p <= 0 never, p >= 1 always). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
}

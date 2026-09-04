/**
 * Per-user pixel invaders: the default account art.
 *
 * Deterministic and pure — the same seed always paints the same creature,
 * so the tile is stable across reloads, tabs and devices without storing
 * anything. The seed is identity available at mount (the Clerk user id),
 * which is the whole point: nothing here waits on a fetch.
 *
 * The silhouettes are hand-authored rather than generated. Random symmetric
 * noise reads as noise; these read as little creatures at 24px, which is the
 * size that matters.
 */

/** Band letters: `_` is ground, `h`/`b`/`l` are the head/body/legs bands. */
export type PixelAvatarSpec = {
  grid: string[];
  colors: { h: string; b: string; l: string };
};

/** The frens confetti family. */
export const PIXEL_AVATAR_PALETTE = [
  '#38bdf8',
  '#8b5cf6',
  '#f052d2',
  '#37d67a',
  '#fbbf24',
] as const;

export const PIXEL_AVATAR_GROUND = '#171a21';

/** The classic crab. */
const S1 = [
  '__h__h__',
  '___hh___',
  '__hhhh__',
  '_bb__bb_',
  'bbbbbbbb',
  'b_bbbb_b',
  'l_l__l_l',
  '__l__l__',
];

/** Squid: narrow domed head, splayed tentacles. */
const S2 = [
  '___hh___',
  '__hhhh__',
  '_hhhhhh_',
  'bb_bb_bb',
  'bbbbbbbb',
  '__l__l__',
  '_l_ll_l_',
  'l_l__l_l',
];

/** Octopus: broad hooded head with a two-pixel eye gap. */
const S3 = [
  '_hhhhhh_',
  'hhhhhhhh',
  'hh_hh_hh',
  'hhhhhhhh',
  '__bbbb__',
  '_b_bb_b_',
  'l_l__l_l',
  '_l____l_',
];

/**
 * Tank: the thing shooting back — cannon, sloped turret, tracked base.
 * The hull stays SOLID on purpose; an eye-gap row here read as a face and
 * turned the whole shape into a mushroom.
 */
const S4 = [
  '___hh___',
  '___hh___',
  '__hhhh__',
  '_hhhhhh_',
  'bbbbbbbb',
  'bbbbbbbb',
  'll_ll_ll',
  '_l_ll_l_',
];

export const PIXEL_AVATAR_SILHOUETTES: ReadonlyArray<readonly string[]> = [S1, S2, S3, S4];

/** FNV-1a, 32-bit. Small, stable, and identical in every runtime. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 — one stir between draws so the picks don't share low bits. */
function stir(state: number): number {
  let x = state;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x >>> 0;
}

/**
 * Silhouette plus an ordered triple of three distinct palette colors —
 * 4 shapes x 60 orderings = 240 distinguishable invaders.
 */
export function pixelAvatarSpec(seed: string): PixelAvatarSpec {
  let state = hashSeed(seed) || 1;
  const shape = PIXEL_AVATAR_SILHOUETTES[state % PIXEL_AVATAR_SILHOUETTES.length] ?? S1;

  const pool: string[] = [...PIXEL_AVATAR_PALETTE];
  const draw = (): string => {
    state = stir(state);
    const [picked] = pool.splice(state % pool.length, 1);
    return picked ?? PIXEL_AVATAR_GROUND;
  };

  return { grid: [...shape], colors: { h: draw(), b: draw(), l: draw() } };
}

/** Paints the 8x8 into a context whose units are cells, not pixels. */
export function drawPixelAvatar(ctx: CanvasRenderingContext2D, spec: PixelAvatarSpec): void {
  ctx.fillStyle = PIXEL_AVATAR_GROUND;
  ctx.fillRect(0, 0, 8, 8);
  spec.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x];
      if (cell === 'h' || cell === 'b' || cell === 'l') {
        ctx.fillStyle = spec.colors[cell];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

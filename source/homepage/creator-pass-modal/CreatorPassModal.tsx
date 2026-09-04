'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  playBackTick,
  playErrorBuzz,
  playLetterTick,
  playSuccessBurst,
  playThoom,
} from '@/lib/sound/inviteSounds';
import { scheduleMosaicChimes, type MosaicLanding } from '@/lib/sound/mosaicChime';
import styles from './creator-pass-modal.module.css';

/**
 * Invite-code modal — a living 3D scene. Everything is alive.
 *
 * The composition hangs in space under a perspective camera:
 *   - THE COLOR ROAD: translucent gradient panels racing from the
 *     horizon toward the camera on a tilted floor plane, forever.
 *   - Deep drifting streaks and a slowly breathing ghost watermark.
 *   - An orbit ring with confetti satellites riding its plane.
 *   - THE OWL: the brand logo sampled from `/assets/logo.svg` into
 *     volumetric mosaic tiles that keep its fire gradient. It
 *     levitates. It is SIMULATED: every tile runs an underdamped
 *     spring in a rAF loop — the cursor's field pushes tiles aside,
 *     fast pointer strokes FLING them tumbling, and clicking the owl
 *     detonates a shockwave ring that kicks tiles outward as a wave
 *     (with a sub-bass thoom). Everything springs back. During
 *     validation the whole owl performs a slow full 3D revolution.
 *   - Frameless letter slots whose ghost glyphs bob on the idle air
 *     and lift toward the camera on hover.
 *
 * Choreography (one-shot CSS physics unless noted, all stilled +
 * silenced under prefers-reduced-motion):
 *   - Open: tiles scatter-assemble in 3D with squash + seat-flash.
 *   - Typing: glyphs stamp in (blur + squash-rebound) over tint
 *     underline ticks; each letter climbs a pentatonic scale,
 *     backspace steps back down (`lib/sound/inviteSounds`).
 *   - Validating: amber scan wave over the slots; the owl revolves.
 *     Errors shudder red with a low double-thud; the owl re-forms.
 *   - Success: THE BURST — a screen flash + expanding ring as tiles
 *     detonate outward AND through the camera, glyphs flash gold with
 *     a fast arpeggio, and the confirmation fades in.
 *
 * The state machine (phases, early network overlap, timers, hidden
 * input, aria) is unchanged from the original ticket design.
 */

type CreatorPassPhase = 'idle' | 'inputting' | 'validating' | 'success' | 'error';

type ValidationOutcome = { kind: 'accepted' } | { kind: 'rejected' } | { kind: 'failed' };

export type CreatorPassModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unused by the mosaic design; kept so existing callers compile. */
  assetBasePath?: string;
  codeLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  resetOnOpen?: boolean;
  backContent?: ReactNode;
  /** Sequential pass number rendered in the eyebrow (e.g. 42 -> "NO. 0042"). */
  serialNumber?: number | null;
  onValidateCode?: (code: string) => boolean | Promise<boolean>;
  onSuccessAnimationComplete?: (code: string) => void;
};

const DEFAULT_CODE_LENGTH = 11;
const DEFAULT_PLACEHOLDER = 'LISXXXXXXXX';
const ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';
// The scan choreography. The network validation is fired at scan start
// so total wait is max(scan, network), never their sum.
const VALIDATION_ANIMATION_MS = 3200;

// Ghost-row decode wave — same glyph set as the HomeHero CTA scramble.
const GHOST_GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=<>?';
const DECODE_MS = 650;
const DECODE_FIRST_MS = 1200;
const DECODE_EVERY_MS = 6500;

const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

function normalizeCode(value: string, maxLength: number) {
  return value
    .toUpperCase()
    .split('')
    .filter(char => ALPHANUM.includes(char) && char !== '-')
    .join('')
    .slice(0, maxLength);
}

function fitPlaceholder(placeholder: string, length: number) {
  const normalized = normalizeCode(placeholder, length);
  return normalized.padEnd(length, 'X').slice(0, length);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/* ------------------------------------------------------------------ */
/* THE OWL — logo sampled into mosaic tiles                            */
/* ------------------------------------------------------------------ */

interface OwlTile {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly spark: boolean;
}

const OWL_COLS = 36;

/** Arctic-mint luminance ramp: the logo's own shading, re-inked in ice.
 *  Darker source pixels take the deep teals; highlights go glacial. */
const ARCTIC_RAMP = [
  '#0b6b52',
  '#0f9d72',
  '#2ee6a8',
  '#5eead4',
  '#8ff7e2',
  '#d9fff4',
] as const;

/** Sparkle tiles: glints of ice and sky scattered through the mint. */
const ARCTIC_SPARKS = ['#bae6fd', '#e0f2fe', '#22d3ee', '#a7f3d0'] as const;

/**
 * Rasterize the brand SVG on an offscreen canvas and sample it into a
 * tile grid: alpha decides presence, the pixel's LUMINANCE picks a stop
 * on the arctic-mint ramp (the owl keeps its shading, re-inked in ice),
 * and every ~19th tile swaps to a glint accent for sparkle. Runs once
 * per open; the modal is a client-only chunk so there is no hydration
 * concern.
 */
function useOwlTiles(cols: number): ReadonlyArray<OwlTile> | null {
  const [tiles, setTiles] = useState<ReadonlyArray<OwlTile> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.src = '/assets/logo.svg';
    img.onload = () => {
      if (cancelled) return;
      try {
        const rows = cols; // the logo viewBox is square (1024×1024)
        const canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, cols, rows);
        const data = ctx.getImageData(0, 0, cols, rows).data;
        const out: OwlTile[] = [];
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            const i = (y * cols + x) * 4;
            const a = data[i + 3] ?? 0;
            if (a < 130) continue;
            const spark = out.length % 19 === 7;
            const lum =
              (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) /
              255;
            const color = spark
              ? ARCTIC_SPARKS[(x * 7 + y * 13) % ARCTIC_SPARKS.length]!
              : ARCTIC_RAMP[
                  Math.min(ARCTIC_RAMP.length - 1, Math.floor(lum * ARCTIC_RAMP.length))
                ]!;
            out.push({ x, y, color, spark });
          }
        }
        setTiles(Object.freeze(out));
      } catch {
        // Tainted canvas / decode failure: the modal simply renders
        // without the mosaic — everything else keeps working.
        setTiles(Object.freeze([] as OwlTile[]));
      }
    };
    img.onerror = () => {
      if (!cancelled) setTiles(Object.freeze([] as OwlTile[]));
    };
    return () => {
      cancelled = true;
    };
  }, [cols]);
  return tiles;
}

/** Deterministic pseudo-random in [0, 1) from a tile index + salt. */
function prand(i: number, salt: number): number {
  const h = Math.imul(i + salt * 374761393, 2654435761) >>> 0;
  return (h % 4096) / 4096;
}

/** Click-blast cycle length for tile i (explode → hang → fly home). */
function blastCycleMs(i: number): number {
  return Math.round(2600 + prand(i, 12) * 1400);
}
/** Longest possible blast cycle — the sim stays released this long. */
const BLAST_MAX_MS = 4100;

const OwlMosaicInner = ({
  tiles,
  registerTile,
}: {
  tiles: ReadonlyArray<OwlTile>;
  registerTile?: (index: number, el: HTMLSpanElement | null) => void;
}) => {
  const cell = 100 / OWL_COLS;
  return (
    <div className={styles.owl} aria-hidden>
      {tiles.map((tile, i) => {
        // Assembly scatter: each tile flies in from its own 3D offset.
        const dx = (prand(i, 1) - 0.5) * 380;
        const dy = (prand(i, 2) - 0.5) * 320 - 40;
        const dz = prand(i, 9) * 480 - 140;
        const dr = (prand(i, 3) - 0.5) * 340;
        const delay = prand(i, 4) * 800;
        const flight = 900 + prand(i, 5) * 700;
        // Resting depth: the owl is subtly volumetric.
        const tz = (prand(i, 10) - 0.5) * 30;
        // Burst: outward on the radial + THROUGH the camera.
        const cx = OWL_COLS / 2;
        const bx = ((tile.x - cx) / cx) * 300 + (prand(i, 6) - 0.5) * 100;
        const by = ((tile.y - cx) / cx) * 220 - 80 - prand(i, 7) * 70;
        const bz = 100 + prand(i, 11) * 520;
        const br = (prand(i, 8) - 0.5) * 620;
        // Blast cycle length: explode + hang + fly home. Per-tile so
        // the reassembly rains in over ~1.4s (chimes match in JS).
        const bt = blastCycleMs(i);
        return (
          <span
            key={`${tile.x}-${tile.y}`}
            ref={registerTile ? el => registerTile(i, el) : undefined}
            className={tile.spark ? `${styles.tile} ${styles.tileSpark}` : styles.tile}
            style={
              {
                left: `${tile.x * cell}%`,
                top: `${tile.y * cell}%`,
                width: `${cell * 0.86}%`,
                height: `${cell * 0.86}%`,
                background: tile.color,
                '--dx': `${dx.toFixed(1)}px`,
                '--dy': `${dy.toFixed(1)}px`,
                '--dz': `${dz.toFixed(1)}px`,
                '--dr': `${dr.toFixed(0)}deg`,
                '--d': `${delay.toFixed(0)}ms`,
                '--fd': `${flight.toFixed(0)}ms`,
                '--tz': `${tz.toFixed(1)}px`,
                '--rp': `${(((tile.x + tile.y) % 9) * 140).toFixed(0)}ms`,
                '--bx': bx.toFixed(1),
                '--by': by.toFixed(1),
                '--bz': bz.toFixed(0),
                '--br': `${br.toFixed(0)}deg`,
                '--bt': `${bt}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Pointer systems                                                      */
/* ------------------------------------------------------------------ */

/**
 * Scene tilt + spotlight. Pointer position is lerped in a rAF loop and
 * written as CSS vars on the OVERLAY (so the tilted scene, the deep
 * parallax field and the spotlight all inherit them) — zero React
 * re-renders per frame. The loop SLEEPS once the lerp converges and
 * wakes on the next pointer move, so an idle mouse costs nothing.
 * Touch devices (no fine pointer) skip the whole system.
 *
 * CRITICAL: while the pointer is over (or near) the OWL, the tilt is
 * driven back to zero — the owl "comes to attention" and its geometry
 * FREEZES under the cursor. Without this the trailing lerp keeps
 * rotating the scene for ~1s after every mouse move, so the owl's
 * projected hit box slides out from under a click aimed at where it
 * visibly was (root cause of the dead left-clicks: pointerdown landed
 * in the flex gap the owl had just vacated).
 */
function useSceneTilt(
  overlayRef: RefObject<HTMLDivElement | null>,
  stageRef: RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const CALM_PAD = 70; // px around the stage where the tilt stands down
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let calm = false;
    let raf = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      // Calm (aiming at the owl): settle fast so clicks land.
      const k = calm ? 0.22 : 0.08;
      curX += (targetX - curX) * k;
      curY += (targetY - curY) * k;
      overlay.style.setProperty('--tiltX', curX.toFixed(4));
      overlay.style.setProperty('--tiltY', curY.toFixed(4));
      // Converged → sleep. The next pointermove restarts the loop.
      if (Math.abs(targetX - curX) < 0.0006 && Math.abs(targetY - curY) < 0.0006) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      calm = false;
      if (stage) {
        const r = stage.getBoundingClientRect();
        calm =
          e.clientX > r.left - CALM_PAD &&
          e.clientX < r.right + CALM_PAD &&
          e.clientY > r.top - CALM_PAD &&
          e.clientY < r.bottom + CALM_PAD;
      }
      if (calm) {
        targetX = 0;
        targetY = 0;
      } else {
        targetX = (e.clientX / window.innerWidth) * 2 - 1;
        targetY = (e.clientY / window.innerHeight) * 2 - 1;
      }
      // Spotlight rides a compositor-only transform (px vars).
      overlay.style.setProperty('--sx', `${e.clientX}px`);
      overlay.style.setProperty('--sy', `${e.clientY}px`);
      if (raf === 0) raf = requestAnimationFrame(tick);
    };

    overlay.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      alive = false;
      if (raf !== 0) cancelAnimationFrame(raf);
      overlay.removeEventListener('pointermove', onMove);
    };
  }, [overlayRef, stageRef, active]);
}

/**
 * The living owl: every tile is an underdamped spring integrated in a
 * rAF loop. Two forces act on it:
 *   - the cursor's field (tiles seek a push-away displacement),
 *   - pointer velocity (fast strokes fling nearby tiles).
 * (Clicks are handled outside the sim: they detonate the CSS blast
 * cycle while this simulation releases.)
 * Displacement also tumbles the tile (rotation ∝ offset) and ignites
 * it (brightness ∝ energy). Transforms are written inline; the CSS
 * assembly keyframes have finished by the time a cursor can interact.
 */
function useLivingTiles(
  stageRef: RefObject<HTMLDivElement | null>,
  tiles: ReadonlyArray<OwlTile> | null,
  tileEls: RefObject<(HTMLSpanElement | null)[]>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || !tiles || tiles.length === 0 || prefersReducedMotion()) return;
    const stage = stageRef.current;
    if (!stage) return;

    const RADIUS = 110;
    const PUSH = 30;
    let mx = -9999;
    let my = -9999;
    let flingX = 0;
    let flingY = 0;
    let raf = 0;
    let alive = true;
    let calmFrames = 0;
    // The stage rect is CACHED and refreshed only on pointer events —
    // never read layout inside the frame loop. (The levitation sways
    // the owl ±9px; the field radius is forgiving.)
    let rect = stage.getBoundingClientRect();
    const n = tiles.length;
    const ox = new Float32Array(n);
    const oy = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    // Last written values — style strings are only rebuilt when a tile
    // actually moved perceptibly.
    const lx = new Float32Array(n);
    const ly = new Float32Array(n);
    const le = new Float32Array(n);

    const wake = () => {
      calmFrames = 0;
      if (raf === 0) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      rect = stage.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      // Stroke velocity accumulates and decays in the loop — a fast
      // swipe carries far more energy than a hover.
      flingX += e.movementX;
      flingY += e.movementY;
      wake();
    };
    const onLeave = () => {
      mx = -9999;
      my = -9999;
      wake(); // run the settle-out, then the loop sleeps on its own
    };

    const tick = () => {
      if (!alive) return;
      const cellPx = rect.width / OWL_COLS;
      const els = tileEls.current;
      const flingMag = Math.hypot(flingX, flingY);
      const cursorIn = mx > -4000;
      let energyAlive = false;

      for (let i = 0; i < n; i += 1) {
        const el = els[i];
        if (!el) continue;
        const tx = (tiles[i]!.x + 0.5) * cellPx;
        const ty = (tiles[i]!.y + 0.5) * cellPx;

        // Field: seek a push-away displacement near the cursor.
        let wantX = 0;
        let wantY = 0;
        let glow = 0;
        if (cursorIn) {
          const dx = tx - mx;
          const dy = ty - my;
          const dist = Math.hypot(dx, dy);
          if (dist < RADIUS && dist > 0.001) {
            const f = (1 - dist / RADIUS) ** 2;
            wantX = (dx / dist) * f * PUSH;
            wantY = (dy / dist) * f * PUSH;
            glow = f;
            // Fling: fast strokes transfer momentum into nearby tiles.
            if (flingMag > 6) {
              vx[i]! += flingX * f * 0.16;
              vy[i]! += flingY * f * 0.16;
            }
          }
        }

        // Underdamped spring toward the field target (or home).
        vx[i]! += (wantX - ox[i]!) * 0.14;
        vy[i]! += (wantY - oy[i]!) * 0.14;
        vx[i]! *= 0.86;
        vy[i]! *= 0.86;
        ox[i]! += vx[i]!;
        oy[i]! += vy[i]!;

        const px = ox[i]!;
        const py = oy[i]!;
        const speed = Math.hypot(vx[i]!, vy[i]!);
        const energy = Math.min(1, glow + speed * 0.06);

        if (Math.abs(px) < 0.05 && Math.abs(py) < 0.05 && speed < 0.05 && energy < 0.01) {
          if (lx[i] !== 0 || ly[i] !== 0 || le[i] !== 0) {
            el.style.transform = '';
            el.style.filter = '';
            lx[i] = 0;
            ly[i] = 0;
            le[i] = 0;
          }
          continue;
        }
        energyAlive = true;
        // Quantize writes: skip the (expensive) style set when the
        // change would be sub-pixel and the glow delta invisible.
        if (
          Math.abs(px - lx[i]!) < 0.12 &&
          Math.abs(py - ly[i]!) < 0.12 &&
          Math.abs(energy - le[i]!) < 0.015
        ) {
          continue;
        }
        lx[i] = px;
        ly[i] = py;
        le[i] = energy;
        el.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, ${(
          energy * 40
        ).toFixed(1)}px) rotate(${(px * 1.6).toFixed(1)}deg) scale(${(1 + energy * 0.5).toFixed(3)})`;
        el.style.filter = `brightness(${(1 + energy * 1.4).toFixed(3)})`;
      }

      // Stroke energy decays fast — a fling is an impulse, not a wind.
      flingX *= 0.6;
      flingY *= 0.6;

      // Nothing moving, no cursor → sleep after a short grace period.
      // Pointer events wake the loop back up.
      if (!energyAlive && !cursorIn) {
        calmFrames += 1;
        if (calmFrames > 12) {
          raf = 0;
          return;
        }
      } else {
        calmFrames = 0;
      }
      raf = requestAnimationFrame(tick);
    };

    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (raf !== 0) cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      for (const el of tileEls.current) {
        if (el) {
          el.style.transform = '';
          el.style.filter = '';
        }
      }
    };
  }, [stageRef, tiles, tileEls, active]);
}

/* ------------------------------------------------------------------ */
/* Scenery                                                              */
/* ------------------------------------------------------------------ */

const STREAKS: ReadonlyArray<{ top: string; left: string; w: number; c: string; d: string; dur: string }> = [
  { top: '10%', left: '-4%', w: 200, c: '#38bdf8', d: '0s', dur: '17s' },
  { top: '24%', left: '70%', w: 130, c: '#5eead4', d: '2.2s', dur: '21s' },
  { top: '62%', left: '4%', w: 160, c: '#a7f3d0', d: '4.5s', dur: '19s' },
  { top: '80%', left: '72%', w: 220, c: '#2ee6a8', d: '1.4s', dur: '23s' },
  { top: '42%', left: '88%', w: 100, c: '#f052d2', d: '3.1s', dur: '15s' },
  { top: '90%', left: '28%', w: 120, c: '#22d3ee', d: '5.4s', dur: '25s' },
  { top: '6%', left: '38%', w: 90, c: '#bae6fd', d: '6.2s', dur: '20s' },
];

// THE COLOR TUNNEL: gradient panels racing from the horizon toward the
// camera on four planes — floor, ceiling, and both walls — wrapping
// the whole viewport in depth. Lane is a % offset on each plane.
// Arctic-mint first, with confetti flecks so the house palette breathes.
interface TunnelPanel {
  lane: number;
  w: number;
  h: number;
  from: string;
  to: string;
  dur: string;
  delay: string;
}

const FLOOR_PANELS: ReadonlyArray<TunnelPanel> = [
  { lane: 8, w: 120, h: 300, from: '#38bdf8', to: '#5eead4', dur: '9s', delay: '0s' },
  { lane: 22, w: 70, h: 190, from: '#2ee6a8', to: '#bae6fd', dur: '7.4s', delay: '-2.5s' },
  { lane: 33, w: 150, h: 360, from: '#5eead4', to: '#22d3ee', dur: '10.5s', delay: '-5s' },
  { lane: 47, w: 90, h: 240, from: '#a7f3d0', to: '#38bdf8', dur: '8.2s', delay: '-1.2s' },
  { lane: 58, w: 130, h: 320, from: '#8b5cf6', to: '#5eead4', dur: '9.8s', delay: '-6.4s' },
  { lane: 72, w: 80, h: 210, from: '#22d3ee', to: '#d9fff4', dur: '7s', delay: '-3.8s' },
  { lane: 84, w: 140, h: 340, from: '#2ee6a8', to: '#a7f3d0', dur: '11s', delay: '-8s' },
  { lane: 15, w: 60, h: 160, from: '#f052d2', to: '#bae6fd', dur: '6.6s', delay: '-4.6s' },
  { lane: 64, w: 55, h: 150, from: '#bae6fd', to: '#2ee6a8', dur: '6s', delay: '-0.8s' },
  { lane: 40, w: 65, h: 175, from: '#5eead4', to: '#8b5cf6', dur: '7.8s', delay: '-7.1s' },
];

const CEILING_PANELS: ReadonlyArray<TunnelPanel> = [
  { lane: 12, w: 110, h: 280, from: '#22d3ee', to: '#5eead4', dur: '10s', delay: '-1.6s' },
  { lane: 30, w: 70, h: 180, from: '#bae6fd', to: '#2ee6a8', dur: '8.4s', delay: '-4.9s' },
  { lane: 49, w: 130, h: 330, from: '#5eead4', to: '#38bdf8', dur: '11.4s', delay: '-7.7s' },
  { lane: 66, w: 85, h: 220, from: '#a7f3d0', to: '#22d3ee', dur: '7.6s', delay: '-2.9s' },
  { lane: 82, w: 120, h: 300, from: '#2ee6a8', to: '#d9fff4', dur: '9.4s', delay: '-6.1s' },
  { lane: 22, w: 55, h: 140, from: '#fbbf24', to: '#a7f3d0', dur: '6.8s', delay: '-0.5s' },
];

const WALL_PANELS: ReadonlyArray<TunnelPanel> = [
  { lane: 14, w: 260, h: 110, from: '#5eead4', to: '#22d3ee', dur: '9.6s', delay: '-3.3s' },
  { lane: 34, w: 180, h: 70, from: '#2ee6a8', to: '#bae6fd', dur: '7.8s', delay: '-6.6s' },
  { lane: 55, w: 300, h: 130, from: '#38bdf8', to: '#5eead4', dur: '11s', delay: '-1.9s' },
  { lane: 74, w: 200, h: 85, from: '#a7f3d0', to: '#2ee6a8', dur: '8.6s', delay: '-5.2s' },
  { lane: 88, w: 150, h: 60, from: '#22d3ee', to: '#d9fff4', dur: '7s', delay: '-0.9s' },
];

/** One tilted plane of racing panels. `axis` picks the in-plane travel
 *  direction; `reverse` flips it so mirrored planes stream correctly. */
function DepthPlane({
  transform,
  panels,
  axis,
  reverse = false,
  opacity,
}: {
  transform: string;
  panels: ReadonlyArray<TunnelPanel>;
  axis: 'y' | 'x';
  reverse?: boolean;
  opacity: number;
}) {
  return (
    <div className={styles.plane} style={{ transform, opacity }} aria-hidden>
      {panels.map((p, i) => (
        <span
          key={i}
          className={styles.roadPanel}
          style={
            {
              ...(axis === 'y'
                ? { left: `${p.lane}%`, top: '-6%', width: p.w, height: p.h }
                : { top: `${p.lane}%`, left: '-6%', width: p.w, height: p.h }),
              background: `linear-gradient(${axis === 'y' ? '180deg' : '90deg'}, ${p.from}, ${p.to})`,
              animationName: axis === 'y' ? 'cpRoadRun' : 'cpRoadRunX',
              animationDirection: reverse ? 'reverse' : 'normal',
              '--rdur': p.dur,
              '--rdel': p.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Comets: rare bright ice-streaks that shoot across the deep space —
 *  one traverse per long cycle, then dark until the loop comes round. */
const COMETS: ReadonlyArray<{ top: string; delay: string; dur: string; c: string }> = [
  { top: '16%', delay: '2s', dur: '11s', c: '#d9fff4' },
  { top: '58%', delay: '7.5s', dur: '14s', c: '#5eead4' },
  { top: '34%', delay: '13s', dur: '17s', c: '#bae6fd' },
];

/* ------------------------------------------------------------------ */
/* The modal                                                            */
/* ------------------------------------------------------------------ */

export function CreatorPassModal({
  open,
  onOpenChange,
  codeLength = DEFAULT_CODE_LENGTH,
  placeholder = DEFAULT_PLACEHOLDER,
  autoFocus = true,
  resetOnOpen = true,
  backContent,
  serialNumber = null,
  onValidateCode,
  onSuccessAnimationComplete,
}: CreatorPassModalProps) {
  const sealNumberText = `NO. ${String(serialNumber ?? 0).padStart(4, '0')}`;
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<CreatorPassPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [ring, setRing] = useState<{ key: number; x: number; y: number } | null>(null);
  // Click-blast: the key remounts the mosaic with the blast cycle;
  // busy releases the spring sim while the CSS owns the tiles.
  const [blastKey, setBlastKey] = useState<number | null>(null);
  const [blastBusy, setBlastBusy] = useState(false);
  const blastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chimeCleanup = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const owlStageRef = useRef<HTMLDivElement | null>(null);
  const tileEls = useRef<(HTMLSpanElement | null)[]>([]);
  const validationStartedFor = useRef<string | null>(null);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight network validation, kicked off the moment the scan starts
  // so the round trip overlaps the choreography instead of following it.
  // Wrapped so it can never reject unhandled.
  const pendingValidation = useRef<Promise<ValidationOutcome> | null>(null);
  const tiles = useOwlTiles(OWL_COLS);

  useSceneTilt(overlayRef, owlStageRef, open);
  // The simulation runs only while the user can actually interact.
  // During VALIDATING the scene is pointer-events:none — the cursor
  // position would go stale and keep displacing tiles at its last
  // spot — so the sim releases (tiles spring home via the cleanup)
  // and the CSS revolve/scan owns the owl. SUCCESS releases for the
  // burst, and a click-BLAST releases while the explode/reassemble
  // cycle owns every tile.
  useLivingTiles(
    owlStageRef,
    tiles,
    tileEls,
    open && phase !== 'success' && phase !== 'validating' && !blastBusy,
  );

  const displayPlaceholder = useMemo(
    () => fitPlaceholder(placeholder, codeLength),
    [codeLength, placeholder]
  );

  // Ghost-row decode wave, ported from the HomeHero CTA scramble: every
  // untyped slot flickers through random glyphs, then locks left→right
  // into its real letter. Mutates textContent through refs (no React
  // re-render per frame), same idiom as the pointer systems above.
  const ghostEls = useRef<(HTMLSpanElement | null)[]>([]);
  const decodeRef = useRef<{ raf: number | null; active: boolean }>({
    raf: null,
    active: false,
  });
  const decodeTimers = useRef<{
    first: ReturnType<typeof setTimeout> | null;
    loop: ReturnType<typeof setInterval> | null;
  }>({ first: null, loop: null });

  const restoreGhosts = useCallback(() => {
    ghostEls.current.forEach((span, index) => {
      if (!span) return;
      span.textContent = displayPlaceholder[index] ?? '';
      delete span.dataset.decoding;
    });
  }, [displayPlaceholder]);

  const runDecodeWave = useCallback(() => {
    const state = decodeRef.current;
    if (state.active || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      restoreGhosts();
      return;
    }
    state.active = true;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / DECODE_MS, 1);
      const revealed = Math.ceil(p * codeLength);
      if (p < 1) {
        ghostEls.current.forEach((span, index) => {
          if (!span) return;
          if (index < revealed) {
            span.textContent = displayPlaceholder[index] ?? '';
            delete span.dataset.decoding;
          } else {
            span.textContent =
              GHOST_GLYPHS[Math.floor(Math.random() * GHOST_GLYPHS.length)] ?? '';
            span.dataset.decoding = 'true';
          }
        });
        state.raf = requestAnimationFrame(tick);
      } else {
        state.raf = null;
        state.active = false;
        restoreGhosts();
      }
    };
    state.raf = requestAnimationFrame(tick);
  }, [codeLength, displayPlaceholder, restoreGhosts]);

  const cancelDecodeWave = useCallback(() => {
    const state = decodeRef.current;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    state.active = false;
    restoreGhosts();
  }, [restoreGhosts]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (resetOnOpen) {
      setCode('');
      setPhase('idle');
      setError(null);
      setRing(null);
      setBlastKey(null);
      setBlastBusy(false);
      validationStartedFor.current = null;
      pendingValidation.current = null;
    }

    if (autoFocus) {
      window.setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [autoFocus, open, resetOnOpen]);

  useEffect(() => {
    return () => {
      if (validationTimer.current) {
        clearTimeout(validationTimer.current);
      }
      if (blastTimer.current) {
        clearTimeout(blastTimer.current);
      }
      chimeCleanup.current?.();
    };
  }, []);

  // Resolve `onValidateCode` to a tagged outcome that never rejects, so
  // the promise can be started early (during the animation) without an
  // unhandled-rejection window before `finishValidation` awaits it.
  const startValidation = (codeToValidate: string): Promise<ValidationOutcome> =>
    Promise.resolve()
      .then(() => (onValidateCode ? onValidateCode(codeToValidate) : true))
      .then((accepted): ValidationOutcome => ({ kind: accepted ? 'accepted' : 'rejected' }))
      .catch((): ValidationOutcome => ({ kind: 'failed' }));

  const beginValidation = (nextCode: string) => {
    if (validationStartedFor.current === nextCode) {
      return;
    }

    validationStartedFor.current = nextCode;
    setError(null);
    setPhase('validating');
    // The scan owns the owl now — silence any reassembly still ringing.
    chimeCleanup.current?.();
    chimeCleanup.current = null;
    // Fire the network validation NOW so it runs concurrently with the
    // scan: total wait is max(animation, network) instead of
    // animation + network.
    pendingValidation.current = startValidation(nextCode);

    if (validationTimer.current) {
      clearTimeout(validationTimer.current);
    }

    validationTimer.current = setTimeout(() => {
      void finishValidation(nextCode);
    }, VALIDATION_ANIMATION_MS);
  };

  const finishValidation = async (codeToValidate: string) => {
    const outcome = await (pendingValidation.current ?? startValidation(codeToValidate));
    pendingValidation.current = null;

    if (outcome.kind === 'failed') {
      validationStartedFor.current = null;
      setPhase('error');
      setError('Unable to validate code');
      playErrorBuzz();
      window.setTimeout(() => {
        setPhase('idle');
        inputRef.current?.focus();
      }, 900);
      return;
    }

    if (outcome.kind === 'rejected') {
      validationStartedFor.current = null;
      setPhase('error');
      setError('Code was not accepted');
      playErrorBuzz();
      window.setTimeout(() => {
        setCode('');
        setPhase('idle');
        inputRef.current?.focus();
      }, 900);
      return;
    }

    setPhase('success');
    playSuccessBurst();
    onSuccessAnimationComplete?.(codeToValidate);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (phase === 'validating' || phase === 'success') {
      return;
    }

    const nextCode = normalizeCode(event.target.value, codeLength);
    if (nextCode.length > code.length) {
      playLetterTick(nextCode.length - 1);
    } else if (nextCode.length < code.length) {
      playBackTick(nextCode.length);
    }
    setCode(nextCode);
    setError(null);
    setPhase(nextCode.length > 0 ? 'inputting' : 'idle');

    window.setTimeout(() => {
      inputRef.current?.setSelectionRange(nextCode.length, nextCode.length);
    }, 0);

    if (nextCode.length === codeLength) {
      beginValidation(nextCode);
    }
  };

  const handleOverlayClick = () => {
    if (phase !== 'validating') {
      onOpenChange(false);
    }
  };

  // Click the owl → DETONATION: a ring flash + sub-bass thoom as every
  // tile explodes outward, hangs tumbling in space, then flies home
  // over ~3–4s — each landing chiming on the frens-mosaic pentatonic
  // (sparse sample so it sings instead of roaring).
  //
  // Fired from a dedicated flat hit-target button (see .owlHit).
  // PRIMARY trigger is POINTERDOWN: it is the first event of the
  // interaction, dispatched before drag thresholds, pointer capture,
  // selection logic, or any extension's click interception can
  // swallow the gesture (observed in the wild: left-clicks whose
  // pointerup/click never arrived while right-button pointerups did).
  // pointerup + click remain as fallbacks; the ref debounce dedupes.
  // Every attempt and every guard rejection is traced to
  // window.__cpOwl so /dev/invite can display the event flow live.
  const lastBlastAt = useRef(0);
  const handleOwlBlast = (e: { clientX: number; clientY: number; type?: string }) => {
    const trace = (msg: string) => {
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __cpOwl?: string[] };
        (w.__cpOwl = w.__cpOwl ?? []).push(
          `${Math.round(performance.now())}ms ${e.type ?? '?'} → ${msg}`,
        );
      }
    };
    const stage = owlStageRef.current;
    if (!stage) return trace('no stage');
    if (phase === 'success' || phase === 'validating') return trace(`blocked: phase=${phase}`);
    if (blastBusy) return trace('blocked: blast in flight');
    const now = performance.now();
    if (now - lastBlastAt.current < 400) return trace('deduped');
    lastBlastAt.current = now;
    trace('BLAST');
    // Clicking the owl must not strand keyboard entry — hand focus
    // straight back to the code input (replaces the old mousedown
    // preventDefault, which was the only left-button-specific default
    // handling in the click path).
    window.setTimeout(() => inputRef.current?.focus(), 0);
    const rect = stage.getBoundingClientRect();
    // Keyboard activation has no coordinates — ring from the center.
    const x = e.clientX > 0 ? e.clientX - rect.left : rect.width / 2;
    const y = e.clientY > 0 ? e.clientY - rect.top : rect.height / 2;
    setRing({ key: Date.now(), x, y });
    playThoom();
    // The detonation pulses the whole tunnel — the room feels it.
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.setAttribute('data-pulse', '1');
      window.setTimeout(() => overlay.removeAttribute('data-pulse'), 900);
    }
    setBlastKey(Date.now());
    setBlastBusy(true);
    if (blastTimer.current) clearTimeout(blastTimer.current);
    blastTimer.current = setTimeout(() => setBlastBusy(false), BLAST_MAX_MS);
    // Chimes ride the reassembly: every ~31st tile sings as it seats
    // (~16 notes over the rain-in), then the deep root resolves.
    chimeCleanup.current?.();
    if (tiles && tiles.length > 0) {
      const landings: MosaicLanding[] = [];
      for (let i = 0; i < tiles.length; i += 31) {
        landings.push({ atMs: Math.round(blastCycleMs(i) * 0.92), index: i });
      }
      chimeCleanup.current = scheduleMosaicChimes(landings);
    }
  };

  const canInteract = phase !== 'validating' && phase !== 'success';

  // Idle cadence: one wave shortly after the ghosts mount, then a slow
  // repeat — only while the row is actually enterable.
  useEffect(() => {
    if (!open || !canInteract) return;
    const timers = decodeTimers.current;
    timers.first = setTimeout(runDecodeWave, DECODE_FIRST_MS);
    timers.loop = setInterval(runDecodeWave, DECODE_EVERY_MS);
    return () => {
      if (timers.first) clearTimeout(timers.first);
      if (timers.loop) clearInterval(timers.loop);
      timers.first = null;
      timers.loop = null;
      cancelDecodeWave();
    };
  }, [canInteract, cancelDecodeWave, open, runDecodeWave]);

  // Deterministic test hook (same precedent as window.__cpOwl).
  useEffect(() => {
    const w = window as unknown as { __cpGhostDecode?: () => void };
    w.__cpGhostDecode = runDecodeWave;
    return () => {
      delete w.__cpGhostDecode;
    };
  }, [runDecodeWave]);

  const statusText =
    phase === 'validating'
      ? 'Checking your invite code'
      : phase === 'success'
        ? 'Invite code confirmed'
        : error || 'Enter your invite code';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={overlayRef}
          className={styles.overlay}
          data-phase={phase}
          role="dialog"
          aria-modal="true"
          aria-label="Invite code"
          onClick={handleOverlayClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className={styles.scrim} aria-hidden />

          {/* THE COLOR TUNNEL: four racing planes wrap the viewport in
              depth — floor, ceiling, both walls — riding a slow dream
              roll + pointer parallax. */}
          <div className={styles.tunnelPar} aria-hidden>
            <div className={styles.tunnel}>
              <DepthPlane
                transform="translate(-50%, -8%) rotateX(76deg)"
                panels={FLOOR_PANELS}
                axis="y"
                opacity={0.32}
              />
              <DepthPlane
                transform="translate(-50%, -92%) rotateX(-76deg)"
                panels={CEILING_PANELS}
                axis="y"
                reverse
                opacity={0.2}
              />
              <DepthPlane
                transform="translate(-92%, -50%) rotateY(78deg)"
                panels={WALL_PANELS}
                axis="x"
                opacity={0.24}
              />
              <DepthPlane
                transform="translate(-8%, -50%) rotateY(-78deg)"
                panels={WALL_PANELS}
                axis="x"
                reverse
                opacity={0.24}
              />
            </div>
          </div>

          {/* Comets: rare glacial streaks across the deep. */}
          <div className={styles.deepField} aria-hidden>
            {COMETS.map((c, i) => (
              <span
                key={`comet-${i}`}
                className={styles.comet}
                style={
                  {
                    top: c.top,
                    background: `linear-gradient(90deg, transparent, ${c.c}, transparent)`,
                    boxShadow: `0 0 12px ${c.c}`,
                    '--cd': c.delay,
                    '--cdur': c.dur,
                  } as CSSProperties
                }
              />
            ))}
          </div>

          {/* Deep space: drifting streaks. */}
          <div className={styles.deepField} aria-hidden>
            {STREAKS.map((s, i) => (
              <span
                key={i}
                className={styles.streak}
                style={
                  {
                    top: s.top,
                    left: s.left,
                    width: s.w,
                    background: `linear-gradient(90deg, transparent, ${s.c}, transparent)`,
                    '--sd': s.d,
                    '--sdur': s.dur,
                  } as CSSProperties
                }
              />
            ))}
          </div>

          <div className={styles.spotlight} aria-hidden />

          {phase === 'success' ? <div className={styles.successFlash} aria-hidden /> : null}

          <AnimatePresence>
            {canInteract ? (
              <motion.button
                type="button"
                className={styles.closeButton}
                aria-label="Close"
                onClick={event => {
                  event.stopPropagation();
                  onOpenChange(false);
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X aria-hidden="true" />
              </motion.button>
            ) : null}
          </AnimatePresence>

          <motion.div
            className={styles.scene}
            data-phase={phase}
            onClick={event => event.stopPropagation()}
            initial={{ opacity: 0, y: 52, rotateX: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
            exit={{ opacity: 0, y: 34, rotateX: 8, scale: 0.94 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.tilt}>
              <span className={styles.ghostWord} aria-hidden>
                invite
              </span>

              <div className={styles.eyebrow}>
                <span className={styles.eyebrowTick} aria-hidden />
                <span>INVITE · {sealNumberText} · 1 OF 500</span>
                <span className={styles.liveDot} aria-hidden />
              </div>

              {/* THE OWL, ringed by its orbit. Click it. */}
              <div className={styles.owlStage} ref={owlStageRef}>
                <span className={styles.orbit} aria-hidden>
                  <span className={styles.satellite} style={{ '--oc': '#fbbf24', '--od': '0s' } as CSSProperties} />
                  <span className={styles.satellite} style={{ '--oc': '#38bdf8', '--od': '-7.3s' } as CSSProperties} />
                  <span className={styles.satellite} style={{ '--oc': '#f052d2', '--od': '-3.6s' } as CSSProperties} />
                  <span className={styles.satellite} style={{ '--oc': '#7ce85e', '--od': '-10.1s' } as CSSProperties} />
                </span>
                <span className={styles.owlHalo} aria-hidden />
                <div className={styles.levitate}>
                  {tiles && tiles.length > 0 && phase !== 'success' ? (
                    // Keyed by blast: a click remounts the mosaic with
                    // the blast cycle (explode → hang → rain home).
                    // The class STAYS after the cycle (fill: none hands
                    // the tiles back to base styles + the spring sim)
                    // so the assembly never replays behind it.
                    <div
                      key={blastKey ?? 'live'}
                      className={blastKey !== null ? styles.owlBlast : undefined}
                    >
                      <OwlMosaicInner
                        tiles={tiles}
                        registerTile={(i, el) => {
                          tileEls.current[i] = el;
                        }}
                      />
                    </div>
                  ) : null}
                  {tiles && tiles.length > 0 && phase === 'success' ? (
                    // Re-mounted with burst styling so every tile
                    // restarts as the detonation, not the assembly.
                    <div className={styles.owlBurst}>
                      <OwlMosaicInner tiles={tiles} />
                    </div>
                  ) : null}
                </div>
                {ring && phase !== 'success' ? (
                  <span
                    key={ring.key}
                    className={styles.shockRing}
                    style={{ left: ring.x, top: ring.y }}
                    aria-hidden
                  />
                ) : null}
                {/* Flat, invisible hit target ABOVE the 3D stack —
                    clicks land here reliably regardless of the tilt /
                    levitation transforms under it. Mousedown default
                    is prevented so the code input keeps focus. */}
                {phase !== 'success' ? (
                  <button
                    type="button"
                    className={styles.owlHit}
                    aria-label="Detonate the owl"
                    onPointerDown={e => {
                      // Primary trigger: fires before anything can
                      // steal the gesture. Main button / touch only —
                      // right-click keeps its context menu.
                      if (e.button === 0) handleOwlBlast(e);
                    }}
                    onPointerUp={e => {
                      if (e.button === 0) handleOwlBlast(e);
                    }}
                    onClick={handleOwlBlast}
                  />
                ) : null}
                {phase === 'success' ? (
                  <>
                    <span className={styles.burstRing} aria-hidden />
                    <div className={styles.successBlock}>
                      {backContent || (
                        <>
                          <p className={styles.successKicker}>Access confirmed</p>
                          <h2 className={styles.successTitle}>Invite code accepted</h2>
                          <p className={styles.successBody}>
                            Welcome to listen. Taking you in&hellip;
                          </p>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </div>

              <label
                className={styles.codeDisplay}
                aria-label="Invite code"
                onPointerEnter={runDecodeWave}
              >
                <span className={styles.cellRow} data-phase={phase}>
                  {displayPlaceholder.split('').map((ghost, index) => {
                    const typed = code[index] ?? null;
                    const isCursor =
                      isFocused &&
                      canInteract &&
                      index === Math.min(code.length, codeLength - 1) &&
                      code.length < codeLength;
                    const tint = CONFETTI[index % CONFETTI.length]!;
                    return (
                      <span
                        key={index}
                        className={styles.slot}
                        data-typed={typed !== null}
                        data-cursor={isCursor}
                        style={
                          {
                            '--tint': tint,
                            '--ci': `${index * 55}ms`,
                            '--si': `${index * 90}ms`,
                          } as CSSProperties
                        }
                      >
                        {typed !== null ? (
                          // Keyed on the glyph so replacing a letter
                          // re-stamps; the flash ring re-fires with it.
                          <span key={`${typed}-${index}`} className={styles.stamp}>
                            <span className={styles.stampChar}>{typed}</span>
                            <span className={styles.stampFlash} aria-hidden />
                          </span>
                        ) : (
                          <span
                            className={styles.ghostChar}
                            ref={el => {
                              ghostEls.current[index] = el;
                            }}
                          >
                            {ghost}
                          </span>
                        )}
                        <span className={styles.slotTick} aria-hidden />
                      </span>
                    );
                  })}
                </span>

                <input
                  ref={inputRef}
                  className={styles.hiddenInput}
                  value={code}
                  onChange={handleInputChange}
                  onFocus={() => {
                    setIsFocused(true);
                    runDecodeWave();
                  }}
                  onBlur={() => setIsFocused(false)}
                  disabled={!canInteract}
                  autoComplete="off"
                  autoCapitalize="characters"
                  inputMode="text"
                  spellCheck={false}
                />
              </label>

              <p className={styles.statusText} data-phase={phase} aria-live="polite">
                {statusText}
              </p>

              <div className={styles.plate} aria-hidden>
                <span className={styles.plateTicks}>
                  {CONFETTI.slice(0, 5).map(c => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                <span>A LISTEN ORIGINAL · MMXXVI</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

'use client';

import { useEffect, useRef } from 'react';

import { LineArt, type LineArtName } from '@/components/landing/art';
import { usePrefersReducedMotion } from '../../primitives';
import './motion.css';

/**
 * Gives each surface drawing its own motion, without editing the drawings.
 *
 * The four illustrations in `art/` are hand authored stroke SVGs and each
 * one is a flat list of a hundred odd paths with no groups in it. So the
 * grouping happens here, once, at mount: the strokes are measured, sorted
 * into the shapes a reader actually sees, given CSS custom properties, and
 * handed to the stylesheet. Every frame after that is CSS, so the main
 * thread does nothing and the compositor owns the animation.
 *
 * ── WHAT EACH ONE DOES ───────────────────────────────────────────────
 *
 * DISCOVER   the blocks trade places. Cubes are paired with their nearest
 *            neighbour and each one travels to where the other was, holds,
 *            and travels back. Staggered, so the stack is always partly
 *            rearranging rather than all moving at once.
 *
 * CHARTS     the rings turn. The strokes are banded by their distance from
 *            the centre of the drawing and each band rotates about that
 *            centre at its own speed, the middle band against the other
 *            two.
 *
 * CONDITIONALS  the hammer hits. The head swings about the pin at the top
 *            of its shaft, lands, bounces once and returns. What it lands
 *            on takes a four step recoil timed to the frame of impact.
 *
 * TRACKING   it breaks and comes back. Every stroke leaves along its own
 *            ray from the middle of the drawing, turns a little on the way
 *            out, holds apart, and reassembles.
 *
 * ── THE TWO GATES ────────────────────────────────────────────────────
 *
 * Nothing animates at all under `prefers-reduced-motion`: the strokes are
 * never even measured, so the whole thing costs nothing.
 *
 * Off screen, the animations PAUSE rather than never starting. That
 * distinction is the fix for a real bug: gating the setup itself behind an
 * IntersectionObserver means that anywhere the observer does not report
 * (an embedded view whose viewport measures zero, for one) the drawings
 * are frozen forever with no way back. Pausing defaults the other way. If
 * the observer never says anything, or the browser has none, the drawings
 * simply run, which is the behaviour worth failing towards.
 *
 * ── ROTATING ABOUT A POINT ───────────────────────────────────────────
 *
 * `transform-origin` cannot be trusted here. These strokes live inside a
 * `<g>` that carries its own transform, so the element's user space and
 * the viewBox do not agree, and an origin written in one is wrong in the
 * other. Every rotation below is therefore composed by hand as
 * `translate(p) rotate(a) translate(-p)` with the origin pinned at 0 0,
 * which is exact and does not care what space anything is in. See
 * `motion.css`.
 *
 * Plain React and DOM. No Next API, so this drops into any React app.
 */

const SELECTOR = 'path, polyline, polygon, line, circle, ellipse';

interface Stroke {
  readonly el: SVGGraphicsElement;
  readonly cx: number;
  readonly cy: number;
}

/** A deterministic pseudo random in [-1, 1]. Deterministic on purpose:
    `Math.random` gives a different answer on a re-render, and in a tree
    that can render twice the drawing visibly reshuffles between them. */
function jitter(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function measure(svg: SVGSVGElement): Stroke[] {
  const out: Stroke[] = [];
  svg.querySelectorAll<SVGGraphicsElement>(SELECTOR).forEach((el) => {
    let box: DOMRect | undefined;
    try {
      box = el.getBBox();
    } catch {
      return;
    }
    /* A stroke with no extent in either direction measured as nothing and
       stays inert rather than animating from a garbage vector. */
    if (!box || (!box.width && !box.height)) return;
    out.push({ el, cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
  });
  return out;
}

function centreOf(strokes: readonly Stroke[]): { x: number; y: number } {
  const n = strokes.length || 1;
  return {
    x: strokes.reduce((sum, s) => sum + s.cx, 0) / n,
    y: strokes.reduce((sum, s) => sum + s.cy, 0) / n,
  };
}

function px(value: number): string {
  return `${value.toFixed(2)}px`;
}

/* ── discover ────────────────────────────────────────────────────────
 *
 * The cubes were authored as polygon, then polyline, then line, one run
 * per cube, so a new polygon is a new cube. That is a rule about how the
 * file was drawn rather than about where the shapes are, which is why it
 * beats clustering by position: neighbouring cubes in an isometric stack
 * sit closer to each other than the top face of a cube sits to its own
 * bottom edge, so distance alone splits cubes and merges neighbours.
 */
function asBlocks(strokes: readonly Stroke[]): Stroke[][] {
  const blocks: Stroke[][] = [];
  strokes.forEach((stroke) => {
    if (stroke.el.tagName === 'polygon' || blocks.length === 0) blocks.push([stroke]);
    else blocks[blocks.length - 1]!.push(stroke);
  });
  return blocks;
}

const SWAP_REACH = 34; /* user units. Past this the two are not neighbours
                          and the trade reads as a shape flying across the
                          drawing rather than as the stack rearranging. */
const SWAP_PAIRS = 14;

function setUpDiscover(strokes: readonly Stroke[]): void {
  const blocks = asBlocks(strokes);
  const centres = blocks.map((block) => centreOf(block));
  const taken = new Set<number>();
  let made = 0;

  for (let i = 0; i < centres.length && made < SWAP_PAIRS; i += 1) {
    if (taken.has(i)) continue;
    let best = -1;
    let bestDistance = Infinity;
    for (let j = i + 1; j < centres.length; j += 1) {
      if (taken.has(j)) continue;
      const distance = Math.hypot(centres[i]!.x - centres[j]!.x, centres[i]!.y - centres[j]!.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    }
    if (best < 0 || bestDistance > SWAP_REACH) continue;

    taken.add(i);
    taken.add(best);
    const dx = centres[best]!.x - centres[i]!.x;
    const dy = centres[best]!.y - centres[i]!.y;
    /* Staggered across the loop so the stack is always partly in motion.
       All at once reads as the whole drawing sliding. */
    const delay = `${made * 430}ms`;

    blocks[i]!.forEach((s) => {
      s.el.dataset.saMove = '';
      s.el.style.setProperty('--sx', px(dx));
      s.el.style.setProperty('--sy', px(dy));
      s.el.style.setProperty('--d', delay);
    });
    blocks[best]!.forEach((s) => {
      s.el.dataset.saMove = '';
      s.el.style.setProperty('--sx', px(-dx));
      s.el.style.setProperty('--sy', px(-dy));
      s.el.style.setProperty('--d', delay);
    });
    made += 1;
  }
}

/* ── charts ──────────────────────────────────────────────────────────
 *
 * Banded by radius, three bands of equal population, the middle one
 * turning against the other two. Equal population rather than equal
 * radius because the strokes are not spread evenly: split by distance and
 * the outer band gets four paths and the inner one gets fifty.
 */
const SPINS: ReadonlyArray<readonly [string, string]> = [
  ['34s', 'normal'],
  ['46s', 'reverse'],
  ['62s', 'normal'],
];

function setUpCharts(strokes: readonly Stroke[]): void {
  const middle = centreOf(strokes);
  const ranked = [...strokes].sort(
    (a, b) =>
      Math.hypot(a.cx - middle.x, a.cy - middle.y) - Math.hypot(b.cx - middle.x, b.cy - middle.y),
  );
  const band = Math.ceil(ranked.length / SPINS.length);

  ranked.forEach((stroke, index) => {
    const [duration, direction] = SPINS[Math.min(Math.floor(index / band), SPINS.length - 1)]!;
    stroke.el.dataset.saSpin = '';
    stroke.el.style.setProperty('--px', px(middle.x));
    stroke.el.style.setProperty('--py', px(middle.y));
    stroke.el.style.setProperty('--dur', duration);
    stroke.el.style.setProperty('--dir', direction);
  });
}

/* ── conditionals ────────────────────────────────────────────────────
 *
 * The drawing is a hammer over a disc. Everything right of x=95 in the
 * drawing's own units is the head and its shaft; the disc and the arcs
 * around it sit left of it, and the rod along the top left is neither, so
 * it is left out of both and stays still.
 *
 * The pin is the top of the shaft. A positive angle is clockwise on
 * screen, and the head hangs BELOW the pin, so a positive angle carries it
 * left and down, which is where the disc is.
 */
const HAMMER_EDGE = 95;
const PIN = { x: 120, y: 22 };

function setUpConditionals(strokes: readonly Stroke[]): void {
  strokes.forEach((stroke) => {
    if (stroke.cx > HAMMER_EDGE) {
      stroke.el.dataset.saSwing = '';
      stroke.el.style.setProperty('--px', px(PIN.x));
      stroke.el.style.setProperty('--py', px(PIN.y));
      return;
    }
    /* What it lands on. The rod across the top left is not part of the
       strike, so it keeps still. */
    if (stroke.cy > 40) stroke.el.dataset.saHit = '';
  });
}

/* ── tracking ────────────────────────────────────────────────────────
 *
 * Out along its own ray, a little turn on the way, hold, and back. The
 * distance grows with the radius so the outside of the drawing opens
 * further than the middle, which is what makes it read as breaking rather
 * than as scaling up.
 */
function setUpTracking(strokes: readonly Stroke[]): void {
  const middle = centreOf(strokes);
  const reach = Math.max(
    ...strokes.map((s) => Math.hypot(s.cx - middle.x, s.cy - middle.y)),
    1,
  );

  strokes.forEach((stroke, index) => {
    const dx = stroke.cx - middle.x;
    const dy = stroke.cy - middle.y;
    const radius = Math.hypot(dx, dy) || 1;
    const push = 14 + 16 * (radius / reach);

    stroke.el.dataset.saBurst = '';
    stroke.el.style.setProperty('--sx', px((dx / radius) * push));
    stroke.el.style.setProperty('--sy', px((dy / radius) * push));
    stroke.el.style.setProperty('--px', px(stroke.cx));
    stroke.el.style.setProperty('--py', px(stroke.cy));
    stroke.el.style.setProperty('--ra', `${(jitter(index, 3) * 15).toFixed(2)}deg`);
    stroke.el.style.setProperty('--d', `${Math.min(index * 9, 380)}ms`);
  });
}

const SET_UP: Record<LineArtName, (strokes: readonly Stroke[]) => void> = {
  discover: setUpDiscover,
  charts: setUpCharts,
  conditionals: setUpConditionals,
  tracking: setUpTracking,
};

export function SurfaceArt({ name, className }: { name: LineArtName; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  /* 1 · Measure and arm, once. */
  useEffect(() => {
    if (reducedMotion) return;
    const svg = host.current?.querySelector('svg');
    if (!svg || svg.dataset.sa) return;

    const strokes = measure(svg);
    if (!strokes.length) return;

    SET_UP[name](strokes);
    /* The attribute that turns the stylesheet on. It goes LAST, so no
       element is ever animating from a vector that has not been written
       yet. */
    svg.dataset.sa = name;
  }, [name, reducedMotion]);

  /* 2 · Pause while off screen. Never the other way round: see the note
     above about failing towards motion rather than towards frozen. */
  useEffect(() => {
    const node = host.current;
    if (!node || reducedMotion || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === false) node.dataset.saRest = '';
        else delete node.dataset.saRest;
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  return (
    <span ref={host} className={className}>
      <LineArt name={name} className="size-full" />
    </span>
  );
}

/**
 * Pure geometry + persistence codec for the floating agent window.
 * Kept free of DOM access so clamping and the localStorage payload
 * round-trip are unit-testable (`window-geometry.test.ts`).
 */

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** Persisted shape of `agent-chat:window:v1` (open state + geometry). */
export interface StoredWindowState {
  open: boolean;
  /** null = never dragged/resized: the window sits at its CSS default. */
  geometry: WindowGeometry | null;
}

export const WINDOW_STORAGE_KEY = 'agent-chat:window:v1';

export const WINDOW_DEFAULT_W = 420;
export const WINDOW_DEFAULT_H = 560;
/**
 * Fresh-window height under the Soren skin (`soren-chat-surface`): the
 * measured 420 × 555 panel. Only the CSS default moves — a persisted
 * geometry still wins, and the resize limits below are unchanged (555 sits
 * well inside `WINDOW_MIN_H`).
 */
export const WINDOW_SOREN_DEFAULT_H = 555;
export const WINDOW_MIN_W = 360;
export const WINDOW_MIN_H = 420;
/** Breathing room kept between the window and each viewport edge. */
export const WINDOW_VIEWPORT_MARGIN = 16;
/** Below this viewport width the window degrades to a fixed side sheet. */
export const WINDOW_FLOAT_MIN_VIEWPORT_W = 1100;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A DOMRect's read-only geometry fields (what callers pass in). */
export interface MeasuredRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measured (physical) rect → LAYOUT px, the unit `left/top/width/height`
 * are written back in.
 *
 * `getBoundingClientRect()` and `clientX/Y` report physical viewport px,
 * but fixed offsets are multiplied by the low-DPI page zoom
 * (`html { zoom: var(--ui-scale) }`). Storing a measured rect without
 * dividing it out re-multiplies on the next paint, so the window grew by
 * the zoom factor on every gesture — including a plain header click.
 */
export function rectToLayoutGeometry(rect: MeasuredRect, zoom: number): WindowGeometry {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return { x: rect.left / z, y: rect.top / z, w: rect.width / z, h: rect.height / z };
}

/** Physical pointer delta → layout px (same divisor as the rect above). */
export function toLayoutPx(physicalDelta: number, zoom: number): number {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return physicalDelta / z;
}

/**
 * Clamp a window rect fully inside the viewport: size within
 * [min, viewport - 2*margin] and position keeping every edge at least
 * `margin` from the viewport. Size wins over position (a window wider
 * than the viewport allows is shrunk first, then placed).
 */
export function clampGeometry(geometry: WindowGeometry, viewport: ViewportSize): WindowGeometry {
  const maxW = Math.max(WINDOW_MIN_W, viewport.width - 2 * WINDOW_VIEWPORT_MARGIN);
  const maxH = Math.max(WINDOW_MIN_H, viewport.height - 2 * WINDOW_VIEWPORT_MARGIN);
  const w = clampNumber(geometry.w, WINDOW_MIN_W, maxW);
  const h = clampNumber(geometry.h, WINDOW_MIN_H, maxH);
  const x = clampNumber(
    geometry.x,
    WINDOW_VIEWPORT_MARGIN,
    Math.max(WINDOW_VIEWPORT_MARGIN, viewport.width - w - WINDOW_VIEWPORT_MARGIN),
  );
  const y = clampNumber(
    geometry.y,
    WINDOW_VIEWPORT_MARGIN,
    Math.max(WINDOW_VIEWPORT_MARGIN, viewport.height - h - WINDOW_VIEWPORT_MARGIN),
  );
  return { x, y, w, h };
}

export function geometryEquals(a: WindowGeometry | null, b: WindowGeometry | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseGeometry(value: unknown): WindowGeometry | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (
    !isFiniteNumber(rec.x) ||
    !isFiniteNumber(rec.y) ||
    !isFiniteNumber(rec.w) ||
    !isFiniteNumber(rec.h)
  ) {
    return null;
  }
  return { x: rec.x, y: rec.y, w: rec.w, h: rec.h };
}

/**
 * Parse the persisted window state. Anything malformed (junk JSON, wrong
 * shape, non-finite numbers) yields null — callers fall back to defaults.
 * The pre-window `agent-chat:panel-open` sessionStorage key is simply
 * never read: no migration, old value ignored.
 */
export function parseStoredWindowState(raw: string | null): StoredWindowState | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.open !== 'boolean') return null;
  return { open: rec.open, geometry: parseGeometry(rec.geometry) };
}

export function serializeWindowState(state: StoredWindowState): string {
  return JSON.stringify({ open: state.open, geometry: state.geometry });
}

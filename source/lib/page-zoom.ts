/**
 * Effective page zoom from the low-DPI UI auto-scale (globals.css sets
 * `html { zoom: var(--ui-scale) }` on standard-density screens).
 *
 * Chrome reports mouse coordinates (clientX/Y) in physical viewport pixels,
 * but positions fixed/absolute elements in zoom-multiplied pixels. Any code
 * that feeds pointer deltas into element positions must divide by this
 * factor or dragged elements outrun the cursor by the scale factor.
 * Returns 1 wherever the scale is off (all high-DPI screens, SSR).
 */
export function pageZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

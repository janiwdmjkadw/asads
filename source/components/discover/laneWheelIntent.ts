import type { Axis } from './layout/types';

export interface WheelIntent {
  ctrlKey: boolean;
  deltaX: number;
  deltaY: number;
}

export interface ScrollableLane {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
}

/** Match the browser/listener split in useHorizontalWheel: a dominant
 * vertical gesture is translated to x; otherwise native horizontal delta
 * drives the lane. Keeping this choice shared prevents diagonal trackpad
 * input from being classified differently before and during native motion. */
export function horizontalWheelUsesVertical(
  intent: Pick<WheelIntent, 'deltaX' | 'deltaY'>,
): boolean {
  return intent.deltaY !== 0 && Math.abs(intent.deltaY) > Math.abs(intent.deltaX);
}

export function horizontalWheelDelta(intent: Pick<WheelIntent, 'deltaX' | 'deltaY'>): number {
  return horizontalWheelUsesVertical(intent) ? intent.deltaY : intent.deltaX;
}

/** Whether this wheel can move the lane along its configured card flow.
 * Pinch/zero-delta/edge input must not enter a false 250ms scroll state. */
export function laneWillConsumeWheel(
  lane: ScrollableLane,
  cardFlow: Axis,
  intent: WheelIntent,
): boolean {
  if (intent.ctrlKey) return false;
  const horizontal = cardFlow === 'horizontal';
  const delta = horizontal ? horizontalWheelDelta(intent) : intent.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return false;
  const offset = horizontal ? lane.scrollLeft : lane.scrollTop;
  const extent = horizontal
    ? lane.scrollWidth - lane.clientWidth
    : lane.scrollHeight - lane.clientHeight;
  if (extent <= 0) return false;
  return delta > 0 ? offset < extent - 0.5 : offset > 0.5;
}

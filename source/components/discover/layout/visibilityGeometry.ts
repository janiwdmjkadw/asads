import type { Axis } from './types';

const HORIZONTAL_OVERSCAN_PX = 600;
const VERTICAL_OVERSCAN_PX = 240;

/**
 * Expand only along the lane's scroll axis. Dense vertical lanes cross card
 * boundaries much more frequently, so they use a smaller live window while
 * horizontal carousels keep the larger buffer needed for wide cards.
 */
export function laneVisibilityRootMargin(cardFlow: Axis): string {
  return cardFlow === 'horizontal'
    ? `0px ${HORIZONTAL_OVERSCAN_PX}px`
    : `${VERTICAL_OVERSCAN_PX}px 0px`;
}

/** Remount slots when the layout axis flips so no old off-screen visibility
 *  state can survive into a newly on-screen position before observer setup. */
export function laneSlotKey(cardFlow: Axis, itemKey: string): string {
  return `${cardFlow}:${itemKey}`;
}

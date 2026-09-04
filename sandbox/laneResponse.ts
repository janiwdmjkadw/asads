/**
 * Shared body builders for the two discover envelopes, so the REST snapshot
 * and the SSE full frame can never drift apart.
 */
import { buildFixtureRows, LANE_PRESETS, type FixtureOptions } from './fixtures';

export type LaneName = keyof typeof LANE_PRESETS;

export function laneItems(lane: LaneName, nowMs: number) {
  return buildFixtureRows(nowMs, LANE_PRESETS[lane] as FixtureOptions);
}

/** Both endpoints answer `{ items: LiveNewPair[] }` (see LiveNewPairsResponse). */
export function laneSnapshot(lane: LaneName) {
  return { items: laneItems(lane, Date.now()) };
}

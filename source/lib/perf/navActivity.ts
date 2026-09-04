/**
 * Monotonic counter of feed-store snapshot applies (both Discover stores
 * bump it from `ingest`/`replace`). Nav telemetry snapshots it at trace
 * start/end — the delta says how many feed applies ran DURING a
 * navigation, i.e. how much sub-50ms churn competed with the route
 * transition without ever registering as a long task.
 */
let feedApplies = 0;

export function bumpFeedApply(): void {
  feedApplies += 1;
}

export function feedApplyCount(): number {
  return feedApplies;
}

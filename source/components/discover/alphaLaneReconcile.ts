import type { LiveAlphaCoin } from '@/lib/api/alpha-calls-shared';

// Identity reconciliation for the alpha lane. `mergeAlphaLane` rebuilds every
// card object from scratch each derivation (a fresh `calls.map`), so
// `applyAlphaLiveStats`'s reference-return can only ever hand back
// just-created objects — memo(AlphaCard) sees new props for the whole lane on
// every stats-Map identity change. Reconciling the freshly derived lane
// against the PREVIOUS emission restores reference identity for cards whose
// rendered content did not change, without altering rendered output: the
// compare covers EVERY own field, so any visible change (age label, thesis
// edit, identity fill, live stats, callers, first-call context…) still emits
// the new object.
//
// Keyed by `callId` — the lane renders one card PER CALL, so `id` (the mint)
// repeats across callSequence siblings and must never be the key.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shallowObjectEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function arrayContentEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Field-wise content compare across EVERY own field of two lane coins.
 * Primitives compare strictly; `links` / `firstCall` field-wise; `callers`
 * element-wise. Unknown nested shapes fall through to not-equal — the safe
 * (false-negative) direction: never report equal for different content.
 */
export function alphaCoinContentEqual(a: LiveAlphaCoin, b: LiveAlphaCoin): boolean {
  if (a === b) return true;
  const aRec = a as unknown as Record<string, unknown>;
  const bRec = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)]);
  for (const key of keys) {
    const av = aRec[key];
    const bv = bRec[key];
    if (av === bv) continue;
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (!arrayContentEqual(av, bv)) return false;
      continue;
    }
    if (isPlainObject(av) && isPlainObject(bv)) {
      if (!shallowObjectEqual(av, bv)) return false;
      continue;
    }
    return false;
  }
  return true;
}

export interface AlphaLaneReconcileResult {
  lane: LiveAlphaCoin[];
  /** Emitted coins keyed by callId — feed back as `prevByCallId` next run. */
  byCallId: Map<string, LiveAlphaCoin>;
}

/**
 * Emit the previous run's object for every coin whose content is unchanged
 * (memoized cards skip on reference equality), the fresh object otherwise.
 * Pure — the caller owns the ref that carries `byCallId` across derivations.
 */
export function reconcileAlphaLane(
  next: readonly LiveAlphaCoin[],
  prevByCallId: ReadonlyMap<string, LiveAlphaCoin>,
): AlphaLaneReconcileResult {
  const byCallId = new Map<string, LiveAlphaCoin>();
  const lane = next.map((coin) => {
    if (!coin.callId) return coin;
    const prev = prevByCallId.get(coin.callId);
    const emitted = prev !== undefined && alphaCoinContentEqual(prev, coin) ? prev : coin;
    byCallId.set(coin.callId, emitted);
    return emitted;
  });
  return { lane, byCallId };
}

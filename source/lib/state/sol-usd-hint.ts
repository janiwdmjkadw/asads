// Last-good SOL/USD price observed by ANY surface that receives one
// (token snapshots on the trade page, the alpha lane's batched snapshot
// reads on Discover). Toast market-cap math reads it synchronously —
// consumers must tolerate null (hide the figure) rather than fetch.
const MAX_AGE_MS = 10 * 60_000;

let value: number | null = null;
let observedAtMs = 0;

export function setSolUsdHint(next: number | null | undefined): void {
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return;
  value = next;
  observedAtMs = Date.now();
}

export function getSolUsdHint(): number | null {
  if (value === null || Date.now() - observedAtMs > MAX_AGE_MS) return null;
  return value;
}

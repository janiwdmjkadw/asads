/**
 * Parse an SSE frame's `lastEventId` into a comparable integer for the
 * per-connection replay guard. Returns null for empty/non-numeric ids
 * (guard disabled — streams that don't stamp `id:` never engage it).
 */
export function parseSseEventId(lastEventId: string | undefined): bigint | null {
  if (!lastEventId || !/^\d+$/.test(lastEventId)) return null;
  try {
    return BigInt(lastEventId);
  } catch {
    return null;
  }
}

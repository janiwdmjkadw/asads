/** Exact integer decoding for the ingestion service wire versions 1 and 2. */

export type EvmWireVersion = '1' | '2';

const CANONICAL_UNSIGNED = /^(0|[1-9][0-9]*)$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function readEvmWireVersion(value: unknown): EvmWireVersion | null {
  return value === '1' || value === '2' ? value : null;
}

/**
 * Decode an exact, non-negative producer integer into the terminal's numeric
 * domain. V1 used JSON numbers; V2 uses canonical decimal strings. Values
 * outside JavaScript's exact integer range are refused instead of rounded.
 */
export function readWideUnsigned(value: unknown, version: EvmWireVersion): number | null {
  if (version === '1') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  }
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SAFE ? Number(parsed) : null;
}

/** Bounded integers remain JSON numbers in both wire versions. */
export function readBoundedUnsigned(value: unknown, maximum: number): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maximum
    ? value
    : null;
}

/** Bounded signed integers remain JSON numbers in both wire versions. */
export function readBoundedSigned(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

export function isCanonicalUnsigned(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UNSIGNED.test(value);
}

import { formatSolCompact } from '@/lib/format';

/** Lamports (as the api's string payload) → SOL number; 0 on junk. */
export function lamportsToSol(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value / 1e9 : 0;
}

/**
 * One decimal under 1000 ("33.2"), compact above; two decimals under 1
 * so a real 0.05 SOL reads "0.05", never a false "0.0".
 */
export function sol1(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return formatSolCompact(v);
  if (abs > 0 && abs < 1) return v.toFixed(2);
  return v.toFixed(1);
}

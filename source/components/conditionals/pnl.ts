/**
 * Realized economics for a conditional, derived from the engine's own
 * fills — the entry price, the exit price, and the net.
 *
 * The notional is the SWAP notional when every fill carries one (0176:
 * what the tokens themselves cost, ATA rent and fees excluded) and the
 * wallet delta otherwise — the same preference order settlement uses to
 * stamp entries, so the page and the stop-loss math can never disagree
 * about what "entry" means. All arithmetic is bigint over lamports and
 * base units; formatting truncates, never rounds up.
 */

import type { ConditionalFiring, FillTimes } from '@/lib/conditionals/types';

export interface FiringEconomics {
  readonly operationId: string;
  readonly side: 'buy' | 'sell';
  readonly mint: string | null;
  /** |token delta|, base units. */
  readonly tokens: bigint;
  /** |swap ?? wallet delta|, lamports. */
  readonly notionalLamports: bigint;
  /** Lamports per WHOLE token (1e6 base units), for display. */
  readonly priceLamportsPerToken: bigint;
}

export interface ConditionalPnl {
  /** Σ buy notionals, lamports. */
  readonly spentLamports: bigint;
  /** Σ sell notionals, lamports. */
  readonly receivedLamports: bigint;
  readonly netLamports: bigint;
  /** true when every bought token has been sold (±0.5% dust tolerance). */
  readonly roundTrip: boolean;
  /** Net as bps of spend; null when nothing was spent. */
  readonly netBps: number | null;
  /** Positions still open (priced in, no exit yet). Optional: the firing rollup has no position count. */
  readonly openCount?: number;
  /** Positions priced into the rollup. Optional, as `openCount`. */
  readonly positionCount?: number;
}

function toBigInt(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined || !/^-?\d+$/.test(text)) return null;
  return BigInt(text);
}

function magnitude(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Per-firing realized economics; only FILLED firings with fill facts price. */
export function firingEconomics(
  firings: readonly ConditionalFiring[],
  fillTimes: FillTimes | undefined,
): ReadonlyMap<string, FiringEconomics> {
  const out = new Map<string, FiringEconomics>();
  if (fillTimes?.available !== true) return out;
  const byOp = new Map(fillTimes.entries.map((entry) => [entry.operation_id, entry]));
  for (const firing of firings) {
    if (firing.state !== 'filled') continue;
    const facts = byOp.get(firing.operation_id);
    if (facts === undefined) continue;
    const side = facts.side === 'buy' || facts.side === 'sell' ? facts.side : null;
    const tokens = toBigInt(facts.token_delta_base_units);
    const swap = toBigInt(facts.swap_sol_lamports ?? null);
    const wallet = toBigInt(facts.sol_delta_lamports);
    const notional = swap ?? wallet;
    if (side === null || tokens === null || notional === null) continue;
    const absTokens = magnitude(tokens);
    if (absTokens === 0n) continue;
    out.set(firing.operation_id, {
      operationId: firing.operation_id,
      side,
      mint: firing.mint ?? firing.token?.mint ?? null,
      tokens: absTokens,
      notionalLamports: magnitude(notional),
      priceLamportsPerToken: (magnitude(notional) * 1_000_000n) / absTokens,
    });
  }
  return out;
}

/** The conditional's realized rollup across every filled firing. */
export function conditionalPnl(economics: ReadonlyMap<string, FiringEconomics>): ConditionalPnl | null {
  let spent = 0n;
  let received = 0n;
  let bought = 0n;
  let sold = 0n;
  for (const fact of economics.values()) {
    if (fact.side === 'buy') {
      spent += fact.notionalLamports;
      bought += fact.tokens;
    } else {
      received += fact.notionalLamports;
      sold += fact.tokens;
    }
  }
  if (spent === 0n && received === 0n) return null;
  const net = received - spent;
  const dust = bought / 200n; // 0.5%
  return {
    spentLamports: spent,
    receivedLamports: received,
    netLamports: net,
    roundTrip: bought > 0n && magnitude(bought - sold) <= dust,
    netBps: spent === 0n ? null : Number((net * 10_000n) / spent),
  };
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Truncated SOL rendering at full lamport precision, trailing zeros
 * trimmed: "1.5", "0.001040732", "+0.000050615". Full precision because a
 * dust-sized win rendered at fixed decimals reads as "+0 SOL" — a real
 * +5% round trip erased by formatting.
 */
export function formatSol(lamports: bigint, opts?: { readonly sign?: boolean }): string {
  const negative = lamports < 0n;
  const abs = magnitude(lamports);
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;
  const fracText = frac.toString().padStart(9, '0').replace(/0+$/, '');
  const body = fracText.length === 0 ? whole.toString() : `${whole}.${fracText}`;
  if (negative) return `−${body}`;
  return opts?.sign === true ? `+${body}` : body;
}

/** "+12.4%" / "−3.1%" from bps, one decimal, truncated. */
export function formatBpsPct(bps: number): string {
  const sign = bps < 0 ? '−' : '+';
  const abs = Math.abs(bps);
  return `${sign}${Math.trunc(abs / 10) / 10}%`;
}

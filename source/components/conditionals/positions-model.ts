/**
 * The positions read model → what the page says about each one.
 *
 * The api's `positions[]` is one per ENTRY firing; this turns each into a
 * row the list can draw (status word, entry line, trigger/fill line, exit
 * line, realized PnL) and rolls them up into the page's PnL strip. Pure —
 * every number is bigint over lamports / micro-USD, and every string is
 * truncated, never rounded up, matching `pnl.ts`.
 *
 * NO LIVE PRICE. This surface subscribes to no feed (04-frontend.md
 * invariant 4), so a target's distance is stated RELATIVE TO ENTRY from the
 * plan's own words, never against a quote the page does not have.
 *
 * TRIGGER VS FILL. The exec plane keeps no market payloads, so the level a
 * trigger fired on is the plan's THRESHOLD ("MC ≥ $5K"), labelled as such;
 * the fill market cap is the settlement's own USD stamp. The line between
 * them is what stops a user reading the screen price as their entry.
 */

import type { ConditionalPosition } from '@/lib/conditionals/types';
import type { ClockContext } from './ledger-model';
import { stampSeconds } from './ledger-model';
import { formatBpsPct, formatSol } from './pnl';
import type { ConditionalPnl } from './pnl';

export type PositionTone = 'watch' | 'hold' | 'past' | 'fail';

export interface PositionRow {
  readonly key: string;
  readonly token: { readonly mint: string; readonly symbol: string | null } | null;
  readonly statusWord: string;
  readonly tone: PositionTone;
  /** "0.00099 SOL in · 904 tokens @ 0.000001094 SOL" */
  readonly entryText: string;
  readonly entryAt: string;
  /** "Triggered ≥ $5K · Filled $4.55K (46.9 SOL MC) · −9% vs trigger" or null. */
  readonly triggerFillText: string | null;
  /** "sold 0.00104 SOL · Aug 21, 21:05:05" / "sold outside this plan …" or null. */
  readonly exitText: string | null;
  readonly exitNote: string | null;
  readonly signature: string | null;
  readonly pnlText: string | null;
  readonly pnlUp: boolean | null;
  readonly targets: readonly { readonly key: string; readonly text: string; readonly inZone: boolean | null }[];
}

function big(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined || !/^-?\d+$/.test(text)) return null;
  return BigInt(text);
}

function trimZeros(text: string): string {
  return text.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/** "$5K" / "$4.55K" / "$1.2M" from micro-USD — the api's own short form. */
export function formatUsdMicros(micros: bigint): string {
  // Sign and dust are handled up front: the magnitude formatter below would
  // otherwise print "$-5" for a negative and "$0" for anything under a cent.
  if (micros < 0n) return `−${formatUsdMicros(-micros)}`;
  if (micros > 0n && micros < 10_000n) return '<$0.01';
  const usd = Number(micros) / 1_000_000;
  const short = (v: number, unit: string): string =>
    `$${trimZeros(v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))}${unit}`;
  if (usd >= 1_000_000_000) return short(usd / 1_000_000_000, 'B');
  if (usd >= 1_000_000) return short(usd / 1_000_000, 'M');
  if (usd >= 1_000) return short(usd / 1_000, 'K');
  return short(usd, '');
}

/** "904M" / "12.1K" / "950" whole tokens from 6-decimal base units. */
export function formatTokens(baseUnits: bigint): string {
  const whole = Number(baseUnits) / 1_000_000;
  const short = (v: number, unit: string): string =>
    `${trimZeros(v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))}${unit}`;
  if (whole >= 1_000_000_000) return short(whole / 1_000_000_000, 'B');
  if (whole >= 1_000_000) return short(whole / 1_000_000, 'M');
  if (whole >= 1_000) return short(whole / 1_000, 'K');
  return short(whole, '');
}

/** SOL with at most 2 decimals for market caps ("46.9 SOL"). */
function formatSolShort(lamports: bigint): string {
  return trimZeros((Number(lamports) / 1_000_000_000).toFixed(2));
}

const STATUS: Readonly<Record<string, { readonly word: string; readonly tone: PositionTone }>> = {
  watching: { word: 'Watching', tone: 'watch' },
  exited: { word: 'Exited', tone: 'past' },
  closed_external: { word: 'Sold outside', tone: 'hold' },
  closing: { word: 'Selling', tone: 'watch' },
  failed: { word: 'Exit failed', tone: 'fail' },
  stopped: { word: 'Exit stopped', tone: 'hold' },
  none: { word: 'Open', tone: 'past' },
};

export function triggerFillText(position: ConditionalPosition): string | null {
  const trigger = position.trigger;
  const fillMicros = big(position.entry.fill_mcap_usd_micros);
  const fillLamports = big(position.entry.mcap_lamports_estimate);
  if (trigger === null && fillMicros === null) return null;
  const parts: string[] = [];
  if (trigger !== null) {
    parts.push(trigger.mcap_usd_micros === null ? `Triggered at ${trigger.text}` : `Triggered ${trigger.text.replace(/^MC /, '')}`);
  }
  if (fillMicros !== null) {
    const sol = fillLamports === null ? '' : ` (${formatSolShort(fillLamports)} SOL MC)`;
    parts.push(`Filled ${formatUsdMicros(fillMicros)}${sol}`);
  } else if (fillLamports !== null) {
    parts.push(`Filled at ${formatSolShort(fillLamports)} SOL MC`);
  }
  // The gap is a USD-vs-USD figure; without the USD fill it would be a
  // number beside a basis it was not computed against.
  const gap = trigger?.gap_bps_vs_trigger ?? null;
  if (gap !== null && fillMicros !== null) parts.push(`${formatBpsPct(gap)} vs trigger`);
  return parts.join(' · ');
}

export function positionRow(position: ConditionalPosition, ctx: ClockContext): PositionRow {
  const status = STATUS[position.exit_leg.state] ?? { word: position.exit_leg.state, tone: 'past' as const };
  const solIn = big(position.entry.sol_in_lamports);
  const tokens = big(position.entry.token_base_units);
  const priceNum = big(position.entry.price_lamports_per_token?.num);
  const priceDen = big(position.entry.price_lamports_per_token?.den);
  const priceLamports = priceNum !== null && priceDen !== null && priceDen > 0n ? priceNum / priceDen : null;
  const entryText =
    solIn === null || tokens === null
      ? 'Fill not read yet'
      : `${formatSol(solIn)} SOL in · ${formatTokens(tokens)} tokens${priceLamports === null ? '' : ` @ ${formatSol(priceLamports)} SOL`}`;

  const exit = position.exit;
  const solOut = exit === null ? null : big(exit.sol_out_lamports);
  let exitText: string | null = null;
  let exitNote: string | null = null;
  if (exit !== null) {
    const when = stampSeconds(exit.filled_at, ctx);
    exitText = `${exit.source === 'external' ? 'Sold' : 'Sold by this plan'}${solOut === null ? '' : ` for ${formatSol(solOut)} SOL`}${when === '' ? '' : ` · ${when}`}`;
    if (exit.source === 'external') exitNote = 'Sold outside this plan, the exit leg did not run.';
  } else if (position.exit_leg.state === 'failed') {
    exitNote = 'The exit order did not fill, the position is still held.';
  } else if (position.exit_leg.state === 'closing') {
    exitNote = 'Exit order sent, waiting for the fill.';
  } else if (position.exit_leg.state === 'stopped') {
    exitNote = 'The plan stopped before this position was sold, it is still held.';
  } else if (position.exit_leg.state === 'watching' && (position.exit_leg.failed_attempts ?? 0) > 0) {
    const n = position.exit_leg.failed_attempts ?? 0;
    exitNote = `${n === 1 ? 'One exit attempt' : `${n} exit attempts`} did not fill, re-armed and watching again.`;
  }

  const realized = big(position.pnl.realized_lamports);
  const pnlText =
    realized === null
      ? null
      : `${formatSol(realized, { sign: true })} SOL${position.pnl.realized_bps === null ? '' : ` (${formatBpsPct(position.pnl.realized_bps)})`}`;

  return {
    key: position.position_id,
    token: position.token ?? (position.mint === null ? null : { mint: position.mint, symbol: null }),
    statusWord: status.word,
    tone: status.tone,
    entryText,
    entryAt: stampSeconds(position.entry.filled_at ?? position.entry.claimed_at, ctx),
    triggerFillText: triggerFillText(position),
    exitText,
    exitNote,
    signature: exit?.signature ?? null,
    pnlText,
    pnlUp: realized === null ? null : realized >= 0n,
    targets: position.exit_leg.targets.map((target) => ({
      key: `${position.position_id}:${target.node_idx}`,
      text: target.human,
      inZone: target.in_zone,
    })),
  };
}

export function positionRows(positions: readonly ConditionalPosition[], ctx: ClockContext): readonly PositionRow[] {
  return positions.map((position) => positionRow(position, ctx));
}

/**
 * The strip's rollup across positions — the same shape `conditionalPnl`
 * serves, so the strip needs no second renderer. Differs from the
 * firing-based rollup in ONE way: a position sold OUTSIDE the plan counts
 * its external proceeds as received, because that SOL is in the wallet
 * whether or not this plan's exit leg ran.
 */
export function positionsPnl(positions: readonly ConditionalPosition[]): ConditionalPnl | null {
  let spent = 0n;
  let received = 0n;
  let priced = 0;
  let closed = 0;
  for (const position of positions) {
    const solIn = big(position.entry.sol_in_lamports);
    if (solIn === null) continue;
    priced += 1;
    spent += solIn;
    const solOut = position.exit === null ? null : big(position.exit.sol_out_lamports);
    if (solOut === null) continue;
    received += solOut;
    closed += 1;
  }
  if (priced === 0) return null;
  const net = received - spent;
  return {
    spentLamports: spent,
    receivedLamports: received,
    netLamports: net,
    roundTrip: closed === priced,
    openCount: priced - closed,
    positionCount: priced,
    netBps: spent === 0n ? null : Number((net * 10_000n) / spent),
  };
}

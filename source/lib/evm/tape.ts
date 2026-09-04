/**
 * Trade tape for one EVM token — the PUBLIC one, plus the live edge.
 *
 * Until 2026-08-07 this module was live-only, and its header said why: there
 * was no historical trades endpoint, so a tape could only ever be what the tab
 * had watched arrive. `the ingestion service` now serves `GET /evm/trades` (the same
 * tiered cascade as the chart and the panels), so the tape is a real page of
 * history with the stream appended to its newest end.
 *
 * Pure functions, no React: the ordering, dedup and seam rules are the whole
 * substance and they do not need a DOM.
 *
 * Invariants:
 * - **Dedup on the canonical `(blockNumber, txIndex, logIndex)` triple.** That
 *   is the chain's own total order, so it identifies a trade the same way on
 *   both sides of the snapshot/stream boundary. `seq` cannot: it is a feed
 *   sequence minted per process life and has no meaning for a stored row, and
 *   `/evm/trades` deliberately does not fabricate one.
 * - **Newest first, and bounded.** A page left open for a day must not grow an
 *   unbounded array — the cap is the memory contract.
 * - **Money stays a string.** `amount`/`cost` are `u128` base units; the
 *   formatter is the only thing that narrows them, and only for display.
 * - **A reorg RETRACTS rows.** `reverted` frames drop the live edge; the page
 *   behind it is re-read rather than patched.
 * - **`tier: 'unavailable'` is NOT an empty tape** and never renders as one.
 *
 * THE SEAM, and the hop that makes it necessary. A live trade frame carries
 * `side`/`amount`/`cost` and the block HASH, and no canonical position:
 * the backend source (four.meme) and `:1197-1202` (the AMM path) build
 * the payload and neither inserts `blockNumber`/`txIndex`/`logIndex`. So a
 * live frame cannot be canonically keyed today, and a trade that lands in the
 * snapshot AND arrives over the socket cannot be recognised as one trade by
 * key alone. Two rules bridge it, in this order:
 *   1. If a frame ever DOES carry the triple, it is keyed canonically and the
 *      dedup is exact. Parsed here already, so that lands for free.
 *   2. Otherwise a frame whose block the page already carries is DROPPED. A
 *      dropped row is a row missing from the newest screenful for as long as
 *      it takes the next refetch; a double-printed row is a fill that never
 *      happened. This module has always chosen that direction (see the
 *      `reverted` rule) and it chooses it here.
 */

import type { EvmFrame } from './stream';
import {
  isCanonicalUnsigned,
  readBoundedUnsigned,
  readEvmWireVersion,
  readWideUnsigned,
  type EvmWireVersion,
} from './wireInteger';

/** Rows retained. A trader reads the last screenful; the rest is analytics. */
export const TAPE_CAP = 120;

/** How many rows to ask `/evm/trades` for. The server caps it further. */
export const TAPE_PAGE_LIMIT = 100;

/**
 * Which tier answered (the backend source).
 *
 * A closed vocabulary, and the client keeps it closed: an unrecognized tier is
 * a wire-shape change, not a fifth kind of emptiness to guess at.
 */
export const EVM_TAPE_TIERS = ['fold', 'cold', 'cold_empty', 'unavailable'] as const;
export type EvmTapeTier = (typeof EVM_TAPE_TIERS)[number];

/** The chain's own total order over trades. */
export interface EvmTapePosition {
  blockNumber: number;
  txIndex: number;
  logIndex: number;
}

export interface EvmTapeEntry {
  /** Dedup identity — canonical when a position is known, else the feed seq. */
  key: string;
  /** Which side of the seam produced it. The seam rule needs to know. */
  origin: 'history' | 'live';
  /** Canonical position, or `null` on a live frame (see the module header). */
  position: EvmTapePosition | null;
  /** Feed sequence — live frames only, and never a dedup key across the seam. */
  seq: number | null;
  side: 'buy' | 'sell';
  /** Native wei spent (buy) or received (sell), excluding fee. */
  cost: string;
  /** Token base units moved. */
  amount: string;
  /** Block time in ms, or `null` when the block carried no usable timestamp. */
  occurredAtMs: number | null;
  /** Block that produced it — what the seam rule and a retraction target. */
  blockHash: string | null;
  /** Present on history rows; the live frame envelope does not carry it. */
  txHash: string | null;
  trader: string | null;
  venue: string | null;
}

/**
 * One `/evm/trades` response, parsed.
 *
 * The honesty fields are kept SEPARATE rather than folded into one "partial"
 * boolean, because they fail independently and mean different things: `tier`
 * says who answered, `historyComplete` says whether this is the token's whole
 * life, `droppedOlder` sizes the gap, and `total` vs `count` says how much of
 * what the server holds is on screen.
 */
export interface EvmTapePage {
  tier: EvmTapeTier;
  historyComplete: boolean;
  stale: boolean;
  /** Rows in this page. */
  count: number;
  /** Rows the server holds — `> count` means this page is a window. */
  total: number;
  truncated: boolean;
  /** Rows older than this page, sized. `null` when the server did not say. */
  droppedOlder: string | null;
  entries: readonly EvmTapeEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON number that can index a chain position.
 *
 * `Number.isSafeInteger`, not `isInteger`: past 2^53 the parse has already
 * lost digits, and a position that silently collides with its neighbour is a
 * dedup key that merges two different trades into one.
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readSide(value: unknown): 'buy' | 'sell' | null {
  return value === 'buy' || value === 'sell' ? value : null;
}

/** The canonical triple off any row-or-payload shape, or `null`. */
function readPosition(
  raw: Record<string, unknown>,
  version: EvmWireVersion,
): EvmTapePosition | null {
  const blockNumber = readWideUnsigned(raw['blockNumber'], version);
  const txIndex = readBoundedUnsigned(raw['txIndex'], 0xffff_ffff);
  const logIndex = readBoundedUnsigned(raw['logIndex'], 0xffff_ffff);
  // All three or none. Two thirds of a position does not order anything, and
  // defaulting the missing one to 0 would place the row at the top of its
  // block among trades it did not precede.
  if (blockNumber === null || txIndex === null || logIndex === null) return null;
  return { blockNumber, txIndex, logIndex };
}

function positionKey(position: EvmTapePosition): string {
  return `${position.blockNumber}:${position.txIndex}:${position.logIndex}`;
}

/**
 * One `/evm/trades` row, parsed strictly.
 *
 * Returns `null` rather than a partially-filled row: a trade we cannot account
 * for is dropped, never printed with zeros. `side`/`isBuy` both appear on the
 * wire and either is accepted — the server sends both on purpose.
 */
export function parseTapeRow(
  raw: unknown,
  version: EvmWireVersion = '1',
): EvmTapeEntry | null {
  if (!isObject(raw)) return null;
  const position = readPosition(raw, version);
  if (position === null) return null;
  const side =
    readSide(raw['side']) ??
    (typeof raw['isBuy'] === 'boolean' ? (raw['isBuy'] ? 'buy' : 'sell') : null);
  const cost = readString(raw['cost']);
  const amount = readString(raw['amount']);
  if (
    side === null
    || !isCanonicalUnsigned(cost)
    || !isCanonicalUnsigned(amount)
    || cost === '0'
    || amount === '0'
    || (typeof raw['isBuy'] === 'boolean' && raw['isBuy'] !== (side === 'buy'))
  ) {
    return null;
  }
  // `occurredAtMs` is null on the wire when the block carried no usable
  // timestamp. Null here too — never 1970, and never "now".
  const occurredAtMs = raw['occurredAtMs'] === null
    ? null
    : readWideUnsigned(raw['occurredAtMs'], version);
  if (raw['occurredAtMs'] !== null && occurredAtMs === null) return null;
  return {
    key: positionKey(position),
    origin: 'history',
    position,
    seq: null,
    side,
    cost,
    amount,
    occurredAtMs: occurredAtMs !== null && occurredAtMs > 0 ? occurredAtMs : null,
    blockHash: readString(raw['blockHash']),
    txHash: readString(raw['txHash']),
    trader: readString(raw['trader']),
    venue: readString(raw['venue']),
  };
}

/**
 * A `/evm/trades` body, parsed.
 *
 * `tier` is REQUIRED and must be one of the four labels. A body without it is
 * not a tape page — most likely an error envelope or a proxy's HTML — and
 * calling that an empty tape is the exact lie this endpoint exists to avoid.
 */
export function parseTapePage(body: unknown): EvmTapePage | null {
  if (!isObject(body)) return null;
  const version = readEvmWireVersion(body['v']);
  if (version === null) return null;
  const tier = body['tier'];
  if (
    typeof tier !== 'string' ||
    !(EVM_TAPE_TIERS as readonly string[]).includes(tier)
  ) {
    return null;
  }
  const rows = body['trades'];
  if (!Array.isArray(rows)) return null;
  const entries: EvmTapeEntry[] = [];
  for (const row of rows) {
    const parsed = parseTapeRow(row, version);
    if (parsed === null) return null;
    entries.push(parsed);
  }
  entries.sort(compareEntries);
  const total = readWideUnsigned(body['total'], version);
  const count = readBoundedUnsigned(body['count'], 100_000);
  const truncated = body['truncated'];
  const droppedOlder = body['droppedOlder'];
  if (
    count === null
    || total === null
    || count !== rows.length
    || total < count
    || typeof truncated !== 'boolean'
    || truncated !== (total > count)
    || typeof body['historyComplete'] !== 'boolean'
    || typeof body['stale'] !== 'boolean'
    || (droppedOlder !== undefined
      && droppedOlder !== null
      && !isCanonicalUnsigned(droppedOlder))
  ) {
    return null;
  }
  return {
    tier: tier as EvmTapeTier,
    // Absent flags are read in the PESSIMISTIC direction. `historyComplete`
    // defaulting to true would claim a whole trading life off a body that
    // never said so.
    historyComplete: body['historyComplete'],
    stale: body['stale'],
    count,
    total,
    truncated,
    // A decimal string on the wire (it is a u64), kept as one.
    droppedOlder: droppedOlder === undefined || droppedOlder === null ? null : droppedOlder,
    entries,
  };
}

/**
 * Newest first.
 *
 * Live rows sort above every history row: the seam rule only admits a live
 * frame from a block the page does not carry, so an admitted live row is
 * newer than the page by construction. Within a family the order is exact —
 * the canonical triple for history, the feed seq for live.
 */
function compareEntries(left: EvmTapeEntry, right: EvmTapeEntry): number {
  if (left.position !== null && right.position !== null) {
    return (
      right.position.blockNumber - left.position.blockNumber ||
      right.position.txIndex - left.position.txIndex ||
      right.position.logIndex - left.position.logIndex
    );
  }
  if (left.position === null && right.position === null) {
    return (right.seq ?? 0) - (left.seq ?? 0);
  }
  // Positionless (live) above positioned (history).
  return left.position === null ? -1 : 1;
}

/**
 * Apply one live frame to the live edge. Returns the SAME array when nothing
 * changed so React can bail out of a repaint by identity.
 *
 * `token` is the lowercase address this tape belongs to; frames for any other
 * token are ignored rather than mixed in. `page` is the snapshot currently on
 * screen, and it is what the seam rule consults — pass `null` before one has
 * landed, which admits everything (there is nothing yet to double-print).
 */
export function applyTapeFrame(
  entries: readonly EvmTapeEntry[],
  frame: EvmFrame,
  token: string,
  page: EvmTapePage | null = null,
): readonly EvmTapeEntry[] {
  if (frame.token !== token) return entries;

  if (frame.kind === 'reverted') {
    // Everything we printed came from blocks the reorg may have replaced, and
    // the frame gives a fork root in BLOCK NUMBER terms while a live row
    // carries only a hash. Rather than guess which rows survive, the live edge
    // is dropped and re-accumulates from the replacement branch. The page
    // behind it is re-read by the caller. Dropping is conservative in the safe
    // direction: an empty edge is honestly empty, a wrong one lies about fills.
    return entries.length === 0 ? entries : [];
  }

  if (frame.kind !== 'trade') return entries;
  const payload = isObject(frame.payload) ? frame.payload : null;
  if (payload === null) return entries;
  const side = readSide(payload['side']);
  const cost = readString(payload['cost']);
  const amount = readString(payload['amount']);
  if (side === null || cost === null || amount === null) {
    // A trade we cannot account for is DROPPED, not printed with zeros.
    return entries;
  }

  // FORWARD-COMPATIBLE. The payload does not carry a position today (see the
  // module header); the moment it does, the frame is keyed canonically and the
  // seam stops being a heuristic.
  const position = readPosition(payload, '1');
  const key = position === null ? `seq:${frame.seq}` : positionKey(position);
  if (entries.some((entry) => entry.key === key)) return entries;
  if (page !== null) {
    if (page.entries.some((entry) => entry.key === key)) return entries;
    // THE SEAM. Without a position there is no key to compare, so the block is
    // the finest identity available: a frame from a block the page already
    // carries may already be printed, and a double-printed fill is
    // indistinguishable from two fills.
    if (
      position === null &&
      frame.blockHash !== null &&
      page.entries.some((entry) => entry.blockHash === frame.blockHash)
    ) {
      return entries;
    }
  }

  const next: EvmTapeEntry = {
    key,
    origin: 'live',
    position,
    seq: frame.seq,
    side,
    cost,
    amount,
    // 0 from the wire means "the block carried no usable timestamp"
    // (an internal routine defaults to 0), which is unknown —
    // never 1970.
    occurredAtMs: frame.occurredAtMs > 0 ? frame.occurredAtMs : null,
    blockHash: frame.blockHash,
    // The frame envelope carries neither; absent, not empty-string.
    txHash: null,
    trader: null,
    venue: null,
  };
  const out = [next, ...entries].sort(compareEntries);
  return out.length > TAPE_CAP ? out.slice(0, TAPE_CAP) : out;
}

/**
 * Reconcile the live edge against a snapshot that just landed.
 *
 * Live rows the new page already carries are dropped — by key when the frame
 * had a position, by block otherwise. What survives is what the page provably
 * does not contain, so merging the two cannot double-print.
 */
export function adoptTapePage(
  entries: readonly EvmTapeEntry[],
  page: EvmTapePage,
): readonly EvmTapeEntry[] {
  if (entries.length === 0) return entries;
  const keys = new Set(page.entries.map((entry) => entry.key));
  const blocks = new Set(
    page.entries
      .map((entry) => entry.blockHash)
      .filter((hash): hash is string => hash !== null),
  );
  const kept = entries.filter(
    (entry) =>
      !keys.has(entry.key) &&
      !(entry.position === null && entry.blockHash !== null && blocks.has(entry.blockHash)),
  );
  return kept.length === entries.length ? entries : kept;
}

/**
 * The rendered tape: the live edge above the page, newest first, bounded.
 *
 * Returns the page's own rows when there is no live edge, so the common case
 * allocates nothing.
 */
export function mergeTape(
  page: EvmTapePage | null,
  live: readonly EvmTapeEntry[],
): readonly EvmTapeEntry[] {
  if (page === null) return live.length > TAPE_CAP ? live.slice(0, TAPE_CAP) : live;
  if (live.length === 0) {
    return page.entries.length > TAPE_CAP ? page.entries.slice(0, TAPE_CAP) : page.entries;
  }
  const out = [...live, ...page.entries].sort(compareEntries);
  return out.length > TAPE_CAP ? out.slice(0, TAPE_CAP) : out;
}

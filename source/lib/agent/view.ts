/**
 * Turn view-model — pure, framework-free helpers that shape a turn's
 * `ParsedPart[]` for rendering:
 *
 *   - `buildTurnItems` pairs `tool_result` parts to their `tool_call` by
 *     `toolCallId` (join on PART CONTENT, never part ids — snapshots
 *     re-key ids, see chat-core's snapshot branch) and merges a completed
 *     `get_token_chart` result into the preceding `get_token_state` item
 *     so the token card can show its sparkline.
 *   - preview parsers extract display-safe views of the §13 tool payload
 *     shapes. All parsers are defensive: previews are UNTRUSTED `unknown`
 *     data; anything malformed yields `null` and the renderer falls back
 *     to the digest chip. Parsed values are only ever rendered as TEXT.
 */

import {
  compactNumber,
  compactUsd,
  formatPriceUsd,
  formatSolCompact,
} from '@/lib/format';
import type { ParsedPart } from './contracts';

export type ToolViewState = 'running' | 'done' | 'soft_failed';

export interface SoftFailView {
  readonly code: string;
  readonly hint: string | null;
}

export interface ToolViewItem {
  readonly kind: 'tool';
  readonly toolCallId: string;
  /** Tool name from the call; null when the result arrived orphaned. */
  readonly name: string | null;
  readonly args: unknown;
  readonly state: ToolViewState;
  /** Result preview (undefined while running). */
  readonly preview: unknown;
  readonly digest: string | null;
  readonly softFail: SoftFailView | null;
  /** Completed chart tool item folded into this token-state item. */
  readonly chart: ToolViewItem | null;
}

export interface PartViewItem {
  readonly kind: 'part';
  readonly parsed: ParsedPart;
}

export type TurnViewItem = ToolViewItem | PartViewItem;

export const TOOL_TOKEN_STATE = 'get_token_state';
export const TOOL_TOKEN_CHART = 'get_token_chart';
export const TOOL_TOKEN_HOLDERS = 'get_token_holders';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Soft failure convention: preview `{error: {code, hint?}}` (§13). */
export function softFailOf(preview: unknown): SoftFailView | null {
  if (!isRecord(preview)) return null;
  const error = preview.error;
  if (!isRecord(error) || typeof error.code !== 'string') return null;
  return {
    code: error.code,
    hint: typeof error.hint === 'string' ? error.hint : null,
  };
}

interface MutableTool {
  kind: 'tool';
  toolCallId: string;
  name: string | null;
  args: unknown;
  state: ToolViewState;
  preview: unknown;
  digest: string | null;
  softFail: SoftFailView | null;
  chart: ToolViewItem | null;
}

/**
 * Shape one turn's parts for rendering. Non-tool parts pass through in
 * order; tool calls become items that absorb their result when it
 * arrives. Orphan results (no call with that id seen) become items with
 * `name: null` so the renderer can fall back to the digest chip.
 */
export function buildTurnItems(parts: ParsedPart[]): TurnViewItem[] {
  const items: (PartViewItem | MutableTool)[] = [];
  const openCalls = new Map<string, MutableTool>();

  for (const parsed of parts) {
    if (parsed.known && parsed.part.type === 'tool_call') {
      const tool: MutableTool = {
        kind: 'tool',
        toolCallId: parsed.part.toolCallId,
        name: parsed.part.name,
        args: parsed.part.args,
        state: 'running',
        preview: undefined,
        digest: null,
        softFail: null,
        chart: null,
      };
      // A re-emitted call for the same id reconciles (replaces) the open
      // slot rather than duplicating — mirrors part_state semantics.
      const existing = openCalls.get(tool.toolCallId);
      if (existing !== undefined && existing.state === 'running') {
        existing.name = tool.name;
        existing.args = tool.args;
      } else {
        openCalls.set(tool.toolCallId, tool);
        items.push(tool);
      }
      continue;
    }
    if (parsed.known && parsed.part.type === 'tool_result') {
      const call = openCalls.get(parsed.part.toolCallId);
      const softFail = softFailOf(parsed.part.preview);
      if (call !== undefined && call.state === 'running') {
        call.state = softFail === null ? 'done' : 'soft_failed';
        call.preview = parsed.part.preview;
        call.digest = parsed.part.digest;
        call.softFail = softFail;
      } else {
        // Orphan result: render standalone (digest chip fallback lane).
        items.push({
          kind: 'tool',
          toolCallId: parsed.part.toolCallId,
          name: null,
          args: undefined,
          state: softFail === null ? 'done' : 'soft_failed',
          preview: parsed.part.preview,
          digest: parsed.part.digest,
          softFail,
          chart: null,
        });
      }
      continue;
    }
    items.push({ kind: 'part', parsed });
  }

  // Fold each completed chart into the nearest preceding completed
  // token-state item that has none yet (the card renders the sparkline).
  const result: TurnViewItem[] = [];
  for (const item of items) {
    if (
      item.kind === 'tool' &&
      item.name === TOOL_TOKEN_CHART &&
      item.state === 'done'
    ) {
      const host = [...result]
        .reverse()
        .find(
          (candidate): candidate is ToolViewItem =>
            candidate.kind === 'tool' &&
            candidate.name === TOOL_TOKEN_STATE &&
            candidate.state === 'done' &&
            candidate.chart === null,
        );
      if (host !== undefined) {
        (host as MutableTool).chart = item;
        continue;
      }
    }
    result.push(item);
  }

  // Holders numbers the same turn already fetched belong on the card.
  joinTurnHolders(result);

  // Status parts are transient activity ("reading the chart…"): anything
  // that follows supersedes them. Only a TRAILING status survives — so it
  // shows while streaming and disappears once real content arrives.
  const lastIndex = result.length - 1;
  return result.filter((item, index) => {
    if (item.kind !== 'part' || !item.parsed.known) return true;
    if (item.parsed.part.type !== 'status') return true;
    return index === lastIndex;
  });
}

/** Plain text of a turn (text parts joined) — the copy-action payload. */
export function turnPlainText(parts: ParsedPart[]): string {
  return parts
    .filter((p): p is ParsedPart & { known: true } => p.known)
    .map((p) => (p.part.type === 'text' ? p.part.text : ''))
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/* ------------------------------------------------------------------ *
 * §13 preview parsers (display views; null = fall back to generic)
 * ------------------------------------------------------------------ */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Token metadata is ATTACKER-WRITABLE: `twitter` / `telegram` /
 * `website` are whatever the mint's creator typed. Same rule Discover
 * applies to its social links (`isSafeLinkHref` in
 * `components/discover/CardMetaRows.tsx`) — only http/https survives,
 * so `javascript:`, `data:` and friends can never reach an `href`.
 * Stricter here in one respect: the URL must be ABSOLUTE, because a
 * relative social link would silently resolve against the terminal's
 * own origin and point at one of our pages.
 */
export function safeSocialUrl(value: unknown): string | null {
  const raw = str(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface TokenStateView {
  /** Mint — identity, the truncated subline, and every link/image. */
  readonly mint: string | null;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly priceUsd: number | null;
  readonly marketCapUsd: number | null;
  readonly vol24hUsd: number | null;
  readonly tradeCount: number | null;
  readonly graduated: boolean;
  readonly createdAtMs: number | null;
  readonly asOfMs: number | null;
  /** Validated http/https socials; null when absent or unsafe. */
  readonly twitter: string | null;
  readonly telegram: string | null;
  readonly website: string | null;
  /** From the turn-local holders join (`joinTurnHolders`), else null. */
  readonly holderCount: number | null;
  readonly top10Pct: number | null;
}

/** §13.4 `get_token_state` preview → card view. */
export function parseTokenStatePreview(preview: unknown): TokenStateView | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const view: TokenStateView = {
    mint: str(preview.mint),
    symbol: str(preview.symbol),
    name: str(preview.name),
    priceUsd: num(preview.price_usd),
    marketCapUsd: num(preview.market_cap_usd),
    vol24hUsd: num(preview.vol_24h_usd),
    tradeCount: num(preview.trade_count),
    graduated: preview.graduated === true,
    createdAtMs: num(preview.created_at_ms),
    asOfMs: num(preview.as_of_ms),
    twitter: safeSocialUrl(preview.twitter),
    telegram: safeSocialUrl(preview.telegram),
    website: safeSocialUrl(preview.website),
    holderCount: num(preview.holder_count_total),
    top10Pct: num(preview.top10_supply_pct),
  };
  // A card with neither an identity nor a price is not a token state —
  // degrade to the generic renderer instead of an empty card shell.
  if (view.symbol === null && view.name === null && view.priceUsd === null) return null;
  return view;
}

/**
 * TURN-LOCAL MINT → SYMBOL. The ticker a `get_token_state` result in
 * THIS conversation already reported for exactly this mint.
 *
 * Reads `tool_result` parts directly rather than `buildTurnItems`: the
 * only caller (the proposal card's token chip) needs one string and
 * would otherwise re-pair every part on every stream tick.
 *
 * The match is strictly by mint, like `joinTurnHolders` — a state for a
 * different token leaves the answer `null` and the caller falls back to
 * the truncated mint rather than borrowing another token's name. The
 * preview is SERVER data (a tool result), never model-authored prose.
 */
export function tokenSymbolForMint(parts: readonly ParsedPart[], mint: string): string | null {
  if (mint === '') return null;
  for (const parsed of parts) {
    if (!parsed.known || parsed.part.type !== 'tool_result') continue;
    const state = parseTokenStatePreview(parsed.part.preview);
    if (state === null || state.mint !== mint) continue;
    if (state.symbol !== null) return state.symbol;
  }
  return null;
}

export interface ChartViewPoint {
  readonly tMs: number;
  readonly close: number;
}

export interface ChartView {
  readonly changePct: number | null;
  /** The window `changePct` is measured over ("1h"), for the label. */
  readonly timeframe: string | null;
  readonly points: readonly ChartViewPoint[];
}

/** §13.5 `get_token_chart` preview → sparkline view (empty series ok). */
export function parseChartPreview(preview: unknown): ChartView | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const changePct = num(preview.change_pct);
  const timeframe = str(preview.timeframe);
  const rawSeries = Array.isArray(preview.series) ? preview.series : null;
  if (rawSeries === null && changePct === null) return null;
  const points: ChartViewPoint[] = [];
  for (const entry of rawSeries ?? []) {
    if (!isRecord(entry)) continue;
    const tMs = num(entry.t_ms);
    const close = num(entry.c);
    if (tMs === null || close === null) continue;
    points.push({ tMs, close });
  }
  return { changePct, timeframe, points };
}

export interface HoldersView {
  readonly top10SupplyPct: number | null;
  readonly holderCountTotal: number | null;
}

/** §13.6 `get_token_holders` preview → concentration one-liner view. */
export function parseHoldersPreview(preview: unknown): HoldersView | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const view: HoldersView = {
    top10SupplyPct: num(preview.top10_supply_pct),
    holderCountTotal: num(preview.holder_count_total),
  };
  if (view.top10SupplyPct === null && view.holderCountTotal === null) return null;
  return view;
}

/** One top-holder row, as `get_token_holders` wires it (top 10 max). */
export interface HolderRowView {
  readonly rank: number | null;
  readonly owner: string;
  readonly supplyPct: number | null;
  /** Signed SOL. The wire's one live per-holder number; the design's
   *  open "time column" has no wire truth, so PnL takes that lane. */
  readonly unrealizedPnlSol: number | null;
}

/**
 * §13.6b — the holders preview's ROWS, for the L06 list pane. Additive
 * beside `parseHoldersPreview` (whose aggregate view several joins pin by
 * shape): null when the preview carries no readable row.
 */
export function parseHoldersRows(preview: unknown): readonly HolderRowView[] | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const raw = preview['top_holders'];
  if (!Array.isArray(raw)) return null;
  const rows: HolderRowView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['owner'] !== 'string' || entry['owner'] === '') continue;
    rows.push({
      rank: num(entry['rank']),
      owner: entry['owner'],
      supplyPct: num(entry['supply_pct']),
      unrealizedPnlSol: num(entry['unrealized_pnl_sol']),
    });
  }
  return rows.length === 0 ? null : rows;
}

export const TOOL_TOKEN_TRADES = 'get_token_trades';
export const TOOL_MY_TRADES = 'get_my_trades';
export const TOOL_TRACKED_ACTIVITY = 'get_tracked_wallet_activity';
export const TOOL_SEARCH_TOKENS = 'search_tokens';
export const TOOL_SCREEN_TOKENS = 'screen_tokens';
export const TOOL_COMPARE_WALLETS = 'compare_wallets';

/** One trade row, whichever of the three trade tools wired it. */
export interface TradeRowView {
  readonly timeMs: number | null;
  readonly side: 'buy' | 'sell';
  /** Lamports as a number — display precision only, never arithmetic. */
  readonly solLamports: number | null;
  /** The counterparty address (tape/tracked) — null for the user's own fills. */
  readonly wallet: string | null;
  /** The traded mint, when the wire names one (fills/tracked). */
  readonly mint: string | null;
}

function lamportsNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * §13.6c — the three trade wires, one lane. `get_token_trades` carries
 * `trades[]` (`user`/`is_buy`/`sol_lamports`/`block_time_ms`); tracked
 * activity carries `events[]` (`wallet`/`is_buy`/…); `get_my_trades`
 * carries `fills[]` (`side`/`sol_delta_lamports` signed, no address —
 * every fill is the user's own). Null when nothing readable.
 */
export function parseTradesPreview(preview: unknown): readonly TradeRowView[] | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const rows: TradeRowView[] = [];
  const push = (row: TradeRowView | null): void => {
    if (row !== null) rows.push(row);
  };
  const tape = preview['trades'];
  if (Array.isArray(tape)) {
    for (const t of tape) {
      if (!isRecord(t) || typeof t['is_buy'] !== 'boolean') continue;
      push({
        timeMs: num(t['block_time_ms']),
        side: t['is_buy'] === true ? 'buy' : 'sell',
        solLamports: lamportsNum(t['sol_lamports']),
        wallet: typeof t['user'] === 'string' && t['user'] !== '' ? t['user'] : null,
        mint: null,
      });
    }
  }
  const events = preview['events'];
  if (Array.isArray(events)) {
    for (const e of events) {
      if (!isRecord(e) || typeof e['is_buy'] !== 'boolean') continue;
      push({
        timeMs: num(e['block_time_ms']) ?? num(e['received_at_ms']),
        side: e['is_buy'] === true ? 'buy' : 'sell',
        solLamports: lamportsNum(e['sol_lamports']),
        wallet: typeof e['wallet'] === 'string' && e['wallet'] !== '' ? e['wallet'] : null,
        mint: typeof e['mint'] === 'string' && e['mint'] !== '' ? e['mint'] : null,
      });
    }
  }
  const fills = preview['fills'];
  if (Array.isArray(fills)) {
    for (const f of fills) {
      if (!isRecord(f)) continue;
      const side = f['side'];
      if (side !== 'buy' && side !== 'sell') continue;
      const delta = lamportsNum(f['sol_delta_lamports']);
      push({
        timeMs: num(f['confirmed_at_ms']),
        side,
        solLamports: delta === null ? null : Math.abs(delta),
        wallet: null,
        mint: typeof f['mint'] === 'string' && f['mint'] !== '' ? f['mint'] : null,
      });
    }
  }
  return rows.length === 0 ? null : rows;
}

/** One screener/search result row, as `wireSearchResult` shapes it. */
export interface TokenRowView {
  readonly mint: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly mcapUsd: number | null;
  readonly vol1hUsd: number | null;
  readonly ageMs: number | null;
}

/**
 * §13.6d — `search_tokens` / `screen_tokens` results. The wire carries
 * NO price and NO change — mcap, 1h volume and age are what a row can
 * truthfully say (the design's price/% lanes have no source here).
 */
export function parseTokenListPreview(preview: unknown): readonly TokenRowView[] | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const raw = preview['results'];
  if (!Array.isArray(raw)) return null;
  const rows: TokenRowView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['mint'] !== 'string' || entry['mint'] === '') continue;
    rows.push({
      mint: entry['mint'],
      symbol: typeof entry['symbol'] === 'string' ? entry['symbol'] : null,
      name: typeof entry['name'] === 'string' ? entry['name'] : null,
      mcapUsd: num(entry['market_cap_usd']),
      vol1hUsd: num(entry['vol_1h_usd']),
      ageMs: num(entry['age_ms']),
    });
  }
  return rows.length === 0 ? null : rows;
}

/** One compared wallet's metric column (C06 head + values). */
export interface CompareWalletView {
  readonly address: string;
  readonly label: string | null;
  readonly pnlSol: number | null;
  readonly volumeSol: number | null;
  readonly trades: number | null;
  readonly lifetimePnlSol: number | null;
}

/**
 * §13.6e — `compare_wallets` rows → the two columns C06 draws. The wire
 * ranks a cohort; the pane compares the FIRST TWO rows as served (the
 * tool's own sort), which is also what the model's prose will be talking
 * about. Null under two comparable wallets.
 */
export function parseComparePreview(preview: unknown): readonly CompareWalletView[] | null {
  if (!isRecord(preview) || softFailOf(preview) !== null) return null;
  const raw = preview['rows'];
  if (!Array.isArray(raw)) return null;
  const wallets: CompareWalletView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['wallet'] !== 'string' || entry['wallet'] === '') continue;
    const buys = num(entry['buys']);
    const sells = num(entry['sells']);
    wallets.push({
      address: entry['wallet'],
      label: typeof entry['label'] === 'string' && entry['label'] !== '' ? entry['label'] : null,
      pnlSol: num(entry['realized_pnl_sol']),
      volumeSol: num(entry['window_volume_sol']),
      trades: buys === null && sells === null ? null : (buys ?? 0) + (sells ?? 0),
      lifetimePnlSol: num(entry['lifetime_realized_pnl_sol']),
    });
    if (wallets.length === 2) break;
  }
  return wallets.length === 2 ? wallets : null;
}

/**
 * TURN-LOCAL HOLDERS JOIN. `get_token_state` carries no holder count and
 * no top-10 concentration, but a turn that asks about a token almost
 * always runs `get_token_holders` too — and those two numbers are what
 * the agent's own prose cites (50-token-data mock A). This lifts them
 * onto the state payload so the card's metric grid can print them,
 * WITHOUT removing the holders result: its node keeps its own digest
 * inside the activity group.
 *
 * The match is strictly by mint. A holders result for a different token
 * — or one with no mint to check — leaves the cells empty; the card
 * prints an em dash rather than borrowing another token's numbers.
 *
 * Previews are never mutated: an enriched COPY replaces the reference,
 * so the payload as received stays intact for every other reader.
 */
function joinTurnHolders(items: readonly TurnViewItem[]): void {
  const byMint = new Map<string, HoldersView>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.name !== TOOL_TOKEN_HOLDERS || item.state !== 'done') continue;
    if (!isRecord(item.preview)) continue;
    const mint = str(item.preview.mint);
    const holders = parseHoldersPreview(item.preview);
    if (mint === null || holders === null || byMint.has(mint)) continue;
    byMint.set(mint, holders);
  }
  if (byMint.size === 0) return;
  for (const item of items) {
    if (item.kind !== 'tool' || item.name !== TOOL_TOKEN_STATE || item.state !== 'done') continue;
    if (!isRecord(item.preview)) continue;
    const mint = str(item.preview.mint);
    if (mint === null) continue;
    const holders = byMint.get(mint);
    if (holders === undefined) continue;
    (item as MutableTool).preview = {
      ...item.preview,
      holder_count_total: holders.holderCountTotal,
      top10_supply_pct: holders.top10SupplyPct,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Generic preview digestion (every other tool)
 * ------------------------------------------------------------------ */

export interface PreviewField {
  readonly key: string;
  /** Human label for the key ("market_cap_usd" → "market cap"). */
  readonly label: string;
  readonly value: string;
}

const MAX_FIELDS = 6;
const MAX_FIELD_CHARS = 80;

/**
 * Wire plumbing excluded from display grids: epoch milliseconds and raw
 * base units read as 16-digit noise, and no compact tier makes them
 * meaningful (`1000000000000000` is a supply, not a number to look at).
 */
const PLUMBING_KEY = /_ms$|_base_units$|_lamports$/;

/**
 * Human label for a payload key: separators to spaces, the unit suffix
 * dropped (the FORMATTED value already carries "$" / "%").
 */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+(usd|pct|sol|lamports)$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Format one numeric payload value for display, keyed off its NAME —
 * the fix for raw floats in the tool grid (`1234567.891` → `$1.2M`,
 * `31.19999999` → `31.2%`). Counts stay exact below 1000.
 */
export function formatPreviewNumber(key: string, value: number): string {
  const k = key.toLowerCase();
  if (/pct|percent/.test(k)) return `${value.toFixed(1)}%`;
  if (/price.*usd|usd.*price/.test(k)) return formatPriceUsd(value, String(value));
  if (/sol$/.test(k)) return formatSolCompact(value, String(value));
  if (/usd|market_?cap|mcap|liquidity/.test(k)) return compactUsd(value, '$0');
  if (Number.isInteger(value)) return compactNumber(value);
  return String(Number(value.toFixed(4)));
}

/**
 * Up to 6 top-level PRIMITIVE fields of an object preview (strings
 * truncated, numbers FORMATTED, epoch timestamps dropped). Nested
 * objects/arrays are skipped — unrecognized shapes (including backend
 * truncation markers) degrade to fewer/zero fields, never to raw JSON
 * dumps.
 */
export function previewFields(preview: unknown): PreviewField[] {
  if (!isRecord(preview)) return [];
  const fields: PreviewField[] = [];
  for (const [key, value] of Object.entries(preview)) {
    if (fields.length >= MAX_FIELDS) break;
    if (PLUMBING_KEY.test(key)) continue;
    let rendered: string | null = null;
    if (typeof value === 'string') {
      rendered = value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}…` : value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      rendered = formatPreviewNumber(key, value);
    } else if (typeof value === 'boolean') {
      rendered = value ? 'true' : 'false';
    } else if (value === null) {
      rendered = 'null';
    }
    if (rendered !== null) fields.push({ key, label: humanizeKey(key), value: rendered });
  }
  return fields;
}

const MAX_RAW_CHARS = 20_000;

/**
 * Stable escaped-text raw view of a preview for the "view raw"
 * disclosure. Returns null when the preview is absent, unserializable,
 * or enormous — callers fall back to the digest chip.
 */
export function previewRawText(preview: unknown): string | null {
  if (preview === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(preview, null, 2) ?? '';
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > MAX_RAW_CHARS) return null;
  return text;
}

/* ------------------------------------------------------------------ *
 * Activity group (30-thinking-tools mock E: B's collapsing shell with
 * D's node rail inside) — one object per assistant turn carrying the
 * reasoning and every tool call, so the settled thread is one 30px
 * line instead of four stacked cards.
 * ------------------------------------------------------------------ */

export type ActivityNodeState = 'running' | 'done' | 'soft_failed';

export interface ActivityNode {
  readonly key: string;
  readonly kind: 'reasoning' | 'tool';
  readonly state: ActivityNodeState;
  /** Mono row label: "reasoned" or the short tool name. */
  readonly name: string;
  /** Dim one-liner beside the name ("4 fields", "reading…", the code). */
  readonly note: string | null;
  /** Reasoning summary (reasoning nodes only). */
  readonly summary: string | null;
  /** One-line formatted result digest (tool nodes only). */
  readonly digest: string | null;
  /** Formatted key/value grid — empty when a card renders the payload. */
  readonly fields: readonly PreviewField[];
  /** Pretty JSON for the "view raw" disclosure, when previewable. */
  readonly raw: string | null;
  /** True while this node's own work is still in flight. */
  readonly streaming: boolean;
}

export interface ActivityGroup {
  readonly nodes: readonly ActivityNode[];
  /** Every tool the turn ran, INCLUDING charts folded into a card. */
  readonly toolCount: number;
  readonly reasoned: boolean;
  readonly failedCount: number;
  readonly running: boolean;
  /** Header line while working ("reading token_metrics…"). */
  readonly label: string;
  /** Header line at rest ("reasoned + 3 tools"). */
  readonly title: string;
  /**
   * The label's TRUTHFUL ingredients, un-composed, for surfaces that mix
   * their own defaults (Soren's whisper takes verb > status > whimsy — the
   * composed label's thinking…/writing…/working… tail would starve the
   * whimsy cycle, and dropping status would starve the §5.7 seam-4
   * producer the day it exists).
   */
  readonly runningToolName: string | null;
  readonly statusLabel: string | null;
}

export interface ActivitySplit {
  /** The turn's work, or null when the turn did none. */
  readonly group: ActivityGroup | null;
  /** Everything that renders OUTSIDE the group, in order. */
  readonly rest: TurnViewItem[];
}

/** Display name for a tool row ("get_token_state" → "token_state"). */
export function shortToolName(name: string): string {
  return name.replace(/^get_/, '');
}

function firstSentence(summary: string, max = 52): string | null {
  const trimmed = summary.trim();
  if (trimmed.length === 0) return null;
  const stop = trimmed.search(/[.;\n]/);
  const head = stop > 0 ? trimmed.slice(0, stop) : trimmed;
  return head.length > max ? `${head.slice(0, max - 1)}…` : head;
}

/** One-line formatted digest of a completed tool result. */
export function toolDigest(item: ToolViewItem): string | null {
  if (item.state !== 'done') return null;
  const state = parseTokenStatePreview(item.preview);
  if (state !== null) {
    const parts = [
      state.priceUsd !== null ? formatPriceUsd(state.priceUsd) : null,
      state.marketCapUsd !== null ? `${compactUsd(state.marketCapUsd, '$0')} mcap` : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  const holders = parseHoldersPreview(item.preview);
  if (holders !== null) {
    const parts = [
      holders.top10SupplyPct !== null ? `top10 ${holders.top10SupplyPct.toFixed(1)}%` : null,
      holders.holderCountTotal !== null
        ? `${compactNumber(holders.holderCountTotal)} holders`
        : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  const fields = previewFields(item.preview).slice(0, 3);
  if (fields.length > 0) return fields.map((f) => `${f.label} ${f.value}`).join(' · ');
  return item.digest !== null ? `result · ${item.digest.slice(0, 14)}` : null;
}

function pluralTools(n: number): string {
  return n === 1 ? '1 tool' : `${n} tools`;
}

/**
 * Stable node identity ACROSS the stream→history handoff: the same work
 * is re-keyed by the store when the turn commits, so a positional key
 * would restart the row's clock at the moment it settles. Tool call ids
 * come from part CONTENT and survive; reasoning has no id, so its
 * ordinal plus a digest of its text stands in.
 */
function textKey(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Split one turn's items into the activity group (reasoning + every
 * tool, reasoning FIRST — chronological, never wedged between the
 * results and the answer) and everything that renders outside it.
 *
 * `hasExternalView` names the tools whose payload a card already
 * renders (token state, the approval ack): their node stays a bare
 * labelled row so the group never duplicates — or leaks — a payload
 * the card owns.
 */
export function buildActivityGroup(
  items: readonly TurnViewItem[],
  options: {
    readonly streaming?: boolean;
    readonly hasExternalView?: (item: ToolViewItem) => boolean;
  } = {},
): ActivitySplit {
  const streaming = options.streaming === true;
  const hasExternalView = options.hasExternalView ?? (() => false);

  const reasoningNodes: ActivityNode[] = [];
  const toolNodes: ActivityNode[] = [];
  const rest: TurnViewItem[] = [];
  let toolCount = 0;
  let failedCount = 0;
  let statusLabel: string | null = null;
  let runningToolName: string | null = null;
  let reasoningStreaming = false;
  let writing = false;

  for (const [index, item] of items.entries()) {
    if (item.kind === 'tool') {
      toolCount += item.chart !== null ? 2 : 1;
      if (item.state === 'soft_failed') failedCount += 1;
      const external = hasExternalView(item);
      const name = item.name !== null ? shortToolName(item.name) : 'result';
      const fields = external || item.state !== 'done' ? [] : previewFields(item.preview);
      if (item.state === 'running') runningToolName = name;
      const digest = external ? null : toolDigest(item);
      toolNodes.push({
        key: `tool:${item.toolCallId}`,
        kind: 'tool',
        state: item.state,
        name,
        note:
          item.state === 'running'
            ? 'reading…'
            : item.state === 'soft_failed'
              ? (item.softFail?.code ?? 'error')
              : // The digest says more than a field count; only fall back
                // to the count when there is nothing to summarise.
                digest === null && fields.length > 0
                ? `${fields.length} field${fields.length === 1 ? '' : 's'}`
                : null,
        summary: null,
        digest,
        fields,
        raw: external || item.state !== 'done' ? null : previewRawText(item.preview),
        streaming: item.state === 'running',
      });
      rest.push(item);
      continue;
    }
    if (!item.parsed.known) {
      rest.push(item);
      continue;
    }
    const part = item.parsed.part;
    if (part.type === 'reasoning') {
      // A reasoning part is still growing while it is the turn's last
      // part and the turn streams (the model has not moved on yet).
      const live = streaming && index === items.length - 1;
      if (live) reasoningStreaming = true;
      reasoningNodes.push({
        key: `reasoning:${reasoningNodes.length}:${textKey(part.summary)}`,
        kind: 'reasoning',
        state: live ? 'running' : 'done',
        name: 'reasoned',
        note: live ? null : firstSentence(part.summary),
        summary: part.summary,
        digest: null,
        fields: [],
        raw: null,
        streaming: live,
      });
      continue;
    }
    if (part.type === 'status') {
      // Transient activity: it titles the group header rather than
      // occupying a row of its own.
      statusLabel = part.label.toLowerCase();
      continue;
    }
    rest.push(item);
    if (part.type === 'text' && streaming && index === items.length - 1) writing = true;
  }

  const nodes = [...reasoningNodes, ...toolNodes];
  if (nodes.length === 0 && statusLabel === null) return { group: null, rest };

  const reasoned = reasoningNodes.length > 0;
  const titleParts = [
    reasoned ? 'reasoned' : null,
    toolCount > 0 ? pluralTools(toolCount) : null,
  ].filter((p): p is string => p !== null);

  return {
    group: {
      nodes,
      toolCount,
      reasoned,
      failedCount,
      running: streaming,
      // Name what the turn is doing RIGHT NOW, most specific first.
      label:
        runningToolName !== null
          ? `reading ${runningToolName}…`
          : (statusLabel ??
            (reasoningStreaming ? 'thinking…' : writing ? 'writing…' : 'working…')),
      title: titleParts.length > 0 ? titleParts.join(' + ') : 'working',
      runningToolName,
      statusLabel,
    },
    rest,
  };
}

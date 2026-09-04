import { isUsdcPair } from '@/lib/trade/spend-currency';
import type { MockCoin } from './mockCoins';

/**
 * Client-side, per-row Discover filters.
 *
 * Filters are a pure DISPLAY concern: they run as array predicates over
 * feeds already in memory (no network, no backend, no change to any SSE
 * hot path), so they add no latency. Each Discover row keeps its own
 * independent `RowFilter`:
 *   - numeric min–max ranges over the metrics in `FILTER_METRICS`
 *   - include keywords ("search keywords"): when non-empty, a coin must
 *     match at least ONE keyword (case-folded substring over
 *     ticker | name | mint — same haystack as the section search)
 *   - exclude keywords (blacklist): ANY match hides the coin
 *   - social requirements (must have a Twitter / Telegram / website link)
 */

export type DiscoverSectionId = 'new-pairs' | 'almost-graduated' | 'graduated';

export const DISCOVER_FILTER_SECTIONS: readonly DiscoverSectionId[] = [
  'new-pairs',
  'almost-graduated',
  'graduated',
] as const;

export const DISCOVER_SECTION_LABELS: Record<DiscoverSectionId, string> = {
  'new-pairs': 'New',
  'almost-graduated': 'Soon',
  'graduated': 'Graduated',
};

/**
 * Every metric here maps to a REAL field the live feed populates on
 * `MockCoin` (see `metricValue`). Fabricated display numbers (the
 * synthesized holder count, views, followers) are deliberately absent —
 * a filter over invented data would lie.
 *   - `marketCapUsd`       — USD market cap
 *   - `ageMs`              — coin age in ms; the UI enters MINUTES
 *   - `volumeUsd`          — USD volume as DISPLAYED on the card:
 *                            trailing-24h with a 5m fallback until seeded
 *   - `txns`               — total transactions
 *   - `buyTxns`/`sellTxns` — buy / sell transaction counts
 *   - `bondingProgressPct` — bonding-curve completion % (100 once graduated)
 *   - `devHoldingsPct` / `sniperHoldingsPct` / `bundlerHoldingsPct` /
 *     `insiderHoldingsPct` — holder-class supply percentages
 */
export type FilterMetric =
  | 'marketCapUsd'
  | 'ageMs'
  | 'volumeUsd'
  | 'txns'
  | 'buyTxns'
  | 'sellTxns'
  | 'bondingProgressPct'
  | 'devHoldingsPct'
  | 'sniperHoldingsPct'
  | 'bundlerHoldingsPct'
  | 'insiderHoldingsPct';

export const FILTER_METRICS: readonly FilterMetric[] = [
  'marketCapUsd',
  'ageMs',
  'volumeUsd',
  'txns',
  'buyTxns',
  'sellTxns',
  'bondingProgressPct',
  'devHoldingsPct',
  'sniperHoldingsPct',
  'bundlerHoldingsPct',
  'insiderHoldingsPct',
] as const;

export type RangeBound = 'min' | 'max';

export interface FilterRange {
  min: number | null;
  max: number | null;
}

export type SocialKey = 'twitter' | 'telegram' | 'website';

export const SOCIAL_KEYS: readonly SocialKey[] = ['twitter', 'telegram', 'website'] as const;

export type SocialsFilter = Record<SocialKey, boolean>;

/**
 * THE PAIR'S QUOTE. Read off `coin.quoteMint`, the same field quickbuy
 * routes on, so this filter and the spend currency can never disagree.
 *
 * ── FIVE, AND THE LAST ONE IS A CATCH ────────────────────────────────
 *
 * `other` is not a token. It is every quote that is none of the four
 * named ones, and it exists so the set is EXHAUSTIVE: without it,
 * deselecting SOL, USDC, USD1 and STOCK would leave a board still
 * showing pairs, and there would be no chip on the panel that explained
 * why. A filter you cannot fully turn off is a filter you cannot trust.
 */
export type QuoteKey = 'sol' | 'usdc' | 'usd1' | 'stock' | 'other';

export const QUOTE_KEYS: readonly QuoteKey[] = ['sol', 'usdc', 'usd1', 'stock', 'other'] as const;

export type QuotesFilter = Record<QuoteKey, boolean>;

/** World Liberty Financial USD1, Solana SPL mint. */
export const USD1_MINT = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';

/**
 * Tokenised equities used as a quote.
 *
 * EMPTY ON PURPOSE, and this is the honest state of it: there is no one
 * stock mint the way there is one USDC mint — every equity is its own
 * token — and shipping a guessed list would misfile real pairs into a
 * bucket nobody could see was wrong.
 *
 * Until it is filled, a stock-quoted pair is caught by `other`, which is
 * true rather than convenient: it IS another quote. Adding the mints
 * here is the only change needed to make the STOCK chip narrow.
 */
export const STOCK_QUOTE_MINTS: ReadonlySet<string> = new Set<string>();

/**
 * THE LAUNCH MODE. `coin.mode` is a mutex the pump.fun contract enforces,
 * so a coin is in at most one of these.
 *
 * `mayhem` is deliberately absent: the board already carries a single
 * global Mayhem toggle, and a second per-row control for the same thing
 * is two answers to one question.
 */
export type ModeKey = 'charity' | 'agent' | 'cashback';

export const MODE_KEYS: readonly ModeKey[] = ['charity', 'agent', 'cashback'] as const;

/** `show` constrains nothing; `hide` drops the mode; `only` keeps it. */
export type ModeRule = 'hide' | 'show' | 'only';

export type ModesFilter = Record<ModeKey, ModeRule>;

/**
 * THE LAUNCHPAD A COIN CAME FROM.
 *
 * The discover feed rows carry no launchpad field (see `LiveNewPair`), so
 * this is derived from the mint address, which is the only place the
 * information exists client side. Launchpads brand their mints with a
 * vanity suffix, and three of them are unambiguous enough to filter on:
 * pump.fun ends `pump`, letsbonk ends `bonk`, Bags ends `bags`.
 *
 * The other twelve have no suffix we can trust, so a coin from one of
 * them reads as UNKNOWN and passes every protocol filter. That is the
 * deliberate choice: a wrong guess would hide coins that should show,
 * which is worse than a chip that does not narrow yet. Each one starts
 * filtering the day the feed carries the field, with no change here
 * beyond deleting a line from `LAUNCHPAD_MINT_SUFFIX`.
 */
export type ProtocolKey =
  | 'pumpfun'
  | 'bonk'
  | 'bags'
  | 'jupiter'
  | 'launchlab'
  | 'heaven'
  | 'moonshot'
  | 'boop'
  | 'believe'
  | 'moonit'
  | 'stonkfun'
  | 'trench'
  | 'dynamicbc'
  | 'printr';

export const PROTOCOL_KEYS: readonly ProtocolKey[] = [
  'pumpfun',
  'bonk',
  'bags',
  'jupiter',
  'launchlab',
  'heaven',
  'moonshot',
  'boop',
  'believe',
  'moonit',
  'stonkfun',
  'trench',
  'dynamicbc',
  'printr',
] as const;

export type ProtocolsFilter = Record<ProtocolKey, boolean>;

/*
 * ── A REMOVED LAUNCHPAD IS SAFE TO READ BACK ─────────────────────────
 *
 * `sugar` was dropped from the union above. Any browser that saved a
 * filter while it existed still has `"sugar": true` sitting in its
 * persisted payload.
 *
 * That is harmless and deliberately not migrated. Everything that reads
 * this record iterates `PROTOCOL_KEYS` rather than the object's own keys
 * — `emptyProtocolsFilter`, `rowFilterActive` and `passesProtocols` all
 * do — so a key nothing asks about is never looked at, and the next
 * write drops it. Migrating instead would mean versioning the stored
 * shape to delete one boolean.
 */

/** Lowercased vanity mint suffixes we can attribute with confidence. */
const LAUNCHPAD_MINT_SUFFIX: Partial<Record<ProtocolKey, string>> = {
  pumpfun: 'pump',
  bonk: 'bonk',
  bags: 'bags',
};

export type KeywordKind = 'include' | 'exclude';

/**
 * Flat range record PLUS the keyword/social criteria. Kept flat (ranges as
 * top-level keys) so `filter[metric]` indexing and the persisted v1 payload
 * shape both survive the extension.
 */
export type RowFilter = Record<FilterMetric, FilterRange> & {
  /** Folded include keywords; non-empty ⇒ a coin must match at least one. */
  include: string[];
  /** Folded blacklist keywords; any match hides the coin. */
  exclude: string[];
  socials: SocialsFilter;
  /** Selected pair quotes. Nothing selected ⇒ no constraint. */
  quotes: QuotesFilter;
  /** Per launch mode: hide it, leave it alone, or show only it. */
  modes: ModesFilter;
  /** Selected launchpads. Nothing selected ⇒ no constraint. */
  protocols: ProtocolsFilter;
};

export type DiscoverFilters = Record<DiscoverSectionId, RowFilter>;

export const AGE_FILTER_UNIT_MS = 60_000; // UI enters age in minutes

/** Bounds keep a hostile/corrupt persisted payload from ballooning. */
export const MAX_FILTER_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 40;

export function emptyRange(): FilterRange {
  return { min: null, max: null };
}

export function emptySocialsFilter(): SocialsFilter {
  return { twitter: false, telegram: false, website: false };
}

/*
 * Both quotes on, not both off. Off would mean an empty board the moment
 * the panel opens, which reads as a bug rather than as a filter.
 */
export function emptyQuotesFilter(): QuotesFilter {
  return { sol: true, usdc: true, usd1: true, stock: true, other: true };
}

export function emptyModesFilter(): ModesFilter {
  return { charity: 'show', agent: 'show', cashback: 'show' };
}

/* All on, so the panel opens showing everything rather than nothing. */
export function emptyProtocolsFilter(): ProtocolsFilter {
  const out = {} as ProtocolsFilter;
  for (const key of PROTOCOL_KEYS) out[key] = true;
  return out;
}

export function emptyRowFilter(): RowFilter {
  const filter = {
    include: [],
    exclude: [],
    socials: emptySocialsFilter(),
    quotes: emptyQuotesFilter(),
    modes: emptyModesFilter(),
    protocols: emptyProtocolsFilter(),
  } as unknown as RowFilter;
  for (const metric of FILTER_METRICS) filter[metric] = emptyRange();
  return filter;
}

export function emptyDiscoverFilters(): DiscoverFilters {
  return {
    'new-pairs': emptyRowFilter(),
    'almost-graduated': emptyRowFilter(),
    'graduated': emptyRowFilter(),
  };
}

export function cloneRowFilter(filter: RowFilter): RowFilter {
  const out = emptyRowFilter();
  for (const metric of FILTER_METRICS) out[metric] = { ...filter[metric] };
  out.include = [...filter.include];
  out.exclude = [...filter.exclude];
  out.socials = { ...filter.socials };
  out.quotes = { ...filter.quotes };
  out.modes = { ...filter.modes };
  out.protocols = { ...filter.protocols };
  return out;
}

export function cloneDiscoverFilters(filters: DiscoverFilters): DiscoverFilters {
  return {
    'new-pairs': cloneRowFilter(filters['new-pairs']),
    'almost-graduated': cloneRowFilter(filters['almost-graduated']),
    'graduated': cloneRowFilter(filters['graduated']),
  };
}

export function rangeActive(range: FilterRange): boolean {
  return range.min !== null || range.max !== null;
}

export function rowFilterActive(filter: RowFilter): boolean {
  return (
    FILTER_METRICS.some((metric) => rangeActive(filter[metric])) ||
    filter.include.length > 0 ||
    filter.exclude.length > 0 ||
    SOCIAL_KEYS.some((key) => filter.socials[key]) ||
    QUOTE_KEYS.some((key) => !filter.quotes[key]) ||
    MODE_KEYS.some((key) => filter.modes[key] !== 'show') ||
    PROTOCOL_KEYS.some((key) => !filter.protocols[key])
  );
}

function metricValue(coin: MockCoin, metric: FilterMetric): number | null {
  const raw =
    metric === 'marketCapUsd'
      ? coin.marketCapUsd
      : metric === 'volumeUsd'
        ? // Filter on what the card displays: 24h volume, 5m until seeded.
          coin.volume24hUsd ?? coin.volumeUsd
        : metric === 'ageMs'
          ? coin.ageMs
          : metric === 'txns'
            ? coin.txns
            : metric === 'buyTxns'
              ? coin.buyTxns
              : metric === 'sellTxns'
                ? coin.sellTxns
                : metric === 'bondingProgressPct'
                  ? coin.bondingProgressPct
                  : metric === 'devHoldingsPct'
                    ? coin.devHoldingsPct
                    : metric === 'sniperHoldingsPct'
                      ? coin.sniperHoldingsPct
                      : metric === 'bundlerHoldingsPct'
                        ? coin.bundlerHoldingsPct
                        : coin.insiderHoldingsPct;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function passesRange(value: number | null, range: FilterRange): boolean {
  if (!rangeActive(range)) return true;
  // A coin whose metric is unknown can't be proven to satisfy an active
  // bound, so exclude it rather than leak it past the filter.
  if (value === null) return false;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

/** Same haystack the section search matches: ticker | name | mint. */
function keywordHaystack(coin: MockCoin): string {
  return `${coin.ticker}\n${coin.name}\n${coin.id ?? ''}`.toLowerCase();
}

function passesKeywords(coin: MockCoin, filter: RowFilter): boolean {
  if (filter.include.length === 0 && filter.exclude.length === 0) return true;
  const hay = keywordHaystack(coin);
  // Blacklist wins: an excluded coin stays hidden even if it also matches
  // an include keyword — that is what a blacklist is for.
  if (filter.exclude.some((keyword) => hay.includes(keyword))) return false;
  if (filter.include.length > 0 && !filter.include.some((keyword) => hay.includes(keyword))) {
    return false;
  }
  return true;
}

function passesSocials(coin: MockCoin, socials: SocialsFilter): boolean {
  if (socials.twitter && !coin.links?.twitter) return false;
  if (socials.telegram && !coin.links?.telegram) return false;
  if (socials.website && !(coin.links?.website || coin.hasWebsite)) return false;
  return true;
}

/**
 * The coin's launch mode. `mode` is canonical; `kinds` is read as a
 * fallback for cached payloads the live adapter has not re-hydrated,
 * which is the same pair `isMayhemCoin` reads on the board.
 */
function coinMode(coin: MockCoin): ModeKey | null {
  for (const key of MODE_KEYS) {
    if (coin.mode === key || coin.kinds?.includes(key) === true) return key;
  }
  return null;
}

/**
 * Which of the five a pair is quoted in.
 *
 * An absent mint is a SOL pair — that is the feed's own convention and
 * the same one `isUsdcPair` reads, so this cannot drift from what a buy
 * actually spends.
 */
export function quoteOf(coin: { quoteMint?: string | null }): QuoteKey {
  const mint = coin.quoteMint;
  if (mint == null || mint.length === 0) return 'sol';
  if (isUsdcPair(mint)) return 'usdc';
  if (mint === USD1_MINT) return 'usd1';
  if (STOCK_QUOTE_MINTS.has(mint)) return 'stock';
  return 'other';
}

function passesQuotes(coin: MockCoin, quotes: QuotesFilter): boolean {
  // Nothing selected constrains nothing. The alternative is an empty
  // board the moment someone clears the section, which reads as a bug.
  if (QUOTE_KEYS.every((key) => !quotes[key])) return true;
  return quotes[quoteOf(coin)];
}

function passesModes(coin: MockCoin, modes: ModesFilter): boolean {
  const mode = coinMode(coin);
  if (mode !== null && modes[mode] === 'hide') return false;
  const only = MODE_KEYS.filter((key) => modes[key] === 'only');
  // `only` is a whitelist across every mode set to it: asking for only
  // charity AND only agent means either, not neither.
  if (only.length > 0 && (mode === null || !only.includes(mode))) return false;
  return true;
}

/**
 * The launchpad, read off the mint's vanity suffix. `null` when the mint
 * carries no suffix we can attribute, which is most of them.
 */
export function coinLaunchpad(coin: MockCoin): ProtocolKey | null {
  const mint = (coin.id ?? '').toLowerCase();
  if (mint.length === 0) return null;
  for (const key of PROTOCOL_KEYS) {
    const suffix = LAUNCHPAD_MINT_SUFFIX[key];
    if (suffix !== undefined && mint.endsWith(suffix)) return key;
  }
  return null;
}

function passesProtocols(coin: MockCoin, protocols: ProtocolsFilter): boolean {
  if (PROTOCOL_KEYS.every((key) => !protocols[key])) return true;
  const launchpad = coinLaunchpad(coin);
  // An unattributable mint passes. Hiding it would mean acting on a guess
  // about where it came from, and a wrong guess hides the wrong coins.
  if (launchpad === null) return true;
  return protocols[launchpad];
}

/** True when `coin` satisfies every active criterion in `filter`. */
export function coinPassesFilter(coin: MockCoin, filter: RowFilter): boolean {
  for (const metric of FILTER_METRICS) {
    if (!passesRange(metricValue(coin, metric), filter[metric])) return false;
  }
  return (
    passesKeywords(coin, filter) &&
    passesSocials(coin, filter.socials) &&
    passesQuotes(coin, filter.quotes) &&
    passesModes(coin, filter.modes) &&
    passesProtocols(coin, filter.protocols)
  );
}

/**
 * Parse a comma-separated keyword string into folded, deduped keywords.
 * Empty entries drop out; the list and each keyword are length-capped so a
 * pasted wall of text can't balloon the persisted filter.
 */
export function parseKeywords(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const keyword = part.trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH);
    if (keyword.length === 0 || out.includes(keyword)) continue;
    out.push(keyword);
    if (out.length >= MAX_FILTER_KEYWORDS) break;
  }
  return out;
}

/** Inverse of `parseKeywords` for input display. */
export function formatKeywords(keywords: readonly string[]): string {
  return keywords.join(', ');
}

/**
 * Parse a USD shorthand string into a number, or `null` when empty/invalid.
 * Accepts plain numbers and `k`/`m`/`b` suffixes (case-insensitive), with
 * optional `$` and thousands commas: `"30k"`→30000, `"1.2m"`→1_200_000,
 * `"1b"`→1e9, `"$12,500"`→12500. Negative values are rejected (→ null).
 */
export function parseShorthandUsd(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '');
  if (cleaned.length === 0) return null;
  const match = /^(\d*\.?\d+)([kmb]?)$/i.exec(cleaned);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const mult =
    match[2].toLowerCase() === 'k'
      ? 1_000
      : match[2].toLowerCase() === 'm'
        ? 1_000_000
        : match[2].toLowerCase() === 'b'
          ? 1_000_000_000
          : 1;
  return base * mult;
}

/** Compact a USD number back to a shorthand display string for inputs. */
export function formatShorthandUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (value >= 1_000_000_000) return trimZeros(value / 1_000_000_000) + 'b';
  if (value >= 1_000_000) return trimZeros(value / 1_000_000) + 'm';
  if (value >= 1_000) return trimZeros(value / 1_000) + 'k';
  return trimZeros(value);
}

/** Parse a non-negative minutes value, or `null`. */
export function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Parse a plain non-negative number (percent / count inputs), or `null`. */
export function parsePlainNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, '');
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Display string for a plain-number bound. */
export function formatPlainNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return trimZeros(value);
}

export function minutesToMs(minutes: number | null): number | null {
  return minutes === null ? null : Math.round(minutes * AGE_FILTER_UNIT_MS);
}

export function msToMinutes(ms: number | null): number | null {
  return ms === null ? null : ms / AGE_FILTER_UNIT_MS;
}

/** Display string for an age (ms) bound, in minutes. */
export function formatMinutes(ms: number | null): string {
  const minutes = msToMinutes(ms);
  if (minutes === null) return '';
  return trimZeros(minutes);
}

function trimZeros(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

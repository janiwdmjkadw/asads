/**
 * The one-line row — pure model.
 *
 * `(leaf kind + spec + scope + context) → RowModel`, implementing every
 * predicate variant the platform can author today with design-28 §4's
 * compression lexicon. The strings are the design lab's, verbatim
 * (`placement-mocks/conditional-card-lab-final.html`, section c7 gallery):
 * "Market cap ≥ $75K", "Dev sold ≥ 90%", "Exposure stays ≤ 2.5 ◎",
 * "9:30–17:00 ET · Mon–Fri".
 *
 * Rules that are not negotiable, and where they come from:
 * - No UTC ever reaches a row (§4 rule 8). Instants render in the VIEWER's
 *   zone through `Intl`, 24-hour, with a short zone tag set as a unit. The
 *   precise UTC instant is a details-drawer matter.
 * - Multiples are "2x" — a lowercase sans x. The × glyph is gone from the
 *   system entirely (§4 symbols).
 * - Wallets are 4…4 (§4 rule 8) — not `lib/format`'s 5…7, which is a
 *   different job on a different surface.
 * - Sets name one and count the rest ("@blknoiz06 +2", §4 rule 3); the
 *   members live in Details.
 * - Windows are MEASURES, right-anchored, with no leading separator
 *   (§4 rule 5) — never part of the sentence.
 * - A kind this build cannot phrase degrades to `group:'unknown'` with the
 *   server's own sentence in `raw`. It never guesses.
 *
 * Arithmetic is integer-scaled throughout: no floats, so no drifting
 * threshold ever renders.
 */

import { glyphGroupFor } from './kind-glyphs';
import type { GlyphGroup } from './kind-glyphs';
import type { LeafScope } from './ir-types';

// ───────────────────────── shape ─────────────────────────

/**
 * `unit` is the §4 "connective tissue" class — comparator marks, the x of a
 * multiple, %, the SOL mark, the zone tag, the one surviving separator. The
 * renderer sets them at 85% of the numeral, one ink-step back.
 *
 * `connective` is the GRAMMAR layer's other half: `in`, `from`, `of`, on the
 * same layer and in the same violet as `≥` and `≤`. It exists so the word
 * can be lit without lighting the noun phrase it governs — "from" is
 * grammar, "peak" is the thing being measured against.
 */
export type SegmentRole = 'subject' | 'text' | 'operator' | 'value' | 'unit' | 'ref' | 'connective';

export interface Segment {
  readonly text: string;
  readonly role: SegmentRole;
}

export interface ScopePlate {
  readonly variant: 'any_token' | 'token' | 'leg';
  readonly label: string;
  readonly mint?: string;
}

export interface RowModel {
  readonly group: GlyphGroup;
  readonly segments: readonly Segment[];
  readonly scopePlate?: ScopePlate;
  /** Right-anchored, inline, no leading glyph: "5m fresh", "within 10m". */
  readonly measure?: string;
  /** Unrecognised kinds only: the server's sentence, passed through whole. */
  readonly raw?: string;
}

export interface RowContext {
  /** The mint the card is about. A leaf scoped to it needs no plate. */
  readonly cardMint?: string;
  /** Leg number a `bound` scope resolves to, for the "Leg 1" plate. */
  readonly positionBindingLeg?: number;
  /** IANA zone. Every instant on every row renders here. */
  readonly viewerTz: string;
  /** Reference instant — decides whether the year is dropped, and which
   *  UTC offset a schedule window converts through. Defaults to now. */
  readonly now?: number;
  /** Mint → ticker, when the card knows one. Falls back to 4…4. */
  readonly symbolOf?: (mint: string) => string | undefined;
}

export interface LeafInput {
  readonly kind: string;
  readonly spec: unknown;
  readonly scope?: LeafScope;
  /** The server's rendered sentence — the fallback for an unknown kind. */
  readonly text?: string;
}

// ───────────────────────── plain text ─────────────────────────

/** Units that tuck tight against the figure they belong to (§4 symbols). */
const TIGHT_UNITS = new Set(['%', 'x', 'K', 'M', 'B']);

/**
 * The row's sentence as one string — what the phrasing tests assert and
 * what a screen reader hears. Spacing mirrors the lab's CSS: `%`, the
 * multiple's x and a magnitude suffix glue to their numeral; `$` glues to
 * the figure that follows it; the SOL mark, the zone tag and the separator
 * keep their hair of air.
 */
export function rowText(row: RowModel): string {
  if (row.segments.length === 0) return row.raw ?? '';
  let out = '';
  let previous: Segment | null = null;
  for (const segment of row.segments) {
    if (previous !== null) {
      const glued = (segment.role === 'unit' && TIGHT_UNITS.has(segment.text)) || (previous.role === 'unit' && previous.text === '$');
      if (!glued) out += ' ';
    }
    out += segment.text;
    previous = segment;
  }
  return out;
}

// ───────────────────────── number formatting ─────────────────────────

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Integer scaled-decimal → trimmed decimal string. Truncates rather than
 * rounds: a threshold must never render LARGER than it is.
 */
function scaledDecimal(units: number, scale: number, maxFrac = 12): string {
  const negative = units < 0;
  const abs = Math.abs(Math.trunc(units));
  const whole = Math.floor(abs / scale);
  const frac = abs % scale;
  const sign = negative ? '-' : '';
  if (frac === 0) return `${sign}${groupThousands(String(whole))}`;
  const digits = String(scale).length - 1;
  const fracText = String(frac).padStart(digits, '0').slice(0, maxFrac).replace(/0+$/, '');
  if (fracText.length === 0) return `${sign}${groupThousands(String(whole))}`;
  return `${sign}${groupThousands(String(whole))}.${fracText}`;
}

/** Lamports → the SOL figure, without the mark. `2_500_000_000 → "2.5"`. */
export function fmtLamports(lamports: number): string {
  return scaledDecimal(lamports, 1_000_000_000);
}

/** bps → the percent figure, without the sign. `9000 → "90"`. */
export function fmtBpsPct(bps: number): string {
  return scaledDecimal(bps, 100);
}

/** bps → the multiple figure, without the x. `20_000 → "2"`, one decimal. */
export function fmtBpsMultiple(bps: number): string {
  return scaledDecimal(bps, 10_000, 1);
}

/** A plain count, comma-grouped. `50000 → "50,000"`. */
export function fmtCount(n: number): string {
  return groupThousands(String(Math.trunc(Math.abs(n))));
}

/** `600_000 → "10m"`. Single unit, h/m/s, exactly as the platform does it. */
export function fmtDurationMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/**
 * micro-USD → §4 rule 4: K and M for magnitude. `$75,000` reads "$75K",
 * carried as a `$` unit, a figure, and a magnitude unit.
 */
function microUsdSegments(micro: number): Segment[] {
  const abs = Math.abs(micro);
  if (abs >= 1_000_000_000_000) {
    return [
      { text: '$', role: 'unit' },
      { text: scaledDecimal(micro, 1_000_000_000_000, 1), role: 'value' },
      { text: 'M', role: 'unit' },
    ];
  }
  if (abs >= 1_000_000_000) {
    return [
      { text: '$', role: 'unit' },
      { text: scaledDecimal(micro, 1_000_000_000, 1), role: 'value' },
      { text: 'K', role: 'unit' },
    ];
  }
  return [
    { text: '$', role: 'unit' },
    { text: scaledDecimal(micro, 1_000_000), role: 'value' },
  ];
}

/** pico-USD → full precision. A memecoin price is all in its tail. */
function picoUsdSegments(pico: number): Segment[] {
  return [
    { text: '$', role: 'unit' },
    { text: scaledDecimal(pico, 1_000_000_000_000), role: 'value' },
  ];
}

/** Lamports → figure + the SOL mark, which keeps its hair of air. */
function lamportSegments(lamports: number): Segment[] {
  return [
    { text: fmtLamports(lamports), role: 'value' },
    { text: '◎', role: 'unit' },
  ];
}

// ───────────────────────── time ─────────────────────────

/**
 * `EDT`/`EST` → `ET`. The lab's tag is seasonless: a reader does not need
 * to be told which side of a daylight boundary they are on, and "ET" is
 * what they would write themselves. Anything that is not a three-letter
 * US-style tag (e.g. "GMT+2", "CET") passes through untouched.
 */
export function shortZoneTag(tag: string): string {
  const match = /^([A-Z])[DS](T)$/.exec(tag);
  return match === null ? tag : `${match[1]}${match[2]}`;
}

function zoneTagFor(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms);
  const found = parts.find((part) => part.type === 'timeZoneName');
  return found === undefined ? '' : shortZoneTag(found.value);
}

/**
 * An instant in the viewer's zone: "Aug 9, 10:00" + the tag as a unit.
 * The year is dropped while it is the current one (§4 rule 4).
 */
function instantSegments(ms: number, ctx: RowContext): Segment[] {
  const now = ctx.now ?? Date.now();
  const yearOf = (at: number): string =>
    new Intl.DateTimeFormat('en-US', { timeZone: ctx.viewerTz, year: 'numeric' }).format(at);
  const sameYear = yearOf(ms) === yearOf(now);
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: ctx.viewerTz,
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
  const zone = zoneTagFor(ms, ctx.viewerTz);
  const segments: Segment[] = [{ text, role: 'value' }];
  if (zone.length > 0) segments.push({ text: zone, role: 'unit' });
  return segments;
}

/** The viewer zone's offset from UTC, in minutes, at a given instant. */
function tzOffsetMinutes(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function modulo(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Bit 0 = Monday. Contiguous runs compress to "Mon–Fri" (an en dash). */
function daysMaskText(mask: number): string {
  const set: number[] = [];
  for (let bit = 0; bit < 7; bit += 1) if ((mask & (1 << bit)) !== 0) set.push(bit);
  if (set.length === 0) return '';
  if (set.length === 7) return 'Every day';
  if (set.length === 1) return DAY_NAMES[set[0]];
  const contiguous = set.every((bit, index) => index === 0 || bit === set[index - 1] + 1);
  if (contiguous) return `${DAY_NAMES[set[0]]}–${DAY_NAMES[set[set.length - 1]]}`;
  return set.map((bit) => DAY_NAMES[bit]).join(', ');
}

/** `570 → "9:30"`. Unpadded hour — the lab's schedule reads "9:30–17:00". */
function minuteOfDayText(minute: number): string {
  const normalized = modulo(minute, 1440);
  return `${Math.floor(normalized / 60)}:${String(normalized % 60).padStart(2, '0')}`;
}

// ───────────────────────── scope ─────────────────────────

/** §4 rule 8 — a wallet is always 4…4, and never breaks across a line. */
export function shortAddress(address: string): string {
  return address.length <= 9 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function scopePlateFor(input: LeafInput, ctx: RowContext): ScopePlate | undefined {
  const scope = input.scope;
  if (scope === undefined) return undefined;
  switch (scope.kind) {
    case 'pattern':
      return { variant: 'any_token', label: 'any token' };
    case 'bound':
      return { variant: 'leg', label: `Leg ${ctx.positionBindingLeg ?? 1}` };
    case 'mint': {
      if (ctx.cardMint !== undefined && scope.mint === ctx.cardMint) return undefined;
      return { variant: 'token', label: ctx.symbolOf?.(scope.mint) ?? shortAddress(scope.mint), mint: scope.mint };
    }
    default:
      // A scope kind this build has never heard of says nothing rather
      // than something wrong.
      return undefined;
  }
}

/** Entry-relative checks always name the leg they measure against. */
function legPlate(ctx: RowContext): ScopePlate {
  return { variant: 'leg', label: `Leg ${ctx.positionBindingLeg ?? 1}` };
}

// ───────────────────────── spec reading ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

const CMP: Readonly<Record<string, string>> = { gte: '≥', lte: '≤' };

function cmpSegment(cmp: unknown): Segment | null {
  const mark = CMP[String(cmp)];
  return mark === undefined ? null : { text: mark, role: 'operator' };
}

/**
 * The three grammar words that are NOT comparators. They are the card's
 * only connectives, and the list is closed on purpose: it is read against
 * the LEXICONS' own phrases below, never against arbitrary server text, so
 * a subject whose noun phrase happens to contain one of these words is
 * never mistaken for grammar.
 */
const CONNECTIVES: ReadonlySet<string> = new Set(['in', 'from', 'of']);

/**
 * A lexicon phrase that OPENS with a connective, split in two so the word
 * can take the grammar layer and the rest stays what it is ("from peak" →
 * `from` + `peak`). Anything else passes through as one segment.
 *
 * `rowText` joins segments with a space unless one of them is a tight
 * unit, so splitting here writes exactly the same sentence it wrote
 * before — which is what the phrasing tests hold it to.
 */
function phraseSegments(phrase: string, role: SegmentRole): Segment[] {
  const space = phrase.indexOf(' ');
  if (space === -1) return [{ text: phrase, role }];
  const head = phrase.slice(0, space);
  if (!CONNECTIVES.has(head)) return [{ text: phrase, role }];
  return [
    { text: head, role: 'connective' },
    { text: phrase.slice(space + 1), role },
  ];
}

/** "@blknoiz06 +2" — one member named, the rest counted (§4 rule 3). */
function setSegments(members: readonly string[], render: (member: string) => string): Segment[] {
  if (members.length === 0) return [];
  const out: Segment[] = [{ text: render(members[0]), role: 'ref' }];
  if (members.length > 1) out.push({ text: `+${members.length - 1}`, role: 'ref' });
  return out;
}

// ───────────────────────── per-kind builders ─────────────────────────

type Built = { segments: Segment[]; measure?: string; scopePlate?: ScopePlate } | null;

const MARKET_METRIC: Readonly<Record<string, string>> = {
  mcap_micro: 'Market cap',
  price_pusd: 'Price',
  liquidity_lamports: 'Liquidity', // the SOL mark already says which pool
};

function marketValueSegments(metric: string, value: number): Segment[] {
  if (metric === 'mcap_micro') return microUsdSegments(value);
  if (metric === 'price_pusd') return picoUsdSegments(value);
  return lamportSegments(value);
}

function buildMarket(spec: Record<string, unknown>, ctx: RowContext): Built {
  switch (spec['check']) {
    case 'threshold': {
      const metric = str(spec['metric']);
      const value = num(spec['value']);
      const cmp = cmpSegment(spec['cmp']);
      if (metric === null || value === null || cmp === null) return null;
      const window = str(spec['window']);
      const subject: Segment[] =
        metric === 'vol_lamports'
          ? window === null
            ? [{ text: 'Volume', role: 'subject' }]
            : [
                { text: window, role: 'value' },
                { text: 'volume', role: 'subject' },
              ]
          : [{ text: MARKET_METRIC[metric] ?? metric, role: 'subject' }];
      return { segments: [...subject, cmp, ...marketValueSegments(metric, value)] };
    }
    case 'pct_move': {
      const pct = num(spec['pct_bps']);
      const windowMs = num(spec['window_ms']);
      if (pct === null || windowMs === null) return null;
      const verb = spec['direction'] === 'down' ? 'falls' : 'rises';
      return {
        segments: [
          { text: 'Price', role: 'subject' },
          { text: verb, role: 'text' },
          { text: fmtBpsPct(pct), role: 'value' },
          { text: '%', role: 'unit' },
        ],
        measure: `within ${fmtDurationMs(windowMs)}`,
      };
    }
    case 'entry_multiple': {
      const multiple = num(spec['multiple_bps']);
      if (multiple === null) return null;
      return {
        scopePlate: legPlate(ctx),
        segments: [
          { text: 'Price', role: 'subject' },
          { text: '≥', role: 'operator' },
          { text: fmtBpsMultiple(multiple), role: 'value' },
          { text: 'x', role: 'unit' },
          { text: 'entry', role: 'ref' },
        ],
      };
    }
    case 'entry_drawdown':
    case 'trailing_stop': {
      const drop = num(spec['drop_bps']);
      if (drop === null) return null;
      return {
        scopePlate: legPlate(ctx),
        segments: [
          { text: 'Price', role: 'subject' },
          { text: 'falls', role: 'text' },
          { text: fmtBpsPct(drop), role: 'value' },
          { text: '%', role: 'unit' },
          ...phraseSegments(spec['check'] === 'trailing_stop' ? 'from peak' : 'below entry', 'ref'),
        ],
      };
    }
    default:
      return null;
  }
}

const TWEET_KIND: Readonly<Record<string, string>> = {
  original: 'Original post',
  reply: 'Reply',
  quote: 'Quote',
  retweet: 'Repost',
};

const TWEET_MEDIA: Readonly<Record<string, string>> = {
  image: 'has an image',
  video: 'has video',
  any: 'has media',
};

/** A flag's words: the `subject` segment, and what follows it when the
 *  subject is not already the whole sentence. */
interface FlagWords {
  readonly subject: string;
  readonly rest?: string;
}

/**
 * Token flags read as plain predicates, and a `false` flag negates in
 * words ("Creator not reassigned") rather than in chrome — negation gets
 * no special treatment anywhere in this system.
 *
 * Most flags share one subject and differ only by the trailing word, so
 * they are written that way. `graduated` cannot be: graduation names no
 * venue any more, which leaves the positive a bare verb ("Graduates") and
 * the negative a sentence of its own ("Has not graduated") — so that one
 * entry spells both sides out.
 */
type FlagPhrasing = { readonly subject: string; readonly yes: string; readonly no: string } | { readonly yes: FlagWords; readonly no: FlagWords };

const TOKEN_FLAG: Readonly<Record<string, FlagPhrasing>> = {
  graduated: { yes: { subject: 'Graduates' }, no: { subject: 'Has', rest: 'not graduated' } },
  fee_share_locked: { subject: 'Fee share', yes: 'locked', no: 'not locked' },
  creator_reassigned: { subject: 'Creator', yes: 'reassigned', no: 'not reassigned' },
  is_cashback: { subject: 'Cashback', yes: 'enabled', no: 'not enabled' },
  is_mayhem: { subject: 'Mayhem mode', yes: 'on', no: 'not on' },
};

function buildStructural(spec: Record<string, unknown>, ctx: RowContext): Built {
  switch (spec['check']) {
    case 'tweet_author_in': {
      const accounts = strList(spec['accounts']);
      if (accounts.length === 0) return null;
      return {
        segments: [
          { text: 'Author', role: 'subject' },
          { text: 'is', role: 'text' },
          ...setSegments(accounts, (handle) => (handle.startsWith('@') ? handle : `@${handle}`)),
        ],
      };
    }
    case 'tweet_kind_in': {
      const kinds = strList(spec['kinds']);
      if (kinds.length === 0) return null;
      const head = TWEET_KIND[kinds[0]] ?? kinds[0];
      const rest = kinds.slice(1).map((kind) => (TWEET_KIND[kind] ?? kind).toLowerCase());
      const segments: Segment[] = [{ text: head, role: 'subject' }];
      if (rest.length > 0) segments.push({ text: `or ${rest.join(' or ')}`, role: 'text' });
      return { segments };
    }
    case 'tweet_media_present': {
      const media = str(spec['media']);
      if (media === null) return null;
      return {
        segments: [
          { text: 'Tweet', role: 'subject' },
          { text: TWEET_MEDIA[media] ?? `has ${media}`, role: 'text' },
        ],
      };
    }
    case 'token_flag': {
      const flag = str(spec['flag']);
      if (flag === null) return null;
      const entry = TOKEN_FLAG[flag];
      if (entry === undefined) return null;
      const negative = spec['value'] === false;
      const words: FlagWords = 'subject' in entry ? { subject: entry.subject, rest: negative ? entry.no : entry.yes } : negative ? entry.no : entry.yes;
      return {
        segments: [
          { text: words.subject, role: 'subject' },
          // A subject that is the whole sentence takes no trailing
          // segment — an empty one would render a dangling space.
          ...(words.rest === undefined || words.rest === '' ? [] : [{ text: words.rest, role: 'text' as const }]),
        ],
      };
    }
    case 'token_creator_in': {
      const creators = strList(spec['creators']);
      if (creators.length === 0) return null;
      return {
        segments: [{ text: 'Creator', role: 'subject' }, { text: 'is', role: 'text' }, ...setSegments(creators, shortAddress)],
      };
    }
    case 'token_created_after': {
      const at = num(spec['at_ms']);
      if (at === null) return null;
      return {
        segments: [
          { text: 'Created', role: 'subject' },
          { text: 'after', role: 'text' },
          ...instantSegments(at, ctx),
        ],
      };
    }
    default:
      return null;
  }
}

const ENGAGEMENT_METRIC: Readonly<Record<string, string>> = {
  views: 'Tweet views',
  likes: 'Tweet likes',
  retweets: 'Tweet reposts',
  replies: 'Tweet replies',
  bookmarks: 'Tweet bookmarks',
};

function buildEngagement(spec: Record<string, unknown>): Built {
  const metric = str(spec['metric']);
  const value = num(spec['value']);
  const cmp = cmpSegment(spec['cmp']);
  if (metric === null || value === null || cmp === null) return null;
  const staleness = num(spec['staleness_ms']);
  return {
    segments: [
      { text: ENGAGEMENT_METRIC[metric] ?? metric, role: 'subject' },
      cmp,
      { text: fmtCount(value), role: 'value' },
    ],
    ...(staleness === null ? {} : { measure: `${fmtDurationMs(staleness)} fresh` }),
  };
}

function buildHolder(spec: Record<string, unknown>): Built {
  switch (spec['check']) {
    case 'holder_count_delta': {
      const delta = num(spec['delta']);
      const windowMs = num(spec['window_ms']);
      if (delta === null || windowMs === null) return null;
      return {
        segments: [
          { text: 'Holders', role: 'subject' },
          { text: spec['direction'] === 'decrease' ? 'fall by' : 'grow by', role: 'text' },
          { text: fmtCount(delta), role: 'value' },
        ],
        measure: `within ${fmtDurationMs(windowMs)}`,
      };
    }
    case 'top_holder_concentration': {
      const topN = num(spec['top_n']);
      const value = num(spec['value_bps']);
      const cmp = cmpSegment(spec['cmp']);
      if (topN === null || value === null || cmp === null) return null;
      return {
        segments: [
          { text: 'Top', role: 'subject' },
          { text: fmtCount(topN), role: 'value' },
          { text: 'hold', role: 'text' },
          cmp,
          { text: fmtBpsPct(value), role: 'value' },
          { text: '%', role: 'unit' },
        ],
      };
    }
    case 'dev_sold': {
      const sold = num(spec['min_sold_bps']);
      if (sold === null) return null;
      return {
        segments: [
          { text: 'Dev sold', role: 'subject' },
          { text: '≥', role: 'operator' },
          { text: fmtBpsPct(sold), role: 'value' },
          { text: '%', role: 'unit' },
        ],
      };
    }
    case 'sniper_share': {
      const value = num(spec['value_bps']);
      const cmp = cmpSegment(spec['cmp']);
      if (value === null || cmp === null) return null;
      return {
        segments: [
          { text: 'Snipers', role: 'subject' },
          { text: 'hold', role: 'text' },
          cmp,
          { text: fmtBpsPct(value), role: 'value' },
          { text: '%', role: 'unit' },
        ],
      };
    }
    default:
      return null;
  }
}

function buildPortfolio(spec: Record<string, unknown>, ctx: RowContext): Built {
  switch (spec['check']) {
    case 'max_total_exposure': {
      const value = num(spec['value_lamports']);
      if (value === null) return null;
      return {
        segments: [
          { text: 'Exposure', role: 'subject' },
          { text: 'stays', role: 'text' },
          { text: '≤', role: 'operator' },
          ...lamportSegments(value),
        ],
      };
    }
    case 'position_pnl': {
      const value = num(spec['value_bps']);
      const cmp = cmpSegment(spec['cmp']);
      if (value === null || cmp === null) return null;
      const leg = ctx.positionBindingLeg;
      const subject: Segment[] =
        leg === undefined
          ? [{ text: 'Position', role: 'subject' }]
          : [
              { text: 'Leg', role: 'subject' },
              { text: String(leg), role: 'value' },
              { text: 'position', role: 'subject' },
            ];
      return {
        segments: [
          ...subject,
          { text: value < 0 ? 'down' : 'up', role: 'text' },
          cmp,
          { text: fmtBpsPct(Math.abs(value)), role: 'value' },
          { text: '%', role: 'unit' },
        ],
      };
    }
    case 'min_available_balance': {
      const value = num(spec['value_lamports']);
      if (value === null) return null;
      return {
        segments: [
          { text: 'Wallet', role: 'subject' },
          { text: 'keeps', role: 'text' },
          { text: '≥', role: 'operator' },
          ...lamportSegments(value),
          { text: 'free', role: 'ref' },
        ],
      };
    }
    default:
      return null;
  }
}

function buildTemporal(spec: Record<string, unknown>, ctx: RowContext): Built {
  switch (spec['check']) {
    case 'schedule_window': {
      const start = num(spec['start_minute_utc']);
      const end = num(spec['end_minute_utc']);
      const mask = num(spec['days_mask']);
      if (start === null || end === null || mask === null) return null;
      const now = ctx.now ?? Date.now();
      const offset = tzOffsetMinutes(ctx.viewerTz, now);
      const localStart = start + offset;
      const shift = Math.floor(localStart / 1440);
      let shifted = 0;
      for (let bit = 0; bit < 7; bit += 1) {
        if ((mask & (1 << bit)) !== 0) shifted |= 1 << modulo(bit + shift, 7);
      }
      const zone = zoneTagFor(now, ctx.viewerTz);
      const segments: Segment[] = [
        { text: `${minuteOfDayText(localStart)}–${minuteOfDayText(end + offset)}`, role: 'value' },
      ];
      if (zone.length > 0) segments.push({ text: zone, role: 'unit' });
      const days = daysMaskText(shifted);
      if (days.length > 0) {
        segments.push({ text: '·', role: 'unit' });
        segments.push({ text: days, role: 'value' });
      }
      return { segments };
    }
    case 'after':
    case 'before': {
      const at = num(spec['at_ms']);
      if (at === null) return null;
      return {
        segments: [
          { text: spec['check'] === 'after' ? 'After' : 'Before', role: 'subject' },
          ...instantSegments(at, ctx),
        ],
      };
    }
    case 'after_arm': {
      const offset = num(spec['offset_ms']);
      if (offset === null) return null;
      return {
        segments: [
          { text: 'After', role: 'subject' },
          { text: fmtDurationMs(offset), role: 'value' },
          ...phraseSegments('from arming', 'text'),
        ],
      };
    }
    default:
      return null;
  }
}

/** §8.11's fire-phase guardrail, which the THEN tile shows, not the WHEN box. */
function buildMinLiquidity(spec: Record<string, unknown>): Built {
  const value = num(spec['min_real_sol_lamports']);
  if (value === null) return null;
  return {
    segments: [
      { text: 'Pool', role: 'subject' },
      { text: '≥', role: 'operator' },
      ...lamportSegments(value),
      { text: 'when it fires', role: 'ref' },
    ],
  };
}

// ───────────────────────── the door ─────────────────────────

/**
 * One leaf → one row. Total: a kind, check or spec shape this build cannot
 * phrase comes back as the unknown group carrying the server's own
 * sentence, which is the only string on the card the platform does not
 * control (§4 rule 9 — it clamps to one line, the whole of it in Details).
 */
export function buildRow(input: LeafInput, ctx: RowContext): RowModel {
  const spec = isRecord(input.spec) ? input.spec : null;
  const built =
    spec === null
      ? null
      : input.kind === 'market'
        ? buildMarket(spec, ctx)
        : input.kind === 'structural'
          ? buildStructural(spec, ctx)
          : input.kind === 'engagement'
            ? buildEngagement(spec)
            : input.kind === 'holder'
              ? buildHolder(spec)
              : input.kind === 'portfolio_arm'
                ? buildPortfolio(spec, ctx)
                : input.kind === 'temporal'
                  ? buildTemporal(spec, ctx)
                  : input.kind === 'guardrail_min_liquidity'
                    ? buildMinLiquidity(spec)
                    : null;

  if (built === null) {
    return {
      group: 'unknown',
      segments: [],
      ...(input.text === undefined ? {} : { raw: input.text }),
    };
  }

  const plate = built.scopePlate ?? scopePlateFor(input, ctx);
  return {
    group: glyphGroupFor(input.kind, input.spec),
    segments: built.segments,
    ...(plate === undefined ? {} : { scopePlate: plate }),
    ...(built.measure === undefined ? {} : { measure: built.measure }),
  };
}

/**
 * "No dev-wallet sell" — negation is carried by words, never by chrome
 * (design-28 §3). The subject decapitalises because it is no longer the
 * first thing said.
 */
export function negateRow(row: RowModel, measure?: string): RowModel {
  const [first, ...rest] = row.segments;
  const decapitalised: Segment[] =
    first === undefined ? [] : [{ text: `${first.text.charAt(0).toLowerCase()}${first.text.slice(1)}`, role: first.role }, ...rest];
  return {
    ...row,
    segments: [{ text: 'No', role: 'text' }, ...decapitalised],
    ...(measure === undefined ? {} : { measure }),
  };
}

/** Attach or replace a row's right-anchored measure. */
export function withMeasure(row: RowModel, measure: string): RowModel {
  return { ...row, measure };
}

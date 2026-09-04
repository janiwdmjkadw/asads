import type { AlphaCoin } from '@/components/discover/mockCoins';
import { compactAge, compactUsd } from '@/lib/format';

// Slice "Call This Coin": pure (React-free) helpers shared by the api client,
// the trade-page call dialog and the Discover alpha lane. Kept side-effect
// free so `bun test` covers them directly.

export const MAX_THESIS_LENGTH = 280;

/** Base58 Solana mint pubkey (mirrors the api's MINT_REGEX). */
export const MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type ThesisCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'empty' | 'too_long' | 'links' };

/** Scheme-ful URLs inside a thesis (validation: each must be x.com). */
const THESIS_URL_REGEX = /https?:\/\/[^\s]+/gi;
/** Trailing sentence punctuation is not part of a pasted URL. */
const TRAILING_PUNCT_REGEX = /[.,;:!?)\]]+$/;

/**
 * The ONLY link host a thesis may carry — mirrors the api's
 * isAllowedThesisLink (both sides MUST stay in sync). Tweets embed as
 * TWEET chips; any other URL is rejected so a call can never smuggle an
 * arbitrary clickable link to followers.
 */
export function isAllowedThesisLink(raw: string): boolean {
  const cleaned = raw.replace(TRAILING_PUNCT_REGEX, '');
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return /^(?:www\.)?x\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Client-side pre-flight for the thesis input. Mirrors the server contract
 * (trim, 1..280, x.com-only links) so the dialog can disable submit instead
 * of round-tripping a rejection. Control-char rejection stays server-side —
 * a keyboard can't produce them, and the server is the authority anyway.
 */
export function checkThesis(raw: string): ThesisCheck {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) return { ok: false, reason: 'empty' };
  if (normalized.length > MAX_THESIS_LENGTH) return { ok: false, reason: 'too_long' };
  for (const match of normalized.match(THESIS_URL_REGEX) ?? []) {
    if (!isAllowedThesisLink(match)) return { ok: false, reason: 'links' };
  }
  return { ok: true, normalized };
}

// ───────── tweet-link embeds ─────────

export type ThesisSegment =
  | { kind: 'text'; value: string }
  | { kind: 'tweet'; value: string; href: string };

/* Embed matcher is more lenient than validation: people paste tweet links
   with or without the scheme, so a bare "x.com/…" also embeds. The token
   must start the string or follow whitespace/'(' — "max.com/x" is text. */
const TWEET_EMBED_REGEX = /(?:https?:\/\/)?(?:www\.)?x\.com\/[^\s]+/gi;

/**
 * Split a thesis into text + tweet-link segments, IN PLACE — the renderer
 * swaps each tweet segment for a clickable TWEET chip exactly where the
 * link sat in the sentence. Trailing punctuation stays with the text.
 */
export function splitThesisTweetLinks(thesis: string): ThesisSegment[] {
  const segments: ThesisSegment[] = [];
  let cursor = 0;
  TWEET_EMBED_REGEX.lastIndex = 0;
  for (let match = TWEET_EMBED_REGEX.exec(thesis); match !== null; match = TWEET_EMBED_REGEX.exec(thesis)) {
    const start = match.index;
    const before = thesis[start - 1];
    // Mid-word hit ("max.com/…") — not a link token.
    if (start > 0 && before !== undefined && !/[\s(]/.test(before)) continue;
    const trailing = TRAILING_PUNCT_REGEX.exec(match[0])?.[0] ?? '';
    const raw = trailing ? match[0].slice(0, -trailing.length) : match[0];
    if (raw.length === 0) continue;
    if (start > cursor) segments.push({ kind: 'text', value: thesis.slice(cursor, start) });
    segments.push({
      kind: 'tweet',
      value: raw,
      href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
    });
    cursor = start + raw.length;
  }
  if (cursor < thesis.length) segments.push({ kind: 'text', value: thesis.slice(cursor) });
  return segments.length > 0 ? segments : [{ kind: 'text', value: thesis }];
}

/** Wire shape of one GET /api/v1/alpha/feed call (already snake→camel parsed). */
export interface AlphaCall {
  id: string;
  mint: string;
  thesis: string;
  callerLabel: string;
  createdAt: string;
  /** Set when the caller rewrote their thesis — the "edited" marker. */
  editedAt: string | null;
  /** True when the VIEWER is the caller (feed only; SSE frames omit it). */
  isMine: boolean;
  token: {
    ticker: string | null;
    name: string | null;
    imageUrl: string | null;
    marketCap: string | null;
    /** Numeric USD MC at call time — the "since call" %-perf baseline. */
    marketCapUsd: number | null;
    volume: string | null;
    price: string | null;
    score: number | null;
    txns: number | null;
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse one wire item defensively; null when required fields are missing. */
export function parseAlphaCall(raw: unknown): AlphaCall | null {
  if (!isObject(raw)) return null;
  const id = strOrNull(raw.id);
  const mint = strOrNull(raw.mint);
  const thesis = typeof raw.thesis === 'string' ? raw.thesis : null;
  const callerLabel = strOrNull(raw.caller_label);
  const createdAt = strOrNull(raw.created_at);
  if (!id || !mint || thesis === null || !callerLabel || !createdAt) return null;
  const token = isObject(raw.token) ? raw.token : {};
  return {
    id,
    mint,
    thesis,
    callerLabel,
    createdAt,
    editedAt: strOrNull(raw.edited_at),
    isMine: raw.is_mine === true,
    token: {
      ticker: strOrNull(token['ticker']),
      name: strOrNull(token['name']),
      imageUrl: strOrNull(token['image_url']),
      marketCap: strOrNull(token['market_cap']),
      marketCapUsd: numOrNull(token['market_cap_usd']),
      volume: strOrNull(token['volume']),
      price: strOrNull(token['price']),
      score: numOrNull(token['score']),
      txns: numOrNull(token['txns']),
    },
  };
}

/**
 * Inverse of `compactUsd` for the "since call" baseline of calls stored
 * BEFORE the numeric `market_cap_usd` field existed: "$2.39K" → 2390.
 * Compact display carries only 3 significant digits, so the parsed
 * baseline is approximate (≤ ~0.5% off) — good enough for a % readout,
 * and new calls carry the exact numeric anyway. Null on anything that
 * isn't a plain compact-USD string.
 */
export function parseCompactUsd(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /^\$(\d+(?:\.\d+)?)([KMB])?$/.exec(raw.trim());
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const multiplier =
    match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return base * multiplier;
}

/**
 * '<1m' / '42m' / '3h' / '2d' — single-unit age. ≥1 minute delegates to the
 * shared compactAge() ladder (the same formatter snapshot-derived cards use)
 * so adjacent alpha cards can never disagree on unit rules; sub-minute is
 * flattened to '<1m' because second-precision churn is noise on a call card.
 */
export function ageLabelFrom(createdAtIso: string, nowMs: number): string {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return '—';
  const ageMs = Math.max(nowMs - created, 0);
  if (ageMs < 60_000) return '<1m';
  return compactAge(ageMs);
}

/** AlphaCoin extended with the identity the lane needs for live calls. */
export type LiveAlphaCoin = AlphaCoin & { id: string };

/**
 * Map a feed call onto the AlphaCard's coin shape. `id` (the mint) turns on
 * mint-keyed card identity + the pump.fun glyph; snapshot gaps degrade to
 * em-dashes rather than fabricated numbers.
 */
export function callToAlphaCoin(call: AlphaCall, nowMs: number): LiveAlphaCoin {
  return {
    id: call.mint,
    ticker: call.token.ticker ?? `${call.mint.slice(0, 4)}…`,
    name: call.token.name ?? '',
    handle: `@${call.callerLabel}`,
    imageUrl: call.token.imageUrl ?? '',
    ageLabel: ageLabelFrom(call.createdAt, nowMs),
    marketCap: call.token.marketCap ?? '—',
    volume: call.token.volume ?? '—',
    holders: '—',
    description: call.thesis,
    score: call.token.score ?? 0,
    followers: '—',
    txns: call.token.txns ?? 0,
    // "Since call" baseline: exact numeric when the call carried it; old
    // rows degrade to parsing the compact display string (≤ ~0.5% off).
    callMarketCapUsd: call.token.marketCapUsd ?? parseCompactUsd(call.token.marketCap),
    // Edit affordance: the pencil edits THIS call (the one whose thesis /
    // age / baseline the card displays).
    callId: call.id,
    isMine: call.isMine,
    edited: call.editedAt != null,
  };
}

/** Feed cache size bound — mirrors the GET /api/v1/alpha/feed limit. */
export const MAX_FEED_CALLS = 30;

/**
 * Merge one pushed call into the cached feed: newest-first, idempotent per
 * call id (SSE reconnect catch-up + refetch can both deliver the same call),
 * bounded to MAX_FEED_CALLS. Pure — this is the reducer between the push
 * channel and the react-query cache. An unchanged duplicate returns the
 * INPUT array unchanged so the cache updater can short-circuit on reference
 * equality; an EDIT frame (same id, new thesis/edited_at) replaces the call
 * IN PLACE — position, created_at and the MC baseline never move.
 */
export function applyCallToFeed(
  calls: AlphaCall[],
  incoming: AlphaCall,
  max: number = MAX_FEED_CALLS,
): AlphaCall[] {
  const index = calls.findIndex((c) => c.id === incoming.id);
  if (index >= 0) {
    const existing = calls[index]!;
    if (
      existing.thesis === incoming.thesis &&
      existing.editedAt === incoming.editedAt &&
      existing.callerLabel === incoming.callerLabel
    ) {
      return calls;
    }
    const next = calls.slice();
    // Pushed frames are recipient-scoped and never the viewer's own call,
    // so `is_mine` is absent (false) on them — keep the cached truth.
    next[index] = { ...incoming, isMine: existing.isMine || incoming.isMine };
    return next;
  }
  return [incoming, ...calls].slice(0, max);
}

/**
 * Compose the alpha lane from live calls only, ONE card PER CALL. Every
 * call — including a later call of an already-called mint — renders as
 * its own card anchored to ITS OWN thesis, caller, "called at" age and
 * since-call % baseline. Cards after the first call of a mint carry
 * `callSequence` (> 1) plus the FIRST call's context so their marker's
 * hover can attribute who called it first. Edits never mint a card:
 * `applyCallToFeed` replaces the call in place, so its card updates
 * where it stands. Token identity gaps (a call posted before metadata
 * landed) fill from any sibling call of the mint that knew the field.
 * Lane order is the newest-first feed order. No calls → an honest
 * empty lane.
 */
export function mergeAlphaLane(calls: readonly AlphaCall[], nowMs: number): LiveAlphaCoin[] {
  // Per-mint context: true first call (wall-clock, not array position —
  // pushed frames and refetches interleave), identity fill, caller roster,
  // and each call's 1-based sequence.
  const groups = new Map<string, AlphaCall[]>();
  for (const call of calls) {
    const group = groups.get(call.mint);
    if (group) group.push(call);
    else groups.set(call.mint, [call]);
  }
  interface MintContext {
    earliest: AlphaCall;
    ticker: string | undefined;
    name: string | undefined;
    imageUrl: string | undefined;
    callers: string[];
    sequenceByCallId: Map<string, number>;
  }
  const contexts = new Map<string, MintContext>();
  for (const [mint, group] of groups) {
    const ordered = [...group].sort(
      (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
    );
    const callers: string[] = [];
    const sequenceByCallId = new Map<string, number>();
    for (const [index, call] of ordered.entries()) {
      sequenceByCallId.set(call.id, index + 1);
      if (!callers.includes(call.callerLabel)) callers.push(call.callerLabel);
    }
    contexts.set(mint, {
      earliest: ordered[0]!,
      ticker: ordered.find((c) => c.token.ticker !== null)?.token.ticker ?? undefined,
      name: ordered.find((c) => c.token.name !== null)?.token.name ?? undefined,
      imageUrl: ordered.find((c) => c.token.imageUrl !== null)?.token.imageUrl ?? undefined,
      callers,
      sequenceByCallId,
    });
  }
  return calls.map((call) => {
    const context = contexts.get(call.mint)!;
    const sequence = context.sequenceByCallId.get(call.id) ?? 1;
    return {
      ...callToAlphaCoin(call, nowMs),
      ...(context.ticker ? { ticker: context.ticker } : {}),
      ...(context.name ? { name: context.name } : {}),
      ...(context.imageUrl ? { imageUrl: context.imageUrl } : {}),
      callers: context.callers,
      callSequence: sequence,
      firstCall:
        sequence > 1
          ? {
              caller: context.earliest.callerLabel,
              ageLabel: ageLabelFrom(context.earliest.createdAt, nowMs),
              marketCap: context.earliest.token.marketCap,
            }
          : null,
    };
  });
}

// ───────── live lane stats ─────────

/** Per-mint live token stats the alpha lane polls (see useAlphaLiveStats). */
export interface AlphaLiveTokenStats {
  marketCapUsd: number;
  vol5mUsd: number;
  /** Trailing-24h volume; null while the backend's 24h seed is pending. */
  vol24hUsd: number | null;
  txns: number;
  buys: number;
  graduated: boolean;
  quoteMint: string | null;
  /** Normalized socials from the token metadata — MetaRow link icons. */
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

/** [REDACTED FOR EXPORT] The real 0-9.9 score blend is proprietary. This placeholder
    returns a fixed mid-range value so every surface still renders. */
function scoreFromLiveStats(stats: AlphaLiveTokenStats): number {
  void stats;
  return 5;
}

/**
 * Overlay live token stats onto the call lane: MC / volume / txns / score
 * refresh in place as trades roll in, and `sinceCallPct` tracks market-cap
 * performance against the immutable call-time baseline. Pure and
 * identity-stable — a coin whose displayed values didn't change is returned
 * by REFERENCE, so memoized cards skip re-rendering on a no-op poll tick.
 * Coins with no stats yet keep their call-time snapshot untouched.
 */
export function applyAlphaLiveStats(
  lane: readonly LiveAlphaCoin[],
  statsByMint: ReadonlyMap<string, AlphaLiveTokenStats>,
): LiveAlphaCoin[] {
  if (statsByMint.size === 0) return [...lane];
  return lane.map((coin) => {
    const stats = statsByMint.get(coin.id);
    if (!stats) return coin;
    const marketCap = compactUsd(stats.marketCapUsd, coin.marketCap);
    // 24h volume for display, 5m fallback while the backend seed is pending.
    const volume = compactUsd(stats.vol24hUsd ?? stats.vol5mUsd, '$0');
    const score = scoreFromLiveStats(stats);
    const baseline = coin.callMarketCapUsd;
    const sinceCallPct =
      baseline != null && baseline > 0 && stats.marketCapUsd > 0
        ? ((stats.marketCapUsd - baseline) / baseline) * 100
        : null;
    // Field-wise link compare keeps the identity check meaningful — a
    // fresh `links` object every tick would defeat the reference-return.
    const linksChanged =
      (coin.links?.twitter ?? null) !== stats.twitterUrl ||
      (coin.links?.telegram ?? null) !== stats.telegramUrl ||
      (coin.links?.website ?? null) !== stats.websiteUrl;
    if (
      coin.marketCap === marketCap &&
      coin.volume === volume &&
      coin.txns === stats.txns &&
      coin.score === score &&
      coin.sinceCallPct === sinceCallPct &&
      coin.graduated === stats.graduated &&
      coin.quoteMint === stats.quoteMint &&
      !linksChanged
    ) {
      return coin;
    }
    const links = !linksChanged
      ? coin.links
      : stats.twitterUrl || stats.telegramUrl || stats.websiteUrl
        ? {
            twitter: stats.twitterUrl,
            telegram: stats.telegramUrl,
            website: stats.websiteUrl,
          }
        : undefined;
    return {
      ...coin,
      marketCap,
      volume,
      txns: stats.txns,
      score,
      sinceCallPct,
      graduated: stats.graduated,
      quoteMint: stats.quoteMint,
      links,
    };
  });
}

/**
 * "+34%" / "-8.4%" — the since-call readout. One decimal below 10% where
 * the tenths still matter; whole percents above. Callers render '—' for
 * null upstream (no baseline / no live MC yet).
 */
export function formatSinceCallPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '-';
  const abs = Math.abs(pct);
  const body = abs >= 10 ? String(Math.round(abs)) : abs.toFixed(1).replace(/\.0$/, '');
  return `${sign}${body}%`;
}

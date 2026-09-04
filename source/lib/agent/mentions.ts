/**
 * `@`/`$` mention resolution for the agent composer — pure logic, no React.
 *
 * The point of mentions is that the agent never needs the user's whole
 * tracked-wallet list in context: the composer binds the concrete id at pick
 * time and ships it alongside the message, so "whats @cupsey pnl today"
 * reaches the model already knowing cupsey = that address.
 *
 * Candidate sources, cheapest first — the popover renders local matches on
 * the first keystroke and merges remote ones in when they land:
 *   - `tracked`: the user's tracker labels (already hydrated app-wide)
 *   - `mine`:    the user's own fleet wallets (already fetched by `useMe`)
 *   - `token`:   `$` search against the ingestion `/search` endpoint
 *   - `user`:    `@` search against `/api/v1/frens/search` (privacy-filtered)
 *
 * On send, bindings are re-checked against the final text: a mention the user
 * typed and then deleted must not travel with the message.
 */

import type { ContextMention } from './contracts';

export type MentionTrigger = '@' | '$';
export type MentionSource = 'tracked' | 'mine' | 'token' | 'user';

export interface MentionCandidate {
  /** Contract kind — what the agent receives. */
  readonly kind: ContextMention['kind'];
  /** Where it came from; drives ranking ties and the popover's badge. */
  readonly source: MentionSource;
  /** Text inserted after the trigger, and the label the agent is told. */
  readonly label: string;
  /** The concrete id bound for the agent (base58 address, mint, or uuid). */
  readonly id: string;
  /** Secondary line in the popover (short address, ticker name, …). */
  readonly hint?: string;
  readonly emoji?: string;
}

export interface MentionQuery {
  readonly trigger: MentionTrigger;
  /** Text between the trigger and the caret, lowercased for matching. */
  readonly query: string;
  /** Index of the trigger character. */
  readonly start: number;
  /** Index just past the query (the caret). */
  readonly end: number;
}

/** Longest query we will keep a popover open for. */
export const MAX_MENTION_QUERY_LEN = 32;
/** Mirrors `MAX_CONTEXT_MENTIONS` in the part contract. */
export const MAX_MENTIONS_PER_MESSAGE = 8;
/** Remote sources only fire once the query is worth a round trip. */
export const MIN_REMOTE_QUERY_LEN = 2;

const TRIGGERS: ReadonlySet<string> = new Set(['@', '$']);
/** A trigger only counts at a word boundary — `foo@bar` is an email, not a mention. */
const BOUNDARY_BEFORE = /[\s([{,;:'"]/;

export function triggerForKind(kind: ContextMention['kind']): MentionTrigger {
  return kind === 'token' ? '$' : '@';
}

/**
 * Find the mention being typed at `caret`, or `null`. Scanning stops at
 * whitespace, so a query never spans words: picking a multi-word label is
 * fine (the pick inserts it whole), typing one is not.
 */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const floor = Math.max(0, caret - (MAX_MENTION_QUERY_LEN + 1));
  for (let i = caret - 1; i >= floor; i -= 1) {
    const ch = text.charAt(i);
    if (ch === '' || /\s/.test(ch)) return null;
    if (!TRIGGERS.has(ch)) continue;
    if (i > 0 && !BOUNDARY_BEFORE.test(text.charAt(i - 1))) return null;
    return {
      trigger: ch as MentionTrigger,
      query: text.slice(i + 1, caret).toLowerCase(),
      start: i,
      end: caret,
    };
  }
  return null;
}

const SOURCE_RANK: Record<MentionSource, number> = { tracked: 0, mine: 1, token: 2, user: 3 };

/** Lower is better; `null` excludes the candidate. */
function matchScore(candidate: MentionCandidate, query: string): number | null {
  if (query.length === 0) return 500;
  const label = candidate.label.toLowerCase();
  const id = candidate.id.toLowerCase();
  if (label === query) return 0;
  if (label.startsWith(query)) return 100;
  if (id.startsWith(query)) return 200;
  if (label.includes(query)) return 300;
  if (id.includes(query)) return 400;
  return null;
}

/**
 * Rank candidates for the query, dropping the ones that do not match and any
 * duplicate (kind, id). `$` offers tokens only; `@` offers everything else.
 */
export function rankMentionCandidates(
  candidates: readonly MentionCandidate[],
  q: MentionQuery,
  limit: number,
): MentionCandidate[] {
  const scored: Array<{ candidate: MentionCandidate; score: number }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const wantsToken = q.trigger === '$';
    if (wantsToken !== (candidate.kind === 'token')) continue;
    const key = `${candidate.kind}:${candidate.id}`;
    if (seen.has(key)) continue;
    const score = matchScore(candidate, q.query);
    if (score === null) continue;
    seen.add(key);
    scored.push({ candidate, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const bySource = SOURCE_RANK[a.candidate.source] - SOURCE_RANK[b.candidate.source];
    if (bySource !== 0) return bySource;
    if (a.candidate.label.length !== b.candidate.label.length) {
      return a.candidate.label.length - b.candidate.label.length;
    }
    return a.candidate.label.localeCompare(b.candidate.label);
  });
  return scored.slice(0, Math.max(0, limit)).map((s) => s.candidate);
}

/** Replace the in-progress query with the picked mention plus a trailing space. */
export function applyMentionPick(
  text: string,
  q: MentionQuery,
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const inserted = `${triggerForKind(candidate.kind)}${candidate.label} `;
  const next = `${text.slice(0, q.start)}${inserted}${text.slice(q.end)}`;
  return { text: next, caret: q.start + inserted.length };
}

/**
 * The bindings that survive to the wire: a picked mention counts only while
 * its `@label` / `$label` is still literally in the text, deduped by
 * (kind, id) and capped to the contract's ceiling.
 */
export function bindingsPresentIn(
  text: string,
  picked: readonly MentionCandidate[],
): ContextMention[] {
  const out: ContextMention[] = [];
  const seen = new Set<string>();
  for (const candidate of picked) {
    if (out.length >= MAX_MENTIONS_PER_MESSAGE) break;
    const token = `${triggerForKind(candidate.kind)}${candidate.label}`;
    if (!text.includes(token)) continue;
    const key = `${candidate.kind}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: candidate.kind, label: candidate.label, id: candidate.id });
  }
  return out;
}

/** `7xKX…gAsU` */
export function shortenId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

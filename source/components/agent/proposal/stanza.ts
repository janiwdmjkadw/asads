/**
 * The proposal card's STANZA — the display transforms that turn the
 * server's machine prose into the two lines a human reads.
 *
 * Pure and framework-free, so every rule here is testable without a
 * DOM. Nothing in this module EDITS a server fact: it only chooses a
 * display form. The original string always travels beside it (the
 * caller puts it in `title`), and the untouched `summary` sentence
 * still renders verbatim inside `details`.
 *
 * Three transforms:
 *   1. INSTANTS. The server writes `2026-08-07 08:25 UTC`. A wall-clock
 *      timestamp in a foreign timezone is not something a person can
 *      act on, so within a day it reads as a relative distance
 *      (`in 2m`) and beyond that as the VIEWER's local short form
 *      (`Aug 9, 8:25 AM`). `UTC` and ISO never reach the surface.
 *   2. LEAD-INS. The server sometimes writes its own connective
 *      (`when only after …`), which stutters under a `when` label.
 *      Only an exact leading `when ` / `when only ` is trimmed —
 *      nothing semantic.
 *   3. ADDRESSES. A 44-char mint anywhere in server text is display-
 *      truncated; the full value stays in `title`.
 */

/** ISO-ish instant: `2026-08-07 08:25 UTC`, `2026-08-07T08:25:00Z`, `…+02:00`. */
const INSTANT_SOURCE = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?(?:UTC|GMT|Z)|\s?[+-]\d{2}:?\d{2})?`;
const INSTANT = new RegExp(INSTANT_SOURCE, 'g');
const ANCHORED_INSTANT = new RegExp(`^${INSTANT_SOURCE}$`);

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Epoch ms for one of the server's timestamp spellings, or `null` when
 * it is not one. A naked `YYYY-MM-DD HH:MM` is read as UTC — that is
 * what the api writes, and guessing local would move the instant.
 */
export function parseServerInstant(raw: string): number | null {
  const trimmed = raw.trim();
  const zone = /(?:Z|UTC|GMT)$/i.exec(trimmed);
  const offset = /[+-]\d{2}:?\d{2}$/.test(trimmed);
  const body = zone === null ? trimmed : trimmed.slice(0, zone.index).trim();
  const ms = Date.parse(`${body.replace(' ', 'T')}${offset ? '' : 'Z'}`);
  return Number.isFinite(ms) ? ms : null;
}

/** `Aug 9, 8:25 AM` in the VIEWER's timezone — no zone suffix, ever. */
function localShort(atMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(atMs));
  } catch {
    // Intl unavailable (never on our targets): degrade to a bare clock
    // rather than leaking the ISO string the transform exists to hide.
    const date = new Date(atMs);
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * How a person says an instant. Inside a day it is a distance from now
 * — the only form that stays true whatever timezone the reader is in;
 * beyond that, the local short form.
 *
 * Computed at render from `nowMs`, like the countdown: no ticking, so
 * it cannot drift into a stale-weird string mid-session.
 */
export function humanizeInstant(atMs: number, nowMs: number): string {
  const diff = atMs - nowMs;
  if (Math.abs(diff) > DAY_MS) return localShort(atMs);
  if (diff <= 0) return 'now';
  if (diff < MINUTE_MS) return `in ${Math.max(1, Math.round(diff / 1_000))}s`;
  if (diff < HOUR_MS) return `in ${Math.round(diff / MINUTE_MS)}m`;
  return `in ${Math.round(diff / HOUR_MS)}h`;
}

/** Every instant inside a sentence, humanized in place. Text with none passes through. */
export function humanizeTimestamps(text: string, nowMs: number): string {
  return text.replace(INSTANT, (match) => {
    const at = parseServerInstant(match);
    return at === null ? match : humanizeInstant(at, nowMs);
  });
}

/** Trim the server's own `when` connective so the label does not stutter. */
export function stripLeadIn(text: string): string {
  return text.replace(/^when\s+only\s+/i, '').replace(/^when\s+/i, '');
}

/** A predicate that is a trigger in its own right — it gets the `when` label. */
export interface WhenLine {
  /** Display text: lead-in trimmed, instants humanized. */
  readonly text: string;
  /** The server's predicate, verbatim, for the `title`. */
  readonly title: string;
}

export interface ConditionStanza {
  readonly when: readonly WhenLine[];
  /**
   * A PURE time gate (`after <instant>`) reads as language, not as a
   * condition: `starts in 2m`, never `when in 2m`. When there are real
   * conditions too it folds onto the first of them.
   */
  readonly startText: string | null;
  readonly startTitle: string | null;
}

/** True when the whole predicate is nothing but a time gate. */
function timeGateAt(body: string): number | null {
  const gate = /^(?:only\s+)?(?:after|from|not before)\s+(.+?)\s*\.?$/i.exec(body);
  if (gate === null) return null;
  const stamp = gate[1].trim();
  return ANCHORED_INSTANT.test(stamp) ? parseServerInstant(stamp) : null;
}

/**
 * The server's predicates as the card's condition lines. The condition
 * is ALWAYS visible: every predicate lands on one line or the other,
 * and only an empty predicate list yields an empty stanza.
 */
export function conditionStanza(predicates: readonly string[], nowMs: number): ConditionStanza {
  const when: WhenLine[] = [];
  let startText: string | null = null;
  let startTitle: string | null = null;
  for (const predicate of predicates) {
    const original = predicate.trim();
    if (original === '') continue;
    const body = stripLeadIn(original);
    const at = timeGateAt(body);
    if (at !== null) {
      // First gate wins; a second one is a real condition, not a rewrite.
      if (startText === null) {
        startText = humanizeInstant(at, nowMs);
        startTitle = original;
        continue;
      }
    }
    when.push({ text: humanizeTimestamps(body, nowMs), title: original });
  }
  return { when, startText, startTitle };
}

/** A run of server text, split so addresses can be truncated for display. */
export interface TextChunk {
  readonly text: string;
  /** A base58 run long enough to be a mint or a pubkey. */
  readonly address: boolean;
}

/**
 * Split any server string on its base58 runs. The capture group makes
 * `String.split` alternate prose / address, so the chunks always
 * re-concatenate to the ORIGINAL string — this restyles, it never edits.
 */
const ADDRESS_RUN = /([1-9A-HJ-NP-Za-km-z]{30,})/g;

export function addressChunks(text: string): readonly TextChunk[] {
  return text
    .split(ADDRESS_RUN)
    .map((chunk, index) => ({ text: chunk, address: index % 2 === 1 }))
    .filter((chunk) => chunk.text !== '');
}

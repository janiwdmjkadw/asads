/**
 * The row's compressed WHEN → THEN one-liner, derived from what the LIST
 * route serves.
 *
 * THE LIST HAS NO TYPED TREE. `components/agent/proposal/v2/row-model.ts`
 * builds its rows from the IR (`kind` + `spec` per leaf), and the
 * conditionals list serves none of that — it serves the SERVER-RENDERED
 * `AuthorizationView.summary`, one string:
 *
 *   "<qualifier>; when <condition> → <action>; <lifetime>"          (1 leg)
 *   "<qualifier>; 2-leg plan — leg 1: …; leg 2: …; <lifetime>"      (n legs)
 *
 * So this module compresses a STRING where the card compresses a tree. It
 * reuses the card's `Segment` vocabulary so the ledger's sentence is
 * typeset by the same rules — numerals mono and brightest, comparators
 * and units one size-step down and one ink-step back (design-28 §4) — and
 * it applies the lexicon rules a string can honestly carry: the qualifier
 * and lifetime clauses come off (rule 1, subject not sentence), the arm
 * parenthetical comes off (rule 7, overflow demotes to Details), values
 * split from their units (rule 4).
 *
 * IT NEVER INVENTS. `summary` is OPTIONAL on the wire (open-enum posture:
 * an older api serves none, and a render can fail) — a row without one
 * falls back to its QUALIFIER, which the list does serve, rather than to
 * a guessed sentence. The scope plate (rule 6) is the SERVER's answer too:
 * `token` is the one mint the read route could prove the plan names, so
 * the plate is the catalog's ticker, or the mint at 4…4 when the catalog
 * has none. Only when there is no token does the plate fall to a universe
 * phrase the text actually contains — and to nothing at all when neither.
 */

import type { GlyphGroup } from '@/components/agent/proposal/v2/kind-glyphs';
import { shortAddress } from '@/components/agent/proposal/v2/row-model';
import type { ScopePlate, Segment } from '@/components/agent/proposal/v2/row-model';
import type { ConditionalQualifier, ConditionalSummary } from '@/lib/conditionals';

/** `rowText`'s own tight set (design-28 §4 symbols), and the reason for it. */
const TIGHT_UNITS = new Set(['%', 'x', 'K', 'M', 'B']);

export interface PlayLine {
  /** Rule 6. `null` whenever the wire gives nothing to put in a plate. */
  readonly plate: ScopePlate | null;
  /** The condition gist. `null` for a plan the summary states as legs. */
  readonly when: readonly Segment[] | null;
  /** The action. `null` when the summary carries no `→`. */
  readonly then: readonly Segment[] | null;
  /** Which duotone marker the row wears. `unknown` when nothing names it. */
  readonly group: GlyphGroup;
}

// ───────────────────────── the sentence ─────────────────────────

/** `$75K` → `$` `75` `K`; `100%` → `100` `%`; `2x` → `2` `x`. */
const FIGURE = /^(\$)?(\d[\d,]*(?:\.\d+)?)([KMB])?(%|x|×)?$/;
const COMPARATOR = /^[≥≤<>=]+$/;

/**
 * The SOL mark rides as a `unit` segment the renderer swaps for the
 * official glyph — same treatment the card gives it, one vocabulary.
 */
const SOL_WORDS = new Set(['SOL', '◎']);
/** The card's own text for it, so `rowText` and this agree character for
 *  character; the renderer swaps the glyph in for exactly this token. */
const SOL_TEXT = '◎';

function segmentsOf(text: string): readonly Segment[] {
  const out: Segment[] = [];
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (COMPARATOR.test(word)) {
      out.push({ text: word, role: 'operator' });
      continue;
    }
    if (SOL_WORDS.has(word)) {
      out.push({ text: SOL_TEXT, role: 'unit' });
      continue;
    }
    const figure = FIGURE.exec(word);
    if (figure === null) {
      out.push({ text: word, role: 'text' });
      continue;
    }
    const [, lead, value, magnitude, trail] = figure;
    if (lead !== undefined) out.push({ text: lead, role: 'unit' });
    out.push({ text: value ?? word, role: 'value' });
    if (magnitude !== undefined) out.push({ text: magnitude, role: 'unit' });
    if (trail !== undefined) out.push({ text: trail === '×' ? 'x' : trail, role: 'unit' });
  }
  return out;
}

/**
 * Does this segment tuck against the one before it, or take a space?
 *
 * The rule is `rowText`'s, because the ledger's sentence and the card's
 * are one typographic system: `%`, a multiple's `x` and a magnitude
 * suffix glue to their numeral, `$` glues to the figure it opens, and
 * everything else keeps its air. It is stated HERE rather than reached
 * for, because the DOM needs it per-element and `rowText` only returns a
 * finished string — and `play-line.test.ts` asserts the two agree on
 * every fixture, so the pair cannot drift apart silently.
 */
export function gluesToPrevious(previous: Segment | null, segment: Segment): boolean {
  if (previous === null) return true;
  if (segment.role === 'unit' && TIGHT_UNITS.has(segment.text)) return true;
  return previous.role === 'unit' && previous.text === '$';
}

/** The sentence as one string — what a screen reader hears, and what the
 *  phrasing tests assert. */
export function playLineText(segments: readonly Segment[] | null): string {
  if (segments === null || segments.length === 0) return '';
  let out = '';
  let previous: Segment | null = null;
  for (const segment of segments) {
    if (!gluesToPrevious(previous, segment)) out += ' ';
    out += segment.text;
    previous = segment;
  }
  return out;
}

// ───────────────────────── the summary ─────────────────────────

/** Rule 7: "(arms on leg-1 settlement)" is a Details matter, not a row. */
const ARM_PARENTHETICAL = /\s*\([^()]*\barms?\b[^()]*\)/gi;
/** The trailing clause the row's right edge already answers. */
const LIFETIME_CLAUSE = /^(expires\b|expiry\b|until\b|no expiry\b|runs for\b|valid\b)/i;
/** Rule 6: the one universe the rendered text names in words. */
const ANY_TOKEN = /\b(all tracked tokens|any token|every token)\b/i;

const WHEN_THEN = /^when\s+([\s\S]+?)\s*→\s*([\s\S]+)$/i;

function clausesOf(summary: string): readonly string[] {
  return summary
    .replace(ARM_PARENTHETICAL, '')
    .split(';')
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
}

/**
 * Rule 6, identity at symbol length. The served token wins: it is the one
 * mint the plan PROVABLY names, so it outranks a phrase read out of prose,
 * and it stands whether or not the row has a summary to compress. Its label
 * is the ticker when the catalog has one and the mint at 4…4 when it does
 * not — the ledger names a token, never describes it.
 */
function plateOf(row: ConditionalSummary, summary: string): ScopePlate | null {
  const token = row.token ?? null;
  if (token !== null) {
    return {
      variant: 'token',
      label: token.symbol ?? shortAddress(token.mint),
      mint: token.mint,
    };
  }
  return ANY_TOKEN.test(summary) ? { variant: 'any_token', label: 'any token' } : null;
}

/**
 * Which marker the row wears. The list serves no leaf `kind`, so this
 * reads the subject the RENDERED text names — a presentation choice (a
 * hue and a 11px drawing), never a claim about the play. Anything it
 * cannot place takes the `unknown` mark, which is the card's own answer
 * to the same question and reads as "shown exactly as the server put it".
 */
const GROUP_PHRASES: readonly (readonly [RegExp, GlyphGroup])[] = [
  [/\b(market cap|price|volume|liquidity|mcap)\b/i, 'market'],
  [/\b(holders?|dev sells?|dev sold|top holder|snipers?)\b/i, 'holder'],
  [/\b(post|posted|tweet|tweets|mention|engagement)\b/i, 'social'],
  [/\b(migrat|graduat|launch|mint authority|metadata)\w*\b/i, 'event'],
  [/\b(wallet|balance|exposure)\b/i, 'wallet'],
  [/\b(after|before|between|elapsed|within \d)\b/i, 'clock'],
];

function groupOf(summary: string): GlyphGroup {
  for (const [pattern, group] of GROUP_PHRASES) if (pattern.test(summary)) return group;
  return 'unknown';
}

// ───────────────────────── the qualifier fallback ─────────────────────────

/**
 * What the row says when there is no summary to compress. Real wire data,
 * in the page's own words — never a placeholder and never a guess.
 */
export function qualifierPhrase(qualifier: ConditionalQualifier | undefined): string {
  if (qualifier === undefined) return 'A standing play';
  if (qualifier.kind === 'once') return 'Fires once';
  if (qualifier.kind === 'every') return 'Fires on every match';
  if (qualifier.kind === 'first_n') {
    if (qualifier.n === undefined) return 'Fires on the first matches';
    return qualifier.n === 1 ? 'Fires on the first match' : `Fires on the first ${qualifier.n} matches`;
  }
  return 'A standing play';
}

/**
 * The row's line. Total: every input produces something a person can read.
 */
export function playLine(row: ConditionalSummary): PlayLine {
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  const plate = plateOf(row, summary);
  if (summary === '') {
    return {
      plate,
      when: segmentsOf(qualifierPhrase(row.qualifier)),
      then: null,
      group: 'unknown',
    };
  }

  const group = groupOf(summary);
  const clauses = clausesOf(summary);

  for (const clause of clauses) {
    const match = WHEN_THEN.exec(clause);
    if (match !== null) {
      return {
        plate,
        when: segmentsOf(match[1] ?? ''),
        then: segmentsOf(match[2] ?? ''),
        group,
      };
    }
  }

  // No `when … →` clause: an n-leg plan states itself as legs. Drop the
  // leading qualifier clause and the trailing lifetime, and let what is
  // left BE the action — there is no condition gist to separate out.
  const body = clauses
    .slice(1)
    .filter((clause) => !LIFETIME_CLAUSE.test(clause))
    .join(' · ');
  if (body !== '') return { plate, when: null, then: segmentsOf(body), group };

  // A summary this build cannot take apart still gets rendered whole
  // rather than dropped (open-enum posture, applied to prose).
  return { plate, when: segmentsOf(summary), then: null, group };
}

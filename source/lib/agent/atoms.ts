/**
 * The answer's atoms — the TEXT pass (spec/10-system.md §1.4.3).
 *
 * Soren's reply is model markdown, and the number box is the design's rule
 * that every DATA number in that prose sits in a small glass container.
 * This module is the pure half: it finds the data numbers in a text and
 * wraps each one as a markdown link with an `atom:` href, riding the same
 * seam `linkifyAgentText` already rides — the transform happens on the
 * STRING, so Streamdown's block memoization still sees a plain string, and
 * the single `a` component override renders the results.
 *
 * WHAT COUNTS AS DATA — and what stays prose. §1.4.3's rule 1 is "only
 * DATA gets a box; narrative numbers stay prose", and this pass prefers
 * UNDER-boxing to boxing narrative:
 *
 *   boxed  · currency        $318K · $1.24M · $42 · $0.000042
 *          · percents        +8.4% · -3.1% · −3.1% · 27.4%
 *          · time spans      24h · 1h · 5m · 4s · 90s · 3d   (standalone)
 *          · SOL amounts     0.25 SOL · ◎0.25 · 0.25 ◎
 *
 *   prose  · bare integers ("812", "two"), ordinals, "top-10", years
 *          · a span glued to a metric noun as its NAME — "24h volume",
 *            "5m candle" — per §4.6: a value's own naming is not a
 *            free-standing datum. The noun set is closed and PROVISIONAL
 *            (owner-tunable): see `SPAN_NOUNS`.
 *          · anything inside an existing markdown construct (a link's
 *            label or target, inline code, fenced code) — including the
 *            output of a previous run, which is what makes the pass
 *            idempotent.
 *
 * FORMATTING IS THE ATOM'S JOB (rule at §1.4.3): sub-decimal prices render
 * subscript-zero ($0.00042 → $0.0₃42), negatives take the true minus
 * U+2212 whatever the model typed, and `$` / `%` / K/M/B ride as unit
 * fragments one step back from the figure. The renderer calls
 * `formatAtom` so display truth lives here, tested, not in JSX.
 */

/**
 * The atom pseudo-href. A HASH form on purpose — the wallet sentinel's
 * own trick (`#wallet=`): Streamdown's URL policy censors unknown
 * SCHEMES (an `atom:` link renders as literal "[blocked]" before the
 * component override ever sees it), but a fragment href passes every
 * sanitizer and never navigates. Caught live, not by the SSR tests,
 * which render the override directly.
 */
export const ATOM_HREF_PREFIX = '#atom=';

export type AtomKind = 'money' | 'pct' | 'span' | 'sol';

export interface AtomInfo {
  readonly kind: AtomKind;
  /** The text exactly as the model wrote it. */
  readonly text: string;
}

/** One rendered fragment of a formatted atom. */
export interface AtomSegment {
  readonly text: string;
  /** `unit` renders at .8em, one ink back; `fig` is the figure itself. */
  readonly role: 'fig' | 'unit';
}

export interface FormattedAtom {
  readonly segments: readonly AtomSegment[];
  /** The TEXT's colour — the container is always neutral (§1.4.3). */
  readonly tone: 'green' | 'red' | 'ivory';
  /** Set for SOL amounts: the digits, with the mark drawn beside them. */
  readonly sol: boolean;
}

/**
 * Metric nouns a time-span can NAME ("24h volume") — the span is then the
 * value's own naming and stays prose. Closed on purpose; the owner tunes
 * membership here rather than the matcher guessing intent.
 */
const SPAN_NOUNS = new Set([
  'volume',
  'vol',
  'candle',
  'candles',
  'chart',
  'charts',
  'window',
  'mcap',
  'open',
  'close',
  'high',
  'low',
]);

/* ------------------------------------------------------------------ *
 * The matchers. Order is priority: SOL before money (so "0.25 ◎" is one
 * SOL atom, not a bare number), money before percent/span. Every pattern
 * anchors on word-ish boundaries so "x24h" or "$1.24Mb" never match.
 * ------------------------------------------------------------------ */

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;

const CANDIDATE = new RegExp(
  [
    // sol: ◎ before or after, or a literal SOL word after.
    String.raw`(?<sol>◎\s?${NUM}\b|\b${NUM}\s?◎|\b${NUM}\s?SOL\b)`,
    // money: $ then digits (a $TICKER starts with a letter — no overlap).
    // The K/M/B suffix must be ADJACENT: "$318 K" stays prose.
    String.raw`(?<money>\$${NUM}[KMBkmb]?\b|\$${NUM})`,
    // pct: the sign is part of the datum — but a hyphen that is really a
    // compound's ("top-10%") is not a sign. A SIGNED match may not sit
    // flush against a word; the unsigned alternative then picks up the
    // bare figure, neutral: "top-10%" boxes "10%" in ivory.
    String.raw`(?<pct>(?<![\w-])[+\-−]${NUM}%|${NUM}%)`,
    // span: digits + s/m/h/d as a whole word.
    String.raw`(?<span>\b\d+(?:\.\d+)?[smhd]\b)`,
  ].join('|'),
  'gu',
);

/** Ranges of `text` the pass must never touch. */
function maskedRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  // Fenced code blocks first (they may contain backticks and brackets).
  for (const m of text.matchAll(/```[\s\S]*?(?:```|$)/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Inline code.
  for (const m of text.matchAll(/`[^`\n]*`/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Markdown links — label AND target, which also masks our own output
  // (`[$75K](atom:…)`) and linkify's, making the pass idempotent and
  // order-independent with linkification.
  for (const m of text.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Bare URLs (a path segment like /24h must stay a path).
  for (const m of text.matchAll(/\bhttps?:\/\/\S+/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function inMask(ranges: ReadonlyArray<readonly [number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => start < b && end > a);
}

/** The word right after `index` (skipping spaces), lowercased, or null. */
function wordAfter(text: string, index: number): string | null {
  const m = /^\s+([a-z][a-z-]*)/i.exec(text.slice(index));
  return m === null ? null : m[1].toLowerCase();
}

export interface AtomizeOptions {
  /**
   * While the reply is still streaming, a match touching the very end of
   * the text may still be growing ("$1.2" → "$1.24M") — hold it this
   * render; it atomizes complete on the next.
   */
  readonly holdTail?: boolean;
}

/**
 * A LONE `~` is prose, not markup. Models write approximation tildes —
 * "each hold ~14% of supply (~99.9% combined)" — and GFM strikethrough
 * reads the PAIR as delimiters, striking everything between them (owner
 * screenshot, 2026-08-24: "what is this crossed out language"). Deliberate
 * strikethrough is `~~`; a single tilde is escaped so it renders as the
 * glyph the model typed. Not preceded by `\` (already escaped — the pass
 * stays idempotent), not beside another `~` (a real pair stays markup).
 */
const LONE_TILDE = /(?<![~\\])~(?!~)/g;

function escapeLoneTildes(text: string, holdTail: boolean): string {
  const mask = maskedRanges(text);
  let out = '';
  let cursor = 0;
  for (const m of text.matchAll(LONE_TILDE)) {
    const start = m.index;
    // A tilde inside code, a link or a URL is already literal to markdown's
    // eye — a backslash there would RENDER.
    if (inMask(mask, start, start + 1)) continue;
    // A tilde at the streaming edge may be half of a `~~` still arriving.
    if (holdTail && start + 1 === text.length) continue;
    out += `${text.slice(cursor, start)}\\~`;
    cursor = start + 1;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Wrap every data number as `[<original>](atom:num?t=<original>)`.
 * Pure, idempotent, prefix-stable under `holdTail`.
 */
export function atomizeAgentText(text: string, options: AtomizeOptions = {}): string {
  if (text.length === 0) return text;
  const holdTail = options.holdTail === true;
  const source = escapeLoneTildes(text, holdTail);
  const mask = maskedRanges(source);

  let out = '';
  let cursor = 0;
  for (const m of source.matchAll(CANDIDATE)) {
    const start = m.index;
    const matched = m[0];
    const end = start + matched.length;
    if (start < cursor) continue; // overlapped a prior (higher-priority) match
    if (inMask(mask, start, end)) continue;
    if (holdTail && end === source.length) continue;

    const groups = m.groups ?? {};
    let kind: AtomKind | null = null;
    if (groups['sol'] !== undefined) kind = 'sol';
    else if (groups['money'] !== undefined) kind = 'money';
    else if (groups['pct'] !== undefined) kind = 'pct';
    else if (groups['span'] !== undefined) kind = 'span';
    if (kind === null) continue;

    // A span that names the metric beside it stays prose (§4.6).
    if (kind === 'span') {
      const noun = wordAfter(source, end);
      if (noun !== null && SPAN_NOUNS.has(noun)) continue;
    }

    out += source.slice(cursor, start);
    out += `[${matched}](${ATOM_HREF_PREFIX}${encodeURIComponent(matched)})`;
    cursor = end;
  }
  out += source.slice(cursor);
  return out;
}

/** Decode an `atom:` href back to the matched text, or null. */
export function parseAtomHref(href: string): AtomInfo | null {
  if (!href.startsWith(ATOM_HREF_PREFIX)) return null;
  let text: string;
  try {
    text = decodeURIComponent(href.slice(ATOM_HREF_PREFIX.length));
  } catch {
    return null;
  }
  if (/◎|(?:\d\s?SOL\b)/.test(text)) return { kind: 'sol', text };
  if (text.startsWith('$')) return { kind: 'money', text };
  if (text.endsWith('%')) return { kind: 'pct', text };
  if (/^\d/.test(text)) return { kind: 'span', text };
  return null;
}

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'] as const;

/**
 * `0.000420` → `0.0₄42`-style parts. Only fires past two leading zeros —
 * `$0.05` stays literal. Trailing zeros of the remainder are dropped, the
 * remainder is capped at 3 digits (the board writes `$0.0₃42`).
 */
function subscriptZeroFigure(figure: string): string {
  const m = /^0\.(0{2,})([1-9]\d*)$/.exec(figure);
  if (m === null) return figure;
  const zeros = m[1].length;
  const rest = m[2].replace(/0+$/, '').slice(0, 3) || m[2].slice(0, 1);
  const sub =
    zeros <= 9
      ? SUBSCRIPT_DIGITS[zeros]
      : String(zeros)
          .split('')
          .map((d) => SUBSCRIPT_DIGITS[Number(d)])
          .join('');
  return `0.0${sub}${rest}`;
}

/**
 * A USD price as the board writes it — subscript-zero below a cent
 * (`$0.0₃42`), plain figures above. Shared with the hover card's big
 * price row so one formatter owns the notation.
 */
export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$—';
  if (value >= 1) {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  const fixed = value.toFixed(12).replace(/0+$/, '');
  return `$${subscriptZeroFigure(fixed)}`;
}

/**
 * Display truth for one atom (§1.4.3): unit fragments split out, subscript
 * prices, the true minus, and the colour law — green for time spans and
 * positive change, red for negative change, ivory for everything else.
 */
export function formatAtom(info: AtomInfo): FormattedAtom {
  const { kind } = info;
  const text = info.text.trim();

  if (kind === 'sol') {
    const digits = text.replace(/[◎\s]|SOL\b/g, '');
    return { segments: [{ text: digits, role: 'fig' }], tone: 'ivory', sol: true };
  }

  if (kind === 'money') {
    const m = /^\$(\d[\d,]*(?:\.\d+)?)\s?([KMBkmb]?)$/.exec(text);
    if (m === null) return { segments: [{ text, role: 'fig' }], tone: 'ivory', sol: false };
    const figure = subscriptZeroFigure(m[1].replace(/,/g, ''));
    const suffix = m[2].toUpperCase();
    const segments: AtomSegment[] = [
      { text: '$', role: 'unit' },
      { text: figure, role: 'fig' },
    ];
    if (suffix !== '') segments.push({ text: suffix, role: 'unit' });
    return { segments, tone: 'ivory', sol: false };
  }

  if (kind === 'pct') {
    const m = /^([+\-−]?)(\d[\d,]*(?:\.\d+)?)%$/.exec(text);
    if (m === null) return { segments: [{ text, role: 'fig' }], tone: 'ivory', sol: false };
    const sign = m[1] === '-' || m[1] === '−' ? '−' : m[1]; // hyphen → true minus
    const tone = sign === '−' ? 'red' : sign === '+' ? 'green' : 'ivory';
    return {
      segments: [
        { text: `${sign}${m[2]}`, role: 'fig' },
        { text: '%', role: 'unit' },
      ],
      tone,
      sol: false,
    };
  }

  // span — time is green (§1.2 rule 1).
  return { segments: [{ text, role: 'fig' }], tone: 'green', sol: false };
}

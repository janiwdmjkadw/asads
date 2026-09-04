/**
 * Geometry AND type settings for the `document` appearance of the wallet
 * export iframe (the full-screen /welcome onboarding).
 *
 * Turnkey's export page DOES honour `applySettings` — it applies our styles
 * to its `#key-div`. What it does not do is apply them partially: its
 * `validateStyles` throws on the FIRST value that fails its regex table and
 * `applySettings` then applies NOTHING and answers with an ERROR we were
 * swallowing. Two values in the old request failed it, so every style was
 * dropped and the mnemonic rendered in Turnkey's own ~17px sans inside a
 * box we had sized for 13px monospace — the words sat high in the bar:
 *
 *   color: '#16332E'   — their regex is `#[0-9a-f]{3,8}`, built with no `i`
 *                        flag, so an UPPERCASE hex digit is invalid.
 *   fontFamily: '"Geist Mono", …' — their regex is `^[^";<>]*$`, so a
 *                        double quote is invalid.
 *
 * Every value below is therefore checked against Turnkey's own regex table
 * in `documentReveal.test.ts`. That check is the point: nothing else in the
 * stack tells us the request was refused.
 */

/** Type we ask Turnkey to render the mnemonic in. */
export const REVEAL_FONT_SIZE = 13;
export const REVEAL_LINE_HEIGHT = 18;
/** Equal whitespace above and below the words, paid by our container. */
export const REVEAL_PAD_Y = 14;

/**
 * Horizontal padding bounds. The padding is not decorative here: it sets
 * the text column, and the column decides how many lines the words wrap
 * to. See `revealedPadX`.
 */
const MIN_PAD_X = 6;
const MAX_PAD_X = 18;

/**
 * Advance width of one character at `REVEAL_FONT_SIZE` in the monospace
 * face Turnkey's origin resolves. Measured in headless Chromium against
 * the live export page: 7.827px. Rounded UP, so a narrower face than the
 * one we measured can only wrap to FEWER lines than we allocate, never
 * more — the allocation is a ceiling on the render, never a clip.
 */
const MONO_CHAR_WIDTH = 7.9;

/** Longest word in the BIP-39 English list; the wrap worst case. */
const MAX_WORD_CHARS = 8;
/** Turnkey issues 12-word mnemonics here. */
const MNEMONIC_WORDS = 12;

/**
 * Lines to allocate for the mnemonic in `innerWidth` px of text column.
 *
 * This is the WORST case, computed exactly rather than estimated: with a
 * character budget of `C = floor(innerWidth / charWidth)`, `k` words of the
 * longest length occupy `k * 8 + (k - 1)` characters, so a line holds
 * `floor((C + 1) / 9)` of them. No 12-word mnemonic can wrap to more lines
 * than that, at any word lengths — so nothing can be clipped.
 */
export function revealedLineCount(innerWidth: number): number {
  if (!Number.isFinite(innerWidth) || innerWidth <= 0) return 2;
  const chars = Math.floor(innerWidth / MONO_CHAR_WIDTH);
  const wordsPerLine = Math.max(1, Math.floor((chars + 1) / (MAX_WORD_CHARS + 1)));
  return Math.ceil(MNEMONIC_WORDS / wordsPerLine);
}

/**
 * Horizontal padding for a container of `containerWidth`.
 *
 * The words are top-aligned inside Turnkey's frame and we cannot measure
 * what they actually render to, so the box is centred on a PREDICTION: a
 * render shorter than the allocation sits half a line high. Wider columns
 * make the prediction land — which is what this trades padding for. We
 * take the line count the widest column we would allow can achieve, then
 * give back as much padding as still fits that count.
 *
 * Measured against the BIP-39 English list (10^6 sampled mnemonics, one
 * uniform draw per word), how often the render matches the allocation:
 *
 *   528px container (the desktop board) -> 18px padding, 492px column,
 *     2 lines, 64px bar. 99.92% exact; 0.08% (~1 in 1,270) draw short
 *     enough for one line and sit 9px high.
 *   310px container (390px phone, measured) -> 16px, 278px, 3 lines,
 *     82px bar, ~92% exact. The same container at the full 18px is a
 *     274px column and FOUR lines — the right worst case and the wrong
 *     height ~99.9% of the time. Two pixels of padding buy that back.
 *   224px container (320px phone) -> 8px, 208px, 4 lines, ~51%. Small
 *     phones are the irreducible case: no column they can hold makes the
 *     worst case likely, and the words must still never be cut.
 */
export function revealedPadX(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return MAX_PAD_X;
  const target = revealedLineCount(containerWidth - MIN_PAD_X * 2);
  for (let pad = MAX_PAD_X; pad > MIN_PAD_X; pad -= 1) {
    if (revealedLineCount(containerWidth - pad * 2) === target) return pad;
  }
  return MIN_PAD_X;
}

/** Height of the iframe box itself — text only, no padding. */
export function revealedContentHeight(lines: number): number {
  return lines * REVEAL_LINE_HEIGHT;
}

/** Height of the surrounding bar: the text plus the equal padding. */
export function revealedBarHeight(lines: number): number {
  return revealedContentHeight(lines) + REVEAL_PAD_Y * 2;
}

/**
 * Type request for the mnemonic Turnkey renders INSIDE its own origin.
 * `Geist Mono` is unquoted deliberately (quotes are rejected) and will not
 * resolve in Turnkey's document, so the monospace fallback is what renders
 * and what `MONO_CHAR_WIDTH` measures; it costs nothing to name and is
 * honoured on any machine that has the face installed.
 */
export function documentIframeSettings(contentHeight: number): {
  readonly styles: Record<string, string>;
} {
  return {
    styles: {
      padding: '0px',
      margin: '0px',
      borderWidth: '0px',
      backgroundColor: 'transparent',
      // Lowercase hex, always: Turnkey's colour regex has no `i` flag.
      color: '#16332e',
      fontFamily: 'Geist Mono, ui-monospace, monospace',
      fontSize: `${REVEAL_FONT_SIZE}px`,
      fontWeight: '500',
      lineHeight: `${REVEAL_LINE_HEIGHT}px`,
      textAlign: 'center',
      width: '100%',
      height: `${contentHeight}px`,
      overflowWrap: 'break-word',
      resize: 'none',
    },
  };
}

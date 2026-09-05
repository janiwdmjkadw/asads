/**
 * The class strings the card's two halves BOTH draw with.
 *
 * These were declarations in a co-located `<style>` sheet until the owner's
 * Tailwind directive; everything single-use moved inline to its JSX, and
 * what the assembled card (`ProposalCardV2`) and the WHEN slot
 * (`ConditionSlot`) both need lives here so the two cannot drift.
 *
 * DESIGN VALUES ARE THE THEME'S, NOT OURS. Every colour is a reference to
 * a listen.css custom property — `var(--ink-1)`, `var(--hairline)` — for
 * the same reason the stylesheet used them: a user on a non-arctic theme
 * gets THEIR ramp. The only literals are the two box-depth greys, which
 * the design lab owns and the theme has no token for.
 *
 * THE `pcv2-*` NAMES STAY, and they are no longer styling hooks. The
 * residual sheet in `ProposalCardV2` selects on them for the rules a
 * utility cannot state (the sibling seams), and the width probe and the
 * tests address rows, tiles and units by them.
 *
 * THE CONTAINER STEPS READ MIN-WIDTH, i.e. mobile-first. The stylesheet
 * wrote two `@container (max-width: …)` blocks; `@tailwindcss/container-
 * queries` emits `min-width` only, so the base utility is now the
 * NARROWEST case and each `@[…]:` restores a wider one. The `.02px` is
 * what makes a step the exact complement of the max-width rule it
 * replaces — `≤ 344` is `not ≥ 344.02` — so no width falls between tiers.
 *
 * EVERY LENGTH IS WRITTEN IN px, never Tailwind's numeric scale. That scale
 * is `rem`, and this app's root is 14px, not 16 — so `px-5` is 17.5px here,
 * not the 20 the design says. The card is specified to the pixel against a
 * lab reference, so `px-[20px]` is the only form that means what it says.
 * Ported straight from the scale, the card came out 0.875× and 28px short.
 */

// ───────────────────────── the sentence ─────────────────────────

/** The step-back set: units and comparators FRAME the magnitude rather than
 *  being it, so they take one size-step down and one ink-step back. The
 *  tracking differs per variant, so it is never on the shared stem — two
 *  base utilities for one property have no defined order between them. */
const U = 'pcv2-u text-[.8em] font-normal text-[var(--ink-2)]';

export const UNIT = `${U} tracking-[.045em]`;
/** A leading `$`, tucked against the figure it opens. */
export const UNIT_LEAD = `${U} pcv2-u--lead tracking-normal mr-[.05em]`;
/** A trailing `%`, tucked against the figure it closes. */
export const UNIT_PCT = `${U} pcv2-u--pct tracking-normal ml-[.035em]`;
/** The `·` between clauses — the one unit that is prose, so it stays sans. */
export const UNIT_SEP = `${U} pcv2-u--sep tracking-normal mx-[.34em] font-[family-name:var(--sans)]`;

// ───────────────────────── the marks ─────────────────────────

/**
 * The lit sphere the coin art rides ON. It stays as the img's own
 * background so it shows through until the art paints — and keeps showing
 * if the art never arrives, since `onError` only fires for a request that
 * FAILS and one that merely hangs would leave a hollow ring. `#23252d` is
 * the disc's unlit side, a lab value the theme has no token for.
 *
 * `max-w-none` IS THE SQUARE. A coin is round, so its box has to be square,
 * and stating `h` and `w` in the same em is not enough to make it one:
 * Tailwind's preflight gives every `<img>` `max-width:100%`, and the disc's
 * containing block — the `.pcv2-tokref` lockup — is `flex-initial min-w-0
 * truncate`, so a long ticker in a narrow column shrinks it BELOW the
 * disc's own width. The height does not follow (it is set), and the disc
 * paints as an ellipse. Measured on the bench: a lockup squeezed to 10px
 * rendered the disc 10 × 14.17. `object-cover` on the art crops the
 * source's own aspect; only this makes the BOX square. `aspect-square`
 * rides along so the invariant survives a future variant that states one
 * axis instead of two, and the sweep asserts |w − h| ≤ .5 everywhere.
 */
const TOK_STEM =
  'pcv2-tok inline-block flex-none aspect-square max-w-none rounded-full shadow-[inset_0_0_0_1px_var(--hairline-2)] ' +
  'bg-[radial-gradient(94%_94%_at_32%_24%,color-mix(in_srgb,var(--accent-secondary)_52%,transparent)_0%,color-mix(in_srgb,var(--accent-secondary)_10%,transparent)_46%,#23252d_78%)]';

/**
 * The lockup disc — the THEN tile's, where the glyph is not riding a
 * sentence but standing in a CENTRED row beside a verb chip, a figure and
 * a ticker. So it takes the row's system: `align-middle`, the font's own
 * optical middle, rather than a hand-set drop. Measured on the bench, the
 * disc sat 0.71px above the line it shares; `middle` brings it to 0.6px
 * below, and no number in here has to be re-tuned when the type steps at
 * the 420 breakpoint.
 */
export const TOK = `${TOK_STEM} h-[1.05em] w-[1.05em] mr-[.4em] align-middle`;
/** On a scope plate the disc steps down to the plate's own 10px measure —
 *  and there it IS riding a sentence, so it keeps the baseline drop. */
export const TOK_PLATE = `${TOK_STEM} pcv2-tok--plate h-[.95em] w-[.95em] mr-[.3em] align-[-.14em]`;

/**
 * The OFFICIAL Solana glyph, SIZED BY ITS INK RATHER THAN BY ITS BOX.
 *
 * The lab's stand-in was a WIDE mark that filled its own box, so the
 * design's ".85em, matched to the numerals" meant .85em of visible INK.
 * The official glyph is drawn on a SQUARE 16-unit viewBox with generous
 * air around it, and the number was ported across unchanged — so the box
 * obeyed the spec while the ink came out a third short. At the 15px basis
 * the mark rendered 7.98px of ink beside 11.49px figures (0.69 of the
 * figure height, against the 0.85 the design asks for): the owner's "the
 * Solana icon is not the correct size", and a defect no test could see,
 * because every probe measured the BOX and the box was correct.
 *
 * THE DERIVATION — re-run it if the glyph is ever redrawn, because every
 * number below is a property of THAT artwork and none of them survive a
 * swap:
 *
 *   ink ratio    the path's own bbox, `getBBox()` on the 16-unit viewBox:
 *                y 2.990 → 13.000, so ink is 10.010/16 = .62563 of the
 *                box height (and it is vertically CENTRED — 2.99 of air
 *                above, 3.00 below, which is what lets the box grow
 *                without the mark drifting off its line).
 *   figure       Geist Mono `0`, measured with `actualBoundingBox*` at
 *                800px to dodge the quantisation small sizes suffer:
 *                .7663em.
 *   target       ink = .85 × figure = .85 × .7663 = .65136em.
 *   box          .65136 / .62563 = 1.0411em → 1.04em.
 *
 * At the 15px basis that is a 15.6px box carrying 9.76px of ink beside
 * 11.49px figures — .85 of the figure height, which is the spec. The BOX
 * lands a hair under the disc's 1.05em; that is a coincidence of this
 * glyph's air, not a relationship, and the disc is UNCHANGED.
 */
const SOL_STEM = 'pcv2-sol inline-block h-[1.04em] w-[1.04em] ml-[.32em] flex-none';

/**
 * In a SENTENCE the mark rides the numeral it belongs to, and the drop is
 * re-derived from the box above rather than kept: the ink sits 3.00/16 =
 * .1875 of the box height up from the box's bottom edge, so a taller box
 * lifts the ink unless the box is lowered by the difference. The old pair
 * (.85em box, -.055em) put the ink's bottom .10438em above the baseline;
 * holding the ink exactly there gives -(.1875 × 1.04 − .10438) = -.0906em.
 */
export const SOL = `${SOL_STEM} align-[-.0906em]`;
/**
 * In the THEN tile it stands on the row's centreline, like the disc.
 * `align-middle` pins the box's MIDPOINT, so growing the box moves
 * nothing — the centreline law (`proposal-card-sweep.mjs` defect 5, ±1px)
 * holds by construction, and the sweep asserts it at every width.
 */
export const SOL_MID = `${SOL_STEM} align-middle`;

export const CHEV =
  'pcv2-chev h-[11px] w-[11px] flex-none text-[var(--ink-2)] transition-transform duration-[.14s] ease-[var(--ease-out)] motion-reduce:transition-none';
export const ARW = 'pcv2-arw h-[11px] w-[15px] flex-none';
export const LOCK =
  'pcv2-lock h-[12px] w-[12px] flex-none fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round] [stroke-linejoin:round]';

// ───────────────────────── the row ─────────────────────────

/**
 * `relative` is load-bearing, not decoration: the seq connector in the
 * residual sheet draws as a `::before` positioned against the row.
 *
 * ONE VERTICAL SYSTEM: CENTRE. Every slot in a row — the marker chip, the
 * ordinal, the sentence, the right-hand measure — shares the row's
 * centreline, and the only vertical tuning left on the card is on INLINE
 * GLYPHS inside a sentence, which ride the type they sit in. It was
 * `items-start` plus two hand-set nudges (a 1.6px margin on the chip, a
 * 5px pad on the ordinal) against a baseline-aligned body, which is three
 * systems at once: the 11.5px measure landed 2.1px below the centre of the
 * 13.5px sentence it qualifies, and every stop had a different error.
 * `perf-harness/proposal-card-sweep.mjs` now holds every slot to ±1px.
 */
export const ROW = 'pcv2-row relative grid items-center py-[6px]';
/** 16px marker gutter · 9px · the value track. */
export const ROW_COLS = 'grid-cols-[16px_minmax(0,1fr)] gap-x-[9px]';
/** A numbered step adds the ordinal gutter ahead of the marker. */
export const ROW_COLS_SEQ = 'pcv2-row--seq grid-cols-[14px_16px_minmax(0,1fr)] gap-x-[8px]';

export const RB = 'pcv2-rb min-w-0 flex items-center gap-x-[10px]';

/**
 * One line is law at EVERY width, so the ellipsis is every sentence's.
 *
 * The dim is per ELEMENT and hangs off the leg panel's `group`: a queued
 * leg steps its CONTENT back, never its container, because nested opacity
 * multiplies and dark ink on a bright fill drops under 4.5:1 fast.
 */
export const LF =
  'pcv2-lf min-w-0 flex-initial truncate text-[13.5px] leading-[1.42] text-[var(--ink-1)] tracking-[-.002em] ' +
  'group-data-[dimmed=true]:opacity-80';

// ───────────────────────── the titled box ─────────────────────────

export const BOX = 'pcv2-box border border-[var(--hairline)]';
/** The WHEN tile itself — the slot's ground, which the IR never has to earn. */
export const BOX_ROOT = `${BOX} pcv2-box--root bg-[var(--surface-3)] rounded-[10px] overflow-hidden`;
/** A root tile's body. Inner depths tighten it; see `ConditionSlot`. */
export const BOX_B_ROOT = 'pcv2-box-b pt-[3px] px-[12px] pb-[7px]';

// ─────────────────────── the bare tile (L1 parity) ───────────────────────

/**
 * TILE PARITY (design-28 §1, L1 rule, owner amendment 2026-08-11).
 *
 * A titleless WHEN tile and the THEN tile are the SAME OBJECT: one ground,
 * one radius, one gutter, one one-line height. Untitled, the WHEN slot has
 * no header to carry its weight, and drawn on the box system's own rhythm
 * it came out lighter AND (below the 420 step) 2.9px taller than the THEN
 * tile beside it — two tiles on one leg disagreeing about what a tile is.
 *
 * The three below are what makes them agree. `BOX_ROOT` already supplies
 * the ground, the border and the 10px radius that both tiles share.
 */

/** The THEN tile's gutter, so a bare WHEN tile spends the same budget. */
export const TILE_PAD_X = 'px-[10px] @[420.02px]:px-[12px]';

/**
 * ONE LINE, ONE HEIGHT. MEASURED off the THEN tile, not derived: its
 * verb-chip row renders 41px below the 420 step and 44px above it (the
 * bench at `/dev/proposal-card`, `[data-testid="pcv2-action"]`), and the
 * chip is the tallest thing either tile can hold — so that IS the
 * standard. A condition row's line box is ~3px shorter than the chip's, so
 * the bare tile can only reach the standard by being held to it; padding
 * alone would land it wherever its own sentence happened to measure.
 * Stated on BOTH tiles so neither can drift, and asserted numerically by
 * `perf-harness/proposal-card-sweep.mjs`.
 */
export const TILE_ONE_LINE = 'min-h-[41px] @[420.02px]:min-h-[44px]';

/** A bare tile's body: the THEN tile's own vertical inset, less the 6px
 *  the row carries itself — so the two tiles inset their content equally. */
export const BOX_B_BARE = `pcv2-box-b pcv2-box-b--bare ${TILE_PAD_X} pt-[2px] pb-[3px] @[420.02px]:pt-[3px] @[420.02px]:pb-[4px]`;

/** The bare tile itself: held to the one-line standard, content centred in
 *  whatever slack that leaves. Multi-row content outgrows it and the
 *  centring becomes a no-op. */
export const BOX_ROOT_BARE = `${BOX_ROOT} pcv2-box--bare ${TILE_ONE_LINE} flex flex-col justify-center`;

// ───────────────────────── buttons ─────────────────────────

/**
 * THE BUTTONS, and they belong here for the reason the file exists: the
 * card is no longer their only site. The conditional's own page draws the
 * same three — a ghost, a quiet one and the affirmative — under its
 * controls row, and a second set of literals would be a second design.
 *
 * `transition` names its properties rather than `all` so a hover cannot
 * animate layout, and every disabled state is `enabled:`-guarded because a
 * ghost and an affirmative disagree about hover and one property cannot be
 * declared twice at the same level and still be ordered.
 */
export const BTN =
  'pcv2-btn cursor-pointer whitespace-nowrap rounded-[11px] border font-[family-name:var(--sans)] text-[13px] ' +
  'leading-[1.15] tracking-[.012em] transition-[border-color,color,filter,box-shadow] duration-[.14s] ' +
  'ease-[var(--ease-out)] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[.55]';

/** The pair COMPRESSES before it wraps, so it still fits one line at the
 *  312px floor once the countdown has moved off it. */
export const BTN_PAD = 'px-[13px] py-[9px] @[420.02px]:px-[18px] @[420.02px]:py-[10px]';

export const BTN_GHOST =
  'pcv2-btn--ghost bg-transparent font-medium border-[var(--hairline-2)] text-[var(--ink-1)] ' +
  'enabled:hover:border-[rgba(11, 14, 20, .26)] enabled:hover:text-[var(--ink-0)]';

/** The site's own accent gradient, ice → mint at 135°, with accent ink —
 *  the ONE affirmative in whatever view it appears in, which is what makes
 *  it read as the affirmative rather than as decoration. */
export const BTN_GRAD =
  'pcv2-btn--grad border-transparent font-semibold text-[var(--accent-ink)] ' +
  'bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))] ' +
  'enabled:hover:brightness-[1.06] ' +
  'enabled:hover:shadow-[0_6px_20px_color-mix(in_srgb,var(--accent-secondary)_16%,transparent)]';

/** No border, no ground — the third thing in a row of two decisions. */
export const BTN_QUIET =
  'pcv2-btn--quiet bg-transparent border-transparent font-medium text-[var(--ink-2)] ' +
  'px-[12px] py-[9px] @[420.02px]:py-[10px] enabled:hover:text-[var(--ink-0)]';

/** Drawn, stated, and refused — a control that says why it cannot run. */
export const BTN_OFF =
  'pcv2-btn--off bg-transparent border-[var(--hairline)] font-medium text-[var(--ink-2)] cursor-not-allowed';

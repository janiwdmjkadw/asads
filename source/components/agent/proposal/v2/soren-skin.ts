/**
 * THE SOREN SKIN — the card's d4 ground and its r6 depth mechanism, as one
 * override block scoped to `.pcv2--soren`.
 *
 * WHY A SHEET AND NOT CLASS STRINGS. The skin is dual: the flag is off for
 * everyone until it is on for someone, and the shipped look has to survive
 * byte for byte underneath it. Doubling every class string would double the
 * card's whole vocabulary for a difference that is almost entirely COLOUR
 * and MATERIAL — so the skin redefines custom properties and repaints the
 * `pcv2-*` hooks the card already carries, and the class strings stay
 * single-source. Structure branches in the render (the rail ramp) and
 * nothing else does.
 *
 * WHY IT LIVES BESIDE THE CARD AND NOT IN `listen.css`. `listen.css` is
 * imported once, from the trade page. The card renders in the floating
 * agent chat and on `/conditionals/:id`, neither of which loads it — every
 * `--pcv2-*` would resolve to nothing exactly where the skin is meant to
 * be seen. The card's own residual sheet ships with the card's chunk, so
 * it is the only place a card token is reliably in scope.
 *
 * SPECIFICITY IS DELIBERATE. Every rule is `.pcv2--soren <hook>` (0,2,0)
 * so it outranks the arbitrary-value utility it replaces (0,1,0) whatever
 * order the two land in — including the container-query variants on the
 * state chip, which a same-specificity rule would lose to on some builds.
 * The root block is `.pcv2.pcv2--soren` for the same reason: the card's
 * own `bg-`/`border-` utilities are single-class.
 *
 * ALPHAS ARE DECIMALS, ALWAYS. `#FFFFFF06` authored as CSS is 6/255 =
 * 2.4%, and that miswrite has already shipped the verb box a third too
 * dim once. Every white here is `rgba(255,255,255,.0xx)`.
 */

/**
 * The tokens. Four groups, and the depth ones are the ones to change if
 * the ground is ever re-picked: fills, rims, bars, and the r6 shadows.
 *
 * DEPTH IS LIGHT-NEGATIVE — every step inward is darker, and each title
 * bar is darker than the body it heads. That is correct and measured; the
 * cue that carries the boundary is the 1px cut, not the fill. Do not "fix"
 * flat nesting by lightening.
 */
const TOKENS = `
.pcv2.pcv2--soren{
  /* faces — pinned to the PHYSICAL next/font variables rather than the
     theme's aliases, which the terminal's font picker rewrites. A
     user-picked mono would reflow every number box and break the measured
     lanes, and these are measured surfaces. */
  --sans:var(--font-geist-sans,system-ui),-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --mono:var(--font-geist-mono,ui-monospace),ui-monospace,monospace;
  --display:var(--font-instrument-serif,ui-serif),ui-serif,Georgia,serif;

  /* the ground */
  --pcv2-card-fill:rgba(19,21,25,.88);
  --pcv2-card-rim:rgba(255,255,255,.043);
  --pcv2-leg-fill:rgba(255,255,255,.016);
  --pcv2-leg-rim:#14151A;
  --pcv2-l0-fill:rgba(255,255,255,.012);
  --pcv2-l0-rim:#16181D;
  --pcv2-l1-fill:rgba(255,255,255,.020);
  --pcv2-l1-rim:#181B20;
  --pcv2-l2-fill:rgba(255,255,255,.024);
  --pcv2-l2-rim:#1B1E23;
  --pcv2-bar-0:#17191E;
  --pcv2-bar-1:#191C22;
  --pcv2-bar-2:#1B1F25;

  /* r6 — the cut carries the boundary the fills are too close to carry;
     the lift sits UNDER it, which is why they are ordered this way. */
  --pcv2-cut:rgba(0,0,0,.45) 0 1px 0 inset;
  --pcv2-lift:rgba(255,255,255,.04) 0 2px 0 inset;
  --pcv2-indent:12px;

  /* glass, layer one only: light and depth, colourless. The 70° band is
     white here, not chromatic — iridescence is spent on Approve alone. */
  --pcv2-sheen:
    linear-gradient(70deg,transparent 22%,rgba(255,255,255,.015) 40%,rgba(255,255,255,.03) 52%,rgba(255,255,255,.02) 64%,transparent 80%),
    linear-gradient(180deg,rgba(255,255,255,.019),rgba(255,255,255,.004));
  --pcv2-card-sheen:
    linear-gradient(70deg,transparent 22%,rgba(255,255,255,.015) 40%,rgba(255,255,255,.03) 52%,rgba(255,255,255,.02) 64%,transparent 80%),
    linear-gradient(180deg,rgba(255,255,255,.022),rgba(255,255,255,.008));

  /* the colour budget — five meanings, and nothing else earns a hue */
  --pcv2-violet:#A78BFA;
  --pcv2-buy:#4AC99B;
  --pcv2-sell:#EA667D;
  --pcv2-approve:linear-gradient(in oklab 118deg,oklab(61.2% -0.026 -0.025),oklab(59.1% -0.048 -0.020) 48%,oklab(59.5% -0.083 -0.0006));
  --pcv2-approve-ink:#0A1113;

  /* neutral objects: the number box, the verb box and the tag are ONE
     material — meaning lives in the word inside them, never in the box. */
  --pcv2-ivory:#E8E8E2;
  --pcv2-glass-fill:rgba(255,255,255,.06);
  --pcv2-glass-rim:rgba(255,255,255,.10);
  --pcv2-tag-rim:rgba(232,232,226,.30);
  --pcv2-tag-square:rgba(255,255,255,.10);

  /* statuses: brightness alone carries the rank, plan over leg */
  --pcv2-status-leg:#8A8A85;
  --pcv2-status-plan:#C9CDD6;
}`;

/** The card, the leg pane and the three box depths — d4 plus the r6 cut. */
const GROUND = `
.pcv2.pcv2--soren{
  background-color:var(--pcv2-card-fill);
  background-image:var(--pcv2-card-sheen);
  border-color:var(--pcv2-card-rim);
}
.pcv2--soren .pcv2-panel{
  background-color:var(--pcv2-leg-fill);
  background-image:var(--pcv2-sheen);
  border-color:var(--pcv2-leg-rim);
  box-shadow:var(--pcv2-cut),var(--pcv2-lift);
}
.pcv2--soren .pcv2-box--root{
  background-color:var(--pcv2-l0-fill);
  background-image:var(--pcv2-sheen);
  border-color:var(--pcv2-l0-rim);
  box-shadow:var(--pcv2-cut),var(--pcv2-lift);
}
.pcv2--soren .pcv2-box--d1{
  background-color:var(--pcv2-l1-fill);
  background-image:var(--pcv2-sheen);
  border-color:var(--pcv2-l1-rim);
  box-shadow:var(--pcv2-cut),var(--pcv2-lift);
}
.pcv2--soren .pcv2-box--d2{
  background-color:var(--pcv2-l2-fill);
  background-image:var(--pcv2-sheen);
  border-color:var(--pcv2-l2-rim);
  box-shadow:var(--pcv2-cut),var(--pcv2-lift);
}
/* THE BAR CARRIES ITS OWN CUT. It is the box's first child and it is
   OPAQUE, so a cut drawn only on the box is covered by it and invisible.
   No lift under it: on the bar the cut is the whole of the effect. */
.pcv2--soren .pcv2-box-h{box-shadow:var(--pcv2-cut)}
.pcv2--soren .pcv2-box-h--d0{background-color:var(--pcv2-bar-0)}
.pcv2--soren .pcv2-box-h--d1{background-color:var(--pcv2-bar-1)}
.pcv2--soren .pcv2-box-h--d2{background-color:var(--pcv2-bar-2)}
/* r6's third part: one 12px indent per level, in place of the tapering
   12/11/9 ladder. The bar takes the same inset as the body it heads —
   they share a left edge at every depth, and only the bar's VERTICAL
   ladder (7/6 · 6/5 · 5/4) still tightens with depth. */
.pcv2--soren .pcv2-box-h--d0,
.pcv2--soren .pcv2-box-h--d1,
.pcv2--soren .pcv2-box-h--d2,
.pcv2--soren .pcv2-box-b--d0,
.pcv2--soren .pcv2-box-b--d1,
.pcv2--soren .pcv2-box-b--d2{
  padding-left:var(--pcv2-indent);
  padding-right:var(--pcv2-indent);
}`;

/**
 * The grammar layer — `≥` `≤` `in` `from` `of`, all of them, one violet.
 *
 * The shipped `-.134em` lift existed to stop `≥` reading as part of a BARE
 * numeral. On this skin the numeral wears a box (VALUES below), so the
 * boundary is drawn and the lift only reads as a misalignment — the owner's
 * "why is the >= not aligned" (2026-08-24). The comparator sits back on the
 * glyph's own math axis. Connectives never had the lift and still don't.
 */
const GRAMMAR = `
.pcv2--soren .pcv2-op{color:var(--pcv2-violet);top:0}
.pcv2--soren .pcv2-cx{
  font-family:var(--mono);
  font-size:.87em;
  color:var(--pcv2-violet);
}`;

/**
 * THE LITERAL WEARS THE BOX (owner, 2026-08-24: "shouldn't it be in a
 * box"). The sentence's figure — the `<b>` sentenceNodes builds, units
 * tucked inside — takes the amount box's material, so every number on the
 * card is one object: WHEN value, THEN amount, footer clock. The skin adds
 * only the CONTAINER; the type inside (`.pcv2 b`: mono, 500, .98em, units
 * stepped back on the same baseline) is the shipped literal, untouched —
 * which is why this is `inline-block` and not a flex row: flex centring
 * would break the baseline the units are tucked against.
 *
 * Direct child of the sentence only: the scope plate's "Leg 1" and the
 * chain row's bold are ordinals, not values, and stay bare.
 */
const VALUES = `
.pcv2--soren .pcv2-lf > b{
  display:inline-block;
  padding:1px 5px 2px;
  border-radius:4px;
  border:1px solid var(--pcv2-glass-rim);
  background:var(--pcv2-glass-fill);
  color:var(--pcv2-ivory);
  line-height:16px;
  margin:0 .08em;
}`;

/**
 * The THEN row: three built objects of ONE material and ONE height — verb
 * box, amount, token tag. Colour lives in the WORD, never in the box, so
 * nothing in the row competes with Approve.
 *
 * The verb is centred by construction — a flex box with a stated height
 * and a stated line-height — because the shipped chip sat 1.5px high and a
 * margin nudge would only move the error somewhere else.
 */
const THEN_ROW = `
.pcv2--soren .pcv2-verb{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:20px;
  padding:0 7px;
  border-radius:4px;
  border:1px solid var(--pcv2-glass-rim);
  background:var(--pcv2-glass-fill);
  font-family:var(--mono);
  font-size:11px;
  font-weight:500;
  line-height:14px;
  letter-spacing:.06em;
}
.pcv2--soren .pcv2-verb--buy{color:var(--pcv2-buy)}
.pcv2--soren .pcv2-verb--sell{color:var(--pcv2-sell)}
/* The amount is the row's third object and it is the SAME material as the
   other two — the number box, at the row's height. The face, the tabular
   figures and the tracking are already on the element; what the skin adds
   is the container. */
.pcv2--soren .pcv2-amt{
  display:inline-flex;
  align-items:center;
  height:20px;
  padding:0 5px;
  border-radius:3px;
  border:1px solid var(--pcv2-glass-rim);
  background:var(--pcv2-glass-fill);
  font-size:13px;
  line-height:18px;
  color:var(--pcv2-ivory);
}
/* The mark is the unit, so it rides INSIDE the box. Centred by the flex
   line rather than by a hand-set drop — the shipped card carried it 2px
   off the digits' centre, and a baseline nudge only moves that error. */
.pcv2--soren .pcv2-amt .pcv2-sol{
  height:14px;
  width:14px;
  margin-left:5px;
}
/* The locked token tag at ROW size — a second size of one tag, not a
   second tag. The prose size is untouched; it exists because the tag at
   prose size was the loudest thing in a row of 11–13px mono. */
.pcv2--soren .pcv2-tokref{
  display:inline-flex;
  align-items:center;
  gap:6px;
  height:20px;
  padding:0 8px 0 4px;
  border:1.5px solid var(--pcv2-tag-rim);
  border-radius:3px;
  font-family:var(--mono);
  font-size:13px;
  font-weight:400;
  line-height:18px;
  color:var(--pcv2-ivory);
}
/* The art slot at the row size: a 14px SQUARE, flat. The disc's lit
   sphere and its ring are the prose tag's; here the square is the tag's
   own shape and the coin art (or the letter) is what fills it. */
.pcv2--soren .pcv2-tokref .pcv2-tok{
  height:14px;
  width:14px;
  margin-right:0;
  border-radius:5px;
  background-color:var(--pcv2-tag-square);
  background-image:none;
  box-shadow:none;
}`;

/**
 * Statuses — bare type, no box anywhere, and brightness alone separating
 * the plan's from the legs'.
 *
 * The 96px lane is what keeps the column still: `ARMS ON APPROVAL` and
 * `QUEUED` are eleven characters apart, and without a fixed lane the leg
 * header's right edge moves with the word.
 */
const STATUSES = `
.pcv2--soren .pcv2-state,
.pcv2--soren .pcv2-status{
  border:0;
  border-radius:0;
  background:none;
  padding:0;
  font-size:10px;
  line-height:12px;
  letter-spacing:.06em;
}
.pcv2--soren .pcv2-state{color:var(--pcv2-status-plan)}
.pcv2--soren .pcv2-status{
  width:96px;
  justify-content:flex-end;
  color:var(--pcv2-status-leg);
}`;

/**
 * The footer. Approve is one of exactly three surfaces iridescence is
 * allowed on, and it is the only one on this card.
 *
 * THE CLOCK IS A VALUE, AND VALUES WEAR THE BOX — owner, 2026-08-24
 * ("why is time not formatted"), overruling the bare-clock note that
 * stood here: with the WHEN literal and the THEN amount boxed, a bare
 * `11:44` was the one number left claiming to be chrome. Same glass,
 * clock-scale. `align-items:center` replaces the baseline row because a
 * boxed value has no baseline to share with its label.
 *
 * The row's lanes tighten (16→12, and the pair's 8 holds at every step)
 * so label + clock + Decline + Approve hold ONE LINE at the floating
 * window's width — the owner's wrapped footer, same date.
 */
const FOOTER = `
.pcv2--soren .pcv2-btn--grad{
  background-image:var(--pcv2-approve);
  color:var(--pcv2-approve-ink);
}
.pcv2--soren .pcv2-cd{align-items:center}
.pcv2--soren .pcv2-cd-v{
  display:inline-flex;
  align-items:center;
  height:24px;
  padding:0 8px;
  border-radius:5px;
  border:1px solid var(--pcv2-glass-rim);
  background:var(--pcv2-glass-fill);
  font-size:13.5px;
}
.pcv2--soren .pcv2-ft-row{column-gap:12px}
.pcv2--soren .pcv2-btns{gap:8px}`;

/**
 * The LIVE family at the new ground. The dot tones come from tones the
 * record already owns — armed/pulse green is the system's time/positive
 * green, and amber has been "the PAUSED tone" since the B5 study — so the
 * skin only re-points the two variables the dots read; the pulse ring
 * inherits whatever the dot's background is. The per-leg progress line is
 * one quiet mono sentence, right under the header, ink-3 quiet: the
 * status word stays the headline.
 */
const LIVE = `
.pcv2--soren .pcv2-live-dot{
  --accent-secondary:#7ED6A6;
  --hold:#E8C07E;
}
.pcv2--soren .pcv2-leg-live{
  margin:-7px 0 9px;
  text-align:right;
  font-family:var(--font-geist-mono);
  font-size:10px;
  line-height:12px;
  letter-spacing:.02em;
  color:#8A8A85;
  font-variant-numeric:tabular-nums;
}`;

/** The whole skin, inert until the root wears `pcv2--soren`. */
export const SOREN_CSS = `${TOKENS}${GROUND}${GRAMMAR}${VALUES}${THEN_ROW}${STATUSES}${FOOTER}${LIVE}\n`;

/** The root modifier the sheet hangs off. One class, one flag, one read. */
export const SOREN_ROOT = 'pcv2--soren';

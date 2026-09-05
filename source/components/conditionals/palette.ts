/**
 * ── THE CONDITIONALS PALETTE ─────────────────────────────────────────
 *
 * One block, in one place, because this surface renders in three:
 * the ledger at `/conditionals`, the detail at `/conditionals/[id]`,
 * and the modals those two open — which portal to the document root and
 * so cannot inherit anything either page declares.
 *
 * It states a GROUND and a base colour as well as the tokens. Tokens
 * alone are what left other surfaces half converted: a rule that names
 * `var(--ink-1)` gets ink, and a rule that names no colour keeps
 * inheriting the terminal's near white.
 *
 * This is the light half of the theme when the toggle is built; nothing
 * in it is a literal that would have to be hunted down again.
 */
export const CONDITIONALS_PALETTE = `
[data-conditionals-page],
.cdl-page,
[data-conditional-modal]{
  --surface:#ffffff;
  --surface-1:#ffffff;
  --surface-2:#f7f9f8;
  --surface-3:#f4f7f6;
  --input-bg:rgba(11,14,20,.035);
  --input-border:rgba(11,14,20,.1);
  --chip-bg:rgba(11,14,20,.04);
  --chip-border:rgba(11,14,20,.1);
  --hairline:rgba(11,14,20,.09);
  --hairline-2:rgba(11,14,20,.16);
  --ink-0:#0b0e14;
  --ink-1:#2b3138;
  --ink-2:#5b6570;
  --ink-3:#8a9591;
  --ink-4:#d6dbd9;
  --up:#0f6d5f;
  --down:#b4482e;
  --hold:#c08a12;
  --acc-0:#2a5fd0;
  --accent-primary:#0b0e14;
  --accent-soft:rgba(11,14,20,.06);
  --accent:#0b0e14;
  --accent-ink:#ffffff;
}

[data-conditionals-page]{
  background:var(--surface);
  color:var(--ink-1);
  /* Fills the pane under the sub header, so a page with two plays on it
     is still a page rather than a strip of paper on a black shell. */
  min-height:var(--h-app-content,100%);
}

`;

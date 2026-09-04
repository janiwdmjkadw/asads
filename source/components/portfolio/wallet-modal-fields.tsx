'use client';

import type { ReactElement } from 'react';

/**
 * THE WALLET DIALOGS' FIELDS, AND WHY THEY HAVE THEIR OWN SHEET.
 *
 * Every input in these modals was drawn with an inline `style`, which
 * cannot state a hover or a focus — so all of them fell through to the
 * browser's own focus ring. In Blink that ring is `#e59700`, a mustard
 * amber, drawn `auto` style at whatever width the zoom lands on. It is
 * the one colour on the whole product that belongs to no theme, and it
 * appeared the moment you touched a field in a dialog whose accent is a
 * pale blue.
 *
 * So: no outline, and the BORDER carries the state instead, which is the
 * convention `.dp-input` already set in globals. Resting is the input
 * hairline, hover lifts it a step, focus takes it to `--hairline-2` and
 * warms the field's own ground. Nothing moves and nothing changes size,
 * so a field does not jump when you land in it.
 *
 * KEYBOARD FOCUS IS NOT LOST. Removing a focus ring and giving nothing
 * back is how a form becomes unusable without a mouse; the border here
 * is the indicator, it is on `:focus` rather than `:focus-visible` so it
 * shows for the pointer too, and buttons keep a real ring drawn in the
 * theme's own ink.
 */
export const WALLET_FIELD_SHEET = `
.wm-field{
  width:100%;
  background:var(--input-bg);
  border:1px solid var(--input-border, var(--hairline));
  border-radius:8px;
  padding:8px 10px;
  font-family:var(--sans);
  font-size:13px;
  color:var(--ink-0);
  outline:none;
  transition:border-color .14s var(--ease),background-color .14s var(--ease);
}
.wm-field::placeholder{color:var(--ink-3)}
.wm-field:hover:not(:disabled){border-color:rgba(255,255,255,.14)}
.wm-field:focus{
  border-color:var(--hairline-2);
  background:rgba(255,255,255,.07);
}
.wm-field:disabled{opacity:.55;cursor:not-allowed}

/* The reveal toggle inside the secret field, and the dialog's own
   buttons. Same rule: no UA ring, a house one for the keyboard. */
.wm-ghost,.wm-plain{outline:none}
.wm-ghost:focus-visible,.wm-plain:focus-visible,.wm-field:focus-visible{
  box-shadow:0 0 0 2px rgba(255,255,255,.22);
}
`;

/** Mounted once per dialog, beside the fields it styles. */
export function WalletFieldSheet(): ReactElement {
  return <style>{WALLET_FIELD_SHEET}</style>;
}

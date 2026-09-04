/**
 * THE CHIP, in one place — the ledger's state chip and the detail's
 * version chip are the same 10px mono capital, and they were written
 * twice. (`card-classes.ts` is the precedent for a classes module.)
 *
 * WHY THE PADDING IS ASYMMETRIC, which is the whole reason this file
 * exists: `tracking-[.11em]` puts a letter-space after EVERY character,
 * including the last one, so `EXPIRED` occupies its box plus 1.1px of
 * trailing air. Symmetric 8px padding then centres the box and not the
 * word, and the label sits visibly left of centre — the owner's finding on
 * the shipped page. The fix is to give the trailing space back to the left
 * side: 8.55px in front, 7.45px behind, the same 16px total, and the ink
 * lands in the middle of the chip.
 */

/** The shared chip: geometry and type. Tone (border/ink/wash) is the caller's. */
export const CHIP_BASE =
  'inline-flex flex-none items-center whitespace-nowrap rounded-[6px] border pl-[8.55px] pr-[7.45px] py-[4px] ' +
  'font-[family-name:var(--mono)] text-[10px] uppercase leading-none tracking-[.11em]';

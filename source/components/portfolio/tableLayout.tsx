'use client';


/**
 * Shared grid layout for the Wallets table. Used by `WalletsTable`,
 * `WalletRow`, `GroupRow`, and the mini-tables inside `TransferRail`
 * so dropped rail wallets line up column-for-column with the main
 * list (Axiom-style "rail is just a second table").
 *
 * Lives in its own module to avoid a circular import:
 *   WalletsTable -> WalletRow -> WalletsTable
 */

/*
 * ── THE NAME GETS WHAT IS LEFT, AND IT HAS TO BE ENOUGH ──────────────
 *
 * This pane is HALF the tab — about 400px on a 1180px window. Every
 * fixed track here comes out of the name before the name gets anything,
 * so the three of them plus the gaps have to leave a readable column or
 * the list stops naming its own rows.
 *
 * It shipped at `1.6fr 80px 100px 96px`, which left about 100px for a
 * name and truncated `Wallet 4` to `Wall…`. Then it went to `2.2fr 96px
 * 92px 168px` for a full-width layout that no longer exists, and in
 * half a pane that arithmetic goes NEGATIVE — the name column collapsed
 * to nothing and the rows rendered with no name at all.
 *
 * 76 / 72 / 92 is what each of the three actually needs: a balance is
 * `≡ 41.28`, a holdings cell is a 26px switch and one digit, and the
 * actions are four 13px glyphs at a 9px gap. That leaves the name a bit
 * over half the pane, which fits every default label and most real
 * ones.
 */
export const WALLETS_GRID_TEMPLATE =
  'minmax(0, 1fr) 76px 72px 92px';

/**
 * ── THE COLUMN HEADER IS GONE ────────────────────────────────────────
 *
 * `Wallet · Balance · Holdings · Actions` over a hairline.
 *
 * A column of names is who; a column of `≡ 41.28` is a balance; a
 * column of words you can click is what you can do. Naming them cost a
 * rule and a row on a list that is usually five items long — the same
 * trade the tracker's tape and the Spot tab's holdings both made, and
 * this table sits directly under those.
 *
 * The component stays and returns null so every caller is untouched;
 * putting the header back is a change inside this function.
 */
export function WalletsHeaderRow(): React.ReactElement | null {
  return null;
}

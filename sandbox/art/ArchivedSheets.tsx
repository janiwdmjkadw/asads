import { ChartMarksSheet } from './ChartMarksSheet';
import { CoinSheet } from './CoinSheet';
import { MarkSheet } from './MarkSheet';
import { QuoteSheet } from './QuoteSheet';
import { RowMarksSheet } from './RowMarksSheet';
import { TweetMonitorSheet } from './TweetMonitorSheet';
import { WalletMonitorSheet } from './WalletMonitorSheet';
import { GripVariants } from './GripVariants';
import { PortfolioVariants } from './PortfolioVariants';
import { WalletsVariants } from './WalletsVariants';
import { SplitVariants } from './SplitVariants';
import { ActionVariants } from './ActionVariants';
import { FrenVariants } from './FrenVariants';
import { RewardsVariants } from './RewardsVariants';
import { TierVariants } from './TierVariants';
import { AccoladeVariants } from './AccoladeVariants';
import { FrenMetalVariants } from './FrenMetalVariants';
import { InviteVariants } from './InviteVariants';
import { FrenEmptyVariants } from './FrenEmptyVariants';
import { FrenEmptySheet } from './FrenEmptySheet';
import { FrensHeaderVariants } from './FrensHeaderVariants';
import { RosterVariants } from './RosterVariants';
import { CallVariants } from './CallVariants';

/*
 * ── THE SHEETS THAT ARE DONE ─────────────────────────────────────────
 *
 * Everything `/whatever` used to show, in the order it showed it:
 *
 *   1  the drawn launchpad marks
 *   2  the quote badges a pair can trade against
 *   3  the coin block, on curve and graduated
 *   4  the marks on the second and third lines of a row
 *   5  the chart's bubbles, the card one opens, and the claim tooltip
 *   6  the tweet popup's shell, six ways
 *   7  the wallet tracker's row, at dock width
 *   8  the grip on a docked panel's seam
 *   9  the portfolio, in black
 *  10  the wallets tab
 *  11  the balance split under the spot chart
 *  12  the wallets tab's top right
 *  13  your frens, on the referral tab
 *  14  the rewards page, rebuilt from nothing
 *  15  the cashback climb, and the owl struck in metal
 *  16  the accolades
 *  17  the metal brought over to the fren board
 *  18  the top of the referral tab
 *  19  the fren board with no frens
 *  20  those two empty states, as shipped
 *  21  the frens header, and what its colour is for
 *  22  the roster, animated
 *
 * All ten are ANSWERED — each one was looked at, one option was
 * taken, and it shipped. They are here rather than deleted because a
 * variant sheet is the record of a decision: when someone asks in three
 * months why the bubbles carry letters instead of rings, or why the
 * popup is flat, the answer is the page showing what it was compared
 * against.
 *
 * Nothing imports this. `/whatever` is for the question currently open,
 * and it stays that way — one live sheet, not a scroll through every
 * decision already made. To reopen one, import it in `ArtSheets.tsx`.
 */
export function ArchivedSheets() {
  return (
    <div className="min-h-screen bg-black px-8 py-10">
      <MarkSheet />
      <div className="mt-6">
        <QuoteSheet />
      </div>
      <div className="mt-6">
        <CoinSheet />
      </div>
      <div className="mt-6">
        <RowMarksSheet />
      </div>
      <div className="mt-6">
        <ChartMarksSheet />
      </div>
      <div className="mt-6">
        <TweetMonitorSheet />
      </div>
      <div className="mt-6">
        <WalletMonitorSheet />
      </div>
      <div className="mt-6">
        <GripVariants />
      </div>
      <div className="mt-6">
        <PortfolioVariants />
      </div>
      <div className="mt-6">
        <WalletsVariants />
      </div>
      <div className="mt-6">
        <SplitVariants />
      </div>
      <div className="mt-6">
        <ActionVariants />
      </div>
      <div className="mt-6">
        <FrenVariants />
      </div>
      <div className="mt-6">
        <RewardsVariants />
      </div>
      <div className="mt-6">
        <TierVariants />
      </div>
      <div className="mt-6">
        <AccoladeVariants />
      </div>
      <div className="mt-6">
        <FrenMetalVariants />
      </div>
      <div className="mt-6">
        <InviteVariants />
      </div>
      <div className="mt-6">
        <FrenEmptyVariants />
      </div>
      <div className="mt-6">
        <FrenEmptySheet />
      </div>
      <div className="mt-6">
        <FrensHeaderVariants />
      </div>
      <div className="mt-6">
        <RosterVariants />
      </div>
      <div className="mt-6">
        <CallVariants />
      </div>
    </div>
  );
}

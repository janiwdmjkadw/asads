'use client';

/*
 * THE TOKEN ROW.
 *
 * The surface settled on `/whatever`, moved into the product whole —
 * the art ring and its pad badge, the mint, the identity, every mark on
 * the meta line, the holder pills, the money block and quick buy.
 *
 * It is FIXTURE BACKED, on purpose. This board runs on mock coins; a
 * row that renders only the four fields the mock feed happens to carry
 * shows almost nothing, which is what the first cut of this did. The
 * point of putting it here is to see the whole row.
 *
 * `token-row.css` is shared with the sandbox column, so the sheet and
 * the product render the same markup against the same rules.
 */

import './token-row.css';
import {
  AGES,
  GRADUATED,
  LEAVES,
  MONEY,
  NAMES,
  PADS,
  FEES,
  age,
  feeAuthority,
  ageTier,
  fee,
  mcTier,
  money,
} from './rowData';
import { openInNewTab } from '../cardLinkInteractions';
import { imageSearchHref } from '../imageSearch';
import { FeePopover } from './FeePopover';
import { PAD_MARKS } from './padMarks';
import { ROW2_MARKS } from './rowMarks';
import { SolMark } from './sol';
import { Pills } from './Pills';
import { QUOTES, ROW_QUOTES, type Quote } from './quotes';

/*
 * A COLUMN: the settled head, then a row per launchpad state.
 *
 * ── THE HEAD IS THE REAL ONE ─────────────────────────────────────────
 *
 * `ColumnShell` is imported from `source/`, not copied. A duplicated
 * head drifts from the shipped one the first time either is touched, and
 * then this sheet is approving something the app does not have. It takes
 * children now for exactly this.
 *
 * ── WHAT IS ON A ROW ─────────────────────────────────────────────────
 *
 * The art block and its mint. Nothing else — no age, no market cap, no
 * holders. None of that is designed yet and inventing it would make the
 * sheet look finished while hiding that it is not.
 *
 * Two rows per pad, in order: on curve, then graduated.
 */

/*
 * ── THE QUOTE BADGE ──────────────────────────────────────────────────
 *
 * Straight after the age, and only when the pair is NOT quoted in SOL.
 *
 * Age keeps the front of the line — it is the one field that changes
 * what everything after it MEANS, so it is read first. The quote is
 * next, ahead of every mark and every figure, because it decides
 * whether the row is fillable with what you hold at all: a row you
 * cannot buy is not a row whose holder count you needed.
 *
 * 15px rather than the 17.5 the marks beside it take. It is a photograph
 * in a circle, not a line drawing: a filled disc at 17.5 among outlined
 * glyphs is heavier than any of them, and the two extra pixels are what
 * make it read as a badge stuck on the row rather than as one more mark
 * in the line.
 */
function QuoteBadge({ quote }: { quote: Quote }) {
  if (quote.mark === null) return null;
  return (
    <span className="arc-quote" data-tip={quote.name ? `${quote.label} · ${quote.name} pair` : `${quote.label} pair`}>
      <img src={quote.mark} alt="" width={13} height={13} loading="lazy" />
    </span>
  );
}

function art(seed: number): string {
  const hues = [150, 28, 96, 265, 200, 340, 45, 180];
  const h = hues[seed % hues.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="hsl(${h} 30% 14%)"/>` +
    `<circle cx="48" cy="42" r="20" fill="hsl(${h} 55% 46%)"/>` +
    `<rect x="18" y="66" width="60" height="12" rx="6" fill="hsl(${h} 40% 26%)"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* Fake contract addresses, printed the way the board prints them: first
   three characters, then the last four. */
const CAS = [
  'Av7…pump', 'GJS…bonk', 'Dg8…i4wH', 'H4t…moon', 'Kp2…heav', '9Rt…bags',
  'Ru9…pump', '3N1…bonk', 'CAZ…pump', 'Wm4…moon', 'Qx8…heav', 'Lp6…bags',
];

const GOLD_RING =
  'linear-gradient(135deg, #ae7b0e 0%, #efc10d 46%, #f7d770 62%, #b8830f 100%)';

/*
 * WHICH MARKS A TOKEN HAS.
 *
 * Not every coin ships every link. Most have a website, a good number
 * have Telegram, a few have GitHub, Instagram is rare — so the sets
 * below are weighted that way rather than being an even spread, and a
 * row with nothing but a leaf is in there because that is most of what
 * actually launches.
 *
 * FIXED, not random. `Math.random()` here would deal a new hand on
 * every render, so a row's links would change while you were reading
 * it. Indexed by row, the set is a property of the token.
 *
 * The RENDER ORDER never varies — leaf, user, website, Telegram,
 * GitHub, Instagram, then searches, holders and the dev. Only presence
 * changes. That is what makes the lane scannable down the column: the
 * globe is always in the same place relative to the marks around it, so
 * a missing one reads as a gap rather than as a different icon.
 *
 * The three figures come LAST, after the links. They arrived after
 * everything else on this line and they are the only marks here that
 * carry a number: putting them in the middle split the run of plain
 * glyphs in two, so the links stopped reading as one group.
 */
/*
 * Only the LINKS vary. The search, the holder count, the dev and the
 * migrations are on every row now: they are facts about the token
 * rather than things a team did or did not set up, so a row missing one
 * would be a row where the data failed to load, not a row where there
 * is nothing to show.
 */
const MARK_ORDER = ['leaf', 'x', 'web', 'tg', 'gh', 'cash', 'give', 'fees', 'boost'] as const;
type Mark = (typeof MARK_ORDER)[number];

const MARK_SETS: readonly Mark[][] = [
  ['leaf', 'cash', 'x', 'web', 'tg'],
  ['leaf', 'fees', 'x', 'web'],
  ['leaf', 'give', 'x', 'web', 'tg', 'gh'],
  ['leaf', 'cash', 'boost', 'web'],
  ['leaf', 'x'],
  ['leaf', 'fees', 'give', 'x', 'tg'],
  ['leaf', 'cash', 'web', 'tg', 'boost'],
  ['leaf', 'give', 'x', 'web', 'gh'],
  ['leaf', 'fees', 'tg'],
  ['leaf', 'cash', 'give', 'fees', 'boost', 'x', 'web', 'tg', 'gh'],
  ['leaf', 'give', 'web'],
  ['leaf', 'cash', 'fees', 'x', 'web'],
];/*
 * The two figures, indexed off the row like every other fixture on this
 * sheet, so a row shows the same numbers on every render and the column
 * can be read down rather than flickering. The magnifier has none — it
 * is an action.
 *
 * `migrated` is a PAIR: how many of the dev's launches graduated, over
 * how many they have shipped. One number could not say it. Seven alone
 * is meaningless, and 297 alone is worse, because a dev with 297
 * launches and no graduations is the exact thing this field exists to
 * catch.
 */
const HOLDERS = ['1,204', '86', '12.4K', '312', '47', '2,890', '158', '9,410', '73', '21', '540', '1,077'];
const MIGRATED: ReadonlyArray<readonly [string, string]> = [
  ['7', '297'],
  ['0', '4'],
  ['31', '52'],
  ['2', '119'],
  ['0', '1'],
  ['14', '18'],
  ['1', '806'],
  ['96', '104'],
  ['3', '27'],
  ['0', '12'],
  ['48', '61'],
  ['5', '440'],
];

function marksFor(i: number): Set<Mark> {
  return new Set(MARK_SETS[i % MARK_SETS.length]);
}

/*
 * A social mark. Every one of them is the same 17.5px box, the same 1.7
 * stroke and the same grey as the globe, because a row of links drawn at
 * different weights reads as a row of unrelated things.
 *
 * `viewBox` is 24 for all of them so the paths below are directly
 * comparable, and `currentColor` so a state change is a colour and not a
 * second copy of the mark.
 *
 * `data-tip`, not `title`. The native tooltip waits about a second,
 * paints in the OS's own chrome, and cannot be seen on a touch screen —
 * and having two of these marks on `title` while the stats beside them
 * used the sheet's own bubble meant one line with two tooltip styles.
 */
function Social({ children, label }: { children: import('react').ReactNode; label: string }) {
  return (
    <span className="arc-web" data-tip={label} aria-hidden>
      <svg
        width="15.5"
        height="15.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

/*
 * The three stat marks share one box. Same 17.5px, same 24 viewBox and
 * same 1.7 stroke as the leaf, the person and the links, because a line
 * of marks drawn at different weights reads as a line of unrelated
 * things.
 */
function Glyph({
  children,
  filled = false,
}: {
  children: import('react').ReactNode;
  /*
   * One mark on this line is solid rather than outlined. See the crown
   * below: at 17.5px a five point crown drawn in stroke is a row of
   * spikes with holes between them, and the holes are most of it.
   */
  filled?: boolean;
}) {
  return (
    <svg
      width="15.5"
      height="15.5"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}


export function TokenRow({
  pad,
  i,
  graduated,
}: {
  pad: (typeof PADS)[number];
  i: number;
  graduated: boolean;
}) {
  const n = NAMES[i % NAMES.length];
  const m = MONEY[i % MONEY.length];
  const seconds = AGES[(i * 2 + (graduated ? 1 : 0)) % AGES.length];
  const leaf = LEAVES[(i * 2 + (graduated ? 1 : 0)) % LEAVES.length];
  const has = marksFor(i * 2 + (graduated ? 1 : 0));
  return (
    <div className="arc-row">
      <div
        className="ar"
        data-grad={graduated ? '' : undefined}
        style={{
          ['--pad' as string]: graduated ? GRADUATED : pad.colour,
          ['--ring' as string]: graduated ? GOLD_RING : pad.colour,
        }}
      >
        <div className="ar-box">
          <img className="ar-img" src={art(i)} alt="" />
          {/*
            ── SEARCH THE PICTURE ──────────────────────────────────────
            Over the artwork and nothing else, so the target is the
            thing being searched. It is dark until the pointer is on
            the block, then it frosts the picture back and puts the
            camera on it — the picture is still legible underneath,
            which is what says WHICH image is about to be searched.

            NO LABEL. It wore the row's `data-tip` bubble, and the bubble
            was the loudest thing on the line: a slab of black over the
            row above, to say what a camera on a picture already says.
          */}
          <button
            type="button"
            className="ar-find"
            aria-label={`Search the ${n.ticker} image on Google`}
            onClick={() => {
              const href = imageSearchHref(art(i), `${n.ticker} ${n.name}`);
              if (href) openInNewTab(href);
            }}
          >
            {/* A CAMERA, not a picture frame. The frame said "here is an
                image", which the thing under it already says; a camera
                says look this up, which is the action. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2.7 10.1c0-1.45 1.16-2.6 2.6-2.6h1.85l1.2-2.6h7.3l1.2 2.6h1.85c1.44 0 2.6 1.15 2.6 2.6v6.9c0 1.45-1.16 2.6-2.6 2.6H5.3c-1.44 0-2.6-1.15-2.6-2.6z" />
              <circle cx="12" cy="13.4" r="3.5" />
            </svg>
          </button>
          <span className="ar-pad">
            {/*
              * The artwork, as before — EXCEPT graduated Bonk.
              *
              * Bonk's logo is an orange disc with a light emblem on it,
              * so the gold filter had nothing to bite: tinting a full
              * colour bitmap cannot know which pixels are the mark, and
              * it came out an orange smear. Its traced mark takes
              * `currentColor` instead, so gold is just a colour.
              *
              * Every other pad keeps its bitmap. The filter works on
              * them and a drawn stand-in would be the one badge in the
              * column that is not the real logo.
              */}
            <span className="ar-pad-face">
              {graduated && pad.key === 'bonk' ? (
                <span className="ar-pad-mark">{PAD_MARKS.bonk}</span>
              ) : (
                <img
                  src={pad.logo}
                  alt=""
                  data-solid={pad.solid ? '' : undefined}
                  data-gold={graduated ? '' : undefined}
                />
              )}
            </span>
          </span>
        </div>
        <span className="ar-mint">{CAS[(i * 2 + (graduated ? 1 : 0)) % CAS.length]}</span>
      </div>

      <div className="arc-body">
        {/* Inline: the ticker, then the name beside it. The name is what
            truncates; the ticker never does. */}
        <div className="arc-id">
          <span className="arc-ticker">{n.ticker}</span>
          <span className="arc-name">{n.name}</span>
        </div>

        {/*
          * The second line, and it starts with age.
          *
          * Age is first because it is the one field on this line that
          * changes what everything else means: a 40% holder concentration
          * at four seconds old is a launch, and the same figure at four
          * days is a rug that has already happened. Reading it first
          * frames the rest of the line.
          */}
        <div className="arc-meta">
          <span className="arc-age" data-tier={ageTier(seconds)}>
            {age(seconds)}
          </span>

          {/*
            * ── THE ORDER ───────────────────────────────────────────
            *
            * Time, currency, leaf, protocol — then everything else.
            *
            * Those four lead because each one changes what the rest of
            * the row MEANS. Age frames every figure on it; the quote
            * decides whether the row is fillable with what you hold;
            * the leaf and the protocol say what kind of thing it is.
            * Links and counts are detail, and detail reads after the
            * frame rather than before it.
            *
            * The three offers — cashback, charity, fee sharing — sit
            * with the protocol rather than among the links, because
            * they are TERMS of the token and not places to go.
            */}

          <QuoteBadge quote={QUOTES[ROW_QUOTES[(i * 2 + (graduated ? 1 : 0)) % ROW_QUOTES.length]]} />
          {/*
            * The real mark, supplied. Three attempts at drawing and
            * tracing it missed; this is the path itself.
            *
            * STROKED, not filled — `fill="none"` with a 2 unit stroke is
            * the whole reason it reads as an outline of a leaf rather
            * than a solid blob, which is what every attempt to fill it
            * produced. The viewBox starts at y=1, as supplied, so the
            * mark sits where it was drawn to sit.
            *
            * 17.5px with a 1.7 stroke. The path grows with the box, so
            * the stroke has to come down as the mark goes up or the
            * outline thickens along with it.
            */}
          {has.has('leaf') && (
          <span className="arc-leaf" data-tier={leaf} aria-hidden>
            <svg
              width="15.5"
              height="15.5"
              viewBox="0 1 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              xmlns="http://www.w3.org/2000/svg"
            >
              {ROW2_MARKS.leaf.art}
            </svg>
          </span>
          )}
          {/*
            * ── THE PLATFORM ────────────────────────────────────────
            *
            * The launchpad the token was minted on, drawn as its own
            * logo. ALWAYS PRESENT — a token cannot exist without one,
            * so unlike the socials it is not in the random set and
            * never leaves a gap.
            *
            * Except Dynamic BC, which has no logo of its own. The
            * lookup returns nothing for it and the slot collapses,
            * rather than showing an invented mark that would be the one
            * thing on this line that is not a real logo.
            *
            * SECOND ON THE LINE, straight after the age. It was eighth,
            * behind the socials, and the line caps at five marks — so
            * on a row with a full set of links the protocol was the
            * thing that got cut. It is the one mark here that every
            * token has and that no token can be read without.
            */}
          {PAD_MARKS[pad.key] && (
            <span className="arc-plat" data-tip={`Launched on ${pad.label}`}>
              {PAD_MARKS[pad.key]}
            </span>
          )}

          {/*
            * ALWAYS ON, so they lead rather than trail.
            *
            * The line is capped, and these two sat at the end behind
            * the links — so on any row with a few socials they were the
            * marks being cut. They are facts about who holds the token
            * and what its dev has shipped, which is not something to
            * show only when there is room left over.
            */}



          {/*
            * ── THE ATTRIBUTES ──────────────────────────────────────
            *
            * Cashback, charity, fee sharing, boost. These are the last
            * things on the line and they are the only ones that are
            * about what a token OFFERS rather than what it is or who
            * made it, so they sit past the stats, as a group.
            *
            * COLOURED, where the rest of the line is grey. That is the
            * opposite of the rule the platform mark follows and it is
            * the same reason: these are rare, and a mark that is rare
            * is worth catching the eye. If most rows had them they
            * would all go grey.
            *
            * Cashback and charity are the app's OWN icons, lifted out
            * of `public/assets` rather than drawn. Two versions of the
            * same idea in one product is how they drift apart.
            */}
          {has.has('cash') && (
          <span className="arc-attr is-cash" data-tip="Cashback">
            <svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="currentColor">
              {ROW2_MARKS.cashback.art}
            </svg>
          </span>
          )}
{has.has('give') && (
          <FeePopover className="arc-attr is-give has-pop" label="Charity coin" auth={feeAuthority(i, true)}>
            <svg
              width="15.5"
              height="15.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ROW2_MARKS.charity.art}
            </svg>
          </FeePopover>
          )}
          {/*
            * Fee sharing: one stream splitting into two.
            *
            * Not a percent sign and not a coin — both of those say
            * "money" and this line is already full of money. What has
            * to read is the SPLIT, so it is a single line that forks,
            * with a head on each branch to say the two halves go
            * somewhere rather than just ending.
            */}
          {has.has('fees') && (
          <FeePopover className="arc-attr is-fees has-pop" label="Fee sharing" auth={feeAuthority(i, false)}>
            <Glyph>
              {ROW2_MARKS.feeSharing.art}
            </Glyph>
          </FeePopover>
          )}
          {/*
            * Boost: a rocket, not a lightning bolt. The bolt is already
            * the quick-buy control at the top of this column, and one
            * glyph meaning two things in one view is worse than a
            * second-choice glyph.
            */}
          {has.has('boost') && (
          <span className="arc-attr is-boost" data-tip="Boosted">
            <Glyph>
              {ROW2_MARKS.boost.art}
            </Glyph>
          </span>
          )}
          {/*
            * ── THE ACCOUNT ─────────────────────────────────────────
            *
            * The plain user, outlined like everything else on this
            * line. It was X's mark, which had to be solid because that
            * logo has no outline form — one filled glyph among a row of
            * line drawings, for a link that is not special.
            *
            * First of the links, because it is the one a token is most
            * likely to have and the one people check first.
            */}
          {has.has('x') && (
          <span className="arc-web" data-tip="Account" aria-hidden>
            <svg
              width="15.5"
              height="15.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ROW2_MARKS.account.art}
            </svg>
          </span>
          )}
          {/*
            * ── THE LINKS ───────────────────────────────────────────
            *
            * Website, Telegram, GitHub, Instagram. All grey and all the
            * same weight: a link either exists or it does not, and on a
            * lane where nearly every row has a website, colouring them
            * would make the most common thing the loudest.
            *
            * The globe is a globe rather than a chain because this row
            * carries three other links — the mark has to say WHICH
            * somewhere it goes, not just that it goes somewhere.
            */}


          {has.has('web') && (
          <Social label="Website">
            {ROW2_MARKS.website.art}
          </Social>
          )}
{has.has('tg') && (
          <Social label="Telegram">
            {/* The plane, and the fold line across it — without that
                second stroke it is a triangle. */}
            {ROW2_MARKS.telegram.art}
          </Social>
          )}
{has.has('gh') && (
          <Social label="GitHub">
            {ROW2_MARKS.github.art}
          </Social>
          )}









          

          



          {/*
            * ── THE MAGNIFIER ───────────────────────────────────────
            *
            * NO FIGURE. It is an action, not a count: it opens the
            * search on this token. The two marks after it carry numbers
            * because holders and a dev's record ARE numbers, and a
            * magnifier with a figure beside it would read as a third
            * one — a tally of something nobody asked to be told.
            *
            * Two elements, the budget the pad marks are drawn to: a ring
            * and a handle, and the handle starts ON the ring rather than
            * beside it. A gap between them is the first thing that goes
            * at 17.5px, and it turns the mark into a circle with a tick
            * next to it.
            */}
          <span className="arc-stat is-bare" data-tip="Search the contract">
            <Glyph>
              {ROW2_MARKS.search.art}
            </Glyph>
          </span>



          {/*
            * ── THERE IS NO LONE DEV MARK ───────────────────────────
            *
            * A single person used to sit here, between the magnifier
            * and the holders count. It was the SAME drawing as the
            * account link a few marks to its left — circle, shoulders,
            * same weight — so the line carried one glyph twice, once
            * meaning "this token has a profile" and once meaning "the
            * dev", with nothing to tell them apart and no figure or tip
            * on the second one to explain it.
            *
            * The dev is not unrepresented: the crown at the end of the
            * line is the dev's record, and it is the mark that actually
            * says something about them.
            */}

          {/*
            * LAST ON THE LINE, and never cut.
            *
            * They belong at the end — they are counts, and the marks
            * before them are what the token IS. But the line is capped
            * by position, so being last used to mean being the first
            * thing dropped on a busy row. The cap skips them by class
            * instead: order says where they sit, the exemption says
            * they are always there.
            */}
          {/*
            * ── HOLDERS ─────────────────────────────────────────────
            *
            * TWO people, not one. The single figure a few marks to the
            * left is the dev, and drawing holders with the same figure
            * would put one mark on this line meaning two things.
            *
            * The one behind is a head and a shoulder rather than a
            * second whole person: a crowd at this size is a smudge, and
            * all this has to say is that the figure counts more than one.
            */}
          <span className="arc-stat" data-tip="Total holders">
            <Glyph>
              {ROW2_MARKS.holders.art}
            </Glyph>
            {HOLDERS[i % HOLDERS.length]}
          </span>

          {/*
            * ── THE DEV ─────────────────────────────────────────────
            *
            * A crown, gold, with the pair beside it: graduated over
            * shipped. Gold because that is already this board's colour
            * for graduating — the ring around a graduated art block is
            * the same value.
            *
            * FILLED, and the only solid mark on the line. A five point
            * crown in outline at 17.5px is a row of spikes with gaps
            * between them, and the gaps end up being most of the mark;
            * solid, the silhouette survives the size. It is the one
            * exception to the outlined set, and it earns it by being the
            * one mark here that is about WHO rather than how many.
            *
            * One path: the band and the five points in a single
            * contour, with the dips cut into it. A separate base bar was
            * tried and at this size it closes up against the band.
            */}
          <span className="arc-stat is-gold" data-tip="Dev migrations">
            <Glyph filled>
              {ROW2_MARKS.migrations.art}
            </Glyph>
            {MIGRATED[i % MIGRATED.length][0]}
            <span className="arc-of">/</span>
            {MIGRATED[i % MIGRATED.length][1]}
          </span>

        </div>

        {/* The third line, under the second and on the same left edge. */}
        <Pills i={i} />
      </div>

      {/*
        * Volume and market cap on ONE line, each behind its own key.
        *
        * They were stacked, which made the pair two lines tall next to a
        * ticker that is one — and the two figures are the same shape, so
        * stacking them without reading the keys told you nothing anyway.
        *
        * Volume is always white: it is a rate, and a rate has no good or
        * bad value. Market cap carries the colour, because the size of a
        * token is the thing being judged.
        */}
      <div className="arc-money">
        <div className="arc-money-line">
          <span className="arc-money-row">
            <span className="arc-key">V</span>
            <span className="arc-fig">{m.vol}</span>
          </span>
          <span className="arc-money-row">
            <span className="arc-key">MC</span>
            <span className="arc-fig" data-tier={mcTier(m.mcValue)}>
              {money(m.mcValue)}
            </span>
          </span>
        </div>

        {/*
          * ── FEES PAID ─────────────────────────────────────────────
          *
          * Its own line under the pair, because it is a different KIND
          * of number: volume and market cap are both dollars and can be
          * compared to each other, and this is SOL. Sitting on the same
          * line they would read as a third figure in the same series.
          *
          * The Solana mark carries the unit, so there is no "SOL" to
          * write — and it is the real mark in its own colours. It was
          * flattened to white once before and that was wrong: a brand
          * mark stripped of its colour stops being the brand mark.
          *
          * The figure is white and takes no tier colour. Fees are a
          * fact about what the token has paid, not a verdict on it.
          */}
        <div className="arc-money-line">
          <span className="arc-money-row">
            <span className="arc-key">F</span>
            <span className="arc-sol" aria-hidden>
              <SolMark />
            </span>
            <span className="arc-fig">{fee(FEES[i % FEES.length])}</span>
          </span>
        </div>
      </div>

      {/*
        * ── QUICK BUY ───────────────────────────────────────────────
        *
        * At rest it is a bare green mark and a figure on the row's own
        * ground — no plate, which is what the reference shows. The
        * plate is the HOVER, and the label flips to near black on it.
        *
        * A <button>, not a span. It is the one thing on this row that
        * spends money.
        */}
      <button className="arc-buy" type="button">
        {/*
          The bolt and the label are wrapped together rather than being
          two children of the button. The button's own alignment is what
          PLACES the control — ultra pins it to the bottom right of its
          panel — and that was aligning the icon and the text to the
          panel's floor independently, which sat the bolt below the
          label. Inside this span the two are aligned to each other and
          nothing else.
        */}
        <span className="arc-buy-in">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M13.4 2 4.2 13.4h6L9.8 22l9.4-11.6h-6.2z" />
          </svg>
          <span className="arc-buy-amt">0 SOL</span>
        </span>
      </button>
    </div>
  );
}

export type BuyVariant = 'small' | 'small-sharp' | 'large' | 'large-sharp' | 'ultra';

/*
 * `buy` picks which quick-buy treatment the rows get, and `limit` cuts
 * the column short. Both exist so the variants sheet can show three
 * columns side by side rather than describing the difference — the
 * thing being compared is a HOVER, and a hover cannot be screenshotted
 * into a spec.
 */

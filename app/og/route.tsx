import { ImageResponse } from 'next/og';

/**
 * `/og` — THE preview card. One image, every page, every link.
 *
 * ── ONE ──────────────────────────────────────────────────────────────
 *
 * Not one per page. One. A preview has a single job: to say whose link
 * this is before a word of it is read, and that only works if every link
 * off this site looks identical. A card per page is nineteen things to
 * keep in step, nineteen chances for one of them to look like a different
 * company, and no gain at all at the size these are actually seen.
 *
 * There is no query parameter for the same reason. There is nothing to
 * choose.
 *
 * ── THE DESIGN ───────────────────────────────────────────────────────
 *
 * The site's own materials and nothing else: white ground, ink type, the
 * mark in flat black. A link unfurling somewhere should look like the
 * page it opens, and every page it can open is white.
 *
 * The mark and the headline up top; along the foot, the run in five
 * beats, each on its own meter, filled to four of five. The strip is what
 * stops the card being a headline on a white box: it says the product
 * does something, and it says what.
 *
 * A black card with the mark in its own orange to red was tried and cut.
 * It stood out in a feed and it was the only surface anywhere in the
 * product that looked like that, which is a worse problem than being
 * quiet.
 *
 * ── NO FONT FETCH ────────────────────────────────────────────────────
 *
 * It deliberately does not fetch Instrument Sans at render time. A card
 * that reaches the network to draw itself fails closed the first time
 * that fetch is slow or blocked, and a missing preview is worse than one
 * set in the runtime's own face.
 */

export const runtime = 'edge';

const INK = '#0b0b0b';
const BODY = '#55555a';
const FAINT = '#8a8a90';
const LINE = '#e4e7e6';

const TITLE = 'Say the condition once. It holds it against the market.';

/*
 * THE STRIP ALONG THE FOOT.
 *
 * The run the product does, in five beats. It is the same on every page
 * because the card is the same on every page: what it shows is the one
 * thing true of all of them.
 *
 * `LIVE` is how far along the run is drawn. Four of five, deliberately:
 * a strip filled to the end is a finished thing, and this product is
 * something that is still watching.
 */
const BEATS: ReadonlyArray<readonly [string, string]> = [
  ['Written', 'one sentence, your words'],
  ['Understood', 'the vague half, scored'],
  ['Armed', 'watching, nothing spent'],
  ['Matched', 'the condition came true'],
  ['Filled', '10 SOL, on your terms'],
];

const LIVE = 3;

const MARK_PATHS: readonly string[] = [
  'M317.5 452C307.5 403.2 329.333 376 341.5 368.5C381.5 362.5 423.667 432.833 438 469.5C439.2 518.7 395.667 523.167 374.5 518.5C339.3 513.7 321.833 472.167 317.5 452Z',
  'M699.5 466C715.9 405.2 694.333 375.333 681.5 368C652.7 361.6 618.167 407.667 604.5 431.5C565.3 486.3 593.167 511 612 516.5C664.8 531.3 692.333 489 699.5 466Z',
  'M541.5 585C535.9 589.4 512 748.5 512 748.5C488.4 596.5 450.833 484.167 435 447C400.2 377 299.167 300.167 253 270.5C329.4 290.1 380.5 332 396.5 350.5C420.9 375.3 445.667 404.833 455 416.5C477.4 454.1 502.333 513.5 512 538.5C516.4 516.9 546.833 458.167 561.5 431.5C605.5 374.5 602.5 373.5 655 332C697 298.8 745.167 290.833 764 291C728 301.5 716.5 320.5 712.5 319.5C708.5 318.5 654 355.5 620.5 399C587 442.5 590 444.5 568 493.5C546 542.5 548.5 579.5 541.5 585Z',
  'M562 880L573.5 935.5L297 710C138.6 585.6 132 422.167 148.5 356C206.1 124.4 429.833 79.8333 534.5 86.4999C710.9 105.7 801 214.167 824 266C699.6 82.8 491.167 108 402.5 143.5C189.3 219.5 180.333 399.167 202.5 479.5C246.5 622.7 429.167 757.167 515 806.5L645 710C756.6 624.8 802.833 520.833 812 479.5C854.4 283.1 753.667 264.333 698 279.5C843.2 205.1 882.833 362.5 884.5 450.5C880.1 590.9 695.333 758.333 603.5 824.5C565.9 847.7 560.167 871.167 562 880Z',
];

function Mark({ size }: { readonly size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
      {MARK_PATHS.map((d) => (
        <path key={d.slice(0, 18)} d={d} fill={INK} />
      ))}
    </svg>
  );
}

export function GET(): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#ffffff',
          padding: '60px 68px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <Mark size={42} />
            <span style={{ fontSize: 24, color: FAINT, letterSpacing: '-0.01em' }}>Listen</span>
          </div>
          <span
            style={{
              marginTop: 40,
              maxWidth: 860,
              fontSize: 62,
              lineHeight: 1.06,
              letterSpacing: '-0.04em',
              color: INK,
            }}
          >
            {TITLE}
          </span>
        </div>

        {/*
          THE STRIP.

          Five columns, each sitting on its own meter. A beat that has
          happened has an ink bar and ink type; one still to come has the
          hairline and the back ink. Nothing else separates them: no dot,
          no ring, no chip.

          Flex rather than grid, and every column is flex: 1 with a
          min-width of 0 — satori has no grid, and without the min-width a
          long note refuses to wrap and pushes the row out of the frame.
        */}
        <div style={{ display: 'flex', gap: 22 }}>
          {BEATS.map(([name, note], i) => (
            <div key={name} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div
                style={{
                  height: 3,
                  marginBottom: 18,
                  borderRadius: 2,
                  background: i <= LIVE ? INK : LINE,
                }}
              />
              <span style={{ fontSize: 20, color: i <= LIVE ? INK : FAINT }}>{name}</span>
              <span style={{ marginTop: 5, fontSize: 16.5, lineHeight: 1.35, color: i <= LIVE ? FAINT : '#b6b6bb' }}>
                {note}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}

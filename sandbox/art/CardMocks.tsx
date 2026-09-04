import type { ReactElement, ReactNode } from 'react';

/**
 * PREVIEW CARD VARIANTS, ALL ON ONE SHAPE.
 *
 * The shape is fixed: the mark and one headline up top, and a strip
 * running the full width along the foot. What varies is only the strip.
 *
 * ── AND ALL EIGHT ARE THE SAME CARD ──────────────────────────────────
 *
 * One image for the whole site, so the words never change page to page
 * and nothing in here names a section. What the strip shows is the one
 * thing true of every page: a condition being held, and what the agent
 * is doing about it.
 *
 * Each is a real 1200 by 630 scaled by its stage, so what is on screen is
 * what the route would emit.
 */

const MARK_PATHS: readonly string[] = [
  'M317.5 452C307.5 403.2 329.333 376 341.5 368.5C381.5 362.5 423.667 432.833 438 469.5C439.2 518.7 395.667 523.167 374.5 518.5C339.3 513.7 321.833 472.167 317.5 452Z',
  'M699.5 466C715.9 405.2 694.333 375.333 681.5 368C652.7 361.6 618.167 407.667 604.5 431.5C565.3 486.3 593.167 511 612 516.5C664.8 531.3 692.333 489 699.5 466Z',
  'M541.5 585C535.9 589.4 512 748.5 512 748.5C488.4 596.5 450.833 484.167 435 447C400.2 377 299.167 300.167 253 270.5C329.4 290.1 380.5 332 396.5 350.5C420.9 375.3 445.667 404.833 455 416.5C477.4 454.1 502.333 513.5 512 538.5C516.4 516.9 546.833 458.167 561.5 431.5C605.5 374.5 602.5 373.5 655 332C697 298.8 745.167 290.833 764 291C728 301.5 716.5 320.5 712.5 319.5C708.5 318.5 654 355.5 620.5 399C587 442.5 590 444.5 568 493.5C546 542.5 548.5 579.5 541.5 585Z',
  'M562 880L573.5 935.5L297 710C138.6 585.6 132 422.167 148.5 356C206.1 124.4 429.833 79.8333 534.5 86.4999C710.9 105.7 801 214.167 824 266C699.6 82.8 491.167 108 402.5 143.5C189.3 219.5 180.333 399.167 202.5 479.5C246.5 622.7 429.167 757.167 515 806.5L645 710C756.6 624.8 802.833 520.833 812 479.5C854.4 283.1 753.667 264.333 698 279.5C843.2 205.1 882.833 362.5 884.5 450.5C880.1 590.9 695.333 758.333 603.5 824.5C565.9 847.7 560.167 871.167 562 880Z',
];

function Mark({ size }: { readonly size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" aria-hidden>
      {MARK_PATHS.map((d) => (
        <path key={d.slice(0, 18)} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

const TITLE = 'Say the condition once. It holds it against the market.';

function Card({ n, strip }: { readonly n: number; readonly strip: ReactNode }): ReactElement {
  return (
    <div className="cm-slot">
      <span className="cm-n">{String(n).padStart(2, '0')}</span>
      <div className="cm-stage">
        <div className={`cm-card cm-${n}`}>
          <div className="cm-head">
            <div className="cm-brand">
              <Mark size={42} />
              <span>Listen</span>
            </div>
            <h2>{TITLE}</h2>
          </div>
          {strip}
        </div>
      </div>
    </div>
  );
}

/* Five beats, the run the product actually does. Same words in every
   strip, so the strips are what is being compared. */
const BEATS: ReadonlyArray<readonly [string, string]> = [
  ['Written', 'one sentence, your words'],
  ['Understood', 'the vague half, scored'],
  ['Armed', 'watching, nothing spent'],
  ['Matched', 'the condition came true'],
  ['Filled', '10 SOL, on your terms'],
];

const LIVE = 3;

export function CardMocks(): ReactElement {
  return (
    <div className="cm">
      <style>{SHEET}</style>

      {/* 01 · what 08 was: a hairline rail, nodes on it, four of five done */}
      <Card
        n={1}
        strip={
          <ol className="s s-rail">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <i />
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 02 · the rail FILLS. The line itself carries the progress, so the
             strip says how far along without a single dot. */}
      <Card
        n={2}
        strip={
          <ol className="s s-fill" style={{ ['--at' as string]: `${((LIVE + 0.5) / 5) * 100}%` }}>
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 03 · no rail at all. Five columns divided by verticals, the way a
             spec sheet is set. The quietest of the eight. */}
      <Card
        n={3}
        strip={
          <ol className="s s-cols">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 04 · numbered. The count is the structure, and the live one is the
             only number in full ink. */}
      <Card
        n={4}
        strip={
          <ol className="s s-num">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <i>{String(i + 1).padStart(2, '0')}</i>
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 05 · a bar under each column, filled to where that beat stands. It
             is the meter every band on the site is drawn with. */}
      <Card
        n={5}
        strip={
          <ol className="s s-bars">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <em />
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 06 · the beats point at each other. An arrow between columns says
             sequence, which the rail only implies. */}
      <Card
        n={6}
        strip={
          <ol className="s s-arrow">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 07 · the strip is the ORDER rather than the run: when, then, with,
             until. Four terms instead of five beats. */}
      <Card
        n={7}
        strip={
          <ol className="s s-terms">
            {[
              ['When', 'the cap passes $5,000'],
              ['Then', 'buy 2 SOL of TAU'],
              ['With', '15% max slippage'],
              ['Until', 'it fires, or 24 hours'],
            ].map(([k, v]) => (
              <li key={k}>
                <b>{k}</b>
                <span>{v}</span>
              </li>
            ))}
          </ol>
        }
      />

      {/* 08 · the strip inverts: black, full bleed to the card's edges. The
             only one that changes the card rather than the diagram. */}
      <Card
        n={8}
        strip={
          <ol className="s s-black">
            {BEATS.map(([name, note], i) => (
              <li key={name} data-on={i <= LIVE ? 'true' : 'false'}>
                <i />
                <b>{name}</b>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        }
      />
    </div>
  );
}

/* NO BACKTICKS BELOW THIS LINE. One of them ends the stylesheet. */
const SHEET = `
.cm, .cm * { box-sizing: border-box; }
.cm {
  --sans: var(--font-instrument-sans, var(--font-geist-sans, ui-sans-serif)), system-ui, sans-serif;
  --ink: #0b0b0b; --body: #55555a; --faint: #8a8a90; --line: #e4e7e6;
  zoom: 0.847458; background: #141517; padding: 26px 26px 120px;
}
.cm-slot { margin-bottom: 26px; }
.cm-n { display: block; padding-bottom: 8px; font-family: var(--sans); font-size: 12px; color: #6f7276; font-variant-numeric: tabular-nums; }

/* the stage scales a real 1200 by 630 down to the column */
.cm-stage { width: 100%; aspect-ratio: 1200 / 630; overflow: hidden; border-radius: 12px; container-type: inline-size; }
.cm-card {
  position: relative; overflow: hidden;
  width: 1200px; height: 630px;
  transform-origin: 0 0; scale: calc(100cqw / 1200);
  display: flex; flex-direction: column; justify-content: space-between;
  background: #fff; padding: 60px 68px;
  font-family: var(--sans); color: var(--ink);
}
.cm-head { display: flex; flex-direction: column; gap: 40px; }
.cm-brand { display: flex; align-items: center; gap: 15px; }
.cm-brand span { font-size: 24px; letter-spacing: -0.01em; color: var(--faint); }
.cm-card h2 { margin: 0; max-width: 17ch; font-size: 62px; font-weight: 400; line-height: 1.06; letter-spacing: -0.04em; }

/*
 * THE STRIP.
 *
 * Five columns, full width, along the foot. Everything below changes only
 * what is drawn between and under them.
 */
.s { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); gap: 22px; margin: 0; padding: 0; list-style: none; }
.s b { display: block; font-size: 20px; font-weight: 400; color: var(--ink); }
.s span { display: block; margin-top: 5px; font-size: 16.5px; line-height: 1.35; color: var(--faint); }
.s li[data-on='false'] b { color: var(--faint); }
.s li[data-on='false'] span { color: #b6b6bb; }

/* 01 · the rail with nodes on it */
.s-rail { padding-top: 28px; }
.s-rail::before { content: ''; position: absolute; left: 0; right: 0; top: 6px; height: 1px; background: var(--line); }
.s-rail li { position: relative; }
.s-rail i { position: absolute; left: 0; top: -28px; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
.s-rail li[data-on='true'] i { background: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }

/*
 * 02 · THE RAIL ITSELF FILLS.
 *
 * The line carries the progress, so the strip says how far along without
 * a dot anywhere in it. --at is where the run has reached.
 */
.s-fill { padding-top: 26px; }
.s-fill::before { content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 3px; border-radius: 2px; background: var(--line); }
.s-fill::after { content: ''; position: absolute; left: 0; top: 4px; width: var(--at); height: 3px; border-radius: 2px; background: var(--ink); }

/* 03 · columns, divided, no rail */
.s-cols { gap: 0; }
.s-cols li { padding: 0 26px; border-left: 1px solid var(--line); }
.s-cols li:first-child { padding-left: 0; border-left: 0; }

/* 04 · numbered */
.s-num { padding-top: 26px; border-top: 1px solid var(--line); }
.s-num i { display: block; margin-bottom: 12px; font-style: normal; font-size: 15px; color: #c2c2c7; font-variant-numeric: tabular-nums; }
.s-num li[data-on='true'] i { color: var(--ink); }

/* 05 · a meter under each column */
.s-bars em { display: block; height: 3px; margin-bottom: 18px; border-radius: 2px; background: var(--line); }
.s-bars li[data-on='true'] em { background: var(--ink); }

/* 06 · arrows between */
.s-arrow { padding-top: 26px; border-top: 1px solid var(--line); }
.s-arrow li { position: relative; }
.s-arrow li + li::before {
  content: ''; position: absolute; left: -14px; top: 9px;
  width: 7px; height: 7px; border-top: 1px solid var(--line); border-right: 1px solid var(--line);
  transform: rotate(45deg);
}

/* 07 · the order, not the run */
.s-terms { grid-template-columns: repeat(4, 1fr); padding-top: 26px; border-top: 1px solid var(--line); }
.s-terms b { font-size: 16.5px; color: var(--faint); }
.s-terms span { margin-top: 8px; font-size: 22px; line-height: 1.3; color: var(--ink); }

/*
 * 08 · THE STRIP INVERTS.
 *
 * Full bleed to the card's edges, so it is a band rather than a diagram
 * sitting inside a margin. It needs its own scale: everything in it is
 * on black.
 */
.cm-8 { padding-bottom: 0; }
.s-black { margin: 0 -68px; padding: 34px 68px 38px; background: #0a0a0a; }
.s-black::before { content: ''; position: absolute; left: 68px; right: 68px; top: 40px; height: 1px; background: rgba(245,245,245,.14); }
.s-black li { position: relative; padding-top: 28px; }
.s-black i { position: absolute; left: 0; top: -6px; width: 13px; height: 13px; border-radius: 50%; background: #0a0a0a; box-shadow: inset 0 0 0 1px rgba(245,245,245,.22); }
.s-black li[data-on='true'] i { background: #f5f5f5; box-shadow: inset 0 0 0 1px #f5f5f5; }
.s-black b { color: #f5f5f5; }
.s-black span { color: #7d7d84; }
.s-black li[data-on='false'] b { color: #7d7d84; }
.s-black li[data-on='false'] span { color: #55555a; }
`;

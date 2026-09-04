'use client';

/*
 * THE NAV.
 *
 * Number one, with the wordmark out and the column at 1400.
 *
 * ── THE THREE DECISIONS ──────────────────────────────────────────────
 *
 * 1400, CENTRED. The bar and the page share one column, so the mark and
 * the headline start on the same line and the button and the right edge
 * of the text end on the same one. Past 1400 the column stops growing and
 * the page centres in the window; under it the column is the viewport
 * minus its gutters, so nothing ever touches an edge. `min()` does both
 * without a media query.
 *
 * NO WORDMARK. The mark carries the corner alone. With the word beside it
 * the lockup ran about 120px and the destinations started a fifth of the
 * way into the bar; at 26px they start where the eye already is. The name
 * is still in the DOM for anything that reads rather than looks — see the
 * visually hidden span.
 *
 * THE HAIRLINE RUNS FULL BLEED while the row inside it is capped. The
 * line is the bottom of the page's chrome, not the bottom of the column,
 * so it goes edge to edge at every width.
 *
 * ── THE MARK ─────────────────────────────────────────────────────────
 *
 * `/landing/svg/mark.svg`, the real logo. The file ships with a baked
 * gradient, so the silhouette is punched out of a filled box with a CSS
 * mask rather than drawn as an `img`. That is what lets it be ink here
 * and any other colour on any other ground.
 *
 * ── HOVER ────────────────────────────────────────────────────────────
 *
 * The ink comes up to full and a #F4F7F6 plate appears behind the word.
 * Nothing is ever drawn underneath it.
 */

import type { ReactElement } from 'react';

const NAV = ['Terminal', 'Rewards'] as const;

const COMMUNITY: ReadonlyArray<readonly [string, string, string]> = [
  ['Discord', '4,102 members', 'M8.5 8.2A11 11 0 0115.5 8.2M7 16a12 12 0 0010 0M9.2 12.6h.01M14.8 12.6h.01M8.6 6.4a15 15 0 016.8 0l1.9 1.1a10 10 0 012.2 9.4l-2.6 1.7-1.4-1.9M8.6 6.4L6.7 7.5a10 10 0 00-2.2 9.4l2.6 1.7 1.4-1.9'],
  ['Twitter', '@listendotmoney', 'M4 4l7.5 9.5L4.4 20M20 4l-7.6 9.1L20 20'],
  ['Docs', 'How it works', 'M6 4h9l4 4v12H6zM15 4v4h4M9 13h6M9 17h6'],
];

function Nav({ open = false }: { readonly open?: boolean }): ReactElement {
  return (
    <header className="nv-bar">
      <div className="nv-row">
        <a className="nv-brand" href="#">
          <span aria-hidden className="nv-mk" />
          <span className="nv-sr">Listen, back to top</span>
        </a>

        <nav className="nv-nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n} href="#" className="nv-a">
              {n}
            </a>
          ))}
          <span className="nv-menu">
            <button type="button" className={open ? 'nv-a is-open' : 'nv-a'} aria-expanded={open}>
              Community
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden className="nv-chev">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {open ? (
              <div className="nv-pop">
                {COMMUNITY.map(([label, meta, d]) => (
                  <a href="#" key={label}>
                    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {label}
                    <span>{meta}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </span>
        </nav>

        <span className="nv-gap" />

        <button type="button" className="nv-login">
          Log in
        </button>
        <button type="button" className="nv-cta">
          Start Trading
        </button>
      </div>
    </header>
  );
}

function Page(): ReactElement {
  return (
    <div className="nv-page" aria-hidden>
      <h1>
        It watches
        <br />
        so you don’t.
      </h1>
      <p>Write one sentence. The agent reads every block and comes back when it is true.</p>
    </div>
  );
}

export function NavSheet(): ReactElement {
  return (
    <div className="nvl">
      <style>{SHEET}</style>

      <p className="nvl-head">
        Number one, wordmark out, column at 1400 centred. The rule below the bar shows where the
        column falls: the mark, the headline and the left edge of the paragraph all sit on it.
      </p>

      <div className="nvl-v">
        <h2>Resting</h2>
        <div className="nvl-stage">
          <div className="nv has-guide">
            <Nav />
            <Page />
          </div>
        </div>
      </div>

      <div className="nvl-v">
        <h2>Community open</h2>
        <div className="nvl-stage">
          <div className="nv is-tallpage">
            <Nav open />
            <Page />
          </div>
        </div>
      </div>

      <div className="nvl-v">
        <h2>Past 1400, where the column stops growing</h2>
        <p className="nvl-note">
          The window keeps widening and the column does not. The hairline still reaches both edges,
          because it is the bottom of the chrome rather than the bottom of the column.
        </p>
        <div className="nvl-stage is-wide">
          <div className="nv has-guide">
            <Nav />
            <Page />
          </div>
        </div>
      </div>
    </div>
  );
}

const SHEET = `
.nvl, .nvl * { box-sizing: border-box; }
/*
 * ZOOM BACK TO 1:1.
 *
 * globals.css puts zoom 1.18 on the html element for the terminal, and
 * this route inherits it. Under that, a rule written as 1400px lays out
 * at 1186 and the cap could never be judged: the column measured 1224 on
 * a 1560 window, so the min never even reached its ceiling. Zoom
 * multiplies down the tree, so 1/1.18 here puts the sheet back at true
 * CSS pixels, which is what the landing itself runs at.
 *
 * No backticks in this string, ever. It is inside a template literal and
 * one of them ends the whole stylesheet.
 */
.nvl { zoom: 0.847458; background: #141517; min-height: 118vh; padding: 24px 22px 90px; font-family: var(--sans); }
.nvl-head { margin: 0 0 24px; max-width: 92ch; font-size: 12.5px; line-height: 1.55; color: var(--ink-3); }
.nvl-v { margin-bottom: 28px; }
.nvl-v > h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--ink-1); }
.nvl-note { margin: -4px 0 10px; max-width: 96ch; font-size: 12px; line-height: 1.5; color: var(--ink-3); }
.nvl-stage { border-radius: 12px; overflow: hidden; }

.nv {
  --paper:#FFFFFF; --ink:#0B0E14; --body:#3E4A47; --faint:#8A9591;
  --line:#E9EDEB; --panel:#F4F7F6; --rim:#DDE3E1;
  /* ONE COLUMN, and no media query. 1400 when there is room, the viewport
     minus two 24px gutters when there is not. */
  --col: min(1400px, 100% - 48px);
  background: var(--paper); color: var(--body); font-family: var(--sans); -webkit-font-smoothing: antialiased;
}

/* The hairline is full bleed; the row inside it is the column. */
.nv-bar { border-bottom: 1px solid var(--line); }
.nv-row { display: flex; align-items: center; width: var(--col); margin: 0 auto; height: 68px; }
.nv-gap { flex: 1 1 auto; }

/* The real mark, punched out of a filled box so it can take a colour the
   artwork does not contain. */
.nv-brand { display: inline-flex; align-items: center; flex: none; text-decoration: none; }
.nv-mk { display: block; width: 26px; height: 26px; background: var(--ink);
  -webkit-mask-image: url(/landing/svg/mark.svg); mask-image: url(/landing/svg/mark.svg);
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.nv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* 30px between the mark and the first destination, against 4px between
   the destinations themselves. That gap is the whole reason the mark
   reads as the thing the nav belongs to rather than the first item in it. */
.nv-nav { display: flex; align-items: center; gap: 4px; flex: none; margin-left: 30px; }
.nv-a { display: inline-flex; align-items: center; gap: 5px; padding: 8px 13px; border: 0; border-radius: 9px; background: none; font-family: var(--sans); font-size: 14.5px; letter-spacing: -0.01em; color: var(--body); text-decoration: none; cursor: pointer; transition: color 150ms ease-in-out, background-color 150ms ease-in-out; }
.nv-a:hover, .nv-a.is-open { color: var(--ink); background: var(--panel); }
.nv-chev { color: var(--faint); }
.nv-a:hover .nv-chev, .nv-a.is-open .nv-chev { color: var(--ink); }

.nv-menu { position: relative; display: inline-flex; }
.nv-pop { position: absolute; left: 0; top: calc(100% + 9px); z-index: 3; width: 232px; padding: 6px; border-radius: 13px; background: var(--paper); box-shadow: 0 0 0 1px var(--rim), 0 18px 44px -12px rgba(11,14,20,.22); }
.nv-pop a { display: grid; grid-template-columns: 15px minmax(0,1fr); align-items: center; gap: 4px 11px; padding: 9px 11px; border-radius: 9px; font-size: 13.5px; color: var(--ink); text-decoration: none; transition: background-color 150ms ease-in-out; }
.nv-pop a:hover { background: var(--panel); }
.nv-pop a svg { grid-row: 1 / span 2; color: var(--faint); }
.nv-pop a span { font-size: 11.5px; color: var(--faint); }

.nv-login { border: 0; background: none; padding: 8px 13px; border-radius: 9px; cursor: pointer; font-family: var(--sans); font-size: 14.5px; color: var(--body); transition: color 150ms ease-in-out, background-color 150ms ease-in-out; }
.nv-login:hover { color: var(--ink); background: var(--panel); }
.nv-cta { border: 0; cursor: pointer; height: 36px; margin-left: 10px; padding: 0 17px; border-radius: 9px; background: var(--ink); color: #fff; font-family: var(--sans); font-size: 13.5px; font-weight: 500; transition: transform 180ms ease-in-out; }
.nv-cta:hover { transform: translateY(-1px); }

/* The page takes the same column, which is the whole point of capping. */
.nv-page { width: var(--col); margin: 0 auto; padding: 52px 0 60px; }
.nv-page h1 { margin: 0; font-size: 44px; font-weight: 500; letter-spacing: -0.04em; line-height: .99; color: var(--ink); }
.nv-page p { margin: 16px 0 0; max-width: 44ch; font-size: 14.5px; line-height: 1.5; color: var(--body); }
.nv.is-tallpage .nv-page { padding-top: 128px; }

/* A guide down the column's left edge, for the sheet only. It is not part
   of the design; it is here so the alignment can be checked rather than
   taken on trust. */
.nv.has-guide { position: relative; }
.nv.has-guide::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: var(--col); transform: translateX(-50%); border-left: 1px dashed rgba(94,234,212,.55); border-right: 1px dashed rgba(94,234,212,.55); pointer-events: none; }

/* The third stage is drawn wider than the sheet so the 1400 cap is
   visible: the column stops and the page keeps going. */
.nvl-stage.is-wide { width: 1720px; max-width: none; }
`;

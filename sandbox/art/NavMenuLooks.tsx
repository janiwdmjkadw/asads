'use client';

/*
 * THE TWO NAV MENUS, TWO DIRECTIONS.
 *
 * The wallet surfaces went white because they are ERRANDS: you open
 * one, do a thing, close it. These two are NAVIGATION, which is part of
 * the chrome, and chrome that changes colour when you open it is a
 * different argument. So both directions, for both menus, side by side.
 *
 *   BLACK  — stays in the terminal. Same ground as the nav it hangs
 *            off, fixed where it was actually wrong.
 *   WHITE  — the Flash palette, matching the wallet dropdown that hangs
 *            off the pill two positions along.
 *
 * ── WHAT IS FIXED IN BOTH ────────────────────────────────────────────
 *
 * TODAY / YESTERDAY / GO TO were uppercase with 0.1em tracking, which
 * is the loudest type treatment in the product spent on the quietest
 * words on the panel. They are sentence case at ink-3.
 *
 * THE UNREAD MARK was a 4px dot in the same grey as the timestamp, so
 * read and unread rows were the same picture. Unread now holds full ink
 * on its title and keeps the dot; read rows drop a step.
 *
 * THE PROFILE HEADER was a 44px avatar over two lines of copy inside a
 * panel 300px wide, which is a poster where a menu should be. The
 * identity is one row, and the actions start immediately.
 */

import type { ReactElement } from 'react';

const NOTIS: ReadonlyArray<readonly [string, string, string, boolean, string]> = [
  ['Order filled', 'Bought 1,294 WIF for 2.4 SOL', '4m', true, 'Today'],
  ['Conditional armed', 'Watching market cap on POPCAT', '4h', true, 'Today'],
  ['Conditional triggered', 'Market cap crossed 250K, order sent', '8h', false, 'Yesterday'],
  ['Deposit received', '4.0 SOL landed in your wallet', '12h', false, 'Yesterday'],
];

const LINKS: ReadonlyArray<readonly [string, string]> = [
  ['Portfolio', 'M4 13h5v7H4zM10 6h5v14h-5zM16 10h5v10h-5z'],
  ['Edit profile', 'M4 20h4l10-10-4-4L4 16zM14 6l4 4'],
  ['Account and security', 'M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z'],
  ['Sign out', 'M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 12h11M16 8l4 4-4 4'],
];

function Notis({ skin }: { readonly skin: string }): ReactElement {
  let day = '';
  return (
    <div className={`nm nm-${skin}`}>
      <header>
        <h3>Notifications</h3>
        <button type="button" className="nm-quiet">
          Clear all
        </button>
      </header>
      <div className="nm-list">
        {NOTIS.map(([title, body, when, unread, group]) => {
          const head = group === day ? null : group;
          day = group;
          return (
            <div key={title}>
              {head === null ? null : <p className="nm-day">{head}</p>}
              <div className={unread ? 'nm-n is-unread' : 'nm-n'}>
                <span className="nm-dot" aria-hidden />
                <div>
                  <p className="nm-t">{title}</p>
                  <p className="nm-b">{body}</p>
                </div>
                <span className="nm-when">{when}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Profile({ skin }: { readonly skin: string }): ReactElement {
  return (
    <div className={`nm nm-${skin} is-profile`}>
      <div className="nm-id">
        <span className="nm-av" aria-hidden />
        <div>
          <p className="nm-t">Set up your profile</p>
          <p className="nm-b">Claim your handle and pick your art</p>
        </div>
      </div>
      <div className="nm-links">
        {LINKS.map(([label, d]) => (
          <button type="button" key={label} className="nm-link">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const SET: ReadonlyArray<readonly [string, string, ReactElement]> = [
  ['Notifications, black', 'Stays in the chrome. Sentence case, unread carries ink.', <Notis key="a" skin="black" />],
  ['Notifications, white', 'The wallet dropdown’s palette, two positions along the nav.', <Notis key="b" skin="white" />],
  ['Profile, black', 'Identity as one row, then the four places to go.', <Profile key="c" skin="black" />],
  ['Profile, white', 'The same, in the Flash palette.', <Profile key="d" skin="white" />],
];

export function NavMenuLooks(): ReactElement {
  return (
    <div className="nml">
      <style>{SHEET}</style>
      {SET.map(([name, note, node], i) => (
        <div className="nml-v" key={name}>
          <h2>
            <b>{i + 1}</b>
            {name}
          </h2>
          <p className="nml-note">{note}</p>
          {node}
        </div>
      ))}
    </div>
  );
}

const SHEET = `
.nml, .nml * { box-sizing: border-box; font-family: var(--sans); }
.nml { background: #000; min-height: 100vh; padding: 36px 26px 100px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 30px; align-items: start; }
.nml-v > h2 { margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink-2); }
.nml-v > h2 b { font-size: 12px; font-weight: 600; color: var(--ink-3); }
.nml-note { margin: 0 0 12px; font-size: 12px; color: var(--ink-3); }

/* ── the shell ── */
.nm { width: 300px; border-radius: 14px; overflow: hidden; padding: 6px; }
.nm header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 10px 12px; }
.nm h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.014em; }
.nm-quiet { border: 0; background: none; padding: 0; font-family: var(--sans); font-size: 12px; cursor: pointer; }

/* Sentence case, not the loudest type on the panel spent on the
   quietest word. */
.nm-day { margin: 10px 0 4px; padding: 0 10px; font-size: 11px; }

.nm-n { display: grid; grid-template-columns: 6px minmax(0,1fr) auto; align-items: start; gap: 10px; padding: 9px 10px; border-radius: 9px; cursor: pointer; }
.nm-dot { width: 5px; height: 5px; margin-top: 5px; border-radius: 999px; background: transparent; }
.nm-t { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: -0.008em; }
.nm-b { margin: 3px 0 0; font-size: 11.5px; line-height: 1.45; }
.nm-when { font-size: 11px; font-variant-numeric: tabular-nums; }

/* ── the profile ── */
.nm.is-profile { padding: 6px; }
.nm-id { display: flex; align-items: center; gap: 11px; padding: 12px 10px 14px; }
.nm-av { flex: none; width: 34px; height: 34px; border-radius: 10px; }
.nm-links { display: flex; flex-direction: column; }
.nm-link { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; text-align: left; cursor: pointer; padding: 9px 10px; border-radius: 9px; font-family: var(--sans); font-size: 13px; }
.nm-link svg { width: 14px; height: 14px; flex: none; }

/* ══ BLACK ══ stays in the terminal chrome ══════════════════════════ */
.nm-black { background: #08080A; box-shadow: 0 0 0 1px rgba(255,255,255,0.09), 0 24px 60px #000000cc; color: var(--ink-1); }
.nm-black h3 { color: var(--ink-0); }
.nm-black .nm-quiet { color: var(--ink-3); }
.nm-black .nm-quiet:hover { color: var(--ink-0); }
.nm-black .nm-day { color: var(--ink-3); }
.nm-black .nm-n:hover { background: rgba(255,255,255,0.05); }
.nm-black .nm-t { color: var(--ink-2); }
.nm-black .nm-b { color: var(--ink-3); }
.nm-black .nm-when { color: var(--ink-4); }
/* Unread is the only row that holds full ink, and it keeps the dot. */
.nm-black .is-unread .nm-t { color: var(--ink-0); }
.nm-black .is-unread .nm-dot { background: var(--ink-0); }
.nm-black .nm-av { background: linear-gradient(135deg, #2b2f3a, #14161c); }
.nm-black .nm-link { color: var(--ink-2); }
.nm-black .nm-link:hover { background: rgba(255,255,255,0.05); color: var(--ink-0); }
.nm-black .nm-links { border-top: 1px solid rgba(255,255,255,0.07); padding-top: 6px; }

/* ══ WHITE ══ the wallet dropdown's palette ═════════════════════════ */
.nm-white { background: #FFFFFF; box-shadow: 0 0 0 1px #D3DAD8, 0 24px 60px #00000066; color: #3E4A47; }
.nm-white h3 { color: #0B0E14; }
.nm-white .nm-quiet { color: #3E4A47; }
.nm-white .nm-quiet:hover { color: #0B0E14; }
.nm-white .nm-day { color: #8A9591; }
.nm-white .nm-n:hover { background: #E8ECEA; }
.nm-white .nm-t { color: #3E4A47; }
.nm-white .nm-b { color: #8A9591; }
.nm-white .nm-when { color: #B6BFBC; }
.nm-white .is-unread .nm-t { color: #0B0E14; }
.nm-white .is-unread .nm-dot { background: #134E4A; }
.nm-white .nm-av { background: linear-gradient(135deg, #cbd3d0, #e8ecea); }
.nm-white .nm-link { color: #3E4A47; }
.nm-white .nm-link:hover { background: #E8ECEA; color: #0B0E14; }
.nm-white .nm-links { border-top: 1px solid #E1E6E4; padding-top: 6px; }
`;

'use client';

import { useState, type ReactNode } from 'react';
import './tracker-controls.css';

/* Import · Tracked · Settings, as buttons. Then the dropdown card. */

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const Tray = <svg viewBox="0 0 24 24" {...S}><path d="M12 3.5v9M12 12.5 8.5 9M12 12.5 15.5 9" /><path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" /></svg>;
const Caret = <svg viewBox="0 0 24 24" {...S} strokeWidth={2.4} className="caret"><path d="M6 9.5l6 6 6-6" /></svg>;
const Stack = <svg viewBox="0 0 24 24" {...S}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
const Gear = (
  <svg viewBox="0 0 24 24" {...S} strokeWidth={1.6}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12.2 2.4h-.4a1.9 1.9 0 0 0-1.9 1.9v.2a1.9 1.9 0 0 1-1 1.6l-.4.3a1.9 1.9 0 0 1-1.9 0l-.2-.1a1.9 1.9 0 0 0-2.6.7l-.2.4a1.9 1.9 0 0 0 .7 2.6l.2.1a1.9 1.9 0 0 1 .9 1.6v.5a1.9 1.9 0 0 1-.9 1.6l-.2.1a1.9 1.9 0 0 0-.7 2.6l.2.4a1.9 1.9 0 0 0 2.6.7l.2-.1a1.9 1.9 0 0 1 1.9 0l.4.3a1.9 1.9 0 0 1 1 1.6v.2a1.9 1.9 0 0 0 1.9 1.9h.4a1.9 1.9 0 0 0 1.9-1.9v-.2a1.9 1.9 0 0 1 1-1.6l.4-.3a1.9 1.9 0 0 1 1.9 0l.2.1a1.9 1.9 0 0 0 2.6-.7l.2-.4a1.9 1.9 0 0 0-.7-2.6l-.2-.1a1.9 1.9 0 0 1-.9-1.6v-.5a1.9 1.9 0 0 1 .9-1.6l.2-.1a1.9 1.9 0 0 0 .7-2.6l-.2-.4a1.9 1.9 0 0 0-2.6-.7l-.2.1a1.9 1.9 0 0 1-1.9 0l-.4-.3a1.9 1.9 0 0 1-1-1.6v-.2a1.9 1.9 0 0 0-1.9-1.9z" />
  </svg>
);
const Sliders = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12" />
    <circle cx="16" cy="7" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="17" r="2" />
  </svg>
);
const Columns = <svg viewBox="0 0 24 24" {...S}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15M15 4.5v15" /></svg>;
const Find = <svg viewBox="0 0 24 24" {...S}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
const Cross = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;

const WALLETS = [
  { emoji: '🐷', name: 'whale one', addr: '7xKX…gAsU' },
  { emoji: '🦈', name: 'dev wallet', addr: 'Trak…BBBB' },
  { emoji: '🐸', name: 'kessel', addr: 'msDK…Dunh' },
  { emoji: '🦊', name: 'Trak…BBBB', addr: 'B8zc…RMDi' },
];

function One({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <span className="tcv-one">
      {children}
      <small>{tag}</small>
    </span>
  );
}

function useOpen() {
  const [open, setOpen] = useState(false);
  return { on: open ? '' : undefined, toggle: () => setOpen((p) => !p) };
}

export function TrackerControls() {
  const t = [useOpen(), useOpen(), useOpen(), useOpen(), useOpen()];
  const g = [useOpen(), useOpen(), useOpen(), useOpen(), useOpen()];

  return (
    <div className="tcv">
      <h2>Track — settled</h2>
      <div className="tcv-set">
        <One tag="white plate">
          <button type="button" className="b-plate">Track</button>
        </One>
      </div>

      <h2>Import</h2>
      <div className="tcv-set">
        <One tag="A · ghost"><button type="button" className="x i-ghost">Import</button></One>
        <One tag="B · pill"><button type="button" className="x i-pill">Import</button></One>
        <One tag="C · slab"><button type="button" className="x i-slab">Import</button></One>
        <One tag="D · square, mark only"><button type="button" className="x i-sq" aria-label="Import">{Tray}</button></One>
        <One tag="E · mark and word"><button type="button" className="x i-mark">{Tray}Import</button></One>
      </div>

      <h2>Tracked</h2>
      <div className="tcv-set">
        <One tag="A · the number alone">
          <button type="button" className="x t-bare" data-open={t[0]!.on} onClick={t[0]!.toggle} aria-label="4 tracked">
            4{Caret}
          </button>
        </One>
        <One tag="B · the wallets themselves">
          <button type="button" className="x t-faces" data-open={t[1]!.on} onClick={t[1]!.toggle}>
            <span>
              {WALLETS.map((w) => (
                <u key={w.name}>{w.emoji}</u>
              ))}
            </span>
            {Caret}
          </button>
        </One>
        <One tag="C · one name, and the rest">
          <button type="button" className="x t-lead" data-open={t[2]!.on} onClick={t[2]!.toggle}>
            whale one
            <em>+3</em>
            {Caret}
          </button>
        </One>
        <One tag="D · one mark, badged">
          <button type="button" className="x t-badge" data-open={t[3]!.on} onClick={t[3]!.toggle} aria-label="4 tracked">
            🐷
            <em>4</em>
          </button>
        </One>
        <One tag="E · a word you press">
          <button type="button" className="x t-link" data-open={t[4]!.on} onClick={t[4]!.toggle}>
            4 wallets{Caret}
          </button>
        </One>
      </div>

      <h2>Settings</h2>
      <div className="tcv-set">
        <One tag="A · square ring"><button type="button" className="x g-sq" data-open={g[0]!.on} onClick={g[0]!.toggle} aria-label="Columns">{Gear}</button></One>
        <One tag="B · slab"><button type="button" className="x g-slab" data-open={g[1]!.on} onClick={g[1]!.toggle} aria-label="Columns">{Sliders}</button></One>
        <One tag="C · round"><button type="button" className="x g-round" data-open={g[2]!.on} onClick={g[2]!.toggle} aria-label="Columns">{Gear}</button></One>
        <One tag="D · ghost"><button type="button" className="x g-ghost" data-open={g[3]!.on} onClick={g[3]!.toggle} aria-label="Columns">{Columns}</button></One>
        <One tag="E · named"><button type="button" className="x g-word" data-open={g[4]!.on} onClick={g[4]!.toggle}>{Columns}Columns</button></One>
      </div>

      <h2>The dropdown</h2>
      <div className="tcv-set">
        <One tag="A · pills">
          <div className="pop">
            <div className="pop-pills">
              {WALLETS.map((w) => (
                <button type="button" className="pill" key={w.name}>
                  <span>{w.name}</span>
                  <i>{Cross}</i>
                </button>
              ))}
            </div>
          </div>
        </One>

        <One tag="B · list, address">
          <div className="pop">
            <div className="pop-list">
              {WALLETS.map((w) => (
                <button type="button" className="li" key={w.name}>
                  <b>{w.name}</b>
                  <s>{w.addr}</s>
                  <i>{Cross}</i>
                </button>
              ))}
            </div>
          </div>
        </One>

        <One tag="C · ruled, with marks">
          <div className="pop">
            <div className="pop-ruled">
              {WALLETS.map((w) => (
                <button type="button" className="li" key={w.name}>
                  <u>{w.emoji}</u>
                  <b>{w.name}</b>
                  <i>{Cross}</i>
                </button>
              ))}
            </div>
          </div>
        </One>

        <One tag="D · headed">
          <div className="pop">
            <div className="pop-head">
              <span>4 tracked</span>
              <button type="button">Remove all</button>
            </div>
            <div className="pop-list">
              {WALLETS.map((w) => (
                <button type="button" className="li" key={w.name}>
                  <b>{w.name}</b>
                  <i>{Cross}</i>
                </button>
              ))}
            </div>
          </div>
        </One>

        <One tag="E · searchable">
          <div className="pop">
            <div className="pop-find">
              {Find}
              Find a wallet…
            </div>
            <div className="pop-list">
              {WALLETS.map((w) => (
                <button type="button" className="li" key={w.name}>
                  <u>{w.emoji}</u>
                  <b>{w.name}</b>
                  <i>{Cross}</i>
                </button>
              ))}
            </div>
          </div>
        </One>
      </div>
    </div>
  );
}

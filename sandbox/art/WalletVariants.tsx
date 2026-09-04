'use client';

import { useState } from 'react';
import './wallet-variants.css';

/*
 * ── THE WALLET POPUP, SIX WAYS — AT FULL SIZE ────────────────────────
 *
 * The shipping modal is a DOSSIER: it takes most of the window, it has
 * a rainbow edge, coloured section ticks, a PnL panel, a positions
 * ledger and a credit line. The first pass at these variants shrank it
 * to a 420px card and drained the colour out, which lost the two things
 * that make it feel like something rather than a tooltip.
 *
 * So: every one of these is the real object at the real width, with
 * colour kept and spent on purpose — the confetti, the direction hues,
 * and one tinted surface per card. What changes between them is the
 * arrangement and where the weight sits.
 */

const CELLS: ReadonlyArray<{ x: number; y: number; c: string; d: string }> = [
  { x: 4, y: 0, c: '#f052d2', d: '0s' },
  { x: 8, y: 0, c: '#8b5cf6', d: '1.4s' },
  { x: 0, y: 4, c: '#fbbf24', d: '2.6s' },
  { x: 4, y: 4, c: '#37d67a', d: '0.8s' },
  { x: 8, y: 4, c: '#38bdf8', d: '2s' },
];

const HUES = CELLS.map((c) => c.c);

function Mosaic({ scale = 1 }: { scale?: number }) {
  return (
    <span className="wv-mosaic" style={{ width: 11 * scale, height: 7 * scale }} aria-hidden>
      {CELLS.map((c) => (
        <i
          key={`${c.x}-${c.y}`}
          style={{
            left: c.x * scale,
            top: c.y * scale,
            width: 3 * scale,
            height: 3 * scale,
            background: c.c,
            boxShadow: `0 0 ${5 * scale}px color-mix(in srgb, ${c.c} 70%, transparent)`,
            animationDelay: c.d,
          }}
        />
      ))}
    </span>
  );
}

/* Listen's five, stretched into a rule. */
function Band() {
  return (
    <span className="wv-band" aria-hidden>
      {HUES.map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
    </span>
  );
}

/* A drawn PnL curve. Not a real series — the SHAPE of one, so the panel
   can be judged with something in it. */
function Curve({ tone = 'down' }: { tone?: 'up' | 'down' }) {
  const stroke = tone === 'up' ? '#22c77e' : '#f0567a';
  const d =
    tone === 'up'
      ? 'M0 46 L26 40 L52 43 L78 30 L104 34 L130 20 L156 24 L182 10 L208 14 L234 4'
      : 'M0 8 L26 14 L52 10 L78 24 L104 19 L130 32 L156 28 L182 40 L208 36 L234 48';
  return (
    <svg className="wv-curve" viewBox="0 0 234 52" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`wvg-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L234 52 L0 52 Z`} fill={`url(#wvg-${tone})`} stroke="none" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ADDR = 'fR9qL8mYcNBqiior9gYjKpW2vTzDseVhNrbXumEnaL1';
const SHORT = 'fR9qL8mYcNBqiior9gYj…XumEnaL1';

function Ranges({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const [on, setOn] = useState('MAX');
  return (
    <span className={size === 'sm' ? 'wv-ranges is-sm' : 'wv-ranges'}>
      {['1D', '7D', '30D', 'MAX'].map((r) => (
        <button key={r} type="button" data-on={on === r ? '' : undefined} onClick={() => setOn(r)}>
          {r}
        </button>
      ))}
    </span>
  );
}

function Tabs() {
  const [on, setOn] = useState('Positions');
  return (
    <div className="wv-tabs">
      {['Positions', 'History', 'Top 100', 'Activity'].map((t) => (
        <button key={t} type="button" data-on={on === t ? '' : undefined} onClick={() => setOn(t)}>
          {t}
          {t === 'Top 100' ? <em>👑</em> : null}
        </button>
      ))}
    </div>
  );
}

const ROWS: ReadonlyArray<{ t: string; b: string; s: string; r: string; p: string; up: boolean }> = [
  { t: 'FINN', b: '2.41 SOL', s: '1.80 SOL', r: '58.2M', p: '-12.4%', up: false },
  { t: 'WIF', b: '0.84 SOL', s: '1.19 SOL', r: '0', p: '+41.6%', up: true },
  { t: 'POPCAT', b: '1.02 SOL', s: '0.61 SOL', r: '12.4M', p: '-8.1%', up: false },
  { t: 'GOAT', b: '0.30 SOL', s: '0.55 SOL', r: '0', p: '+83.2%', up: true },
];

function Ledger({ rows = 4 }: { rows?: number }) {
  return (
    <div className="wv-ledger">
      <div className="wv-lrow is-head">
        <span>Token</span>
        <span>Bought</span>
        <span>Sold</span>
        <span>Remaining</span>
        <span>PnL</span>
      </div>
      {ROWS.slice(0, rows).map((r) => (
        <div className="wv-lrow" key={r.t}>
          <span className="wv-tok">
            <i />
            {r.t}
          </span>
          <span>{r.b}</span>
          <span>{r.s}</span>
          <span>{r.r}</span>
          <span data-tone={r.up ? 'up' : 'down'}>{r.p}</span>
        </div>
      ))}
    </div>
  );
}

function Foot() {
  return (
    <footer className="wv-foot">
      <span className="wv-foot-px" aria-hidden>
        {HUES.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </span>
      pump.fun activity seen by listen · cost-basis PnL
    </footer>
  );
}

function Ident({ big = false }: { big?: boolean }) {
  return (
    <>
      <span className={big ? 'wv-av is-lg' : 'wv-av'}>
        <Mosaic scale={big ? 1.6 : 1} />
      </span>
      <span className="wv-id">
        <b>Rename to track</b>
        <code>{big ? ADDR : SHORT}</code>
      </span>
    </>
  );
}

function Tile({ id, name, note, children }: { id: string; name: string; note: string; children: React.ReactNode }) {
  return (
    <div className="wv-tile">
      <div className="wv-modal" data-v={id}>{children}</div>
      <span className="wv-name">
        {id} · {name}
        <em>{note}</em>
      </span>
    </div>
  );
}

export function WalletVariants() {
  return (
    <div className="wv">
      <div className="wv-stack">
        {/* ── A ── The dossier, kept. Three sections across the top with
            their coloured ticks, the curve in the middle one, the ledger
            below. Same bones as what ships; the type is the page's and
            the colour is spent on the ticks and the figures only. */}
        <Tile id="A" name="Dossier" note="the current arrangement, in the page's type">
          <Band />
          <header className="wv-head">
            <Ident />
            <span className="wv-gap" />
            <Ranges />
            <button type="button" className="wv-x" aria-label="Close">×</button>
          </header>
          <div className="wv-sections">
            <section>
              <h4><i style={{ background: HUES[3] }} />Balance</h4>
              <b>13.37 SOL</b>
              <em>$3,370 · first seen 4mo ago</em>
              <span className="wv-sub">
                <span><i>Holding</i>58.2M</span>
                <span><i>Supply</i>5.82%</span>
              </span>
            </section>
            <section className="is-mid">
              <h4><i style={{ background: HUES[0] }} />Realised PnL</h4>
              <b data-tone="down">-0.585 SOL</b>
              <em>-628% · 17 trades analysed</em>
              <Curve />
            </section>
            <section>
              <h4><i style={{ background: HUES[4] }} />Performance</h4>
              <span className="wv-bars">
                {[
                  { k: '>500%', v: 4, c: '#22c77e' },
                  { k: '200–500%', v: 12, c: '#37d67a' },
                  { k: '0–200%', v: 35, c: '#8ee6a8' },
                  { k: '0 – -50%', v: 28, c: '#f0567a' },
                  { k: '< -50%', v: 21, c: '#c0334f' },
                ].map((b) => (
                  <span key={b.k}>
                    <i>{b.k}</i>
                    <u><s style={{ width: `${b.v * 2}%`, background: b.c }} /></u>
                    <b>{b.v}%</b>
                  </span>
                ))}
              </span>
            </section>
          </div>
          <Tabs />
          <Ledger />
          <Foot />
        </Tile>

        {/* ── B ── The PnL becomes the surface, not a column. A tinted
            panel the width of the card, the curve behind the number, and
            the rest of the figures as a ruled band under it. */}
        <Tile id="B" name="Hero" note="the number you opened it for, at the size you opened it for">
          <header className="wv-head">
            <Ident />
            <span className="wv-gap" />
            <Ranges />
            <button type="button" className="wv-x" aria-label="Close">×</button>
          </header>
          <div className="wv-hero" data-tone="down">
            <Curve />
            <span className="wv-hero-in">
              <i>Realised PnL · MAX</i>
              <b data-tone="down">-0.585 SOL</b>
              <em data-tone="down">-628%</em>
            </span>
          </div>
          <div className="wv-band-stats">
            <span><i>Balance</i><b>13.37 SOL</b><em>$3,370</em></span>
            <span><i>Holding</i><b>58.2M</b><em>5.82% supply</em></span>
            <span><i>Win rate</i><b>41%</b><em>7 of 17</em></span>
            <span><i>First seen</i><b>4mo</b><em>via Robinhood</em></span>
          </div>
          <Tabs />
          <Ledger />
          <Foot />
        </Tile>

        {/* ── C ── A rail down the left for identity, the whole right for
            figures. The rail is where the colour lives: big mosaic, the
            avatar ringed in it, the range under. */}
        <Tile id="C" name="Rail" note="identity on a coloured rail, figures on the right">
          <div className="wv-split">
            <aside>
              <Ident big />
              <Ranges size="sm" />
              <span className="wv-rail-stats">
                <span><i>First seen</i>4mo ago</span>
                <span><i>Funded by</i>Robinhood</span>
                <span><i>Trades</i>17</span>
              </span>
            </aside>
            <div className="wv-right">
              <div className="wv-cards">
                <span className="wv-card" data-hue="0">
                  <i>Balance</i>
                  <b>13.37 SOL</b>
                  <em>$3,370</em>
                </span>
                <span className="wv-card" data-hue="1">
                  <i>Realised</i>
                  <b data-tone="down">-0.585</b>
                  <em>-628%</em>
                </span>
                <span className="wv-card" data-hue="2">
                  <i>Holding</i>
                  <b>58.2M</b>
                  <em>5.82%</em>
                </span>
                <span className="wv-card" data-hue="3">
                  <i>Win rate</i>
                  <b>41%</b>
                  <em>7 of 17</em>
                </span>
              </div>
              <Tabs />
              <Ledger rows={3} />
            </div>
          </div>
          <Foot />
        </Tile>

        {/* ── D ── The curve runs the full width as a header, with the
            identity sitting on it. The most graphic of the six. */}
        <Tile id="D" name="Chart head" note="the curve is the header">
          <div className="wv-charthead">
            <Curve />
            <header className="wv-head is-over">
              <Ident />
              <span className="wv-gap" />
              <Ranges />
              <button type="button" className="wv-x" aria-label="Close">×</button>
            </header>
            <span className="wv-charthead-n">
              <b data-tone="down">-0.585 SOL</b>
              <i>-628% realised</i>
            </span>
          </div>
          <div className="wv-band-stats">
            <span><i>Balance</i><b>13.37 SOL</b><em>$3,370</em></span>
            <span><i>Holding</i><b>58.2M</b><em>5.82% supply</em></span>
            <span><i>Win rate</i><b>41%</b><em>7 of 17</em></span>
            <span><i>Funded by</i><b>Robinhood</b><em>4mo ago</em></span>
          </div>
          <Tabs />
          <Ledger />
          <Foot />
        </Tile>

        {/* ── E ── Four tinted cards, each in one of Listen's own colours.
            The confetti taken apart and used as the card's system rather
            than kept in one corner. */}
        <Tile id="E" name="Confetti cards" note="the five colours used as the system">
          <Band />
          <header className="wv-head">
            <Ident />
            <span className="wv-gap" />
            <Ranges />
            <button type="button" className="wv-x" aria-label="Close">×</button>
          </header>
          <div className="wv-cards is-4">
            <span className="wv-card is-tinted" data-hue="0">
              <i>Balance</i>
              <b>13.37 SOL</b>
              <em>$3,370</em>
            </span>
            <span className="wv-card is-tinted" data-hue="1">
              <i>Realised PnL</i>
              <b data-tone="down">-0.585</b>
              <em>-628%</em>
            </span>
            <span className="wv-card is-tinted" data-hue="2">
              <i>Holding</i>
              <b>58.2M</b>
              <em>5.82% of supply</em>
            </span>
            <span className="wv-card is-tinted" data-hue="4">
              <i>Win rate</i>
              <b>41%</b>
              <em>7 of 17 trades</em>
            </span>
          </div>
          <Tabs />
          <Ledger />
          <Foot />
        </Tile>

        {/* ── F ── One bar of identity and figures, then the ledger takes
            the whole card. For when you opened this to read positions. */}
        <Tile id="F" name="Ledger first" note="one bar, then rows all the way down">
          <header className="wv-bar">
            <Ident />
            <span className="wv-gap" />
            <span className="wv-inline">
              <span><i>Bal</i>13.37 SOL</span>
              <span><i>PnL</i><b data-tone="down">-0.585</b></span>
              <span><i>Win</i>41%</span>
            </span>
            <Ranges size="sm" />
            <button type="button" className="wv-x" aria-label="Close">×</button>
          </header>
          <Tabs />
          <Ledger />
          <Foot />
        </Tile>
      </div>
    </div>
  );
}

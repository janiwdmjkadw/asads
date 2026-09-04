'use client';

import type { ReactNode } from 'react';
import './split-variants.css';

/*
 * ── THE THREE WAY SPLIT — FIVE WAYS ──────────────────────────────────
 *
 * SOL, stablecoins, everything else. It sits between the wallet filter
 * and the holdings tape, and the open question is not how it looks but
 * whether it earns the room: the total above already says what the book
 * is worth, and the tape below already lists every position.
 *
 * So one of the five is the block removed.
 *
 * Each is shown in the gap it actually occupies — the rule above it and
 * the head of the holdings below — because a block like this is judged
 * by what it costs the page, not on its own.
 */

const CUTS = [
  { k: 'SOL', usd: '$8,860.44', pct: 44.0, ink: '0.8' },
  { k: 'Stablecoins', usd: '$2,140.50', pct: 10.6, ink: '0.5' },
  { k: 'Tokens', usd: '$9,141.72', pct: 45.4, ink: '0.3' },
];

/* Bars scale to the largest cut, not to 100 — at portfolio scale the
   stables draw a stub and compare against nothing. */
const TOP = 45.4;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="sp">
      <div className="sp-rule" />
      {children}
      <div className="sp-after">
        <b>Holdings</b>
        <small>6 tokens</small>
      </div>
      <div className="sp-tr">
        <span className="sp-art" />
        <span>
          <span className="sp-tick">SOL</span> <span className="sp-sub">Solana</span>
        </span>
        <span className="sp-bar2">
          <span style={{ width: '100%' }} />
        </span>
        <span className="sp-dim">44.1%</span>
        <span className="sp-num">$8,860.37</span>
        <span className="sp-num" style={{ color: 'var(--up)', fontSize: 12 }}>
          +3.20%
        </span>
      </div>
      <div className="sp-tr">
        <span className="sp-art" />
        <span>
          <span className="sp-tick">MEW</span> <span className="sp-sub">cat in a dogs world</span>
        </span>
        <span className="sp-bar2">
          <span style={{ width: '44%' }} />
        </span>
        <span className="sp-dim">19.5%</span>
        <span className="sp-num">$3,873.26</span>
        <span className="sp-num" style={{ color: 'var(--down)', fontSize: 12 }}>
          −2.10%
        </span>
      </div>
    </div>
  );
}

function Slot({ n, name, note, children }: { n: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="sv-slot">
      <div className="sv-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      <Frame>{children}</Frame>
    </div>
  );
}

export function SplitVariants(): React.ReactElement {
  return (
    <section className="sv">
      <h2>The three way split</h2>
      <p className="sv-note">
        SOL, stablecoins, everything else — the block between the wallet filter and the holdings.
        Each one is shown in the gap it occupies, with the rule above and the head of the tape
        below, because what it costs the page is the actual question. Number five is the block
        removed.
      </p>

      <div className="sv-stack">
        <Slot n={1} name="Columns" note="what ships now">
          <div className="c1">
            {CUTS.map((c) => (
              <span key={c.k}>
                <span className="sp-lab">{c.k}</span>
                <span className="sp-usd">{c.usd}</span>
                <span className="c1-bar">
                  <span style={{ width: `${(c.pct / TOP) * 100}%` }} />
                </span>
                <span className="sp-pct">{c.pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </Slot>

        <Slot n={2} name="One bar" note="the comparison made by the row, not the reader">
          <div>
            <div className="c2-bar">
              {CUTS.map((c) => (
                <span key={c.k} style={{ flex: c.pct, background: `rgba(255,255,255,${c.ink})` }} />
              ))}
            </div>
            <div className="c2-key">
              {CUTS.map((c) => (
                <span key={c.k}>
                  <i style={{ background: `rgba(255,255,255,${c.ink})` }} />
                  <b>{c.k}</b>
                  <u>{c.usd}</u>
                  <u>{c.pct.toFixed(1)}%</u>
                </span>
              ))}
            </div>
          </div>
        </Slot>

        <Slot n={3} name="Line" note="one line, no bars">
          <div className="c3">
            {CUTS.map((c) => (
              <span key={c.k}>
                <span className="sp-lab">{c.k}</span>
                <b>{c.usd}</b>
                <u>{c.pct.toFixed(1)}%</u>
              </span>
            ))}
          </div>
        </Slot>

        <Slot n={4} name="Shares" note="the ratio only; the dollars are said twice already">
          <div className="c4">
            {CUTS.map((c) => (
              <span key={c.k}>
                <span className="sp-lab">{c.k}</span>
                <span className="c4-pct">{c.pct.toFixed(1)}%</span>
                <span className="c4-bar">
                  <span style={{ width: `${(c.pct / TOP) * 100}%` }} />
                </span>
              </span>
            ))}
          </div>
        </Slot>

        <Slot n={5} name="Gone" note="the tape already says what is in the book">
          <div className="c5-none">Nothing here. The rule, then the holdings.</div>
        </Slot>
      </div>
    </section>
  );
}

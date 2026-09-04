'use client';

import { useState, type ReactNode } from 'react';
import './wallets-variants.css';

/*
 * ── THE WALLETS TAB, FOUR WAYS ───────────────────────────────────────
 *
 * Same five wallets, same balances, same actions. What changes is what
 * a wallet IS on the page: a table row, a line of tape, a block, or a
 * thing you pick up.
 *
 * The Spot tab is settled — black, one ink scale, type doing the
 * hierarchy — so all four of these speak that voice already. The
 * question left is structure, and the second question underneath it is
 * what happens to the transfer rail, which currently takes half the tab
 * to hold two empty boxes.
 *
 * See `wallets-variants.css` for what the tab does today.
 */

interface W {
  id: string;
  name: string;
  addr: string;
  sol: string;
  share: number;
  tokens: number;
  pip: string;
  agent?: boolean;
}

const WALLETS: W[] = [
  { id: 'a', name: 'Main', addr: '7xKX…9fQa', sol: '41.28', share: 100, tokens: 6, pip: '#37d67a' },
  { id: 'b', name: 'Degen box', addr: 'B4mR…2Ttz', sol: '18.94', share: 46, tokens: 11, pip: '#38bdf8' },
  { id: 'c', name: 'Cold storage', addr: 'Hq2V…LmP1', sol: '12.06', share: 29, tokens: 2, pip: '#f052d2' },
  { id: 'd', name: 'Wallet 4', addr: '9dTe…kk3W', sol: '3.41', share: 8, tokens: 4, pip: '#fbbf24' },
  { id: 'e', name: 'Agent', addr: 'Ag7P…xR4c', sol: '0.92', share: 2, tokens: 0, pip: '#8b5cf6', agent: true },
];

const TOTAL = '76.61';

/* ── marks ─────────────────────────────────────────────────────────── */

function Sol({ dim = false }: { dim?: boolean }) {
  return (
    <svg
      width="9"
      height="8"
      viewBox="0 0 24 21"
      style={{ display: 'inline-block', marginRight: 3, verticalAlign: '-0.5px' }}
      aria-hidden
    >
      <path
        d="M4.3 15.6h17.2c.4 0 .6.5.3.8l-3.9 3.9a.6.6 0 0 1-.4.2H.3c-.4 0-.6-.5-.3-.8l3.9-3.9a.6.6 0 0 1 .4-.2ZM4.3 0h17.2c.4 0 .6.5.3.8l-3.9 3.9a.6.6 0 0 1-.4.2H.3c-.4 0-.6-.5-.3-.8L3.9.2A.6.6 0 0 1 4.3 0ZM17.9 7.8H.7c-.4 0-.6.5-.3.8l3.9 3.9a.6.6 0 0 0 .4.2h17.2c.4 0 .6-.5.3-.8l-3.9-3.9a.6.6 0 0 0-.4-.2Z"
        fill={dim ? 'var(--ink-3)' : 'currentColor'}
      />
    </svg>
  );
}

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Icons() {
  return (
    <span className="w1-icons">
      <svg viewBox="0 0 24 24" {...I} aria-hidden>
        <path d="M12 3v14M7 12l5 5 5-5" />
      </svg>
      <svg viewBox="0 0 24 24" {...I} aria-hidden>
        <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
      </svg>
      <svg viewBox="0 0 24 24" {...I} aria-hidden>
        <path d="M4 20h4l10-10-4-4L4 16z" />
      </svg>
      <svg viewBox="0 0 24 24" {...I} aria-hidden>
        <rect x="9" y="9" width="11" height="11" rx="2.5" />
        <path d="M15 5.5H6.5A2.5 2.5 0 0 0 4 8v8" />
      </svg>
    </span>
  );
}

/** The three actions a wallet has, said in words. */
function Tools({ className = '' }: { className?: string }) {
  return (
    <span className={`wp-tools ${className}`}>
      <button type="button">Rename</button>
      <button type="button">Copy</button>
      <button type="button">Archive</button>
    </span>
  );
}

function Top({ children }: { children?: ReactNode }) {
  return (
    <div className="wp-top">
      <span className="wp-count">
        5 wallets <s>·</s>{' '}
        <Sol />
        {TOTAL}
      </span>
      <span className="wp-sp" />
      {children}
    </div>
  );
}

function Slot({ n, name, note, children }: { n: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="wv-slot">
      <div className="wv-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      {children}
    </div>
  );
}

/* ══ 1 · TABLE ════════════════════════════════════════════════════ */

function Table() {
  return (
    <div className="wp">
      <div className="wp-top">
        <span className="wp-count">3 wallets active</span>
        <span className="wp-sp" />
        <input className="wp-find" placeholder="Search by name or address" readOnly />
        <button type="button" className="wp-act">
          Show archived
        </button>
        <button type="button" className="wp-act">
          Import
        </button>
      </div>

      <div className="w1h">
        <span />
        <span>Wallet</span>
        <span>Balance</span>
        <span>Holdings</span>
        <span>Actions</span>
      </div>

      {WALLETS.map((w) => (
        <div className="w1r" key={w.id}>
          <span className="w1-box" />
          <span className="w1-who">
            <span className="w1-pip" style={{ background: w.pip }} />
            <span className="w1-name">{w.name}</span>
            <span className="wp-addr">{w.addr}</span>
          </span>
          <span className="wp-bal">
            <Sol />
            {w.sol}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="w1-sw" data-on={w.tokens > 0 ? '' : undefined} />
            <span className="wp-dim">{w.tokens}</span>
          </span>
          <Icons />
        </div>
      ))}

      <div className="w1-agent">Agent</div>
    </div>
  );
}

/* ══ 2 · TAPE ═════════════════════════════════════════════════════ */

function Tape() {
  return (
    <div className="wp">
      <Top>
        <input className="wp-find" placeholder="Search wallets" readOnly />
        <button type="button" className="wp-act">
          Archived
        </button>
        <button type="button" className="wp-act" data-strong>
          Import
        </button>
      </Top>

      {WALLETS.map((w) => (
        <div className="w2r" key={w.id}>
          <span className="w2-id">
            <span className="w2-name">{w.name}</span>
            <span className="wp-addr">{w.addr}</span>
          </span>
          <span className="w2-bar" aria-hidden>
            <span style={{ width: `${w.share}%` }} />
          </span>
          <span className="w2-bal">
            <Sol />
            {w.sol}
          </span>
          <Tools className="w2-tools" />
        </div>
      ))}
    </div>
  );
}

/* ══ 3 · BLOCKS ═══════════════════════════════════════════════════ */

function Blocks() {
  return (
    <div className="wp">
      <Top>
        <input className="wp-find" placeholder="Search wallets" readOnly />
        <button type="button" className="wp-act" data-strong>
          Import
        </button>
      </Top>

      <div className="w3">
        {WALLETS.map((w) => (
          <div className="w3b" key={w.id}>
            <span className="w3-name">{w.name}</span>
            <span className="w3-bal">
              <Sol />
              {w.sol}
            </span>
            <span className="w3-sub">
              <span>{w.addr}</span>
              <span>
                {w.tokens} {w.tokens === 1 ? 'token' : 'tokens'}
              </span>
              <Tools />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══ 4 · PICK ═════════════════════════════════════════════════════ */

function Pick() {
  const [on, setOn] = useState<ReadonlyArray<string>>(['b', 'd']);
  const toggle = (id: string) =>
    setOn((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="wp">
      <Top>
        <input className="wp-find" placeholder="Search wallets" readOnly />
        <button type="button" className="wp-act" data-strong>
          Import
        </button>
      </Top>

      {WALLETS.map((w) => (
        <div
          className="w4r"
          data-on={on.includes(w.id) ? '' : undefined}
          key={w.id}
          onClick={() => toggle(w.id)}
        >
          <span className="w2-id">
            <span className="w2-name">{w.name}</span>
            <span className="wp-addr">{w.addr}</span>
          </span>
          <span className="w2-bal">
            <Sol />
            {w.sol}
          </span>
          <Tools className="w2-tools" />
        </div>
      ))}

      {/* The whole transfer rail, in one line, and only once something
          is picked. Click the rows above to see it come and go. */}
      {on.length > 0 ? (
        <div className="w4-bar">
          <span className="w4-say">
            <b>{on.length}</b> selected · move SOL to
          </span>
          <button type="button" className="wp-act" data-strong>
            Main ▾
          </button>
          <span className="wp-sp" />
          <button type="button" className="wp-act" onClick={() => setOn([])}>
            Clear
          </button>
          <button type="button" className="w4-go">
            Distribute
          </button>
        </div>
      ) : (
        <div className="w4-bar">
          <span className="w4-say wp-dim">Pick wallets to move SOL between them.</span>
        </div>
      )}
    </div>
  );
}

export function WalletsVariants() {
  return (
    <section className="wv">
      <h2>The wallets tab</h2>
      <p className="wv-note">
        Five wallets, four ways. The tab today is a spreadsheet beside two empty boxes: nine
        controls on every row, a name truncated to four characters in a 60px column, and half the
        width given permanently to a pair of wells that say drag wallets here. These keep the Spot
        tab&rsquo;s voice and argue about structure. Number four is also an argument about the
        transfer rail.
      </p>

      <div className="wv-stack">
        <Slot n={1} name="Table" note="what ships now">
          <Table />
        </Slot>

        <Slot n={2} name="Tape" note="the Spot tab's holdings row, for wallets">
          <Tape />
        </Slot>

        <Slot n={3} name="Blocks" note="one wallet per block, nothing hidden">
          <Blocks />
        </Slot>

        <Slot n={4} name="Pick" note="click rows to select; the rail is one line">
          <Pick />
        </Slot>
      </div>
    </section>
  );
}

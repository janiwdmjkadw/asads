'use client';

/*
 * THE LIGHT WALLET SURFACES, AS SHIPPED.
 *
 * Four things that used to be four different materials and are now one:
 * the nav dropdown, the deposit tab, the withdraw tab, and the wallet
 * picker that opens over it. Side by side, because the whole point of
 * the change is that pressing Deposit on one no longer opens something
 * that looks like a different product.
 *
 * The palette is the Flash dialog's, verbatim: #0B0E14 on #FFFFFF,
 * #E8ECEA plates, #134E4A on a settled figure, #8A9591 for a caption.
 * Figures are the sans at tabular-nums; the mono is kept for the title
 * and for addresses, which are read character by character.
 *
 * These are static replicas at the real widths. The live ones are
 * `WalletBalancePopover` and `WalletBalanceModal`.
 */

import type { ReactElement } from 'react';
import { Copy, Solana, Usdc } from '@/components/listen/icons/Icons';

const ADDRESS = 'SandboxWa11etPubkey1111111111111111111111111';
const WALLETS: ReadonlyArray<readonly [string, string, string]> = [
  ['Main', 'Sand…1111', '29.740'],
  ['Wallet 2', 'Sand…1111', '11.540'],
  ['Agent', 'Sand…1111', '0.000'],
];

/* A stand-in code, deterministic from the address, with the three
   finder squares. The live modal draws a real QR. */
function qrCells(n: number): boolean[] {
  let h = 0;
  for (let i = 0; i < ADDRESS.length; i += 1) h = (h * 31 + ADDRESS.charCodeAt(i)) >>> 0;
  const out: boolean[] = [];
  for (let i = 0; i < n * n; i += 1) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out.push((h >>> 16) % 100 < 46);
  }
  const finder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        out[(r0 + r) * n + (c0 + c)] = edge || core;
      }
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
  return out;
}

function Qr({ size = 176 }: { readonly size?: number }): ReactElement {
  const n = 25;
  return (
    <div className="ws-qr" style={{ width: size, height: size, gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden>
      {qrCells(n).map((on, i) => (
        <span key={i} className={on ? 'is-on' : undefined} />
      ))}
    </div>
  );
}

function Tabs({ on }: { readonly on: 'Deposit' | 'Withdraw' }): ReactElement {
  return (
    <div className="ws-tabs" role="tablist">
      {(['Deposit', 'Withdraw'] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={t === on} className={t === on ? 'is-on' : undefined}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ── the nav dropdown ──────────────────────────────────────────────────
function Dropdown(): ReactElement {
  return (
    <div className="ws-pop">
      <p className="ws-eyebrow">Total value</p>
      <p className="ws-total">$6,281.30</p>
      <div className="ws-cols">
        <div>
          <span>
            <Solana style={{ width: 12, height: 12 }} /> SOL
          </span>
          <b>41.280</b>
          <em>$4,140.80</em>
        </div>
        <div>
          <span>
            <Usdc style={{ width: 12, height: 12 }} /> USDC
          </span>
          <b>2140.50</b>
          <em>$2,140.50</em>
        </div>
      </div>
      <div className="ws-list">
        {WALLETS.map(([name, key, amt]) => (
          <div className="ws-row" key={name}>
            <span className="ws-name">{name}</span>
            <span className="ws-key">{key}</span>
            <Copy style={{ width: 11, height: 11 }} />
            <b>{amt}</b>
          </div>
        ))}
      </div>
      <div className="ws-acts">
        <button type="button" className="ws-cta">
          Deposit
        </button>
        <button type="button" className="ws-ghost">
          Withdraw
        </button>
      </div>
    </div>
  );
}

// ── the modal, deposit ────────────────────────────────────────────────
function Deposit(): ReactElement {
  return (
    <div className="ws-modal">
      <h3>Wallet</h3>
      <Tabs on="Deposit" />
      <div className="ws-plate">
        <div className="ws-plate-head">
          <span>Your deposit address</span>
          <span className="ws-net">
            <Solana style={{ width: 12, height: 12 }} /> Solana network
          </span>
        </div>
        <div className="ws-qr-card">
          <Qr />
        </div>
        <div className="ws-addr">
          <code>{ADDRESS}</code>
          <button type="button">
            <Copy style={{ width: 12, height: 12 }} />
            Copy
          </button>
        </div>
      </div>
      <p className="ws-foot">Only send SOL on the Solana network to this address.</p>
    </div>
  );
}

// ── the modal, withdraw, with the picker open ─────────────────────────
function Withdraw(): ReactElement {
  return (
    <div className="ws-modal">
      <h3>Wallet</h3>
      <Tabs on="Withdraw" />
      <div className="ws-plate is-form">
        <label>
          <span className="ws-k">From</span>
          <div className="ws-field is-trigger">
            <Solana style={{ width: 12, height: 12 }} />
            <b>Main</b>
            <code>Sand…1111</code>
            <i aria-hidden>⌄</i>
          </div>
        </label>
        {/* The picker, portalled in the live one, drawn open here. */}
        <div className="ws-select">
          {WALLETS.map(([name, key], i) => (
            <div className={i === 0 ? 'ws-opt is-on' : 'ws-opt'} key={name}>
              <Solana style={{ width: 12, height: 12 }} />
              <b>{name}</b>
              <code>{key}</code>
              {i === 0 ? <span className="ws-tick">✓</span> : null}
            </div>
          ))}
        </div>
        <label>
          <span className="ws-k">Destination address</span>
          <div className="ws-field">
            <code className="is-ph">Solana wallet address</code>
          </div>
        </label>
        <label>
          <span className="ws-k">
            Amount
            <em>Balance: 29.740</em>
          </span>
          <div className="ws-field">
            <Solana style={{ width: 12, height: 12 }} />
            <b className="is-ph">0.0</b>
            <span className="ws-max">MAX</span>
          </div>
        </label>
      </div>
      <button type="button" className="ws-cta is-wide">
        Withdraw
      </button>
      <p className="ws-foot">Sends on the Solana network.</p>
    </div>
  );
}

const SET: ReadonlyArray<readonly [string, string, ReactElement]> = [
  ['Nav dropdown', 'What the balance pill opens. 296px.', <Dropdown key="a" />],
  ['Deposit', 'The plate: black modules on white, inside the grey.', <Deposit key="b" />],
  ['Withdraw', 'Same shell, and the picker drawn open over it.', <Withdraw key="c" />],
];

export function WalletLightSuite(): ReactElement {
  return (
    <div className="ws">
      <style>{SHEET}</style>
      {SET.map(([name, note, node], i) => (
        <div className="ws-v" key={name}>
          <h2>
            <b>{i + 1}</b>
            {name}
          </h2>
          <p className="ws-note">{note}</p>
          {node}
        </div>
      ))}
    </div>
  );
}

const SHEET = `
.ws, .ws * { box-sizing: border-box; font-family: var(--sans); }
.ws { background: #000; min-height: 100vh; padding: 36px 26px 100px; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 30px; align-items: start; }
.ws-v > h2 { margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink-2); }
.ws-v > h2 b { font-size: 12px; font-weight: 600; color: var(--ink-3); }
.ws-note { margin: 0 0 12px; font-size: 12px; color: var(--ink-3); }

.ws b, .ws em, .ws .ws-total { font-variant-numeric: tabular-nums; font-style: normal; }
.ws code { font-family: var(--mono); }

/* ── the dropdown ── */
.ws-pop { width: 296px; background: #FFFFFF; color: #0B0E14; border-radius: 18px; padding: 16px 16px 14px; box-shadow: 0 0 0 1px #D3DAD8; }
.ws-eyebrow { margin: 0; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #8A9591; }
.ws-total { margin: 4px 0 0; font-size: 26px; font-weight: 600; letter-spacing: -0.026em; }
.ws-cols { display: grid; grid-template-columns: 1fr 1fr; margin: 14px 0; padding: 13px 0; border-top: 1px solid #E1E6E4; border-bottom: 1px solid #E1E6E4; }
.ws-cols > div { display: flex; flex-direction: column; gap: 3px; padding-right: 12px; }
.ws-cols > div + div { padding-left: 14px; border-left: 1px solid #E1E6E4; }
.ws-cols span { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #8A9591; }
.ws-cols b { font-size: 15px; font-weight: 600; letter-spacing: -0.016em; color: #134E4A; }
.ws-cols em { font-size: 11px; color: #8A9591; }
.ws-row { display: flex; align-items: center; gap: 7px; padding: 6px 0; }
.ws-name { font-size: 11.5px; color: #0B0E14; }
.ws-key { font-size: 10.5px; color: #8A9591; font-family: var(--mono); }
.ws-row svg { color: #8A9591; }
.ws-row b { margin-left: auto; font-size: 11.5px; font-weight: 600; }
.ws-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.ws-cta, .ws-ghost { border: 0; border-radius: 9px; padding: 10px 0; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: var(--sans); }
.ws-cta { background: #0B0E14; color: #FFFFFF; }
.ws-ghost { background: #E8ECEA; color: #0B0E14; }

/* ── the modal ── */
.ws-modal { position: relative; width: 340px; background: #FFFFFF; color: #0B0E14; border-radius: 16px; padding: 20px 20px 18px; box-shadow: 0 24px 80px #00000099; }
.ws-modal h3 { margin: 0; font-family: var(--mono); font-size: 22px; font-weight: 500; letter-spacing: -0.02em; }
.ws-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 16px 0 0; padding: 3px; background: #E8ECEA; border-radius: 10px; }
.ws-tabs button { border: 0; border-radius: 8px; padding: 8px 0; background: transparent; color: #8A9591; font-family: var(--sans); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ws-tabs button.is-on { background: #FFFFFF; color: #0B0E14; box-shadow: 0 1px 2px #0B0E1414; }

.ws-plate { margin-top: 16px; background: #E8ECEA; border-radius: 14px; padding: 14px; }
.ws-plate.is-form { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
.ws-plate-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; font-size: 12.5px; font-weight: 500; }
.ws-net { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 500; color: #8A9591; }
.ws-qr-card { display: grid; place-items: center; background: #FFFFFF; border-radius: 10px; padding: 12px; }
.ws-qr { display: grid; }
.ws-qr > span { background: transparent; }
.ws-qr > span.is-on { background: #0B0E14; }

.ws-addr { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 8px 8px 8px 12px; background: #FFFFFF; border: 1px solid #D3DAD8; border-radius: 10px; }
.ws-addr code { flex: 1 1 0; width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ws-addr button { display: inline-flex; align-items: center; gap: 6px; flex: none; border: 0; border-radius: 6px; padding: 6px 11px; background: #0B0E14; color: #FFFFFF; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: var(--sans); }
.ws-foot { margin: 12px 0 0; text-align: center; font-size: 11px; color: #8A9591; }

/* ── the form ── */
.ws-plate label { display: flex; flex-direction: column; gap: 6px; }
.ws-k { display: flex; align-items: baseline; justify-content: space-between; font-size: 12px; font-weight: 500; color: #3E4A47; }
.ws-k em { font-size: 11.5px; color: #8A9591; }
.ws-field { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #FFFFFF; border: 1px solid #D3DAD8; border-radius: 10px; font-size: 13px; }
.ws-field b { font-weight: 600; }
.ws-field code { font-size: 11.5px; color: #8A9591; }
.ws-field .is-ph { color: #B6BFBC; font-weight: 500; }
.ws-field i { margin-left: auto; font-style: normal; color: #8A9591; }
.ws-max { margin-left: auto; font-size: 11px; font-weight: 600; color: #8A9591; }

/* The picker, drawn where it opens. */
.ws-select { margin-top: -6px; background: #FFFFFF; border: 1px solid #D3DAD8; border-radius: 10px; box-shadow: 0 16px 40px #00000033; padding: 4px; }
.ws-opt { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 7px; font-size: 13px; }
.ws-opt.is-on { background: #E8ECEA; }
.ws-opt b { font-weight: 600; }
.ws-opt code { font-size: 11.5px; color: #8A9591; }
.ws-tick { margin-left: auto; font-size: 12px; color: #0B0E14; }

.ws-cta.is-wide { display: block; width: 100%; margin-top: 16px; padding: 12px 0; border-radius: 10px; font-size: 13px; }
`;

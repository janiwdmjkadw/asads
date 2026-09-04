'use client';

import type { ReactNode } from 'react';
import './wallet-monitor.css';

/*
 * ── SHEET 8 · THE WALLET TRACKER, SIX WAYS ───────────────────────────
 *
 * Its shell is already answered: Flat, and shared with the tweet popup,
 * so all six panels here wear the same one. What is still open is the
 * ROW.
 *
 * A trade is five facts — when, who, what, how much, at what market cap
 * — and a docked panel gives them 340px. The shipped row spends that on
 * a five column grid, which means every one of the five is truncatable
 * and two of them usually are. The other five either drop a column, buy
 * a second line, or stop being a grid.
 *
 * Same eight trades in every panel, same order, same figures.
 */

interface Trade {
  id: string;
  age: string;
  emoji: string;
  who: string;
  tick: string;
  seed: string;
  size: string;
  mc: string;
  buy: boolean;
  whale?: boolean;
}

const TRADES: Trade[] = [
  { id: 'a', age: '4h', emoji: '🐷', who: 'Trak…BBBB', tick: 'MOODENG', seed: 'moodeng', size: '3.14', mc: '$9.5K', buy: true },
  { id: 'b', age: '4h', emoji: '🐳', who: 'whale one', tick: 'ZEREBRO', seed: 'zerebro', size: '12.0', mc: '$42K', buy: true },
  { id: 'c', age: '4h', emoji: '🛠', who: 'dev wallet', tick: 'MEW', seed: 'mew', size: '0.9', mc: '$6.6K', buy: false },
  { id: 'd', age: '5h', emoji: '🐷', who: 'Trak…BBBB', tick: 'PNUT', seed: 'pnut', size: '5.76', mc: '$15.6K', buy: true },
  { id: 'e', age: '5h', emoji: '🐳', who: 'whale one', tick: 'GOAT', seed: 'goat', size: '68.2', mc: '$192K', buy: true, whale: true },
  { id: 'f', age: '6h', emoji: '🛠', who: 'dev wallet', tick: 'FWOG', seed: 'fwog', size: '0.42', mc: '$11.1K', buy: false },
  { id: 'g', age: '6h', emoji: '🐷', who: 'Trak…BBBB', tick: 'POPCAT', seed: 'popcat', size: '1.08', mc: '$29.9K', buy: true },
  { id: 'h', age: '7h', emoji: '🐳', who: 'whale one', tick: 'WIF', seed: 'wif', size: '2.40', mc: '$60.6K', buy: false },
];

const art = (seed: string) => `https://picsum.photos/seed/${seed}-art/64`;

const sideColor = (t: Trade) => (t.buy ? 'var(--up)' : 'var(--down)');

/** The SOL mark, at the size the tape sets it. */
function Sol() {
  return (
    <svg className="wm-sol" viewBox="0 0 24 21" aria-hidden>
      <path d="M4.3 15.6h17.2c.4 0 .6.5.3.8l-3.9 3.9a.6.6 0 0 1-.4.2H.3c-.4 0-.6-.5-.3-.8l3.9-3.9a.6.6 0 0 1 .4-.2Z" fill="currentColor" />
      <path d="M4.3 0h17.2c.4 0 .6.5.3.8l-3.9 3.9a.6.6 0 0 1-.4.2H.3c-.4 0-.6-.5-.3-.8L3.9.2A.6.6 0 0 1 4.3 0Z" fill="currentColor" />
      <path d="M17.9 7.8H.7c-.4 0-.6.5-.3.8l3.9 3.9a.6.6 0 0 0 .4.2h17.2c.4 0 .6-.5.3-.8l-3.9-3.9a.6.6 0 0 0-.4-.2Z" fill="currentColor" />
    </svg>
  );
}

function Face({ t }: { t: Trade }) {
  return (
    <span className="wm-pfp" aria-hidden>
      {t.emoji}
    </span>
  );
}

function Shot({ t }: { t: Trade }) {
  return (
    <span className="wm-shot">
      <img src={art(t.seed)} alt="" loading="lazy" draggable={false} />
      <u />
    </span>
  );
}

function BellMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Slot({ n, name, note, children }: { n: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="wm-slot">
      <div className="wm-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="wm-panel">
        <div className="wm-head">
          <b>Wallet activity</b>
          <i>8</i>
          <span className="wm-sp" />
          <button type="button" aria-label="Mute">
            <BellMark />
          </button>
          <button type="button" aria-label="Close">
            <CloseMark />
          </button>
        </div>
        <div className="wm-feed">{children}</div>
      </div>
    </div>
  );
}

/* ══ 1 · TAPE ═════════════════════════════════════════════════════ */

function Tape({ cls = 'w1' }: { cls?: string }) {
  return (
    <>
      {TRADES.map((t) => (
        <div className={cls} data-side={t.buy ? 'buy' : 'sell'} key={t.id}>
          <span className="w1-age">{t.age}</span>
          <span className="w1-who">
            <Face t={t} />
            <span className="w1-name" style={{ color: sideColor(t) }}>
              {t.who}
            </span>
          </span>
          <span className="w1-tok">
            <Shot t={t} />
            <span className="w1-tick">{t.tick}</span>
          </span>
          <span className="w1-size" style={{ color: sideColor(t), fontWeight: t.whale ? 600 : 400 }}>
            <Sol />
            {t.size}
          </span>
          <span className="w1-mc">{t.mc}</span>
        </div>
      ))}
    </>
  );
}

/* ══ 2 · STACKED ══════════════════════════════════════════════════ */

function Stacked() {
  return (
    <>
      {TRADES.map((t) => (
        <div className="w2" data-side={t.buy ? 'buy' : 'sell'} key={t.id}>
          <span className="w2-top">
            <Face t={t} />
            <span className="w2-name" style={{ color: sideColor(t) }}>
              {t.who}
            </span>
            <span className="w2-age">{t.age}</span>
          </span>
          <span className="w2-bot">
            <Shot t={t} />
            <span className="w2-tick">{t.tick}</span>
            <span className="w2-mc">{t.mc}</span>
            <span className="w2-size" style={{ color: sideColor(t) }}>
              <Sol />
              {t.size}
            </span>
          </span>
        </div>
      ))}
    </>
  );
}

/* ══ 3 · SENTENCE ═════════════════════════════════════════════════ */

function Sentence() {
  return (
    <>
      {TRADES.map((t) => (
        <div className="w3" key={t.id}>
          <span className="w3-body">
            <span className="w3-name">{t.who}</span>{' '}
            <span className="w3-verb" data-side={t.buy ? 'buy' : 'sell'}>
              {t.buy ? 'bought' : 'sold'}
            </span>{' '}
            <span className="w3-num">
              <Sol />
              {t.size}
            </span>{' '}
            of <span className="w3-num">{t.tick}</span> at <span className="w3-num">{t.mc}</span>
          </span>
          <span className="w3-age">{t.age}</span>
        </div>
      ))}
    </>
  );
}

/* ══ 5 · AMOUNT LED ═══════════════════════════════════════════════ */

function AmountLed() {
  return (
    <>
      {TRADES.map((t) => (
        <div className="w5" key={t.id}>
          <span className="w5-size" style={{ color: sideColor(t) }}>
            <Sol />
            {t.size}
          </span>
          <span className="w5-mid">
            <span className="w5-a">
              <Shot t={t} />
              <span className="w5-tick">{t.tick}</span>
            </span>
            <span className="w5-b">
              <span className="w5-name">{t.who}</span>
              <span>·</span>
              <span>{t.age}</span>
            </span>
          </span>
          <span className="w5-mc">{t.mc}</span>
        </div>
      ))}
    </>
  );
}

/* ══ 6 · BARE ═════════════════════════════════════════════════════ */

function Bare() {
  return (
    <>
      {TRADES.map((t) => (
        <div className="w6" key={t.id}>
          <span className="w6-age">{t.age}</span>
          <span className="w6-name">{t.who}</span>
          <span className="w6-tick">{t.tick}</span>
          <span className="w6-size" style={{ color: sideColor(t) }}>
            {t.buy ? '+' : '−'}
            {t.size}
          </span>
        </div>
      ))}
    </>
  );
}

export function WalletMonitorSheet() {
  return (
    <section className="wm">
      <h2>The wallet tracker</h2>
      <p className="wm-note">
        Same shell in all six, because that one is answered. Same eight trades, same order, same
        figures, at the 340px the panel docks at. What changes is how one trade is put together:
        five facts and a line that is not wide enough for five columns.
      </p>

      <div className="wm-rack">
        <Slot n={1} name="Tape" note="what ships now">
          <Tape />
        </Slot>

        <Slot n={2} name="Stacked" note="two lines, nothing truncated">
          <Stacked />
        </Slot>

        <Slot n={3} name="Sentence" note="read it, do not assemble it">
          <Sentence />
        </Slot>

        <Slot n={4} name="Edge" note="the same row, side as a rule not a wash">
          <Tape cls="w4" />
        </Slot>

        <Slot n={5} name="Amount led" note="size first, at the size it deserves">
          <AmountLed />
        </Slot>

        <Slot n={6} name="Bare" note="no art, no face, sign carries the side">
          <Bare />
        </Slot>
      </div>
    </section>
  );
}

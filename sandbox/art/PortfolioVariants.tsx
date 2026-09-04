'use client';

import type { ReactNode } from 'react';
import './portfolio-variants.css';

/*
 * ── THE PORTFOLIO, IN BLACK ──────────────────────────────────────────
 *
 * Four mockups of one portfolio. Same total, same delta, same six
 * holdings, same series. What differs is the arrangement and how loud
 * it is willing to be.
 *
 * The brief was black and sleek, and that the page has to be worth
 * showing off — so one of these four (Hero) is built for a screenshot
 * and the other three are built to be used. Colour is up-green and
 * down-pink, only on figures that are a gain or a loss, and nowhere
 * else. The accent belongs to the friends page.
 *
 * See `portfolio-variants.css` for what the page does today and what
 * each of these is arguing against.
 */

const TOTAL = '48,206';
const CENTS = '.14';
const DELTA = '+$3,912.55';
const DELTA_PCT = '+8.83%';

const FIGS: ReadonlyArray<{ k: string; v: string; tone?: 'up' | 'down' }> = [
  { k: 'Realized', v: '+$12,480.20', tone: 'up' },
  { k: 'Unrealized', v: '+$3,912.55', tone: 'up' },
  { k: 'Cost basis', v: '$31,806.40' },
];

interface Hold {
  tick: string;
  name: string;
  seed: string;
  amount: string;
  value: string;
  pct: number;
  day: string;
  up: boolean;
}

const HOLD: Hold[] = [
  { tick: 'SOL', name: 'Solana', seed: 'sol', amount: '94.20', value: '$19,862.40', pct: 41.2, day: '+2.4%', up: true },
  { tick: 'WIF', name: 'dogwifhat', seed: 'wif', amount: '4,180', value: '$8,966.30', pct: 18.6, day: '+11.8%', up: true },
  { tick: 'GOAT', name: 'Goatseus', seed: 'goat', amount: '12,940', value: '$6,893.50', pct: 14.3, day: '−3.1%', up: false },
  { tick: 'PNUT', name: 'Peanut', seed: 'pnut', amount: '31,600', value: '$5,350.90', pct: 11.1, day: '+6.2%', up: true },
  { tick: 'MOODENG', name: 'Moo Deng', seed: 'moodeng', amount: '88,400', value: '$4,049.30', pct: 8.4, day: '−0.8%', up: false },
  { tick: 'JUP', name: 'Jupiter', seed: 'jup', amount: '2,940', value: '$3,083.74', pct: 6.4, day: '+1.5%', up: true },
];

const art = (seed: string) => `https://picsum.photos/seed/${seed}-pf/64`;

/* ── the chart ─────────────────────────────────────────────────────
 *
 * One series, drawn once and reused at four sizes. A portfolio that
 * gained 8.8% over the range: up, a drawdown around a third in, then a
 * run to the high at the right edge, because a line that only goes up
 * is a line nobody believes.
 */

const PTS = [
  62, 58, 66, 61, 55, 63, 57, 49, 52, 44, 47, 40, 46, 51, 43, 38, 33, 37,
  30, 35, 41, 46, 52, 48, 55, 61, 57, 50, 44, 38, 33, 28, 31, 25, 22, 27,
  19, 23, 16, 12, 17, 10, 14, 8,
];

function line(w: number, h: number): { line: string; area: string } {
  const step = w / (PTS.length - 1);
  const lo = Math.min(...PTS);
  const hi = Math.max(...PTS);
  const y = (v: number) => 6 + ((v - lo) / (hi - lo)) * (h - 14);
  const d = PTS.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return { line: d, area: `${d} L${w} ${h} L0 ${h} Z` };
}

function Chart({ id, height }: { id: string; height: number }) {
  const w = 1000;
  const { line: l, area } = line(w, height);
  return (
    <svg className="pg-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`pgf-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <line className="base" x1="0" y1={height - 0.5} x2={w} y2={height - 0.5} />
      <path className="area" d={area} fill={`url(#pgf-${id})`} />
      <path className="line" d={l} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Ranges({ live = '30D' }: { live?: string }) {
  return (
    <div className="pg-range">
      {['1D', '30D', '90D', 'Max'].map((r) => (
        <button type="button" key={r} data-on={r === live ? '' : undefined}>
          {r}
        </button>
      ))}
    </div>
  );
}

function Figs({ className }: { className?: string }) {
  return (
    <div className={`pg-figs ${className ?? ''}`}>
      {FIGS.map((f) => (
        <span className="pg-fig" key={f.k}>
          <i>{f.k}</i>
          <b className={f.tone ?? ''}>{f.v}</b>
        </span>
      ))}
    </div>
  );
}

/** The total, with the cents dropped back so the dollars carry it. */
function Total() {
  return (
    <div className="pg-total">
      ${TOTAL}
      <s>{CENTS}</s>
    </div>
  );
}

function Rows({ compact = false }: { compact?: boolean }) {
  return (
    <div className="pg-hold">
      {HOLD.map((h) => (
        <div className="pg-row" key={h.tick}>
          <img className="pg-art" src={art(h.seed)} alt="" loading="lazy" />
          <span>
            <span className="pg-tick">{h.tick}</span>{' '}
            <span className="pg-sub">{compact ? `${h.pct}%` : h.name}</span>
          </span>
          {compact ? null : (
            <span>
              <span className="pg-bar">
                <span style={{ width: `${(h.pct / 41.2) * 100}%` }} />
              </span>
            </span>
          )}
          {compact ? null : <span className="pg-num pg-sub">{h.amount}</span>}
          <span className="pg-num">{h.value}</span>
          {compact ? null : <span className={`pg-num-2 ${h.up ? 'up' : 'down'}`}>{h.day}</span>}
        </div>
      ))}
    </div>
  );
}

function Slot({ n, name, note, children }: { n: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="pf-slot">
      <div className="pf-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      {children}
    </div>
  );
}

/* ══ 1 · LEDGER ═══════════════════════════════════════════════════ */

function Ledger() {
  return (
    <div className="pg v1">
      <span className="pg-lab">Portfolio value</span>
      <div className="v1-top">
        <Total />
        <span className="v1-delta up">
          {DELTA} <span style={{ color: 'rgba(255,255,255,0.4)' }}>{DELTA_PCT}</span>
        </span>
        <span className="v1-sp" />
        <Ranges />
      </div>
      <Chart id="v1" height={128} />
      <div className="v1-figs">
        <Figs />
      </div>
      <div className="v1-hold">
        <Rows />
      </div>
    </div>
  );
}

/* ══ 2 · HERO ═════════════════════════════════════════════════════ */

const MIX_INK = ['0.85', '0.62', '0.46', '0.34', '0.24', '0.16'];

function Hero() {
  return (
    <div className="pg v2">
      <span className="pg-lab">Total value</span>
      <Total />
      <div>
        <span className="v2-delta up">
          {DELTA} <span style={{ color: 'rgba(255,255,255,0.4)' }}>{DELTA_PCT}</span>
        </span>
      </div>
      <Chart id="v2" height={116} />
      <Figs />

      {/* One bar for the whole portfolio, in one ink at six weights. Six
          hues here would be the rainbow this page is getting away from;
          six shades of the same white still reads as six slices. */}
      <div className="v2-mix">
        {HOLD.map((h, i) => (
          <span key={h.tick} style={{ flex: h.pct, background: `rgba(255,255,255,${MIX_INK[i]})` }} />
        ))}
      </div>
      <div className="v2-key">
        {HOLD.map((h, i) => (
          <span key={h.tick}>
            <i style={{ background: `rgba(255,255,255,${MIX_INK[i]})` }} />
            <b>{h.tick}</b> {h.pct}%
          </span>
        ))}
      </div>
      <Ranges />
    </div>
  );
}

/* ══ 3 · SPLIT ════════════════════════════════════════════════════ */

function Split() {
  return (
    <div className="pg v3">
      <div className="v3-grid">
        <div className="v3-l">
          {/* The ranges ride the label line here rather than the total's.
              The left column is 316px narrower than Ledger's full page,
              and the control ran out of it and over the holdings. */}
          <div className="v3-lab">
            <span className="pg-lab">Portfolio value</span>
            <Ranges />
          </div>
          <div className="v1-top">
            <Total />
            <span className="v1-delta up">
              {DELTA} <span style={{ color: 'rgba(255,255,255,0.4)' }}>{DELTA_PCT}</span>
            </span>
          </div>
          <Chart id="v3" height={150} />
          <Figs />
        </div>
        <div className="v3-r">
          <div className="v3-h">
            <b>Holdings</b>
            <small>6 tokens</small>
          </div>
          <Rows compact />
        </div>
      </div>
    </div>
  );
}

/* ══ 4 · PLATES ═══════════════════════════════════════════════════ */

function Plates() {
  return (
    <div className="pg v4">
      <div className="v4-quad">
        <div className="v4-plate v4-hero">
          <i>Portfolio value</i>
          <b>
            ${TOTAL}
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{CENTS}</span>
          </b>
          <u className="up">
            {DELTA_PCT} <span style={{ color: 'rgba(255,255,255,0.4)' }}>30D</span>
          </u>
        </div>
        {FIGS.map((f) => (
          <div className="v4-plate" key={f.k}>
            <i>{f.k}</i>
            <b className={f.tone ?? ''}>{f.v}</b>
          </div>
        ))}
      </div>

      <div className="v4-wide">
        <div className="v4-wide-h">
          <b>Performance</b>
          <Ranges />
        </div>
        <Chart id="v4" height={132} />
      </div>

      <div className="v4-wide">
        <div className="v4-wide-h">
          <b>Holdings</b>
        </div>
        <Rows />
      </div>
    </div>
  );
}

export function PortfolioVariants() {
  return (
    <section className="pf">
      <h2>The portfolio, in black</h2>
      <p className="pf-note">
        Four arrangements of one portfolio: same total, same delta, same six holdings, same series.
        Black ground, one ink scale, and type doing the hierarchy. The only colour on any of them is
        green up and pink down, and only ever on a figure that is a gain or a loss.
      </p>

      <div className="pf-stack">
        <Slot n={1} name="Ledger" note="one column, everything left, nothing decorative">
          <Ledger />
        </Slot>

        <Slot n={2} name="Hero" note="built to be screenshotted">
          <Hero />
        </Slot>

        <Slot n={3} name="Split" note="chart left, holdings right, nothing below the fold">
          <Split />
        </Slot>

        <Slot n={4} name="Plates" note="the page has visible parts">
          <Plates />
        </Slot>
      </div>
    </section>
  );
}

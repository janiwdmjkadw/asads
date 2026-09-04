'use client';

import './top.css';
import type { TopKind } from './kinds';

/*
 * The top of a column, copied from the reference. Nothing under it.
 *
 * Order, left to right: the lane name, the search pill, then ONE
 * bordered box holding the bolt, the quick buy amount, the SOL mark, P1
 * and the chart glyph, then the filter loose outside it.
 *
 * The reference has an audio control between the chart and the filter.
 * It is deliberately not here.
 */

function Glyph({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  );
}

const CHART = 'M3 17l5.5-6 4 4L21 6M21 6h-4.5M21 6v4.5';
const FUNNEL = 'M3.5 5.5h17l-6.6 7.6v5.2l-3.8 2.2v-7.4z';

/* Filled, not stroked. It is the one mark in the strip that reads as a
   symbol rather than an outline, and the reference draws it solid. */
function Bolt() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
    </svg>
  );
}

function Sol() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="url(#tp-sol)" aria-hidden style={{ display: 'block' }}>
      <defs>
        <linearGradient id="tp-sol" x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M4.53 15.88a.87.87 0 0 1 .61-.25h17.4c.39 0 .58.47.3.74l-3.44 3.44a.87.87 0 0 1-.61.25H1.4a.42.42 0 0 1-.3-.72l3.43-3.46z" />
      <path d="M4.53 4.6a.9.9 0 0 1 .61-.25h17.4c.39 0 .58.47.3.74l-3.44 3.44a.87.87 0 0 1-.61.25H1.4a.42.42 0 0 1-.3-.72L4.53 4.6z" />
      <path d="M19.19 10.2a.87.87 0 0 0-.61-.25H1.18a.42.42 0 0 0-.3.72l3.44 3.44c.16.16.38.25.61.25h17.4a.42.42 0 0 0 .3-.72l-3.44-3.44z" />
    </svg>
  );
}

export function Top({ kind }: { kind: TopKind }) {
  return (
    <div className="tp-wrap">
      <div className="tp" data-v={kind}>
        <span className="tp-title">New</span>

        <span className="tp-grow" />

        <label className="tp-search">
          <input
            placeholder="Search"
            spellCheck={false}
            readOnly
            size={1}
            aria-label="Search New"
          />
        </label>

        <span className="tp-tools">
          <span className="tp-amt">
            <Bolt />
            <input className="tp-size" defaultValue="0" readOnly aria-label="Quick buy amount in SOL" />
            <Sol />
          </span>

          <span className="tp-div" aria-hidden />

          <button type="button" className="tp-preset">
            P1
          </button>

          <button type="button" className="tp-chart" aria-label="Preset settings">
            <Glyph d={CHART} size={13} />
          </button>
        </span>

        <button type="button" className="tp-funnel" aria-label="Filters">
          <Glyph d={FUNNEL} size={14} />
        </button>
      </div>
    </div>
  );
}

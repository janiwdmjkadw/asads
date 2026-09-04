'use client';

import { useState } from 'react';

/**
 * ExchangeIcon — real brand logo for a funding-source label, falling
 * back to a tinted monogram badge for entities without an asset yet.
 * Single source of truth for every place a funding origin renders
 * (trade-table funding cells, the dev wallet hover card).
 */

/** label → /public asset. Filenames match the uploaded assets verbatim. */
const EXCHANGE_ICONS: Record<string, string> = {
  Binance: '/assets/binance.svg',
  Coinbase: '/assets/Coinbase Logo.svg',
  KuCoin: '/assets/KuCoin.png',
  OKX: '/assets/OKX.png',
  HTX: '/assets/HTX.png',
  HitBTC: '/assets/HITBTC.png',
  Robinhood: '/assets/ROBINHOOD.png',
  Relay: '/assets/RelayLink.png',
  Revolut: '/assets/Revoulut.png',
};

/** Brand tint for the monogram fallback; unknown labels fall back grey. */
const BRAND_COLORS: Record<string, string> = {
  Binance: '#F0B90B',
  Coinbase: '#0052FF',
  Kraken: '#7132F5',
  OKX: '#8a8f98',
  Bybit: '#F7A600',
  KuCoin: '#23AF91',
  MEXC: '#1972E2',
  'Gate.io': '#2354E6',
  BitMart: '#22B573',
  'Crypto.com': '#1199FA',
  deBridge: '#F42D68',
  Mayan: '#8b5cf6',
  ChangeNOW: '#00C26F',
  HTX: '#2E9BFF',
  Bitget: '#00CDCD',
  WhiteBIT: '#FFCE00',
  Upbit: '#0A3F8F',
  Bithumb: '#F37321',
};

export function ExchangeIcon({ label, size = 14 }: { label: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = EXCHANGE_ICONS[label];
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className="shrink-0 rounded-[4px] object-contain"
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    );
  }
  const tint = BRAND_COLORS[label] ?? 'var(--ink-3)';
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] font-bold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.64)),
        color: tint,
        background: `color-mix(in srgb, ${tint} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tint} 45%, transparent)`,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

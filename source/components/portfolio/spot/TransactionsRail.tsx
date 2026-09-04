'use client';

import { useState, type CSSProperties } from 'react';
import { ExternalLink, Solana } from '@/components/listen/icons/Icons';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import type {
  SpotTxEntry,
  SpotTxTokenDelta,
  SpotTxType,
} from '@/lib/api/portfolio-transactions';
import { formatAmount, formatUsd, relativeTime, truncateMint } from './format';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": the Recent Activity rail.
 *
 * Each row is built around the *token* the transaction is about — its
 * logo (resolved from current holdings, else our per-mint CDN image
 * proxy, else a deterministic monogram) carries a small directional
 * badge (in / out / swap). The ticker leads, the action + amount read
 * underneath, and the signed USD + SOL leg sit on the right. The goal:
 * a feed that feels like a beautifully-printed ledger, not a debug log.
 */

interface TokenMeta {
  readonly symbol: string | null;
  readonly logo: string | null;
}

interface Props {
  readonly transactions: ReadonlyArray<SpotTxEntry>;
  readonly walletLabels: ReadonlyMap<string, string>;
  readonly tokenMeta: ReadonlyMap<string, TokenMeta>;
  readonly solPriceUsd: number;
  readonly nextBefore: string | null;
  readonly onLoadOlder: () => void;
  readonly loadingOlder: boolean;
  readonly className?: string;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

export function TransactionsRail(props: Props): React.ReactElement {
  return (
    <div className={props.className ?? ''} style={shellStyle}>
      <style>{RAIL_CSS}</style>
      {/* The tape's head, in the page's voice: a name and a count. It
          was a cyan tick, a pulsing live dot, and `RECENT ACTIVITY` in
          10.5px mono capitals on a 0.14em track — three devices in front
          of two words, on the last page in the product still speaking
          that way. */}
      <div className="spl-tape-h" style={headerStyle}>
        <b>Recent activity</b>
        <small>{props.transactions.length}</small>
      </div>
      <div style={listStyle}>
        {props.transactions.length === 0 ? (
          <div style={emptyStyle}>No on-chain activity yet.</div>
        ) : (
          groupByDay(props.transactions).map((group) => (
            <div key={group.key}>
              <div style={dayHeaderStyle}>
                <span>{group.label}</span>
                <span style={dayCountStyle}>{group.items.length}</span>
              </div>
              {group.items.map((tx) => (
                <TxRow
                  key={tx.signature}
                  tx={tx}
                  walletLabel={props.walletLabels.get(tx.wallet_account_id) ?? null}
                  tokenMeta={props.tokenMeta}
                  solPriceUsd={props.solPriceUsd}
                />
              ))}
            </div>
          ))
        )}
      </div>
      {props.nextBefore !== null ? (
        <div style={footerStyle}>
          <button
            type="button"
            onClick={props.onLoadOlder}
            disabled={props.loadingOlder}
            /* A word you click, not an accent-filled capsule with an
               accent border and accent type inside it. */
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 11.5,
              fontWeight: 500,
              padding: '6px 4px',
              border: 0,
              background: 'none',
              color: 'var(--ink-3)',
              cursor: props.loadingOlder ? 'wait' : 'pointer',
              opacity: props.loadingOlder ? 0.6 : 1,
              transition: 'color 130ms ease',
            }}
          >
            {props.loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TxRow({
  tx,
  walletLabel,
  tokenMeta,
  solPriceUsd,
}: {
  tx: SpotTxEntry;
  walletLabel: string | null;
  tokenMeta: ReadonlyMap<string, TokenMeta>;
  solPriceUsd: number;
}): React.ReactElement {
  const solLeg = tx.sol_delta_lamports / 1_000_000_000;
  const usdLeg =
    Number.isFinite(solPriceUsd) && solPriceUsd > 0 ? solLeg * solPriceUsd : null;

  const primary = primaryToken(tx.token_deltas);
  const meta = primary ? tokenMeta.get(primary.mint) : undefined;
  const ticker = primary
    ? meta?.symbol ??
      tokenTickerFromNavigationHint(primary.mint) ??
      truncateMint(primary.mint)
    : 'SOL';
  const dir = directionFor(tx.type);
  const amountLabel = primary
    ? `${primary.amount_ui > 0 ? '+' : '−'}${formatAmount(Math.abs(primary.amount_ui))}`
    : null;

  return (
    <a
      className="spot-tx-row"
      href={`https://solscan.io/tx/${tx.signature}`}
      target="_blank"
      rel="noopener noreferrer"
      style={rowAnchorStyle(tx.success)}
    >
      <TxAvatar
        mint={primary?.mint ?? null}
        logo={meta?.logo ?? null}
        symbol={ticker}
        direction={dir}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={line1Style}>
          <span style={tickerStyle}>{ticker}</span>
          <span style={actionStyle(tx.type)}>{TYPE_LABEL[tx.type]}</span>
        </div>
        <div style={line2Style}>
          {amountLabel !== null ? (
            <>
              <span style={{ fontFamily: 'var(--mono, ui-monospace)', fontVariantNumeric: 'tabular-nums' }}>
                {amountLabel}
              </span>
              <Dot />
            </>
          ) : null}
          <span>{relativeTime(tx.timestamp_ms)}</span>
          {walletLabel ? (
            <>
              <Dot />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                {walletLabel}
              </span>
            </>
          ) : null}
          {!tx.success ? (
            <>
              <Dot />
              <span style={{ color: 'var(--down)' }}>failed</span>
            </>
          ) : null}
        </div>
      </div>

      <div style={rightColStyle}>
        <div style={usdStyle(usdLeg)}>
          {usdLeg == null
            ? '—'
            : `${usdLeg > 0 ? '+' : usdLeg < 0 ? '−' : ''}${formatUsd(Math.abs(usdLeg))}`}
        </div>
        <div style={solLegStyle}>
          {Math.abs(solLeg) > 0 ? `${formatSignedSol(solLeg)} SOL` : ''}
        </div>
      </div>

      <ExternalLink className="spot-tx-ext" style={{ width: 12, height: 12, color: 'var(--ink-3)', flexShrink: 0 }} />
    </a>
  );
}

// -------- token avatar (image → CDN proxy → monogram) ------------------

function TxAvatar({
  mint,
  logo,
  symbol,
  direction,
}: {
  mint: string | null;
  logo: string | null;
  symbol: string;
  direction: Direction;
}): React.ReactElement {
  const sources = buildSources(mint, logo);
  const [idx, setIdx] = useState(0);
  const src = sources[idx];
  const isSol = mint === null || mint === SOL_MINT;

  return (
    <span style={avatarWrapStyle}>
      <span style={avatarRingStyle(direction)}>
        {isSol ? (
          <span style={solBadgeStyle}>
            <Solana style={{ width: 18, height: 18 }} />
          </span>
        ) : src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setIdx((i) => i + 1)}
            style={avatarImgStyle}
          />
        ) : (
          <Monogram symbol={symbol} />
        )}
      </span>
      {direction ? <DirectionBadge direction={direction} /> : null}
    </span>
  );
}

function buildSources(mint: string | null, logo: string | null): ReadonlyArray<string> {
  if (mint === null || mint === SOL_MINT) return [];
  const out: string[] = [];
  if (logo && logo.length > 0) out.push(logo);
  const proxy = ingestionTokenImageUrl(mint);
  if (proxy && !out.includes(proxy)) out.push(proxy);
  return out;
}

function Monogram({ symbol }: { symbol: string }): React.ReactElement {
  const initials = (symbol || '?').replace(/^\$/, '').slice(0, 2).toUpperCase();
  return (
    <span aria-hidden style={{ ...avatarImgStyle, background: hueGradient(symbol), ...monogramTextStyle }}>
      {initials}
    </span>
  );
}

type Direction = 'in' | 'out' | 'swap' | null;

function directionFor(type: SpotTxType): Direction {
  switch (type) {
    case 'buy':
    case 'receive':
      return 'in';
    case 'sell':
    case 'send':
      return 'out';
    case 'swap':
    case 'internal':
      return 'swap';
    default:
      return null;
  }
}

function DirectionBadge({ direction }: { direction: Exclude<Direction, null> }): React.ReactElement {
  const color =
    direction === 'in'
      ? 'var(--up)'
      : direction === 'out'
        ? 'var(--down)'
        : 'var(--accent-primary)';
  const path =
    direction === 'in'
      ? 'M12 5v14m0-14l5 5m-5-5l-5 5' // up arrow (incoming value)
      : direction === 'out'
        ? 'M12 19V5m0 14l5-5m-5 5l-5-5' // down arrow (outgoing)
        : 'M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3'; // swap
  return (
    <span style={{ ...badgeWrapStyle, background: `color-mix(in srgb, ${color} 26%, var(--surface))`, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d={path} stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// -------- token helpers ------------------------------------------------

/**
 * Pick the token the row is "about": the largest-magnitude leg that
 * isn't SOL or a stablecoin (those are the quote side). Falls back to
 * the largest non-SOL leg, else null (a pure SOL move).
 */
function primaryToken(deltas: ReadonlyArray<SpotTxTokenDelta>): SpotTxTokenDelta | null {
  const live = deltas.filter(
    (d) => Number.isFinite(d.amount_ui) && d.amount_ui !== 0 && d.mint !== SOL_MINT,
  );
  if (live.length === 0) return null;
  const interesting = live.filter((d) => !STABLE_MINTS.has(d.mint));
  const pool = interesting.length > 0 ? interesting : live;
  return [...pool].sort((a, b) => Math.abs(b.amount_ui) - Math.abs(a.amount_ui))[0] ?? null;
}

// -------- day grouping -------------------------------------------------

interface DayGroup {
  readonly key: string;
  readonly label: string;
  readonly items: ReadonlyArray<SpotTxEntry>;
}

/** Group a time-descending tx list into contiguous calendar-day runs. */
function groupByDay(txs: ReadonlyArray<SpotTxEntry>): ReadonlyArray<DayGroup> {
  const groups: Array<{ key: number; label: string; items: SpotTxEntry[] }> = [];
  let current: { key: number; label: string; items: SpotTxEntry[] } | null = null;
  for (const tx of txs) {
    const key = dayKey(tx.timestamp_ms);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(tx.timestamp_ms), items: [] };
      groups.push(current);
    }
    current.items.push(tx);
  }
  return groups.map((g) => ({ key: String(g.key), label: g.label, items: g.items }));
}

function dayKey(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const today = dayKey(now.getTime());
  const that = dayKey(ms);
  const DAY = 86_400_000;
  if (that === today) return 'Today';
  if (that === today - DAY) return 'Yesterday';
  return d.toLocaleDateString(
    undefined,
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

function hueGradient(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `linear-gradient(135deg, hsl(${hue} 64% 42%), hsl(${(hue + 38) % 360} 60% 28%))`;
}

const TYPE_LABEL: Record<SpotTxType, string> = {
  swap: 'Swap',
  buy: 'Buy',
  sell: 'Sell',
  send: 'Send',
  receive: 'Receive',
  internal: 'Internal',
  other: 'Activity',
};

function actionStyle(type: SpotTxType): CSSProperties {
  const color =
    type === 'buy' || type === 'receive'
      ? 'var(--up)'
      : type === 'sell' || type === 'send'
        ? 'var(--down)'
        : type === 'swap' || type === 'internal'
          ? 'var(--accent-primary)'
          : 'var(--ink-3)';
  return {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color,
    textTransform: 'uppercase',
  };
}

function usdStyle(usd: number | null): CSSProperties {
  return {
    fontFamily: 'var(--mono, ui-monospace)',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 13,
    fontWeight: 600,
    color:
      usd == null
        ? 'var(--ink-3)'
        : usd > 0
          ? 'var(--up)'
          : usd < 0
            ? 'var(--down)'
            : 'var(--ink-1)',
  };
}

function Dot(): React.ReactElement {
  return <span style={{ color: 'var(--ink-4)' }}>·</span>;
}

function formatSignedSol(sol: number): string {
  if (!Number.isFinite(sol) || sol === 0) return '0';
  const sign = sol > 0 ? '+' : '−';
  const abs = Math.abs(sol);
  if (abs >= 1) return `${sign}${abs.toFixed(3)}`;
  if (abs >= 0.001) return `${sign}${abs.toFixed(4)}`;
  return `${sign}${abs.toExponential(2)}`;
}

// -------- styles -------------------------------------------------------

/*
 * On the page, not on a plate. It was a 14px-radius bordered card with
 * its own ground and a 5% accent radial washing down from above it — a
 * second surface and a coloured light, beside a holdings tape that
 * stands on the page itself. Nothing else on this screen is in a box.
 */
const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
};

/* Padding only. `.spl-tape-h` owns the rest, so this head and the
   holdings head beside it are the same object — they were pushing the
   count to the far edge here and keeping it beside the name there. */
const headerStyle: CSSProperties = { padding: '0 2px 8px' };

const liveDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'var(--accent-primary)',
  boxShadow: '0 0 8px color-mix(in srgb, var(--accent-primary) 80%, transparent)',
};

const listStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const emptyStyle: CSSProperties = {
  padding: '28px 16px',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--ink-3)',
};

const dayHeaderStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  padding: '7px 14px 5px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: 'color-mix(in srgb, var(--surface-1) 88%, transparent)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderBottom: '1px solid color-mix(in srgb, var(--hairline) 70%, transparent)',
  fontFamily: 'var(--sans)',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const dayCountStyle: CSSProperties = {
  fontFamily: 'var(--mono, ui-monospace)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 9.5,
  letterSpacing: '0.02em',
  color: 'var(--ink-4)',
};

const footerStyle: CSSProperties = {
  borderTop: '1px solid var(--hairline)',
  padding: 8,
  textAlign: 'center',
  flexShrink: 0,
};

function rowAnchorStyle(success: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '9px 14px',
    color: 'inherit',
    textDecoration: 'none',
    opacity: success ? 1 : 0.5,
    borderBottom: '1px solid color-mix(in srgb, var(--hairline) 60%, transparent)',
    transition: 'background-color 120ms ease',
  };
}

const avatarWrapStyle: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  width: 34,
  height: 34,
};

function avatarRingStyle(direction: Direction): CSSProperties {
  const ring =
    direction === 'in'
      ? 'color-mix(in srgb, var(--up) 30%, transparent)'
      : direction === 'out'
        ? 'color-mix(in srgb, var(--down) 30%, transparent)'
        : direction === 'swap'
          ? 'color-mix(in srgb, var(--accent-primary) 30%, transparent)'
          : 'rgba(255,255,255,0.08)';
  return {
    display: 'block',
    width: 34,
    height: 34,
    borderRadius: '50%',
    overflow: 'hidden',
    boxShadow: `0 0 0 1px ${ring}, 0 2px 8px -3px rgba(0,0,0,0.5)`,
  };
}

const avatarImgStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const monogramTextStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-0)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '-0.02em',
};

const solBadgeStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, rgba(118,198,255,0.22), rgba(157,92,255,0.18))',
};

const badgeWrapStyle: CSSProperties = {
  position: 'absolute',
  right: -2,
  bottom: -2,
  width: 15,
  height: 15,
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid',
};

const line1Style: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 7,
  minWidth: 0,
};

const tickerStyle: CSSProperties = {
  fontFamily: 'var(--sans)',
  fontSize: 13,
  fontWeight: 650,
  color: 'var(--ink-0)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 140,
  letterSpacing: '-0.01em',
};

const line2Style: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--ink-3)',
  display: 'flex',
  gap: 5,
  alignItems: 'center',
  marginTop: 3,
};

const rightColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  flexShrink: 0,
  minWidth: 64,
  gap: 2,
};

const solLegStyle: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--ink-3)',
  fontFamily: 'var(--mono, ui-monospace)',
  fontVariantNumeric: 'tabular-nums',
};

const RAIL_CSS = `
.spot-tx-row .spot-tx-ext { opacity: 0; transition: opacity 120ms ease; }
.spot-tx-row:hover { background-color: color-mix(in srgb, var(--accent-primary) 6%, transparent); }
.spot-tx-row:hover .spot-tx-ext { opacity: 1; }
@keyframes spot-tx-live {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.8); }
}
.spot-tx-live { animation: spot-tx-live 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .spot-tx-live { animation: none; }
}
`;

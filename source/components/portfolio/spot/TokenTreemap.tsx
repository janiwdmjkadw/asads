'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import { Shield } from '@/components/listen/icons/Icons';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import type { SpotHolding } from '@/lib/api/portfolio-spot';
import { squarify } from './squarify';
import {
  formatPct,
  formatUsd,
  pnlColor,
  truncateMint,
} from './format';

/**
 * Slice "Portfolio Spot tab": the token map.
 *
 * Design goals:
 *
 *   - render dozens of tiles cleanly. Top-K by USD with a single
 *     "Dust" rollup so tile area stays meaningful even with 100+
 *     long-tail mints.
 *   - color each priced tile by 24h PnL. A vivid green→red gradient
 *     with a soft inner glow communicates direction at a glance.
 *   - render the token's logo (when DAS gave us one). For tokens
 *     without metadata, generate a deterministic two-letter mark
 *     so every tile feels like a real token, not a placeholder.
 *   - "unknown" tokens — unpriced, no user-owned origin evidence —
 *     are dangerous (often malicious airdrops). They get a
 *     red-tinted warning treatment AND a distinct tile per mint
 *     so the user can see what they're holding, not just a number.
 *   - filters above the tilemap let the user toggle Hide unknown
 *     (default on) and Hide dust (default on).
 *   - click → /trade/{mint}, hover → frosted popover with per-wallet
 *     breakdown, ⓘ link to Solscan.
 */

interface Props {
  readonly holdings: ReadonlyArray<SpotHolding>;
  readonly hideUnknown: boolean;
  readonly hideDust: boolean;
  readonly pnlMode: 'unrealized' | 'day';
  readonly className?: string;
}

const MAX_TILES = 40;
const MIN_TILE_PX = 56;
const DUST_USD_THRESHOLD = 0.5;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  'EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o',
  'USDrbBQwQbQ2oWHUPfA8QBHcyVxKUq1xHyXsSLKdUq2',
]);

type TileKind = 'holding' | 'unknown' | 'dust' | 'other';

interface Tile {
  readonly kind: TileKind;
  readonly key: string;
  readonly holding?: SpotHolding;
  readonly children?: ReadonlyArray<SpotHolding>;
  readonly valueUsd: number;
  readonly count: number;
}

export function TokenTreemap(props: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const router = useRouter();
  const setMultiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.setMultiSelectedWalletAccountIds,
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        w: Math.max(0, Math.floor(entry.contentRect.width)),
        h: Math.max(0, Math.floor(entry.contentRect.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo<ReadonlyArray<Tile>>(() => {
    // 1. Split incoming holdings by kind. "Already sold" (amount=0)
    //    holdings are filtered out at the API level, but we defend
    //    again here so a stale fetch never shows zero-balance lines.
    const live = props.holdings.filter((h) => h.amount_ui > 0);
    const knownPriced = live.filter(
      (h) =>
        h.bucket !== 'unknown' && h.value_usd !== null && h.value_usd > 0,
    );
    const knownUnpriced = live.filter(
      (h) => h.bucket !== 'unknown' && h.value_usd === null,
    );
    const unknown = props.hideUnknown
      ? []
      : live.filter((h) => h.bucket === 'unknown');

    // 2. Apply dust threshold to KNOWN priced tokens only. Unknowns
    //    never collapse — they each represent a distinct security
    //    risk the user might want to look at.
    const dust = props.hideDust
      ? knownPriced.filter((h) => (h.value_usd ?? 0) < DUST_USD_THRESHOLD)
      : [];
    const mainKnown = props.hideDust
      ? knownPriced.filter((h) => (h.value_usd ?? 0) >= DUST_USD_THRESHOLD)
      : knownPriced;

    mainKnown.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));

    const out: Tile[] = [];
    const topK = mainKnown.slice(0, MAX_TILES);
    for (const h of topK) {
      out.push({
        kind: 'holding',
        key: `h-${h.mint}`,
        holding: h,
        valueUsd: h.value_usd ?? 0,
        count: 1,
      });
    }

    const overflowKnown = mainKnown.slice(MAX_TILES);
    if (overflowKnown.length > 0) {
      const sum = overflowKnown.reduce((s, h) => s + (h.value_usd ?? 0), 0);
      out.push({
        kind: 'other',
        key: '__other__',
        children: overflowKnown,
        valueUsd: sum,
        count: overflowKnown.length,
      });
    }

    if (dust.length > 0) {
      // Dust always renders at the bottom-right because squarify
      // packs smallest last; here we just contribute its true USD
      // value (already small) so the layout stays honest.
      const sum = dust.reduce((s, h) => s + (h.value_usd ?? 0), 0);
      out.push({
        kind: 'dust',
        key: '__dust__',
        children: dust,
        valueUsd: sum,
        count: dust.length,
      });
    }

    // 3. Knowns that have NO price (long-tail pump.fun the user
    //    actually swapped into). Render each as a real tile with a
    //    synthetic value so the user sees what they own, even though
    //    we can't put a $ value on it.
    if (knownUnpriced.length > 0) {
      const placeholder = pricedAreaShare(out) * 0.04;
      for (const h of knownUnpriced) {
        out.push({
          kind: 'holding',
          key: `u-${h.mint}`,
          holding: h,
          valueUsd: Math.max(0.01, placeholder),
          count: 1,
        });
      }
    }

    // 4. Unknown / airdrop tiles. Each gets its own square so the
    //    user can see what they're holding, with red warning chrome.
    //    We give each one a SMALL fixed area share so a flood of
    //    spam mints doesn't crowd out real holdings.
    if (unknown.length > 0) {
      const placeholder = Math.max(0.005, pricedAreaShare(out) * 0.02);
      const limited = unknown.slice(0, 20);
      for (const h of limited) {
        out.push({
          kind: 'unknown',
          key: `x-${h.mint}`,
          holding: h,
          valueUsd: placeholder,
          count: 1,
        });
      }
      if (unknown.length > limited.length) {
        out.push({
          kind: 'unknown',
          key: '__unknown_more__',
          children: unknown.slice(limited.length),
          valueUsd: placeholder,
          count: unknown.length - limited.length,
        });
      }
    }

    return out;
  }, [props.holdings, props.hideUnknown, props.hideDust]);

  const rects = useMemo(() => {
    if (size.w <= 0 || size.h <= 0 || tiles.length === 0) {
      return tiles.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
    }
    return squarify({
      values: tiles.map((t) => t.valueUsd),
      width: size.w,
      height: size.h,
    });
  }, [size, tiles]);

  return (
    <div
      ref={containerRef}
      className={props.className ?? ''}
      style={containerStyle}
    >
      {tiles.length === 0 ? (
        <div style={emptyStateStyle}>No holdings.</div>
      ) : (
        tiles.map((tile, i) => {
          const r = rects[i]!;
          if (r.w < 2 || r.h < 2) return null;
          return (
            <TreemapTile
              key={tile.key}
              tile={tile}
              rect={r}
              popDelayMs={Math.min(i, 22) * 24}
              pnlMode={props.pnlMode}
              onClick={() => {
                if (tile.kind === 'holding' && tile.holding) {
                  openHoldingInTrade(tile.holding, setMultiSelectedWalletAccountIds, router.push);
                }
                if (tile.kind === 'unknown' && tile.holding) {
                  // Unknown tiles open the trade page too — the user
                  // can inspect the mint and decide what to do.
                  openHoldingInTrade(tile.holding, setMultiSelectedWalletAccountIds, router.push);
                }
              }}
            />
          );
        })
      )}
    </div>
  );
}

interface TileProps {
  readonly tile: Tile;
  readonly rect: { x: number; y: number; w: number; h: number };
  /** Entrance stagger: tiles spring in by rank (see .spot-tile-pop). */
  readonly popDelayMs: number;
  readonly pnlMode: 'unrealized' | 'day';
  readonly onClick: () => void;
}

function TreemapTile({ tile, rect, popDelayMs, pnlMode, onClick }: TileProps): React.ReactElement {
  const [hover, setHover] = useState(false);
  const big = rect.w >= MIN_TILE_PX && rect.h >= MIN_TILE_PX;
  const medium = rect.w >= 84 && rect.h >= 48;
  const small = rect.w < 80 || rect.h < 40;
  const tiny = rect.w < 56 || rect.h < 32;

  const ariaLabel = makeAriaLabel(tile);
  const background = backgroundFor(tile, pnlMode);
  const borderColor = borderFor(tile, hover);

  return (
    <button
      type="button"
      className="spot-tile-pop"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-label={ariaLabel}
      style={{
        ...({ '--tp': `${popDelayMs}ms` } as CSSProperties),
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: Math.max(0, rect.w - 1),
        height: Math.max(0, rect.h - 1),
        padding: tiny ? '2px 4px' : small ? '4px 6px' : '8px 10px',
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        color: 'var(--ink-0)',
        fontFamily: 'var(--sans)',
        textAlign: 'left',
        cursor:
          tile.kind === 'holding' || tile.kind === 'unknown'
            ? 'pointer'
            : 'default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        gap: tiny ? 0 : 3,
        overflow: 'hidden',
        outline: 'none',
        transition:
          'border-color 100ms ease, transform 120ms cubic-bezier(.2,.7,.4,1), box-shadow 120ms ease',
        transform:
          hover && (tile.kind === 'holding' || tile.kind === 'unknown')
            ? 'translateY(-2px) scale(1.012)'
            : undefined,
        boxShadow: hover
          ? `0 10px 26px rgba(0, 0, 0, 0.32), 0 0 0 1px ${borderColor}, 0 0 18px -6px ${borderColor}, inset 0 1px 0 rgba(255,255,255,0.07)`
          : 'inset 0 1px 0 rgba(255,255,255,0.045)',
        zIndex: hover ? 3 : 1,
      }}
    >
      <TileContent tile={tile} big={big} medium={medium} small={small} tiny={tiny} pnlMode={pnlMode} />
      {hover && tile.kind === 'holding' && tile.holding ? (
        <TilePopover holding={tile.holding} rect={rect} kind="holding" />
      ) : null}
      {hover && tile.kind === 'unknown' && tile.holding ? (
        <TilePopover holding={tile.holding} rect={rect} kind="unknown" />
      ) : null}
      {hover && tile.kind === 'other' && tile.children ? (
        <RollupPopover
          title={`${tile.count} smaller holdings`}
          items={tile.children}
          rect={rect}
          accent="var(--ink-2)"
        />
      ) : null}
      {hover && tile.kind === 'dust' && tile.children ? (
        <RollupPopover
          title={`${tile.count} dust holdings`}
          items={tile.children}
          rect={rect}
          accent="var(--ink-3)"
        />
      ) : null}
    </button>
  );
}

/**
 * Route from Spot → Trade with wallet context.
 *
 * The trade page's live balance is keyed off `selected-wallet-store`.
 * If we only navigate to `/trade/{mint}`, the previous trade wallet
 * selection may not be one of the wallets that actually holds this
 * mint, so the user sees an empty balance until manually toggling.
 *
 * Before navigation, focus the multi-wallet set to every wallet that
 * currently holds the clicked token (positive `amount_ui` in the
 * Spot snapshot). For a single-holder coin this focuses exactly that
 * wallet; for a token spread across multiple wallets, the trade page
 * opens already in multi-wallet mode with all holder wallets selected.
 */
function openHoldingInTrade(
  holding: SpotHolding,
  setMultiSelectedWalletAccountIds: (
    ids: ReadonlyArray<string>,
    fallbackPrimaryId?: string | null,
  ) => void,
  push: (href: string) => void,
): void {
  const walletIds = holding.wallet_breakdown
    .filter((b) => Number.isFinite(b.amount_ui) && b.amount_ui > 0)
    .map((b) => b.wallet_account_id);
  if (walletIds.length > 0) {
    setMultiSelectedWalletAccountIds(walletIds);
  }
  push(`/trade/${holding.mint}`);
}

// -------- tile content -------------------------------------------------

function TileContent({
  tile,
  big,
  medium,
  small,
  tiny,
  pnlMode,
}: {
  tile: Tile;
  big: boolean;
  medium: boolean;
  small: boolean;
  tiny: boolean;
  pnlMode: 'unrealized' | 'day';
}): React.ReactElement {
  if (tile.kind === 'other') {
    return (
      <>
        <div
          style={{
            fontSize: small ? 10 : 12,
            color: 'var(--ink-1)',
            fontWeight: 500,
          }}
        >
          + {tile.count} more
        </div>
        {!small ? (
          <div
            style={{
              fontFamily: 'var(--mono, ui-monospace)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 11,
              color: 'var(--ink-2)',
            }}
          >
            {formatUsd(tile.valueUsd)}
          </div>
        ) : null}
      </>
    );
  }
  if (tile.kind === 'dust') {
    return (
      <>
        <div style={{ fontSize: small ? 10 : 12, color: 'var(--ink-2)' }}>
          Dust
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>
          {tile.count} tiny holding{tile.count === 1 ? '' : 's'}
        </div>
        {!small ? (
          <div
            style={{
              fontFamily: 'var(--mono, ui-monospace)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 11,
              color: 'var(--ink-2)',
              marginTop: 'auto',
            }}
          >
            {formatUsd(tile.valueUsd)}
          </div>
        ) : null}
      </>
    );
  }
  if (tile.kind === 'unknown') {
    const h = tile.holding;
    const isRollup = !h && Array.isArray(tile.children);
    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--down)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Shield style={{ width: 10, height: 10 }} />
          {tiny ? '' : 'Unknown'}
        </div>
        {!isRollup && h ? (
          <div
            style={{
              fontSize: small ? 10 : 11,
              color: 'var(--ink-1)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {h.symbol ?? truncateMint(h.mint)}
          </div>
        ) : (
          <div style={{ fontSize: small ? 10 : 11, color: 'var(--ink-1)' }}>
            +{tile.count} more
          </div>
        )}
        {medium ? (
          <div style={{ fontSize: 9, color: 'var(--ink-3)', marginTop: 'auto' }}>
            possible airdrop · click to inspect
          </div>
        ) : null}
      </>
    );
  }
  // holding tile
  const h = tile.holding!;
  const label = h.symbol ?? truncateMint(h.mint);
  const change = pnlMode === 'unrealized' ? h.unrealized_pct : h.change_24h_pct;
  const changeLabel = pnlMode === 'unrealized' ? 'PnL' : '24h';
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        {medium ? (
          <TokenAvatar
            logo={h.logo}
            symbol={h.symbol ?? h.mint}
            size={medium ? 20 : 16}
          />
        ) : null}
        <div
          style={{
            fontSize: small ? 11 : 13,
            fontWeight: 600,
            color: 'var(--ink-0)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: 1,
          }}
        >
          {label}
        </div>
      </div>
      {!small ? (
        <div
          style={{
            fontFamily: 'var(--mono, ui-monospace)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            color: 'var(--ink-1)',
          }}
        >
          {h.value_usd === null ? '—' : formatUsd(h.value_usd)}
        </div>
      ) : null}
      {medium && change !== null ? (
        <div
          style={{
            fontFamily: 'var(--mono, ui-monospace)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 10,
            fontWeight: 600,
            color:
              change > 0
                ? 'var(--up)'
                : change < 0
                  ? 'var(--down)'
                  : 'var(--ink-3)',
          }}
        >
          {changeLabel} {change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}
          {formatPct(change)}
        </div>
      ) : null}
      {big ? (
        <div
          style={{
            fontSize: 9,
            color: 'var(--ink-3)',
            marginTop: 'auto',
            letterSpacing: '0.02em',
          }}
        >
          {h.pct_of_portfolio.toFixed(1)}% of portfolio
        </div>
      ) : null}
    </>
  );
}

// -------- token avatar (logo or initials) ------------------------------

function TokenAvatar({
  logo,
  symbol,
  size,
}: {
  logo: string | null;
  symbol: string;
  size: number;
}): React.ReactElement {
  const [errored, setErrored] = useState(false);
  const bg = stringHueColor(symbol);
  if (logo && !errored) {
    return (
      <img
        src={logo}
        alt=""
        onError={() => setErrored(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
        }}
      />
    );
  }
  const initials = (symbol || '?').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-0)',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: '-0.02em',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      {initials}
    </span>
  );
}

function stringHueColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  const hue = ((h % 360) + 360) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 32%), hsl(${(hue + 40) % 360} 65% 22%))`;
}

function isBaseCurrencyHolding(h: SpotHolding): boolean {
  return h.mint === SOL_MINT || STABLE_MINTS.has(h.mint);
}

// -------- popovers -----------------------------------------------------

function TilePopover({
  holding,
  rect,
  kind,
}: {
  holding: SpotHolding;
  rect: { x: number; y: number; w: number; h: number };
  kind: 'holding' | 'unknown';
}): React.ReactElement {
  const above = rect.y > 200;
  const warning = kind === 'unknown';
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        [above ? 'bottom' : 'top']: 'calc(100% + 6px)',
        zIndex: 10,
        background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)',
        color: 'var(--ink-0)',
        border: `1px solid ${
          warning
            ? 'color-mix(in srgb, var(--down) 50%, var(--hairline))'
            : 'var(--hairline)'
        }`,
        borderRadius: 10,
        padding: '10px 12px',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.36)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pointerEvents: 'none',
        fontFamily: 'var(--sans)',
        fontSize: 11,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        minWidth: 180,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <TokenAvatar logo={holding.logo} symbol={holding.symbol ?? holding.mint} size={20} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {holding.symbol ?? truncateMint(holding.mint)}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--mono, ui-monospace)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-2)',
          }}
        >
          {holding.value_usd === null ? '—' : formatUsd(holding.value_usd)}
        </span>
      </div>
      {warning ? (
        <div
          style={{
            color: 'var(--down)',
            fontSize: 10,
            marginBottom: 6,
            lineHeight: 1.45,
            whiteSpace: 'normal',
          }}
        >
          Unverified holding. No swap or internal-wallet origin found —
          this may be a malicious airdrop. Inspect before interacting.
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--ink-3)',
          marginBottom: 4,
        }}
      >
        <span>{holding.pct_of_portfolio.toFixed(2)}% of portfolio</span>
        {holding.change_24h_pct !== null ? (
          <span
            style={{
              color:
                holding.change_24h_pct > 0
                  ? 'var(--up)'
                  : holding.change_24h_pct < 0
                    ? 'var(--down)'
                    : 'var(--ink-3)',
              fontFamily: 'var(--mono, ui-monospace)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            24h {formatPct(holding.change_24h_pct)}
          </span>
        ) : null}
      </div>
      <div style={walletBreakdownRow}>
        <span>Basis</span>
        <span>{holding.cost_basis_usd == null ? '—' : formatUsd(holding.cost_basis_usd)}</span>
      </div>
      <div style={walletBreakdownRow}>
        <span>Unrealized</span>
        <span
          style={{
            color:
              (holding.unrealized_usd ?? 0) > 0
                ? 'var(--up)'
                : (holding.unrealized_usd ?? 0) < 0
                  ? 'var(--down)'
                  : 'var(--ink-1)',
          }}
        >
          {holding.unrealized_usd == null ? '—' : formatUsd(holding.unrealized_usd)}
          {holding.unrealized_pct != null ? ` (${formatPct(holding.unrealized_pct)})` : ''}
        </span>
      </div>
      <div style={walletBreakdownRow}>
        <span>Realized</span>
        <span
          style={{
            color:
              (holding.realized_usd ?? 0) > 0
                ? 'var(--up)'
                : (holding.realized_usd ?? 0) < 0
                  ? 'var(--down)'
                  : 'var(--ink-1)',
          }}
        >
          {holding.realized_usd == null ? '—' : formatUsd(holding.realized_usd)}
        </span>
      </div>
      {holding.cost_basis_provenance === 'imported_unknown' ? (
        <div
          style={{
            marginTop: 5,
            color: 'var(--down)',
            fontSize: 10,
            whiteSpace: 'normal',
            lineHeight: 1.35,
          }}
        >
          Basis unknown — likely external acquisition or airdrop. Unrealized PnL hidden.
        </div>
      ) : isBaseCurrencyHolding(holding) ? (
        <div
          style={{
            marginTop: 5,
            color: 'var(--ink-3)',
            fontSize: 10,
            whiteSpace: 'normal',
            lineHeight: 1.35,
          }}
        >
          Base currency — counted in portfolio value, excluded from unrealized PnL.
        </div>
      ) : null}
      <div
        style={{
          color: 'var(--ink-3)',
          marginTop: 4,
          marginBottom: 2,
        }}
      >
        {holding.wallet_breakdown.length} wallet
        {holding.wallet_breakdown.length === 1 ? '' : 's'}
      </div>
      {holding.wallet_breakdown.slice(0, 4).map((b) => (
        <div
          key={b.wallet_account_id}
          style={walletBreakdownRow}
        >
          <span>{truncateMint(b.wallet_pubkey)}</span>
          <span>{formatUsd(b.value_usd ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

function RollupPopover({
  title,
  items,
  rect,
  accent,
}: {
  title: string;
  items: ReadonlyArray<SpotHolding>;
  rect: { x: number; y: number; w: number; h: number };
  accent: string;
}): React.ReactElement {
  const above = rect.y > 200;
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        [above ? 'bottom' : 'top']: 'calc(100% + 6px)',
        zIndex: 10,
        background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)',
        color: 'var(--ink-0)',
        border: '1px solid var(--hairline)',
        borderRadius: 10,
        padding: '10px 12px',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.36)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pointerEvents: 'none',
        fontFamily: 'var(--sans)',
        fontSize: 11,
        minWidth: 200,
        overflow: 'hidden',
      }}
    >
      <div style={{ color: accent, fontSize: 10, marginBottom: 6, letterSpacing: '0.02em' }}>
        {title}
      </div>
      {items.slice(0, 6).map((h) => (
        <div key={h.mint} style={walletBreakdownRow}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {h.symbol ?? truncateMint(h.mint)}
          </span>
          <span>{formatUsd(h.value_usd ?? 0)}</span>
        </div>
      ))}
      {items.length > 6 ? (
        <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>
          and {items.length - 6} more
        </div>
      ) : null}
    </div>
  );
}

const walletBreakdownRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  color: 'var(--ink-1)',
  fontFamily: 'var(--mono, ui-monospace)',
  fontVariantNumeric: 'tabular-nums',
};

// -------- style helpers ------------------------------------------------

function backgroundFor(tile: Tile, pnlMode: 'unrealized' | 'day'): string {
  if (tile.kind === 'other') {
    return 'linear-gradient(135deg, color-mix(in srgb, var(--ink-2) 8%, transparent), color-mix(in srgb, var(--ink-2) 14%, transparent))';
  }
  if (tile.kind === 'dust') {
    return 'repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0 6px, transparent 6px 12px), color-mix(in srgb, var(--ink-3) 8%, transparent)';
  }
  if (tile.kind === 'unknown') {
    return 'linear-gradient(160deg, color-mix(in srgb, var(--down) 22%, transparent), color-mix(in srgb, var(--down) 8%, transparent))';
  }
  const h = tile.holding!;
  const change = pnlMode === 'unrealized' ? h.unrealized_pct : h.change_24h_pct;
  if (change === null) {
    return 'linear-gradient(160deg, color-mix(in srgb, var(--accent-primary) 14%, transparent), color-mix(in srgb, var(--accent-primary) 4%, transparent))';
  }
  // Map PnL to a vivid gradient with a base color from PnL + a subtle
  // top-left highlight that gives the tile depth.
  const base = pnlColor(change);
  return `linear-gradient(160deg, ${base}, color-mix(in srgb, ${base} 50%, transparent))`;
}

function borderFor(tile: Tile, hover: boolean): string {
  if (tile.kind === 'unknown') {
    return hover
      ? 'color-mix(in srgb, var(--down) 70%, transparent)'
      : 'color-mix(in srgb, var(--down) 35%, var(--hairline))';
  }
  if (hover) {
    return 'color-mix(in srgb, var(--accent-primary) 50%, transparent)';
  }
  return 'rgba(255, 255, 255, 0.06)';
}

function pricedAreaShare(tiles: ReadonlyArray<Tile>): number {
  let sum = 0;
  for (const t of tiles) {
    if (t.kind === 'holding' && t.holding && (t.holding.value_usd ?? 0) > 0) {
      sum += t.holding.value_usd ?? 0;
    }
  }
  return sum > 0 ? sum : 1;
}

function makeAriaLabel(tile: Tile): string {
  if (tile.kind === 'holding' && tile.holding) {
    const sym = tile.holding.symbol ?? truncateMint(tile.holding.mint);
    return `${sym} — ${formatUsd(tile.holding.value_usd)} (${formatPct(
      tile.holding.change_24h_pct,
    )})`;
  }
  if (tile.kind === 'unknown' && tile.holding) {
    return `Unknown token ${
      tile.holding.symbol ?? truncateMint(tile.holding.mint)
    } — potential airdrop, inspect before interacting`;
  }
  if (tile.kind === 'other') {
    return `${tile.count} more holdings, ${formatUsd(tile.valueUsd)} total`;
  }
  if (tile.kind === 'dust') {
    return `${tile.count} dust holdings under $${DUST_USD_THRESHOLD}, ${formatUsd(tile.valueUsd)} total`;
  }
  return '';
}

const containerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  overflow: 'hidden',
  background:
    'radial-gradient(110% 60% at 50% -10%, color-mix(in srgb, var(--accent-primary) 6%, transparent), transparent 70%), var(--surface-1, rgba(255,255,255,0.02))',
};

const emptyStateStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-3)',
  fontSize: 13,
};

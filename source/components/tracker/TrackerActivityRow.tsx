'use client';

import { memo } from 'react';
import { hrefForToken, navigateToToken, prefetchToken } from '@/components/listen/navigation';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { SolMark } from '@/components/discover/column/sol';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import { formatSolTerse, solFromLamports, solSpoken } from '@/components/discover/formatSol';
import { MC_UNKNOWN, formatMcCompact } from '@/components/discover/formatMc';
import { tradeMarketCapUsd } from '@/components/discover/walletToastPresentation';
import { getSolUsdHint } from '@/lib/state/sol-usd-hint';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';
import type { TapeCols } from './TapeColumns';
import './tracker-row.css';

/**
 * One pump.fun trade by a tracked wallet:
 *
 *   16h  🐷 whale one   [art] GOAT   ◎ 68.2   $12M
 *
 * The row IS the side. Both a buy and a sell take a wash of their own
 * colour, hard enough to read as a band on a black ground, and the
 * wallet's name on top of it carries the same colour — so nothing here
 * needs a tick, an arrow or a badge to say which way the trade went. The
 * two figures stay white: they are the same kind of fact on every row
 * and belong to no side, and a third hue would only compete with the two
 * that mean something.
 *
 * Which cells appear is the reader's choice — see `TapeColumns`. The
 * grid template is set once on the list from the same set, so a hidden
 * column takes its track with it.
 *
 * ── THE ROW GOES NOWHERE ─────────────────────────────────────────────
 *
 * The whole row used to be one anchor to the token, which made every
 * pixel of a scrolling tape a navigation waiting to happen — including
 * the dead air between columns. Two things on it are links now and they
 * are the two things that name something: the TICKER opens the token
 * (a real `<a href>`, so a click before hydration falls back to browser
 * navigation and a middle click still opens a tab), and the NAME opens
 * the wallet. Both underline under the pointer, which is the whole of
 * how you know. Everything else is text.
 *
 * Memoized: an SSE trade prepends rows without re-rendering the retained
 * ones; `ageTick` is the parent's coarse interval so ages keep moving on
 * a quiet feed.
 */
export const TrackerActivityRow = memo(function TrackerActivityRow({
  event,
  walletLabel,
  walletEmoji,
  ticker,
  cols,
  ageTick,
}: {
  event: WalletActivityEvent;
  walletLabel: string;
  walletEmoji: string | undefined;
  ticker: string | null;
  cols: TapeCols;
  ageTick: number;
}) {
  void ageTick; // re-render trigger only — age recomputes from Date.now()
  const tone = event.isBuy ? 'var(--up)' : 'var(--down)';
  const ageMs = Math.max(0, Date.now() - (event.blockTimeMs ?? event.receivedAtMs));
  const art = useResolvedTokenImage(ingestionTokenImageUrl(event.mint), null, event.mint);
  const whale = (solFromLamports(event.solLamports) ?? 0) > 50;
  const spokenAmount = solSpoken(event.solLamports);
  const mcUsd = tradeMarketCapUsd(event, getSolUsdHint());
  const mc = formatMcCompact(mcUsd);

  return (
    <div className="tr-row" data-side={event.isBuy ? 'buy' : 'sell'} title={`${event.signature.slice(0, 16)}…`}>
      {cols.age ? <span className="tr-age">{formatAge(ageMs)}</span> : null}

      {cols.name ? (
        <span className="tr-who">
          {/* An untracked-looking wallet used to get the first LETTER of
              its label in this circle — a `7` or a `T` off a base58
              address, which reads as a broken avatar rather than as a
              wallet with no mark set. The default is the same face the
              emoji picker offers as its own placeholder, dimmed. */}
          <span className="tr-pfp" data-blank={walletEmoji ? undefined : ''} aria-hidden>
            {walletEmoji ?? '🙂'}
          </span>
          {/* The row opens the token; the name opens the wallet. */}
          <button
            type="button"
            className="tr-name"
            style={{ color: tone }}
            title={`Open ${event.wallet} profile`}
            onClick={() => openWalletProfile(event.wallet)}
          >
            {walletLabel}
          </button>
        </span>
      ) : null}

      {cols.token ? (
        <span className="tr-tok">
          <span className="tr-shot">
            <img className="tr-art" src={art.src} onError={art.onError} onLoad={art.onLoad} alt="" loading="lazy" draggable={false} />
            {/* This tape is pump.fun activity — every row on it launched
                there — so the corner mark is not a guess. */}
            <img className="tr-pad" src="/assets/launchpads/pumpfun.png" alt="" aria-hidden draggable={false} />
          </span>
          <a
            className="tr-ticker"
            data-unknown={ticker ? undefined : ''}
            href={hrefForToken(event.mint)}
            draggable={false}
            title={ticker ? `Open ${ticker}` : 'Open token'}
            onPointerEnter={() => prefetchToken(event.mint)}
            onClick={(e) => {
              // Modifier and middle clicks keep native anchor behaviour.
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigateToToken(event.mint);
            }}
          >
            {ticker ?? 'unknown'}
          </a>
        </span>
      ) : null}

      {/* The unit is Solana's mark, never the word, sized to the digits so
          the pair reads as one thing. `aria-label` keeps the spoken form. */}
      {cols.amount ? (
        <span className="tr-size" style={{ color: tone }} data-whale={whale ? '' : undefined} aria-label={spokenAmount} title={spokenAmount}>
          <SolMark size={9.5} />
          {formatSolTerse(event.solLamports)}
        </span>
      ) : null}

      {cols.mc ? (
        <span className="tr-mc" title={mc === MC_UNKNOWN ? 'market cap unknown' : `market cap $${mc}`}>
          {mc === MC_UNKNOWN ? mc : `$${mc}`}
        </span>
      ) : null}
    </div>
  );
});

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

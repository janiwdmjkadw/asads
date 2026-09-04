import type { CSSProperties, ReactNode } from 'react';
import { TweetHoverCard } from '@/components/tweet/TweetHoverCard';
import { hoverTweetId } from '@/lib/api/tweet';
import { Eye, Usdc } from '@/components/listen/icons/Icons';
import { compactNumber } from '@/lib/format';
import { useViewersCount } from '@/lib/state/viewers-store';
import { useWatchlist } from '@/components/watchlist/useWatchlist';
import { isValidWatchMint } from '@/lib/api/watchlist';
import { isUsdcPair } from '@/lib/trade/spend-currency';
import type { MockToken } from './mockTrade';

interface Props {
  token: MockToken;
}

/**
 * Token meta cluster — sits between the ticker/name and the central
 * stats grid in TokenHeaderBar. Replaces the Discover-page MetaRow with
 * a trade-specific layout: an age pill, optional token-kind badges, and
 * colored hover-tinted action icons (twitter / website / telegram / copy / pump).
 *
 * Each icon hovers to its assigned tint via `color-mix` against the
 * surface so we don't need per-icon className variants.
 */
export function TokenMetaRow({ token }: Props) {
  return (
    <div className="inline-flex shrink-0 items-center gap-2">
      <span
        className="t-num-xs inline-flex h-[24px] items-center rounded-full px-2.5"
        style={{
          color: 'var(--ink-1)',
          background: 'var(--chip-bg)',
          border: '1px solid var(--chip-border, var(--hairline))',
          letterSpacing: '0.02em',
        }}
      >
        {token.ageLabel}
      </span>

      {/* USDC-quoted pair marker: buys spend USDC, sells receive USDC.
          Circle USDC mark, matching the discover-card meta row. */}
      {isUsdcPair(token.quoteMint) ? (
        <span
          className="inline-flex h-[18px] shrink-0 items-center"
          title="USDC-quoted pair"
        >
          <Usdc style={{ width: 14, height: 14, display: 'block' }} />
        </span>
      ) : null}

      <div className="inline-flex items-center gap-[3px]">
        {token.isMayhem ? (
          <MetaStatusIcon label="Mayhem mode" tint="#86efac" assetSrc="/assets/mayham_icon.svg" />
        ) : null}
        {token.isCashback ? (
          <MetaStatusIcon
            label="Cashback mode"
            tint="#5ddf6c"
            assetSrc="/assets/cashback_icon.svg"
          />
        ) : null}
        <ViewersChip mint={token.mintAddress} />
        {token.twitterUrl ? <TwitterMeta url={token.twitterUrl} /> : null}
        {token.websiteUrl ? (
          <MetaActionButton
            label="Open website"
            tint="#22c77e"
            onClick={() => openExternal(token.websiteUrl)}
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
          </MetaActionButton>
        ) : null}
        {token.telegramUrl ? (
          <MetaActionButton
            label="Open Telegram"
            tint="#a78bfa"
            onClick={() => openExternal(token.telegramUrl)}
          >
            <path d="M21 3L3 10.5l6.5 2.5L12 21l3.5-6.5L21 3z" />
            <path d="M9.5 13L21 3" />
          </MetaActionButton>
        ) : null}
        <WatchStarButton mint={token.mintAddress} />
        <MetaActionButton
          label="Copy contract"
          tint="#38e1ff"
          onClick={() => copyText(token.mintAddress)}
        >
          <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5" />
          <path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07L12.5 19.5" />
        </MetaActionButton>
        <MetaActionButton
          label="Open pump.fun"
          tint="#60cb8b"
          assetSrc="/assets/pump_icon.svg"
          assetSize={14}
          onClick={() => openExternal(`https://pump.fun/${token.mintAddress}`)}
        />
      </div>
    </div>
  );
}

/**
 * Live viewer count (presence): a small eye + number, fed by the
 * per-mint stream's `viewers` events and this client's own beat
 * responses via the viewers store. Hidden until a count is known —
 * absent data must never render as "0 watching".
 */
function ViewersChip({ mint }: { mint: string }) {
  const viewers = useViewersCount(mint || null);
  if (viewers === null || viewers <= 0) return null;
  return (
    <span
      className="t-num-xs inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full px-2"
      title={`${viewers.toLocaleString()} watching now`}
      style={{
        color: 'var(--ink-1)',
        background: 'var(--chip-bg)',
        border: '1px solid var(--chip-border, var(--hairline))',
        letterSpacing: '0.02em',
      }}
    >
      <Eye style={{ width: 12, height: 12, color: 'var(--ink-3)', flexShrink: 0 }} />
      {compactNumber(viewers)}
    </span>
  );
}

/**
 * Watchlist star — toggles the current coin in the per-user watchlist
 * (the navbar strip's star mode). Filled while watched. Hidden for stub
 * frames (empty/invalid mint) so a not-yet-resolved page can never write
 * a bogus row.
 */
function WatchStarButton({ mint }: { mint: string }) {
  const watchlist = useWatchlist();
  if (!isValidWatchMint(mint)) return null;
  // Signed-out: the list is per-user, so a star would only flicker
  // (optimistic fill → 401 → rollback). Hide it rather than tease it.
  if (!watchlist.signedIn) return null;
  const watched = watchlist.mintSet.has(mint);
  const blocked = !watched && watchlist.atCap;
  const label = watched
    ? 'Remove from watchlist'
    : blocked
      ? 'Watchlist is full'
      : 'Add to watchlist';
  return (
    <MetaActionButton
      label={label}
      tint="#fbbf24"
      onClick={() => {
        if (watched) {
          watchlist.remove(mint);
          return;
        }
        if (blocked) return;
        void watchlist.add(mint).catch(() => undefined);
      }}
    >
      <path
        d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3z"
        fill={watched ? 'currentColor' : 'none'}
      />
    </MetaActionButton>
  );
}

/**
 * Twitter slot. When the link is a specific `/status/<id>` tweet, the X
 * icon becomes the rich tweet-preview hover trigger (click still opens
 * X). Profile / community links keep the plain action button.
 */
function TwitterMeta({ url }: { url: string }) {
  const tweetId = hoverTweetId(url);
  if (!tweetId) {
    return (
      <MetaActionButton
        label="Open Twitter"
        tint="#36d8ff"
        assetSrc="/assets/blue_tweet_icon.svg"
        onClick={() => openExternal(url)}
      />
    );
  }
  const shellStyle: MetaTintStyle = {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: 'var(--r-sm)',
    color: '#36d8ff',
    '--meta-tint': '#36d8ff',
    cursor: 'pointer',
  };
  return (
    <TweetHoverCard tweetId={tweetId} tweetUrl={url}>
      <button
        type="button"
        aria-label="Preview tweet"
        title="Preview tweet"
        className="meta-hover-shell inline-flex items-center justify-center"
        style={shellStyle}
        onClick={() => openExternal(url)}
      >
        <IconGlyph assetSrc="/assets/blue_tweet_icon.svg" assetSize={14} />
      </button>
    </TweetHoverCard>
  );
}

interface BtnProps {
  label: string;
  tint: string;
  onClick: () => void;
  children?: ReactNode;
  assetSrc?: string;
  assetSize?: number;
}

type MetaTintStyle = CSSProperties & { '--meta-tint': string };

function MetaActionButton({ label, tint, onClick, children, assetSrc, assetSize = 14 }: BtnProps) {
  /* The shared hover class reads this per-icon tint without allocating
     mouse handlers or writing multiple DOM style fields per hover. */
  const shellStyle: MetaTintStyle = {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: 'var(--r-sm)',
    color: tint,
    '--meta-tint': tint,
    cursor: 'pointer',
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="meta-hover-shell inline-flex items-center justify-center"
      onClick={onClick}
      style={shellStyle}
    >
      <IconGlyph assetSrc={assetSrc} assetSize={assetSize}>
        {children}
      </IconGlyph>
    </button>
  );
}

function MetaStatusIcon({
  label,
  tint,
  assetSrc,
  assetSize = 14,
}: {
  label: string;
  tint: string;
  assetSrc: string;
  assetSize?: number;
}) {
  const shellStyle: MetaTintStyle = {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: 'var(--r-sm)',
    color: tint,
    '--meta-tint': tint,
  };

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="meta-hover-shell inline-flex items-center justify-center"
      style={shellStyle}
    >
      <IconGlyph assetSrc={assetSrc} assetSize={assetSize} />
    </span>
  );
}

function IconGlyph({
  assetSrc,
  assetSize,
  children,
}: {
  assetSrc?: string;
  assetSize: number;
  children?: ReactNode;
}) {
  if (assetSrc) {
    return (
      <img
        src={assetSrc}
        alt=""
        aria-hidden
        width={assetSize}
        height={assetSize}
        style={{ display: 'block' }}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function openExternal(url: string | null) {
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function copyText(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(value);
}

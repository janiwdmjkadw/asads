'use client';

import {
  memo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { HairlineDivider } from '@/components/listen/primitives';
import { hrefForToken, navigateToToken } from '@/components/listen/navigation';
import {
  openInNewTab,
  useCardLinkInteractions,
  wantsNewTab,
} from '@/components/discover/cardLinkInteractions';
import { Card } from '@/components/ui/card';
import { useResolvedTokenImage } from '@/lib/token-image';
import { compactNumber } from '@/lib/format';
import { formatSinceCallPct } from '@/lib/api/alpha-calls-shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { useTrackedWalletsContext } from './TrackedWalletsProvider';
import type { AlphaCoin } from './mockCoins';
import { MetaRow, IconRow } from './CardMetaRows';
import { TokenImagePreview } from './TokenImagePreview';
import { TickerActionsPopover } from './TickerActionsPopover';
import { ThesisText } from './ThesisText';
import { EditThesisDialog } from './EditThesisDialog';
import { useQuickbuy } from './useQuickbuy';
import { isFeedScrollActive } from './feedNavigationPause';

interface Props {
  /** Live lane items carry the mint as `id` (LiveAlphaCoin); without it
      the card renders inert — no navigation, no quickbuy. */
  coin: AlphaCoin & { id?: string };
  /** One-shot attention flash for a freshly-pushed call (see discover.css
      `.card-attention-flash`). Pairs with the bell in attentionSounds. */
  flash?: boolean;
}

/**
 * "Called by" attribution: a handle chip for THIS card's caller (every
 * call renders its own card, anchored to its own thesis / age / %
 * baseline), plus — on calls after a mint's first — a `#N` sequence
 * marker whose hover attributes the FIRST call (who, when, at what MC).
 * Chrome mirrors CoinCard's HandleRow chip so the two card families
 * read as one system.
 */
function CalledByChip({
  handle,
  callSequence,
  firstCall,
}: {
  handle: string;
  callSequence?: number;
  firstCall?: { caller: string; ageLabel: string; marketCap: string | null } | null;
}) {
  const trackedWallets = useTrackedWalletsContext();
  const first = handle.replace(/^@/, '');
  // Wallet-followed callers display the viewer's tracked label verbatim —
  // resolve it back to the address so the chip opens the wallet profile.
  // Slugged callers have no wallet to resolve; their chip stays inert.
  const callerWallet = trackedWallets.wallets.find(
    (wallet) => wallet.label?.trim() === first,
  );
  const chip = (
    <span
      role={callerWallet ? 'button' : undefined}
      tabIndex={callerWallet ? 0 : undefined}
      onClick={
        callerWallet
          ? (e) => {
              e.stopPropagation();
              openWalletProfile(callerWallet.address);
            }
          : undefined
      }
      onPointerDown={callerWallet ? (e) => e.stopPropagation() : undefined}
      onKeyDown={
        callerWallet
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                openWalletProfile(callerWallet.address);
              }
            }
          : undefined
      }
      title={callerWallet ? `Open ${callerWallet.address} profile` : undefined}
      className={`inline-flex items-center h-[18px] px-[6px] rounded text-[10px] leading-none whitespace-nowrap min-w-0 max-w-[110px]${callerWallet ? ' cursor-pointer hover:underline' : ''}`}
      style={{
        color: 'var(--ink-1)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--hairline)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        fontWeight: 500,
        fontFamily: 'var(--mono)',
      }}
    >
      <span className="truncate">@{first}</span>
    </span>
  );
  const isRecall = typeof callSequence === 'number' && callSequence > 1 && firstCall != null;
  if (!isRecall) {
    return (
      <span aria-label={`Called by @${first}`} className="inline-flex min-w-0 shrink-0">
        {chip}
      </span>
    );
  }
  const firstCallLine = `First called by @${firstCall.caller} · ${firstCall.ageLabel} ago${
    firstCall.marketCap ? ` @ ${firstCall.marketCap}` : ''
  }`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Call #${callSequence} — ${firstCallLine}`}
          className="inline-flex items-center gap-[4px] min-w-0 shrink-0"
        >
          {chip}
          <span
            className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-[4px] rounded-full text-[10px] leading-none tabular-nums shrink-0"
            style={{
              color: 'var(--accent-primary)',
              background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-primary) 40%, var(--hairline))',
              fontFamily: 'var(--mono)',
              fontWeight: 600,
            }}
          >
            #{callSequence}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{firstCallLine}</TooltipContent>
    </Tooltip>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 13, height: 13, display: 'block' }}
      aria-hidden
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function Stat({
  label, value, color,
}: {
  label: string; value: string; color: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span
        className="text-[8px] uppercase"
        style={{ color: 'var(--ink-3)', letterSpacing: '0.14em' }}
      >
        {label}
      </span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </span>
  );
}

export const AlphaCard = memo(function AlphaCard({ coin, flash = false }: Props) {
  // identityKey arms the painted-src latch (see useResolvedTokenImage):
  // feed-frame image upgrades must not reflash an already-painted image.
  const {
    src: imageSrc,
    onError: onImageError,
    onLoad: onImageLoad,
  } = useResolvedTokenImage(coin.imageUrl, null, coin.ticker || null);
  const mint = coin.id;
  /* Quickbuy submit + trade-page prewarm shared with CoinCard (same
     gates: navigation only needs a mint; the buy button also needs a
     configured per-section amount). Graduation / quote-mint markers come
     from the live stats poll (useAlphaLiveStats); until the first tick
     lands they're absent, and omitting them lets api/ resolve the route
     itself (the flag only force-disables bonding-curve routing when true). */
  const {
    hasMint,
    quickbuyEnabled,
    quickBuyAmountSol,
    usdcDollars,
    handleQuickbuy,
    prewarmNow,
    startHeartbeat,
    stopHeartbeat,
    visibleRef,
  } = useQuickbuy(
    {
      mint,
      ticker: coin.ticker,
      name: coin.name,
      graduated: coin.graduated === true,
      quoteMint: coin.quoteMint ?? null,
    },
    'alpha',
  );
  const clickable = hasMint;
  const startPointerHeartbeat = useCallback(() => {
    // Alpha cards sweep under a stationary cursor in the vertical lane just
    // like standard cards. Do not turn those incidental enters into trade
    // prewarm work on the scroll frame; focus/pointer-down remain deliberate.
    if (!isFeedScrollActive()) startHeartbeat();
  }, [startHeartbeat]);
  const navigate = () =>
    navigateToToken(mint!, {
      name: coin.name,
      symbol: coin.ticker.replace(/^\$/, ''),
      imageUrl: coin.imageUrl || null,
      // Snapshot gaps render as '—' placeholders — don't persist those
      // into the navigation-hint memory.
      marketCap: coin.marketCap === '—' ? null : coin.marketCap,
      txns: coin.txns || null,
      sourceSection: 'alpha',
      quoteMint: coin.quoteMint ?? null,
    });
  // Browser-link affordances: right-click, middle-click and
  // modifier-click open the trade page in a new tab (see CoinCard).
  const cardLink = useCardLinkInteractions({
    href: clickable ? hrefForToken(mint!) : null,
  });
  const onCardKeyDown = clickable
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        // Only handle keys aimed at the card itself. Focusable descendants
        // (the quickbuy button, MetaRow links) own their Enter/Space
        // activation — see CoinCard for the rationale.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate();
        }
      }
    : undefined;
  /* Submit at pointerdown instead of click (mirrors CoinCard's
     QuickbuyScoreArea): a click waits for pointer-up, paying the
     60-120ms press duration on the order's critical path. The timestamp
     suppresses only the synthetic click of the SAME physical press. */
  const pointerFiredAtRef = useRef(0);
  // Edit-my-thesis: only the anchoring call's author sees the pencil.
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = coin.isMine === true && typeof coin.callId === 'string';
  /* Aria label drops the amount fragment when no amount is configured —
     screen readers shouldn't announce "Quick buy null SOL". */
  const quickbuyAriaLabel =
    usdcDollars != null
      ? `Quick buy $${usdcDollars} of ${coin.ticker}`
      : quickBuyAmountSol == null
        ? `Quick buy ${coin.ticker} (set amount above)`
        : `Quick buy ${quickBuyAmountSol} SOL of ${coin.ticker}`;
  return (
    /* shadcn Card primitive — see CoinCard for rationale. Card's
       defaults (`rounded-xl border bg-card shadow`) are reset via the
       explicit utilities below; the bespoke alpha chrome (cyan border,
       parchment / dark gradients, cinnabar halos) keeps coming from
       `discover.css` + the inline style overrides. `group/coin` drives
       the same hover score→quickbuy morph the standard cards use. */
    <Card
      ref={visibleRef}
      className="@container alpha-card group/coin flex h-[var(--card-h-alpha)] flex-col rounded-[14px] overflow-hidden relative border-0 bg-transparent shadow-none p-0"
      style={{
        background: 'var(--alpha-card-bg)',
        border: '1px solid var(--alpha-card-border)',
        boxShadow: 'var(--alpha-card-shadow)',
        cursor: clickable ? 'pointer' : undefined,
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? (e: ReactMouseEvent<HTMLDivElement>) => {
              if (wantsNewTab(e)) {
                openInNewTab(hrefForToken(mint!));
                return;
              }
              navigate();
            }
          : undefined
      }
      onPointerDown={clickable ? prewarmNow : undefined}
      onPointerEnter={clickable ? startPointerHeartbeat : undefined}
      onPointerLeave={clickable ? stopHeartbeat : undefined}
      onFocus={clickable ? startHeartbeat : undefined}
      onBlur={clickable ? stopHeartbeat : undefined}
      onKeyDown={onCardKeyDown}
      {...cardLink.linkProps}
      aria-label={clickable ? `Open ${coin.ticker} trade page` : undefined}
    >
      {flash ? <span className="card-attention-flash" aria-hidden /> : null}
      {canEdit ? (
        <EditThesisDialog
          callId={coin.callId!}
          ticker={coin.ticker}
          initialThesis={coin.description}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
      {/* Every VERTICAL spacing in the alpha card is pinned to a whole
          pixel. The bottom group (MetaRow / hairline / IconRow) is
          `mt-auto`-pinned to the bottom of this container, so its Y
          position is derived from `pb-*` and the inner gaps. Tailwind's
          fractional spacing (e.g. `gap-1.5` = 5.25px at the app's 14px
          root) made the IconRow land at a fractional Y, which is what
          made its icons render inconsistently inside the alpha row. */}
      <div className="flex-1 min-h-0 flex flex-col gap-[6px] px-3 pt-[12px] pb-[6px] relative z-[1]">
        <div className="flex items-start gap-2.5 min-w-0">
          <TokenImagePreview src={imageSrc} alt={coin.ticker}>
            <div
              className="token-preview-trigger token-img relative shrink-0 rounded-[7px] overflow-hidden"
              style={{
                width: 'var(--image-alpha)',
                height: 'var(--image-alpha)',
              }}
            >
              <img
                src={imageSrc}
                alt={coin.ticker}
                loading="lazy"
                className="w-full h-full object-cover"
                style={{ background: 'var(--surface-3)' }}
                onError={onImageError}
                onLoad={onImageLoad}
              />
            </div>
          </TokenImagePreview>

          <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
            <span
              className="text-[13px] font-semibold leading-none truncate"
              style={{ color: 'var(--ink-0)', letterSpacing: '0.03em' }}
            >
              {coin.ticker}
            </span>
            <span
              className="text-[11px] italic leading-none truncate"
              style={{ fontFamily: 'var(--display)', color: 'var(--ink-3)' }}
            >
              {coin.name}
            </span>
            {mint ? (
              <span className="self-center shrink-0 inline-flex">
                <TickerActionsPopover
                  mint={mint}
                  ticker={coin.ticker.replace(/^\$/, '') || coin.name}
                />
              </span>
            ) : null}
          </div>

          <div className="shrink-0 flex flex-col items-end gap-[4px] font-mono tabular-nums leading-none">
            {/* Color hierarchy mirrors Trade's center stats:
                V    -> cyan   (matches LIQUIDITY)
                MC   -> green  (matches ATH)
                CALL -> green/red MC performance since the call was posted
                        (em-dash ink until the live stats poll lands)
                TX   -> green/red based on score >= 7 (active flow tone)
                V / MC / TX refresh live from useAlphaLiveStats. */}
            <div className="flex gap-2 text-[12px]">
              <Stat label="V" value={coin.volume} color="var(--accent-primary)" />
              <Stat label="MC" value={coin.marketCap} color="var(--up)" />
            </div>
            <div className="flex gap-2 text-[10px]">
              <Stat
                label="CALL"
                value={coin.sinceCallPct == null ? '—' : formatSinceCallPct(coin.sinceCallPct)}
                color={
                  coin.sinceCallPct == null
                    ? 'var(--ink-3)'
                    : coin.sinceCallPct >= 0
                      ? 'var(--up)'
                      : 'var(--down)'
                }
              />
              <Stat label="TX" value={compactNumber(coin.txns)} color={coin.score >= 7 ? 'var(--up)' : 'var(--down)'} />
            </div>
          </div>
        </div>

        <p
          className="text-[11px] italic leading-[1.35] m-0 overflow-hidden"
          style={{
            fontFamily: 'var(--display)',
            color: 'var(--ink-1)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {/* x.com links render as inline TWEET chips where they were typed. */}
          <ThesisText text={coin.description} />
        </p>

        <div className="mt-auto w-fit max-w-full flex flex-col gap-[4px]">
          {/* MetaRow (age + twitter/pump/telegram/website icons, live
              links from the stats poll) shares its line with the caller
              attribution chip; MetaRow truncates first, the chip holds. */}
          <div className="flex items-center gap-[6px] min-w-0">
            <MetaRow coin={coin} size="md" />
            {/* Pencil — edit my thesis. Lives on the link-icon line (same
                22px meta-shell chrome as the twitter/pump buttons); every
                pointer path stops propagation so the card never navigates
                or prewarm-fires on an edit press. */}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Edit your ${coin.ticker} thesis`}
                title="Edit thesis"
                className="meta-hover-shell inline-flex items-center justify-center shrink-0"
                style={
                  {
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    color: '#e5e7eb',
                    '--meta-tint': '#e5e7eb',
                    cursor: 'pointer',
                  } as CSSProperties
                }
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditOpen(true);
                }}
              >
                <PencilIcon />
              </button>
            ) : null}
            <CalledByChip
              handle={coin.handle}
              callSequence={coin.callSequence}
              firstCall={coin.firstCall}
            />
            {/* Thesis-rewrite marker — every viewer sees it. */}
            {coin.edited ? (
              <span
                className="text-[9px] italic leading-none shrink-0"
                style={{ color: 'var(--ink-3)', fontFamily: 'var(--display)' }}
              >
                edited
              </span>
            ) : null}
          </div>
          <HairlineDivider orientation="h" />
          <IconRow coin={coin} size="md" />
        </div>
      </div>

      {/* Plain native <button> instead of shadcn Button: the bespoke
          score chrome (clamp() font-size, drop-shadow glow,
          accent-primary tint) isn't worth fighting shadcn Button's
          `h-9 px-4 py-2 text-sm font-medium` defaults. Focus-visible
          ring is the one piece shadcn Button gives for free that we
          want, so we add it here as Tailwind utilities directly.

          Card-hover morphs the score into the ⚡+amount quickbuy pair
          (same `group-hover/coin` CSS swap as CoinCard's
          QuickbuyScoreArea — no React re-render on hover). Quickbuy is
          fire-and-forget; per-click progress lives in the global
          <TradeActivityToasts /> stack. */}
      <button
        type="button"
        aria-label={quickbuyAriaLabel}
        /* `aria-label`, `disabled`, and the amount text depend on the
           client-only quickBuyAmountsBySection slice (localStorage-seeded);
           SSR renders the null defaults — the divergence is intentional. */
        suppressHydrationWarning
        className="coin-card__action w-full flex items-center justify-center py-[4px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-0 relative z-[1] disabled:cursor-default"
        style={{ borderTop: '1px solid var(--hairline)', background: 'transparent' }}
        disabled={!quickbuyEnabled}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Stop the card-level pointerdown (its prewarm is redundant —
          // the submit handler self-warms with the same dedup cooldown).
          e.stopPropagation();
          pointerFiredAtRef.current = Date.now();
          handleQuickbuy(e);
        }}
        onPointerCancel={() => {
          pointerFiredAtRef.current = 0;
        }}
        onClick={(e) => {
          // Always swallow the click at this node so the card never
          // navigates on a quickbuy press, suppressed or not.
          e.stopPropagation();
          if (e.detail > 0 && Date.now() - pointerFiredAtRef.current < 500) {
            // Synthetic click of the same physical press — already
            // submitted at pointerdown. Consume the stamp so the next
            // activation of any kind submits.
            pointerFiredAtRef.current = 0;
            return;
          }
          if (e.detail === 0 && Date.now() - pointerFiredAtRef.current < 750) return;
          handleQuickbuy(e);
        }}
      >
        {/* Default (no hover) — big score, accent glow. */}
        <span
          className="qb-idle score-text leading-none group-hover/coin:hidden"
          style={{
            fontFamily: 'var(--display)',
            // cqw-scaled: 22px at the 336px alpha-card min (matches the old
            // floor), growing as the card widens on large viewports.
            fontSize: 'clamp(22px, calc(8px + 4cqw), 36px)',
            color: 'var(--accent-primary)',
            filter:
              'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
          }}
        >
          {coin.score.toFixed(1)}
        </span>
        {/* Card-hover — lightning glyph + amount (see CoinCard's
            QuickbuyScoreArea for the full design rationale). One shared
            size token (`--qb-size`) drives both glyphs; sized a step
            below the idle score so `⚡ 0.1` reads as a substitute, not
            a jump. Unconfigured amount renders only the glyph. */}
        <span
          className="qb-swap hidden group-hover/coin:inline-flex items-center justify-center gap-0.5 leading-none whitespace-nowrap"
          style={
            {
              fontFamily: 'var(--display)',
              '--qb-size': 'clamp(18px, calc(7px + 3.2cqw), 29px)',
            } as CSSProperties
          }
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
            style={{
              width: 'calc(var(--qb-size) * 0.75)',
              height: 'calc(var(--qb-size) * 0.75)',
              display: 'block',
              flexShrink: 0,
              color: 'var(--accent-primary)',
              filter:
                'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
            }}
          >
            <path
              d="M7.92826 0.67044C7.92826 0.480261 7.80541 0.311865 7.62429 0.253817C7.44322 0.195771 7.24536 0.261371 7.13476 0.416118L1.59311 8.17289C1.49784 8.30624 1.48509 8.48165 1.56008 8.62737C1.63507 8.77309 1.78521 8.86467 1.9491 8.86467H5.59493V12.6288C5.59493 12.8196 5.71854 12.9883 5.90036 13.0459C6.08225 13.1035 6.28046 13.0366 6.39025 12.8806L11.9319 5.00555C12.0259 4.87198 12.0377 4.69718 11.9624 4.55221C11.8872 4.40725 11.7374 4.31627 11.5741 4.31627H7.92826V0.67044Z"
              fill="currentColor"
            />
          </svg>
          {/* Rendered UNCONDITIONALLY with empty content when no amount is
              configured so the DOM shape stays stable between SSR (null
              defaults) and the client-rehydrated tree — see CoinCard. */}
          <span
            className="score-text leading-none"
            suppressHydrationWarning
            style={{
              fontFamily: 'var(--display)',
              fontSize: 'var(--qb-size)',
              color: 'var(--accent-primary)',
              filter:
                'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
            }}
          >
            {usdcDollars != null ? `$${usdcDollars}` : (quickBuyAmountSol ?? '')}
          </span>
        </span>
      </button>
    </Card>
  );
});

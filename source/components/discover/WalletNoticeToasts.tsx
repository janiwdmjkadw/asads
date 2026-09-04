import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { navigateToToken, prefetchToken } from '@/components/listen/navigation';
import { playWalletToastSoundFor, resolveWalletToastSound } from './attentionSounds';
import type { WalletActivityEvent } from './useWalletActivity';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { Solana } from '@/components/listen/icons/Icons';
import { getSolUsdHint } from '@/lib/state/sol-usd-hint';
import { useWalletToastStyle } from '@/lib/state/wallet-toast-style';
import { useWalletNotificationV2Enabled } from '@/lib/notifications/useWalletNotificationV2';
import {
  ageLabelForMint,
  createTradeLedger,
  formatToastMc,
  tradeMarketCapUsd,
  type TradeVerb,
} from './walletToastPresentation';

export type WalletNoticeKind = 'mint' | 'trade';

export interface WalletNoticeToast {
  id: string;
  kind: WalletNoticeKind;
  mint: string;
  ticker: string;
  walletLabel: string;
  /** Mint dev-buy in SOL when kind === 'mint'. */
  devBuySol: number | null;
  /** Buy/sell + amounts when kind === 'trade'. */
  tradeIsBuy: boolean | null;
  tradeSolLamports: string | null;
  /** Toast sound preset id resolved from the wallet's prefs at creation;
   *  null = that wallet's bell is off; undefined = default chime. */
  soundId?: string | null;
  /** Hold-aware verb, resolved at creation (kind === 'trade'). */
  tradeVerb?: TradeVerb;
  /** Market cap implied by the trade's own price; null = hide. */
  tradeMcUsd?: number | null;
  /** Coin age ("6h") when the coin is known to a live surface; null = hide.
   *  This is how old the COIN is, NOT how long ago the trade fired. The
   *  two read alike and were conflated once in review: elapsed-since-trade
   *  is ~0-5s on every live toast (the toast fires with the trade), so it
   *  carries almost nothing, while coin age spans seconds to months and
   *  answers whether this is a fresh launch. If a surface ever does need
   *  elapsed-since-trade, the event carries `blockTimeMs ?? receivedAtMs`. */
  ageLabel?: string | null;
  /** Deterministic token image URL — same one the feed cards use, so it
   *  is usually already warm in the browser/CDN cache (instant). */
  imageUrl?: string | null;
  /** The tracked wallet's ADDRESS (labels are display-only, not identity).
   *  Carried so the row's bell can mute alerts for exactly this wallet. */
  walletAddress?: string | null;
}

// One session-wide ledger: verbs stay consistent when the same wallet is
// tracked by both toast surfaces (Discover + trade page) under any label.
const tradeVerbLedger = createTradeLedger();

/** Identity hint for the click-through, so the trade page paints the ticker
 *  + art instantly instead of the cold unknown-mint placeholders. A toast
 *  ticker can be a short-mint fallback ("AbCd…WxYz") or the literal
 *  'UNKNOWN' placeholder (the resolver's miss value) — neither is a symbol,
 *  and hint memory is persistent, so writing one would paint it as the
 *  coin's ticker AND name on the trade page for the whole session. */
function toastNavigationHint(toast: WalletNoticeToast) {
  const ticker = toast.ticker.trim();
  if (!ticker || ticker.includes('…') || /^unknown$/i.test(ticker)) return undefined;
  return { symbol: ticker, imageUrl: toast.imageUrl ?? null };
}

export function createTradeToast(
  event: WalletActivityEvent,
  ticker: string,
  walletLabel: string,
  wallet?: { sound?: string; soundEnabled?: boolean },
  ageLabel?: string | null,
): WalletNoticeToast {
  return {
    id: `trade:${event.signature}:${event.wallet}`,
    kind: 'trade',
    mint: event.mint,
    ticker,
    devBuySol: null,
    tradeIsBuy: event.isBuy,
    tradeSolLamports: event.solLamports,
    walletLabel,
    soundId: resolveWalletToastSound(wallet),
    tradeVerb: tradeVerbLedger.classify(event),
    tradeMcUsd: tradeMarketCapUsd(event, getSolUsdHint()),
    ageLabel: ageLabel ?? ageLabelForMint(event.mint),
    imageUrl: ingestionTokenImageUrl(event.mint),
    walletAddress: event.wallet,
  };
}

export function WalletNoticeToastStack({
  toasts,
  onDismiss,
  navigateOnClick = true,
  onMuteWallet,
}: {
  toasts: WalletNoticeToast[];
  onDismiss: (id: string) => void;
  navigateOnClick?: boolean;
  /** Mute alerts for one wallet — alertsOnToast only, tracking retained.
   *  The bell renders only when this is provided AND the toast carries a
   *  wallet address; the v2 row reserves the cell either way so columns
   *  never move. */
  onMuteWallet?: (walletAddress: string) => void;
}) {
  // The wallet's picked sound once per toast (deduped by id — re-renders
  // and the toast's own TTL churn must not re-ring). Global mute/volume
  // live in attentionSounds (the Wallet Activity bell toggle + the Tweaks
  // slider); per-wallet enable/preset rides `toast.soundId`, and the
  // toast id doubles as the cross-stack ring key so the Discover/Trade
  // double-stack collapses into one ring in every stacking mode.
  const chimedToastIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const toast of toasts) {
      if (chimedToastIds.current.has(toast.id)) continue;
      chimedToastIds.current.add(toast.id);
      playWalletToastSoundFor(toast.soundId, toast.id);
    }
    if (chimedToastIds.current.size > 800) {
      chimedToastIds.current = new Set([...chimedToastIds.current].slice(-400));
    }
  }, [toasts]);

  // One store read for the whole stack (items receive plain props).
  const toastStyle = useWalletToastStyle();

  // Motion is a per-item concern, but reduced-motion is a per-user one, so
  // it is read once here and passed down as a plain prop.
  const reduceMotion = useReducedMotion() === true;

  // Arrival must be INSTANT (operator rule: a trading notification appears
  // the frame it exists — entrance animation spends reaction time). But a
  // new toast at the top also PUSHES the rows below down, and if that push
  // animates, the new row overlaps the old ones mid-glide. So the stack
  // classifies each commit: one that adds a toast renders with layout
  // animation OFF (everything snaps to its new place in the same frame);
  // one that only removes renders with it ON (the leaver fades, the
  // survivors glide up into the gap). Latency on the way in, motion on
  // the way out.
  const prevToastIdsRef = useRef<ReadonlySet<string>>(new Set());
  const hasArrival = toasts.some((toast) => !prevToastIdsRef.current.has(toast.id));
  useEffect(() => {
    prevToastIdsRef.current = new Set(toasts.map((toast) => toast.id));
  }, [toasts]);

  // ONE AT A TIME (operator rule, after seeing a same-block burst paint as
  // a wall): when several toasts land in one commit, they are RELEASED
  // sequentially — each paints instantly when released (the no-entrance
  // law is per-row and unchanged), but row 2 mounts ~90ms after row 1, so
  // a burst reads as rapid-fire arrivals rather than one simultaneous
  // slab. The FIRST toast of a burst pays zero added latency: the release
  // runs in a layout effect, which fires before the browser paints the
  // commit that delivered it.
  const [releasedIds, setReleasedIds] = useState<ReadonlySet<string>>(new Set());
  const releaseQueueRef = useRef<string[]>([]);
  const releaseTimerRef = useRef<number | null>(null);
  // The pump's prune must see the CURRENT toast set, not the one captured
  // when its timeout was armed — a burst can land mid-pacing.
  const liveIdsRef = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    const live = new Set(toasts.map((toast) => toast.id));
    liveIdsRef.current = live;
    // Drop queued ids whose toast already expired (its TTL ran while queued).
    releaseQueueRef.current = releaseQueueRef.current.filter((id) => live.has(id));
    for (const toast of toasts) {
      if (!releasedIds.has(toast.id) && !releaseQueueRef.current.includes(toast.id)) {
        releaseQueueRef.current.push(toast.id);
      }
    }
    const pump = () => {
      const next = releaseQueueRef.current.shift();
      releaseTimerRef.current = null;
      if (next === undefined) return;
      setReleasedIds((current) => {
        const grown = new Set(current);
        grown.add(next);
        // Prune departed ids so the set stays bounded — against the live
        // set as of NOW (the ref), not this closure's render.
        for (const id of grown) if (!liveIdsRef.current.has(id) && id !== next) grown.delete(id);
        return grown;
      });
      if (releaseQueueRef.current.length > 0) {
        releaseTimerRef.current = window.setTimeout(pump, TOAST_RELEASE_SPACING_MS);
      }
    };
    // Release the head IMMEDIATELY (pre-paint) unless a spacing timer is
    // already pacing an earlier burst.
    if (releaseTimerRef.current === null) pump();
  }, [toasts, releasedIds]);
  useEffect(() => {
    return () => {
      // Null the ref as well as clearing: StrictMode unmount/remount runs
      // this cleanup while state survives, and a dead timer id left in the
      // ref reads as "pacing in progress" — the pump then never runs again
      // and the queue freezes. (Found by the frozen `data-queued` probe.)
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };
  }, []);

  const visibleToasts = toasts.filter((toast) => releasedIds.has(toast.id));

  // The redesign ships dark. This FAILS CLOSED (see the hook's doc comment):
  // with no flag, no LD, or no provider mounted at all, every user keeps the
  // legacy card below — byte-identical to what production renders today.
  const v2 = useWalletNotificationV2Enabled();

  if (toasts.length === 0) return null;

  if (!v2) {
    return (
      <div
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 top-[72px] z-[80] flex flex-col items-center gap-2"
        aria-live="polite"
        aria-label="Tracked wallet notifications"
      >
        {toasts.map((toast) => (
          <WalletNoticeToastItemLegacy
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            navigateOnClick={navigateOnClick}
            scale={toastStyle.scale}
            accentOverride={toastStyle.accent}
          />
        ))}
      </div>
    );
  }

  return (
    // Each toast is an INDEPENDENT object with its own lifetime, so the
    // container draws nothing of its own — no border, no radius, no clip.
    // It only positions the column and spaces the cards. 6px at scale 1:
    // enough that a 40px card reads as separate, clear of the 1px
    // hairlines on either side, while a 4-deep burst still costs only
    // 18px of extra height. `--s` rides the container so
    // the gap scales with the Tweaks multiplier like every other dimension.
    <div
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 top-[72px] z-[80] flex flex-col items-stretch gap-[calc(7px*var(--s))]"
      aria-live="polite"
      aria-label="Tracked wallet notifications"
      data-released={releasedIds.size}
      data-queued={releaseQueueRef.current.length}
      style={{ ['--s' as string]: toastStyle.scale }}
    >
      {/* AnimatePresence keeps a removed toast mounted for its exit, which
          is what lets the parents (DiscoverPage, TradeWalletActivity) go on
          simply dropping the toast from their array with no call-site
          change. Their TTLs are per-toast, so the one that leaves is often
          from the MIDDLE of the stack. */}
      <AnimatePresence initial={false}>
        {visibleToasts.map((toast) => (
          <WalletNoticeToastItemV2
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            navigateOnClick={navigateOnClick}
            scale={toastStyle.scale}
            accentOverride={toastStyle.accent}
            reduceMotion={reduceMotion}
            instantLayout={hasArrival}
            onMuteWallet={onMuteWallet}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Motion vocabulary, matched to the repo's tokens. There is NO entrance:
// a trading notification must hit the screen the frame it exists, so a
// mounting toast renders at full opacity in its final place, and a commit
// that adds one also snaps the pushed-down rows instantly (see the
// stack's `hasArrival`). Motion is spent only on the way out — `--fast`
// 180ms on `--ease` for the leaver, `--medium` 280ms on `--ease-out` for
// the survivors gliding up into the gap.
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE = [0.32, 0.72, 0, 1] as const;
const REFLOW_MS = 0.28;
const EXIT_MS = 0.18;
/** Spacing between released rows when a burst lands in one commit. */
const TOAST_RELEASE_SPACING_MS = 90;

function WalletNoticeToastItemV2({
  toast,
  onDismiss,
  navigateOnClick,
  scale,
  accentOverride,
  reduceMotion,
  instantLayout,
  onMuteWallet,
}: {
  toast: WalletNoticeToast;
  onDismiss: (id: string) => void;
  navigateOnClick: boolean;
  scale: number;
  accentOverride: string | null;
  reduceMotion: boolean;
  /** True when this commit ADDED a toast: every position snaps. */
  instantLayout: boolean;
  onMuteWallet?: (walletAddress: string) => void;
}) {
  // WHO · COIN · AMOUNT · MARKET CAP · TIME, on one line.
  //
  // A self-contained notification, NOT a row of a table. It owns its
  // border, radius and shadow, and the stack spaces the cards apart.
  // That is not decoration: each toast has its own TTL, so one expires
  // from the MIDDLE of the stack routinely. Welded into a shared clipped
  // container — which this was — that tears the group as the rules and
  // corners re-form around the hole. Independent cards cannot tear.
  //
  // Every column has a hard px address, so a field sits at the same x on
  // the first row and the fourth. That is the whole point: a burst is
  // scanned VERTICALLY, and a field that moves between rows costs a
  // fixation each time it does. Nothing here may use `flex: 1` on
  // content that varies.
  //
  // The amount is split at the decimal point into two sub-columns, which
  // makes the point itself a column — magnitude reads as the LENGTH of
  // the integer run (`156` against `0`) before a digit is read, so size
  // is legible without spending colour on it.
  //
  // Buy/sell is colour and only colour: the rail at x=0 plus the amount.
  // There is no verb column; the five fields own every x position. The
  // verb stays reachable in the row title and the aria-label.
  //
  // The two runtime-decided values — the Tweaks scale multiplier and the
  // user's accent override — are the only things that cannot be a static
  // utility class, so they ride the row root as custom properties and
  // every class below reads them: `calc(<px>*var(--s))` for dimensions
  // and type, `var(--toast-accent)` for colour.
  const isMint = toast.kind === 'mint';
  const accent = accentOverride ?? `var(${toastAccentVar(toast)})`;

  const amount = isMint
    ? toast.devBuySol == null
      ? '—'
      : formatToastSol(toast.devBuySol)
    : formatLamportsAsSol(toast.tradeSolLamports);
  const [whole, fraction] = splitAtPoint(amount);
  const mc = toast.tradeMcUsd == null ? '—' : formatToastMc(toast.tradeMcUsd);
  // TIME is the COIN's age. Not seconds-since-trade: the toast fires with
  // the trade, so that reading is ~0s on every live row and says nothing,
  // where coin age separates a fresh launch from an established coin.
  const age = toast.ageLabel;

  const activate = () => {
    onDismiss(toast.id);
    if (navigateOnClick) navigateToToken(toast.mint, toastNavigationHint(toast));
  };

  // NO entrance: `initial={false}` renders a mounting toast at its final
  // state in its first frame — full opacity, final position. Departure is
  // where the motion budget goes — the "Checked off" exit: a light sweeps
  // the row (rendered below, presence-gated), the card slides out after
  // it, and the row's HEIGHT collapses in parallel so the survivors glide
  // up while it is still leaving. Under reduced motion: opacity only.
  const present = useIsPresent();
  const leave = reduceMotion
    ? { opacity: 0, transition: { duration: EXIT_MS } }
    : {
        opacity: 0,
        x: 12,
        scaleY: 0.86,
        height: 0,
        marginTop: 0,
        transition: {
          opacity: { duration: 0.22, delay: 0.06, ease: EASE },
          x: { duration: 0.22, delay: 0.06, ease: EASE },
          scaleY: { duration: 0.22, delay: 0.06, ease: EASE },
          height: { duration: 0.16, delay: 0.12, ease: EASE_OUT },
        },
      };

  return (
    // div[role=button], not <button>: the dismiss control below is a real
    // button and buttons cannot nest.
    <motion.div
      // `layout` re-closes the gap with a transform (FLIP) when any toast
      // leaves — including one from the middle — so the cards below glide
      // up instead of jumping, and no layout pass is paid per frame. On a
      // commit that ADDS a toast, `layout` is OFF entirely — not duration
      // 0, which still rides FLIP's measure cycle and lands the push-down
      // one frame after the new row paints. With no FLIP, the new row and
      // the rows it displaces reach their final positions in the SAME
      // paint.
      layout={reduceMotion || instantLayout ? false : 'position'}
      initial={false}
      exit={leave}
      transition={{
        layout: { duration: REFLOW_MS, ease: EASE_OUT },
      }}
      role="button"
      tabIndex={0}
      className={[
        'group pointer-events-auto relative box-border grid cursor-pointer items-center gap-x-0 text-left',
        'h-[calc(40px*var(--s))] w-[calc(406px*var(--s))] px-[calc(11px*var(--s))]',
        // WHO · COIN (art + ticker) · amount-int · amount-frac · ◎ · MC · TIME.
        // Zero column gap with the gutters inside the cells, so the decimal
        // point butts straight against its integer run.
        'grid-cols-[calc(92px*var(--s))_calc(100px*var(--s))_calc(26px*var(--s))_calc(42px*var(--s))_calc(14px*var(--s))_calc(64px*var(--s))_calc(24px*var(--s))_calc(22px*var(--s))]',
        // Self-contained card: its own hairline on all four sides, its own
        // radius, its own ground. `overflow-hidden` is the card's alone —
        // it clips the accent rail and the dismiss slab to the radius, and
        // no card needs to know its position in the stack. The shadow is
        // deliberately shallow: four of these stacked with a deep drop
        // shadow reads as mud, so it only lifts the card off the page.
        'rounded-[calc(9px*var(--s))] border border-[var(--hairline)] overflow-hidden',
        'shadow-[0_2px_9px_rgba(0,0,0,0.23)] bg-[var(--surface-1)]',
        'whitespace-nowrap font-[family-name:var(--mono)] text-[var(--ink-0)]',
      ].join(' ')}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      onPointerEnter={navigateOnClick ? () => prefetchToken(toast.mint) : undefined}
      title={rowTitle(toast, amount, mc)}
      aria-label={rowTitle(toast, amount, mc)}
      style={{ ['--s' as string]: scale, ['--toast-accent' as string]: accent }}
    >
      {/* Exit sweep — exists only while leaving. It travels the row in
          200ms; the card follows it out. */}
      {!present && !reduceMotion ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-0 z-[1] w-[calc(3px*var(--s))] rounded-full bg-[var(--toast-accent)]"
          style={{ left: 0, boxShadow: '0 0 14px 3px var(--toast-accent)' }}
          initial={{ x: 0, opacity: 0 }}
          animate={{ x: 'calc(398px*var(--s))', opacity: [0, 1, 1, 0] }}
          transition={{
            x: { duration: 0.2, ease: EASE_OUT },
            opacity: { duration: 0.2, times: [0, 0.12, 0.7, 1] },
          }}
        />
      ) : null}

      {/* The colour, full-bleed at x=0 and absolutely positioned, so it
          carries direction without occupying a single pixel of column. */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[calc(3px*var(--s))] bg-[var(--toast-accent)]"
      />

      <span
        className={`${TOAST_CLIP} font-[family-name:var(--sans)] text-[calc(14px*var(--s))] font-semibold tracking-[-0.01em] pr-[calc(12px*var(--s))]`}
      >
        {toast.walletLabel}
      </span>

      {/* The coin's art belongs to the COIN, so it sits against the
          ticker rather than at the row's left edge, where it would read
          as the wallet's avatar. */}
      <span className="flex min-w-0 items-center gap-[calc(6px*var(--s))] pr-[calc(8px*var(--s))]">
        <TokenMark url={toast.imageUrl ?? null} ticker={toast.ticker} />
        <span
          className={`${TOAST_CLIP} text-[calc(13px*var(--s))] tracking-[0.02em] ${
            isMint ? 'text-[var(--toast-accent)]' : 'text-[var(--ink-1)]'
          }`}
        >
          {toast.ticker}
        </span>
      </span>

      <span
        className={`${TOAST_FIGURE} text-right text-[calc(14px*var(--s))] font-semibold text-[var(--toast-accent)]`}
      >
        {whole}
      </span>
      <span
        className={`${TOAST_FIGURE} text-left text-[calc(14px*var(--s))] text-[var(--toast-accent)] opacity-[0.72]`}
      >
        {fraction}
      </span>

      <span className="flex justify-center">
        <Solana className="block h-[calc(12px*var(--s))] w-[calc(12px*var(--s))] flex-none text-[var(--ink-4)]" />
      </span>

      <span
        className={`${TOAST_FIGURE} text-right text-[calc(13px*var(--s))] text-[var(--ink-2)] pr-[calc(12px*var(--s))]`}
      >
        {mc}
      </span>


      {/* The bell: mute alerts for THIS wallet, tracking untouched
          (alertsOnToast=false — the feed keeps showing it). The cell is
          reserved even when the bell cannot act, so columns never move. */}
      <span className="flex justify-end">
        {toast.walletAddress && onMuteWallet ? (
          <button
            type="button"
            aria-label={`Mute alerts for ${toast.walletLabel} — stays tracked`}
            title={`Mute alerts for ${toast.walletLabel} (still tracked)`}
            onClick={(e) => {
              e.stopPropagation();
              onMuteWallet(toast.walletAddress as string);
              onDismiss(toast.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex h-[calc(22px*var(--s))] w-[calc(22px*var(--s))] cursor-pointer items-center justify-center rounded-[calc(4px*var(--s))] text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink-1)]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-[calc(13px*var(--s))] w-[calc(13px*var(--s))]"
            >
              <path
                d="M8 1.8c-2.3 0-3.9 1.7-3.9 4v2.6L2.8 10.5c-.3.5 0 1.1.6 1.1h9.2c.6 0 .9-.6.6-1.1L11.9 8.4V5.8c0-2.3-1.6-4-3.9-4Zm-1.5 11c.2.8.8 1.4 1.5 1.4s1.3-.6 1.5-1.4h-3Z"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : null}
      </span>

      {/* Dismiss — always visible, the row's last cell, right of the
          bell (operator spec). Quiet ink at rest so it never competes
          with the data; full ink on hover. */}
      <span className="flex justify-end">
        <button
          type="button"
          aria-label={`Dismiss ${toast.ticker} notification`}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(toast.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="inline-flex h-[calc(22px*var(--s))] w-[calc(22px*var(--s))] cursor-pointer items-center justify-center rounded-[calc(4px*var(--s))] font-[family-name:var(--mono)] text-[calc(14px*var(--s))] leading-none text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink-1)]"
        >
          ×
        </button>
      </span>

    </motion.div>
  );
}

const TOAST_CLIP = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';

const TOAST_FIGURE = 'whitespace-nowrap tabular-nums';

/** `0.0094` -> `['0', '.0094']`; `156` -> `['156', '']`. */
function splitAtPoint(value: string): [string, string] {
  const dot = value.indexOf('.');
  if (dot < 0) return [value, ''];
  return [value.slice(0, dot), value.slice(dot)];
}

/** A creation has no side, so it takes a THIRD colour rather than
 *  borrowing green — green here would read as somebody buying in. */
function toastAccentVar(toast: WalletNoticeToast): string {
  if (toast.kind === 'mint') return '--accent-primary';
  if (toast.tradeIsBuy === true) return '--up';
  if (toast.tradeIsBuy === false) return '--down';
  return '--hold';
}

/** The whole event as a sentence: the verb owns no column, and the SOL
 *  unit is a glyph rather than a word, so both live here — announced to a
 *  screen reader and available on hover, without displacing a field. */
function rowTitle(toast: WalletNoticeToast, amount: string, mc: string): string {
  const verb =
    toast.kind === 'mint' ? 'created' : (toast.tradeVerb ?? (toast.tradeIsBuy ? 'bought' : 'sold'));
  const size = amount === '—' ? '' : ` for ${amount} SOL`;
  const cap = mc === '—' ? '' : ` at ${mc} market cap`;
  const age = toast.ageLabel ? `, coin ${toast.ageLabel} old` : '';
  return `${toast.walletLabel} ${verb} ${toast.ticker}${size}${cap}${age}`;
}

/** The coin's art, falling back to its initial. The tile keeps its box
 *  either way, so a missing or broken image never shifts the columns.
 *  A 16px tile at the row's scale: radius and initial are derived from
 *  that box (a quarter and a half of it) exactly as before. */
function TokenMark({ url, ticker }: { url: string | null; ticker: string }) {
  return (
    <span className="relative inline-flex h-[calc(20px*var(--s))] w-[calc(20px*var(--s))] flex-none items-center justify-center overflow-hidden rounded-[max(2px,calc(3px*var(--s)))] bg-[var(--surface-3)] text-[calc(9px*var(--s))] font-bold leading-none text-[var(--ink-3)]">
      {ticker.slice(0, 1).toUpperCase()}
      {url ? (
        // Deterministic URL, no fetch on our side; a broken image hides
        // itself and the initial behind it shows through.
        <img
          src={url}
          alt=""
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legacy renderer — the flag-off path.
//
// Copied VERBATIM from the shipped design (origin/master) apart from the
// rename. It is not maintained, restyled or improved: when the flag is off
// — no LD, no provider, flag missing — production must look exactly as it
// does today, and the only way to guarantee that is for this to be the same
// code. `formatLamportsAsSol` / `formatToastSol` below are shared because
// master's copies are character-identical to the v2 ones.
// ---------------------------------------------------------------------------

function WalletNoticeToastItemLegacy({
  toast,
  onDismiss,
  navigateOnClick,
  scale,
  accentOverride,
}: {
  toast: WalletNoticeToast;
  onDismiss: (id: string) => void;
  navigateOnClick: boolean;
  scale: number;
  accentOverride: string | null;
}) {
  const accentVar =
    toast.kind === 'trade' ? (toast.tradeIsBuy ? '--up' : '--down') : '--accent-primary';
  // Uniform footprint: every toast is the SAME fixed size (no growing or
  // shrinking with content); `scale` from the Tweaks panel multiplies the
  // footprint AND every font size, so text auto-scales with the card.
  // `accentOverride` re-tints the surface (gradient/border) only — the
  // BUY/SELL and verb colors stay semantic (up/down).
  const px = (n: number) => Math.round(n * scale);
  const tint = accentOverride ?? `var(${accentVar})`;
  const activate = () => {
    onDismiss(toast.id);
    if (navigateOnClick) navigateToToken(toast.mint, toastNavigationHint(toast));
  };
  return (
    // div[role=button], not <button>: the explicit dismiss X below is a
    // real button and buttons cannot nest.
    <div
      role="button"
      tabIndex={0}
      className="pointer-events-auto relative text-left"
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      onPointerEnter={navigateOnClick ? () => prefetchToken(toast.mint) : undefined}
      style={{
        width: px(300),
        padding: `${px(8)}px ${px(12)}px`,
        borderRadius: px(12),
        cursor: 'pointer',
        color: 'var(--ink-0)',
        background: `linear-gradient(135deg, color-mix(in srgb, ${tint} 18%, var(--surface-2)), var(--surface-2))`,
        border: `1px solid color-mix(in srgb, ${tint} 30%, var(--hairline))`,
        boxShadow: `0 18px 44px rgba(0,0,0,0.34), 0 0 18px -8px color-mix(in srgb, ${tint} 70%, transparent)`,
        fontFamily: 'var(--mono)',
      }}
      title={
        navigateOnClick ? `Open ${toast.ticker} trade page` : `Dismiss ${toast.ticker} notification`
      }
    >
      {/* Dismiss WITHOUT navigating (operator feedback 7/7). */}
      <button
        type="button"
        aria-label={`Dismiss ${toast.ticker} notification`}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute inline-flex items-center justify-center transition-colors hover:text-[var(--ink-0)]"
        style={{
          top: px(4),
          right: px(4),
          width: px(16),
          height: px(16),
          borderRadius: px(5),
          border: '1px solid var(--hairline)',
          background: 'color-mix(in srgb, var(--surface-1) 70%, transparent)',
          color: 'var(--ink-3)',
          fontSize: px(11),
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
      <div className="flex items-start gap-2">
        {toast.imageUrl ? (
          <span className="relative shrink-0" style={{ width: px(32), height: px(32) }}>
            {/* Deterministic URL, no fetch on our side; a broken image hides
              itself and the text layout is unaffected. */}
            <img
              src={toast.imageUrl}
              alt=""
              width={px(32)}
              height={px(32)}
              loading="eager"
              decoding="async"
              className="object-cover"
              style={{
                width: px(32),
                height: px(32),
                borderRadius: px(8),
                background: 'var(--surface-3)',
              }}
              onError={(e) => {
                (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
              }}
            />
            {toast.ageLabel ? (
              <span
                className="absolute -bottom-1 -left-1 font-bold"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--ink-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: px(5),
                  padding: `0 ${px(4)}px`,
                  fontSize: px(9),
                  lineHeight: `${px(14)}px`,
                }}
              >
                {toast.ageLabel}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <div
            className="uppercase tracking-[0.16em] flex items-center gap-2"
            style={{ color: 'var(--ink-3)', fontSize: px(10) }}
          >
            <span>{toast.walletLabel}</span>
            {toast.kind === 'trade' ? (
              <span
                style={{
                  color: `var(${accentVar})`,
                  fontWeight: 800,
                  letterSpacing: '0.16em',
                }}
              >
                {toast.tradeIsBuy ? 'BUY' : 'SELL'}
              </span>
            ) : null}
          </div>
          <div className="leading-snug" style={{ marginTop: px(4), fontSize: px(12) }}>
            {toast.kind === 'mint' ? (
              <>
                created{' '}
                <span style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
                  {toast.ticker}
                </span>{' '}
                and bought{' '}
                <span style={{ color: 'var(--up)', fontWeight: 800 }}>
                  {toast.devBuySol == null ? (
                    'unknown'
                  ) : (
                    <SolMark text={formatToastSol(toast.devBuySol)} />
                  )}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: `var(${accentVar})`, fontWeight: 800 }}>
                  {toast.tradeVerb ?? (toast.tradeIsBuy ? 'bought' : 'sold')}
                </span>{' '}
                <span style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
                  {toast.ticker}
                </span>{' '}
                for{' '}
                <span style={{ color: `var(${accentVar})`, fontWeight: 800 }}>
                  <SolMark text={formatLamportsAsSol(toast.tradeSolLamports)} />
                </span>
                {toast.tradeMcUsd != null ? (
                  <span style={{ color: 'var(--ink-3)' }}>
                    {' '}
                    at{' '}
                    <span style={{ color: 'var(--ink-1)', fontWeight: 700 }}>
                      {formatToastMc(toast.tradeMcUsd)} MC
                    </span>
                  </span>
                ) : null}
              </>
            )}
          </div>
        </span>
      </div>
    </div>
  );
}

/**
 * A SOL amount as a MARK, never the word: the figure plus the official
 * Solana glyph at digit height. The glyph is `aria-hidden`, so the
 * `aria-label` keeps the spoken unit for a screen reader.
 */
function SolMark({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`${text} SOL`}>
      {text}
      <Solana style={{ width: 11, height: 11, flex: 'none', display: 'block' }} />
    </span>
  );
}

function formatLamportsAsSol(lamports: string | null): string {
  if (!lamports) return '?';
  let n: number;
  try {
    n = Number(BigInt(lamports)) / 1_000_000_000;
  } catch {
    return '?';
  }
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

function formatToastSol(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 10) return value.toFixed(2).replace(/\.?0+$/, '');
  if (value >= 1) return value.toFixed(3).replace(/\.?0+$/, '');
  return value.toFixed(4).replace(/\.?0+$/, '');
}

import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAgeTick } from '@/hooks/use-age-tick';
import { useFloatingPanelZ } from '@/lib/state/floating-panel-order';
import { hrefForToken, navigateToToken, prefetchToken } from '@/components/listen/navigation';
import {
  RESIZE_EDGES,
  resizeHandleStyle,
  shouldStartSurfaceDrag,
} from '@/components/listen/useFloatingBox';
import { useDockablePanel, useDockCssVars } from './dock/useDockablePanel';
import type { DockContext } from '@/lib/state/dock-store';
import {
  CloseGlyph,
  DockArmingGlow,
  SnappedResizeHandle,
} from './dock/DockChrome';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { WalletTrackerBody } from './WalletTrackerPopover';
import { useActivityCountStore } from '@/lib/state/activity-count-store';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import { Solana } from '@/components/listen/icons/Icons';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import { formatSolTerse, solFromLamports, solSpoken } from './formatSol';
import { MC_UNKNOWN, formatMcCompact } from './formatMc';
import { marketCapTone } from './mcTone';
import { TrackerActivityRow } from '@/components/tracker/TrackerActivityRow';
import { TAPE_COLS_DEFAULT, tapeTemplate, type TapeCols } from '@/components/tracker/TapeColumns';
import { tradeMarketCapUsd } from './walletToastPresentation';
import { getSolUsdHint } from '@/lib/state/sol-usd-hint';
import { displayName, type UseTrackedWalletsResult } from './trackedWallets';
import { getWalletToastMuted, setWalletToastMuted } from './attentionSounds';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import type { WalletActivityEvent } from './useWalletActivity';
import './activity-v2.css';

/*
 * The wallet's identity colour, hashed from its address.
 *
 * The same fixed palette the frens surfaces sign their callers with, and
 * the same reason: on a tape where one wallet fires three times in a row,
 * colour is what lets you see that at a glance without reading a name.
 * Keyed on the ADDRESS, not the label, so renaming a wallet does not move
 * it to a different colour.
 */
const WALLET_CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

function walletIdentityColour(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash * 31 + address.charCodeAt(i)) | 0;
  }
  const index = ((hash % WALLET_CONFETTI.length) + WALLET_CONFETTI.length) % WALLET_CONFETTI.length;
  return WALLET_CONFETTI[index]!;
}

const VISIBILITY_KEY = 'discover:wallet-activity-feed-open:v1';
const RECT_KEY = 'discover:wallet-activity-feed-rect:v2';

/** Narrowest panel that still carries the MC column; 280–339 (the
 *  floating minimum is 280) drops it and hands the space back to the
 *  ticker. Width comes from the dock/floating state, so the class flips
 *  when a resize COMMITS — no container queries, no per-frame work. */
const MC_MIN_PANEL_WIDTH = 340;

interface Props {
  /** Route context for the dock layout ('discover' | 'trade') — each page
   *  remembers its own snap/float state independently. */
  dockContext: DockContext;
  events: WalletActivityEvent[];
  trackedWallets: UseTrackedWalletsResult;
  tickerByMint?: ReadonlyMap<string, string>;
}

/**
 * Floating, draggable, resizable feed of recent pump.fun trades by
 * tracked wallets.
 *
 * - Drag the body across the screen (interactive children stay
 *   clickable thanks to `shouldStartSurfaceDrag`).
 * - Resize from each edge or corner; rect persists across reloads.
 * - Closed state is also persisted; the bottom-right "Activity" pill
 *   reopens it on demand.
 */
export function WalletActivityFeed({ dockContext, events, trackedWallets, tickerByMint }: Props) {
  const dockable = true;
  const [open, setOpen] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'activity' | 'manager'>('activity');
  // Mirror of the persisted wallet-toast mute (attentionSounds reads the
  // storage at play time; this state only drives the bell icon).
  const [toastSoundsMuted, setToastSoundsMuted] = useState(false);
  // Hover-to-pause: new trades prepend and shift every row down, so the row
  // the user is about to click slides out from under the cursor. While the
  // pointer is over the tape the rendered list is a frozen snapshot;
  // pointer-leave snaps back to live. Mouse only — a touch "enter" has no
  // matching leave. Rows never mutate (a trade is immutable), so a plain
  // snapshot is enough — no mergePausedRows-style in-place refresh needed.
  const [pausedEvents, setPausedEvents] = useState<WalletActivityEvent[] | null>(null);
  const feedPaused = pausedEvents !== null;
  const displayEvents = pausedEvents ?? events;

  useLayoutEffect(() => {
    setOpen(loadOpen());
    setToastSoundsMuted(getWalletToastMuted());
  }, []);

  // Switching to the manager tab removes the tape (and its pointer-leave)
  // while frozen — drop the snapshot so returning shows the live list.
  useEffect(() => {
    if (tab !== 'activity') setPausedEvents(null);
  }, [tab]);

  // Keeps --dock-left-w/--dock-right-w in sync for the Discover layout.
  useDockCssVars(dockContext);
  const setActivityCount = useActivityCountStore((s) => s.setCount);
  useEffect(() => {
    setActivityCount(events.length);
  }, [events.length, setActivityCount]);
  const dock = useDockablePanel('wallet', dockContext, {
    storageKey:    RECT_KEY,
    minWidth:      280,
    minHeight:     220,
    // Matches the dock-store default: the panel spawns FLOATING, so this
    // is the width a new user actually sees (wide enough for MC).
    defaultWidth:  400,
    defaultHeight: 360,
    bottomRight:   true,
    // Spawn clear of the bottom status bar (footer + breathing room).
    defaultBottomGap: 44,
  });
  // Trade page (dockable=false): behave exactly like the old floating box —
  // never snapped, no pill stack, local open persistence still applies.
  /* The panel is narrow, so the tape drops its market cap below the
     width the old ledger hid it at. Everything else it shows. */
  const dockCols: TapeCols = {
    ...TAPE_COLS_DEFAULT,
    mc: dock.width >= MC_MIN_PANEL_WIDTH,
  };
  const side = dockable ? dock.side : null;
  const boxRef = dock.boxRef;
  // Open state has ONE owner per mode: the dock store when dockable (the
  // pill colors, side markers, and page-fit all read it), the local
  // persisted flag on the trade page.
  const openState = dockable ? dock.open : open;

  // Adaptive age clock: 1s while the newest trade is seconds-old (the "47s"
  // labels count up live), decaying to 30s once everything is minutes-old.
  const newestEventAtMs =
    events.length > 0 ? (events[0].blockTimeMs ?? events[0].receivedAtMs) : null;
  const ageTick = useAgeTick(newestEventAtMs, openState === true);
  // Click-to-raise among the floating surfaces (docks / instant box /
  // canvas popover) — pointer-down brings this panel to the top of the band.
  const { zIndex: panelZ, raise: raisePanel } = useFloatingPanelZ('wallet-dock');

  useEffect(() => {
    if (dockable || open == null) return;
    persistOpen(open);
  }, [dockable, open]);

  // Emoji and name are separate ledger cells (the emoji holds a fixed
  // 12px gutter so the labels start on one line), so they're kept apart
  // here rather than pre-joined into one string.
  const markByWallet = useMemo(() => {
    const map = new Map<string, { emoji: string | undefined; label: string }>();
    for (const w of trackedWallets.wallets) {
      const emoji = w.emoji?.trim();
      map.set(w.address, { emoji: emoji || undefined, label: displayName(w) });
    }
    return map;
  }, [trackedWallets.wallets]);

  if (open == null) return null;

  if (!openState) {
    if (dockable) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show wallet activity"
        className="fixed z-30 inline-flex items-center gap-1.5 h-[32px] rounded-full pl-2.5 pr-1.5 border text-[var(--ink-1)] transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{
          right: 16,
          bottom: 16,
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
          letterSpacing: '0.04em',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--ink-0) 6%, var(--surface-2)), var(--surface-2))',
          borderColor: 'var(--hairline-2)',
          boxShadow:
            'var(--shadow-popover, 0 16px 32px rgba(0,0,0,0.45)), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <span
          aria-hidden
          className="inline-block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: events.length > 0 ? 'var(--up)' : 'var(--accent-primary)',
            boxShadow: '0 0 6px var(--accent-glow)',
          }}
        />
        <span className="text-[12px]">Activity</span>
        <ActivityCountBadge count={events.length} />
      </button>
    );
  }

  return (
    // ONE provider for the whole panel: neither DiscoverPage's provider nor
    // the trade page encloses this panel (it renders outside both), and the
    // manager tab + import modal portal from inside it, so they inherit it.
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
    {dockable ? <DockArmingGlow side={dock.armingSide} /> : null}
    <section
      ref={boxRef}
      role="dialog"
      aria-label="Wallet activity feed"
      /* The hook every rule in `activity-v2.css` hangs off. Scoped to the
         panel so the /tracker page, which reads the same `.ledger-row`
         grid, is untouched. */
      data-activity-v2=""
      className="dock-terminal"
      onPointerDownCapture={raisePanel}
      onPointerDown={(event) => {
        if (shouldStartSurfaceDrag(event.target)) dock.onSurfacePointerDown(event);
      }}
      style={{
        ...dock.shellStyle,
        zIndex:   panelZ,
        /* 14 floating, 0 snapped — the tweet tracker's exact call. It
           was 4, which is a different family of corner entirely. */
        borderRadius: side === null ? 10 : 0,
        // and glued to the pointer. It used to drop to 0.55 opacity and
        // blur 1.5px while arming, which read as the panel vanishing
        // mid-gesture; the arming signal is carried by DockArmingGlow (the
        // target-edge bar) and the side markers instead. No transition
        // during the gesture — nothing may interpolate against the pointer.
        opacity: dock.dragging ? 0.97 : 1,
        transition: dock.dragging ? 'none' : 'opacity 120ms ease',
        willChange: dock.dragging ? 'transform' : undefined,
        touchAction: 'none',
        /*
         * ── FLAT ─────────────────────────────────────────────────────
         *
         * One ground, one hairline, one corner. No backdrop blur, no top
         * gradient, no inset light, no drop shadow.
         *
         * What this replaces was glass: a translucent surface at 76%, a
         * 22px / 1.45 backdrop filter, a white gradient down the first
         * 42% of it, a 1px inset highlight and a two part shadow. Six
         * devices, all saying the one thing — this floats. A different
         * ground to the page says it once, and says it at every width,
         * on every backdrop, with nothing to re-filter per frame while
         * the panel is dragged.
         *
         * `--surface-1` is opaque, so the drag no longer needs to swap
         * ground and drop a filter to stay cheap. It looks the same
         * moving as it does still.
         */
        background: 'var(--surface-1)',
        /*
         * ── A SNAPPED PANEL HAS ONE EDGE ─────────────────────────────
         *
         * Floating, it is an object and gets a border all the way round.
         * Snapped, three of those four sides are lying: the top runs
         * along the nav, the bottom along the footer, and the outer one
         * along the window. What is left is the seam between the panel
         * and the page, and that is the only line worth drawing.
         */
        border: side === null ? '1px solid var(--hairline)' : 'none',
        borderLeft: side === 'right' ? '1px solid var(--hairline)' : undefined,
        borderRight: side === 'left' ? '1px solid var(--hairline)' : undefined,
        boxShadow: side === null
          ? '0 0 0 1px rgba(11, 14, 20, 0.12), 0 20px 52px rgba(11, 14, 20, 0.18)'
          : 'none',
        fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Chrome, ledger-style: the title reads as a heading on ONE line at
          the 340px minimum, and everything else in the bar is quiet. */}
      <div
        className="flex items-center gap-2 pl-3.5 pr-2 h-[40px] shrink-0 select-none"
        onPointerDown={(event) => dock.onSurfacePointerDown(event)}
        style={{
          cursor: dock.dragging ? 'grabbing' : 'grab',
          /* 40px and the same 7% rule as the sibling, and NO fill: the
             tweet tracker's header sits on the panel's own glass, and a
             3% plate here was the last thing making the two headers
             different heights and different grounds. */
          borderBottom: '1px solid color-mix(in srgb, var(--ink-0) 7%, transparent)',
        }}
      >
        {/*
          * The tracker page's header, in a panel: a name in sentence case
          * and a plain count beside it.
          *
          * What was here: `Wallet Activity` in title case, then a lit pip
          * that turned green when the feed had events — a decoration
          * claiming to be information, since a feed with events says so
          * by having rows in it. The count is the fact the pip was
          * standing in for.
          */}
        <span
          className="text-[13px] font-semibold whitespace-nowrap"
          style={{ color: 'var(--ink-0)', fontFamily: 'var(--sans)', lineHeight: 1 }}
        >
          Wallet activity
        </span>
        <span
          className="text-[11.5px] font-semibold tabular-nums shrink-0"
          style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)', lineHeight: 1 }}
        >
          {events.length}
        </span>
        {feedPaused && (!dockable || tab === 'activity') ? (
          /*
           * Quiet. This shipped as an accent capsule — accent text on an
           * accent wash inside an accent border, at 700 — which made the
           * loudest thing in the panel a note that the tape is waiting for
           * you to move the mouse. Open states everywhere else in the
           * product (the footer toggles, the nav pills) say themselves
           * with a white plate, so this does too.
           */
          <span
            className="inline-flex h-[18px] items-center rounded-full px-2"
            style={{
              color: 'var(--ink-3)',
              background: 'color-mix(in srgb, var(--ink-0) 7%, transparent)',
              border: '1px solid var(--hairline)',
              fontFamily: 'var(--sans)',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            Paused
          </span>
        ) : null}
        <div className="flex-1" />
        {/* `DockSideMarkers` used to sit here — two dots between the title
            and the bell, marking which edge the panel would snap to. On a
            bar that is otherwise a title and two controls they read as a
            pair of stray pips beside the alert button, and the panel is
            dragged by its bar anyway, which shows the same thing. */}
        {/* Bell — mutes/unmutes the tracked-wallet toast chime. Persisted;
            playback reads the flag directly, this button just flips it. */}
        <Tooltip>
          <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            const next = !toastSoundsMuted;
            setWalletToastMuted(next);
            setToastSoundsMuted(next);
          }}
          role="switch"
          aria-checked={!toastSoundsMuted}
          aria-label={toastSoundsMuted ? 'Unmute wallet toast sounds' : 'Mute wallet toast sounds'}
          className="inline-flex items-center justify-center rounded-[3px] transition-colors hover:text-[var(--ink-0)]"
          style={{
            width: 20,
            height: 20,
            cursor: 'pointer',
            color: toastSoundsMuted ? 'var(--ink-3)' : 'var(--ink-2)',
          }}
        >
          <ToastBellIcon muted={toastSoundsMuted} />
        </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {toastSoundsMuted ? 'Unmute alerts' : 'Mute alerts'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => (dockable ? dock.setOpen(false) : setOpen(false))}
          aria-label="Close wallet activity feed"
          className="inline-flex items-center justify-center rounded-[3px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink-0)]"
          style={{ width: 20, height: 20, cursor: 'pointer' }}
        >
          <CloseGlyph />
        </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </div>

      {/*
        * ── THE STRIP, IN THE PRODUCT'S OWN VOICE ─────────────────────
        *
        * 9.5px, uppercase, on a 0.14em track, with an accent underline
        * under the live one. That is the printout voice this product
        * spent the last month taking out of the tracker page, the tweet
        * panel and this panel's own header — and it was still here,
        * four pixels under a header that had already dropped it.
        *
        * Now: sentence case at 12, no tracking, and the live tab is
        * simply the bright one. Nothing is underlined and nothing is
        * coloured. 28px instead of 24, because two words in a 24px
        * strip is a label squeezed into a rule.
        */}
      {dockable ? (
        <div
          className="flex items-stretch gap-4 px-3 h-[28px] shrink-0 select-none"
          data-no-drag
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} label="Feed" />
          <TabButton active={tab === 'manager'} onClick={() => setTab('manager')} label="Manager" />
        </div>
      ) : null}

      {/*
        * No column header. The tracker page dropped its own for the same
        * reason: a column of `$6.12K` is a market cap and a column of
        * green and pink names is who traded, so naming them cost a row of
        * chrome in a panel that has none to spare.
        */}

      <div
        /* `dk-scroll` is the product's bar rather than the browser's —
           see `tracker/scrollbars.css`, shared with the tracker page. */
        className={`dock-rows dock-rows--ledger dk-scroll flex-1 min-h-0 ${dockable && tab === 'manager' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}
        style={{ scrollbarWidth: 'thin' }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          if (dockable && tab === 'manager') return;
          setPausedEvents(events);
        }}
        onPointerLeave={() => setPausedEvents(null)}
      >
        {dockable && tab === 'manager' ? (
          <div className="flex-1 min-h-0 flex flex-col" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
            {/* Full tracker manager INLINE — fill mode: the wallet list is
                the ONE scroller (the outer container stops scrolling in
                manager mode, so there are never two scrollbars). */}
            <WalletTrackerBody store={trackedWallets} fill />
          </div>
        ) : displayEvents.length === 0 ? (
          <EmptyHint />
        ) : (
          /*
           * THE TRACKER PAGE'S TAPE, IN THE PANEL.
           *
           * This drew `.ledger-row` — the dock's own grid, its own type
           * ramp, its own column head — while /tracker had already moved
           * to a row cut for a wide column: age, the wallet's name in the
           * side's colour, the token with its launchpad mark, the amount
           * and the market cap. Two rows for the same trade, and this was
           * the older one.
           *
           * One row now. The market cap drops out below 340px, which is
           * the figure this panel used to hide at exactly that width.
           */
          <div style={{ ['--tr-cols' as string]: tapeTemplate(dockCols) }}>
            {displayEvents.slice(0, 60).map((event) => (
              <TrackerActivityRow
                key={`${event.signature}:${event.wallet}`}
                event={event}
                walletLabel={markByWallet.get(event.wallet)?.label ?? `${event.wallet.slice(0, 4)}…${event.wallet.slice(-4)}`}
                walletEmoji={markByWallet.get(event.wallet)?.emoji}
                ticker={tickerByMint?.get(event.mint) ?? tokenTickerFromNavigationHint(event.mint) ?? null}
                cols={dockCols}
                ageTick={ageTick}
              />
            ))}
          </div>
        )}
      </div>

      {side === null
        ? RESIZE_EDGES.map((edge) => (
            <span
              key={edge}
              aria-hidden
              data-resize-handle="true"
              onPointerDown={(event) => dock.startResize(event, edge)}
              style={resizeHandleStyle(edge)}
            />
          ))
        : null}
    </section>

      {/* Outside the shell, deliberately: the panel is `overflow: hidden`
          and the grip straddles its edge, so a child would lose the half
          hanging over the page. See `SnappedResizeHandle`. */}
    {side !== null ? (
      <SnappedResizeHandle
        side={side}
        ctx={dockContext}
        width={dock.width}
        zIndex={panelZ + 1}
        onPointerDown={dock.onSnappedResizeStart}
      />
    ) : null}
    </TooltipProvider>
  );
}

/*
 * The active tab shipped carrying its state ONLY in inline colour, so a
 * stylesheet had nothing to hook. `activity-v2.css` restyles this strip
 * and needs to know which tab is on, hence `data-active`.
 */
function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      data-active={active ? 'true' : 'false'}
      className="inline-flex items-center text-[12px] font-semibold transition-colors"
      style={{
        cursor: 'pointer',
        // One step of brightness, and that is the whole state. The
        // accent underline it replaces was the only accent left in this
        // panel, spent on saying which of two words you already clicked.
        color: active ? 'var(--ink-0)' : 'var(--ink-3)',
        border: 0,
        background: 'transparent',
      }}
    >
      {label}
    </button>
  );
}

function ToastBellIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted ? (
        <path
          d="M3 3l18 18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function ActivityCountBadge({ count }: { count: number }) {
  const active = count > 0;
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[3px] px-1 tabular-nums"
      style={{
        minWidth: 16,
        height: 16,
        color: active ? 'var(--ink-0)' : 'var(--ink-3)',
        background: active
          ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)'
          : 'var(--chip-bg)',
        border: `1px solid ${active ? 'color-mix(in srgb, var(--accent-primary) 32%, transparent)' : 'var(--hairline)'}`,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
      }}
    >
      {count}
    </span>
  );
}

/**
 * Memoized: an SSE trade prepends new rows without re-rendering the
 * retained ones; `ageTick` is the parent's coarse interval so ages keep
 * advancing on a quiet feed.
 */
const ActivityRow = memo(function ActivityRow({
  event,
  walletLabel,
  walletEmoji,
  ticker,
  showMc,
  ageTick,
}: {
  event:       WalletActivityEvent;
  walletLabel: string | undefined;
  walletEmoji: string | undefined;
  ticker:      string | undefined;
  showMc:      boolean;
  ageTick:     number;
}) {
  void ageTick; // re-render trigger only — age recomputes from Date.now()
  const tone = event.isBuy ? 'var(--up)' : 'var(--down)';
  const ageMs = Math.max(0, Date.now() - (event.blockTimeMs ?? event.receivedAtMs));
  // Same at-trade MC the toasts show: the trade's own sol/token ratio at
  // pump's standard supply. Null (no SOL price this session, dust trade,
  // "?" backfill row) renders the em-dash, never a zero.
  const mcUsd = showMc ? tradeMarketCapUsd(event, getSolUsdHint()) : null;
  const mc = showMc ? formatMcCompact(mcUsd) : null;
  const art = useResolvedTokenImage(ingestionTokenImageUrl(event.mint), null, event.mint);
  // SIDE owns the amount's colour, at full tone, exactly as a discover
  // card paints its market cap. Magnitude survives as WEIGHT only:
  // genuinely big trades (>50 SOL) step up to 600.
  const whale = (solFromLamports(event.solLamports) ?? 0) > 50;
  const spokenAmount = solSpoken(event.solLamports);
  return (
    /* REAL `<a href>` (not a button): pre-hydration clicks fall back to
       native navigation; hydrated clicks preventDefault() and keep the
       SPA `navigateToToken` path (prewarm + hint memory). draggable
       disabled so the anchor never starts an HTML5 drag inside the
       feed's pointer-drag surface. Preflight keeps anchor color /
       text-decoration inherited — no visual change. */
    <a
      href={hrefForToken(event.mint)}
      draggable={false}
      onClick={(e) => {
        // Modifier/middle clicks keep native anchor behavior (new tab,
        // window, download) — only plain left-clicks take the SPA path.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // Hand identity along so the trade page paints the ticker + art
        // instantly instead of the cold unknown-mint placeholders.
        navigateToToken(
          event.mint,
          ticker
            ? { symbol: ticker, imageUrl: ingestionTokenImageUrl(event.mint) }
            : undefined,
        );
      }}
      onPointerEnter={() => prefetchToken(event.mint)}
      onPointerDown={(e) => e.stopPropagation()}
      className={mc === null ? 'ledger-row transition-colors' : 'ledger-row ledger-row--mc transition-colors'}
      style={{ cursor: 'pointer', ['--wa-id' as string]: walletIdentityColour(event.wallet) }}
      title={`${event.signature.slice(0, 16)}…`}
    >
      {/*
        AGE FIRST. When a trade happened is the first thing checked on a
        live tape, and it sat at the far right behind four columns.

        The 2px tone tick that used to open the row is gone: it said buy
        or sell, and the amount says it again in the same ink. Side is
        read off the FIGURE, where the eye already is.
      */}
      <span className="ledger-age">{formatAge(ageMs)}</span>

      <span className="ledger-wallet">
        {/* Fixed 12px gutter whether or not the wallet carries an emoji,
            so every label in the column starts on the same x. */}
        <span aria-hidden className="ledger-wallet-emoji">{walletEmoji ?? ''}</span>
        {/* Wallet name → profile modal (row click still opens the token). */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openWalletProfile(event.wallet);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              openWalletProfile(event.wallet);
            }
          }}
          title={`Open ${event.wallet} profile`}
          className="ledger-wallet-label"
        >
          {walletLabel ?? `${event.wallet.slice(0, 4)}…${event.wallet.slice(-4)}`}
        </span>
      </span>

      <img
        className="ledger-art"
        src={art.src}
        onError={art.onError}
        onLoad={art.onLoad}
        alt=""
        loading="lazy"
        draggable={false}
      />

      {/* Bare ticker — no `$` sigil (owner call); the column is headed
          TOKEN and the artwork beside it already says what this is. */}
      <span className={ticker ? 'ledger-ticker' : 'ledger-ticker ledger-ticker--unknown'}>
        {ticker ?? '—'}
      </span>

      {/* At-trade market cap, ahead of the amount so the row ends on the
          figure that carries side. */}
      {mc !== null ? (
        <span
          className={mc === MC_UNKNOWN ? 'ledger-mc ledger-mc--unknown' : 'ledger-mc'}
          title={mc === MC_UNKNOWN ? 'market cap unknown' : `market cap $${mc}`}
          style={mc === MC_UNKNOWN ? undefined : { color: marketCapTone(mcUsd) }}
        >
          {mc}
        </span>
      ) : null}

      {/* The unit is the Solana glyph, never the word — sized to the
          digits so the pair reads as one mark. `aria-label` keeps the
          spoken "N SOL". */}
      <span
        className={whale ? 'ledger-amount ledger-amount--whale' : 'ledger-amount'}
        aria-label={spokenAmount}
        title={spokenAmount}
        style={{ color: tone }}
      >
        {formatSolTerse(event.solLamports)}
        <Solana style={{ width: 11, height: 11, flex: 'none', display: 'block' }} />
      </span>

    </a>
  );
});

function EmptyHint() {
  return (
    <div className="ledger-empty">
      <div className="ledger-empty-line">No entries</div>
    </div>
  );
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/*
 * CLOSED until asked for. This is the non-dockable path's own default,
 * and it has to agree with `dock-store`'s — otherwise the panel opens
 * itself on one code path and not the other. A stored value still wins,
 * so anyone who has opened it keeps it.
 */
function loadOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(VISIBILITY_KEY);
    if (raw === null) return false;
    return raw === 'true';
  } catch {
    return false;
  }
}

function persistOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISIBILITY_KEY, open ? 'true' : 'false');
  } catch {
    // Non-persistent contexts simply skip persistence.
  }
}

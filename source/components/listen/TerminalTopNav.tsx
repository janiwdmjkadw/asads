'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

// Lazy: the wallet modal (framer-motion + Select) is closed at boot on
// every terminal page — load its chunk on first open, keep it out of the
// shared shell bundle.
/*
 * NOT LAZY. This wraps the balance pill as its trigger, and `dynamic`
 * with no loading state renders NOTHING until its chunk arrives — so the
 * wallet was simply absent from the bar on every slow load, and gone for
 * good whenever the chunk timed out, which this dev server does often.
 *
 * A control that is sometimes missing is worse than a slightly larger
 * shell bundle, and the balance is the one thing on this bar that must
 * always be there. The modal below stays lazy: it is closed at boot and
 * nothing depends on it rendering.
 */
import { WalletBalancePopover } from '@/components/wallet/WalletBalancePopover';
const WalletBalanceModal = dynamic(
  () => import('@/components/wallet/WalletBalanceModal').then((m) => m.WalletBalanceModal),
  { ssr: false },
);
// Lazy for the same reason: the token-search modal only loads its chunk on
// the first click of the navbar search icon.
const TokenSearchModal = dynamic(
  () => import('@/components/search/TokenSearchModal').then((m) => m.TokenSearchModal),
  { ssr: false },
);
import { useQuery } from '@tanstack/react-query';
import { AGENT_WALLET_QUERY_KEY } from '@/components/agent-wallet/AgentWalletPanel';
import { fetchAgentWalletStatus } from '@/components/agent-wallet/client';
import { deriveNavSlotState, type NavSlotState } from '@/components/agent-wallet/setup-state';
import { useAgentWalletSetup } from '@/lib/agent-wallet-setup-context';
import { useMe } from '@/lib/api/me';
import { useTokenSearchStore } from '@/lib/state/token-search-store';
import {
  agentWalletSetupPreview,
  isWalletReadyPreviewForced,
  useWalletSetupStatus,
} from '@/lib/auth/onboarding-status';
import { pickDefaultExportWallet, pickPrimaryWalletEntry } from '@/lib/auth/wallet-export';
import { useOnboarding } from '@/lib/onboarding-context';
import { WELCOME_PATH } from '@/lib/onboarding/auto-open';
import { useFullscreenOnboarding } from '@/lib/onboarding/useFullscreenOnboarding';
import { cn } from '@/lib/utils';
import { useConditionalsEnabled } from '@/lib/conditionals/useConditionalsEnabled';
import { AuthControls } from './AuthControls';
import { BrandMark } from './BrandMark';
import './topnav-v2.css';
import { NotificationBell } from './NotificationBell';
import { NavDrawer } from './NavDrawer';
import { Bot, Search, Solana, Sparkles, Usdc, Wallet } from './icons/Icons';
import {
  TAB_VIEWS,
  activeTabForTerminalPathname,
  hrefForView,
  navigateToView,
  prefetchView,
  type NavTab,
} from './navigation';
import { Numeral } from './primitives';
import { useWalletBalancesContext } from './WalletBalanceProvider';
import { getRuntimeConfig } from '@/lib/runtime-config';

// No 'agent-wallet' tab: the agent wallet lives inside Portfolio →
// Wallets now, so a separate tab would be a second nav entry pointing at
// the same page. The `agent-wallet` View still exists and still resolves
// (to the Portfolio deep link) for programmatic navigation and the
// retired route's redirect — it just is not a tab the user sees.
//
// 'conditionals' is listed here but only RENDERS behind the LaunchDarkly
// flag `conditionals-surface` (see the filter in TerminalTopNav). It stays
// in the const so the gate is one boolean to flip, not a code change.
/* `chat` is the full page agent chat at `/agent`. The page has been in
   the tree since it shipped and nothing on screen pointed at it, so the
   only way in was typing the URL. */
const TABS: readonly NavTab[] = [
  'discover',
  'tracker',
  'portfolio',
  'rewards',
  'frens',
  'conditionals',
  'chat',
] as const;

/*
 * The word on the bar, separate from the id above it.
 *
 * The two were the same string: `{tab}` was rendered straight, so the
 * label was whatever the router key happened to be. That is why the nav
 * read lowercase. Splitting them is what lets the label be written the
 * way it should be read while `discover` stays `discover` everywhere it
 * is a route, an active check, or a prefetch target.
 *
 * Typed `Record<NavTab, string>` on purpose: adding a tab to the union
 * without giving it a word here is a build error, not a blank pill.
 */
const TAB_LABEL: Record<NavTab, string> = {
  discover: 'Discover',
  tracker: 'Tracker',
  portfolio: 'Portfolio',
  rewards: 'Rewards',
  frens: 'Frens',
  chat: 'Chat',
  conditionals: 'Conditionals',
  'agent-wallet': 'Agent Wallet',
};

// Dev-only sample balances shown when `NEXT_PUBLIC_FORCE_WALLET_READY` is on
// (see `isWalletReadyPreviewForced`). Has no effect in production.
const PREVIEW_SOL_BALANCE = '100.5';
const PREVIEW_USDC_BALANCE = '250.00';

export function TerminalTopNav() {
  const pathname = usePathname();
  // Unconditional, top of component (Rules of Hooks). Fails closed, so the
  // pill is absent until LD affirmatively says the surface is on.
  const conditionalsEnabled = useConditionalsEnabled();
  const tabs = useMemo(
    () => (conditionalsEnabled ? TABS : TABS.filter((tab) => tab !== 'conditionals')),
    [conditionalsEnabled],
  );
  const routeActiveTab = useMemo(() => activeTabForTerminalPathname(pathname), [pathname]);
  const [localActive, setLocalActive] = useState<NavTab | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const walletBalances = useWalletBalancesContext();
  const active = localActive ?? routeActiveTab;
  const railRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setLocalActive(null);
  }, [pathname]);

  /* The active tab has no chrome of its own — a single absolutely
     positioned thumb slides under it. Measure, then move: the rail's edge
     is an inset ring (no border box), so the pill's offsetLeft and the
     thumb's left:0 share an origin and the landing is exact. */
  const placeThumb = useCallback(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !thumb) return;
    const activePill = rail.querySelector<HTMLElement>('.tab-pill.active');
    if (!activePill) return;
    thumb.style.width = `${activePill.offsetWidth}px`;
    thumb.style.transform = `translateX(${activePill.offsetLeft}px)`;
  }, []);

  // Re-place whenever the geometry could have moved: the active tab
  // changed (click OR route), the tab set changed (the conditionals flag
  // resolving), or the component mounted.
  useEffect(() => {
    placeThumb();
  }, [active, tabs, placeThumb]);

  // …and on the two asynchronous sources of width change: the display /
  // sans faces landing after first paint, and the rail resizing (the
  // ladder's tracking + padding steps).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    void document.fonts.ready.then(placeThumb);
    const observer = new ResizeObserver(placeThumb);
    observer.observe(rail);
    // The sweep is one pass per slide, so the class that drives it comes
    // off the moment the animation reports done.
    const stopSliding = () => rail.classList.remove('is-sliding');
    rail.addEventListener('animationend', stopSliding);
    return () => {
      observer.disconnect();
      rail.removeEventListener('animationend', stopSliding);
    };
  }, [placeThumb]);

  function handleTab(tab: NavTab) {
    const dest = TAB_VIEWS[tab];
    const rail = railRef.current;
    // remove → reflow → add, so a second click restarts the sweep instead
    // of being swallowed as "class already present".
    if (
      rail
      && tab !== active
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      rail.classList.remove('is-sliding');
      void rail.offsetWidth;
      rail.classList.add('is-sliding');
    }
    setLocalActive(tab);
    if (dest) {
      navigateToView(dest);
    }
  }

  /*
   * Does the rail have anything past its right edge? CSS cannot ask that
   * — `scrollWidth` beyond `clientWidth` is not a media query — so it is
   * measured here and the answer put on a class.
   *
   * Without it the arrow appeared at a fixed breakpoint whether or not
   * anything was actually clipped, which is both wrong and confusing:
   * an arrow pointing at nothing.
   */
  /*
   * TWO ANSWERS, NOT ONE. This tracked a single `railOverflows` from
   * `scrollWidth - clientWidth`, which is the TOTAL scrollable distance
   * and does not change as you scroll. So the forward arrow stayed lit
   * at the end of the rail pointing at nothing, and there was never a
   * way back — once you nudged right, the first destinations were gone
   * until you resized the window.
   *
   * Both edges are asked separately now, and both re-measure on scroll,
   * which is what the existing listener was already there for.
   */
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;

    const measure = () => {
      // 2px of slack: sub-pixel layout leaves a fraction behind at both
      // ends and an arrow that never quite goes away is worse than none.
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    };
    measure();

    /*
     * AND AGAIN ONCE THE FACES LAND.
     *
     * The same asynchronous width change `placeThumb` guards against
     * above: at first paint the pills are in a fallback face, the rail
     * has not overflowed yet, and a measurement taken then says there is
     * nothing past either edge. The ResizeObserver does not save it —
     * it watches the SCROLLER, whose own box does not change when the
     * content inside it grows — so the arrows never appeared at all.
     */
    void document.fonts.ready.then(measure);

    /*
     * AND ONCE MORE AFTER LAYOUT.
     *
     * `fonts.ready` can resolve before the bar has settled its widths:
     * the agent field is the only flexible element on this header, so
     * the rail's final width is not known until that flex pass runs. Two
     * frames is the standard hook for "after layout" — one to get past
     * the current paint, one to read the result of it.
     */
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    /*
     * AND A LATE ONE.
     *
     * Two frames is not always enough here: the pills are anchors whose
     * width depends on a face that may still be swapping, and the thumb
     * placement above runs its own passes. A single late read costs
     * nothing and is the difference between the arrows appearing and
     * never appearing at all.
     */
    const late = window.setTimeout(measure, 400);

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    /*
     * THREE THINGS CAN CHANGE THE ANSWER, and the scroller is only one.
     *
     * `.tabs` is `shrink-0` inside a `flex: 1 1 auto` parent, so when the
     * bar redistributes space it is the PARENT that resizes and the
     * scroller that stays put — watching only the scroller misses every
     * window resize. And the children are what actually overflows, so a
     * pill getting wider has to count too.
     */
    if (el.parentElement) observer.observe(el.parentElement);
    for (const child of Array.from(el.children)) observer.observe(child);

    /*
     * WINDOW RESIZE, NOT JUST THE OBSERVER.
     *
     * The whole left cluster is `shrink-0` and `.tabs` is too, so neither
     * the scroller nor its parent changes size when the window does — the
     * ResizeObserver has nothing to fire on and the arrows never updated
     * on a resize. The window always reports, so it is the one signal
     * that cannot be missed here.
     */
    window.addEventListener('resize', measure);

    el.addEventListener('scroll', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      el.removeEventListener('scroll', measure);
    };
  }, [tabs]);

  function prefetchTab(tab: NavTab) {
    const dest = TAB_VIEWS[tab];
    if (dest) prefetchView(dest);
  }

  return (
    <header
      className="topnav relative z-30 w-full flex items-center gap-3 sm:gap-4 px-3 sm:px-6 shrink-0 h-[var(--h-topnav)]"
      style={{
        /*
         * Nothing paints here. `--nav-bg` is transparent and the blur is
         * gone with it — a backdrop-filter over a flat black page changes
         * no pixel, it only promotes the bar to its own compositor layer.
         * The bar is the page now; only its contents are visible.
         */
        background: 'transparent',
      }}
    >
      <div className="bar-l flex items-center gap-3 sm:gap-6 shrink-0 min-w-0">
        <BrandMark />

        {/* The rail and its nudge share a positioning context so the
            arrow can sit over the rail's right edge. */}
        <div
          className={`tn-rail${canScrollRight ? ' has-more' : ''}${canScrollLeft ? ' has-prev' : ''}`}
        >
        <div ref={railRef} className="tabs relative flex items-center gap-1 shrink-0">
          {/* Decoration, first in the rail so it paints behind the pills:
              pointer-events:none and aria-hidden, so it cannot intercept a
              click or reach a screen reader. Sized/positioned by
              placeThumb — never by React. */}
          <span ref={thumbRef} aria-hidden className="tab-thumb" />
          {/* Real anchors (same .tab-pill chrome as the Pill primitive) so
              the tabs behave like browser links: right-click → open in new
              tab, drag to a new window/tab. Plain left-clicks preventDefault
              and take the SPA path; modifier/middle clicks stay native. */}
          {tabs.map((tab) => {
            const dest = TAB_VIEWS[tab];
            return (
              <a
                key={tab}
                href={dest ? hrefForView(dest) : '#'}
                className={`tab-pill${active === tab ? ' active' : ''}`}
                style={{
                  textDecoration: 'none',
                  // The frens pill wears a mini confetti mosaic at its top
                  // right (echo of the frens masthead); relative anchors it
                  // and the extra padding gives the pixels air past the S.
                  ...(tab === 'frens' ? { position: 'relative' as const, paddingRight: 19 } : null),
                }}
                onFocus={() => prefetchTab(tab)}
                onPointerEnter={() => prefetchTab(tab)}
                onClick={(e) => {
                  if (
                    e.defaultPrevented
                    || e.button !== 0
                    || e.metaKey
                    || e.ctrlKey
                    || e.shiftKey
                    || e.altKey
                  ) {
                    return;
                  }
                  e.preventDefault();
                  handleTab(tab);
                }}
              >
                {TAB_LABEL[tab]}
                {tab === 'frens' ? <FrensPillMosaic /> : null}
              </a>
            );
          })}
        </div>

        {/*
          THE NUDGE. The destinations are the one thing on this bar
          allowed to run out of room — they clip where the tools begin —
          so there has to be a way to reach the tail. It steps the rail
          along rather than asking for a drag: a horizontal scrollbar in a
          56px bar is chrome nobody wants, and a sideways trackpad flick
          at the top of a page fires the browser's back gesture.

          The rail is found from the button's own position in the DOM
          rather than from a ref. A ref was tried and read back null
          inside the handler, so every press hit an early return with
          nothing to show for it.
        */}
        {/*
          BACK. The mirror of the nudge, and the reason this pair exists:
          stepping the rail forward with no way to step it back left the
          first destinations unreachable until the window was resized.

          Same step distance in both directions, so a press one way is
          undone exactly by a press the other.
        */}
        <button
          type="button"
          className="tn-less"
          aria-label="Previous destinations"
          onClick={(event) => {
            const el = event.currentTarget.parentElement?.querySelector('.tabs');
            if (!(el instanceof HTMLElement)) return;
            el.scrollBy({ left: -Math.max(120, el.clientWidth - 90), behavior: 'smooth' });
          }}
        >
          <svg width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden>
            <path d="M7 2L2 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="tn-more"
          aria-label="More destinations"
          onClick={(event) => {
            const el = event.currentTarget.parentElement?.querySelector('.tabs');
            if (!(el instanceof HTMLElement)) return;
            el.scrollBy({ left: Math.max(120, el.clientWidth - 90), behavior: 'smooth' });
          }}
        >
          <svg width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden>
            <path d="M2 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        </div>
      </div>

      {/* The agent field is the bar's only flexible element (see
          `.agent-field` in listen.css): slack lands there and pressure
          never does, because every sibling on the bar is shrink-0. */}
      <div className="hidden md:flex flex-[1_1_auto] justify-center min-w-0 items-center gap-2">
        <AgentSearch />
        <TokenSearchTrigger />
      </div>

      <div className="flex-1 md:hidden" />

      <div className="bar-r flex items-center gap-2 sm:gap-2.5 shrink-0">
        <WalletNavCluster sol={walletBalances.sol} usdc={walletBalances.usdc} />

        <NotificationBell />

        <AuthControls />

        {/* The Settings gear retired here: the profile editor is now the
            account menu's Edit Profile row, and the theme "Tweaks" panel
            moved to the status bar's artist-canvas button. */}
        <button
          type="button"
          className="tn-burger hdr-ctl hdr-ctl-sq"
          aria-label="Menu"
          aria-expanded={drawerOpen}
          data-testid="nav-burger"
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/*
          The drawer takes the bar's OWN `tabs` and `active` and calls the
          bar's own `handleTab`. Two surfaces deriving "which tab is
          current" independently is how they end up disagreeing — the
          conditionals flag alone would do it.
        */}
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          tabs={tabs}
          active={active}
          onSelect={handleTab}
          onAskSoren={
            getRuntimeConfig().agentChat
              ? () =>
                  void import('@/lib/agent/chat-store').then((m) =>
                    m.useAgentChatStore.getState().openWindow(),
                  )
              : null
          }
        />
      </div>
    </header>
  );
}

/**
 * Mini confetti mosaic perched at the top-right of the FRENS nav pill — a
 * five-pixel echo of the frens masthead mosaic (same palette, same stepped
 * scatter). Pixels twinkle on a slow stagger (`.frens-pill-px` in
 * listen.css; stilled under prefers-reduced-motion). Absolutely positioned
 * inside the pill so it never affects nav layout.
 */
function FrensPillMosaic() {
  // x/y in px within an 11×8 corner plot; stepped like the masthead's edge.
  const cells: ReadonlyArray<{ x: number; y: number; c: string; d: string }> = [
    { x: 4, y: 0, c: '#f052d2', d: '0s' },
    { x: 8, y: 0, c: '#8b5cf6', d: '1.4s' },
    { x: 0, y: 4, c: '#fbbf24', d: '2.6s' },
    { x: 4, y: 4, c: '#37d67a', d: '0.8s' },
    { x: 8, y: 4, c: '#38bdf8', d: '2s' },
  ];
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: 3,
        right: 5,
        width: 11,
        height: 7,
        pointerEvents: 'none',
      }}
    >
      {cells.map((cell) => (
        <span
          key={`${cell.x}-${cell.y}`}
          className="frens-pill-px"
          style={{
            left: cell.x,
            top: cell.y,
            background: cell.c,
            boxShadow: `0 0 4px color-mix(in srgb, ${cell.c} 65%, transparent)`,
            animationDelay: cell.d,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Token search entry point: icon button beside the agent placeholder; the
 * modal chunk loads on first click (dynamic import, mounted only while open).
 */
/**
 * A PLACEHOLDER FOR SOREN. Not him.
 *
 * The real art is character art and is not in this repo — the control
 * shipped a sparkles glyph, so the version people have seen is ahead of
 * this code. This is a neutral round face at the right weight to hold
 * against 14px type, so the composition is right and only the artwork
 * has to be swapped.
 */
function SorenFace() {
  return (
    <svg
      aria-hidden
      className="tn-soren shrink-0"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 2.5c5.2 0 8.5 3.4 8.5 8.4v6.4c0 2.6-1.8 4.2-4.4 4.2H7.9c-2.6 0-4.4-1.6-4.4-4.2v-6.4c0-5 3.3-8.4 8.5-8.4z"
        fill="currentColor"
      />
      <ellipse cx="9.1" cy="11" rx="1.35" ry="1.75" fill="#000000" />
      <ellipse cx="14.9" cy="11" rx="1.35" ry="1.75" fill="#000000" />
    </svg>
  );
}

function TokenSearchTrigger() {
  const [open, setOpen] = useState(false);
  // External open requests (card popovers' "Search for TICKER") arrive via
  // the token-search-store with a prefill query.
  const pendingQuery = useTokenSearchStore((s) => s.query);
  useEffect(() => {
    if (pendingQuery !== null) setOpen(true);
  }, [pendingQuery]);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) useTokenSearchStore.getState().clear();
  };
  return (
    <>
      <button
        type="button"
        aria-label="Search tokens"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="token-search-trigger"
        onClick={() => setOpen(true)}
        className={cn('hdr-ctl hdr-ctl-sq flex shrink-0 items-center', open && 'is-on')}
      >
        <Search style={{ width: 'var(--hdr-ico)', height: 'var(--hdr-ico)' }} />
      </button>
      {open ? (
        <TokenSearchModal
          open={open}
          onOpenChange={handleOpenChange}
          initialQuery={pendingQuery ?? undefined}
        />
      ) : null}
    </>
  );
}

function AgentSearch() {
  // `agent-field` carries the flex contract (1 1 auto, floor 320, ceiling
  // 480); `hdr-ctl` carries the etched frame every control shares.
  const chromeClass = 'hdr-ctl agent-field flex items-center gap-2 px-[var(--hdr-pad)]';
  const inner = (
    <>
      {/* THE LABEL LEADS AND THE FACE TRAILS, like a signature after a
          line. Eight readings of this as a text input were built and all
          eight were wrong the same way: Soren is a character, and they
          all drew a search box around him. */}
      <span className="flex-1 truncate text-left">Ask Soren</span>
      <SorenFace />
      <Kbd>⌘ K</Kbd>
    </>
  );
  // Flag off (prod today): the exact decorative div this always was.
  if (!getRuntimeConfig().agentChat) {
    return <div className={chromeClass}>{inner}</div>;
  }
  // Flag on: a real button that opens the floating agent window. The
  // store is reached through a lazy import() so agent-chat code stays in
  // its never-in-main-bundle async chunk (same boundary AgentChatDock
  // uses); openWindow() also re-focuses the input when already open.
  return (
    <button
      type="button"
      aria-label="Open agent chat"
      data-testid="agent-topnav-open"
      onClick={() =>
        void import('@/lib/agent/chat-store').then((m) =>
          m.useAgentChatStore.getState().openWindow(),
        )
      }
      className={chromeClass}
    >
      {inner}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      className="shrink-0 px-[5px] py-[3px] text-[9px] leading-none rounded-[var(--hdr-r-micro)] border border-[var(--hdr-edge)] bg-[var(--chip-bg)] text-[var(--ink-3)]"
      style={{ fontFamily: 'var(--mono)' }}
    >
      {children}
    </span>
  );
}

/**
 * Wallet area of the topnav. Before the wallet is set up we show ONLY a
 * "Finish Wallet Setup" CTA (no provisioning pill, no 0-balance clutter)
 * that re-opens onboarding; once ready to trade we show the SOL balance —
 * unless the AGENT wallet is still unfinished, in which case the same
 * slot carries a "Set Up Agent Wallet" chip instead. The slot decision is
 * a pure function (`deriveNavSlotState`) so its fail-closed cases are
 * testable: an agent-status query that is loading or errored keeps the
 * balance pill and never flashes a chip.
 * Renders nothing while signed out or while `/me` is still loading.
 */
function WalletNavCluster({ sol, usdc }: { sol: string; usdc: string }) {
  const { isSignedIn } = useAuth();
  const { loading, tradingReady } = useWalletSetupStatus();
  const { openOnboarding } = useOnboarding();
  const { openAgentWalletSetup } = useAgentWalletSetup();
  const router = useRouter();
  // Fails closed to the classic modal — see the hook.
  const fullscreenOnboarding = useFullscreenOnboarding();
  const { data: me } = useMe();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'deposit' | 'withdraw'>('deposit');
  // Cheap by design: no polling here, a long staleTime, and the SAME key
  // the setup modal and the Portfolio panel observe — one cache entry
  // keeps every agent-wallet surface consistent.
  const { data: agentStatus } = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: ({ signal }) => fetchAgentWalletStatus({ signal }),
    enabled: isSignedIn === true && tradingReady,
    staleTime: 60_000,
  });

  const primaryWallet = useMemo(() => {
    if (!me || me.reauth_required) return null;
    return pickPrimaryWalletEntry(me.wallets) ?? pickDefaultExportWallet(me.wallets);
  }, [me]);
  const pubkey = primaryWallet?.wallet_pubkey ?? null;
  const walletAccountId = primaryWallet?.wallet_account_id ?? null;

  if (isSignedIn !== true) return null;
  // If `/me` is missing or temporarily reauth-shaped after a page
  // refresh, do not render the setup CTA. That CTA means "wallet is
  // provisioned but unfinished"; a transient auth/API miss is an
  // unknown state and should stay visually neutral until `useMe`
  // recovers.
  if (!me || me.reauth_required) return null;

  // Dev preview: show the balance for any signed-in user regardless of
  // setup/loading state (sample value), so the design is visible on
  // localhost. Otherwise show the balance only once ready to trade.
  const previewForced = isWalletReadyPreviewForced();
  // Dev preview for the agent chip: any of the three fixture modes forces
  // the chip visible so the modal is reachable without a backend.
  const agentPreview = agentWalletSetupPreview();
  const slot: NavSlotState =
    agentPreview === null
      ? deriveNavSlotState({
          isSignedIn: true,
          meReady: true,
          walletLoading: previewForced ? false : loading,
          tradingReady: previewForced || tradingReady,
          agentStatus: agentStatus ?? null,
        })
      : 'agent-setup';

  const openModal = (tab: 'deposit' | 'withdraw') => {
    setModalTab(tab);
    setWalletModalOpen(true);
  };

  /*
   * THE BALANCE, AS ITS OWN THING.
   *
   * It used to live only inside the `balance` branch, so the bar showed
   * EITHER the setup CTA or your balance and never both — and "you have
   * not set up an agent wallet yet" and "here is what you hold" are not
   * mutually exclusive facts. You can have SOL sitting there and no agent
   * wallet, and the old bar hid the money in exactly that case.
   */
  const balancePill = (
    <>
      <WalletBalancePopover
        onDeposit={() => openModal('deposit')}
        onWithdraw={() => openModal('withdraw')}
      >
        <WalletBalances
          sol={previewForced ? PREVIEW_SOL_BALANCE : sol}
          usdc={previewForced ? PREVIEW_USDC_BALANCE : usdc}
        />
      </WalletBalancePopover>
      {/* Mounted only while open so the dynamic chunk loads on first
          click, not at page boot. */}
      {walletModalOpen ? (
        <WalletBalanceModal
          open={walletModalOpen}
          onOpenChange={setWalletModalOpen}
          pubkey={pubkey}
          walletAccountId={walletAccountId}
          initialTab={modalTab}
        />
      ) : null}
    </>
  );

  if (slot === 'agent-setup') {
    return (
      <>
      <button
        type="button"
        data-testid="setup-agent-wallet"
        onClick={openAgentWalletSetup}
        className="inline-flex h-[var(--hdr-h)] shrink-0 items-center gap-1.5 rounded-[var(--hdr-r)] border border-[var(--hdr-edge)] px-[var(--hdr-pad)] text-[12px] font-semibold text-[var(--accent-ink)] transition-opacity bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))] hover:opacity-90"
      >
        <Bot style={{ width: 'var(--hdr-ico)', height: 'var(--hdr-ico)' }} />
        Set up agent wallet
      </button>
      {balancePill}
      </>
    );
  }

  if (slot === 'balance') {
    return (
      <>
        {/* Deposit is the one wallet action worth a permanent home in the
            nav: it is what an empty account needs and what a trading
            account returns to. */}
        <button
          type="button"
          data-testid="nav-deposit"
          onClick={() => openModal('deposit')}
          aria-label="Deposit"
          className="inline-flex shrink-0 items-center"
        >
          Deposit
        </button>
        {balancePill}
      </>
    );
  }

  /*
   * THE BALANCE SHOWS IN EVERY STATE, and `none` is the one that used to
   * return nothing at all. Whatever is or is not set up, if there is a
   * session and a wallet then what you hold is a fact worth having on
   * the bar — the setup CTA is about the agent, not about your money.
   */
  if (slot === 'none') return balancePill;

  return (
    <>
    <button
      type="button"
      data-testid="finish-wallet-setup"
      onClick={() => (fullscreenOnboarding ? router.push(WELCOME_PATH) : openOnboarding())}
      className="inline-flex h-[var(--hdr-h)] shrink-0 items-center gap-1.5 rounded-[var(--hdr-r)] border border-[var(--hdr-edge)] px-[var(--hdr-pad)] text-[12px] font-semibold text-[var(--accent-ink)] transition-opacity bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))] hover:opacity-90"
    >
      <Wallet style={{ width: 'var(--hdr-ico)', height: 'var(--hdr-ico)' }} />
      Finish Wallet Setup
    </button>
    {balancePill}
    </>
  );
}

/**
 * The balance pill. `forwardRef` + prop spread because it is used as a
 * Radix `PopoverTrigger asChild` — the trigger owns the ref, the click
 * handler and the `aria-expanded`/`aria-controls` wiring, so this
 * component must pass all of it through rather than declaring its own.
 */
const WalletBalances = forwardRef<
  HTMLButtonElement,
  { sol: string; usdc: string } & ComponentPropsWithoutRef<'button'>
>(function WalletBalances({ sol, usdc, ...triggerProps }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Show balances"
      data-testid="wallet-balance-pill"
      className="hdr-ctl hdr-ctl--glass inline-flex shrink-0 items-center gap-2 px-[var(--hdr-pad)]"
      {...triggerProps}
    >
      {/* The wallet glyph went to ink with the rest of the cluster — this
          plate carries no value of its own, only the shared tokens. */}
      <Wallet style={{ width: 'var(--hdr-ico)', height: 'var(--hdr-ico)' }} />
      <span className="inline-flex items-center gap-[5px]">
        <Solana style={{ width: 12, height: 12 }} />
        <Numeral size="xs" tone="ink-0">
          {sol}
        </Numeral>
      </span>
      {/* Hairline divider between the SOL and USDC segments. */}
      <span
        aria-hidden
        className="hdr-ctl-rule self-stretch my-[6px] w-px shrink-0 bg-[var(--hdr-edge)]"
      />
      {/* Aggregate USDC across the same wallet set — same source/cadence
          as the SOL segment (one bulk balances query feeds both). */}
      <span className="inline-flex items-center gap-[5px]">
        <Usdc style={{ width: 12, height: 12 }} />
        <Numeral size="xs" tone="ink-0">
          {usdc}
        </Numeral>
      </span>
    </button>
  );
});

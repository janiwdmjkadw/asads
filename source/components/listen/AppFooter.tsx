'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { DockFooterToggle } from '@/components/discover/dock/DockChrome';
import { useFloatingPanelZ } from '@/lib/state/floating-panel-order';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeSwitcher } from './ThemeSwitcher';
import { pageZoom } from '@/lib/page-zoom';
import { ONLINE_BEAT_INTERVAL_MS, sendOnlineBeat, sendOnlineLeave } from '@/lib/api/presence';
/* The footer no longer DISPLAYS the online total, but it still writes it:
   the beat lives here and other surfaces read the store. */
import { useViewersStore } from '@/lib/state/viewers-store';
import './footer-v2.css';

/* Edit these to point at the real community links. */
const DISCORD_URL = 'https://discord.gg/F2kxV5zPv5';
const TWITTER_URL = 'https://x.com/listendotmoney';

/**
 * Thin full-bleed status bar pinned to the bottom of every app page.
 * Height is tokenized (`--h-footer`) and carved out of `--h-app-content`.
 *
 * ── SPLIT ENDS ───────────────────────────────────────────────────────
 *
 * Five marks and nothing else. The two panel toggles take the left end;
 * the palette, Discord and X take the right. One end each: what you open
 * on the page you are on, and where you go from it.
 *
 * ── WHAT CAME OFF ────────────────────────────────────────────────────
 *
 * The FPS readout and the viewer count. A frame counter means nothing to
 * someone trading and changes every second; a live total of strangers on
 * the site is not something the bar under a board needs to carry. Both
 * sat permanently on screen, and between them they were the two widest
 * things on the strip.
 *
 * The presence HEARTBEAT stayed — see `PresenceBeat`. It was tangled up
 * with the readout that displayed it, and dropping the display must not
 * drop the reporting.
 *
 * The connection line stayed too, and it is the only text left. It draws
 * nothing while the socket is healthy, which is almost always, and a
 * dropped socket is the one thing on this bar you genuinely need told
 * about.
 */
export function AppFooter() {
  return (
    /* Footer-local Tooltip provider: the footer is mounted by the app
       layout on every page, OUTSIDE any page-level provider (Discover's
       provider wraps only its own subtree), so the icon tooltips here
       carry their own. Same delay config as DiscoverPage's. */
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      {/* `app-footer` carries the surface (floor + neutral rail + lift); see
          listen.css. Everything else is layout and stays in utilities. The bar
          is static — nothing in it animates. */}
      <footer data-footer-v2="" className="app-footer relative z-20 flex h-[var(--h-footer)] w-full shrink-0 items-center justify-between gap-3 px-4 sm:px-8">
        {/* LEFT: the panels. Renders nothing on routes without docks, so
            on those pages the left end is simply empty. */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Draws nothing while the socket is healthy — it brings its
              own divider when it has something to say, so the row does
              not open on a stray rule. */}
          <ConnectionStatus />
          <DockToggles />
        </div>

        {/* RIGHT: where you go. */}
        <div className="flex items-center gap-3">
          <CanvasButton />
          <SocialLink href={DISCORD_URL} label="Join our Discord">
            <DiscordIcon />
          </SocialLink>
          <SocialLink href={TWITTER_URL} label="Follow us on X">
            <XIcon />
          </SocialLink>
        </div>

        {/* No mark of its own: it only reports presence. */}
        <PresenceBeat />
      </footer>
    </TooltipProvider>
  );
}

/** Dock panel toggles (wallet activity + tweet tracker), relocated from
 *  the floating bottom-right pills into the status bar. Route-aware: they
 *  control the ACTIVE page's dock context and hide on routes without
 *  docks. */
function DockToggles() {
  const pathname = usePathname() ?? '';
  const ctx = pathname.startsWith('/trade')
    ? ('trade' as const)
    : pathname.startsWith('/discover')
      ? ('discover' as const)
      : null;
  if (ctx === null) return null;
  return (
    <div className="flex items-center gap-3">
      <DockFooterToggle panelId="wallet" ctx={ctx} label="Activity" />
      <DockFooterToggle panelId="tweets" ctx={ctx} label="Tweets" />
    </div>
  );
}

/**
 * Artist canvas: the theme/font/sound "Tweaks" panel, relocated from the
 * top-nav gear (which now owns Settings/Profile). Opens UPWARD from the
 * status bar.
 *
 * The popover is PORTALED to the `.listen-root` element (the theme-token
 * scope) rather than rendered inside the footer: the footer is a `z-20`
 * stacking context, so an in-place popover could never paint above the
 * floating docks (z-30+) no matter its own z-index. From the root it joins
 * the shared click-to-raise band with the docks / instant trade box.
 */
function CanvasButton() {
  const [open, setOpen] = useState(false);
  const [rightOffset, setRightOffset] = useState(16);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { zIndex, raise } = useFloatingPanelZ('canvas-tweaks');
  // Opening the canvas puts it on top of whatever floating panel is up.
  useEffect(() => {
    if (open) raise();
  }, [open, raise]);
  const portalTarget = open ? (anchorRef.current?.closest('.listen-root') ?? document.body) : null;
  return (
    <div className="relative" ref={anchorRef}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Tweaks (themes, fonts, sounds)"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              if (!open && anchorRef.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                // Physical px → layout px (fixed `right` is page-zoom-multiplied).
                setRightOffset(
                  Math.max(8, Math.round((window.innerWidth - rect.right) / pageZoom())),
                );
              }
              setOpen((v) => !v);
            }}
            className="ftv-icon inline-flex items-center justify-center"
            style={open ? { color: '#ffffff' } : undefined}
          >
            <PaletteIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Tweaks — themes, fonts, sounds</TooltipContent>
      </Tooltip>
      {open && portalTarget
        ? createPortal(
            <div
              onPointerDownCapture={raise}
              style={{
                position: 'fixed',
                right: rightOffset,
                bottom: 'calc(var(--h-footer, 28px) + 10px)',
                zIndex,
              }}
            >
              <ThemeSwitcher
                onClose={() => setOpen(false)}
                anchorRef={anchorRef}
                anchorStyle={{ bottom: 0, right: 0 }}
              />
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}

/*
 * 24, up from 21. These three are the only things on the bar anyone
 * actually presses, and they were the quietest objects on it. The box
 * they sit in is 28px inside a 30px bar and cannot grow, so the glyph
 * takes the room instead — the hover plate is a tighter ring now, which
 * is the trade.
 */
function PaletteIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a9 9 0 1 0 0 18h.8a2.2 2.2 0 0 0 1.6-3.7 2.2 2.2 0 0 1 1.6-3.7H19a3 3 0 0 0 3-3c0-4.2-4.5-7.6-10-7.6Z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Divider() {
  return <span aria-hidden className="ftv-div ftv-drop hidden h-3 w-px sm:block" />;
}

function ConnectionStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  /*
   * ── HEALTHY SAYS NOTHING ─────────────────────────────────────────
   *
   * "Connection is stable" was twenty characters saying what its own
   * absence already says, permanently parked at the start of a 30px bar
   * that runs the full width of every page. Nobody reads it while it is
   * true, and it was the widest thing in the left cluster.
   *
   * So the healthy state is now silence, and the component only exists
   * for the exception. It brings its own divider so the row does not
   * open on a stray rule when there is nothing to separate.
   *
   * NOT deleted outright: a dropped socket is the one thing on this bar
   * you genuinely need told about, and on a phone — where the narrow
   * rules drop FPS and the viewer count — it is the likeliest thing to
   * go wrong. No pip either; the sentence states the condition in words,
   * and colour is spent only on the exception.
   */
  if (online) return null;

  return (
    <>
      <span className="ftv-cap is-bad inline-flex items-center whitespace-nowrap">
        Reconnecting…
      </span>
      <Divider />
    </>
  );
}

/**
 * The presence heartbeat, and NOTHING drawn.
 *
 * This used to be `OnlineReadout`: an eye and a live count of everyone
 * with Listen open, which also happened to own the beats that produce
 * that number. The readout is gone from the bar — a total of strangers
 * is not what the strip under a trading board is for — but the beat is
 * not, because other surfaces read the same store.
 *
 * So the effect stays exactly as it was and the component renders null.
 * The footer mounts on every app page, which is why this lives here:
 * every ~15s while the tab is visible (a background tab is not online),
 * with a leave beacon on hide and close.
 */
function PresenceBeat() {
  useEffect(() => {
    let stopped = false;
    let intervalHandle: number | null = null;
    const beat = () => {
      void sendOnlineBeat().then((count) => {
        if (stopped || count === null) return;
        useViewersStore.getState().setOnline(count);
      });
    };
    const start = () => {
      if (intervalHandle !== null) return;
      beat();
      intervalHandle = window.setInterval(beat, ONLINE_BEAT_INTERVAL_MS);
    };
    const stop = (leave: boolean) => {
      if (intervalHandle !== null) {
        window.clearInterval(intervalHandle);
        intervalHandle = null;
        if (leave) sendOnlineLeave();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop(true);
    };
    const onPageHide = () => stop(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    if (document.visibilityState === 'visible') start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      stop(true);
      stopped = true;
    };
  }, []);
  return null;
}


function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="ftv-icon inline-flex items-center justify-center"
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function DiscordIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

/* 22, a point under Discord's 24. The X is a solid geometric mark and
   the Discord glyph has interior counters, so matching them by number
   would leave the X looking the heavier of the two — the same reason
   they were 20 and 21 before this. */
function XIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

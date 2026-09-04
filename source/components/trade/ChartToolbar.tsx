import { IconButton } from '@/components/listen/primitives';
import {
  Camera,
  Chevron,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Expand,
  Formula,
  Grid,
  Link,
  Settings,
} from '@/components/listen/icons/Icons';
import {
  useChartPrefsStore,
  type ChartScaleMode,
  type ChartUnit,
} from '@/lib/state/chart-prefs-store';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChartSettingsModal } from './ChartSettingsModal';
import { CHART_TIMEFRAMES, type ChartTimeframe } from './timeframes';
import { useTradePaneHidden } from './tradePaneVisibility';
import { hydrateChartPrefs } from '@/lib/state/chart-prefs-store';
import { pageZoom } from '@/lib/page-zoom';


/*
 * ── THE CHART IS SEVERAL CANVASES ────────────────────────────────────
 *
 * Lightweight-charts stacks a pane canvas, a crosshair canvas and one
 * per price scale, each absolutely positioned. There is no single
 * element to grab, so a snapshot composites them: one target canvas the
 * size of the pane, every source drawn at its own offset in DOM order.
 *
 * Returns null when the chart has not painted yet, so every caller can
 * simply do nothing rather than write an empty file.
 */
function captureChart(from: HTMLElement | null): HTMLCanvasElement | null {
  const pane = from?.closest('.tc')?.querySelector<HTMLElement>('.tc-canvas');
  if (!pane) return null;
  const sources = Array.from(pane.querySelectorAll('canvas'));
  if (sources.length === 0) return null;

  const box = pane.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;

  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement('canvas');
  out.width = Math.round(box.width * dpr);
  out.height = Math.round(box.height * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  /* The chart's own ground, so the PNG is not transparent where no
     candle happens to be. */
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, out.width, out.height);

  for (const src of sources) {
    if (src.width === 0 || src.height === 0) continue;
    const r = src.getBoundingClientRect();
    ctx.drawImage(src, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return out;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

type SnapAction = 'download' | 'copy' | 'link' | 'tab' | 'tweet';

const Download = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 18.5h15" />
  </svg>
);

/* The X mark, drawn — there is no brand glyph in the icon set and the
   letter X is not the logo. */
const XMark = (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M17.2 3h3.3l-7.2 8.3L21.7 21h-6.6l-5.2-6.4L4 21H.7l7.7-8.8L0 3h6.8l4.7 5.9zm-1.2 16h1.8L6.1 4.8H4.2z" />
  </svg>
);

const SNAP_ITEMS: ReadonlyArray<{ id: SnapAction; label: string; keys: string; icon: React.ReactNode }> = [
  { id: 'download', label: 'Download image', keys: 'Ctrl + Alt + S', icon: Download },
  { id: 'copy', label: 'Copy image', keys: 'Ctrl + Shift + S', icon: <Copy /> },
  { id: 'link', label: 'Copy link', keys: 'Alt + S', icon: <Link /> },
  { id: 'tab', label: 'Open in new tab', keys: '', icon: <ExternalLink /> },
  { id: 'tweet', label: 'Tweet image', keys: '', icon: XMark },
];

interface Props {
  timeframe: ChartTimeframe;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
}

export function ChartToolbar({ timeframe, onTimeframeChange }: Props) {
  // Timeframe popup: the full timeframe list (the chart footer carries
  // the quick subset; both drive the same store selection). PORTALED to
  // <body> with a viewport-fixed anchor — the toolbar is a fixed-height
  // overflow-x-auto strip, so anything absolutely positioned inside it
  // gets scroll-clipped into invisibility (live repro: the popup opened
  // but never showed, reading as a dead button).
  const [tfMenu, setTfMenu] = useState<{ left: number; top: number } | null>(null);
  // Persisted prefs apply post-mount (SSR renders defaults — see
  // hydrateChartPrefs).
  useEffect(() => {
    hydrateChartPrefs();
  }, []);
  // [orphan guard] The menu portals outside the pane: when the pane hides
  // (back/forward navigation) the open menu would float over the new page.
  const paneHidden = useTradePaneHidden();
  useEffect(() => {
    if (paneHidden) setTfMenu(null);
  }, [paneHidden]);
  const tfButtonRef = useRef<HTMLButtonElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const snapRef = useRef<HTMLDivElement | null>(null);
  const snapBtnRef = useRef<HTMLSpanElement | null>(null);
  /*
   * ── THE MENU IS PORTALLED, LIKE THE TIMEFRAME ONE ───────────────────
   *
   * `.tc-bar` sets `overflow-x: auto` to scroll sideways, and CSS does
   * not let one axis clip while the other stays visible — so the bar is
   * a clipping box in BOTH directions, 42px tall. A 222px menu inside it
   * was cut to a sliver, and `.tw-col`'s own `overflow: hidden` took
   * what was left.
   *
   * So it renders at the document root at a viewport-fixed anchor,
   * exactly as the timeframe popup above already does for exactly this
   * reason. `null` while shut; a rect while open.
   */
  const [snapOpen, setSnapOpen] = useState<{ left: number; top: number } | null>(null);
  const [full, setFull] = useState(false);

  /*
   * ── FULLSCREEN IS THE CHART COLUMN, NOT THE PAGE ────────────────────
   *
   * `.tc` is the toolbar, the pane and the footer — the whole chart and
   * nothing else. Taking the document fullscreen would carry the nav,
   * the rail and the tape along with it, which is the opposite of what
   * the button is for.
   */
  const toggleFull = () => {
    const el = barRef.current?.closest('.tc') as HTMLElement | null;
    if (!el) return;
    /*
     * Both calls can reject: `requestFullscreen` needs a real user
     * gesture and the permission, and an embedded view (an iframe
     * without `allow="fullscreen"`) refuses outright. Swallowed, because
     * a refused fullscreen is not an error the page can act on — the
     * chart simply stays where it is.
     */
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const runSnapshot = async (action: SnapAction) => {
    if (action === 'link') {
      try { await navigator.clipboard.writeText(window.location.href); } catch { /* denied */ }
      return;
    }
    if (action === 'tweet') {
      /* An intent URL cannot carry an image, so it carries the view and
         the picture rides along as the link's own preview. */
      const url = `https://x.com/intent/post?url=${encodeURIComponent(window.location.href)}`;
      window.open(url, '_blank', 'noopener');
      return;
    }

    const canvas = captureChart(barRef.current);
    if (!canvas) return;

    if (action === 'tab') {
      const blob = await canvasBlob(canvas);
      if (!blob) return;
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      return;
    }
    if (action === 'copy') {
      const blob = await canvasBlob(canvas);
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch { /* clipboard image writes are permission gated */ }
      return;
    }
    /* download */
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'chart.png';
    a.click();
  };

  /* The shortcuts the menu advertises. A menu that prints a key
     combination beside an item and does not listen for it is lying. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== 's') return;
      if (e.ctrlKey && e.altKey) { e.preventDefault(); void runSnapshot('download'); }
      else if (e.ctrlKey && e.shiftKey) { e.preventDefault(); void runSnapshot('copy'); }
      else if (e.altKey && !e.ctrlKey) { e.preventDefault(); void runSnapshot('link'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Close the snapshot menu on an outside press. */
  useEffect(() => {
    if (!snapOpen) return;
    const onDown = (e: PointerEvent) => {
      if (snapRef.current?.contains(e.target as Node)) return;
      if (snapBtnRef.current?.contains(e.target as Node)) return;
      setSnapOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [snapOpen]);

  const tfMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tfMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu lives in a portal: check BOTH containers, otherwise the
      // close-on-outside fires before a menu item's click and eats it.
      if (tfButtonRef.current?.contains(target) || tfMenuRef.current?.contains(target)) return;
      setTfMenu(null);
    };
    const onClose = () => setTfMenu(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [tfMenu]);
  const unit = useChartPrefsStore((s) => s.unit);
  const mode = useChartPrefsStore((s) => s.mode);
  const hideBubbles = useChartPrefsStore((s) => s.hideBubbles);
  const setUnit = useChartPrefsStore((s) => s.setUnit);
  const setMode = useChartPrefsStore((s) => s.setMode);
  const setHideBubbles = useChartPrefsStore((s) => s.setHideBubbles);
  const setSettingsOpen = useChartPrefsStore((s) => s.setSettingsOpen);

  return (
    <div className="tc-bar" ref={barRef}>
      {/* The timeframe. It opens the full list, so it carries a chevron
          and the quick set in the footer does not. */}
      <button
        ref={tfButtonRef}
        type="button"
        className="tc-tf"
        aria-haspopup="listbox"
        aria-expanded={tfMenu != null}
        onClick={() => {
          if (tfMenu) {
            setTfMenu(null);
            return;
          }
          const rect = tfButtonRef.current?.getBoundingClientRect();
          // Rect is physical px; fixed left/top are page-zoom-multiplied.
          const z = pageZoom();
          if (rect) setTfMenu({ left: rect.left / z, top: rect.bottom / z + 4 });
        }}
      >
        {timeframe}
        <Chevron />
      </button>
      {tfMenu != null && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tfMenuRef}
              role="listbox"
              className="tc-menu"
              style={{ left: tfMenu.left, top: tfMenu.top }}
            >
              {CHART_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="option"
                  aria-selected={tf === timeframe}
                  className="tc-menu-i"
                  data-on={tf === timeframe ? '' : undefined}
                  onClick={() => {
                    onTimeframeChange(tf);
                    setTfMenu(null);
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>,
            // Inside the theme scope: CSS variables (accent highlight,
            // surfaces) don't exist above .listen-root.
            (document.querySelector('.listen-root') as HTMLElement | null) ?? document.body,
          )
        : null}

      <IconButton className="tc-ico" label="Indicators"><Formula /></IconButton>
      <IconButton className="tc-ico" label="Recent"><Clock /></IconButton>
      <IconButton className="tc-ico" label="Grid"><Grid /></IconButton>

      <i className="tc-div" aria-hidden />

      <button
        type="button"
        onClick={() => setHideBubbles(!hideBubbles)}
        aria-pressed={hideBubbles}
        data-testid="hide-all-bubbles"
        className="tc-btn"
        data-on={hideBubbles ? '' : undefined}
      >
        {hideBubbles ? <Eye /> : <EyeOff />}
        {hideBubbles ? 'Show bubbles' : 'Hide bubbles'}
      </button>

      <div className="tc-gap" />

      {/* Two segmented tracks, drawn as the rail's are: a bordered track
          with the chosen half lit. They were accent tinted, which made
          two settings the loudest things on the bar. */}
      <div className="tc-seg">
        {(['USD', 'SOL'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            className="tc-seg-b"
            data-on={unit === opt ? '' : undefined}
            onClick={() => setUnit(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="tc-seg">
        {(['MarketCap', 'Price'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            className="tc-seg-b"
            data-on={mode === opt ? '' : undefined}
            onClick={() => setMode(opt)}
          >
            {opt === 'MarketCap' ? 'MCap' : opt}
          </button>
        ))}
      </div>

      {/* No undo. It looped back to nothing — the chart has no edit
          history to step through, so the arrow was a control that could
          never do anything. */}
      <i className="tc-div" aria-hidden />

      <IconButton className="tc-ico" label="Settings" onClick={() => setSettingsOpen(true)}>
        <Settings />
      </IconButton>
      <IconButton className="tc-ico" label={full ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFull}>
        <Expand />
      </IconButton>

      {/* ── THE SNAPSHOT MENU ──────────────────────────────────────
          The camera was a button that did nothing. There is no single
          "screenshot" action anyway — there is saving one, pasting one,
          sharing the view, and posting it — so it opens the four. */}
      <span className="tc-snap-wrap" ref={snapBtnRef}>
        <IconButton
          className="tc-ico"
          label="Chart snapshot"
          data-on={snapOpen ? '' : undefined}
          onClick={(e) => {
            if (snapOpen) {
              setSnapOpen(null);
              return;
            }
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            /*
             * Anchored to the BUTTON's own right edge, not to the
             * viewport's. `window.innerWidth` is 0 in an embedded view
             * that has not been measured yet, which put the menu
             * hundreds of pixels from where it belongs; the button's
             * rect is always real because the button is on screen.
             *
             * The menu then pulls itself left by its own width in CSS,
             * so it right-aligns under the camera without anyone needing
             * to know how wide it is.
             *
             * Rect is physical px; fixed left/top are page-zoom
             * multiplied — the same correction the timeframe popup makes.
             */
            const z = pageZoom();
            setSnapOpen({ left: rect.right / z, top: rect.bottom / z + 6 });
          }}
        >
          <Camera />
        </IconButton>
        {snapOpen != null && typeof document !== 'undefined'
          ? createPortal(
          <div className="tc-snap" ref={snapRef} role="menu" style={{ left: snapOpen.left, top: snapOpen.top }}>
            <span className="tc-snap-h">Chart snapshot</span>
            {SNAP_ITEMS.map((it) => (
              <button
                type="button"
                role="menuitem"
                className="tc-snap-i"
                key={it.id}
                onClick={() => {
                  setSnapOpen(null);
                  void runSnapshot(it.id);
                }}
              >
                {it.icon}
                {it.label}
                <em>{it.keys}</em>
              </button>
            ))}
          </div>,
          /* Inside the theme scope: the menu reads `--sans` and the
             theme's greys, which do not exist above `.listen-root`. */
          (document.querySelector('.listen-root') as HTMLElement | null) ?? document.body,
            )
          : null}
      </span>

      <ChartSettingsModal />
    </div>
  );
}

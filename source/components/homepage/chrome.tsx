'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Shared building blocks for the homepage redesign — one source of truth
 * for the patterns repeated across the four marketing sections: the
 * scroll-reveal observer, the warped section divider, the eyebrow row,
 * the scale-to-fit diagram stage, and the bordered glass diagram panel.
 */

const REVEAL_THRESHOLD = 0.15 as const;

/**
 * Fire `inView` once when the observed element first scrolls into view.
 * Falls back to immediately-visible when IntersectionObserver is absent
 * (older runtimes / SSR safety).
 */
export function useReveal<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= REVEAL_THRESHOLD) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: [0, REVEAL_THRESHOLD, 0.4, 0.7, 1] },
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  return { ref, inView } as const;
}

/** Reveal helper — hidden until `inView`, then runs the named entrance. */
function revealStyle(inView: boolean, animation: string) {
  return { opacity: 0, animation: inView ? animation : undefined } as const;
}

/**
 * Warped, slowly-breathing mint rule that separates the page sections.
 * Relies on the `#lh-warp` SVG filter mounted once by `HomeHero`.
 */
export function SectionDivider({ breathSeconds = 9 }: { breathSeconds?: number }) {
  return (
    <div aria-hidden className="relative z-[2] px-gutter">
      <div className="relative mx-auto h-[34px] max-w-[1200px]">
        <div
          data-loop
          className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 [filter:url(#lh-warp)]"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(94,234,212,0.30) 24%, rgba(122,236,215,0.52) 50%, rgba(94,234,212,0.30) 76%, transparent 100%)',
            animation: `lh-divbreath ${breathSeconds}s ease-in-out infinite`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Section eyebrow: `NN  LABEL ───────────────  META`. `meta` defaults to
 * `NN / 04`; pass it to show a section-specific right-hand tag.
 */
export function SectionEyebrow({
  index,
  label,
  inView,
  meta,
}: {
  index: string;
  label: string;
  inView: boolean;
  meta?: string;
}) {
  return (
    <div
      data-anim
      className="mb-[26px] flex items-center gap-[14px] font-geist-mono"
      style={revealStyle(inView, 'lh-revealfade 0.6s ease-out both')}
    >
      <span className="text-[12px] tracking-[0.1em] text-homepage-accent">{index}</span>
      <span className="text-[11px] uppercase tracking-[0.3em] text-homepage-ink3">{label}</span>
      <span className="h-px flex-1 bg-homepage-line2" />
      <span className="whitespace-nowrap text-[10.5px] tracking-[0.16em] text-homepage-ink3">
        {meta ?? `${index} / 04`}
      </span>
    </div>
  );
}

/**
 * Two-column section header: a large Geist Mono headline on the left and
 * a light Geist body paragraph on the right, collapsing to one column on
 * narrow viewports. Both reveal on scroll with a slight stagger.
 */
export function SectionHeading({
  heading,
  body,
  inView,
}: {
  heading: ReactNode;
  body: ReactNode;
  inView: boolean;
}) {
  return (
    <div className="mb-block-t grid grid-cols-1 items-end gap-x-[56px] gap-y-[32px] md:grid-cols-2">
      <h2
        data-anim
        className="m-0 font-geist-mono text-[clamp(30px,4vw,52px)] font-normal leading-[1.08] -tracking-[0.02em] text-homepage-ink [text-wrap:balance]"
        style={revealStyle(inView, 'lh-revealup 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.08s both')}
      >
        {heading}
      </h2>
      <p
        data-anim
        className="m-0 max-w-[460px] font-geist text-[clamp(14px,1.1vw,16px)] font-light leading-[1.7] text-homepage-ink2 [text-wrap:pretty]"
        style={revealStyle(inView, 'lh-revealup 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.2s both')}
      >
        {body}
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Shared scaffolding for the animated "technical terminal" section diagrams
 * (Trust, Performance, …): the crosshair-grid scale-to-fit stage, the glass
 * shell + chrome label bar, and the console/step-scrubber footer. One source
 * of truth so each section only owns its own diagram internals.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Grid-backed, responsive holder that uniformly scales a fixed `w×h` artboard
 * to fit its column width (never upscaling past 1×). The diagram always fits
 * the viewport — no horizontal scroll or clipped nodes on mobile — trading a
 * smaller render on narrow screens for a complete, unbroken composition. The
 * refs are passed in (not owned) so the host section can drive the artboard
 * directly — e.g. scrub its CSS animations off `stageRef`.
 */
export function DiagramStageHolder({
  holderRef,
  stageRef,
  w,
  h,
  ariaLabel,
  children,
}: {
  holderRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  w: number;
  h: number;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    const stage = stageRef.current;
    const wrap = wrapRef.current;
    if (!holder || !stage || !wrap) return;
    const fit = () => {
      const s = Math.min(holder.clientWidth / w, 1);
      stage.style.transform = `scale(${s})`;
      wrap.style.width = `${w * s}px`;
      wrap.style.height = `${h * s}px`;
      holder.style.height = `${h * s}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    return () => ro.disconnect();
  }, [holderRef, stageRef, w, h]);

  return (
    <div
      ref={holderRef}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      className="lh-diagram-grid relative w-full overflow-hidden"
      style={{ height: h }}
    >
      <div ref={wrapRef} className="relative" style={{ width: w, height: h }}>
        <div
          ref={stageRef}
          className="absolute left-0 top-0 origin-top-left font-geist-mono text-homepage-ink"
          style={{ width: w, height: h }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Bordered glass panel + chrome label bar (`◆ tag … meta`), revealing on
 * scroll. Children are the diagram stage and the console footer.
 */
export function DiagramShell({
  tag,
  meta,
  inView,
  children,
}: {
  tag: string;
  meta: string;
  inView: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Pause this panel's CSS animations while it's well off-screen, so a phone
  // GPU never composites all four diagrams (glass blur + heavy motion) at
  // once — only the diagram(s) near the viewport animate. Big mobile win.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => el.classList.toggle('lh-anim-off', !entry.isIntersecting),
      { rootMargin: '200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={panelRef}
      data-anim
      className="border border-homepage-line bg-[rgba(16,16,18,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_34px_80px_-52px_rgba(0,0,0,0.92)] [backdrop-filter:blur(14px)]"
      style={revealStyle(inView, 'lh-revealup 0.8s cubic-bezier(0.22,0.61,0.36,1) 0.3s both')}
    >
      <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-b border-homepage-line2 px-4 py-2 font-geist-mono text-[10px] uppercase tracking-[0.1em] text-homepage-ink3 sm:h-[38px] sm:flex-nowrap sm:py-0 sm:text-[10.5px] sm:tracking-[0.18em]">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className="h-[5px] w-[5px] shrink-0 rotate-45 bg-homepage-accent" />
          {tag}
        </span>
        <span className="whitespace-nowrap">{meta}</span>
      </div>
      {children}
    </div>
  );
}

/** Console footer: `> status` line + a `0…N` step scrubber + replay. */
export function DiagramConsole({
  statusText,
  statusColor,
  stepCount,
  activeStep,
  onStep,
  onReplay,
}: {
  statusText: string;
  statusColor: string;
  stepCount: number;
  activeStep: number | null;
  onStep: (n: number) => void;
  onReplay: () => void;
}) {
  return (
    <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-4 border-t border-homepage-line2 px-4 py-[10px]">
      <div className="flex min-w-0 items-center gap-[10px]">
        <span className="flex-none font-geist-mono text-[11px] text-homepage-ink3">status</span>
        <span className="h-[13px] w-px flex-none bg-homepage-line2" />
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap font-geist-mono text-[11.5px] tracking-[0.04em]"
          style={{ color: statusColor, transition: 'color 0.3s ease' }}
        >
          &gt; {statusText}
        </span>
        <span
          aria-hidden
          className="inline-block h-[13px] w-[7px] flex-none bg-homepage-accent"
          style={{ animation: 'lh-blink 1s steps(1) infinite' }}
        />
      </div>
      <div className="flex flex-none items-center gap-2">
        {Array.from({ length: stepCount }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-label={`Step ${n}`}
            onClick={() => onStep(n)}
            className="h-6 w-6 cursor-pointer font-geist-mono text-[10.5px] transition-all duration-200"
            style={{
              background: n === activeStep ? 'rgba(94,234,212,0.12)' : 'transparent',
              border: `1px solid ${n === activeStep ? '#5eead4' : 'var(--lh-line2)'}`,
              color: n === activeStep ? '#5eead4' : '#62625c',
            }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          onClick={onReplay}
          className="ml-[6px] cursor-pointer border border-homepage-accent bg-transparent px-[14px] py-[6px] font-geist-mono text-[10.5px] uppercase tracking-[0.16em] text-homepage-accent"
        >
          replay
        </button>
      </div>
    </div>
  );
}

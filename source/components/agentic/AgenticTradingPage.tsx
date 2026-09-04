'use client';

/**
 * `/agentic-trading` — the marketing page for vibe-trading agents.
 *
 * Shares the homepage's shell exactly (the `.lh-home` palette, the
 * technical grid, the fixed registration frame, the warped section
 * dividers, the footer) and adds `.lh-agentic`, whose only job is to
 * introduce `--lha-hot` — the agent's flame, borrowed from the live chat
 * — so the page reads as the same product with a second voice in it.
 *
 * The `#lh-warp` filter is mounted here because `SectionDivider` depends
 * on it and `HomeHero` (which mounts it on `/`) never renders on this
 * route.
 */

import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { SectionDivider, useReveal } from '@/components/homepage/chrome';
import { HomeFooter } from '@/components/homepage/HomeFooter';
import { ListenMark } from '@/components/homepage/ListenMark';
import { AgentRunSection } from './AgentRunSection';
import { AgenticHero } from './AgenticHero';
import { ControlSection } from './ControlSection';
import { HowItWorks } from './HowItWorks';
import { PromptGallery } from './PromptGallery';
import { INK, INK2, INK3, MINT } from './agentSurfaces';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const POST_AUTH_REDIRECT = '/' as const;

function CornerTicks({ size }: { size: number }) {
  const box = { width: `${size}px`, height: `${size}px` } as const;
  return (
    <>
      <span aria-hidden className="absolute -left-px -top-px border-l border-t border-homepage-accent" style={box} />
      <span aria-hidden className="absolute -right-px -top-px border-r border-t border-homepage-line3" style={box} />
      <span aria-hidden className="absolute -bottom-px -left-px border-b border-l border-homepage-line3" style={box} />
      <span aria-hidden className="absolute -bottom-px -right-px border-b border-r border-homepage-line3" style={box} />
    </>
  );
}

/** The last word: one line, one button, nothing else to look at. */
function Closer() {
  const { ref, inView } = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      aria-label="Get started"
      className="relative z-[2] overflow-hidden px-gutter pb-[clamp(72px,11vh,130px)] pt-[clamp(56px,9vh,104px)] text-center"
    >
      <div
        aria-hidden
        data-loop
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[min(900px,110vw)] -translate-x-1/2 -translate-y-1/2 blur-[90px]"
        style={{
          background:
            'radial-gradient(50% 50% at 42% 50%, rgba(94,234,212,0.16), transparent 70%),' +
            'radial-gradient(44% 46% at 66% 52%, rgba(255,106,61,0.12), transparent 72%)',
          animation: 'lha-aurora 19s ease-in-out infinite',
        }}
      />
      <div className="relative mx-auto max-w-[880px]">
        <h2
          data-anim
          className="m-0 font-geist-mono text-[clamp(28px,5vw,60px)] font-normal leading-[1.05] -tracking-[0.03em] [text-wrap:balance]"
          style={{
            color: INK,
            opacity: 0,
            animation: inView ? 'lh-revealup 0.8s cubic-bezier(0.22,0.61,0.36,1) both' : undefined,
          }}
        >
          The future of markets
          <br />
          <span className="text-homepage-accent">is a sentence.</span>
        </h2>
        <p
          data-anim
          className="mx-auto mt-[22px] max-w-[520px] font-geist text-[15px] font-light leading-[1.7]"
          style={{
            color: INK2,
            opacity: 0,
            animation: inView ? 'lh-revealup 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.15s both' : undefined,
          }}
        >
          Say what you want. Approve it once. Go to sleep. The agent is still awake, and it does
          not get bored, tilted, or distracted at exactly the wrong moment.
        </p>

        <div
          data-anim
          className="mt-[34px] flex justify-center"
          style={{ opacity: 0, animation: inView ? 'lh-fade 0.6s ease-out 0.3s both' : undefined }}
        >
          <SignUpButton mode="modal" forceRedirectUrl={POST_AUTH_REDIRECT} signInForceRedirectUrl={POST_AUTH_REDIRECT}>
            <button
              type="button"
              className="group relative inline-flex h-[58px] w-[320px] max-w-full cursor-pointer select-none items-center justify-center overflow-hidden rounded-[2px] transition-[transform,box-shadow] duration-500 ease-out motion-safe:hover:-translate-y-[2px]"
              style={{
                background: 'linear-gradient(100deg, #ffffff 0%, #d8f7ef 26%, #84f0da 58%, #ffc7a8 88%, #ff9a6d 100%)',
                boxShadow: '0 14px 46px -14px rgba(94,234,212,0.5), 0 4px 18px -6px rgba(255,106,61,0.35)',
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-[40%] -top-[40%] left-[-60%] w-[46%] opacity-0 [mix-blend-mode:screen] [transform:skewX(-16deg)] group-hover:[animation:lha-sweep_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite] group-hover:opacity-100"
                style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.95), transparent)' }}
              />
              <span
                className="relative font-geist-mono text-[14.5px] font-medium uppercase tracking-[0.05em]"
                style={{ color: '#0c1413', textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}
              >
                deploy an agent
              </span>
            </button>
          </SignUpButton>
        </div>

        <p
          data-anim
          className="mt-[20px] font-geist-mono text-[10.5px] tracking-[0.14em]"
          style={{ color: INK3, opacity: 0, animation: inView ? 'lh-fade 0.6s ease-out 0.45s both' : undefined }}
        >
          its own wallet &middot; you approve the strategy &middot; it executes autonomously
        </p>
      </div>
    </section>
  );
}

export function AgenticTradingPage() {
  return (
    <div
      className={`lh-home lh-agentic relative min-h-screen w-full overflow-x-clip bg-homepage-bg font-geist text-homepage-ink antialiased ${geistSans.variable} ${geistMono.variable}`}
    >
      {/* Divider distortion filter (SectionDivider depends on it). */}
      <svg aria-hidden focusable="false" width="0" height="0" className="pointer-events-none absolute">
        <filter id="lh-warp" x="-10%" y="-700%" width="120%" height="1500%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.014" numOctaves={2} seed={7} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={9} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div aria-hidden className="lh-page-grid pointer-events-none absolute inset-0 z-0" />
      <div aria-hidden className="pointer-events-none fixed inset-3 z-[6] border border-homepage-line2">
        <CornerTicks size={14} />
      </div>

      {/* ===================== TOP BAR ===================== */}
      <header className="sticky top-0 z-[5] flex h-[64px] items-center justify-between border-b border-homepage-line2 bg-[rgba(10,10,11,0.6)] px-gutter pt-3 [backdrop-filter:blur(16px)]">
        <div
          data-anim
          className="flex min-w-0 items-center gap-[11px]"
          style={{ opacity: 0, animation: 'lh-fade 0.5s ease-out 0.2s both' }}
        >
          <Link href="/" aria-label="Listen home" className="flex shrink-0 items-center gap-[11px]">
            <ListenMark className="block h-5 w-5" />
            <span className="font-geist-mono text-[14px] font-medium tracking-[0.16em] text-homepage-word">
              Listen
            </span>
          </Link>
          <span aria-hidden className="hidden h-[13px] w-px bg-homepage-line2 sm:block" />
          <span
            className="hidden font-geist-mono text-[11.5px] tracking-[0.14em] sm:block"
            style={{ color: MINT }}
          >
            agentic trading
          </span>
        </div>
        <nav
          aria-label="Account"
          data-anim
          className="flex shrink-0 items-center gap-2 font-geist-mono text-[12.5px] tracking-[0.04em]"
          style={{ opacity: 0, animation: 'lh-fade 0.45s ease-out 0.6s both' }}
        >
          <SignInButton mode="modal" forceRedirectUrl={POST_AUTH_REDIRECT} signUpForceRedirectUrl={POST_AUTH_REDIRECT}>
            <button
              type="button"
              className="cursor-pointer px-3 py-2 text-homepage-ink2 transition-colors duration-200 ease-out hover:text-homepage-ink"
            >
              log in
            </button>
          </SignInButton>
          <SignUpButton mode="modal" forceRedirectUrl={POST_AUTH_REDIRECT} signInForceRedirectUrl={POST_AUTH_REDIRECT}>
            <button
              type="button"
              className="cursor-pointer border border-homepage-accent px-4 py-2 text-homepage-accent transition-colors duration-200 ease-out hover:bg-homepage-accent hover:text-homepage-bg"
            >
              sign up
            </button>
          </SignUpButton>
        </nav>
      </header>

      <AgenticHero />

      <SectionDivider breathSeconds={9} />
      <div id="the-run" className="scroll-mt-[64px]">
        <AgentRunSection />
      </div>
      <SectionDivider breathSeconds={10.5} />
      <PromptGallery />
      <SectionDivider breathSeconds={8} />
      <HowItWorks />
      <SectionDivider breathSeconds={11.5} />
      <ControlSection />
      <Closer />
      <HomeFooter />
    </div>
  );
}

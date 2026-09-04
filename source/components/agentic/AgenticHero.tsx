'use client';

/**
 * The hero. The whole pitch is that the INPUT is a sentence, so the
 * hero's centrepiece is the input itself: a console that types a real
 * user prompt, parses it into chips, holds, wipes, and types the next
 * one — forever. Atmospherics (a slow mint/flame aurora and a vertical
 * beam) sit behind the frame; everything else is the homepage's
 * technical register, unchanged.
 */

import { SignUpButton } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { HERO_PROMPTS } from './prompts';
import { Chip, GREEN, HOT, INK, INK2, INK3, MINT, MONO } from './agentSurfaces';

const POST_AUTH_REDIRECT = '/' as const;

const HERO_STATS = [
  { n: '01', label: 'PLAIN ENGLISH' },
  { n: '02', label: 'AWAKE AT 4AM' },
  { n: '03', label: 'IT CAN ONLY PROPOSE' },
  { n: '04', label: 'ITS OWN WALLET, NEVER YOURS' },
] as const;

/** What the console reports once a prompt has finished typing. */
const PARSE_CHIPS: ReadonlyArray<readonly string[]> = [
  ['social trigger', 'new mints', '10 ◎ sized'],
  ['copy trade', '6h lifetime', 'narrative filter'],
  ['dev wallet', 'cluster ≤ 15%', '10 ◎ sized'],
];

type Phase = 'typing' | 'holding' | 'wiping';

const TYPE_MS = 34;
const WIPE_MS = 12;
const HOLD_MS = 2600;

/** Types a prompt, holds it parsed, wipes it, moves to the next. */
function usePromptCycle() {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');

  const prompt = HERO_PROMPTS[index] ?? '';

  useEffect(() => {
    if (phase === 'holding') {
      const id = window.setTimeout(() => setPhase('wiping'), HOLD_MS);
      return () => window.clearTimeout(id);
    }
    const typing = phase === 'typing';
    const id = window.setInterval(
      () => {
        setCount((n) => {
          if (typing) {
            if (n >= prompt.length) {
              setPhase('holding');
              return n;
            }
            return n + 1;
          }
          if (n <= 0) {
            setIndex((i) => (i + 1) % HERO_PROMPTS.length);
            setPhase('typing');
            return 0;
          }
          return n - 1;
        });
      },
      typing ? TYPE_MS : WIPE_MS,
    );
    return () => window.clearInterval(id);
  }, [phase, prompt.length]);

  return { text: prompt.slice(0, count), parsed: phase === 'holding', index } as const;
}

/**
 * The disclosure. Written for what Listen actually is, so none of it is
 * borrowed boilerplate: an agent is self-directed from ITS OWN wallet,
 * your approval is what arms a strategy (nothing reaches the chain
 * un-approved), execution of approved terms then runs autonomously, and
 * the fuzzy conditions are settled by a scored classifier that can be
 * wrong. Everything here must stay true of the product; if a guarantee
 * changes, this text changes with it.
 */
const DISCLOSURE: readonly string[] = [
  'Listen Agents are a conversational tool for setting up self-directed, conditional and recurring transactions. Everything an agent produces, including classifier scores, proposals, summaries and any figure on this page, is informational and illustrative only. It is not investment advice and not a recommendation.',
  'An agent acts on instructions you wrote. You alone decide whether a strategy is suitable, and you are responsible for reading a proposal’s terms before you approve it. Your approval is what arms a strategy: once approved, the agent executes its terms autonomously, including conditional and recurring legs that settle without a further confirmation. Each agent runs from its own wallet that you fund, and can never reach your other Listen wallets.',
  'Conditions that depend on judgement (what counts as a meme, a narrative, a rug) are settled by classifiers, which are probabilistic and can be wrong. Triggers can fire late, fire on a market that has already moved, or not fire at all.',
  'Digital assets are volatile and largely unregulated, and you can lose everything you commit. Listen is non-custodial: keys are held in a Turnkey enclave and Listen cannot move your funds.',
];

/**
 * Pill + hover panel. Hover alone is not an affordance on touch or for
 * keyboard users, so the same `open` state is driven by pointer, focus
 * and click, and the panel is wired to the button with `aria-expanded` /
 * `aria-controls` rather than being a tooltip that only a mouse finds.
 */
function DisclosuresPill() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative z-[3] mb-[18px]"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="agent-disclosures"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-[7px] rounded-full border border-homepage-line2 bg-[rgba(255,255,255,0.02)] px-[13px] py-[6px] font-geist-mono text-[10.5px] tracking-[0.08em] transition-colors duration-300 ease-out hover:border-homepage-line3"
        style={{ color: INK3 }}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-[12px] w-[12px]" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="6.6" />
          <path d="M8 7.1v4" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.72" fill="currentColor" stroke="none" />
        </svg>
        agent disclosures
      </button>

      <div
        id="agent-disclosures"
        role="note"
        /* Opaque, not translucent: this panel opens over the 92px headline,
           and legal copy that has display type ghosting through it is not
           legible copy. */
        className="absolute left-1/2 top-full z-[4] mt-[10px] w-[288px] -translate-x-1/2 border border-homepage-line bg-[#0c0c0e] p-[15px] text-left shadow-[0_34px_70px_-34px_rgba(0,0,0,1)] sm:w-[520px]"
        style={{
          opacity: open ? 1 : 0,
          transform: `translate(-50%, ${open ? '0' : '-5px'})`,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.28s ease, transform 0.28s cubic-bezier(0.22,0.61,0.36,1)',
        }}
      >
        <div className="mb-[9px] flex items-center gap-2 font-geist-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: INK3 }}>
          <span aria-hidden className="h-[4px] w-[4px] rotate-45" style={{ background: HOT }} />
          agent disclosures
        </div>
        {DISCLOSURE.map((para) => (
          <p key={para.slice(0, 24)} className="m-0 mb-[7px] font-geist text-[10.5px] font-light leading-[1.6] last:mb-0" style={{ color: INK2 }}>
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}

function AuroraField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        data-loop
        className="absolute left-1/2 top-[42%] h-[560px] w-[min(1180px,120vw)] -translate-x-1/2 -translate-y-1/2 blur-[90px]"
        style={{
          background:
            'radial-gradient(46% 54% at 30% 46%, rgba(94,234,212,0.20), transparent 70%),' +
            'radial-gradient(40% 48% at 72% 54%, rgba(255,106,61,0.16), transparent 72%),' +
            'radial-gradient(60% 40% at 50% 88%, rgba(94,234,212,0.09), transparent 70%)',
          animation: 'lha-aurora 17s ease-in-out infinite',
        }}
      />
      {/* A soft scrim so the page's technical grid never competes with the
          headline — the grid should be texture behind the type, not noise
          through it. */}
      <div
        className="absolute left-1/2 top-[8%] h-[62%] w-[min(1000px,100%)] -translate-x-1/2"
        style={{
          background: 'radial-gradient(58% 52% at 50% 44%, rgba(10,10,11,0.92), rgba(10,10,11,0.55) 62%, transparent 100%)',
        }}
      />
      {/* the beam: intent going in, one line, straight down */}
      <div
        data-loop
        className="absolute left-1/2 top-0 h-[46%] w-px -translate-x-1/2 origin-top"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(94,234,212,0.55), transparent)',
          animation: 'lha-beam 6.5s ease-in-out infinite',
        }}
      />
    </div>
  );
}

export function AgenticHero() {
  const { text, parsed, index } = usePromptCycle();
  const chips = PARSE_CHIPS[index] ?? PARSE_CHIPS[0]!;

  return (
    <section
      aria-label="Agentic trading"
      className="relative z-[2] flex flex-col items-center px-6 pb-[clamp(56px,10vh,110px)] pt-[clamp(64px,12vh,132px)] text-center"
    >
      <AuroraField />

      {/* The panel opens OVER the headline, so this wrapper has to outrank
          the hero's other `z-[1]` layers; the entrance animation on it also
          makes it its own stacking context, so the z-index has to live
          here rather than on the panel. */}
      <div data-anim className="relative z-[8]" style={{ opacity: 0, animation: 'lh-fade 0.5s ease-out 0.15s both' }}>
        <DisclosuresPill />
      </div>

      <div
        data-anim
        className="relative z-[1] mb-[26px] flex items-center gap-2 font-geist-mono text-[11px] uppercase tracking-[0.34em] text-homepage-ink3"
        style={{ opacity: 0, animation: 'lh-fade 0.5s ease-out 0.25s both' }}
      >
        <span aria-hidden className="h-[5px] w-[5px] rotate-45" style={{ background: HOT }} />
        proprietary vibe-trading
      </div>

      <h1
        data-anim
        className="relative z-[1] m-0 max-w-[16ch] font-geist-mono text-[clamp(38px,7.4vw,92px)] font-normal leading-[0.98] -tracking-[0.035em] text-homepage-word [text-wrap:balance]"
        style={{ opacity: 0, animation: 'lh-rise 0.8s cubic-bezier(0.22,0.61,0.36,1) 0.4s both' }}
      >
        say hello to the{' '}
        <span
          style={{
            background: 'linear-gradient(96deg, #5eead4 0%, #a7f3e4 34%, #ffb08a 78%, #ff6a3d 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          future of markets
        </span>
      </h1>

      <p
        data-anim
        className="relative z-[1] mt-[24px] max-w-[600px] font-geist text-[clamp(14px,1.5vw,17px)] font-light leading-[1.65] text-homepage-ink2 [text-wrap:pretty]"
        style={{ opacity: 0, animation: 'lh-tag 0.6s cubic-bezier(0.22,0.61,0.36,1) 0.7s both' }}
      >
        Stop translating your edge into clicks. Say it once, in the words you&rsquo;d use to a friend
        at 3am, and an agent stands watch over the tape, the timeline and the mempool until
        it&rsquo;s true.
      </p>

      {/* ── the console: the input IS the product ─────────────────── */}
      <div
        data-anim
        /* Width is bounded by the section's padded content box, never by
           `vw`: the app renders under `html { zoom }`, and viewport units
           do not divide by it — a `min(…, Nvw)` guard reads the unzoomed
           window and overflows on narrow laptops. */
        className="relative z-[1] mt-[38px] w-full max-w-[880px] border border-homepage-line bg-[rgba(13,13,15,0.55)] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_46px_100px_-56px_rgba(0,0,0,0.95)] [backdrop-filter:blur(12px)]"
        style={{ opacity: 0, animation: 'lh-rise 0.85s cubic-bezier(0.22,0.61,0.36,1) 0.85s both' }}
      >
        {/* registration ticks */}
        <span aria-hidden className="absolute -left-px -top-px h-[13px] w-[13px] border-l border-t" style={{ borderColor: HOT }} />
        <span aria-hidden className="absolute -right-px -top-px h-[13px] w-[13px] border-r border-t border-homepage-line3" />
        <span aria-hidden className="absolute -bottom-px -left-px h-[13px] w-[13px] border-b border-l border-homepage-line3" />
        <span aria-hidden className="absolute -bottom-px -right-px h-[13px] w-[13px] border-b border-r border-homepage-line3" />

        <div className="flex h-[36px] items-center justify-between border-b border-homepage-line2 px-4 font-geist-mono text-[10px] uppercase tracking-[0.18em] text-homepage-ink3">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-[5px] w-[5px] rotate-45" style={{ background: HOT }} />
            new agent
          </span>
          <span className="hidden sm:inline">say it however you say it</span>
        </div>

        <div className="px-4 py-[16px] sm:px-5">
          <div className="flex items-start gap-[10px]">
            <span aria-hidden className="mt-[2px] shrink-0 font-geist-mono text-[13px]" style={{ color: HOT }}>
              &gt;
            </span>
            {/* Two lines are reserved so the panel never resizes as the
                sentence types itself out and wraps. */}
            <p
              className="m-0 font-geist-mono text-[clamp(12.5px,1.55vw,16px)] leading-[1.55] text-homepage-ink"
              style={{ minHeight: '3.1em' }}
            >
              <span className={parsed ? undefined : 'lha-caret'}>{text}</span>
            </p>
          </div>
        </div>

        <div className="flex min-h-[42px] flex-wrap items-center gap-2 border-t border-homepage-line2 px-4 py-[9px] sm:px-5">
          <span className="font-geist-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: parsed ? GREEN : INK3, transition: 'color 0.4s ease' }}>
            {parsed ? 'parsed' : 'listening'}
          </span>
          <span aria-hidden className="h-[11px] w-px bg-homepage-line2" />
          {chips.map((chip, i) => (
            <span
              key={chip}
              style={{
                opacity: parsed ? 1 : 0,
                transform: parsed ? 'none' : 'translateY(4px)',
                transition: `opacity 0.4s ease ${i * 0.09}s, transform 0.4s cubic-bezier(0.22,0.61,0.36,1) ${i * 0.09}s`,
              }}
            >
              <Chip tone={i === 0 ? 'hot' : 'quiet'}>{chip}</Chip>
            </span>
          ))}
          <span className="ml-auto hidden font-geist-mono text-[9.5px] tracking-[0.1em] sm:inline" style={{ color: INK3 }}>
            {parsed ? 'awaiting your approval' : '·'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-homepage-line bg-homepage-line2 text-left font-geist-mono sm:grid-cols-4">
          {HERO_STATS.map((stat) => (
            <div key={stat.n} className="bg-homepage-bg px-4 py-[14px]">
              <div className="text-[9px] tracking-[0.2em]" style={{ color: INK3 }}>{stat.n}</div>
              <div className="mt-[7px] text-[10px] leading-tight tracking-[0.05em]" style={{ color: INK2 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTAs ──────────────────────────────────────────────────── */}
      <div
        data-anim
        className="relative z-[1] mt-[34px] flex flex-col items-center gap-4 sm:flex-row"
        style={{ opacity: 0, animation: 'lh-fade 0.55s ease-out 1.15s both' }}
      >
        <SignUpButton mode="modal" forceRedirectUrl={POST_AUTH_REDIRECT} signInForceRedirectUrl={POST_AUTH_REDIRECT}>
          <button
            type="button"
            className="group relative inline-flex h-[54px] w-[300px] max-w-full cursor-pointer select-none items-center justify-center overflow-hidden rounded-[2px] transition-[transform,box-shadow] duration-500 ease-out motion-safe:hover:-translate-y-[2px]"
            style={{
              background: 'linear-gradient(100deg, #ffffff 0%, #d8f7ef 26%, #84f0da 58%, #ffc7a8 88%, #ff9a6d 100%)',
              boxShadow: '0 12px 40px -14px rgba(94,234,212,0.5), 0 4px 16px -6px rgba(255,106,61,0.35)',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-[40%] -top-[40%] left-[-60%] w-[46%] opacity-0 [mix-blend-mode:screen] [transform:skewX(-16deg)] group-hover:[animation:lha-sweep_1.4s_cubic-bezier(0.4,0,0.2,1)_infinite] group-hover:opacity-100"
              style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.95), transparent)' }}
            />
            <span
              className="relative font-geist-mono text-[14px] font-medium uppercase tracking-[0.05em]"
              style={{ color: '#0c1413', textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}
            >
              deploy an agent
            </span>
          </button>
        </SignUpButton>

        <a
          href="#the-run"
          className="group inline-flex h-[54px] items-center gap-3 border border-homepage-line px-6 font-geist-mono text-[12.5px] tracking-[0.06em] transition-colors duration-300 hover:border-homepage-line3"
          style={{ color: INK2 }}
        >
          watch one think
          <span aria-hidden className="transition-transform duration-300 group-hover:translate-y-[2px]" style={{ color: MINT }}>
            ↓
          </span>
        </a>
      </div>

      <p
        data-anim
        className="relative z-[1] mt-[22px] font-geist-mono text-[10.5px] tracking-[0.12em]"
        style={{ color: INK3, opacity: 0, animation: 'lh-fade 0.5s ease-out 1.35s both', fontFamily: MONO }}
      >
        <span style={{ color: INK }}>you approve the strategy</span>. it executes on its own. hands off.
      </p>
    </section>
  );
}

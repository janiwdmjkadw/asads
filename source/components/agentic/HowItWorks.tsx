'use client';

/**
 * 03 — THE LOOP, in three panels: say it · watch it plan · approve once.
 *
 * Each panel carries a small vignette that loops on the SAME 9s cycle,
 * offset by `animation-delay`, so the three read as one machine turning
 * rather than three unrelated widgets. All motion is CSS on `[data-loop]`
 * elements, so the page's reduced-motion guard silences it wholesale and
 * the panels still read as finished states.
 */

import type { CSSProperties } from 'react';
import { SectionEyebrow, SectionHeading, useReveal } from '@/components/homepage/chrome';
import { GREEN, HOT, INK, INK2, INK3, MINT, MONO } from './agentSurfaces';

const CYCLE = '9s';

const VIGNETTE: CSSProperties = {
  position: 'relative',
  height: 148,
  overflow: 'hidden',
  border: '1px solid var(--lh-line2)',
  background: 'rgba(10,10,12,0.5)',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Cpath d='M9 6v6M6 9h6' stroke='rgba(255,255,255,0.05)' stroke-width='1' fill='none'/%3E%3C/svg%3E\")",
  backgroundSize: '18px 18px',
  padding: 14,
};

/** 1 — the sentence typing itself out. */
function SayItVignette() {
  return (
    <div style={VIGNETTE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <span aria-hidden style={{ width: 5, height: 5, transform: 'rotate(45deg)', background: HOT }} />
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          your words
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span aria-hidden style={{ fontFamily: MONO, fontSize: 12, color: HOT }}>&gt;</span>
        <span
          data-loop
          style={{
            display: 'inline-block',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            fontFamily: MONO,
            fontSize: 12.5,
            color: INK,
            animation: `lha-type ${CYCLE} steps(38, end) infinite`,
          }}
        >
          short $OIL if trump posts an iran deal
        </span>
        <span
          aria-hidden
          data-loop
          style={{ width: 6, height: 13, background: HOT, animation: 'lh-blink 1s steps(1) infinite' }}
        />
      </div>
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {['truth social', 'classified', 'short'].map((tag, i) => (
          <span
            key={tag}
            data-loop
            data-rm-show
            style={{
              borderRadius: 999,
              border: '1px solid var(--lh-line2)',
              padding: '2px 8px',
              fontFamily: MONO,
              fontSize: 9,
              whiteSpace: 'nowrap',
              color: INK2,
              opacity: 0,
              animation: `lha-stepin ${CYCLE} ease-out ${3.4 + i * 0.35}s infinite`,
            }}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 2 — the trace filling in, one tool at a time. */
function PlanVignette() {
  const rows: ReadonlyArray<[string, string]> = [
    ['read_intent', '1 trigger'],
    ['build_classifier', '≥ 0.9 conf'],
    ['size_position', '2% · stop −8%'],
  ];
  return (
    <div style={VIGNETTE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <span aria-hidden data-loop style={{ width: 6, height: 6, borderRadius: '50%', background: HOT, animation: 'lha-pulse 1.5s ease-out infinite' }} />
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          its thinking
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 9, color: 'rgba(255,255,255,0.24)' }}>1.4s</span>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 15 }}>
        <span aria-hidden style={{ position: 'absolute', left: 3, top: 5, bottom: 5, width: 1, background: 'var(--lh-line2)' }} />
        {rows.map(([name, note], i) => (
          <div
            key={name}
            data-loop
            data-rm-show
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              opacity: 0,
              animation: `lha-stepin ${CYCLE} ease-out ${0.9 + i * 0.75}s infinite`,
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: -15,
                width: 7,
                height: 7,
                borderRadius: '50%',
                border: `1px solid ${GREEN}`,
                background: GREEN,
              }}
            />
            <span style={{ fontFamily: MONO, fontSize: 11, color: INK2 }}>{name}</span>
            <span style={{ fontSize: 10.5, color: INK3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 3 — the approval, then the standing watch. */
function ApproveVignette() {
  return (
    <div style={VIGNETTE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span aria-hidden style={{ width: 5, height: 5, transform: 'rotate(45deg)', background: MINT }} />
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          your call
        </span>
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: INK2 }}>
        <span style={{ color: INK3 }}>when </span>
        he posts an iran deal
        <br />
        <span style={{ color: MINT }}>→ </span>
        <span style={{ color: INK }}>short $OIL · 2%</span>
      </div>
      <div style={{ position: 'relative', marginTop: 14, height: 34 }}>
        <div
          data-loop
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 9,
            border: `1px solid ${MINT}`,
            background: 'linear-gradient(135deg, #5eead4, #7fe6c3)',
            fontSize: 12,
            fontWeight: 500,
            color: '#0c1413',
            animation: `lha-swapout ${CYCLE} ease-out infinite, lha-flarecycle ${CYCLE} ease-out infinite`,
          }}
        >
          Approve
        </div>
        <div
          data-loop
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 9,
            border: '1px solid rgba(95,185,138,0.4)',
            background: 'rgba(95,185,138,0.08)',
            padding: '0 11px',
            fontSize: 11.5,
            color: GREEN,
            opacity: 0,
            animation: `lha-swapin ${CYCLE} ease-out infinite`,
          }}
        >
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, boxShadow: '0 0 9px 1px rgba(95,185,138,0.7)' }} />
          armed &middot; watching
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Say the thing',
    body: 'One sentence in your own words. Slang, tickers, wallets, a whole three-part condition. It takes the sentence, not a form.',
    vignette: <SayItVignette />,
  },
  {
    n: '02',
    title: 'Watch it plan',
    body: 'It shows its work: every tool it reaches for, every value it resolved, every guardrail it set. Nothing happens behind a curtain.',
    vignette: <PlanVignette />,
  },
  {
    n: '03',
    title: 'Approve once',
    body: 'You get one card with the real terms on it. Approve, and the agent stands watch for a minute or a month, until the market agrees with you.',
    vignette: <ApproveVignette />,
  },
] as const;

export function HowItWorks() {
  const { ref, inView } = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      aria-label="How it works"
      className="relative z-[2] px-gutter pb-block-b pt-block-t text-homepage-ink"
    >
      <div className="mx-auto max-w-[1200px]">
        <SectionEyebrow index="03" label="the loop" inView={inView} meta="3 steps" />
        <SectionHeading
          inView={inView}
          heading={
            <>
              Thirty seconds from a thought
              <br />
              <span className="text-homepage-accent">to a standing order.</span>
            </>
          }
          body={
            <>
              The whole product is three moves. Nothing to configure, nothing to back-test, no
              JSON. The agent does the waiting, which is the part humans are worst at.
            </>
          }
        />

        <div className="grid grid-cols-1 gap-px bg-homepage-line2 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={step.n}
              data-anim
              className="group bg-homepage-bg p-[22px] transition-colors duration-500 hover:bg-[rgba(20,20,23,0.6)]"
              style={{
                opacity: 0,
                animation: inView
                  ? `lh-revealup 0.7s cubic-bezier(0.22,0.61,0.36,1) ${0.15 + i * 0.12}s both`
                  : undefined,
              }}
            >
              <div className="mb-[18px] flex items-baseline gap-3">
                <span className="font-geist-mono text-[11px] tracking-[0.16em]" style={{ color: MINT }}>
                  {step.n}
                </span>
                <h3 className="m-0 font-geist-mono text-[19px] font-normal -tracking-[0.01em]" style={{ color: INK }}>
                  {step.title}
                </h3>
              </div>
              {step.vignette}
              <p className="m-0 mt-[16px] font-geist text-[13.5px] font-light leading-[1.65]" style={{ color: INK2 }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

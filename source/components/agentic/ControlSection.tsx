'use client';

/**
 * 04 — CONTROL. The counterweight to everything above it: an agent that
 * can act while you sleep is only worth having if you can see it, stop
 * it, and know how little it was ever able to touch.
 *
 * The three panels restate guarantees the product already enforces (the
 * visible trace of `AgentActivityGroup`, the agent's own wallet, and the
 * approve gate of `ProposalCard`), so nothing here promises a capability
 * the app doesn't have. Two claims in particular are load-bearing and
 * must not drift: the agent's wallet is the ONLY one it can reach, and
 * nothing un-approved reaches the chain — your approval arms a
 * strategy, and the agent then executes its approved terms
 * autonomously.
 */

import { SectionEyebrow, SectionHeading, useReveal } from '@/components/homepage/chrome';
import { GREEN, HOT, INK, INK2, INK3, MINT, MONO } from './agentSurfaces';

const CARD =
  'relative overflow-hidden border border-homepage-line2 bg-[rgba(14,14,17,0.55)] p-[20px] transition-colors duration-500 hover:border-homepage-line';

/** A frozen trace — the point is that it's all on the record. */
function TraceGlyph() {
  const rows: ReadonlyArray<[string, string]> = [
    ['get_token_state', '0.3s'],
    ['check_holder_clusters', '0.6s'],
    ['size_position', '0.2s'],
    ['submit_for_approval', '·'],
  ];
  return (
    <div className="relative flex flex-col gap-[6px] pl-[15px]">
      <span aria-hidden className="absolute left-[3px] top-[5px] h-[calc(100%-10px)] w-px bg-homepage-line2" />
      {rows.map(([name, ms], i) => (
        <div key={name} className="relative flex items-center gap-2">
          <span
            aria-hidden
            className="absolute -left-[15px] h-[7px] w-[7px] rounded-full border"
            style={{
              borderColor: i === rows.length - 1 ? MINT : GREEN,
              background: i === rows.length - 1 ? 'transparent' : GREEN,
            }}
          />
          <span className="font-geist-mono text-[10.5px]" style={{ color: INK2 }}>{name}</span>
          <span className="ml-auto font-geist-mono text-[9.5px] tabular-nums" style={{ color: 'rgba(255,255,255,0.24)' }}>
            {ms}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The wallet the agent can reach, and the ones it cannot. The dashed
 * red path is the whole point of the panel: your main and secondary
 * Listen wallets are not merely un-targeted, they are unreachable.
 */
function WalletGlyph() {
  return (
    <svg viewBox="0 0 260 96" aria-hidden className="w-full" style={{ height: 96 }}>
      <rect x="1" y="34" width="72" height="34" fill="none" stroke="var(--lh-line3)" />
      <text x="37" y="55" textAnchor="middle" fill={INK2} style={{ font: `10px ${MONO}` }}>agent</text>

      <rect x="98" y="34" width="86" height="34" fill="none" stroke={GREEN} />
      <text x="141" y="50" textAnchor="middle" fill={GREEN} style={{ font: `10px ${MONO}` }}>agent wallet</text>
      <text x="141" y="62" textAnchor="middle" fill={INK3} style={{ font: `8px ${MONO}` }}>you fund it</text>

      <rect x="200" y="34" width="58" height="34" fill="none" stroke="var(--lh-line3)" strokeDasharray="3 3" />
      <text x="229" y="50" textAnchor="middle" fill={INK3} style={{ font: `9px ${MONO}` }}>your</text>
      <text x="229" y="61" textAnchor="middle" fill={INK3} style={{ font: `9px ${MONO}` }}>wallets</text>

      <path d="M75 51 L96 51" stroke={GREEN} strokeWidth="1.2" />

      {/* the reach that does not exist */}
      <path d="M37 30 C 70 6, 200 6, 229 30" fill="none" stroke="#e25563" strokeWidth="1.1" strokeDasharray="3 3" opacity="0.7" />
      <g opacity="0.9">
        <line x1="127" y1="6" x2="139" y2="18" stroke="#e25563" strokeWidth="1.3" />
        <line x1="139" y1="6" x2="127" y2="18" stroke="#e25563" strokeWidth="1.3" />
      </g>
      <text x="130" y="88" textAnchor="middle" fill={INK3} style={{ font: `9px ${MONO}`, letterSpacing: '0.14em' }}>
        NO PATH TO YOUR OTHER WALLETS
      </text>
    </svg>
  );
}

/**
 * The gate. The agent's only reachable verb is `propose`; everything
 * past the dividing line needs the click, and pause / edit / kill stay
 * on your side of it too.
 */
function GateGlyph() {
  return (
    <div className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2 border border-homepage-line2 px-3 py-[8px]">
        <span
          aria-hidden
          data-loop
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: HOT, animation: 'lha-pulse 1.6s ease-out infinite' }}
        />
        <span className="font-geist-mono text-[10.5px]" style={{ color: INK2 }}>agent</span>
        <span className="ml-auto font-geist-mono text-[10px]" style={{ color: INK3 }}>
          submit_proposal()
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span aria-hidden className="h-px flex-1" style={{ background: 'rgba(94,234,212,0.35)' }} />
        <span className="font-geist-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: MINT }}>
          your click
        </span>
        <span aria-hidden className="h-px flex-1" style={{ background: 'rgba(94,234,212,0.35)' }} />
      </div>

      <div className="flex gap-[6px]">
        {(['approve', 'pause', 'kill'] as const).map((label, i) => (
          <span
            key={label}
            className="flex-1 py-[7px] text-center font-geist-mono text-[10px] uppercase tracking-[0.12em]"
            style={
              i === 0
                ? { border: `1px solid ${MINT}`, background: 'rgba(94,234,212,0.1)', color: MINT }
                : { border: '1px solid var(--lh-line2)', color: i === 2 ? '#e25563' : INK2 }
            }
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const PANELS = [
  {
    tag: 'transparency',
    title: 'It shows its work',
    body: 'Every tool call, every value it read, every guardrail it set, timestamped and on the record. There is no black box to trust, because there is no black box.',
    glyph: <TraceGlyph />,
  },
  {
    tag: 'custody',
    title: 'It has one wallet, and it is not yours',
    body: 'The agent gets its own wallet, funded by you, and that is the entire universe it can reach. Your main wallet and every other Listen wallet are unreachable to it. Keys stay inside a Turnkey enclave, so Listen cannot move your funds either.',
    glyph: <WalletGlyph />,
  },
  {
    tag: 'control',
    title: 'You approve. It executes.',
    body: 'Your approve click is what arms a strategy: read the terms, click once, and from that moment the agent executes them autonomously — conditions fire and settle on-chain with nobody at the keyboard. You can still pause it, rewrite its terms, or kill it mid-flight, even while a condition is firing.',
    glyph: <GateGlyph />,
  },
] as const;

export function ControlSection() {
  const { ref, inView } = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      aria-label="Control and safety"
      className="relative z-[2] px-gutter pb-block-b pt-block-t text-homepage-ink"
    >
      <div className="mx-auto max-w-[1200px]">
        <SectionEyebrow index="04" label="control" inView={inView} meta="you, always" />
        <SectionHeading
          inView={inView}
          heading={
            <>
              It works for you.
              <br />
              <span className="text-homepage-accent">Not the other way round.</span>
            </>
          }
          body={
            <>
              Handing a machine your intent should feel like delegation, not surrender. So the
              agent is loud about what it&rsquo;s doing, walled into a wallet of its own, and
              incapable of executing anything you haven&rsquo;t clicked.
            </>
          }
        />

        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3">
          {PANELS.map((panel, i) => (
            <div
              key={panel.tag}
              data-anim
              className={CARD}
              style={{
                opacity: 0,
                animation: inView
                  ? `lh-revealup 0.7s cubic-bezier(0.22,0.61,0.36,1) ${0.15 + i * 0.12}s both`
                  : undefined,
              }}
            >
              <div className="mb-[16px] flex items-center gap-2">
                <span aria-hidden className="h-[5px] w-[5px] rotate-45" style={{ background: i === 1 ? MINT : HOT }} />
                <span className="font-geist-mono text-[9.5px] uppercase tracking-[0.22em]" style={{ color: INK3 }}>
                  {panel.tag}
                </span>
              </div>
              <div className="mb-[18px] min-h-[96px]">{panel.glyph}</div>
              <h3 className="m-0 font-geist-mono text-[17px] font-normal leading-tight -tracking-[0.01em]" style={{ color: INK }}>
                {panel.title}
              </h3>
              <p className="m-0 mt-[9px] font-geist text-[13px] font-light leading-[1.65]" style={{ color: INK2 }}>
                {panel.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

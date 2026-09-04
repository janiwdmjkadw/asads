'use client';

/**
 * The agent's own UI, redrawn for the marketing page.
 *
 * These are PRESENTATIONAL REPLICAS of the live chat surfaces — the
 * activity group and its node rail (`components/agent/parts/
 * AgentActivityGroup.tsx`) and the proposal / authorization card
 * (`components/agent/proposal/ProposalCard.tsx`) — not the components
 * themselves. Deliberate: those read the chat's `--surface-*`/`--ink-*`
 * vocabulary and are wired to a live store, a real proposal record and a
 * decision endpoint. Mounting them here would drag that machinery onto a
 * signed-out marketing route and, worse, would put a button that spends
 * money next to a fake one.
 *
 * So the ANATOMY is copied exactly (the dot states, the rail, the
 * `when → buy` stanza, the full-width Approve with `dismiss` beneath it)
 * and the palette is the homepage's — plus one token, `--lha-hot`, which
 * is the agent flame. Nothing here can decide anything.
 *
 * Every surface is `beat`-gated: at `beat === at` it plays its entrance,
 * past it, it is simply there. That makes the section's step scrubber
 * land on a coherent frame no matter which beat you jump to.
 */

import type { CSSProperties, ReactNode } from 'react';

export const HOT = 'var(--lha-hot)';
export const MINT = 'var(--lh-accent)';
export const GREEN = 'var(--lh-green)';
export const INK = 'var(--lh-ink)';
export const INK2 = 'var(--lh-ink2)';
export const INK3 = 'var(--lh-ink3)';
export const MONO = 'var(--font-geist-mono), ui-monospace, monospace';

/** Gate + entrance for a beat-driven element. */
export function at(beat: number, from: number, animation: string): CSSProperties {
  return {
    opacity: beat >= from ? 1 : 0,
    animation: beat === from ? animation : undefined,
    transition: 'opacity 0.35s ease',
  };
}

/* ─────────────────────────── shell ─────────────────────────── */

/** Glass card in the chat's proportions — 12px radius, hairline, blur. */
export function Card({
  children,
  style,
  lit = false,
  className = '',
}: {
  children: ReactNode;
  style?: CSSProperties;
  /** The one card where a click would spend money wears the brighter rim. */
  lit?: boolean;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        borderRadius: 12,
        border: `1px solid ${lit ? 'rgba(255,255,255,0.16)' : 'var(--lh-line2)'}`,
        background: 'rgba(19,19,22,0.78)',
        backdropFilter: 'blur(10px)',
        boxShadow: lit
          ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 20px 50px -30px rgba(0,0,0,0.95)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────── the user's message ─────────────────────── */

/**
 * The prompt as it lands in the thread: right-aligned, flame-rimmed.
 * `typed` renders a partial string with a blinking caret, which is how
 * the run's first beat writes the sentence out.
 */
export function PromptBubble({
  text,
  typing = false,
  style,
}: {
  text: string;
  typing?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', ...style }}>
      <div
        style={{
          maxWidth: '92%',
          borderRadius: '12px 12px 3px 12px',
          border: `1px solid rgba(255,106,61,0.32)`,
          background: 'linear-gradient(135deg, rgba(255,106,61,0.10), rgba(255,106,61,0.03))',
          padding: '9px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          color: INK,
          letterSpacing: '0.005em',
        }}
      >
        <span className={typing ? 'lha-caret' : undefined}>{text}</span>
      </div>
    </div>
  );
}

/* ─────────────────────── the activity group ─────────────────────── */

export type NodeState = 'running' | 'done' | 'thinking';

/** Rail dot. Open ring = thought; filled flame = working; green = settled. */
function NodeDot({ state }: { state: NodeState }) {
  const base: CSSProperties = {
    position: 'absolute',
    left: -14,
    top: 6.5,
    width: 7,
    height: 7,
    borderRadius: '50%',
    boxSizing: 'border-box',
  };
  if (state === 'thinking') {
    return <span aria-hidden style={{ ...base, border: `1px solid ${HOT}`, background: 'transparent' }} />;
  }
  if (state === 'running') {
    return (
      <span
        aria-hidden
        data-loop
        style={{
          ...base,
          border: `1px solid ${HOT}`,
          background: HOT,
          animation: 'lha-pulse 1.5s ease-out infinite',
        }}
      />
    );
  }
  return <span aria-hidden style={{ ...base, border: `1px solid ${GREEN}`, background: GREEN }} />;
}

export interface ToolField {
  readonly label: string;
  readonly value: string;
}

export interface ToolNode {
  readonly key: string;
  /** Beat this row appears on; it runs for one beat, then settles. */
  readonly at: number;
  readonly name: string;
  readonly note: string;
  readonly digest?: string;
  readonly fields?: readonly ToolField[];
  readonly elapsed: string;
}

/** One tool call on the rail — name · note · elapsed, then its result. */
export function ToolRow({ node, beat }: { node: ToolNode; beat: number }) {
  const running = beat === node.at;
  const state: NodeState = running ? 'running' : 'done';
  const showResult = beat > node.at;
  return (
    <div style={{ position: 'relative', ...at(beat, node.at, 'lha-noderise 0.42s cubic-bezier(0.22,0.61,0.36,1) both') }}>
      <NodeDot state={state} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 19, fontSize: 11.5, lineHeight: 1.2 }}>
        <span
          data-loop={running ? '' : undefined}
          style={{
            flexShrink: 0,
            fontFamily: MONO,
            color: running ? INK : INK2,
            animation: running ? 'lha-breathe 1.4s ease-in-out infinite' : undefined,
          }}
        >
          {node.name}
        </span>
        <span
          style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11.5,
            color: INK3,
          }}
        >
          {node.note}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: 10,
            color: 'rgba(255,255,255,0.24)',
            fontVariantNumeric: 'tabular-nums',
            opacity: showResult ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        >
          {node.elapsed}
        </span>
      </div>
      {node.digest !== undefined ? (
        <div
          style={{
            paddingBottom: 3,
            fontFamily: MONO,
            fontSize: 11.5,
            color: INK,
            fontVariantNumeric: 'tabular-nums',
            opacity: showResult ? 1 : 0,
            transform: showResult ? 'none' : 'translateY(-2px)',
            transition: 'opacity 0.4s ease 0.05s, transform 0.4s ease 0.05s',
          }}
        >
          {node.digest}
        </div>
      ) : null}
      {node.fields !== undefined && node.fields.length > 0 ? (
        <div
          style={{
            margin: '4px 0',
            borderRadius: 9,
            background: 'rgba(255,255,255,0.032)',
            padding: '7px 10px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            columnGap: 14,
            rowGap: 6,
            opacity: showResult ? 1 : 0,
            maxHeight: showResult ? 90 : 0,
            transition: 'opacity 0.4s ease 0.08s, max-height 0.4s ease',
          }}
        >
          {node.fields.map((field) => (
            <span key={field.label} style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: '0.09em',
                  color: INK3,
                }}
              >
                {field.label}
              </span>
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: INK,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {field.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The reasoning row — thought, not a result, so the dot is an open ring. */
export function ReasoningRow({ text, beat, from, running }: { text: string; beat: number; from: number; running: boolean }) {
  return (
    <div style={{ position: 'relative', ...at(beat, from, 'lha-noderise 0.42s cubic-bezier(0.22,0.61,0.36,1) both') }}>
      <NodeDot state="thinking" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 19, fontSize: 11.5 }}>
        <span
          data-loop={running ? '' : undefined}
          style={{
            fontFamily: MONO,
            color: running ? INK : INK2,
            animation: running ? 'lha-breathe 1.4s ease-in-out infinite' : undefined,
          }}
        >
          thought for a moment
        </span>
      </div>
      <div style={{ paddingBottom: 2, fontSize: 11.5, lineHeight: 1.45, color: INK3, fontStyle: 'italic' }}>
        {text}
      </div>
    </div>
  );
}

/**
 * The turn's activity group: one collapsing object for the whole trace.
 * While it works the header names the current activity and an
 * INDETERMINATE rail runs beneath it — indeterminate by construction, so
 * it can never stick half-filled.
 */
export function ActivityGroup({
  label,
  title,
  running,
  total,
  children,
  style,
}: {
  label: string;
  title: string;
  running: boolean;
  total: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Card style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', fontSize: 11.5 }}>
        {running ? (
          <span
            aria-hidden
            data-loop
            style={{
              height: 6,
              width: 6,
              flexShrink: 0,
              borderRadius: '50%',
              background: HOT,
              animation: 'lha-pulse 1.5s ease-out infinite',
            }}
          />
        ) : (
          <span aria-hidden style={{ flexShrink: 0, fontSize: 10, lineHeight: 1, color: GREEN }}>
            ✓
          </span>
        )}
        <span
          data-loop={running ? '' : undefined}
          style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: running ? INK : INK2,
            animation: running ? 'lha-breathe 1.4s ease-in-out infinite' : undefined,
          }}
        >
          {running ? label : <span style={{ color: INK, fontWeight: 500 }}>{title}</span>}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: 10,
            color: 'rgba(255,255,255,0.24)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {total}
        </span>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            fontSize: 8,
            color: 'rgba(255,255,255,0.24)',
            transform: 'rotate(90deg)',
          }}
        >
          ▸
        </span>
      </div>

      {running ? (
        <div aria-hidden style={{ position: 'relative', height: 2, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
          <span
            data-loop
            style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: '30%',
              background: `linear-gradient(90deg, transparent, ${HOT}, transparent)`,
              animation: 'lha-rail 1.35s ease-in-out infinite',
            }}
          />
        </div>
      ) : (
        <div aria-hidden style={{ height: 1, background: 'var(--lh-line2)' }} />
      )}

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: '9px 11px 10px 26px',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 15,
            top: 15,
            bottom: 14,
            width: 1,
            background: 'var(--lh-line2)',
          }}
        />
        {children}
      </div>
    </Card>
  );
}

/* ─────────────────────── the proposal card ─────────────────────── */

/**
 * The authorization surface, with the live card's exact anatomy: a quiet
 * `trade proposal` line with the countdown, the STANZA, `details`, the
 * state line, one full-width Approve and a tiny `dismiss` beneath it.
 *
 * The stanza is the same facts as language —
 *
 *     when  @elonmusk posts an image  AND  a new pump.fun mint lands
 *     →     buy 10 ◎ of the new mint
 *
 * — and no contract address ever reaches the surface.
 */
export interface StanzaLine {
  readonly label: string;
  readonly text: ReactNode;
}

export function ProposalSurface({
  conditions,
  action,
  countdown,
  /** 'offer' → buttons live · 'approving' → the flare · 'armed' → state line. */
  phase,
  details,
  style,
}: {
  conditions: readonly StanzaLine[];
  action: ReactNode;
  countdown: string;
  phase: 'offer' | 'approving' | 'armed' | 'filled';
  details: readonly string[];
  style?: CSSProperties;
}) {
  const decided = phase === 'armed' || phase === 'filled';
  return (
    <Card lit style={style}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 12px 0' }}>
        <span style={{ fontSize: 11, color: INK3 }}>trade proposal</span>
        <span
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            color: decided ? INK3 : '#e5b950',
            transition: 'color 0.4s ease',
          }}
        >
          {decided ? '·' : countdown}
        </span>
      </div>

      {/* the stanza */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 8,
          rowGap: 4,
          padding: '7px 12px 2px',
        }}
      >
        {conditions.map((line) => (
          <div key={line.label} style={{ display: 'contents' }}>
            <span style={{ flexShrink: 0, paddingTop: 1, fontSize: 10.5, lineHeight: 1.45, color: INK3 }}>
              {line.label}
            </span>
            <div style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.45, color: INK }}>{line.text}</div>
          </div>
        ))}
        <span style={{ flexShrink: 0, paddingTop: 1, fontSize: 12.5, lineHeight: 1.45, color: MINT }}>→</span>
        <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.45, color: INK }}>{action}</div>
      </div>

      {/* details */}
      <div style={{ padding: '6px 12px 0' }}>
        <span style={{ fontSize: 11, color: INK3 }}>details</span>
        <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
          {details.map((fact) => (
            <span key={fact} style={{ fontSize: 10.5, lineHeight: 1.5, color: INK2, fontFamily: MONO }}>
              {fact}
            </span>
          ))}
        </div>
      </div>

      {/* state line / decision */}
      {decided ? (
        <div
          style={{
            marginTop: 8,
            borderTop: '1px solid var(--lh-line2)',
            padding: '9px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            color: GREEN,
          }}
        >
          <span
            aria-hidden
            data-loop
            style={{
              height: 6,
              width: 6,
              borderRadius: '50%',
              background: GREEN,
              boxShadow: `0 0 0 3px rgba(95,185,138,0.16)`,
              animation: 'lha-breathe 2.2s ease-in-out infinite',
            }}
          />
          {phase === 'filled' ? 'Approved. Condition met, order filled.' : 'Approved. Watching for 24h.'}
        </div>
      ) : (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--lh-line2)', padding: '9px 12px 8px', position: 'relative' }}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            data-loop={phase === 'approving' ? '' : undefined}
            style={{
              position: 'relative',
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              overflow: 'hidden',
              borderRadius: 10,
              border: `1px solid ${MINT}`,
              background: 'linear-gradient(135deg, #5eead4, #7fe6c3)',
              padding: '8px 14px',
              fontSize: 12.5,
              fontWeight: 500,
              color: '#0c1413',
              cursor: 'default',
              animation: phase === 'approving' ? 'lha-approveflare 1.1s ease-out both' : undefined,
            }}
          >
            Approve
            {phase === 'approving' ? (
              <span
                aria-hidden
                data-loop
                style={{
                  position: 'absolute',
                  top: '-40%',
                  bottom: '-40%',
                  width: '38%',
                  transform: 'skewX(-16deg)',
                  background:
                    'linear-gradient(100deg, transparent, rgba(255,255,255,0.85), transparent)',
                  animation: 'lha-sweep 1.1s cubic-bezier(0.4,0,0.2,1) both',
                }}
              />
            ) : null}
          </button>
          <div style={{ marginTop: 4, textAlign: 'center' }}>
            <span style={{ fontSize: 10, color: INK3 }}>dismiss</span>
          </div>
          {/* the pointer that comes in to press it */}
          {phase === 'approving' ? (
            <span
              aria-hidden
              data-loop
              style={{
                position: 'absolute',
                left: '50%',
                top: 20,
                width: 15,
                height: 15,
                animation: 'lha-cursorfly 1.1s cubic-bezier(0.22,0.61,0.36,1) both',
              }}
            >
              <svg viewBox="0 0 16 16" style={{ width: 15, height: 15, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}>
                <path d="M1 1 L1 12.2 L4.1 9.3 L6.2 14 L8.4 13 L6.3 8.4 L10.6 8.2 Z" fill="#f6f6f4" stroke="#0a0a0b" strokeWidth="0.9" strokeLinejoin="round" />
              </svg>
            </span>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────── small parts ─────────────────────── */

export function Chip({
  children,
  tone = 'quiet',
  style,
}: {
  children: ReactNode;
  tone?: 'quiet' | 'mint' | 'hot' | 'green';
  style?: CSSProperties;
}) {
  const tones = {
    quiet: { color: INK2, border: 'var(--lh-line2)', bg: 'rgba(255,255,255,0.02)' },
    mint: { color: MINT, border: 'rgba(94,234,212,0.35)', bg: 'rgba(94,234,212,0.08)' },
    hot: { color: HOT, border: 'rgba(255,106,61,0.35)', bg: 'rgba(255,106,61,0.08)' },
    green: { color: GREEN, border: 'rgba(95,185,138,0.4)', bg: 'rgba(95,185,138,0.1)' },
  } as const;
  const t = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        border: `1px solid ${t.border}`,
        background: t.bg,
        padding: '2px 9px',
        fontFamily: MONO,
        fontSize: 9.5,
        letterSpacing: '0.06em',
        color: t.color,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** The Solana glyph — a SOL amount is a mark, never the word. */
export function SolMark({ size = 9, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 397.7 311.7" style={{ width: size, height: size, display: 'inline-block', verticalAlign: '-0.02em' }}>
      <path
        fill={color}
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
      />
    </svg>
  );
}

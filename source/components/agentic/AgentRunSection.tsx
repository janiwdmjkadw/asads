'use client';

/**
 * 01 — THE RUN. The page's centerpiece: one sentence becoming a live
 * authorization, played as a twelve-beat chain.
 *
 *   0  idle              6  match_new_mints
 *   1  the prompt        7  size_position
 *   2  it thinks         8  the proposal condenses
 *   3  resolve_account   9  approve (the pointer presses it)
 *   4  build_classifier 10  armed, the watchers go live
 *   5  watch_social     11  the trigger fires, the order fills
 *
 * Every beat is a coherent frame (the console's scrubber can land on any
 * of them) and the whole thing loops. Same machinery as the homepage's
 * four diagrams (`DiagramShell` + `DiagramStageHolder` +
 * `DiagramConsole`), so it scales to fit any viewport and drops its
 * animations entirely while off-screen.
 *
 * Two product truths the surface must not blur:
 * beat 4 exists because "a meme" is a JUDGEMENT, settled by a scored
 * classifier with a stated threshold, never a field match; and the agent
 * holds its own wallet and can only ever PROPOSE, so beat 9 is the gate
 * everything else waits behind.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DiagramConsole,
  DiagramShell,
  DiagramStageHolder,
  SectionEyebrow,
  SectionHeading,
  useReveal,
} from '@/components/homepage/chrome';
import {
  ActivityGroup,
  Card,
  Chip,
  GREEN,
  HOT,
  INK,
  INK2,
  INK3,
  MINT,
  MONO,
  PromptBubble,
  ProposalSurface,
  ReasoningRow,
  SolMark,
  ToolRow,
  at,
  type ToolNode,
} from './agentSurfaces';

const PROMPT = 'if elon tweets a meme buy me 10 sol of the first coin someone deploys on pumpfun';

/** Cumulative gaps (ms) → beats 1..11, then a tail before the loop. */
const STEP_GAPS = [700, 2900, 1500, 1250, 1150, 1150, 1150, 1250, 1600, 1700, 1900] as const;
const LOOP_TAIL = 4600;
const TYPE_MS = 2400;

const STATUS: ReadonlyArray<{ t: string; c: string }> = [
  { t: 'awaiting intent', c: INK3 },
  { t: 'intent received', c: INK2 },
  { t: 'parsing · two triggers, one action', c: INK2 },
  { t: 'resolving @elonmusk …', c: HOT },
  { t: '"a meme" is a judgement · building a classifier', c: HOT },
  { t: 'watcher attached · every post gets scored', c: HOT },
  { t: 'laserstream · matching mint metadata to the post', c: HOT },
  { t: 'position sized · guardrails set', c: HOT },
  { t: 'proposal drafted, awaiting your approval', c: '#e5b950' },
  { t: 'approving …', c: MINT },
  { t: 'armed · watching 2 conditions', c: GREEN },
  { t: 'condition met → filled in 2 blocks', c: GREEN },
];

/**
 * The trace. `build_classifier` is the beat that earns this whole
 * section: "a meme" is not a field you can match on, so the agent turns
 * the fuzzy half of the sentence into a scored judgement with a stated
 * threshold and a stated behaviour below it. Everything downstream
 * ("every post gets scored", `meme 0.94`) reads off that, so a viewer
 * never thinks ANY post from the account fires the trade.
 */
const TOOLS: readonly ToolNode[] = [
  {
    key: 'resolve',
    at: 3,
    name: 'resolve_account',
    note: 'who is "elon"',
    digest: '@elonmusk · x.com · 221.4M followers',
    elapsed: '0.4s',
  },
  {
    key: 'classifier',
    at: 4,
    name: 'build_classifier',
    note: 'what counts as "a meme", and what the meme is OF',
    digest: 'image + caption → meme score, plus the post’s subject',
    fields: [
      { label: 'fires at', value: '≥ 0.85' },
      { label: 'below that', value: 'asks you' },
    ],
    elapsed: '0.7s',
  },
  {
    key: 'watch',
    at: 5,
    name: 'watch_social',
    note: 'every post scored, not just matched',
    fields: [
      { label: 'account', value: '@elonmusk' },
      { label: 'gate', value: 'meme ≥ 0.85' },
    ],
    elapsed: '0.3s',
  },
  {
    key: 'stream',
    at: 6,
    name: 'match_new_mints',
    note: 'the coin that is ABOUT the post',
    digest: 'laserstream · decoded at the slot it lands, before its first trade',
    fields: [
      { label: 'reads', value: 'name · symbol · uri · image' },
      { label: 'match', value: 'carries the subject' },
    ],
    elapsed: '0.2s',
  },
  {
    key: 'size',
    at: 7,
    name: 'size_position',
    note: 'guardrails from your defaults',
    fields: [
      { label: 'size', value: '10 SOL' },
      { label: 'max slippage', value: '15%' },
      { label: 'bundle cap', value: '≤ 8%' },
      { label: 'expires', value: '24h' },
    ],
    elapsed: '0.5s',
  },
];

/* ──────────────────────── the watchers panel ──────────────────────── */

type WatchState = 'idle' | 'live' | 'fired';

function StateLamp({ state }: { state: WatchState }) {
  const color = state === 'idle' ? 'rgba(255,255,255,0.18)' : state === 'live' ? MINT : GREEN;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 7, height: 7, flexShrink: 0 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          boxShadow: state === 'idle' ? 'none' : `0 0 10px 1px ${color}`,
          transition: 'background 0.4s ease, box-shadow 0.4s ease',
        }}
      />
      {state === 'fired' ? (
        <span
          aria-hidden
          data-loop
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 7,
            height: 7,
            borderRadius: '50%',
            border: `1px solid ${GREEN}`,
            animation: 'lha-ping 1.4s ease-out infinite',
          }}
        />
      ) : null}
    </span>
  );
}

function Watcher({
  name,
  source,
  detail,
  state,
  hit,
  miss,
}: {
  name: string;
  source: string;
  detail: string;
  state: WatchState;
  /** The event that satisfied this condition, once it has. */
  hit: string;
  /**
   * What the watcher does when the condition ISN'T met — shown while it
   * is live. Without it, a watcher that only ever displays its hit reads
   * as though everything from the source fires the trade.
   */
  miss: string;
}) {
  const live = state !== 'idle';
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        border: `1px solid ${state === 'fired' ? 'rgba(95,185,138,0.45)' : live ? 'rgba(94,234,212,0.3)' : 'var(--lh-line2)'}`,
        background: state === 'fired' ? 'rgba(95,185,138,0.05)' : 'rgba(255,255,255,0.018)',
        padding: '9px 11px',
        transition: 'border-color 0.5s ease, background 0.5s ease',
      }}
    >
      {/* the sweep that says this thing is actually looking */}
      {state === 'live' ? (
        <span
          aria-hidden
          data-loop
          style={{
            position: 'absolute',
            inset: '0 0 auto 0',
            height: 14,
            background: 'linear-gradient(180deg, rgba(94,234,212,0.14), transparent)',
            animation: 'lha-scan 2.6s linear infinite',
          }}
        />
      ) : null}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <StateLamp state={state} />
        <span style={{ fontFamily: MONO, fontSize: 12, color: live ? INK : INK2, transition: 'color 0.4s ease' }}>
          {name}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3 }}>
          {source}
        </span>
      </div>
      <div style={{ position: 'relative', marginTop: 5, fontSize: 11, lineHeight: 1.45, color: INK3 }}>
        {detail}
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: live ? 7 : 0,
          maxHeight: live ? 40 : 0,
          opacity: live ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.45s ease, opacity 0.45s ease, margin-top 0.45s ease',
        }}
      >
        {state === 'fired' ? <Chip tone="green">{hit}</Chip> : <Chip tone="quiet">{miss}</Chip>}
      </div>
    </div>
  );
}

/* ──────────────────────── the fill ticket ──────────────────────── */

function FillTicket({ beat }: { beat: number }) {
  const rows: ReadonlyArray<[string, string]> = [
    ['route', 'parallel · 3 lanes'],
    ['landed', '2 blocks · 412ms'],
    ['price', '0.00000241'],
    ['mev', 'private relay'],
  ];
  return (
    <Card
      lit
      style={{
        marginTop: 12,
        ...at(beat, 11, 'lha-fillpop 0.7s cubic-bezier(0.22,0.61,0.36,1) both'),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--lh-line2)',
          padding: '8px 12px',
        }}
      >
        <Chip tone="green">FILLED</Chip>
        <span style={{ fontFamily: MONO, fontSize: 11, color: INK3, letterSpacing: '0.1em' }}>
          agent execution
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: INK3 }}>
          #A-4471
        </span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: MONO, fontSize: 15, color: INK }}>
          <span style={{ color: GREEN }}>buy</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            10 <SolMark size={10} color={INK} />
          </span>
          <span style={{ color: INK3 }}>→</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                height: 15,
                width: 15,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                border: '1px solid var(--lh-line3)',
                background: 'rgba(255,106,61,0.12)',
                fontSize: 9,
                color: HOT,
              }}
            >
              D
            </span>
            41.2M $DOGEMAXX
          </span>
        </div>
        <div style={{ marginTop: 9, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 14, rowGap: 6 }}>
          {rows.map(([label, value]) => (
            <span key={label}>
              <span style={{ display: 'block', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.09em', color: INK3 }}>
                {label}
              </span>
              <span style={{ display: 'block', fontFamily: MONO, fontSize: 11.5, color: INK2, fontVariantNumeric: 'tabular-nums' }}>
                {value}
              </span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/**
 * The wait, as a log. The whole value of the thing is the six hours in
 * the middle that nobody had to sit through, so the section says it
 * out loud rather than leaving a gap where it happened.
 */
const LOG: ReadonlyArray<{ time: string; text: string; from: number; tone: 'quiet' | 'ink' | 'green' }> = [
  { time: '02:14:06', text: 'approved by you', from: 10, tone: 'ink' },
  { time: '·', text: 'slept 6h 41m · you were not watching', from: 10, tone: 'quiet' },
  { time: '06:31:44', text: '@elonmusk posted · meme 0.12 · ignored', from: 10, tone: 'quiet' },
  { time: '08:55:21', text: '@elonmusk posted · meme 0.94 · fires', from: 11, tone: 'ink' },
  { time: '08:55:22', text: '41 mints decoded · 40 unrelated', from: 11, tone: 'quiet' },
  { time: '08:55:23', text: '$DOGEMAXX · metadata matched the post', from: 11, tone: 'ink' },
  { time: '08:55:23', text: 'filled · 412ms later', from: 11, tone: 'green' },
];

function WatchLog({ beat }: { beat: number }) {
  const color = { quiet: INK3, ink: INK2, green: GREEN } as const;
  return (
    <div style={{ marginTop: 12, ...at(beat, 10, 'lha-rise 0.6s cubic-bezier(0.22,0.61,0.36,1) both') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          the wait
        </span>
        <span style={{ height: 1, flex: 1, background: 'var(--lh-line2)' }} />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 15 }}>
        <span aria-hidden style={{ position: 'absolute', left: 3, top: 6, bottom: 6, width: 1, background: 'var(--lh-line2)' }} />
        {LOG.map((row) => (
          <div
            key={row.text}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'baseline',
              gap: 9,
              opacity: beat >= row.from ? 1 : 0,
              transform: beat >= row.from ? 'none' : 'translateY(4px)',
              transition: 'opacity 0.45s ease, transform 0.45s cubic-bezier(0.22,0.61,0.36,1)',
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: -15,
                top: 5,
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: row.tone === 'green' ? GREEN : row.tone === 'quiet' ? 'transparent' : 'var(--lh-line3)',
                border: row.tone === 'quiet' ? '1px solid var(--lh-line3)' : 'none',
              }}
            />
            <span
              style={{
                flexShrink: 0,
                width: 52,
                fontFamily: MONO,
                fontSize: 10,
                color: INK3,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {row.time}
            </span>
            <span style={{ fontSize: 11, lineHeight: 1.5, color: color[row.tone] }}>{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────── the reach ──────────────────────── */

/**
 * What a sentence can actually reach. The run above is ONE example, and
 * an example always reads as the ceiling unless something says
 * otherwise; this strip is that something.
 *
 * Every line names a capability the platform already has (the chain stream
 * ingest and identity hydration, the social classifiers, the holder /
 * cluster / creator forensics, the parallel MEV-protected execution
 * path). Nothing aspirational goes in here.
 */
const REACH: ReadonlyArray<{ tag: string; note: string; items: readonly string[] }> = [
  {
    tag: 'ingest',
    note: 'laserstream, sub-slot',
    items: [
      'every mint decoded at the slot it lands',
      'name, symbol, uri, image, description',
      'before its first trade ever prints',
      'Token-2022 + TLV extensions',
      'curve state, migrations, graduations',
    ],
  },
  {
    tag: 'reading the world',
    note: 'text + vision, scored',
    items: [
      'X, Truth Social, whole reply trees',
      'pfp swaps, bio edits, deletions',
      'what an image is OF, not just that it exists',
      'named entities pulled out and reused downstream',
      'a threshold you set, and it asks when it is unsure',
    ],
  },
  {
    tag: 'forensics',
    note: 'who is on the other side',
    items: [
      'top-10 clusters and bundle share',
      'dev wallet behaviour, creator history',
      'insider flow, same-block accumulation',
      'wallet cohorts and what they buy next',
      'your own PnL, replayed for missed gains',
    ],
  },
  {
    tag: 'execution',
    note: 'when it finally fires',
    items: [
      'parallel routing across lanes',
      'MEV-protected private relay',
      'priority fees and bribes you set',
      'laddered exits, stops, scale-outs',
      'multi-leg conditions in sequence',
    ],
  },
];

function ReachStrip({ inView }: { inView: boolean }) {
  return (
    <div className="mt-[14px] border border-homepage-line2 bg-[rgba(14,14,17,0.5)]">
      <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-b border-homepage-line2 px-4 py-2 font-geist-mono text-[10px] uppercase tracking-[0.16em] sm:h-[38px] sm:py-0" style={{ color: INK3 }}>
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className="h-[5px] w-[5px] shrink-0 rotate-45" style={{ background: HOT }} />
          that run used four of these
        </span>
        <span className="whitespace-nowrap">a sentence can reach any of them</span>
      </div>
      <div className="grid grid-cols-1 gap-px bg-homepage-line2 sm:grid-cols-2 lg:grid-cols-4">
        {REACH.map((group, i) => (
          <div
            key={group.tag}
            data-anim
            className="bg-homepage-bg px-[15px] py-[14px]"
            style={{
              opacity: 0,
              animation: inView ? `lh-revealup 0.6s cubic-bezier(0.22,0.61,0.36,1) ${0.4 + i * 0.09}s both` : undefined,
            }}
          >
            <div className="font-geist-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: MINT }}>
              {group.tag}
            </div>
            <div className="mt-[3px] font-geist-mono text-[9.5px] tracking-[0.06em]" style={{ color: INK3 }}>
              {group.note}
            </div>
            <ul className="m-0 mt-[11px] list-none space-y-[6px] p-0">
              {group.items.map((item) => (
                <li key={item} className="flex gap-[7px] text-[11.5px] leading-[1.45]" style={{ color: INK2 }}>
                  <span aria-hidden className="mt-[6px] h-[3px] w-[3px] shrink-0 rotate-45" style={{ background: 'var(--lh-line3)' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────── the two halves ──────────────────────── */

/**
 * The chat thread. Rendered at its NATIVE size in both layouts — the
 * wide one places it on the artboard, the narrow one just stacks it —
 * so the tool rows stay readable instead of being scaled to a smear.
 */
function Thread({ beat, typed }: { beat: number; typed: number }) {
  const groupRunning = beat >= 2 && beat <= 7;
  const phase = beat >= 11 ? 'filled' : beat >= 10 ? 'armed' : beat === 9 ? 'approving' : 'offer';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          thread
        </span>
        <span style={{ height: 1, flex: 1, background: 'var(--lh-line2)' }} />
        <Chip tone={beat >= 10 ? 'green' : 'hot'}>{beat >= 10 ? 'agent live' : 'agent · listen-1'}</Chip>
      </div>

      <PromptBubble
        text={PROMPT.slice(0, typed)}
        typing={beat <= 1}
        style={at(beat, 1, 'lha-rise 0.5s cubic-bezier(0.22,0.61,0.36,1) both')}
      />

      <ActivityGroup
        label="thinking"
        title="reasoned + 5 tools"
        running={groupRunning}
        total={beat >= 8 ? '3.3s' : ''}
        style={{ marginTop: 10, ...at(beat, 2, 'lha-rise 0.5s cubic-bezier(0.22,0.61,0.36,1) both') }}
      >
        <ReasoningRow
          beat={beat}
          from={2}
          running={beat === 2}
          text={
            'two triggers, and the second only counts after the first, so it is a sequence rather than an AND. ' +
            '"a meme" is a judgement call, so it needs a classifier and a threshold.'
          }
        />
        {TOOLS.map((tool) => (
          <ToolRow key={tool.key} node={tool} beat={beat} />
        ))}
      </ActivityGroup>

      <ProposalSurface
        style={{ marginTop: 10, ...at(beat, 8, 'lha-materialize 0.75s cubic-bezier(0.22,0.61,0.36,1) both') }}
        phase={phase}
        countdown="4:58"
        conditions={[
          {
            label: 'when',
            text: (
              <>
                @elonmusk posts a meme{' '}
                <span style={{ color: INK2, fontFamily: MONO, fontSize: 11.5 }}>(scored ≥ 0.85)</span>
              </>
            ),
          },
          { label: 'then', text: <>the first new mint whose metadata is about that post</> },
        ]}
        action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: GREEN }}>buy</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO }}>
              10 <SolMark size={10} color={INK} />
            </span>
            <span style={{ color: INK2 }}>of that mint</span>
          </span>
        }
        details={[
          'meme classifier: image + caption',
          'fires ≥ 0.85 · below that it asks you',
          'mint match: name · symbol · uri · image',
          'source: laserstream, pre-first-trade',
          'max slippage 15%',
          'bundle ≤ 8%',
          'lifetime 24h',
          'one fill only',
          'agent wallet 7xKp…4rQ2',
        ]}
      />
    </>
  );
}

/** What the authorization is actually watching, and what it did. */
function Watch({ beat }: { beat: number }) {
  const social: WatchState = beat >= 11 ? 'fired' : beat >= 10 ? 'live' : 'idle';
  const mint: WatchState = beat >= 11 ? 'fired' : beat >= 10 ? 'live' : 'idle';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK3 }}>
          standing watch
        </span>
        <span style={{ height: 1, flex: 1, background: 'var(--lh-line2)' }} />
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: beat >= 10 ? GREEN : INK3, transition: 'color 0.4s ease' }}>
          {beat >= 10 ? '2 armed' : '0 armed'}
        </span>
      </div>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--lh-line2)' }}>
          {/*
           * NOT "any post with an image". The fuzzy half of the sentence
           * is settled by the classifier built at beat 4, so the watcher
           * says what it actually does: score every post, fire on the
           * ones that clear the bar, and hand the near-misses back to
           * the user rather than guessing.
           */}
          <Watcher
            name="@elonmusk"
            source="x · classified"
            detail={'every post scored for “meme”. fires at 0.85, asks you between 0.60 and 0.85'}
            state={social}
            hit="meme 0.94 · fired"
            miss="last 24h: 31 posts scored, 1 cleared"
          />
          <Watcher
            name="pump.fun"
            source="laserstream"
            detail={
              'every new mint decoded at the slot it lands. the first one whose metadata is about the post wins, however many land before it.'
            }
            state={mint}
            hit="$DOGEMAXX · name + uri matched · slot 291,4…"
            miss="1,284 mints decoded today · 0 matched"
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            borderTop: '1px solid var(--lh-line2)',
            padding: '8px 11px',
            fontSize: 10.5,
            color: INK3,
          }}
        >
          <span style={{ fontFamily: MONO }}>
            {beat >= 11 ? 'both met, firing' : beat >= 10 ? 'sleeping until both are true' : 'nothing armed yet'}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, color: beat >= 10 ? INK2 : INK3 }}>
            {beat >= 10 ? 'costs you nothing to wait' : '·'}
          </span>
        </div>
      </Card>

      <FillTicket beat={beat} />

      {/* the closing line: what you never had to do */}
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          ...at(beat, 11, 'lha-rise 0.6s cubic-bezier(0.22,0.61,0.36,1) 0.25s both'),
        }}
      >
        <Chip tone="quiet">you were asleep</Chip>
        <Chip tone="quiet">no chart open</Chip>
        <Chip tone="quiet">its own wallet only</Chip>
        <Chip tone="mint">all it could do was ask</Chip>
      </div>

      <WatchLog beat={beat} />
    </>
  );
}

/* ──────────────────────── the section ──────────────────────── */

const W = 1100;
/* Tall enough for the FULLY expanded trace — prompt + reasoning + four
   tool rows with their result grids open + the proposal card. The
   artboard is a fixed box that scales to fit, so anything past `H` is
   clipped rather than scrolled; measure the tallest beat, not the
   average one. */
const H = 940;

/** The authorization reaching the watchers — one curve, two consumers. */
const WIRE = 'M588 856 C 626 856, 626 252, 658 252';

/** Below this the two halves stack at native size instead of scaling. */
const WIDE_QUERY = '(min-width: 900px)';

const RUN_LABEL =
  'An agent run: the prompt "if elon tweets a meme buy me 10 sol of the first coin someone ' +
  'deploys on pumpfun" is parsed, four tool calls resolve the account, attach a social watcher, ' +
  'subscribe to the pump.fun mint stream and size the position; a trade proposal is drafted, ' +
  'approved by the user, armed against two conditions, and finally filled when both are met.';

export function AgentRunSection() {
  const { ref, inView } = useReveal<HTMLElement>();
  const holderRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const playedRef = useRef(false);
  const [beat, setBeat] = useState(0);
  const [typed, setTyped] = useState(0);
  /* Starts wide on both server and first client render — same markup
     either way, so no hydration mismatch — and corrects on mount. */
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setNarrow(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const play = useCallback(() => {
    clearTimers();
    setBeat(0);
    let t = 0;
    STEP_GAPS.forEach((gap, i) => {
      t += gap;
      timersRef.current.push(window.setTimeout(() => setBeat(i + 1), t));
    });
    timersRef.current.push(window.setTimeout(() => play(), t + LOOP_TAIL));
  }, [clearTimers]);

  const jumpTo = useCallback(
    (n: number) => {
      clearTimers();
      setBeat(n);
    },
    [clearTimers],
  );

  useEffect(() => {
    if (inView && !playedRef.current) {
      playedRef.current = true;
      play();
    }
    return clearTimers;
  }, [inView, play, clearTimers]);

  // The prompt writes itself out on beat 1, and is simply THERE on any
  // later beat — so scrubbing straight to beat 7 never shows half a
  // sentence.
  useEffect(() => {
    if (beat !== 1) {
      setTyped(beat > 1 ? PROMPT.length : 0);
      return;
    }
    setTyped(0);
    const step = Math.max(1, Math.round(TYPE_MS / PROMPT.length));
    const id = window.setInterval(() => {
      setTyped((n) => {
        if (n >= PROMPT.length) {
          window.clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, step);
    return () => window.clearInterval(id);
  }, [beat]);

  const status = STATUS[Math.min(beat, STATUS.length - 1)] ?? STATUS[0]!;

  return (
    <section
      ref={ref}
      aria-label="How an agent run works"
      /* `lha-run` is the reduced-motion hook: the beat entrances inside are
         keyframed but gate on inline opacity, so they need their motion
         removed WITHOUT the global `[data-anim]` opacity override. */
      className="lha-run relative z-[2] px-gutter pb-block-b pt-block-t text-homepage-ink"
    >
      <div className="mx-auto max-w-[1200px]">
        <SectionEyebrow index="01" label="one sentence, one agent" inView={inView} meta="live trace" />
        <SectionHeading
          inView={inView}
          heading={
            <>
              You type the thesis.
              <br />
              <span className="text-homepage-accent">It does the sitting still.</span>
            </>
          }
          body={
            <>
              No builder. No blocks. No strategy DSL you have to learn on a Sunday. Say the thing you
              would have said to a friend, and watch it become a signed, guarded, always-awake
              authorization. Every tool call visible, every execution yours to approve.
            </>
          }
        />

        <DiagramShell tag="agent.run" meta="12 beats &middot; live trace" inView={inView}>
          {narrow ? (
            /*
             * NARROW: no artboard. `DiagramStageHolder` scales a fixed
             * 1100px composition down to the column width, which is right
             * for the homepage's schematic diagrams and wrong for this
             * one — at 375px it would render an 11px trace at ~30%, i.e.
             * an unreadable grey smear. Stacked at native size instead.
             */
            <div className="lh-diagram-grid px-[14px] py-[18px]" role="img" aria-label={RUN_LABEL}>
              <Thread beat={beat} typed={typed} />
              <div
                aria-hidden
                className="my-[18px] flex flex-col items-center gap-[6px]"
                style={{ opacity: beat >= 10 ? 1 : 0.25, transition: 'opacity 0.5s ease' }}
              >
                <span style={{ width: 1, height: 18, background: beat >= 10 ? MINT : 'var(--lh-line2)' }} />
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: beat >= 10 ? MINT : INK3 }}>
                  {beat >= 10 ? 'armed' : 'not armed yet'}
                </span>
                <span style={{ width: 1, height: 18, background: beat >= 10 ? MINT : 'var(--lh-line2)' }} />
              </div>
              <Watch beat={beat} />
            </div>
          ) : (
            <DiagramStageHolder holderRef={holderRef} stageRef={stageRef} w={W} h={H} ariaLabel={RUN_LABEL}>
              {/* ── left: the thread ───────────────────────────────── */}
              <div style={{ position: 'absolute', left: 34, top: 26, width: 556 }}>
                <Thread beat={beat} typed={typed} />
              </div>

              {/* ── the wire: the authorization reaching the watchers ── */}
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                aria-hidden
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
              >
                <path
                  d={WIRE}
                  fill="none"
                  stroke={beat >= 11 ? GREEN : MINT}
                  strokeWidth={1.3}
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: 460,
                    strokeDashoffset: beat >= 10 ? 0 : 460,
                    opacity: beat >= 10 ? 0.65 : 0,
                    transition: 'stroke-dashoffset 0.8s ease, opacity 0.5s ease, stroke 0.6s ease',
                  }}
                />
              </svg>
              {beat >= 10 ? (
                <span
                  aria-hidden
                  data-loop
                  style={{
                    position: 'absolute',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: beat >= 11 ? GREEN : MINT,
                    boxShadow: `0 0 12px 2px ${beat >= 11 ? GREEN : MINT}`,
                    offsetPath: `path("${WIRE}")`,
                    animation: 'lha-packet 2.2s ease-in-out infinite',
                  }}
                />
              ) : null}

              {/* ── right: what it is actually watching ────────────── */}
              <div style={{ position: 'absolute', left: 660, top: 26, width: 406 }}>
                <Watch beat={beat} />
              </div>
            </DiagramStageHolder>
          )}

          <DiagramConsole
            statusText={status.t}
            statusColor={status.c}
            stepCount={STATUS.length}
            activeStep={beat}
            onStep={jumpTo}
            onReplay={play}
          />
        </DiagramShell>

        <ReachStrip inView={inView} />
      </div>
    </section>
  );
}

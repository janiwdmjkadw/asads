'use client';

import type { CSSProperties } from 'react';

import { LightGround } from '../sections/agent/LightGround';
import { ROW_A, ROW_B, type AgentPrompt } from './promptData';
import './corpus.css';

/**
 * The corpus: two rows of real prompts, moving.
 *
 * ── THE ARGUMENT IS VOLUME ───────────────────────────────────────────
 *
 * One example proves a demo was built. Fourteen going past faster than
 * you can read them proves a surface. So the band does not explain that
 * the agent accepts anything a trader would say, it just shows more of it
 * than you can finish, in the voice people actually type in.
 *
 * ── THEY ARE NOT CARDS ───────────────────────────────────────────────
 *
 * They were, and fourteen bordered rectangles sliding past each other read
 * as a component library rather than as a wall of things people said. Each
 * one is a sentence on a rule now, with what it exercises named under it.
 *
 * ── HOVER STOPS IT ───────────────────────────────────────────────────
 *
 * A wall you cannot read is a wall you resent. Putting the pointer on a
 * row pauses it, so a prompt that catches your eye can be finished. That
 * is one CSS rule and it is the difference between a marquee and a
 * gimmick.
 *
 * ── HOW THE LOOP IS SEAMLESS ─────────────────────────────────────────
 *
 * Each row renders its cards TWICE and travels exactly minus fifty
 * percent. At the moment the animation restarts, the second copy is
 * sitting precisely where the first one started, so there is no jump. The
 * duplicate half is `aria-hidden`, so the corpus is announced once.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
  '--lp-hover': 'rgba(11, 11, 11, 0.06)',
} as CSSProperties;

function Card({ prompt }: { readonly prompt: AgentPrompt }) {
  return (
    <article className="cp-item">
      <p className={`${SANS} cp-text`}>{prompt.text}</p>
      <div className="cp-tags">
        {prompt.tags.map((tag) => (
          <span key={tag} className={SANS}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

function Row({
  prompts,
  seconds,
  reverse,
}: {
  readonly prompts: readonly AgentPrompt[];
  readonly seconds: number;
  readonly reverse: boolean;
}) {
  return (
    <div className="cp-row">
      <div
        className="cp-track"
        style={{ animationDuration: `${seconds}s`, animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        {prompts.map((prompt) => (
          <Card key={prompt.text} prompt={prompt} />
        ))}
        <div aria-hidden className="cp-half">
          {prompts.map((prompt) => (
            <Card key={`copy-${prompt.text}`} prompt={prompt} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Corpus() {
  return (
    <section id="corpus" style={LIGHT} className="relative isolate w-full overflow-hidden bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      <div className="mx-auto w-full max-w-[760px] px-5 pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pt-[88px]">
        <div className="flex flex-col items-start gap-6 pb-11 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-12">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>The corpus</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              If you can say it,
              <br /> you can trade it.
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>
            Every card here is the kind of thing people actually type. Unpunctuated, half slang,
            three conditions deep. There is no syntax to get wrong because there is no syntax. Put
            your pointer on a row to stop it and read one.
          </p>
        </div>
      </div>

      {/* Full bleed, because the point is that it runs off both edges. */}
      <div className="cp-wall">
        <Row prompts={ROW_A} seconds={72} reverse={false} />
        <Row prompts={ROW_B} seconds={62} reverse />
      </div>

      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-9 lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[96px]">
        <p className={`${SANS} max-w-[70ch] text-[15px] leading-[26px] text-lp-ink-3`}>
          When a sentence is genuinely ambiguous the agent comes back and asks. It never guesses
          with your money.
        </p>
      </div>
    </section>
  );
}

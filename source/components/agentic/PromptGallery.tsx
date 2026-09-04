'use client';

/**
 * 02 — THE CORPUS. Two counter-scrolling rows of real prompts.
 *
 * The argument of this section is volume: the surface accepts anything
 * a trader would actually say, so the proof is a wall of it moving past
 * faster than you can read. Hovering a row stops it (`.lha-marquee-row`
 * in globals.css) so a prompt that catches your eye can be read.
 *
 * Each row renders its cards TWICE and translates by exactly -50%, which
 * is what makes the loop seamless; the duplicate half is `aria-hidden`
 * so a screen reader hears the corpus once.
 */

import { SectionEyebrow, SectionHeading, useReveal } from '@/components/homepage/chrome';
import { Chip, HOT, INK, INK3, MONO } from './agentSurfaces';
import { GALLERY_ROW_A, GALLERY_ROW_B, type AgentPrompt } from './prompts';

function PromptCard({ prompt }: { prompt: AgentPrompt }) {
  return (
    <div
      className="group mx-[7px] flex h-[152px] w-[352px] shrink-0 flex-col justify-between border border-homepage-line bg-[rgba(16,16,19,0.9)] p-[15px] transition-[border-color,background,transform] duration-300 ease-out hover:-translate-y-[3px] hover:border-homepage-line3 hover:bg-[rgba(24,24,28,0.85)]"
      style={{ backdropFilter: 'blur(6px)' }}
    >
      <div className="flex items-start gap-[9px]">
        <span
          aria-hidden
          className="mt-[1px] shrink-0 font-geist-mono text-[12px] transition-colors duration-300"
          style={{ color: HOT }}
        >
          &gt;
        </span>
        {/* Contract addresses are one 42-char unbreakable token; without
            an anywhere-break they run straight out of the card. */}
        <p
          className="m-0 line-clamp-4 font-geist-mono text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]"
          style={{ color: INK }}
        >
          {prompt.text}
        </p>
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {prompt.tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>
    </div>
  );
}

function MarqueeRow({
  prompts,
  seconds,
  reverse,
}: {
  prompts: readonly AgentPrompt[];
  seconds: number;
  reverse: boolean;
}) {
  return (
    <div
      className="lha-marquee-row relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 13%, #000 87%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 13%, #000 87%, transparent)',
      }}
    >
      <div
        data-loop
        className="lha-marquee"
        style={{ animation: `${reverse ? 'lha-marqueeR' : 'lha-marqueeL'} ${seconds}s linear infinite` }}
      >
        {prompts.map((prompt) => (
          <PromptCard key={prompt.text} prompt={prompt} />
        ))}
        <div aria-hidden className="flex">
          {prompts.map((prompt) => (
            <PromptCard key={`dup-${prompt.text}`} prompt={prompt} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PromptGallery() {
  const { ref, inView } = useReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      aria-label="What people actually ask for"
      className="relative z-[2] pb-block-b pt-block-t text-homepage-ink"
    >
      <div className="mx-auto max-w-[1200px] px-gutter">
        <SectionEyebrow index="02" label="the corpus" inView={inView} meta="real prompts" />
        <SectionHeading
          inView={inView}
          heading={
            <>
              If you can say it,
              <br />
              <span className="text-homepage-accent">you can trade it.</span>
            </>
          }
          body={
            <>
              Every card below is the kind of thing our users type: unpunctuated, half-slang, three
              conditions deep. There is no syntax to get wrong, because there is no syntax.
              Hover to stop the wall and read one.
            </>
          }
        />
      </div>

      <div
        data-anim
        className="flex flex-col gap-[14px]"
        style={{ opacity: 0, animation: inView ? 'lh-revealup 0.8s cubic-bezier(0.22,0.61,0.36,1) 0.25s both' : undefined }}
      >
        <MarqueeRow prompts={GALLERY_ROW_A} seconds={68} reverse={false} />
        <MarqueeRow prompts={GALLERY_ROW_B} seconds={58} reverse />
      </div>

      <div className="mx-auto mt-[26px] max-w-[1200px] px-gutter">
        <p
          data-anim
          className="m-0 text-center font-geist-mono text-[11px] tracking-[0.1em]"
          style={{
            color: INK3,
            fontFamily: MONO,
            opacity: 0,
            animation: inView ? 'lh-fade 0.6s ease-out 0.5s both' : undefined,
          }}
        >
          the agent asks you back when a sentence is ambiguous. it never guesses with your money
        </p>
      </div>
    </section>
  );
}

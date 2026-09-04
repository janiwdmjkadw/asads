'use client';

import type { CSSProperties } from 'react';

import { LightGround } from '../sections/agent/LightGround';
import './control.css';

/**
 * The loop, and then control. Two bands in one file because they are the
 * same object twice: three columns of prose under a headline, and
 * splitting them into two files would duplicate the whole stylesheet to
 * change three strings.
 *
 * ── THE LOOP ─────────────────────────────────────────────────────────
 *
 * Three moves, numbered. This is the band that has to survive somebody
 * who has read nothing else on the page, so it says the entire product in
 * about sixty words and does not perform anything.
 *
 * ── CONTROL ──────────────────────────────────────────────────────────
 *
 * The three questions anybody sane asks before handing a machine their
 * intent, answered in the order they occur to you: what is it doing, what
 * can it reach, and who decides. The wallet answer is the load bearing
 * one, so it is the longest and it is in the middle where the eye lands.
 *
 * Neither band animates. The page has a hero that types, a trace that
 * runs and a wall that travels; by the time you are here the argument has
 * been performed and what is left is to state it plainly.
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

interface Item {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Item[] = [
  {
    n: '01',
    title: 'Say the thing',
    body: 'One sentence in your own words. Slang, tickers, wallets, a whole three part condition. It takes the sentence, not a form.',
  },
  {
    n: '02',
    title: 'Watch it plan',
    body: 'It shows its work: every tool it reaches for, every value it resolved, every guardrail it set. Nothing happens behind a curtain.',
  },
  {
    n: '03',
    title: 'Approve once',
    body: 'You get one card with the real terms on it. Approve, and the agent stands watch for a minute or a month, until the market agrees with you.',
  },
];

const PANELS: readonly Item[] = [
  {
    n: '01',
    title: 'It shows its work',
    body: 'Every tool call, every value it read, every guardrail it set, timestamped and on the record. There is no black box to trust, because there is no black box.',
  },
  {
    n: '02',
    title: 'It has one wallet, and it is not yours',
    body: 'The agent gets its own wallet, funded by you, and that is the entire universe it can reach. Your main wallet and every other Listen wallet are unreachable to it. Keys stay inside a Turnkey enclave, so Listen cannot move your funds either.',
  },
  {
    n: '03',
    title: 'You approve, it executes',
    body: 'Your approval is what arms a strategy. Read the terms, click once, and from that moment it runs on its own, settling on chain with nobody at the keyboard. You can still pause it, rewrite its terms, or kill it mid flight.',
  },
];

function Band({
  id,
  eyebrow,
  heading,
  lede,
  items,
}: {
  readonly id: string;
  readonly eyebrow: string;
  readonly heading: readonly [string, string];
  readonly lede: string;
  readonly items: readonly Item[];
}) {
  return (
    <section id={id} style={LIGHT} className="relative isolate w-full bg-lp-ground">
      <LightGround className="absolute inset-0 -z-20 size-full" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(130%_90%_at_50%_40%,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.45)_55%,rgba(232,232,232,0.6)_100%)]"
      />

      <div className="mx-auto w-full max-w-[760px] px-5 pb-[72px] pt-[64px] lg:w-[min(1400px,100%-48px)] lg:max-w-none lg:px-0 lg:pb-[96px] lg:pt-[88px]">
        <div className="flex flex-col items-start gap-6 pb-11 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-12">
          <div>
            <span className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>{eyebrow}</span>
            <h2
              className={`${SANS} mt-4 max-w-[720px] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink-1 lg:mt-5 lg:text-[52px] lg:leading-[1.04] lg:tracking-[-0.035em]`}
            >
              {heading[0]}
              <br /> {heading[1]}
            </h2>
          </div>
          <p className={`${SANS} max-w-[360px] text-[16px] leading-[26px] text-lp-ink-2 lg:pb-2`}>{lede}</p>
        </div>

        <div className="ct-cols">
          {items.map((item) => (
            <div key={item.n}>
              <span className={`${SANS} ct-n tabular-nums`}>{item.n}</span>
              <h3 className={`${SANS} ct-title`}>{item.title}</h3>
              <p className={`${SANS} ct-body`}>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Loop() {
  return (
    <Band
      id="loop"
      eyebrow="The loop"
      heading={['Thirty seconds from a thought', 'to a standing order.']}
      lede="The whole product is three moves. Nothing to configure, nothing to back test, no JSON. The agent does the waiting, which is the part people are worst at."
      items={STEPS}
    />
  );
}

export function Control() {
  return (
    <Band
      id="control"
      eyebrow="Control"
      heading={['It works for you.', 'Not the other way round.']}
      lede="Handing a machine your intent should feel like delegation, not surrender. So it is loud about what it is doing, walled into a wallet of its own, and incapable of executing anything you have not approved."
      items={PANELS}
    />
  );
}
